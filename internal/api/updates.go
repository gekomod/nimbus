package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── Typy ────────────────────────────────────────────────────────────────────

type UpdatePackage struct {
	Name     string `json:"name"`
	Current  string `json:"cur"`
	Next     string `json:"next"`
	Type     string `json:"type"`    // "security" | "update"
	Size     string `json:"size"`
	Selected bool   `json:"selected"`
}

type UpdateHistoryEntry struct {
	Date   string `json:"date"`
	Action string `json:"action"`
	Count  int    `json:"count"`
	Status string `json:"status"` // "ok" | "err"
	Note   string `json:"note"`
}

// ─── Stan globalny instalacji (stream logów) ─────────────────────────────────

var installMu   sync.Mutex
var installLog  []string
var installDone bool
var installRunning bool

// ─── Helpers ─────────────────────────────────────────────────────────────────

// rebootRequired sprawdza czy plik /var/run/reboot-required istnieje
func rebootRequired() bool {
	_, err := os.Stat("/var/run/reboot-required")
	return err == nil
}

// parseAptPackages parsuje output `apt list --upgradable`
// Format linii: "name/suite version arch [upgradable from: oldver]"
func parseAptPackages(output string) []UpdatePackage {
	var pkgs []UpdatePackage
	securitySuites := []string{"security", "ESM"}

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing...") || strings.HasPrefix(line, "WARNING") {
			continue
		}

		// name/suite version arch [upgradable from: oldver]
		slashIdx := strings.Index(line, "/")
		if slashIdx < 0 {
			continue
		}
		name := line[:slashIdx]
		rest := line[slashIdx+1:]

		// Wyciągnij nową wersję (drugie pole)
		fields := strings.Fields(rest)
		if len(fields) < 2 {
			continue
		}
		suite := fields[0]     // np. "noble-security/now"
		newVer := fields[1]    // np. "3.0.13-0ubuntu3.5"

		// Stara wersja — "upgradable from: X"
		oldVer := ""
		if idx := strings.Index(line, "upgradable from: "); idx >= 0 {
			oldVer = strings.TrimSuffix(strings.TrimSpace(line[idx+17:]), "]")
		}

		// Ustal typ
		pkgType := "update"
		for _, sec := range securitySuites {
			if strings.Contains(suite, sec) {
				pkgType = "security"
				break
			}
		}

		pkgs = append(pkgs, UpdatePackage{
			Name:     name,
			Current:  oldVer,
			Next:     newVer,
			Type:     pkgType,
			Size:     "—",
			Selected: pkgType == "security",
		})
	}
	return pkgs
}

// aptPackageSizes pobiera rozmiary przez `apt-get install --dry-run`
func aptPackageSizes(names []string) map[string]string {
	sizes := make(map[string]string)
	if len(names) == 0 {
		return sizes
	}
	args := append([]string{"-s", "-o", "APT::Get::Show-User-Simulation-Note=no", "install"}, names...)
	out, err := exec.Command("apt-get", args...).Output()
	if err != nil {
		return sizes
	}
	// Szukaj linii: "Inst name [old] (new [...])"
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "Inst ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		sizes[fields[1]] = "—" // placeholder — pełny rozmiar wymaga apt-cache show
	}
	return sizes
}

// parseAptHistory parsuje /var/log/apt/history.log
func parseAptHistory() []UpdateHistoryEntry {
	data, err := os.ReadFile("/var/log/apt/history.log")
	if err != nil {
		return nil
	}

	var entries []UpdateHistoryEntry
	var cur map[string]string
	flush := func() {
		if cur == nil {
			return
		}
		// Zlicz pakiety z "Install:" i "Upgrade:"
		count := 0
		if v := cur["Upgrade"]; v != "" {
			count += len(strings.Split(v, "), "))
		}
		if v := cur["Install"]; v != "" {
			count += len(strings.Split(v, "), "))
		}
		action := cur["Commandline"]
		if action == "" {
			action = "apt"
		}
		// Uprość: zostaw tylko "apt upgrade" itp.
		if idx := strings.Index(action, "upgrade"); idx >= 0 {
			action = "apt upgrade"
		} else if idx := strings.Index(action, "install"); idx >= 0 {
			action = "apt install"
		}

		status := "ok"
		note := strconv.Itoa(count) + " pakietów"
		if cur["Error"] != "" {
			status = "err"
			note = "Błąd: " + cur["Error"]
		}
		if count == 0 {
			cur = nil
			return
		}

		// Data
		dateStr := cur["Start-Date"]
		entries = append([]UpdateHistoryEntry{{
			Date:   dateStr,
			Action: action,
			Count:  count,
			Status: status,
			Note:   note,
		}}, entries...)
		cur = nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			flush()
			continue
		}
		if colonIdx := strings.Index(line, ": "); colonIdx >= 0 {
			key := line[:colonIdx]
			val := line[colonIdx+2:]
			if cur == nil {
				cur = make(map[string]string)
			}
			cur[key] = val
		}
	}
	flush()

	// Limit 20 wpisów
	if len(entries) > 20 {
		entries = entries[:20]
	}
	return entries
}

// readSourcesList zwraca zawartość /etc/apt/sources.list
func readSourcesList() string {
	data, err := os.ReadFile("/etc/apt/sources.list")
	if err != nil {
		return "# nie można odczytać /etc/apt/sources.list"
	}
	return string(data)
}

// readUnattendedConfig zwraca konfigurację unattended-upgrades
func readUnattendedConfig() map[string]bool {
	cfg := map[string]bool{
		"auto_update":   false,
		"auto_security": false,
		"auto_reboot":   false,
	}
	data, err := os.ReadFile("/etc/apt/apt.conf.d/50unattended-upgrades")
	if err != nil {
		// Spróbuj 20auto-upgrades
		data2, err2 := os.ReadFile("/etc/apt/apt.conf.d/20auto-upgrades")
		if err2 != nil {
			return cfg
		}
		data = data2
	}
	content := string(data)
	if strings.Contains(content, `Unattended-Upgrade::Automatic "1"`) ||
		strings.Contains(content, `APT::Periodic::Unattended-Upgrade "1"`) {
		cfg["auto_update"] = true
	}
	if strings.Contains(content, "security.ubuntu.com") || strings.Contains(content, "security") {
		cfg["auto_security"] = true
	}
	if strings.Contains(content, `Automatic-Reboot "true"`) {
		cfg["auto_reboot"] = true
	}
	return cfg
}

// ─── Handlery ────────────────────────────────────────────────────────────────

// GET /system/updates/check — uruchamia `apt update` i zwraca listę pakietów
func (s *Server) handleUpdatesCheck(w http.ResponseWriter, r *http.Request) {
	// Uruchom apt update (wymaga uprawnień — serwer działa jako root lub z sudo)
	out, err := exec.Command("apt-get", "update", "-q").CombinedOutput()
	if err != nil {
		// Nie blokuj — może być np. lock file, zwróć mimo to listę
		_ = out
	}

	// Pobierz listę pakietów do aktualizacji
	listOut, _ := exec.Command("apt", "list", "--upgradable", "--quiet=2").Output()
	pkgs := parseAptPackages(string(listOut))

	jsonOK(w, map[string]any{
		"packages":        pkgs,
		"total":           len(pkgs),
		"security":        countType(pkgs, "security"),
		"reboot_required": rebootRequired(),
		"checked_at":      time.Now().Format("2006-01-02 15:04"),
	})
}

// GET /system/updates/packages — tylko lista (bez `apt update`)
func (s *Server) handleUpdatesPackages(w http.ResponseWriter, r *http.Request) {
	listOut, _ := exec.Command("apt", "list", "--upgradable", "--quiet=2").Output()
	pkgs := parseAptPackages(string(listOut))
	jsonOK(w, map[string]any{
		"packages":        pkgs,
		"total":           len(pkgs),
		"security":        countType(pkgs, "security"),
		"reboot_required": rebootRequired(),
		"checked_at":      time.Now().Format("2006-01-02 15:04"),
	})
}

// POST /system/updates/install — instaluje podane pakiety, zwraca log przez SSE
// Body: { "packages": ["pkg1","pkg2",...] }
// Response: text/event-stream (Server-Sent Events) z liniami loga
func (s *Server) handleUpdatesInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Packages []string `json:"packages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Packages) == 0 {
		jsonErr(w, "brak listy pakietów", http.StatusBadRequest)
		return
	}

	// Sprawdź czy nie trwa już instalacja
	installMu.Lock()
	if installRunning {
		installMu.Unlock()
		jsonErr(w, "instalacja już trwa", http.StatusConflict)
		return
	}
	installRunning = true
	installLog = nil
	installDone = false
	installMu.Unlock()

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, canFlush := w.(http.Flusher)

	sendLine := func(line string) {
		installMu.Lock()
		installLog = append(installLog, line)
		installMu.Unlock()
		_, _ = w.Write([]byte("data: " + line + "\n\n"))
		if canFlush {
			flusher.Flush()
		}
	}

	sendLine("Przygotowanie do instalacji…")
	sendLine("Pakiety: " + strings.Join(req.Packages, ", "))
	sendLine("")

	// Uruchom apt-get install -y
	args := append([]string{
		"apt-get", "install", "-y",
		"-o", "Dpkg::Progress-Fancy=0",
		"-o", "APT::Color=0",
	}, req.Packages...)
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "LC_ALL=C")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendLine("BŁĄD: " + err.Error())
		sendLine("event: done")
		sendLine("data: error")
		installMu.Lock(); installRunning = false; installDone = true; installMu.Unlock()
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		sendLine("BŁĄD: " + err.Error())
		installMu.Lock(); installRunning = false; installDone = true; installMu.Unlock()
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		// Pomiń puste linie debconf
		if strings.Contains(line, "debconf") && strings.Contains(line, "DEBCONF") {
			continue
		}
		sendLine(line)
	}

	err = cmd.Wait()
	if err != nil {
		sendLine("")
		sendLine("✗ Instalacja zakończyła się błędem: " + err.Error())
	} else {
		sendLine("")
		sendLine("✓ Aktualizacja zakończona pomyślnie.")
		if rebootRequired() {
			sendLine("⚠ Wymagany restart systemu (nowe jądro lub biblioteki).")
		}
	}

	// Wyślij zdarzenie "done"
	_, _ = w.Write([]byte("event: done\ndata: " + func() string {
		if err != nil { return "error" }
		return "ok"
	}() + "\n\n"))
	if canFlush {
		flusher.Flush()
	}

	installMu.Lock()
	installRunning = false
	installDone = true
	installMu.Unlock()
}

// GET /system/updates/install — zwraca aktualny log instalacji (polling fallback)
func (s *Server) handleUpdatesInstallLog(w http.ResponseWriter, r *http.Request) {
	installMu.Lock()
	log := append([]string(nil), installLog...)
	done := installDone
	running := installRunning
	installMu.Unlock()
	jsonOK(w, map[string]any{
		"log":     log,
		"done":    done,
		"running": running,
	})
}

// GET /system/updates/changelog?package=name — zwraca changelog pakietu
func (s *Server) handleUpdatesChangelog(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		jsonErr(w, "brak parametru package", http.StatusBadRequest)
		return
	}
	// apt-get changelog może wymagać sieci — użyj apt-cache show jako fallback
	out, err := exec.Command("apt-get", "changelog", "--no-download", pkg).Output()
	if err != nil || len(out) == 0 {
		out2, _ := exec.Command("apt-cache", "show", pkg).Output()
		jsonOK(w, map[string]any{"package": pkg, "changelog": string(out2), "source": "apt-cache show"})
		return
	}
	// Zwróć pierwsze 4000 znaków
	content := string(out)
	if len(content) > 4000 {
		content = content[:4000] + "\n…(obcięto)"
	}
	jsonOK(w, map[string]any{"package": pkg, "changelog": content, "source": "apt-get changelog"})
}

// GET /system/updates/details?package=name — apt-cache show
func (s *Server) handleUpdatesDetails(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		jsonErr(w, "brak parametru package", http.StatusBadRequest)
		return
	}
	out, _ := exec.Command("apt-cache", "show", pkg).Output()
	info := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		if colonIdx := strings.Index(line, ": "); colonIdx > 0 {
			key := strings.TrimSpace(line[:colonIdx])
			val := strings.TrimSpace(line[colonIdx+2:])
			// Zachowaj najważniejsze pola
			switch key {
			case "Package", "Version", "Installed-Size", "Maintainer", "Description", "Homepage", "Section":
				info[key] = val
			}
		}
	}
	jsonOK(w, map[string]any{"package": pkg, "info": info})
}

// GET/POST /api/system/update — pełny apt upgrade (prosty, bez SSE)
func (s *Server) handleSystemUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		// Status
		listOut, _ := exec.Command("apt", "list", "--upgradable", "--quiet=2").Output()
		pkgs := parseAptPackages(string(listOut))
		jsonOK(w, map[string]any{
			"packages":        pkgs,
			"total":           len(pkgs),
			"reboot_required": rebootRequired(),
		})
		return
	}
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Uruchom w tle — długa operacja
	go func() {
		cmd := exec.Command("apt-get", "upgrade", "-y")
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
		installMu.Lock()
		installRunning = true
		installLog = nil
		installDone = false
		installMu.Unlock()

		out, err := cmd.CombinedOutput()

		installMu.Lock()
		installLog = strings.Split(string(out), "\n")
		installRunning = false
		installDone = true
		if err != nil {
			installLog = append(installLog, "BŁĄD: "+err.Error())
		}
		installMu.Unlock()
	}()
	jsonOK(w, map[string]string{"status": "started", "message": "apt-get upgrade uruchomiony w tle"})
}

// POST /api/system/schedule-update — zaplanuj apt upgrade przez at
func (s *Server) handleScheduleUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Time string `json:"time"` // "03:00" lub "now+2hours"
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Time == "" {
		req.Time = "03:00"
	}
	// Sprawdź czy `at` jest zainstalowany
	if _, err := exec.LookPath("at"); err != nil {
		jsonErr(w, "polecenie 'at' niedostępne — zainstaluj pakiet at", http.StatusServiceUnavailable)
		return
	}
	cmd := exec.Command("at", req.Time)
	cmd.Stdin = strings.NewReader("apt-get upgrade -y\n")
	out, err := cmd.CombinedOutput()
	if err != nil {
		jsonErr(w, "błąd planowania: "+string(out), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "scheduled", "time": req.Time, "output": string(out)})
}

// GET /system/updates/history — parsuje /var/log/apt/history.log
func (s *Server) handleUpdatesHistory(w http.ResponseWriter, r *http.Request) {
	entries := parseAptHistory()
	if entries == nil {
		entries = []UpdateHistoryEntry{}
	}
	jsonOK(w, map[string]any{"history": entries})
}

// GET /system/updates/auto-config — konfiguracja unattended-upgrades
func (s *Server) handleUpdatesAutoConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		cfg := readUnattendedConfig()
		sources := readSourcesList()
		jsonOK(w, map[string]any{
			"config":  cfg,
			"sources": sources,
		})
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			AutoUpdate   bool `json:"auto_update"`
			AutoSecurity bool `json:"auto_security"`
			AutoReboot   bool `json:"auto_reboot"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		boolStr := func(v bool) string {
			if v { return "1" } else { return "0" }
		}

		// Zapisz do 20auto-upgrades
		autoUpgradesContent := `APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "` + boolStr(req.AutoUpdate) + `";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "` + boolStr(req.AutoUpdate) + `";
`
		os.WriteFile("/etc/apt/apt.conf.d/20auto-upgrades", []byte(autoUpgradesContent), 0644)

		// AutoReboot w 50unattended-upgrades
		if req.AutoReboot {
			exec.Command("sed", "-i",
				`s|//Unattended-Upgrade::Automatic-Reboot .*|Unattended-Upgrade::Automatic-Reboot "true";|`,
				"/etc/apt/apt.conf.d/50unattended-upgrades").Run()
		} else {
			exec.Command("sed", "-i",
				`s|Unattended-Upgrade::Automatic-Reboot .*|//Unattended-Upgrade::Automatic-Reboot "false";|`,
				"/etc/apt/apt.conf.d/50unattended-upgrades").Run()
		}

		jsonOK(w, map[string]string{"status": "ok"})
		return
	}
	jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
}

// GET /system/updates/reboot-required
func (s *Server) handleUpdatesRebootRequired(w http.ResponseWriter, r *http.Request) {
	required := rebootRequired()
	packages := ""
	if required {
		data, _ := os.ReadFile("/var/run/reboot-required.pkgs")
		packages = string(data)
	}
	jsonOK(w, map[string]any{
		"required": required,
		"packages": strings.TrimSpace(packages),
	})
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func countType(pkgs []UpdatePackage, t string) int {
	n := 0
	for _, p := range pkgs {
		if p.Type == t { n++ }
	}
	return n
}
