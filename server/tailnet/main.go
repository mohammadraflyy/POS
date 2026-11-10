// Command posnet joins the shop's private Tailscale network from inside the POS app, so
// a phone outside the shop reaches the shop PC without the Tailscale app installed.
//
// It runs in one of two modes:
//
//	posnet -state DIR -hostname pos-pc -serve 48950
//	    (shop PC) accepts tailnet connections on port 48950 and forwards each one to
//	    the POS server on 127.0.0.1:48950.
//
//	posnet -state DIR -hostname pos-hp -dial 100.64.0.1:48950
//	    (phone) listens on a random 127.0.0.1 port and forwards each connection over
//	    the tailnet to the shop PC, so the app talks plain HTTP to localhost.
//
// The auth key, needed only the first time a state directory is used, comes from the
// POSNET_AUTHKEY environment variable rather than the command line, so it never shows
// in a process list. Progress goes to stdout as one JSON object per line. The program
// exits when stdin closes: the app that started it is gone.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/netip"
	"os"
	"strconv"
	"sync"
	"time"

	"tailscale.com/envknob"
	"tailscale.com/tsnet"
)

var (
	stdoutMu sync.Mutex
	encoder  = json.NewEncoder(os.Stdout)
)

// emit writes one progress event for the app to read.
func emit(event string, fields map[string]any) {
	if fields == nil {
		fields = map[string]any{}
	}

	fields["event"] = event

	stdoutMu.Lock()
	defer stdoutMu.Unlock()

	_ = encoder.Encode(fields)
}

func fail(message string) {
	emit("error", map[string]any{"message": message})
	os.Exit(1)
}

func main() {
	stateDir := flag.String("state", "", "folder that keeps this device's tailnet identity")
	hostname := flag.String("hostname", "pos", "device name shown in the Tailscale admin console")
	tags := flag.String("tag", "tag:pos", "tag the device joins with")
	servePort := flag.Int("serve", 0, "shop PC: tailnet port to accept and forward to 127.0.0.1 on the same port")
	dialTarget := flag.String("dial", "", "phone: tailnet address of the shop PC, host:port")
	verbose := flag.Bool("verbose", false, "print Tailscale's own log to stderr")
	flag.Parse()

	if *stateDir == "" || (*servePort == 0) == (*dialTarget == "") {
		fail("posnet butuh -state dan salah satu dari -serve atau -dial")
	}

	if err := os.MkdirAll(*stateDir, 0700); err != nil {
		fail(fmt.Sprintf("tidak bisa membuat folder state %s: %v", *stateDir, err))
	}
	_ = os.Setenv("TS_LOGS_DIR", *stateDir)
	if os.Getenv("HOME") == "" {
		_ = os.Setenv("HOME", *stateDir)
	}
	if os.Getenv("TMPDIR") == "" {
		_ = os.Setenv("TMPDIR", *stateDir)
	}

	// the shop's traffic and logs stay between its own devices
	envknob.SetNoLogsNoSupport()

	server := &tsnet.Server{
		Dir:           *stateDir,
		Hostname:      *hostname,
		AuthKey:       os.Getenv("POSNET_AUTHKEY"),
		AdvertiseTags: []string{*tags},
		UserLogf:      func(string, ...any) {},
		Logf:          func(string, ...any) {},
	}

	if *verbose {
		server.Logf = log.Printf
	}

	go exitWhenParentGone(server)

	if *servePort != 0 {
		runServe(server, *servePort)
	} else {
		runDial(server, *dialTarget)
	}
}

// exitWhenParentGone ends the process once stdin reaches EOF. The app holds the other
// end of the pipe, so EOF means it closed - or crashed - and nobody needs us anymore.
func exitWhenParentGone(server *tsnet.Server) {
	_, err := io.Copy(io.Discard, bufio.NewReader(os.Stdin))
	emit("exit", map[string]any{"reason": "stdin_closed", "error": fmt.Sprint(err)})
	_ = server.Close()
	os.Exit(0)
}

// waitUp brings the node online, retrying while the network or control server is
// unreachable, and reports its tailnet address.
func waitUp(server *tsnet.Server) {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		status, err := server.Up(ctx)
		cancel()

		if err == nil {
			ips := []string{}

			for _, ip := range status.TailscaleIPs {
				ips = append(ips, ip.String())
			}

			ip4, _ := server.TailscaleIPs()
			emit("up", map[string]any{"ip": ip4.String(), "ips": ips})

			return
		}

		emit("waiting", map[string]any{"message": err.Error()})
		time.Sleep(5 * time.Second)
	}
}

// waitPeer waits until target's IP appears in the local tailnet peer map so that
// tsnet's dialer routes the connection through netstack instead of the OS socket.
func waitPeer(server *tsnet.Server, target string) {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		return
	}
	targetIP, err := netip.ParseAddr(host)
	if err != nil || !targetIP.IsValid() {
		return
	}
	lc, err := server.LocalClient()
	if err != nil {
		return
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		st, err := lc.Status(ctx)
		cancel()
		if err == nil && st != nil {
			for _, peer := range st.Peer {
				for _, ip := range peer.TailscaleIPs {
					if ip == targetIP {
						return
					}
				}
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func runServe(server *tsnet.Server, port int) {
	waitUp(server)

	listener, err := server.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		fail(fmt.Sprintf("tidak bisa membuka port %d di jaringan Tailscale: %v", port, err))
	}

	emit("serving", map[string]any{"port": port})

	target := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))

	for {
		conn, err := listener.Accept()
		if err != nil {
			fail(fmt.Sprintf("jaringan Tailscale berhenti: %v", err))
		}

		go forward(conn, func(ctx context.Context) (net.Conn, error) {
			var dialer net.Dialer

			return dialer.DialContext(ctx, "tcp", target)
		})
	}
}

func runDial(server *tsnet.Server, target string) {
	// listen first, so the app learns its port at once and requests made while the
	// tailnet is still connecting simply wait instead of failing to connect
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fail(fmt.Sprintf("tidak bisa membuka port lokal: %v", err))
	}

	emit("listening", map[string]any{"port": listener.Addr().(*net.TCPAddr).Port})

	ready := make(chan struct{})

	go func() {
		waitUp(server)
		waitPeer(server, target)
		close(ready)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			fail(fmt.Sprintf("port lokal berhenti: %v", err))
		}

		go forward(conn, func(ctx context.Context) (net.Conn, error) {
			select {
			case <-ready:
			case <-ctx.Done():
				return nil, ctx.Err()
			}

			for {
				c, err := server.Dial(ctx, "tcp", target)
				if err == nil {
					return c, nil
				}
				emit("dial_error", map[string]any{"target": target, "message": err.Error()})
				select {
				case <-ctx.Done():
					return nil, err
				case <-time.After(500 * time.Millisecond):
				}
			}
		})
	}
}

// forward pipes one accepted connection to a freshly dialed one, both directions,
// until either side closes.
func forward(conn net.Conn, dial func(context.Context) (net.Conn, error)) {
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	upstream, err := dial(ctx)
	cancel()

	if err != nil {
		return
	}

	defer upstream.Close()

	done := make(chan struct{}, 2)

	pipe := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)

		if tcp, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = tcp.CloseWrite()
		}

		done <- struct{}{}
	}

	go pipe(upstream, conn)
	go pipe(conn, upstream)

	<-done
	<-done
}
