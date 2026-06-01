package api

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── Typy ─────────────────────────────────────────────────────────────────────

type WGPeer struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Device        string  `json:"device"`
	PublicKey     string  `json:"public_key"`
	PresharedKey  string  `json:"preshared_key,omitempty"`
	PrivateKey    string  `json:"private_key,omitempty"`
	AllowedIPs    string  `json:"allowed_ips"`
	IP            string  `json:"ip"`
	Endpoint      string  `json:"endpoint"`
	LastHandshake string  `json:"last_handshake"`
	RxBytes       int64   `json:"rx_bytes"`
	TxBytes       int64   `json:"tx_bytes"`
	RxGB          float64 `json:"rx"`
	TxGB          float64 `json:"tx"`
	State         string  `json:"state"`
	CreatedAt     string  `json:"created"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
	Location      string  `json:"location"`
	Country       string  `json:"country"`
}

type WGInterface struct {
	Name       string  `json:"name"`
	PublicKey  string  `json:"pubkey"`
	ListenPort int     `json:"listen_port"`
	Address    string  `json:"subnet"`
	DNS        string  `json:"dns"`
	MTU        int     `json:"mtu"`
	Endpoint   string  `json:"endpoint"`
	State      string  `json:"state"`
	Uptime     string  `json:"uptime"`
	TotalRx    float64 `json:"total_rx"`
	TotalTx    float64 `json:"total_tx"`
}

type PeerMeta struct {
	ID        string  `json:"id"`
	PublicKey string  `json:"public_key"`
	Name      string  `json:"name"`
	Device    string  `json:"device"`
	Location  string  `json:"location"`
	Country   string  `json:"country"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	CreatedAt string  `json:"created"`
}

const vpnMetaPath = "/etc/nimbus/vpn-peers.json"

var (
	vpnMetaMu     sync.Mutex
	vpnMetaCache  []PeerMeta
	vpnMetaLoaded bool
)

func loadVPNMeta() []PeerMeta {
	vpnMetaMu.Lock()
	defer vpnMetaMu.Unlock()
	if vpnMetaLoaded { return vpnMetaCache }
	data, err := os.ReadFile(vpnMetaPath)
	if err == nil { json.Unmarshal(data, &vpnMetaCache) }
	if vpnMetaCache == nil { vpnMetaCache = []PeerMeta{} }
	vpnMetaLoaded = true
	return vpnMetaCache
}

func saveVPNMeta(meta []PeerMeta) {
	vpnMetaMu.Lock()
	defer vpnMetaMu.Unlock()
	os.MkdirAll("/etc/nimbus", 0755)
	data, _ := json.MarshalIndent(meta, "", "  ")
	os.WriteFile(vpnMetaPath, data, 0600)
	vpnMetaCache = meta
	vpnMetaLoaded = true
}

func isBase64Key(s string) bool {
	if len(s) < 40 { return false }
	_, err := base64.StdEncoding.DecodeString(s)
	return err == nil || len(s) == 44
}

func handshakeState(unixStr string) (string, string) {
	ts, err := strconv.ParseInt(unixStr, 10, 64)
	if err != nil || ts == 0 { return "offline", "nigdy" }
	elapsed := time.Now().Unix() - ts
	switch {
	case elapsed < 0:   return "offline", "—"
	case elapsed < 150: return "online",  fmt.Sprintf("%ds", elapsed)
	case elapsed < 600: return "online",  fmt.Sprintf("%dm %ds", elapsed/60, elapsed%60)
	case elapsed < 3600: return "idle",   fmt.Sprintf("%d min", elapsed/60)
	case elapsed < 86400: return "idle",  fmt.Sprintf("%d godz.", elapsed/3600)
	default:            return "offline", fmt.Sprintf("%d dni", elapsed/86400)
	}
}

func parseWGConf(iface string) WGInterface {
	path := "/etc/wireguard/" + iface + ".conf"
	data, err := os.ReadFile(path)
	if err != nil { return WGInterface{Name: iface} }
	wgi := WGInterface{Name: iface, MTU: 1420}
	re := regexp.MustCompile(`(?i)^(\w+)\s*=\s*(.+)$`)
	privKey := ""
	for _, line := range strings.Split(string(data), "\n") {
		m := re.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil { continue }
		k, v := strings.ToLower(m[1]), strings.TrimSpace(m[2])
		switch k {
		case "privatekey": privKey = v
		case "address":    wgi.Address = v
		case "listenport": wgi.ListenPort, _ = strconv.Atoi(v)
		case "dns":        wgi.DNS = v
		case "mtu":        wgi.MTU, _ = strconv.Atoi(v)
		}
	}
	if privKey != "" {
		pub, err := runCmd("bash", "-c", "printf '%s' '"+privKey+"' | wg pubkey")
		if err == nil { wgi.PublicKey = strings.TrimSpace(pub) }
	}
	return wgi
}

func listWGInterfaces() []string {
	out, _ := runCmd("bash", "-c", "ls /etc/wireguard/*.conf 2>/dev/null")
	var ifaces []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" { continue }
		base := line[strings.LastIndex(line, "/")+1:]
		ifaces = append(ifaces, strings.TrimSuffix(base, ".conf"))
	}
	if len(ifaces) == 0 { ifaces = []string{"wg0"} }
	return ifaces
}

func wgUptime(iface string) string {
	out, err := runCmd("bash", "-c", "systemctl show wg-quick@"+iface+" --property=ActiveEnterTimestamp --value 2>/dev/null")
	if err != nil { return "—" }
	ts := strings.TrimSpace(out)
	if ts == "n/a" || ts == "" { return "—" }
	t, err := time.Parse("Mon 2006-01-02 15:04:05 MST", ts)
	if err != nil { return ts }
	dur := time.Since(t)
	days := int(dur.Hours()) / 24
	hours := int(dur.Hours()) % 24
	if days > 0 { return fmt.Sprintf("%dd %dh", days, hours) }
	if hours > 0 { return fmt.Sprintf("%dh %dm", hours, int(dur.Minutes())%60) }
	return fmt.Sprintf("%dm", int(dur.Minutes()))
}

func parseWGDumpPeers() []map[string]string {
	// Próbuj z pełną ścieżką najpierw
	var out string
	var err error
	for _, wgBin := range []string{"/usr/bin/wg", "/usr/local/bin/wg", "wg"} {
		out, err = runCmd(wgBin, "show", "all", "dump")
		if err == nil && out != "" {
			break
		}
	}
	if err != nil || out == "" { return nil }

	var peers []map[string]string
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		// Format wg show all dump:
		// Linia interfejsu: iface privkey pubkey listen_port fwmark  → 5 lub 6 pól
		// Linia peera:      iface pubkey psk endpoint allowed_ips last_handshake rx tx keepalive → 9 pól
		// Rozróżniamy po liczbie pól — peer ma zawsze 9
		if len(f) != 9 { continue }

		iface     := f[0]
		pubkey    := f[1]
		psk       := f[2]
		endpoint  := f[3]
		allowed   := f[4]
		handshake := f[5]
		rxBytes   := f[6]
		txBytes   := f[7]

		if !isBase64Key(pubkey) { continue }
		_ = psk // może być "(none)" lub kluczem base64

		rx, _ := strconv.ParseInt(rxBytes, 10, 64)
		tx, _ := strconv.ParseInt(txBytes, 10, 64)

		peers = append(peers, map[string]string{
			"iface":     iface,
			"pubkey":    pubkey,
			"psk":       psk,
			"endpoint":  endpoint,
			"allowed":   allowed,
			"handshake": handshake,
			"rx":        fmt.Sprint(rx),
			"tx":        fmt.Sprint(tx),
		})
	}
	return peers
}

func nextPeerIP(iface string) string {
	wgi := parseWGConf(iface)
	base := "10.8.0"
	if wgi.Address != "" {
		ip := strings.Split(wgi.Address, "/")[0]
		base = ip[:strings.LastIndex(ip, ".")]
	}
	used := map[string]bool{}
	if wgi.Address != "" { used[strings.Split(wgi.Address, "/")[0]] = true }
	data, _ := os.ReadFile("/etc/wireguard/" + iface + ".conf")
	re := regexp.MustCompile(`AllowedIPs\s*=\s*([\d.]+)/`)
	for _, m := range re.FindAllStringSubmatch(string(data), -1) { used[m[1]] = true }
	for i := 2; i < 255; i++ {
		c := base + "." + strconv.Itoa(i)
		if !used[c] { return c }
	}
	return base + ".254"
}

func extractPeerBlock(conf, pubkey string) string {
	var block []string
	inBlock := false
	found := false
	scanner := bufio.NewScanner(strings.NewReader(conf))
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "[Peer]" {
			if found { break }
			inBlock = true
			block = []string{line}
			continue
		}
		if inBlock && strings.HasPrefix(trimmed, "[") && trimmed != "[Peer]" {
			if found { break }
			inBlock = false; block = nil; continue
		}
		if inBlock {
			block = append(block, line)
			if strings.Contains(line, pubkey) { found = true }
		}
	}
	if !found { return "" }
	return strings.Join(block, "\n")
}

func removeFromConf(iface, pubkey string) {
	confPath := "/etc/wireguard/" + iface + ".conf"
	data, err := os.ReadFile(confPath)
	if err != nil { return }
	lines := strings.Split(string(data), "\n")
	var result []string
	skip := false
	blockStart := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "[Peer]" {
			blockStart = i
			skip = false
		}
		if blockStart >= 0 && strings.Contains(line, pubkey) {
			skip = true
			// Usuń poprzednio dodane linie tego bloku
			for len(result) > 0 && strings.TrimSpace(result[len(result)-1]) != "" {
				if strings.TrimSpace(result[len(result)-1]) == "[Peer]" {
					result = result[:len(result)-1]; break
				}
				result = result[:len(result)-1]
			}
			continue
		}
		if skip {
			if trimmed == "[Peer]" || (strings.HasPrefix(trimmed, "[") && trimmed != "") {
				skip = false
			} else { continue }
		}
		result = append(result, line)
	}
	os.WriteFile(confPath, []byte(strings.Join(result, "\n")), 0600)
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// ─── HTTP Handlers ─────────────────────────────────────────────────────────────



func (s *Server) handleVPNWireguard(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost { s.handleVPNWireguardCreate(w, r); return }

	ifaces := listWGInterfaces()
	primary := "wg0"
	if len(ifaces) > 0 { primary = ifaces[0] }
	if q := r.URL.Query().Get("iface"); q != "" { primary = q }

	wgi := parseWGConf(primary)
	wgi.State = "down"
	if isWGIfaceUp(primary) {
		wgi.State = "up"
		wgi.Uptime = wgUptime(primary)
	}
	if env := os.Getenv("WG_ENDPOINT"); env != "" {
		wgi.Endpoint = env
	} else if ep := resolveEndpoint(primary); ep != "" {
		wgi.Endpoint = ep
	}

	dumpPeers := parseWGDumpPeers()
	meta := loadVPNMeta()

	peersMap := map[string]*WGPeer{}
	for _, m := range meta {
		peersMap[m.PublicKey] = &WGPeer{
			ID: m.ID, PublicKey: m.PublicKey, Name: m.Name,
			Device: m.Device, Location: m.Location, Country: m.Country,
			Lat: m.Lat, Lon: m.Lon, CreatedAt: m.CreatedAt,
			State: "offline", LastHandshake: "—",
		}
	}

	var totalRx, totalTx int64
	for _, dp := range dumpPeers {
		if dp["iface"] != primary { continue }
		pub := dp["pubkey"]
		p, exists := peersMap[pub]
		if !exists {
			p = &WGPeer{ID: "peer-" + pub[:8], PublicKey: pub, Name: pub[:12] + "…", State: "offline"}
			peersMap[pub] = p
		}
		rx, _ := strconv.ParseInt(dp["rx"], 10, 64)
		tx, _ := strconv.ParseInt(dp["tx"], 10, 64)
		p.RxBytes, p.TxBytes = rx, tx
		p.RxGB = float64(rx) / 1073741824
		p.TxGB = float64(tx) / 1073741824
		p.Endpoint = dp["endpoint"]
		p.AllowedIPs = dp["allowed"]
		p.State, p.LastHandshake = handshakeState(dp["handshake"])
		totalRx += rx; totalTx += tx
		if p.IP == "" && p.AllowedIPs != "" {
			parts := strings.Split(strings.Split(strings.TrimSpace(strings.Split(p.AllowedIPs, ",")[0]), "/")[0], ".")
			p.IP = strings.Join(parts, ".")
		}
	}
	wgi.TotalRx = float64(totalRx) / 1073741824
	wgi.TotalTx = float64(totalTx) / 1073741824

	var peers []WGPeer
	for _, p := range peersMap { peers = append(peers, *p) }
	sort.Slice(peers, func(i, j int) bool {
		o := map[string]int{"online": 0, "idle": 1, "offline": 2}
		if peers[i].State != peers[j].State { return o[peers[i].State] < o[peers[j].State] }
		return peers[i].Name < peers[j].Name
	})

	jsonOK(w, map[string]any{"interface": wgi, "peers": peers, "ifaces": ifaces})
}

func (s *Server) handleVPNWireguardCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Interface  string `json:"interface"`
		PrivateKey string `json:"private_key"`
		Address    string `json:"address"`
		ListenPort string `json:"listen_port"`
		DNS        string `json:"dns"`
		MTU        int    `json:"mtu"`
		NatIface   string `json:"nat_iface"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Interface == "" { req.Interface = "wg0" }
	if req.MTU == 0 { req.MTU = 1420 }

	// Auto-wykryj interfejs wyjściowy jeśli nie podano
	natIface := req.NatIface
	if natIface == "" {
		if out, err := runCmd("bash", "-c", "ip route show default | awk '/default/{print $5}' | head -1"); err == nil {
			if s := strings.TrimSpace(out); s != "" { natIface = s }
		}
	}
	if natIface == "" { natIface = "eth0" }

	cfg := fmt.Sprintf("[Interface]\nPrivateKey = %s\nAddress = %s\nListenPort = %s\nMTU = %d\n",
		req.PrivateKey, req.Address, req.ListenPort, req.MTU)
	if req.DNS != "" { cfg += "DNS = " + req.DNS + "\n" }
	// NAT + forward + MSS clamping (stabilność TCP) + bufory (przepustowość)
	cfg += fmt.Sprintf(
		"PostUp = iptables -A FORWARD -i %%i -j ACCEPT; iptables -A FORWARD -o %%i -j ACCEPT; "+
			"iptables -t nat -A POSTROUTING -o %s -j MASQUERADE; "+
			"iptables -t mangle -A FORWARD -o %%i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu; "+
			"sysctl -q net.core.rmem_max=134217728; sysctl -q net.core.wmem_max=134217728\n", natIface)
	cfg += fmt.Sprintf(
		"PostDown = iptables -D FORWARD -i %%i -j ACCEPT; iptables -D FORWARD -o %%i -j ACCEPT; "+
			"iptables -t nat -D POSTROUTING -o %s -j MASQUERADE; "+
			"iptables -t mangle -D FORWARD -o %%i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu\n", natIface)

	// Włącz IP forwarding trwale
	os.WriteFile("/proc/sys/net/ipv4/ip_forward", []byte("1"), 0644)
	runCmd("bash", "-c", "grep -q ip_forward /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf")

	path := "/etc/wireguard/" + req.Interface + ".conf"
	if err := os.WriteFile(path, []byte(cfg), 0600); err != nil { jsonErr(w, err.Error(), 500); return }
	jsonOK(w, map[string]string{"status": "ok", "path": path})
}

// ─── VPN server config (endpoint itp.) ────────────────────────────────────────

const vpnCfgPath = "/etc/nimbus/vpn-server.json"

type VPNServerConfig struct {
	Endpoint string `json:"endpoint"` // np. "1.2.3.4:51820" lub "vpn.firma.pl:51820"
}

func loadVPNServerConfig() VPNServerConfig {
	data, err := os.ReadFile(vpnCfgPath)
	if err != nil { return VPNServerConfig{} }
	var c VPNServerConfig
	json.Unmarshal(data, &c)
	return c
}

func saveVPNServerConfig(c VPNServerConfig) {
	os.MkdirAll("/etc/nimbus", 0755)
	data, _ := json.MarshalIndent(c, "", "  ")
	os.WriteFile(vpnCfgPath, data, 0600)
}

func resolveEndpoint(iface string) string {
	// 1. Env nadpisuje wszystko
	if env := os.Getenv("WG_ENDPOINT"); env != "" { return env }
	// 2. Zapisana konfiguracja
	if cfg := loadVPNServerConfig(); cfg.Endpoint != "" { return cfg.Endpoint }
	// 3. Wykryj publiczne IP automatycznie
	if ip, err := runCmd("bash", "-c", "curl -sf --max-time 3 https://api.ipify.org"); err == nil {
		ip = strings.TrimSpace(ip)
		if ip != "" {
			wgi := parseWGConf(iface)
			port := 51820
			if wgi.ListenPort != 0 { port = wgi.ListenPort }
			return fmt.Sprintf("%s:%d", ip, port)
		}
	}
	// 4. Fallback — hostname serwera
	if hn, err := os.Hostname(); err == nil && hn != "" {
		wgi := parseWGConf(iface)
		port := 51820
		if wgi.ListenPort != 0 { port = wgi.ListenPort }
		return fmt.Sprintf("%s:%d", hn, port)
	}
	return ""
}

func (s *Server) handleVPNWireguardIface(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/wireguard/")
	parts := strings.SplitN(suffix, "/", 2)
	iface := parts[0]; action := ""
	if len(parts) > 1 { action = parts[1] }
	switch action {
	case "up", "start":
		// Sprawdź czy już działa
		if isWGIfaceUp(iface) {
			jsonOK(w, map[string]any{"status": "ok", "output": iface + " już działa"})
			return
		}
		cmd := exec.Command("wg-quick", "up", iface)
		out, err := cmd.CombinedOutput()
		if err != nil {
			jsonErr(w, strings.TrimSpace(string(out)), 500); return
		}
		jsonOK(w, map[string]any{"status": "ok", "output": strings.TrimSpace(string(out))})
	case "down", "stop":
		cmd := exec.Command("wg-quick", "down", iface)
		out, err := cmd.CombinedOutput()
		if err != nil {
			jsonErr(w, strings.TrimSpace(string(out)), 500); return
		}
		jsonOK(w, map[string]any{"status": "ok", "output": strings.TrimSpace(string(out))})
	case "restart":
		exec.Command("wg-quick", "down", iface).CombinedOutput()
		cmd := exec.Command("wg-quick", "up", iface)
		out, _ := cmd.CombinedOutput()
		jsonOK(w, map[string]any{"status": "ok", "output": strings.TrimSpace(string(out))})
	case "backup":
		data, err := os.ReadFile("/etc/wireguard/" + iface + ".conf")
		if err != nil { jsonErr(w, err.Error(), 500); return }
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+iface+`.conf"`)
		w.Write(data)
	case "logs":
		out, _ := runCmd("journalctl", "-u", "wg-quick@"+iface, "-n", "100", "--no-pager", "--output=short-iso")
		jsonOK(w, map[string]any{"logs": strings.Split(out, "\n")})
	case "config":
		if r.Method == http.MethodGet {
			cfg := loadVPNServerConfig()
			// Jeśli nie ustawiony ręcznie — pokaż aktualnie wykryty
			if cfg.Endpoint == "" { cfg.Endpoint = resolveEndpoint(iface) }
			jsonOK(w, cfg)
			return
		}
		// PATCH / POST — zapisz nowe ustawienia
		var req VPNServerConfig
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "invalid json", 400); return
		}
		req.Endpoint = strings.TrimSpace(req.Endpoint)
		saveVPNServerConfig(req)
		jsonOK(w, map[string]string{"status": "ok", "endpoint": req.Endpoint})
	default:
		out, _ := runCmd("wg", "show", iface)
		jsonOK(w, map[string]any{"interface": iface, "status": out})
	}
}

func (s *Server) handleVPNConnections(w http.ResponseWriter, r *http.Request) {
	peers := parseWGDumpPeers()
	var conns []map[string]any
	for _, p := range peers {
		state, hs := handshakeState(p["handshake"])
		conns = append(conns, map[string]any{"type": "wireguard", "iface": p["iface"], "peer": p["pubkey"],
			"endpoint": p["endpoint"], "allowed": p["allowed"], "handshake": hs, "state": state})
	}
	jsonOK(w, map[string]any{"connections": conns})
}

func (s *Server) handleVPNStatistics(w http.ResponseWriter, r *http.Request) {
	peers := parseWGDumpPeers()
	var rx, tx int64
	for _, p := range peers {
		r2, _ := strconv.ParseInt(p["rx"], 10, 64); rx += r2
		t2, _ := strconv.ParseInt(p["tx"], 10, 64); tx += t2
	}
	jsonOK(w, map[string]any{"total_rx_gb": float64(rx) / 1073741824, "total_tx_gb": float64(tx) / 1073741824, "peer_count": len(peers)})
}

func (s *Server) handleVPNLogs(w http.ResponseWriter, r *http.Request) {
	svc := pathSuffix(r, "/api/vpn/logs/")
	if svc == "" { svc = "wg-quick@wg0" }
	out, _ := runCmd("journalctl", "-u", svc, "-n", "100", "--no-pager", "--output=short-iso")
	jsonOK(w, map[string]any{"service": svc, "logs": strings.Split(out, "\n")})
}

func (s *Server) handleVPNWGGenKeys(w http.ResponseWriter, r *http.Request) {
	priv, err := runCmd("wg", "genkey")
	if err != nil { jsonErr(w, "wg not installed: "+err.Error(), 500); return }
	priv = strings.TrimSpace(priv)
	pub, _ := runCmd("bash", "-c", "printf '%s' '"+priv+"' | wg pubkey")
	psk, _ := runCmd("wg", "genpsk")
	jsonOK(w, map[string]string{"private_key": priv, "public_key": strings.TrimSpace(pub), "preshared_key": strings.TrimSpace(psk)})
}

func (s *Server) handleVPNPeerCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Iface      string  `json:"iface"`
		Name       string  `json:"name"`
		Device     string  `json:"device"`
		AllowedIPs string  `json:"allowed_ips"`
		IP         string  `json:"ip"`
		Location   string  `json:"location"`
		Country    string  `json:"country"`
		Lat        float64 `json:"lat"`
		Lon        float64 `json:"lon"`
		Endpoint   string  `json:"endpoint"`
		DNS        string  `json:"dns"`
		PersistKA  int     `json:"keepalive"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Iface == "" { req.Iface = "wg0" }
	if req.AllowedIPs == "" { req.AllowedIPs = "0.0.0.0/0" }
	if req.PersistKA == 0 { req.PersistKA = 25 }

	wgi := parseWGConf(req.Iface)
	if req.DNS == "" { if wgi.DNS != "" { req.DNS = wgi.DNS } else { req.DNS = "1.1.1.1" } }

	priv, err := runCmd("wg", "genkey")
	if err != nil { jsonErr(w, "wg not installed", 500); return }
	priv = strings.TrimSpace(priv)
	pub, _ := runCmd("bash", "-c", "printf '%s' '"+priv+"' | wg pubkey")
	pub = strings.TrimSpace(pub)
	psk, _ := runCmd("wg", "genpsk")
	psk = strings.TrimSpace(psk)

	peerIP := req.IP
	if peerIP == "" { peerIP = nextPeerIP(req.Iface) }

	// Dodaj peer live
	cmd := exec.Command("wg", "set", req.Iface, "peer", pub, "allowed-ips", peerIP+"/32", "preshared-key", "/dev/stdin")
	cmd.Stdin = strings.NewReader(psk + "\n")
	cmd.Run()

	// Dołącz do conf
	peerBlock := "\n[Peer]\n# " + req.Name + "\nPublicKey = " + pub + "\nPresharedKey = " + psk + "\nAllowedIPs = " + peerIP + "/32\n"
	if req.Endpoint != "" { peerBlock += "Endpoint = " + req.Endpoint + "\n" }
	confPath := "/etc/wireguard/" + req.Iface + ".conf"
	f, err := os.OpenFile(confPath, os.O_APPEND|os.O_WRONLY, 0600)
	if err == nil { f.WriteString(peerBlock); f.Close() }

	// Metadane
	id := "peer-" + randomHex(4)
	meta := loadVPNMeta()
	meta = append(meta, PeerMeta{ID: id, PublicKey: pub, Name: req.Name, Device: req.Device,
		Location: req.Location, Country: req.Country, Lat: req.Lat, Lon: req.Lon,
		CreatedAt: time.Now().Format("2006-01-02")})
	saveVPNMeta(meta)

	// Config klienta
	endpoint := resolveEndpoint(req.Iface)
	dns := req.DNS
	if dns == "" { dns = wgi.DNS }
	if dns == "" { dns = "1.1.1.1" }

	// MTU klienta: dla full tunnel (0.0.0.0/0) użyj 1420, dla split tunnel można większe
	clientMTU := 1420
	if req.AllowedIPs != "0.0.0.0/0" && req.AllowedIPs != "0.0.0.0/0,::/0" {
		clientMTU = 1420 // i tak bezpieczne
	}

	clientConf := fmt.Sprintf(
		"[Interface]\nPrivateKey = %s\nAddress = %s/32\nDNS = %s\nMTU = %d\n\n"+
			"[Peer]\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = %s\nEndpoint = %s\nPersistentKeepalive = %d\n",
		priv, peerIP, dns, clientMTU,
		wgi.PublicKey, psk, req.AllowedIPs, endpoint, req.PersistKA)

	// Zapisz conf klienta na dysk (potrzebne do QR i ponownego pobrania)
	os.MkdirAll("/etc/nimbus/vpn-client-confs", 0700)
	os.WriteFile("/etc/nimbus/vpn-client-confs/"+id+".conf", []byte(clientConf), 0600)

	jsonOK(w, map[string]any{"id": id, "public_key": pub, "private_key": priv, "ip": peerIP, "conf": clientConf, "name": req.Name})
}

func (s *Server) handleVPNPeerDelete(w http.ResponseWriter, r *http.Request) {
	pub := pathSuffix(r, "/api/vpn/peers/")
	iface := r.URL.Query().Get("iface")
	if iface == "" { iface = "wg0" }
	runCmd("wg", "set", iface, "peer", pub, "remove")
	removeFromConf(iface, pub)
	meta := loadVPNMeta()
	newMeta := meta[:0]
	for _, m := range meta { if m.PublicKey != pub && m.ID != pub { newMeta = append(newMeta, m) } }
	saveVPNMeta(newMeta)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleVPNPeerUpdate(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/vpn/peers/")
	var req struct {
		Name     string  `json:"name"`
		Device   string  `json:"device"`
		Location string  `json:"location"`
		Country  string  `json:"country"`
		Lat      float64 `json:"lat"`
		Lon      float64 `json:"lon"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	meta := loadVPNMeta()
	for i := range meta {
		if meta[i].ID == id || meta[i].PublicKey == id {
			if req.Name != "" { meta[i].Name = req.Name }
			if req.Device != "" { meta[i].Device = req.Device }
			if req.Location != "" { meta[i].Location = req.Location }
			if req.Country != "" { meta[i].Country = req.Country }
			if req.Lat != 0 { meta[i].Lat = req.Lat }
			if req.Lon != 0 { meta[i].Lon = req.Lon }
			saveVPNMeta(meta)
			jsonOK(w, map[string]string{"status": "ok"}); return
		}
	}
	jsonErr(w, "peer not found", 404)
}

func (s *Server) handleVPNPeerConf(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/peers/")
	id := strings.Split(suffix, "/")[0]
	meta := loadVPNMeta()
	var pm *PeerMeta
	for i := range meta { if meta[i].ID == id || meta[i].PublicKey == id { pm = &meta[i]; break } }
	if pm == nil { jsonErr(w, "peer not found", 404); return }

	// Czytaj zapisany conf klienta (zawiera klucz prywatny)
	conf, err := os.ReadFile("/etc/nimbus/vpn-client-confs/" + pm.ID + ".conf")
	if err != nil {
		// Fallback: wyciągnij blok [Peer] z pliku serwera (brak klucza prywatnego)
		iface := r.URL.Query().Get("iface")
		if iface == "" { iface = "wg0" }
		data, _ := os.ReadFile("/etc/wireguard/" + iface + ".conf")
		block := extractPeerBlock(string(data), pm.PublicKey)
		jsonOK(w, map[string]any{"peer_conf": block, "name": pm.Name, "pubkey": pm.PublicKey, "no_privkey": true})
		return
	}
	jsonOK(w, map[string]any{"conf": string(conf), "name": pm.Name, "pubkey": pm.PublicKey})
}

func (s *Server) handleVPNPeerQR(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/peers/")
	id := strings.Split(suffix, "/")[0]
	iface := r.URL.Query().Get("iface")
	if iface == "" { iface = "wg0" }
	meta := loadVPNMeta()
	var pm *PeerMeta
	for i := range meta { if meta[i].ID == id || meta[i].PublicKey == id { pm = &meta[i]; break } }
	if pm == nil { jsonErr(w, "peer not found", 404); return }

	// Czytaj zapisany conf klienta (zawiera klucz prywatny — to właśnie skanuje aplikacja)
	var conf string
	if data, err := os.ReadFile("/etc/nimbus/vpn-client-confs/" + pm.ID + ".conf"); err == nil {
		conf = string(data)
	} else {
		// Fallback: blok [Peer] z pliku serwera
		serverData, _ := os.ReadFile("/etc/wireguard/" + iface + ".conf")
		conf = extractPeerBlock(string(serverData), pm.PublicKey)
	}
	if conf == "" { jsonErr(w, "peer config not found", 404); return }

	cmd := exec.Command("qrencode", "-t", "PNG", "-o", "-", "-s", "6")
	cmd.Stdin = strings.NewReader(conf)
	png, err := cmd.Output()
	if err != nil { jsonOK(w, map[string]any{"conf": conf, "qr": nil}); return }
	jsonOK(w, map[string]any{"qr_png_base64": base64.StdEncoding.EncodeToString(png), "conf": conf})
}

func (s *Server) handleVPNOpenVPN(w http.ResponseWriter, r *http.Request) {
	active := serviceActive("openvpn") || serviceActive("openvpn@server")
	cfgs, _ := runCmd("bash", "-c", "ls /etc/openvpn/*.conf /etc/openvpn/server/*.conf 2>/dev/null")
	jsonOK(w, map[string]any{"active": active, "configs": strings.Split(strings.TrimSpace(cfgs), "\n")})
}

func (s *Server) handleVPNOpenVPNItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/openvpn/")
	parts := strings.SplitN(suffix, "/", 2)
	id := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }
	svc := "openvpn@" + id
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
	out, _ := runCmd("ipsec", "status")
	jsonOK(w, map[string]any{"active": serviceActive("strongswan") || serviceActive("ipsec"), "status": out})
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

// ─── Install / detection ───────────────────────────────────────────────────────

func isCommandAvailable(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func isWireGuardInstalled() bool {
	return isCommandAvailable("wg") && isCommandAvailable("wg-quick")
}

func isOpenVPNInstalled() bool {
	return isCommandAvailable("openvpn")
}

func isIPSecInstalled() bool {
	return isCommandAvailable("ipsec") || isCommandAvailable("strongswan")
}

func isWGIfaceUp(iface string) bool {
	// Metoda 1: /sys/class/net/<iface>/operstate — nie wymaga żadnych komend
	if data, err := os.ReadFile("/sys/class/net/" + iface + "/operstate"); err == nil {
		st := strings.TrimSpace(string(data))
		// WireGuard zawsze zwraca "unknown" mimo że działa — samo istnienie pliku = interfejs istnieje
		if st != "" {
			return true
		}
	}
	// Metoda 2: /sys/class/net/<iface> — katalog istnieje = interfejs istnieje
	if _, err := os.Stat("/sys/class/net/" + iface); err == nil {
		return true
	}
	// Metoda 3: wg show interfaces z pełną ścieżką
	for _, wgBin := range []string{"/usr/bin/wg", "/usr/local/bin/wg", "wg"} {
		if out, err := runCmd(wgBin, "show", "interfaces"); err == nil {
			for _, f := range strings.Fields(out) {
				if f == iface {
					return true
				}
			}
			break
		}
	}
	return false
}

func isAnyWGUp() bool {
	// Sprawdź /sys/class/net dla interfejsów wg*
	if entries, err := os.ReadDir("/sys/class/net"); err == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "wg") {
				return true
			}
		}
	}
	return false
}

// handleVPNOverview zwraca stan wszystkich modułów VPN + informację czy są zainstalowane
func (s *Server) handleVPNOverview(w http.ResponseWriter, r *http.Request) {
	wgInstalled   := isWireGuardInstalled()
	ovpnInstalled := isOpenVPNInstalled()
	ipsecInstalled := isIPSecInstalled()

	jsonOK(w, map[string]any{
		"wireguard": map[string]any{
			"installed": wgInstalled,
			"active":    wgInstalled && (isWGIfaceUp("wg0") || isAnyWGUp() || serviceActive("wg-quick@wg0")),
		},
		"openvpn": map[string]any{
			"installed": ovpnInstalled,
			"active":    ovpnInstalled && (serviceActive("openvpn") || serviceActive("openvpn@server")),
		},
		"ipsec": map[string]any{
			"installed": ipsecInstalled,
			"active":    ipsecInstalled && (serviceActive("strongswan") || serviceActive("ipsec")),
		},
	})
}

// ─── Install handlers (per-moduł, wzorem /api/install-webdav) ─────────────────

func vpnAptInstall(packages []string) (string, error) {
	runCmd("apt-get", "update", "-qq")
	args := append([]string{"install", "-y", "--no-install-recommends"}, packages...)
	out, err := runCmd("apt-get", args...)
	return out, err
}

// autoConfigureWireGuard tworzy wg0.conf z kluczami i włącza usługę
func autoConfigureWireGuard() (string, error) {
	const confPath = "/etc/wireguard/wg0.conf"

	// Nie nadpisuj jeśli już istnieje
	if _, err := os.Stat(confPath); err == nil {
		return "wg0.conf już istnieje — pomijam auto-konfigurację", nil
	}

	// Generuj klucze
	priv, err := runCmd("wg", "genkey")
	if err != nil {
		return "", fmt.Errorf("wg genkey: %w", err)
	}
	priv = strings.TrimSpace(priv)
	pub, err := runCmd("bash", "-c", "printf '%s' '"+priv+"' | wg pubkey")
	if err != nil {
		return "", fmt.Errorf("wg pubkey: %w", err)
	}

	// Wykryj domyślny interfejs wyjściowy
	natIface := "eth0"
	if out, err := runCmd("bash", "-c", "ip route show default | awk '/default/{print $5}' | head -1"); err == nil {
		if s := strings.TrimSpace(out); s != "" {
			natIface = s
		}
	}

	cfg := fmt.Sprintf(
		"[Interface]\nPrivateKey = %s\nAddress = 10.8.0.1/24\nListenPort = 51820\nMTU = 1420\n"+
			// NAT + forward
			"PostUp = iptables -A FORWARD -i %%i -j ACCEPT; "+
			"iptables -A FORWARD -o %%i -j ACCEPT; "+
			"iptables -t nat -A POSTROUTING -o %s -j MASQUERADE; "+
			// MSS clamping — zapobiega fragmentacji TCP przez tunel
			"iptables -t mangle -A FORWARD -o %%i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu; "+
			// Bufory sieciowe — lepsza przepustowość
			"sysctl -q net.core.rmem_max=134217728; sysctl -q net.core.wmem_max=134217728\n"+
			"PostDown = iptables -D FORWARD -i %%i -j ACCEPT; "+
			"iptables -D FORWARD -o %%i -j ACCEPT; "+
			"iptables -t nat -D POSTROUTING -o %s -j MASQUERADE; "+
			"iptables -t mangle -D FORWARD -o %%i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu\n",
		priv, natIface, natIface,
	)

	os.MkdirAll("/etc/wireguard", 0700)
	if err := os.WriteFile(confPath, []byte(cfg), 0600); err != nil {
		return "", fmt.Errorf("zapis wg0.conf: %w", err)
	}

	// Włącz IP forwarding
	runCmd("bash", "-c", "echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf && sysctl -p")

	// Uruchom i włącz autostart
	runCmd("systemctl", "enable", "wg-quick@wg0")
	out, err := runCmd("wg-quick", "up", "wg0")
	if err != nil {
		return fmt.Sprintf("wg0.conf utworzony (pubkey: %s), ale wg-quick up wg0 zwrócił błąd: %s", strings.TrimSpace(pub), out), nil
	}
	return fmt.Sprintf("wg0.conf utworzony · pubkey: %s · interfejs uruchomiony", strings.TrimSpace(pub)), nil
}

func (s *Server) handleVPNInstallWireGuard(w http.ResponseWriter, r *http.Request) {
	// qrencode potrzebne do QR kodów peerów
	pkgs := []string{"wireguard", "wireguard-tools", "qrencode"}
	out, err := vpnAptInstall(pkgs)
	if err != nil {
		jsonErr(w, "install failed: "+err.Error(), 500)
		return
	}

	// Auto-konfiguracja wg0
	cfgMsg, cfgErr := autoConfigureWireGuard()
	if cfgErr != nil {
		// Instalacja OK, ale konfiguracja nie wyszła — zwróć ostrzeżenie
		jsonOK(w, map[string]any{
			"status":   "ok",
			"packages": pkgs,
			"output":   out,
			"warning":  "Auto-konfiguracja wg0 nie powiodła się: " + cfgErr.Error(),
		})
		return
	}

	jsonOK(w, map[string]any{
		"status":   "ok",
		"packages": pkgs,
		"output":   out,
		"config":   cfgMsg,
	})
}

func (s *Server) handleVPNInstallOpenVPN(w http.ResponseWriter, r *http.Request) {
	pkgs := []string{"openvpn", "easy-rsa"}
	out, err := vpnAptInstall(pkgs)
	if err != nil {
		jsonErr(w, "install failed: "+err.Error(), 500)
		return
	}
	// Włącz usługę (nie startuj — brak konfiguracji bez setup PKI)
	runCmd("systemctl", "enable", "openvpn")
	jsonOK(w, map[string]any{"status": "ok", "packages": pkgs, "output": out})
}

func (s *Server) handleVPNInstallIPSec(w http.ResponseWriter, r *http.Request) {
	pkgs := []string{"strongswan", "strongswan-pki", "libcharon-extra-plugins"}
	out, err := vpnAptInstall(pkgs)
	if err != nil {
		jsonErr(w, "install failed: "+err.Error(), 500)
		return
	}
	// Włącz i uruchom strongSwan
	runCmd("systemctl", "enable", "strongswan-starter")
	runCmd("systemctl", "start",  "strongswan-starter")
	jsonOK(w, map[string]any{"status": "ok", "packages": pkgs, "output": out})
}

// handleVPNPeerRouter routes /api/vpn/peers/{id}[/action]
func (s *Server) handleVPNPeerRouter(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/vpn/peers/")
	parts := strings.SplitN(suffix, "/", 2)
	action := ""
	if len(parts) > 1 { action = parts[1] }

	switch {
	case action == "conf":
		s.handleVPNPeerConf(w, r)
	case action == "qr":
		s.handleVPNPeerQR(w, r)
	case r.Method == http.MethodDelete:
		s.handleVPNPeerDelete(w, r)
	case r.Method == http.MethodPatch || r.Method == http.MethodPut:
		s.handleVPNPeerUpdate(w, r)
	default:
		jsonErr(w, "not found", http.StatusNotFound)
	}
}
