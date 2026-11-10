package main

// On a phone posnet is a plain Linux executable shipped inside the APK, with no Java to
// tell Tailscale about the network. androidbin fills that gap: interfaces, DNS, and the
// system's CA certificates.
import _ "tailscale.com/feature/androidbin"
