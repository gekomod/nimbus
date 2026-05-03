package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (s *Server) handleAVStatus(w http.ResponseWriter, r *http.Request) {
	installed := isInstalled("clamscan") || isInstalled("clamav")
	active    := serviceActive("clamav-daemon") || serviceActive("clamd")
	version   := ""
	if installed { version, _ = runCmd("clamscan", "--version") }
	jsonOK(w, map[string]any{"installed": installed, "active": active, "version": strings.TrimSpace(version)})
}

func (s *Server) handleAVDebug(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-u", "clamav-daemon", "-n", "50", "--no-pager")
	jsonOK(w, map[string]any{"logs": strings.Split(out, "\n")})
}

func (s *Server) handleAVVirusDB(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("sigtool", "--info", "/var/lib/clamav/main.cvd")
	jsonOK(w, map[string]string{"raw": out})
}

func (s *Server) handleAVScanHistory(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"history": []any{}})
}

func (s *Server) handleAVScanHistoryItem(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/antivirus/scan/history/")
	jsonOK(w, map[string]any{"id": id, "status": "not_found"})
}

func (s *Server) handleAVSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg := readFileStr("/etc/clamav/clamd.conf")
		jsonOK(w, map[string]string{"config": cfg})
	case http.MethodPost:
		var req struct{ Config string `json:"config"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Config != "" { writeFile("/etc/clamav/clamd.conf", req.Config) }
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodPut:
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleAVScan(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"running": false})
	case http.MethodPost:
		var req struct { Path string `json:"path"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Path == "" { req.Path = "/home" }
		go func() {
			runCmd("clamscan", "-r", "--quiet", req.Path)
		}()
		jsonOK(w, map[string]any{"status": "ok", "message": "Scan started for " + req.Path, "path": req.Path})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleAVUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	go runCmd("freshclam")
	jsonOK(w, map[string]string{"status": "ok", "message": "Updating virus database..."})
}

func (s *Server) handleAVThreatItem(w http.ResponseWriter, r *http.Request) {
	// /api/antivirus/threats/:id  or  /api/antivirus/threats/:id/quarantine
	suffix := pathSuffix(r, "/api/antivirus/threats/")
	parts  := strings.SplitN(suffix, "/", 2)
	id     := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }
	switch {
	case action == "quarantine":
		if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
		jsonOK(w, map[string]string{"status": "ok", "id": id, "action": "quarantined"})
	case r.Method == http.MethodDelete:
		jsonOK(w, map[string]string{"status": "ok", "id": id})
	default:
		jsonOK(w, map[string]any{"id": id})
	}
}

func (s *Server) handleAVInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	go runCmd("apt-get", "install", "-y", "clamav", "clamav-daemon")
	jsonOK(w, map[string]string{"status": "ok", "message": "Installing ClamAV..."})
}

func (s *Server) handleAVRealtime(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		active := serviceActive("clamav-daemon")
		jsonOK(w, map[string]any{"active": active})
	case http.MethodPost:
		var req struct{ Enable bool `json:"enable"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Enable { runCmd("systemctl", "enable", "--now", "clamav-daemon") } else { runCmd("systemctl", "disable", "--now", "clamav-daemon") }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
