package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handlePowerAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Action string `json:"action"` }
	json.NewDecoder(r.Body).Decode(&req)
	jsonOK(w, map[string]string{"status": "ok"})
	go func() {
		time.Sleep(500 * time.Millisecond)
		switch req.Action {
		case "poweroff", "shutdown":
			cfg := getStartupConfig()
			if cfg.NotifyShutdown {
				sendStartupNotif("🔴 Serwer NAS — wyłączanie", "Serwer Nimbus zostaje teraz wyłączony.")
				time.Sleep(2 * time.Second)
			}
			saveStartupState()
			runCmd("systemctl", "poweroff")
		case "reboot", "restart":
			cfg := getStartupConfig()
			if cfg.NotifyShutdown {
				sendStartupNotif("🔄 Serwer NAS — restart", "Serwer Nimbus jest restartowany. Za chwilę wróci online.")
				time.Sleep(2 * time.Second)
			}
			saveStartupState()
			runCmd("systemctl", "reboot")
		case "suspend":   runCmd("systemctl", "suspend")
		case "hibernate": runCmd("systemctl", "hibernate")
		}
	}()
}

func (s *Server) handlePowerHistory(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("last", "-x", "shutdown", "reboot")
	jsonOK(w, map[string]any{"history": strings.Split(out, "\n")})
}

func (s *Server) handlePowerSchedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{"schedules": []any{}})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok", "id": "1"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePowerScheduleItem(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:    jsonOK(w, map[string]any{})
	case http.MethodPut:    jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Energy ───────────────────────────────────────────────────────────────────

func (s *Server) handleEnergyStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"status": "ok", "source": "ac"})
}

func (s *Server) handleEnergyHistory(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"history": []any{}})
}

func (s *Server) handleEnergyDevices(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"devices": []any{}})
}

func (s *Server) handleEnergyRate(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{"rate": 0.0, "currency": "USD"})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── UPS ──────────────────────────────────────────────────────────────────────

func (s *Server) handleUPSStatus(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("upsc", "ups")
	installed := err == nil || !strings.Contains(err.Error(), "executable file not found")
	jsonOK(w, map[string]any{"installed": installed, "raw": out})
}

func (s *Server) handleUPSDetails(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("upsc", "ups@localhost")
	jsonOK(w, map[string]any{"raw": out})
}

func (s *Server) handleUPSConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]string{"config": readFileStr("/etc/nut/ups.conf")})
	case http.MethodPost:
		var req struct{ Config string `json:"config"` }
		json.NewDecoder(r.Body).Decode(&req)
		writeFile("/etc/nut/ups.conf", req.Config)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleUPSConfigNUT(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		upsconf  := readFileStr("/etc/nut/ups.conf")
		nutconf  := readFileStr("/etc/nut/nut.conf")
		upsdconf := readFileStr("/etc/nut/upsd.conf")
		jsonOK(w, map[string]any{"ups_conf": upsconf, "nut_conf": nutconf, "upsd_conf": upsdconf})
	case http.MethodPost:
		var req struct { UpsConf, NutConf, UpsdConf string `json:"ups_conf"` }
		json.NewDecoder(r.Body).Decode(&req)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleUPSEvents(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("upsc", "-l")
	jsonOK(w, map[string]any{"events": strings.Split(out, "\n")})
}

func (s *Server) handleUPSLogs(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-u", "nut-server", "-n", "100", "--no-pager")
	jsonOK(w, map[string]any{"logs": strings.Split(out, "\n")})
}

func (s *Server) handleUPSServiceRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("systemctl", "restart", "nut-server", "nut-monitor")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleUPSTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("upsrw", "-s", "test.battery.start.quick=1", "ups@localhost")
	jsonOK(w, map[string]any{"ok": err == nil, "output": out})
}

// ── Wake-on-LAN ──────────────────────────────────────────────────────────────

func (s *Server) handleWoLConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWoLDevices(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{"devices": []any{}})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok", "id": "1"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWoLDeviceItem(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:    jsonOK(w, map[string]any{})
	case http.MethodPut:    jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWoLWake(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { MAC, IP, Interface string }
	json.NewDecoder(r.Body).Decode(&req)
	if req.MAC == "" { jsonErr(w, "mac required", http.StatusBadRequest); return }
	args := []string{req.MAC}
	if req.IP != "" { args = append([]string{"-i", req.IP}, args...) }
	out, err := runCmd("wakeonlan", args...)
	if err != nil {
		// Fallback do etherwake
		out, err = runCmd("etherwake", req.MAC)
	}
	jsonOK(w, map[string]any{"ok": err == nil, "output": out})
}
