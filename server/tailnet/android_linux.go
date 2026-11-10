package main

import (
	"net"
	"os"

	_ "tailscale.com/feature/androidbin"
	"tailscale.com/net/dnscache"
	"tailscale.com/net/netmon"
)

// On a phone posnet is a plain Linux executable shipped inside the APK, with no Java to
// tell Tailscale about the network. androidbin fills that gap: interfaces, DNS, and the
// system's CA certificates. We also wire dnscache's forwarder to net.DefaultResolver (so
// it uses Android's dnsproxyd socket instead of dialing 127.0.0.1:53) and register the
// synthetic interface getter directly on Android to avoid NETLINK_ROUTE SELinux denials.
func init() {
	dnscache.Get().Forward = net.DefaultResolver
	if _, err := os.Stat("/dev/__properties__"); err == nil {
		if f, ok := netmon.HookInterfacesFallback.GetOk(); ok {
			netmon.RegisterInterfaceGetter(f)
		}
	}
}
