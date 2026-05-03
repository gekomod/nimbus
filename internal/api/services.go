package api

import (
	"encoding/json"
	"net/http"
)

// ── WebDAV ───────────────────────────────────────────────────────────────────

func (s *Server) handleWebDAVStatus(w http.ResponseWriter, r *http.Request) {
	_, errApache := runCmd("which", "apache2")
	_, errA2 := runCmd("dpkg", "-l", "apache2")
	installed := errApache == nil || errA2 == nil
	active := serviceActive("apache2") || serviceActive("nginx")
	jsonOK(w, map[string]any{"active": active, "installed": installed})
}
func (s *Server) handleWebDAVToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}
func (s *Server) handleWebDAVConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{"config": ""})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
func (s *Server) handleWebDAVDisks(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"disks": []any{}})
}

// ── Load Balancer ─────────────────────────────────────────────────────────────

func (s *Server) handleLBStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"nginx": serviceActive("nginx"), "haproxy": serviceActive("haproxy")})
}
func (s *Server) handleLBConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]string{"config": readFileStr("/etc/nginx/nginx.conf")})
	case http.MethodPost:
		var req struct{ Config string `json:"config"` }
		json.NewDecoder(r.Body).Decode(&req)
		writeFile("/etc/nginx/nginx.conf", req.Config)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
func (s *Server) handleLBTest(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("nginx", "-t")
	jsonOK(w, map[string]any{"ok": err == nil, "output": out})
}
func (s *Server) handleLBApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("nginx", "-s", "reload")
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}
