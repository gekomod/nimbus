package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"nimbus/internal/sys"
	"sort"
	"strconv"
	"strings"
	"time"
	"os"
)

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	cpu := sys.CPUPercent()
	mem := sys.Memory()
	ci  := sys.CPUInfo()
	ld  := sys.LoadAvg()
	up  := sys.Uptime()
	used := mem.TotalKB - mem.AvailableKB
	jsonOK(w, map[string]any{
		"cpu": map[string]any{
			"percent": round2(cpu), "model": ci["model"], "cores": ci["cores"],
			"freq_ghz": ci["freq_ghz"], "temp": round2(sys.CPUTemp()),
			"load": [3]float64{round2(ld[0]), round2(ld[1]), round2(ld[2])},
		},
		"memory": map[string]any{
			"total_gb": round2(float64(mem.TotalKB)/1048576), "used_gb": round2(float64(used)/1048576),
			"avail_gb": round2(float64(mem.AvailableKB)/1048576), "buffers_gb": round2(float64(mem.BuffersKB)/1048576),
			"cached_gb": round2(float64(mem.CachedKB)/1048576), "swap_total_gb": round2(float64(mem.SwapTotalKB)/1048576),
			"swap_used_gb": round2(float64(mem.SwapTotalKB-mem.SwapFreeKB)/1048576),
			"percent": round2(float64(used)/float64(mem.TotalKB)*100),
		},
		"uptime_secs": int(up.Seconds()), "hostname": sys.Hostname(), "kernel": sys.KernelVersion(),
	})
}

func (s *Server) handleCPU(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"percent": round2(sys.CPUPercent()), "temp": round2(sys.CPUTemp()), "load": sys.LoadAvg(), "info": sys.CPUInfo()})
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	m := sys.Memory(); used := m.TotalKB - m.AvailableKB
	jsonOK(w, map[string]any{
		"total_gb": round2(float64(m.TotalKB)/1048576), "used_gb": round2(float64(used)/1048576),
		"avail_gb": round2(float64(m.AvailableKB)/1048576), "cached_gb": round2(float64(m.CachedKB)/1048576),
		"buffers_gb": round2(float64(m.BuffersKB)/1048576), "swap_total_gb": round2(float64(m.SwapTotalKB)/1048576),
		"swap_used_gb": round2(float64(m.SwapTotalKB-m.SwapFreeKB)/1048576),
		"percent": round2(float64(used)/float64(m.TotalKB)*100),
	})
}

func (s *Server) handleSystemHealth(w http.ResponseWriter, r *http.Request) {
	m := sys.Memory(); used := m.TotalKB - m.AvailableKB
	cpuPct := round2(sys.CPUPercent()); memPct := round2(float64(used)/float64(m.TotalKB)*100)
	status := "healthy"
	if cpuPct > 90 || memPct > 90 { status = "warning" }
	jsonOK(w, map[string]any{"status": status, "cpu_pct": cpuPct, "memory_pct": memPct, "load": sys.LoadAvg(), "uptime": int(sys.Uptime().Seconds())})
}

func (s *Server) handleProcesses(w http.ResponseWriter, r *http.Request) {
	procs := sys.Processes()
	sort.Slice(procs, func(i, j int) bool { return procs[i].CPU > procs[j].CPU })
	if len(procs) > 50 { procs = procs[:50] }
	jsonOK(w, procs)
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	n := 50
	if v := r.URL.Query().Get("n"); v != "" { if i, err := strconv.Atoi(v); err == nil && i > 0 { n = i } }
	jsonOK(w, sys.JournalLogs(n))
}

func (s *Server) handleSystemLogs(w http.ResponseWriter, r *http.Request) {
	svc := r.URL.Query().Get("service"); n := "100"
	if v := r.URL.Query().Get("n"); v != "" { n = v }
	args := []string{"-n", n, "--no-pager", "--output=short-iso"}
	if svc != "" { args = append(args, "-u", svc) }
	out, _ := runCmd("journalctl", args...)
	jsonOK(w, map[string]any{"lines": strings.Split(out, "\n")})
}

func (s *Server) handleSystemRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
	go func() { time.Sleep(300 * time.Millisecond); saveStartupState(); runCmd("systemctl", "reboot") }()
}

func (s *Server) handleSystemShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
	go func() { time.Sleep(300 * time.Millisecond); runCmd("systemctl", "poweroff") }()
}

func (s *Server) handleScheduleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Minutes int `json:"minutes"` }
	json.NewDecoder(r.Body).Decode(&req)
	when := "+" + strconv.Itoa(req.Minutes)
	if _, err := runCmd("shutdown", when); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]any{"status": "ok", "minutes": req.Minutes})
}

func (s *Server) handleCancelShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("shutdown", "-c")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleSystemSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tz, _ := runCmd("timedatectl", "show", "--property=Timezone", "--value")
		jsonOK(w, map[string]any{"hostname": sys.Hostname(), "timezone": strings.TrimSpace(tz)})
	case http.MethodPost:
		var req struct { Hostname string `json:"hostname"`; Timezone string `json:"timezone"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Hostname != "" { runCmd("hostnamectl", "set-hostname", req.Hostname) }
		if req.Timezone != "" { runCmd("timedatectl", "set-timezone", req.Timezone) }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWebserverConfig(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"config": readFileStr("/etc/nginx/nginx.conf")})
}

func (s *Server) handleWebserverConfigSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Config string `json:"config"` }
	json.NewDecoder(r.Body).Decode(&req)
	writeFile("/etc/nginx/nginx.conf", req.Config)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleCronJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("crontab", "-l")
		var jobs []map[string]any
		for i, l := range strings.Split(out, "\n") {
			l = strings.TrimSpace(l)
			if l == "" || strings.HasPrefix(l, "#") { continue }
			jobs = append(jobs, map[string]any{"id": i, "line": l, "enabled": true})
		}
		jsonOK(w, map[string]any{"jobs": jobs})
	case http.MethodPost:
		var req struct{ Line string `json:"line"` }
		json.NewDecoder(r.Body).Decode(&req)
		cur, _ := runCmd("crontab", "-l")
		writeFile("/tmp/nimbus_cron_tmp", cur+"\n"+req.Line+"\n")
		runCmd("crontab", "/tmp/nimbus_cron_tmp")
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleCronJobAction(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleSystemUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, sys.LocalUsers())
	case http.MethodPost:
		var req struct { Username, Password, Shell, Groups string }
		json.NewDecoder(r.Body).Decode(&req)
		args := []string{"-m"}
		if req.Shell != "" { args = append(args, "-s", req.Shell) }
		if req.Groups != "" { args = append(args, "-G", req.Groups) }
		args = append(args, req.Username)
		if _, err := runCmd("useradd", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		if req.Password != "" { runCmd("bash", "-c", "echo '"+req.Username+":"+req.Password+"' | chpasswd") }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSystemUserAction(w http.ResponseWriter, r *http.Request) {
	uname := strings.Split(pathSuffix(r, "/api/system/users/"), "/")[0]
	if uname == "" { jsonErr(w, "username required", http.StatusBadRequest); return }
	switch r.Method {
	case http.MethodDelete:
		runCmd("userdel", "-r", uname)
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodPut:
		var req struct { Password, Groups, Shell string }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Password != "" { runCmd("bash", "-c", "echo '"+uname+":"+req.Password+"' | chpasswd") }
		if req.Groups != "" { runCmd("usermod", "-G", req.Groups, uname) }
		if req.Shell != "" { runCmd("usermod", "-s", req.Shell, uname) }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("getent", "group")
	var groups []map[string]any
	for _, l := range strings.Split(out, "\n") {
		p := strings.Split(l, ":")
		if len(p) < 4 { continue }
		gid, _ := strconv.Atoi(p[2])
		members := []string{}
		if p[3] != "" { members = strings.Split(p[3], ",") }
		groups = append(groups, map[string]any{"name": p[0], "gid": gid, "members": members})
	}
	jsonOK(w, groups)
}

func (s *Server) handleBackupCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok", "id": strconv.FormatInt(time.Now().Unix(), 10)})
}
func (s *Server) handleBackupList(w http.ResponseWriter, r *http.Request)    { jsonOK(w, map[string]any{"backups": []any{}}) }
func (s *Server) handleBackupHistory(w http.ResponseWriter, r *http.Request) { jsonOK(w, map[string]any{"history": []any{}}) }
func (s *Server) handleBackupSchedule(w http.ResponseWriter, r *http.Request) { jsonOK(w, map[string]string{"status": "ok"}) }
func (s *Server) handleBackupDelete(w http.ResponseWriter, r *http.Request)   { jsonOK(w, map[string]string{"status": "ok"}) }

// handlePublicStatus — publiczny endpoint bez auth, tylko dla strony logowania.
// Zwraca minimalny zestaw: hostname, uptime, IP głównego interfejsu, kernel.
func (s *Server) handlePublicStatus(w http.ResponseWriter, r *http.Request) {
	up   := sys.Uptime()
	days := int(up.Hours()) / 24
	hrs  := int(up.Hours()) % 24

	// Główny IP (pierwszy nie-loopback interfejs)
	ip := ""
	if ifaces, err := net.Interfaces(); err == nil {
		for _, iface := range ifaces {
			if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil {
					ip = ipnet.IP.String()
					break
				}
			}
			if ip != "" { break }
		}
	}

	jsonOK(w, map[string]any{
		"hostname":    sys.Hostname(),
		"uptime_secs": int(up.Seconds()),
		"uptime_str":  fmt.Sprintf("%dd %dh", days, hrs),
		"ip":          ip,
		"kernel":      strings.TrimPrefix(sys.KernelVersion(), "Linux "),
		"online":      true,
	})
}

// Dodaj endpoint dla DDNS cron jobs
func (s *Server) handleCronDDNS(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		content, err := os.ReadFile("/etc/cron.d/nimbus-ddns")
		if err != nil {
			jsonOK(w, map[string]any{"jobs": []any{}})
			return
		}
		
		var jobs []map[string]any
		lines := strings.Split(string(content), "\n")
		for i, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			jobs = append(jobs, map[string]any{
				"id":      i,
				"line":    line,
				"name":    "DDNS Update",
				"enabled": true,
				"source":  "/etc/cron.d/nimbus-ddns",
			})
		}
		jsonOK(w, map[string]any{"jobs": jobs})
		
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
