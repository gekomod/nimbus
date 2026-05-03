package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const startupStateFile = "/etc/nas-panel/startup-state.json"

// startupState przechowuje stan przed ostatnim restartem.
type startupState struct {
	DockerRunning []string `json:"docker_running"` // IDs kontenerów które działały
	ZFSImported   bool     `json:"zfs_imported"`   // czy już wykonano zpool import -a
	SavedAt       string   `json:"saved_at"`
}

// SaveStartupState zapisuje aktualny stan do pliku — wywoływany np. przed shutdown/restart.
// Można też wywoływać cyklicznie (patrz: goroutine w runStartupTasks).
func saveStartupState() {
	state := startupState{
		SavedAt: time.Now().Format(time.RFC3339),
	}

	// Pobierz listę działających kontenerów
	out, err := runCmd("docker", "ps", "--format", "{{.ID}}")
	if err == nil && strings.TrimSpace(out) != "" {
		for _, id := range strings.Split(strings.TrimSpace(out), "\n") {
			id = strings.TrimSpace(id)
			if id != "" {
				state.DockerRunning = append(state.DockerRunning, id)
			}
		}
	}

	os.MkdirAll("/etc/nas-panel", 0755)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(startupStateFile, data, 0644)
}

// loadStartupState wczytuje poprzedni stan z dysku.
func loadStartupState() *startupState {
	data, err := os.ReadFile(startupStateFile)
	if err != nil {
		return nil
	}
	var state startupState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil
	}
	return &state
}

// runStartupTasks wykonuje zadania odtworzenia stanu po starcie serwera.
// Uruchamiany w goroutine z NewServer — nie blokuje startu HTTP.
func runStartupTasks() {
	// Wczytaj konfigurację startu
	loadStartupConfig()
	cfg := getStartupConfig()

	// Opóźnienie wg konfiguracji
	delay := cfg.StartupDelay
	if delay <= 0 { delay = 5 }
	log.Printf("[startup] Czekam %d sekund przed wykonaniem zadań…", delay)
	time.Sleep(time.Duration(delay) * time.Second)

	log.Println("[startup] Rozpoczynam zadania startowe…")

	// Powiadomienie o starcie
	if cfg.NotifyBoot {
		sendStartupNotif("🟢 Serwer NAS uruchomiony",
			"Nimbus wystartował. Wykonuję zadania startowe (ZFS, Docker).")
	}

	// ── 1. ZFS: importuj wszystkie dostępne poole ────────────────────────────
	if cfg.ZfsImport {
		importZFSPoolsCfg(cfg)
	} else {
		log.Println("[startup] ZFS import wyłączony w konfiguracji")
	}

	// ── 2. Docker: uruchom kontenery które działały przed restartem ──────────
	if cfg.DockerRestore {
		restoreDockerContainersCfg(cfg)
	} else {
		log.Println("[startup] Przywracanie kontenerów wyłączone w konfiguracji")
	}

	// ── 3. Cykliczny zapis stanu co 2 minuty ─────────────────────────────────
	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			saveStartupState()
		}
	}()

	log.Println("[startup] Zadania startowe zakończone.")
}

// importZFSPools wykonuje `zpool import -a` jeśli zpool jest dostępny.
func importZFSPools() {
	// Sprawdź czy zpool istnieje
	if _, err := runCmd("which", "zpool"); err != nil {
		log.Println("[startup] zpool niedostępny — pomijam import")
		return
	}

	log.Println("[startup] Importuję poole ZFS: zpool import -a")
	out, err := runCmd("zpool", "import", "-a")
	if err != nil {
		// Błąd "no pools available" to nie problem — logujemy info, nie error
		if strings.Contains(out, "no pools available") || strings.Contains(out, "already imported") {
			log.Printf("[startup] ZFS: %s", strings.TrimSpace(out))
		} else {
			log.Printf("[startup] ZFS import warning: %v — %s", err, strings.TrimSpace(out))
		}
	} else {
		log.Printf("[startup] ZFS import zakończony: %s", strings.TrimSpace(out))
	}

	// Dodatkowo: załaduj klucze szyfrowania jeśli są (cicha próba)
	runCmd("zfs", "load-key", "-a")

	// Zamontuj wszystkie datasety
	out2, err2 := runCmd("zfs", "mount", "-a")
	if err2 != nil {
		log.Printf("[startup] ZFS mount -a: %v — %s", err2, strings.TrimSpace(out2))
	} else {
		log.Println("[startup] ZFS: wszystkie datasety zamontowane")
	}
}

// restoreDockerContainers uruchamia kontenery które były uruchomione przed restartem.
func restoreDockerContainers() {
	// Sprawdź czy docker jest dostępny
	if _, err := runCmd("which", "docker"); err != nil {
		log.Println("[startup] docker niedostępny — pomijam przywracanie kontenerów")
		return
	}

	// Poczekaj aż Docker daemon wstanie (max 30s)
	dockerReady := false
	for i := 0; i < 6; i++ {
		if _, err := runCmd("docker", "info"); err == nil {
			dockerReady = true
			break
		}
		log.Printf("[startup] Docker daemon nie gotowy, czekam… (%d/6)", i+1)
		time.Sleep(5 * time.Second)
	}
	if !dockerReady {
		log.Println("[startup] Docker daemon nie wystartował — pomijam przywracanie kontenerów")
		return
	}

	state := loadStartupState()
	if state == nil || len(state.DockerRunning) == 0 {
		log.Println("[startup] Brak zapisanego stanu Docker lub lista pusta — pomijam")
		return
	}

	log.Printf("[startup] Przywracam %d kontenerów Docker…", len(state.DockerRunning))

	started := 0
	skipped := 0
	failed  := 0

	for _, id := range state.DockerRunning {
		// Sprawdź czy kontener nadal istnieje
		statusOut, err := runCmd("docker", "inspect", "--format", "{{.State.Status}}", id)
		if err != nil {
			log.Printf("[startup] Kontener %s nie istnieje — pomijam", id)
			skipped++
			continue
		}

		status := strings.TrimSpace(statusOut)

		// Jeśli już działa — pomiń
		if status == "running" {
			log.Printf("[startup] Kontener %s już działa", id)
			skipped++
			continue
		}

		// Sprawdź policy restart — jeśli always/unless-stopped to Docker sam go wznowi
		policyOut, _ := runCmd("docker", "inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}", id)
		policy := strings.TrimSpace(policyOut)
		if policy == "always" || policy == "unless-stopped" {
			log.Printf("[startup] Kontener %s ma restart policy=%s — Docker uruchomi go sam", id, policy)
			skipped++
			continue
		}

		// Uruchom kontener
		_, err = runCmd("docker", "start", id)
		if err != nil {
			log.Printf("[startup] Nie udało się uruchomić kontenera %s: %v", id, err)
			failed++
		} else {
			log.Printf("[startup] Kontener %s uruchomiony", id)
			started++
		}

		// Małe opóźnienie między startami by nie przeciążyć
		time.Sleep(500 * time.Millisecond)
	}

	log.Printf("[startup] Docker: uruchomiono=%d, pominięto=%d, błąd=%d", started, skipped, failed)

	// Wyczyść stary plik stanu po odtworzeniu
	os.Remove(startupStateFile)

	// Zapisz nowy stan (aktualnie działające)
	saveStartupState()
}

// ── Startup config persisted to disk ────────────────────────────────────────

const startupCfgPath = "/etc/nas-panel/startup-config.json"

type StartupConfig struct {
	StartupDelay    int  `json:"startupDelay"`
	ZfsImport       bool `json:"zfsImport"`
	ZfsMount        bool `json:"zfsMount"`
	ZfsLoadKey      bool `json:"zfsLoadKey"`
	DockerRestore   bool `json:"dockerRestore"`
	DockerSkipPolicy bool `json:"dockerSkipPolicy"`
	DockerNotify    bool `json:"dockerNotify"`
	DockerDelay     int  `json:"dockerDelay"`
	NotifyBoot      bool `json:"notifyBoot"`
	NotifyZFS       bool `json:"notifyZFS"`
	NotifyDocker    bool `json:"notifyDocker"`
	NotifyShutdown  bool `json:"notifyShutdown"`
}

var defaultStartupCfg = StartupConfig{
	StartupDelay:     5,
	ZfsImport:        true,
	ZfsMount:         true,
	ZfsLoadKey:       true,
	DockerRestore:    true,
	DockerSkipPolicy: true,
	DockerNotify:     true,
	DockerDelay:      5,
	NotifyBoot:       true,
	NotifyZFS:        true,
	NotifyDocker:     true,
	NotifyShutdown:   true,
}

var (
	startupCfg   = defaultStartupCfg
	startupCfgMu sync.Mutex
)

func loadStartupConfig() {
	data, err := os.ReadFile(startupCfgPath)
	if err != nil { return }
	startupCfgMu.Lock()
	defer startupCfgMu.Unlock()
	json.Unmarshal(data, &startupCfg)
}

func saveStartupConfig() {
	startupCfgMu.Lock()
	data, _ := json.MarshalIndent(startupCfg, "", "  ")
	startupCfgMu.Unlock()
	os.MkdirAll("/etc/nas-panel", 0755)
	os.WriteFile(startupCfgPath, data, 0644)
}

func getStartupConfig() StartupConfig {
	startupCfgMu.Lock()
	defer startupCfgMu.Unlock()
	return startupCfg
}

// ── Notification helper ──────────────────────────────────────────────────────

// sendStartupNotif posts to /api/notifications/channels to fire a notification.
// Since we're inside the same process we call the HTTP endpoint on loopback.
func sendStartupNotif(title, message string) {
	go func() {
		payload := map[string]string{"title": title, "message": message, "severity": "info"}
		data, _ := json.Marshal(payload)
		http.Post("http://localhost:8585/api/notifications/fire", "application/json", strings.NewReader(string(data)))
	}()
}

// ── API handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleStartupConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, getStartupConfig())
	case http.MethodPost:
		var cfg StartupConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest); return
		}
		startupCfgMu.Lock()
		startupCfg = cfg
		startupCfgMu.Unlock()
		saveStartupConfig()
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleStartupLog(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-u", "nimbus", "--no-pager", "-n", "60", "--output=short")
	lines := strings.Split(strings.TrimSpace(out), "\n")
	// Filter only startup-task lines
	var filtered []string
	for _, l := range lines {
		if strings.Contains(l, "[startup]") || strings.Contains(l, "nimbus") {
			filtered = append(filtered, l)
		}
	}
	if len(filtered) == 0 { filtered = lines }
	jsonOK(w, map[string]any{"lines": filtered})
}

func (s *Server) handleStartupAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return
	}
	action := strings.TrimPrefix(r.URL.Path, "/api/startup/")
	switch action {
	case "import-zfs":
		go importZFSPools()
		jsonOK(w, map[string]string{"status": "started"})
	case "restore-docker":
		go restoreDockerContainers()
		jsonOK(w, map[string]string{"status": "started"})
	case "save-state":
		saveStartupState()
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "unknown action: "+action, http.StatusBadRequest)
	}
}

// ── Wersje z konfiguracją i powiadomieniami ──────────────────────────────────

func importZFSPoolsCfg(cfg StartupConfig) {
	if _, err := runCmd("which", "zpool"); err != nil {
		log.Println("[startup] zpool niedostępny — pomijam import")
		return
	}

	log.Println("[startup] Importuję poole ZFS: zpool import -a")
	out, err := runCmd("zpool", "import", "-a")
	result := "OK"
	if err != nil && !strings.Contains(out, "no pools available") && !strings.Contains(out, "already imported") {
		result = "BŁĄD: " + strings.TrimSpace(out)
		log.Printf("[startup] ZFS import warning: %v — %s", err, out)
	} else {
		log.Printf("[startup] ZFS import: %s", strings.TrimSpace(out))
	}

	if cfg.ZfsLoadKey {
		runCmd("zfs", "load-key", "-a")
	}

	mountResult := ""
	if cfg.ZfsMount {
		out2, err2 := runCmd("zfs", "mount", "-a")
		if err2 != nil {
			mountResult = " | mount: BŁĄD: " + strings.TrimSpace(out2)
		} else {
			mountResult = " | mount: OK"
		}
	}

	if cfg.NotifyZFS {
		sendStartupNotif("💾 ZFS import zakończony",
			"zpool import -a: "+result+mountResult)
	}
}

func restoreDockerContainersCfg(cfg StartupConfig) {
	if _, err := runCmd("which", "docker"); err != nil {
		log.Println("[startup] docker niedostępny — pomijam przywracanie")
		return
	}

	delay := cfg.DockerDelay
	if delay <= 0 { delay = 5 }

	dockerReady := false
	for i := 0; i < 6; i++ {
		if _, err := runCmd("docker", "info"); err == nil {
			dockerReady = true
			break
		}
		log.Printf("[startup] Docker daemon nie gotowy, czekam… (%d/6)", i+1)
		time.Sleep(time.Duration(delay) * time.Second)
	}
	if !dockerReady {
		if cfg.NotifyDocker {
			sendStartupNotif("🐳 Docker — błąd przywracania",
				"Docker daemon nie wystartował w wymaganym czasie.")
		}
		return
	}

	state := loadStartupState()
	if state == nil || len(state.DockerRunning) == 0 {
		log.Println("[startup] Brak zapisanego stanu Docker")
		if cfg.NotifyDocker {
			sendStartupNotif("🐳 Docker — brak stanu",
				"Nie znaleziono zapisanego stanu kontenerów (pierwszy start?).")
		}
		return
	}

	started, skipped, failed := 0, 0, 0

	for _, id := range state.DockerRunning {
		statusOut, err := runCmd("docker", "inspect", "--format", "{{.State.Status}}", id)
		if err != nil { skipped++; continue }

		if strings.TrimSpace(statusOut) == "running" { skipped++; continue }

		if cfg.DockerSkipPolicy {
			policyOut, _ := runCmd("docker", "inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}", id)
			policy := strings.TrimSpace(policyOut)
			if policy == "always" || policy == "unless-stopped" { skipped++; continue }
		}

		_, err = runCmd("docker", "start", id)
		if err != nil { failed++ } else { started++ }
		time.Sleep(500 * time.Millisecond)
	}

	log.Printf("[startup] Docker: uruchomiono=%d, pominięto=%d, błąd=%d", started, skipped, failed)
	os.Remove(startupStateFile)
	saveStartupState()

	if cfg.NotifyDocker {
		msg := strings.Join([]string{
			"✅ uruchomiono: " + itoa(started),
			"⏭ pominięto: " + itoa(skipped),
		}, " | ")
		if failed > 0 { msg += " | ❌ błąd: " + itoa(failed) }
		sendStartupNotif("🐳 Docker — kontenery przywrócone", msg)
	}
}
