package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

func (s *Server) handleVPNOverview(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{
		"wireguard": map[string]any{"active": serviceActive("wg-quick@wg0") || serviceActive("wireguard")},
		"openvpn":   map[string]any{"active": serviceActive("openvpn") || serviceActive("openvpn@server")},
		"ipsec":     map[string]any{"active": serviceActive("strongswan") || serviceActive("ipsec")},
	})
}

func (s *Server) handleVPNConnections(w http.ResponseWriter, r *http.Request) {
	wgOut, _ := runCmd("wg", "show", "all", "dump")
	var conns []map[string]any
	for _, line := range strings.Split(wgOut, "\n") {
		f := strings.Fields(line)
		if len(f) >= 5 { conns = append(conns, map[string]any{"type": "wireguard", "peer": f[0], "endpoint": f[2], "allowed": f[3], "handshake": f[4]}) }
	}
	jsonOK(w, map[string]any{"connections": conns})
}

func (s *Server) handleVPNStatistics(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("wg", "show", "all", "transfer")
	jsonOK(w, map[string]any{"raw": out})
}

func (s *Server) handleVPNLogs(w http.ResponseWriter, r *http.Request) {
	svc := pathSuffix(r, "/api/vpn/logs/"); if svc == "" { svc = "openvpn" }
	out, _ := runCmd("journalctl", "-u", svc, "-n", "100", "--no-pager", "--output=short-iso")
	jsonOK(w, map[string]any{"service": svc, "logs": strings.Split(out, "\n")})
}

func (s *Server) handleVPNWGGenKeys(w http.ResponseWriter, r *http.Request) {
	priv, err := runCmd("wg", "genkey")
	if err != nil { jsonErr(w, "wg not installed: "+err.Error(), http.StatusInternalServerError); return }
	pub, _ := runCmd("bash", "-c", "echo '"+priv+"' | wg pubkey")
	psk, _ := runCmd("wg", "genpsk")
	jsonOK(w, map[string]string{"private_key": priv, "public_key": pub, "preshared_key": psk})
}

func (s *Server) handleVPNWireguard(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("wg", "show", "all")
		cfgs, _ := runCmd("bash", "-c", "ls /etc/wireguard/*.conf 2>/dev/null")
		jsonOK(w, map[string]any{"status": out, "configs": strings.Split(strings.TrimSpace(cfgs), "\n")})
	case http.MethodPost:
		var req struct {
			Interface, PrivateKey, Address, ListenPort, DNS string
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Interface == "" { req.Interface = "wg0" }
		cfg := "[Interface]\nPrivateKey = " + req.PrivateKey + "\nAddress = " + req.Address + "\n"
		if req.ListenPort != "" { cfg += "ListenPort = " + req.ListenPort + "\n" }
		if req.DNS != "" { cfg += "DNS = " + req.DNS + "\n" }
		path := "/etc/wireguard/" + req.Interface + ".conf"
		if err := os.WriteFile(path, []byte(cfg), 0600); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]string{"status": "ok", "path": path})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleVPNWireguardIface(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/wireguard/")
	parts  := strings.SplitN(suffix, "/", 2)
	iface  := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }

	switch action {
	case "up", "start":
		out, err := runCmd("wg-quick", "up", iface)
		if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]any{"status": "ok", "output": out})
	case "down", "stop":
		out, err := runCmd("wg-quick", "down", iface)
		if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]any{"status": "ok", "output": out})
	case "restart":
		runCmd("wg-quick", "down", iface)
		out, _ := runCmd("wg-quick", "up", iface)
		jsonOK(w, map[string]any{"status": "ok", "output": out})
	default:
		if r.Method == http.MethodPost {
			var req struct { PublicKey, AllowedIPs, Endpoint string }
			json.NewDecoder(r.Body).Decode(&req)
			args := []string{"set", iface, "peer", req.PublicKey, "allowed-ips", req.AllowedIPs}
			if req.Endpoint != "" { args = append(args, "endpoint", req.Endpoint) }
			if _, err := runCmd("wg", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		} else if r.Method == http.MethodDelete {
			var req struct{ PublicKey string `json:"public_key"` }
			json.NewDecoder(r.Body).Decode(&req)
			runCmd("wg", "set", iface, "peer", req.PublicKey, "remove")
		} else {
			out, _ := runCmd("wg", "show", iface)
			jsonOK(w, map[string]any{"interface": iface, "status": out}); return
		}
		jsonOK(w, map[string]string{"status": "ok"})
	}
}

func (s *Server) handleVPNOpenVPN(w http.ResponseWriter, r *http.Request) {
	active := serviceActive("openvpn") || serviceActive("openvpn@server")
	cfgs, _ := runCmd("bash", "-c", "ls /etc/openvpn/*.conf /etc/openvpn/server/*.conf 2>/dev/null")
	jsonOK(w, map[string]any{"active": active, "configs": strings.Split(strings.TrimSpace(cfgs), "\n")})
}

func (s *Server) handleVPNOpenVPNItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/openvpn/")
	parts  := strings.SplitN(suffix, "/", 2)
	id     := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }
	svc    := "openvpn@" + id
	switch action {
	case "start":   runCmd("systemctl", "start", svc)
	case "stop":    runCmd("systemctl", "stop", svc)
	case "restart": runCmd("systemctl", "restart", svc)
	case "status":  jsonOK(w, map[string]any{"active": serviceActive(svc)}); return
	default:
		switch r.Method {
		case http.MethodGet:    jsonOK(w, map[string]any{"id": id, "active": serviceActive(svc)}); return
		case http.MethodDelete: runCmd("systemctl", "stop", svc); runCmd("systemctl", "disable", svc)
		}
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleVPNIPSec(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("ipsec", "status")
		jsonOK(w, map[string]any{"active": serviceActive("strongswan") || serviceActive("ipsec"), "status": out})
	case http.MethodPost:
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleVPNIPSecAction(w http.ResponseWriter, r *http.Request) {
	action := pathSuffix(r, "/api/vpn/ipsec/")
	switch action {
	case "start":   runCmd("ipsec", "start")
	case "stop":    runCmd("ipsec", "stop")
	case "restart": runCmd("ipsec", "restart")
	case "reload":  runCmd("ipsec", "reload")
	case "status":
		out, _ := runCmd("ipsec", "status")
		jsonOK(w, map[string]string{"output": out}); return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}
