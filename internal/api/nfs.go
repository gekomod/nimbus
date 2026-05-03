package api

// nfs.go — pełna implementacja API dla NFS (serwer + klient)
// Zastępuje stub-y w services.go dla handlerów NFS.
// Dodaje: parsowanie /etc/exports, showmount, scan sieciowy,
// aktywni klienci (nfsstat + /proc/net/rpc/nfsd), NFS client mounts.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ═══════════════════════════════════════════════════════════════════════════
// Typy
// ═══════════════════════════════════════════════════════════════════════════

type NFSExport struct {
	Path    string   `json:"path"`
	Clients []NFSExportClient `json:"clients"`
	Raw     string   `json:"raw"`
}

type NFSExportClient struct {
	Host string `json:"host"`
	Opts string `json:"opts"`
}

type NFSClientMount struct {
	Server     string `json:"server"`
	Export     string `json:"export"`
	MountPoint string `json:"mountpoint"`
	Opts       string `json:"opts"`
	FSType     string `json:"fstype"`
}

type NFSScanResult struct {
	IP       string   `json:"ip"`
	Hostname string   `json:"hostname"`
	Exports  []string `json:"exports"`
	Latency  int      `json:"latency_ms"`
}

type NFSActiveClient struct {
	IP     string `json:"ip"`
	Export string `json:"export"`
	Since  string `json:"since"`
	Read   string `json:"read"`
	Write  string `json:"write"`
}

// ═══════════════════════════════════════════════════════════════════════════
// Parser /etc/exports
// ═══════════════════════════════════════════════════════════════════════════

// parseExportsFile parsuje /etc/exports → []NFSExport
// Format: /path  host1(opts) host2(opts)
func parseExportsFile(content string) []NFSExport {
	var exports []NFSExport
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Obsłuż kontynuację linii przez "\"
		for strings.HasSuffix(line, "\\") {
			line = strings.TrimSuffix(line, "\\")
			if scanner.Scan() {
				line += " " + strings.TrimSpace(scanner.Text())
			}
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		exp := NFSExport{Path: fields[0], Raw: line}
		for _, f := range fields[1:] {
			// Może być: host(opts) lub host
			paren := strings.Index(f, "(")
			if paren >= 0 {
				host := f[:paren]
				opts := strings.Trim(f[paren:], "()")
				exp.Clients = append(exp.Clients, NFSExportClient{Host: host, Opts: opts})
			} else {
				exp.Clients = append(exp.Clients, NFSExportClient{Host: f, Opts: "ro"})
			}
		}
		exports = append(exports, exp)
	}
	return exports
}

// buildExportsLine buduje linię /etc/exports z klientów
func buildExportsLine(path string, clients []NFSExportClient) string {
	var b strings.Builder
	b.WriteString(path)
	for _, c := range clients {
		b.WriteString("\t")
		b.WriteString(c.Host)
		if c.Opts != "" {
			b.WriteString("(")
			b.WriteString(c.Opts)
			b.WriteString(")")
		}
	}
	return b.String()
}

// ═══════════════════════════════════════════════════════════════════════════
// NFS SERVER
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/nfs-server/status

func nfsSvc() string {
	if serviceActive("nfs-kernel-server") || serviceEnabled("nfs-kernel-server") {
		return "nfs-kernel-server"
	}
	return "nfs-server"
}

func (s *Server) handleNFSServerStatus(w http.ResponseWriter, r *http.Request) {
	svc := nfsSvc()
	_, err := exec.LookPath("exportfs")
    installed := (err == nil)
	active := serviceActive(svc)

	// Wersja NFS z /proc/fs/nfsd/versions
	version := "v4"
	if data, err := os.ReadFile("/proc/fs/nfsd/versions"); err == nil {
		version = strings.TrimSpace(string(data))
	}

	// Liczba wątków z /proc/fs/nfsd/threads
	threads := 8
	if data, err := os.ReadFile("/proc/fs/nfsd/threads"); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil {
			threads = n
		}
	}

	// Domena NFSv4 z /etc/idmapd.conf
	domain := "localdomain"
	if data, err := os.ReadFile("/etc/idmapd.conf"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Domain") || strings.HasPrefix(line, "domain") {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					domain = strings.TrimSpace(parts[1])
				}
			}
		}
	}

	// Eksporty
	content := readFileStr("/etc/exports")
	exports := parseExportsFile(content)

	// Aktywni klienci — nfsstat -m lub showmount --no-headers -a
	clientCount := 0
	clientsOut, _ := runCmd("showmount", "--no-headers", "-a")
	if clientsOut != "" {
		lines := strings.Split(strings.TrimSpace(clientsOut), "\n")
		for _, l := range lines {
			if strings.TrimSpace(l) != "" {
				clientCount++
			}
		}
	}

	jsonOK(w, map[string]any{
		"active":        active,
		"installed":     installed,
		"enabled":       serviceEnabled(svc),
		"service":       svc,
		"version":       version,
		"threads":       threads,
		"domain":        domain,
		"export_count":  len(exports),
		"client_count":  clientCount,
		"port":          2049,
	})
}

// POST /api/nfs-server/toggle
func (s *Server) handleNFSServerToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Enable bool `json:"enable"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	svc := nfsSvc()
	if req.Enable {
		runCmd("systemctl", "enable", "--now", svc)
	} else {
		runCmd("systemctl", "disable", "--now", svc)
	}
	jsonOK(w, map[string]any{
		"status": "ok",
		"active": serviceActive(svc),
	})
}

// GET  /api/nfs-server/exports  — lista sparsowanych eksportów
// POST /api/nfs-server/exports  — dodaj eksport (path + clients JSON)
func (s *Server) handleNFSServerExports(w http.ResponseWriter, r *http.Request) {
	switch r.Method {

	case http.MethodGet:
		content := readFileStr("/etc/exports")
		exports := parseExportsFile(content)
		// Zlicz aktywnych klientów per ścieżka
		activeMap := nfsActivePerPath()
		// Zbuduj odpowiedź
		type ExportResp struct {
			Path    string           `json:"path"`
			Clients []NFSExportClient `json:"clients"`
			Active  int              `json:"active"`
			Raw     string           `json:"raw"`
		}
		out := make([]ExportResp, 0, len(exports))
		for _, e := range exports {
			out = append(out, ExportResp{
				Path:    e.Path,
				Clients: e.Clients,
				Active:  activeMap[e.Path],
				Raw:     e.Raw,
			})
		}
		jsonOK(w, map[string]any{
			"exports":  out,
			"raw_file": content,
		})

	case http.MethodPost:
		var req struct {
			Path    string           `json:"path"`
			Clients []NFSExportClient `json:"clients"`
			// Alternatywnie — stary format
			Options string           `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
			jsonErr(w, "brak path", http.StatusBadRequest)
			return
		}
		cur := readFileStr("/etc/exports")
		var line string
		if len(req.Clients) > 0 {
			line = buildExportsLine(req.Path, req.Clients)
		} else {
			// Stary format — path + options jako "host(opts)"
			line = req.Path + "\t" + req.Options
		}
		writeFile("/etc/exports", strings.TrimRight(cur, "\n")+"\n"+line+"\n")
		runCmd("exportfs", "-ra")
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// alias
func (s *Server) handleNFSServerExportAdd(w http.ResponseWriter, r *http.Request) {
	s.handleNFSServerExports(w, r)
}

// /api/nfs-server/exports/{path...}  DELETE = usuń, PUT = edytuj
func (s *Server) handleNFSServerExportItem(w http.ResponseWriter, r *http.Request) {
	rawPath := strings.TrimPrefix(pathSuffix(r, "/api/nfs-server/exports/"), "/")
	exportPath := "/" + rawPath // np. "mnt/tank/media" → "/mnt/tank/media"

	content := readFileStr("/etc/exports")
	exports := parseExportsFile(content)

	switch r.Method {
	case http.MethodDelete:
		// Usuń linię z tym exportem
		var newLines []string
		for _, line := range strings.Split(content, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				newLines = append(newLines, line)
				continue
			}
			fields := strings.Fields(trimmed)
			if len(fields) > 0 && fields[0] == exportPath {
				continue // pomiń
			}
			newLines = append(newLines, line)
		}
		writeFile("/etc/exports", strings.Join(newLines, "\n"))
		runCmd("exportfs", "-ra")
		jsonOK(w, map[string]string{"status": "ok"})

	case http.MethodPut:
		var req struct {
			Path    string           `json:"path"`
			Clients []NFSExportClient `json:"clients"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		// Zastąp linię
		var newLines []string
		for _, line := range strings.Split(content, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				newLines = append(newLines, line)
				continue
			}
			fields := strings.Fields(trimmed)
			if len(fields) > 0 && fields[0] == exportPath {
				newTarget := req.Path
				if newTarget == "" {
					newTarget = exportPath
				}
				clients := req.Clients
				if len(clients) == 0 {
					// Zachowaj stare klienty
					for _, e := range exports {
						if e.Path == exportPath {
							clients = e.Clients
						}
					}
				}
				newLines = append(newLines, buildExportsLine(newTarget, clients))
				continue
			}
			newLines = append(newLines, line)
		}
		writeFile("/etc/exports", strings.Join(newLines, "\n"))
		runCmd("exportfs", "-ra")
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// GET /api/nfs-server/stats
func (s *Server) handleNFSServerStats(w http.ResponseWriter, r *http.Request) {
	raw, _ := runCmd("nfsstat", "-s")

	// Parsuj /proc/net/rpc/nfsd dla liczb
	stats := map[string]any{"raw": raw}
	if data, err := os.ReadFile("/proc/net/rpc/nfsd"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			switch fields[0] {
			case "rc":
				// cache hits/misses
				if len(fields) >= 4 {
					stats["cache_hits"], _   = strconv.Atoi(fields[1])
					stats["cache_misses"], _ = strconv.Atoi(fields[2])
				}
			case "io":
				// bytes read/written
				if len(fields) >= 3 {
					stats["bytes_read"], _    = strconv.ParseInt(fields[1], 10, 64)
					stats["bytes_written"], _ = strconv.ParseInt(fields[2], 10, 64)
				}
			case "net":
				if len(fields) >= 3 {
					stats["tcp_conn"], _ = strconv.Atoi(fields[2])
				}
			}
		}
	}
	jsonOK(w, stats)
}

// GET /api/nfs-server/logs
func (s *Server) handleNFSServerLogs(w http.ResponseWriter, r *http.Request) {
	n := "50"
	if v := r.URL.Query().Get("n"); v != "" {
		n = v
	}
	out, _ := runCmd("journalctl", "-u", nfsSvc(), "-n", n, "--no-pager", "--output=short-iso")
	jsonOK(w, map[string]any{
		"logs": strings.Split(strings.TrimSuffix(out, "\n"), "\n"),
	})
}

// GET /api/nfs-server/test  — exportfs -v
func (s *Server) handleNFSServerTest(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("exportfs", "-v")
	jsonOK(w, map[string]any{"ok": err == nil, "output": out})
}

// GET /api/nfs-server/clients — aktywni klienci
func (s *Server) handleNFSServerClients(w http.ResponseWriter, r *http.Request) {
	var clients []NFSActiveClient

	// showmount --no-headers -a  →  "ip:/path"
	out, _ := runCmd("showmount", "--no-headers", "-a")
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: ip:/export  lub  ip:export
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		ip := line[:colonIdx]
		export := line[colonIdx+1:]
		if !strings.HasPrefix(export, "/") {
			export = "/" + export
		}
		clients = append(clients, NFSActiveClient{
			IP:     ip,
			Export: export,
			Since:  "—",
			Read:   "—",
			Write:  "—",
		})
	}

	// Spróbuj wzbogacić danymi z nfsstat
	nfstatOut, _ := runCmd("nfsstat", "-c")
	_ = nfstatOut // szczegóły per-klient niedostępne w standardowym nfsstat

	jsonOK(w, map[string]any{
		"clients": func() []NFSActiveClient {
			if clients == nil {
				return []NFSActiveClient{}
			}
			return clients
		}(),
		"count": len(clients),
	})
}

// Pomocnicza — zwraca mapę export_path → liczba aktywnych klientów
func nfsActivePerPath() map[string]int {
	m := make(map[string]int)
	out, _ := runCmd("showmount", "--no-headers", "-a")
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		export := line[colonIdx+1:]
		if !strings.HasPrefix(export, "/") {
			export = "/" + export
		}
		m[export]++
	}
	return m
}

// ═══════════════════════════════════════════════════════════════════════════
// NFS SERVER — konfiguracja /etc/nfs.conf lub /etc/default/nfs-kernel-server
// ═══════════════════════════════════════════════════════════════════════════

// GET/POST /api/nfs-server/config
func (s *Server) handleNFSServerConfig(w http.ResponseWriter, r *http.Request) {
	// Spróbuj /etc/nfs.conf (nowoczesny) lub /etc/default/nfs-kernel-server
	cfgPath := "/etc/nfs.conf"
	if _, err := os.Stat(cfgPath); err != nil {
		cfgPath = "/etc/default/nfs-kernel-server"
	}

	if r.Method == http.MethodGet {
		content := readFileStr(cfgPath)

		// Parsuj kluczowe opcje
		cfg := map[string]any{
			"v3":      true,
			"v4":      true,
			"v4_1":    true,
			"v4_2":    true,
			"udp":     false,
			"tcp":     true,
			"threads": 8,
			"domain":  "localdomain",
		}

		for _, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") || line == "" {
				continue
			}
			if kv := strings.SplitN(line, "=", 2); len(kv) == 2 {
				key := strings.TrimSpace(kv[0])
				val := strings.TrimSpace(kv[1])
				switch key {
				case "RPCNFSDCOUNT", "threads":
					if n, err := strconv.Atoi(val); err == nil {
						cfg["threads"] = n
					}
				case "vers3":
					cfg["v3"] = val == "y" || val == "yes" || val == "1"
				case "vers4":
					cfg["v4"] = val == "y" || val == "yes" || val == "1"
				case "vers4.1":
					cfg["v4_1"] = val == "y" || val == "yes" || val == "1"
				case "vers4.2":
					cfg["v4_2"] = val == "y" || val == "yes" || val == "1"
				case "udp":
					cfg["udp"] = val == "y" || val == "yes" || val == "1"
				}
			}
		}

		// Domena z idmapd.conf
		if data, err := os.ReadFile("/etc/idmapd.conf"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "Domain") {
					if parts := strings.SplitN(line, "=", 2); len(parts) == 2 {
						cfg["domain"] = strings.TrimSpace(parts[1])
					}
				}
			}
		}

		jsonOK(w, map[string]any{"config": cfg, "file": cfgPath, "raw": content})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			V3      *bool  `json:"v3"`
			V4      *bool  `json:"v4"`
			UDP     *bool  `json:"udp"`
			Threads *int   `json:"threads"`
			Domain  string `json:"domain"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		// Zastosuj zmiany do pliku konfiguracyjnego
		content := readFileStr(cfgPath)
		if req.Threads != nil {
			content = replaceOrAppendINI(content, "RPCNFSDCOUNT", strconv.Itoa(*req.Threads))
		}

		writeFile(cfgPath, content)

		// Zmień domenę idmapd
		if req.Domain != "" {
			idmapdPath := "/etc/idmapd.conf"
			idmapd := readFileStr(idmapdPath)
			idmapd = replaceOrAppendINI(idmapd, "Domain", req.Domain)
			writeFile(idmapdPath, idmapd)
			runCmd("systemctl", "restart", "nfs-idmapd")
		}

		// Restart NFS
		runCmd("systemctl", "restart", nfsSvc())
		jsonOK(w, map[string]string{"status": "ok"})
		return
	}

	jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
}

func replaceOrAppendINI(content, key, value string) string {
	lines := strings.Split(content, "\n")
	replaced := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if kv := strings.SplitN(trimmed, "=", 2); len(kv) == 2 {
			if strings.TrimSpace(kv[0]) == key {
				lines[i] = key + "=" + value
				replaced = true
				break
			}
		}
	}
	if !replaced {
		lines = append(lines, key+"="+value)
	}
	return strings.Join(lines, "\n")
}

// ═══════════════════════════════════════════════════════════════════════════
// NFS CLIENT — mounts
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/nfs/mounts — aktualnie zamontowane NFS
func (s *Server) handleNFSMounts(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("mount", "-t", "nfs,nfs4")
	var mounts []NFSClientMount

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: server:/export on /mountpoint type nfs4 (opts)
		// "on" jest rozdzielnikiem
		parts := strings.Split(line, " on ")
		if len(parts) < 2 {
			continue
		}
		serverExport := strings.TrimSpace(parts[0])
		rest := strings.TrimSpace(parts[1])

		// rest: "/mountpoint type nfs4 (opts)"
		restParts := strings.SplitN(rest, " type ", 2)
		mountpoint := strings.TrimSpace(restParts[0])
		fstype := "nfs"
		opts := ""
		if len(restParts) == 2 {
			typeParts := strings.SplitN(restParts[1], " ", 2)
			fstype = typeParts[0]
			if len(typeParts) > 1 {
				opts = strings.Trim(typeParts[1], "()")
			}
		}

		// Rozdziel server:/export
		colonIdx := strings.LastIndex(serverExport, ":")
		server := serverExport
		export := "/"
		if colonIdx >= 0 {
			server = serverExport[:colonIdx]
			export = serverExport[colonIdx+1:]
		}

		mounts = append(mounts, NFSClientMount{
			Server:     server,
			Export:     export,
			MountPoint: mountpoint,
			Opts:       opts,
			FSType:     fstype,
		})
	}

	if mounts == nil {
		mounts = []NFSClientMount{}
	}
	jsonOK(w, map[string]any{"mounts": mounts, "count": len(mounts)})
}

// POST /api/nfs/mount
func (s *Server) handleNFSMount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Server  string `json:"server"`
		Export  string `json:"export"`
		Target  string `json:"target"`
		Options string `json:"options"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Server == "" || req.Export == "" || req.Target == "" {
		jsonErr(w, "server, export i target są wymagane", http.StatusBadRequest)
		return
	}

	// Utwórz punkt montowania jeśli nie istnieje
	if err := os.MkdirAll(req.Target, 0755); err != nil {
		jsonErr(w, "nie można utworzyć punktu montowania: "+err.Error(), http.StatusInternalServerError)
		return
	}

	args := []string{"-t", "nfs"}
	if req.Options != "" {
		args = append(args, "-o", req.Options)
	}
	args = append(args, req.Server+":"+req.Export, req.Target)

	if _, err := runCmd("mount", args...); err != nil {
		jsonErr(w, "mount nieudany: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// POST /api/nfs/umount
func (s *Server) handleNFSUmount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Target string `json:"target"`
		Lazy   bool   `json:"lazy"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Target == "" {
		jsonErr(w, "target wymagany", http.StatusBadRequest)
		return
	}
	args := []string{}
	if req.Lazy {
		args = append(args, "-l")
	}
	args = append(args, req.Target)
	if _, err := runCmd("umount", args...); err != nil {
		jsonErr(w, "umount nieudany: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// ═══════════════════════════════════════════════════════════════════════════
// NFS CLIENT — skanowanie sieci
// ═══════════════════════════════════════════════════════════════════════════

// Globalny stan skanu (jeden na raz)
var (
	scanMu       sync.Mutex
	scanRunning  int32 // atomic
	scanResults  []NFSScanResult
	scanProgress int32 // 0-100
	scanTotal    int32
	scanDone     bool
)

// POST /api/nfs/scan-network-start
func (s *Server) handleNFSScanNetStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if atomic.LoadInt32(&scanRunning) == 1 {
		jsonErr(w, "skan już trwa", http.StatusConflict)
		return
	}

	var req struct {
		Network string `json:"network"` // "192.168.1.0/24"
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Network == "" {
		// Spróbuj wykryć automatycznie z trasy domyślnej
		req.Network = detectLocalNetwork()
	}

	// Parsuj sieć
	_, ipNet, err := net.ParseCIDR(req.Network)
	if err != nil {
		jsonErr(w, "nieprawidłowy zakres sieci: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Zbierz hosty
	hosts := hostsFromCIDR(ipNet)

	scanMu.Lock()
	scanResults  = nil
	scanDone     = false
	atomic.StoreInt32(&scanProgress, 0)
	atomic.StoreInt32(&scanTotal, int32(len(hosts)))
	atomic.StoreInt32(&scanRunning, 1)
	scanMu.Unlock()

	go runNFSScan(hosts)

	jsonOK(w, map[string]any{
		"status":   "started",
		"network":  req.Network,
		"total":    len(hosts),
		"scan_id":  "1",
	})
}

// GET /api/nfs/scan-network-status
func (s *Server) handleNFSScanNetStatus(w http.ResponseWriter, r *http.Request) {
	scanMu.Lock()
	results := append([]NFSScanResult(nil), scanResults...)
	done     := scanDone
	scanMu.Unlock()

	progress := atomic.LoadInt32(&scanProgress)
	total    := atomic.LoadInt32(&scanTotal)

	jsonOK(w, map[string]any{
		"done":     done,
		"running":  atomic.LoadInt32(&scanRunning) == 1,
		"progress": progress,
		"total":    total,
		"found":    len(results),
		"results":  results,
	})
}

// runNFSScan — goroutine skanująca hosty z showmount
func runNFSScan(hosts []string) {
	defer atomic.StoreInt32(&scanRunning, 0)

	total    := len(hosts)
	sem      := make(chan struct{}, 20) // 20 równoległych
	var wg   sync.WaitGroup
	var mu   sync.Mutex
	checked  := int32(0)

	for _, host := range hosts {
		wg.Add(1)
		sem <- struct{}{}
		go func(ip string) {
			defer func() {
				<-sem
				wg.Done()
				n := atomic.AddInt32(&checked, 1)
				atomic.StoreInt32(&scanProgress, int32(float64(n)/float64(total)*100))
			}()

			// Sprawdź czy port 2049 otwarty (timeout 500ms)
			conn, err := net.DialTimeout("tcp", ip+":2049", 500*time.Millisecond)
			if err != nil {
				return
			}
			conn.Close()

			// Port otwarty — spróbuj showmount
			t0 := time.Now()
			out, err := showmountWithTimeout(ip, 3*time.Second)
			latency := int(time.Since(t0).Milliseconds())
			if err != nil || out == "" {
				return
			}

			var exports []string
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "Export") || strings.HasPrefix(line, "Exports") {
					continue
				}
				// Format: "/path  allowed_hosts" lub "/path"
				fields := strings.Fields(line)
				if len(fields) > 0 && strings.HasPrefix(fields[0], "/") {
					exports = append(exports, fields[0])
				}
			}
			if len(exports) == 0 {
				return
			}

			// Resolve hostname
			hostname := ip
			if names, err := net.LookupAddr(ip); err == nil && len(names) > 0 {
				hostname = strings.TrimSuffix(names[0], ".")
			}

			mu.Lock()
			scanResults = append(scanResults, NFSScanResult{
				IP:       ip,
				Hostname: hostname,
				Exports:  exports,
				Latency:  latency,
			})
			mu.Unlock()
		}(host)
	}
	wg.Wait()

	scanMu.Lock()
	scanDone = true
	scanMu.Unlock()
	atomic.StoreInt32(&scanProgress, 100)
}

// showmountWithTimeout — exec showmount z timeout
func showmountWithTimeout(ip string, timeout time.Duration) (string, error) {
	cmd := exec.Command("showmount", "--no-headers", "-e", ip)
	cmd.Env = append(os.Environ(), "RPC_TIMEOUT=3")

	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
		return string(out), err
	case <-time.After(timeout):
		cmd.Process.Kill()
		return "", fmt.Errorf("timeout")
	}
}

// GET /api/nfs/scan-ip/{ip} — showmount dla konkretnego IP
func (s *Server) handleNFSScanIP(w http.ResponseWriter, r *http.Request) {
	ip := pathSuffix(r, "/api/nfs/scan-ip/")
	if ip == "" {
		jsonErr(w, "ip wymagane", http.StatusBadRequest)
		return
	}

	out, err := showmountWithTimeout(ip, 5*time.Second)
	var exports []string
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "Export") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) > 0 && strings.HasPrefix(fields[0], "/") {
				exports = append(exports, fields[0])
			}
		}
	}
	// Deduplikacja
	seen := map[string]bool{}
	unique := exports[:0]
	for _, e := range exports {
		if !seen[e] {
			seen[e] = true
			unique = append(unique, e)
		}
	}

	jsonOK(w, map[string]any{
		"ip":      ip,
		"ok":      err == nil,
		"exports": unique,
		"raw":     out,
	})
}

// GET /api/nfs/exports/{server} — alias dla scan-ip
func (s *Server) handleNFSExports(w http.ResponseWriter, r *http.Request) {
	srv := pathSuffix(r, "/api/nfs/exports/")
	out, err := runCmd("showmount", "-e", srv)
	jsonOK(w, map[string]any{
		"server":  srv,
		"exports": out,
		"ok":      err == nil,
	})
}

func (s *Server) handleNFSServerInstall(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    // Sprawdź czy już zainstalowany
    if _, err := exec.LookPath("exportfs"); err == nil {
        jsonOK(w, map[string]string{"status": "already_installed"})
        return
    }
    
    // Zainstaluj pakiety NFS
    runCmd("apt-get", "update")
    out, err := runCmd("apt-get", "install", "-y", "nfs-kernel-server", "nfs-common", "rpcbind")
    if err != nil {
        jsonErr(w, "Installation failed: "+err.Error(), http.StatusInternalServerError)
        return
    }
    
    // Włącz i uruchom usługi
    runCmd("systemctl", "enable", "nfs-server", "rpcbind")
    runCmd("systemctl", "start", "nfs-server", "rpcbind")
    
    jsonOK(w, map[string]string{
        "status": "ok",
        "output": out,
    })
}

// ─── Pomocnicze ───────────────────────────────────────────────────────────────

func hostsFromCIDR(ipNet *net.IPNet) []string {
	var hosts []string
	for ip := cloneIP(ipNet.IP.Mask(ipNet.Mask)); ipNet.Contains(ip); incrementIP(ip) {
		// Pomiń adres sieci i broadcast
		if ip[len(ip)-1] == 0 || ip[len(ip)-1] == 255 {
			continue
		}
		hosts = append(hosts, ip.String())
	}
	return hosts
}

func cloneIP(ip net.IP) net.IP {
	clone := make(net.IP, len(ip))
	copy(clone, ip)
	return clone
}

func incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			break
		}
	}
}

func detectLocalNetwork() string {
	// Pobierz trasę domyślną i wykryj sieć LAN
	out, err := runCmd("ip", "route")
	if err != nil {
		return "192.168.1.0/24"
	}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		// Szukaj linii z "src" — to interfejs LAN
		if len(fields) >= 3 && fields[1] == "dev" && !strings.HasPrefix(fields[0], "default") {
			// Spróbuj jako CIDR
			if _, _, err := net.ParseCIDR(fields[0]); err == nil {
				return fields[0]
			}
		}
	}
	return "192.168.1.0/24"
}

// GET /api/nfs/role
func (s *Server) handleNFSRole(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{
		"server": serviceActive("nfs-kernel-server") || serviceActive("nfs-server"),
		"client": true,
	})
}

// GET /api/nfs/networks
func (s *Server) handleNFSNetworks(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("ip", "-o", "-4", "route")
	var networks []string
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 && !strings.HasPrefix(fields[0], "default") {
			if _, _, err := net.ParseCIDR(fields[0]); err == nil {
				networks = append(networks, fields[0])
			}
		}
	}
	jsonOK(w, map[string]any{"networks": networks})
}

// GET  /api/nfs/benchmark
func (s *Server) handleNFSBenchmark(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"status": "not_supported"})
}

// GET /api/nfs/discover-start / discover-status (alias scan)
func (s *Server) handleNFSDiscoverStart(w http.ResponseWriter, r *http.Request) {
	s.handleNFSScanNetStart(w, r)
}
func (s *Server) handleNFSDiscoverStatus(w http.ResponseWriter, r *http.Request) {
	s.handleNFSScanNetStatus(w, r)
}
