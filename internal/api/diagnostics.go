package api

import (
	"encoding/json"
	"net/http"
	"nimbus/internal/sys"
	"sort"
	"strings"
)

func (s *Server) handleDiagHealth(w http.ResponseWriter, r *http.Request) {
	m := sys.Memory(); used := m.TotalKB - m.AvailableKB
	cpuPct := round2(sys.CPUPercent()); memPct := round2(float64(used)/float64(m.TotalKB)*100)
	status := "healthy"; if cpuPct > 90 || memPct > 90 { status = "warning" }
	jsonOK(w, map[string]any{"status": status, "cpu_pct": cpuPct, "memory_pct": memPct, "load": sys.LoadAvg()})
}

func (s *Server) handleDiagSystemLogs(w http.ResponseWriter, r *http.Request) {
	n := "200"; if v := r.URL.Query().Get("n"); v != "" { n = v }
	unit := r.URL.Query().Get("unit")
	args := []string{"-n", n, "--no-pager", "--output=short-iso"}
	if unit != "" { args = append(args, "-u", unit) }
	out, _ := runCmd("journalctl", args...)
	jsonOK(w, map[string]any{"lines": strings.Split(out, "\n")})
}

func (s *Server) handleDiagSystemLogFile(w http.ResponseWriter, r *http.Request) {
	logFile := pathSuffix(r, "/api/diagnostics/system-logs/")
	if logFile == "" { logFile = pathSuffix(r, "/diagnostics/system-logs/") }
	n := r.URL.Query().Get("n"); if n == "" { n = "100" }
	out, _ := runCmd("journalctl", "-u", logFile, "-n", n, "--no-pager")
	jsonOK(w, map[string]any{"log": logFile, "lines": strings.Split(out, "\n")})
}

func (s *Server) handleDiagDebugLogs(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-p", "debug", "-n", "100", "--no-pager")
	jsonOK(w, map[string]any{"lines": strings.Split(out, "\n")})
}

func (s *Server) handleDiagCreateTestLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("logger", "-t", "nimbus-test", "Test log entry from Nimbus diagnostics")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDiagSimpleLogs(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-n", "50", "--no-pager", "--output=cat")
	jsonOK(w, map[string]any{"lines": strings.Split(out, "\n")})
}

func (s *Server) handleDiagJournalLogs(w http.ResponseWriter, r *http.Request) {
	n := "100"; if v := r.URL.Query().Get("n"); v != "" { n = v }
	out, _ := runCmd("journalctl", "-n", n, "--no-pager", "--output=short-iso")
	jsonOK(w, map[string]any{"lines": strings.Split(out, "\n")})
}

func (s *Server) handleDiagServiceStatus(w http.ResponseWriter, r *http.Request) {
	svc := pathSuffix(r, "/api/diagnostics/service-status/")
	out, _ := runCmd("systemctl", "status", "--no-pager", svc)
	jsonOK(w, map[string]any{"service": svc, "active": serviceActive(svc), "output": out})
}

func (s *Server) handleDiagServiceControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	svc := pathSuffix(r, "/api/diagnostics/service-control/")
	var req struct{ Action string `json:"action"` }
	json.NewDecoder(r.Body).Decode(&req)
	switch req.Action {
	case "start":   runCmd("systemctl", "start", svc)
	case "stop":    runCmd("systemctl", "stop", svc)
	case "restart": runCmd("systemctl", "restart", svc)
	case "enable":  runCmd("systemctl", "enable", svc)
	case "disable": runCmd("systemctl", "disable", svc)
	}
	jsonOK(w, map[string]any{"service": svc, "active": serviceActive(svc)})
}

func (s *Server) handleDiagExportLogs(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-n", "1000", "--no-pager", "--output=json")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="nimbus-logs.json"`)
	w.Write([]byte(out))
}

func (s *Server) handleDiagNASErrors(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-p", "err", "-n", "50", "--no-pager", "-u", "nimbus*")
	jsonOK(w, map[string]any{"errors": strings.Split(out, "\n")})
}

func (s *Server) handleDiagProcesses(w http.ResponseWriter, r *http.Request) {
	procs := sys.Processes()
	sort.Slice(procs, func(i, j int) bool { return procs[i].CPU > procs[j].CPU })
	if len(procs) > 50 { procs = procs[:50] }
	jsonOK(w, map[string]any{"processes": procs})
}

func (s *Server) handleDiagProcessKill(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { PID string `json:"pid"`; Signal string `json:"signal"` }
	json.NewDecoder(r.Body).Decode(&req)
	sig := req.Signal; if sig == "" { sig = "15" }
	if _, err := runCmd("kill", "-"+sig, req.PID); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDiagRemoteLogs(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"logs": []any{}})
}

func (s *Server) handleDiagRemoteLogsConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDiagRemoteLogItem(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"logs": []any{}})
}
