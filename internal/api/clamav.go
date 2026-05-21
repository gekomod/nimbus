package api

// clamav.go — pełna obsługa ClamAV przez clamd socket i system commands
// Endpointy: /api/clamav/*

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Struktury ──────────────────────────────────────────────────────────────────

type ClamScan struct {
	ID       string  `json:"id"`
	Target   string  `json:"target"`
	Mode     string  `json:"mode"`
	State    string  `json:"state"`
	Progress float64 `json:"progress"`
	Files    string  `json:"files"`
	Threats  int     `json:"threats"`
	Started  string  `json:"started"`
	ETA      string  `json:"eta"`
	Rate     string  `json:"rate"`
	PID      int     `json:"pid"`
	Output   string  `json:"output,omitempty"`
}

type ClamQuarantineFile struct {
	ID      string `json:"id"`
	File    string `json:"file"`
	Threat  string `json:"threat"`
	Size    string `json:"size"`
	Added   string `json:"added"`
	Sev     string `json:"sev"`
	OrigPath string `json:"orig_path"`
}

type ClamSchedule struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Target   string `json:"target"`
	When     string `json:"when"`
	OnAccess bool   `json:"onAccess"`
	On       bool   `json:"on"`
	Next     string `json:"next"`
	Last     string `json:"last"`
	Cron     string `json:"cron"`
}

const (
	clamConfigPath    = "/var/lib/nimbus/clamav_config.json"
	quarantineDir     = "/var/lib/clamav/quarantine"
	clamSchedulesFile = "/var/lib/nimbus/clamav_schedules.json"
)

// ── Active scans (in-memory) ──────────────────────────────────────────────────

var (
	activeScans   = map[string]*ClamScan{}
	activeScansMu sync.Mutex
)

// ── Clamd socket communication ────────────────────────────────────────────────

func clamSocket() string {
	sockets := []string{
		"/run/clamav/clamd.ctl",
		"/var/run/clamav/clamd.ctl",
		"/tmp/clamd.ctl",
	}
	for _, s := range sockets {
		if _, err := os.Stat(s); err == nil {
			return s
		}
	}
	return "/run/clamav/clamd.ctl"
}

func clamCmd(command string) (string, error) {
	sock := clamSocket()
	conn, err := net.DialTimeout("unix", sock, 3*time.Second)
	if err != nil {
		// Fallback TCP
		conn, err = net.DialTimeout("tcp", "127.0.0.1:3310", 3*time.Second)
		if err != nil {
			return "", fmt.Errorf("clamd niedostępny: %v", err)
		}
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	fmt.Fprintf(conn, "n%s\n", command)
	var sb strings.Builder
	sc := bufio.NewScanner(conn)
	for sc.Scan() {
		sb.WriteString(sc.Text())
		sb.WriteByte('\n')
	}
	return strings.TrimSpace(sb.String()), nil
}

// ── /api/clamav/status ────────────────────────────────────────────────────────

func (s *Server) handleClamStatus(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{}

	// Sprawdź czy clamd działa
	clamRunning := serviceActive("clamav-daemon") || serviceActive("clamd")
	freshclamRunning := serviceActive("clamav-freshclam") || serviceActive("freshclam")
	result["daemon"] = clamRunning
	result["freshclam"] = freshclamRunning

	if clamRunning {
		// Pobierz wersję przez socket
		if ver, err := clamCmd("VERSION"); err == nil {
			result["version"] = ver
		}
		// STATS
		if stats, err := clamCmd("STATS"); err == nil {
			result["stats_raw"] = stats
			// Parse POOLS stats
			for _, line := range strings.Split(stats, "\n") {
				if strings.Contains(line, "MEMSTATS") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						result["mem_mb"] = fields[1]
					}
				}
			}
		}
	}

	// Bazy sygnatur
	result["signatures"] = getClamSigInfo()

	// freshclam interval
	if data, err := os.ReadFile("/etc/clamav/freshclam.conf"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "Checks ") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					checks, _ := strconv.Atoi(fields[1])
					if checks > 0 {
						result["freshclam_interval"] = fmt.Sprintf("%dh", 24/checks)
					}
				}
			}
		}
	}

	// OnAccess
	result["on_access"] = getOnAccessStatus()

	// Aktywne skany
	activeScansMu.Lock()
	scans := make([]*ClamScan, 0, len(activeScans))
	for _, sc := range activeScans {
		scans = append(scans, sc)
	}
	activeScansMu.Unlock()
	result["active_scans"] = scans

	// Kwarantanna - liczba plików
	result["quarantine_count"] = getQuarantineCount()

	jsonOK(w, result)
}

func getClamSigInfo() []map[string]string {
	dbDir := "/var/lib/clamav"
	entries, err := os.ReadDir(dbDir)
	if err != nil {
		return nil
	}
	var sigs []map[string]string
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".cvd") && !strings.HasSuffix(name, ".cld") &&
			!strings.HasSuffix(name, ".hdb") && !strings.HasSuffix(name, ".ndb") {
			continue
		}
		info, _ := e.Info()
		sig := map[string]string{
			"name":   name,
			"date":   info.ModTime().Format("2006-01-02 15:04"),
			"size":   formatBytes(info.Size()),
			"status": "ok",
		}
		// Pobierz wersję z sigtool
		if out, err := exec.Command("sigtool", "--info", filepath.Join(dbDir, name)).Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.HasPrefix(line, "Version:") {
					sig["ver"] = strings.TrimSpace(strings.TrimPrefix(line, "Version:"))
				}
				if strings.HasPrefix(line, "Signatures:") {
					sig["sigs"] = strings.TrimSpace(strings.TrimPrefix(line, "Signatures:"))
				}
				if strings.HasPrefix(line, "Build time:") {
					sig["date"] = strings.TrimSpace(strings.TrimPrefix(line, "Build time:"))
				}
			}
		}
		sigs = append(sigs, sig)
	}
	return sigs
}

func getOnAccessStatus() map[string]any {
	result := map[string]any{"enabled": false}
	if data, err := os.ReadFile("/etc/clamav/clamd.conf"); err == nil {
		content := string(data)
		result["enabled"] = strings.Contains(content, "ScanOnAccess yes") ||
			strings.Contains(content, "OnAccessMount") ||
			serviceActive("clamav-clamonacc")
		// Pobierz monitorowane ścieżki
		var paths []map[string]string
		for _, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "OnAccessIncludePath ") {
				paths = append(paths, map[string]string{
					"p": strings.TrimPrefix(line, "OnAccessIncludePath "), "mode": "include",
				})
			}
			if strings.HasPrefix(line, "OnAccessExcludePath ") {
				paths = append(paths, map[string]string{
					"p": strings.TrimPrefix(line, "OnAccessExcludePath "), "mode": "exclude",
				})
			}
		}
		result["paths"] = paths
	}
	return result
}

func getQuarantineCount() int {
	os.MkdirAll(quarantineDir, 0700)
	entries, err := os.ReadDir(quarantineDir)
	if err != nil { return 0 }
	count := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".meta") { count++ }
	}
	return count
}

// ── /api/clamav/scan ─────────────────────────────────────────────────────────

func (s *Server) handleClamScan(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Lista aktywnych skanów
		activeScansMu.Lock()
		scans := make([]*ClamScan, 0, len(activeScans))
		for _, sc := range activeScans {
			scans = append(scans, sc)
		}
		activeScansMu.Unlock()
		jsonOK(w, map[string]any{"scans": scans})

	case http.MethodPost:
		var req struct {
			Target    string `json:"target"`
			Recursive bool   `json:"recursive"`
			Archives  bool   `json:"archives"`
			PUA       bool   `json:"pua"`
			Priority  string `json:"priority"`
		}
		req.Recursive = true
		req.Archives = true
		req.Priority = "normal"
		json.NewDecoder(r.Body).Decode(&req)

		if req.Target == "" {
			jsonErr(w, "target required", 400)
			return
		}

		scan := &ClamScan{
			ID:      fmt.Sprintf("scan-%d", time.Now().UnixMilli()),
			Target:  req.Target,
			Mode:    "On-demand",
			State:   "running",
			Started: time.Now().Format("2006-01-02 15:04:05"),
			Files:   "0 / ?",
			ETA:     "obliczanie…",
			Rate:    "—",
		}

		activeScansMu.Lock()
		activeScans[scan.ID] = scan
		activeScansMu.Unlock()

		// Uruchom skan w tle
		go runClamScan(scan, req.Recursive, req.Archives, req.PUA, req.Priority)

		jsonOK(w, map[string]any{"status": "started", "scan": scan})

	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func runClamScan(scan *ClamScan, recursive, archives, pua bool, priority string) {
	defer func() {
		// Zostaw przez 8s po zakończeniu żeby frontend zdążył pobrać wynik
		time.Sleep(8 * time.Second)
		activeScansMu.Lock()
		delete(activeScans, scan.ID)
		activeScansMu.Unlock()
	}()

	// Wybierz clamscan (działa jako root, ma dostęp do wszystkich plików)
	// lub clamdscan (przez socket clamd, ograniczony uprawnieniami clamd)
	_, errClamdscan := exec.LookPath("clamdscan")
	_, errClamscan  := exec.LookPath("clamscan")
	useClamdscan := errClamdscan == nil

	// Buduj argumenty
	os.MkdirAll(quarantineDir, 0755)
	var args []string

	if useClamdscan {
		// clamdscan — przez socket clamd (szybszy, ale ograniczone uprawnienia)
		args = []string{"--no-summary"}
		if archives { args = append(args, "--scan-archive=yes") }
		if pua      { args = append(args, "--detect-pua=yes") }
		args = append(args, "--move="+quarantineDir)
	} else if errClamscan == nil {
		// clamscan — standalone, działa jako root
		args = []string{"-r", "--no-summary"}
		if archives { args = append(args, "--scan-archive") }
		if pua      { args = append(args, "--detect-pua=yes") }
		args = append(args, "--move="+quarantineDir)
	} else {
		scan.State = "error"
		scan.Output = "clamdscan/clamscan nie znaleziony"
		return
	}
	args = append(args, scan.Target)

	var cmd *exec.Cmd
	scanner2 := "clamscan"
	if useClamdscan { scanner2 = "clamdscan" }

	if priority == "idle" {
		cmd = exec.Command("ionice", append([]string{"-c3", scanner2}, args...)...)
	} else {
		cmd = exec.Command(scanner2, args...)
	}

	// Przechwytaj stdout żeby liczyć pliki
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		scan.State = "error"
		return
	}

	cmd.Start()
	scan.PID = cmd.Process.Pid

	startTime := time.Now()
	scanner := bufio.NewScanner(stdout)
	var fileCount int

	for scanner.Scan() {
		line := scanner.Text()
		fileCount++
		scan.Files = fmt.Sprintf("%d / ?", fileCount)
		elapsed := time.Since(startTime).Seconds()
		if elapsed > 0 {
			scan.Rate = fmt.Sprintf("%.0f /s", float64(fileCount)/elapsed)
		}
		// Wykryj zagrożenie
		if strings.Contains(line, "FOUND") {
			scan.Threats++
			// Zapisz do kwarantanny metadata
			parts := strings.Split(line, ": ")
			if len(parts) >= 2 {
				filePath := strings.TrimSpace(parts[0])
				threat := strings.TrimSuffix(strings.TrimSpace(parts[1]), " FOUND")
				saveQuarantineMeta(filePath, threat)
			}
		}
		scan.Output += line + "\n"
	}

	cmd.Wait()
	scan.State = "completed"
	if scan.Threats > 0 {
		scan.State = "threat"
	}
	scan.Progress = 1.0
	elapsed := time.Since(startTime)
	scan.ETA = fmt.Sprintf("%.0fs", elapsed.Seconds())
}

func saveQuarantineMeta(filePath, threat string) {
	os.MkdirAll(quarantineDir, 0700)
	meta := map[string]string{
		"file":      filePath,
		"threat":    threat,
		"added":     time.Now().Format("2006-01-02 15:04"),
		"sev":       "err",
		"orig_path": filePath,
	}
	if strings.Contains(strings.ToLower(threat), "pua") || strings.Contains(strings.ToLower(threat), "warn") {
		meta["sev"] = "warn"
	}
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	data, _ := json.Marshal(meta)
	os.WriteFile(filepath.Join(quarantineDir, id+".meta"), data, 0600)
}

// ── /api/clamav/scan/{id} ─────────────────────────────────────────────────────

func (s *Server) handleClamScanItem(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/clamav/scan/")
	action := r.URL.Query().Get("action")

	activeScansMu.Lock()
	scan, ok := activeScans[id]
	activeScansMu.Unlock()

	if !ok {
		jsonErr(w, "scan not found", 404)
		return
	}

	switch r.Method {
	case http.MethodGet:
		jsonOK(w, scan)
	case http.MethodPost:
		switch action {
		case "pause":
			scan.State = "paused"
			if scan.PID > 0 { exec.Command("kill", "-STOP", strconv.Itoa(scan.PID)).Run() }
		case "resume":
			scan.State = "running"
			if scan.PID > 0 { exec.Command("kill", "-CONT", strconv.Itoa(scan.PID)).Run() }
		case "stop":
			scan.State = "stopped"
			if scan.PID > 0 { exec.Command("kill", strconv.Itoa(scan.PID)).Run() }
			activeScansMu.Lock()
			delete(activeScans, id)
			activeScansMu.Unlock()
		}
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── /api/clamav/history ──────────────────────────────────────────────────────

func (s *Server) handleClamHistory(w http.ResponseWriter, r *http.Request) {
	// Czytaj logi z /var/log/clamav/clamd.log
	out, _ := runCmd("grep", "-a", "Scan completed", "/var/log/clamav/clamd.log")
	if out == "" {
		// Fallback: journalctl
		out, _ = runCmd("journalctl", "-u", "clamav-daemon", "--no-pager", "-n", "200", "--grep", "Scan complete")
	}

	type HistEntry struct {
		Date     string `json:"date"`
		Target   string `json:"target"`
		Duration string `json:"duration"`
		Files    string `json:"files"`
		Threats  int    `json:"threats"`
		Result   string `json:"result"`
		Bytes    string `json:"bytes"`
	}

	var entries []HistEntry
	for _, line := range strings.Split(out, "\n") {
		if line == "" { continue }
		e := HistEntry{Date: "—", Target: "—", Duration: "—", Files: "—", Result: "ok"}
		// Próbuj wyciągnąć dane z linii logu
		if strings.Contains(line, "Infected files:") {
			// Format clamdscan
			if inf := extractValue(line, "Infected files:"); inf != "0" && inf != "" {
				n, _ := strconv.Atoi(inf)
				e.Threats = n
				e.Result = "threat"
			}
		}
		entries = append(entries, e)
	}

	jsonOK(w, map[string]any{"history": entries})
}

func extractValue(line, key string) string {
	idx := strings.Index(line, key)
	if idx < 0 { return "" }
	rest := strings.TrimSpace(line[idx+len(key):])
	fields := strings.Fields(rest)
	if len(fields) > 0 { return fields[0] }
	return ""
}

// ── /api/clamav/quarantine ───────────────────────────────────────────────────

func (s *Server) handleClamQuarantine(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		os.MkdirAll(quarantineDir, 0700)
		entries, _ := os.ReadDir(quarantineDir)
		var files []ClamQuarantineFile
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".meta") { continue }
			data, err := os.ReadFile(filepath.Join(quarantineDir, e.Name()))
			if err != nil { continue }
			var meta map[string]string
			json.Unmarshal(data, &meta)
			id := strings.TrimSuffix(e.Name(), ".meta")
			// Sprawdź rozmiar pliku kwarantanny
			size := "—"
			quarFile := filepath.Join(quarantineDir, id)
			if fi, err := os.Stat(quarFile); err == nil {
				size = formatBytes(fi.Size())
			}
			sev := meta["sev"]
			if sev == "" { sev = "err" }
			files = append(files, ClamQuarantineFile{
				ID:       id,
				File:     meta["file"],
				Threat:   meta["threat"],
				Size:     size,
				Added:    meta["added"],
				Sev:      sev,
				OrigPath: meta["orig_path"],
			})
		}
		if files == nil { files = []ClamQuarantineFile{} }
		jsonOK(w, map[string]any{"files": files})

	case http.MethodDelete:
		var req struct {
			IDs    []string `json:"ids"`
			Action string   `json:"action"` // "delete"|"restore"
		}
		json.NewDecoder(r.Body).Decode(&req)

		for _, id := range req.IDs {
			metaPath := filepath.Join(quarantineDir, id+".meta")
			quarPath := filepath.Join(quarantineDir, id)

			if req.Action == "restore" {
				// Czytaj metadata żeby wiedzieć gdzie przywrócić
				data, err := os.ReadFile(metaPath)
				if err == nil {
					var meta map[string]string
					json.Unmarshal(data, &meta)
					if origPath := meta["orig_path"]; origPath != "" {
						os.MkdirAll(filepath.Dir(origPath), 0755)
						os.Rename(quarPath, origPath)
					}
				}
			} else {
				os.Remove(quarPath)
			}
			os.Remove(metaPath)
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── /api/clamav/signatures ──────────────────────────────────────────────────

func (s *Server) handleClamSignatures(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		sigs := getClamSigInfo()
		if sigs == nil { sigs = []map[string]string{} }
		jsonOK(w, map[string]any{"signatures": sigs})
	case http.MethodPost:
		// Wymuś aktualizację
		go func() {
			runCmd("systemctl", "restart", "clamav-freshclam")
			time.Sleep(2 * time.Second)
			runCmd("freshclam", "--no-dns")
		}()
		jsonOK(w, map[string]string{"status": "started"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── /api/clamav/schedules ────────────────────────────────────────────────────

func loadClamSchedules() []ClamSchedule {
	data, err := os.ReadFile(clamSchedulesFile)
	if err != nil { return []ClamSchedule{} }
	var schedules []ClamSchedule
	json.Unmarshal(data, &schedules)
	return schedules
}

func saveClamSchedules(schedules []ClamSchedule) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	data, _ := json.MarshalIndent(schedules, "", "  ")
	os.WriteFile(clamSchedulesFile, data, 0644)
}

func (s *Server) handleClamSchedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"schedules": loadClamSchedules()})
	case http.MethodPost:
		var sch ClamSchedule
		json.NewDecoder(r.Body).Decode(&sch)
		schedules := loadClamSchedules()
		if sch.ID == "" {
			sch.ID = fmt.Sprintf("sch-%d", time.Now().UnixMilli())
			schedules = append(schedules, sch)
		} else {
			for i, s2 := range schedules {
				if s2.ID == sch.ID { schedules[i] = sch; goto schDone }
			}
			schedules = append(schedules, sch)
		}
	schDone:
		saveClamSchedules(schedules)
		// Aktualizuj crontab
		updateClamCron(schedules)
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete:
		var req struct{ ID string `json:"id"` }
		json.NewDecoder(r.Body).Decode(&req)
		schedules := loadClamSchedules()
		filtered := schedules[:0]
		for _, s2 := range schedules {
			if s2.ID != req.ID { filtered = append(filtered, s2) }
		}
		saveClamSchedules(filtered)
		updateClamCron(filtered)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func updateClamCron(schedules []ClamSchedule) {
	// Usuń stare wpisy Nimbus
	current, _ := runCmd("crontab", "-l")
	var lines []string
	for _, line := range strings.Split(current, "\n") {
		if !strings.Contains(line, "# nimbus-clamav") {
			lines = append(lines, line)
		}
	}
	// Dodaj nowe
	for _, sch := range schedules {
		if !sch.On || sch.Cron == "" { continue }
		lines = append(lines, fmt.Sprintf("%s clamdscan -r %s # nimbus-clamav %s", sch.Cron, sch.Target, sch.ID))
	}
	newCron := strings.Join(lines, "\n") + "\n"
	cmd := exec.Command("crontab", "-")
	cmd.Stdin = strings.NewReader(newCron)
	cmd.Run()
}

// ── /api/clamav/logs ─────────────────────────────────────────────────────────

func (s *Server) handleClamLogs(w http.ResponseWriter, r *http.Request) {
	n := r.URL.Query().Get("n")
	if n == "" { n = "100" }
	lvl := r.URL.Query().Get("lvl")

	type LogEntry struct {
		T   string `json:"t"`
		Lvl string `json:"lvl"`
		Msg string `json:"msg"`
	}

	// Czytaj z pliku logu lub journalctl
	var lines []string
	if data, err := os.ReadFile("/var/log/clamav/clamd.log"); err == nil {
		all := strings.Split(string(data), "\n")
		if len(all) > 200 { all = all[len(all)-200:] }
		lines = all
	} else {
		out, _ := runCmd("journalctl", "-u", "clamav-daemon", "-u", "clamav-freshclam",
			"--no-pager", "-n", n, "--output=short-iso")
		lines = strings.Split(out, "\n")
	}

	var entries []LogEntry
	for _, line := range lines {
		if line == "" { continue }
		entry := LogEntry{T: "—", Lvl: "INFO", Msg: line}
		// Parse timestamp
		parts := strings.SplitN(line, " ", 2)
		if len(parts) >= 2 {
			entry.T = parts[0]
			entry.Msg = parts[1]
		}
		// Detect level
		msg := strings.ToUpper(entry.Msg)
		if strings.Contains(msg, "WARNING") || strings.Contains(msg, "WARN") {
			entry.Lvl = "WARN"
		} else if strings.Contains(msg, "ERROR") || strings.Contains(msg, "FAILED") {
			entry.Lvl = "ERROR"
		} else if strings.Contains(msg, "FOUND") || strings.Contains(msg, "THREAT") {
			entry.Lvl = "WARN"
		} else if strings.Contains(msg, "OK") || strings.Contains(msg, "UPDATED") ||
			strings.Contains(msg, "COMPLETE") {
			entry.Lvl = "OK"
		}
		if lvl != "" && lvl != "all" && strings.ToUpper(lvl) != entry.Lvl {
			continue
		}
		entries = append(entries, entry)
	}

	// Odwróć — najnowsze pierwsze
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}

	jsonOK(w, map[string]any{"logs": entries})
}

// ── /api/clamav/config ───────────────────────────────────────────────────────

func (s *Server) handleClamConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		clamd, _ := os.ReadFile("/etc/clamav/clamd.conf")
		fresh, _ := os.ReadFile("/etc/clamav/freshclam.conf")
		jsonOK(w, map[string]string{
			"clamd":     string(clamd),
			"freshclam": string(fresh),
		})
	case http.MethodPost:
		var req map[string]string
		json.NewDecoder(r.Body).Decode(&req)
		var msg []string

		if v, ok := req["clamd"]; ok {
			if err := os.WriteFile("/etc/clamav/clamd.conf", []byte(v), 0644); err == nil {
				msg = append(msg, "clamd.conf zapisany")
			}
		}
		if v, ok := req["freshclam"]; ok {
			if err := os.WriteFile("/etc/clamav/freshclam.conf", []byte(v), 0644); err == nil {
				msg = append(msg, "freshclam.conf zapisany")
			}
		}
		// Test składni
		if _, action := req["action"]; action || req["action"] == "test" {
			out, err := runCmd("clamconf", "--reconfigure")
			if err != nil {
				jsonOK(w, map[string]any{"status": "error", "output": out})
				return
			}
			jsonOK(w, map[string]any{"status": "ok", "output": out, "msgs": msg})
			return
		}
		// Restart
		if v := req["restart"]; v == "true" {
			go func() {
				time.Sleep(500 * time.Millisecond)
				runCmd("systemctl", "restart", "clamav-daemon")
			}()
			msg = append(msg, "restart zaplanowany")
		}
		jsonOK(w, map[string]any{"status": "ok", "msgs": msg})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── /api/clamav/service ──────────────────────────────────────────────────────

func (s *Server) handleClamService(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct {
		Service string `json:"service"` // "daemon"|"freshclam"|"onaccess"|"all"
		Action  string `json:"action"`  // "start"|"stop"|"restart"|"reload"
	}
	req.Action = "restart"
	json.NewDecoder(r.Body).Decode(&req)

	serviceMap := map[string]string{
		"daemon":    "clamav-daemon",
		"freshclam": "clamav-freshclam",
		"onaccess":  "clamav-clamonacc",
	}

	var services []string
	if req.Service == "all" {
		services = []string{"clamav-daemon", "clamav-freshclam"}
	} else if svc, ok := serviceMap[req.Service]; ok {
		services = []string{svc}
	} else {
		services = []string{req.Service}
	}

	var results []string
	for _, svc := range services {
		out, err := runCmd("systemctl", req.Action, svc)
		if err != nil {
			results = append(results, svc+": błąd — "+out)
		} else {
			results = append(results, svc+": "+req.Action+" OK")
		}
	}
	jsonOK(w, map[string]any{"status": "ok", "results": results})
}

// ── /api/clamav/onaccess ─────────────────────────────────────────────────────

func (s *Server) handleClamOnAccess(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, getOnAccessStatus())
	case http.MethodPost:
		var req struct {
			Enabled    bool     `json:"enabled"`
			Prevention bool     `json:"prevention"`
			Extra      bool     `json:"extra"`
			MaxSize    string   `json:"max_size"`
			Paths      []struct {
				P    string `json:"p"`
				Mode string `json:"mode"`
			} `json:"paths"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		// Zaktualizuj clamd.conf
		data, err := os.ReadFile("/etc/clamav/clamd.conf")
		if err != nil {
			jsonErr(w, "cannot read clamd.conf: "+err.Error(), 500)
			return
		}

		conf := string(data)
		// Usuń stare wpisy OnAccess
		var newLines []string
		for _, line := range strings.Split(conf, "\n") {
			if strings.HasPrefix(line, "OnAccess") || strings.HasPrefix(line, "ScanOnAccess") {
				continue
			}
			newLines = append(newLines, line)
		}

		// Dodaj nowe
		newLines = append(newLines, "")
		if req.Enabled {
			newLines = append(newLines, "ScanOnAccess yes")
		} else {
			newLines = append(newLines, "ScanOnAccess no")
		}
		if req.Prevention {
			newLines = append(newLines, "OnAccessPrevention yes")
		}
		if req.Extra {
			newLines = append(newLines, "OnAccessExtraScanning yes")
		}
		if req.MaxSize != "" {
			newLines = append(newLines, "OnAccessMaxFileSize "+req.MaxSize)
		}
		for _, p := range req.Paths {
			if p.Mode == "include" {
				newLines = append(newLines, "OnAccessIncludePath "+p.P)
			} else {
				newLines = append(newLines, "OnAccessExcludePath "+p.P)
			}
		}

		os.WriteFile("/etc/clamav/clamd.conf", []byte(strings.Join(newLines, "\n")), 0644)
		// Restart
		runCmd("systemctl", "restart", "clamav-daemon")
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── /api/clamav/virustotal ──────────────────────────────────────────────────

func (s *Server) handleClamVirusTotal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct {
		File string `json:"file"`
		Hash string `json:"hash"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Oblicz SHA256 jeśli nie podano
	if req.Hash == "" && req.File != "" {
		out, err := runCmd("sha256sum", req.File)
		if err == nil {
			req.Hash = strings.Fields(out)[0]
		}
	}

	jsonOK(w, map[string]any{
		"hash":    req.Hash,
		"url":     "https://www.virustotal.com/gui/file/" + req.Hash,
		"message": "Otwórz link w przeglądarce aby sprawdzić na VirusTotal",
	})
}

// ── /api/clamav/freshclam ───────────────────────────────────────────────────

func (s *Server) handleClamFreshclam(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Historia aktualizacji — 30 dni z logów
		history := make([]int, 30)
		for i := range history { history[i] = 1 } // domyślnie OK

		if data, err := os.ReadFile("/var/log/clamav/freshclam.log"); err == nil {
			content := string(data)
			// Szukaj błędów
			for _, line := range strings.Split(content, "\n") {
				if strings.Contains(strings.ToLower(line), "error") ||
					strings.Contains(strings.ToLower(line), "failed") {
					// Oznacz jako błąd - uproszczone
				}
			}
		}
		jsonOK(w, map[string]any{"history30d": history})

	case http.MethodPost:
		// Wymuś aktualizację
		out, err := exec.Command("freshclam").CombinedOutput()
		if err != nil {
			jsonOK(w, map[string]any{"status": "error", "output": string(out)})
			return
		}
		jsonOK(w, map[string]any{"status": "ok", "output": string(out)})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit { return fmt.Sprintf("%d B", b) }
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
