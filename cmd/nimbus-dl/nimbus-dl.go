// nimbus-dl — standalone Download Center daemon dla projektu nimbus
//
// Kompilacja:  go build -o nimbus-dl cmd/nimbus-dl/nimbus-dl.go
// Lokalizacja: cmd/nimbus-dl/nimbus-dl.go  (osobny pakiet — nie w cmd/nimbus/)
// Uruchomienie: ./nimbus-dl [-port 9797] [-token SECRET]
// Systemd:     patrz komentarz na końcu pliku
//
// API:
//   /api/downloads/*          — kolejka pobierań (identyczne z głównym server.go)
//   /api/downloads/arr/*      — integracje *arr (Sonarr, Radarr, qBit, SABnzbd, Prowlarr)
//   /api/downloads/rss/*      — RSS monitorowanie
//   /api/dl/status            — health check

package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ─── Konfiguracja ─────────────────────────────────────────────────────────────

var (
	flagPort       = flag.Int("port", 9797, "port nasłuchu")
	flagToken      = flag.String("token", "", "Bearer token do autoryzacji (pusty = brak auth)")
	flagStateDir   = flag.String("state", "/var/lib/nimbus", "katalog na stan (downloads.json)")
	flagConfigDir  = flag.String("config", "/etc/nas-panel", "katalog konfiguracji")
	flagLocalhostOnly = flag.Bool("localhost", false, "nasłuchuj tylko na 127.0.0.1")
)

const version = "1.0.0"

// ─── Typy ─────────────────────────────────────────────────────────────────────

type DownloadTask struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	Filename  string  `json:"filename"`
	DestDir   string  `json:"dest_dir"`
	Status    string  `json:"status"`
	Progress  float64 `json:"progress"`
	Speed     string  `json:"speed"`
	SizeTotal string  `json:"size_total"`
	SizeDone  string  `json:"size_done"`
	ETA       string  `json:"eta"`
	Error     string  `json:"error,omitempty"`
	CreatedAt string  `json:"created_at"`
	DoneAt    string  `json:"done_at,omitempty"`
	Category  string  `json:"category"`
}

type DLConfig struct {
	DefaultDir    string `json:"default_dir"`
	MaxConcurrent int    `json:"max_concurrent"`
}

type CDAConfig struct {
	DefaultQuality string `json:"default_quality"`
	SessionCookie  string `json:"session_cookie"`
}

type cdaPlayerData struct {
	Video struct {
		ID            string            `json:"id"`
		Title         string            `json:"title"`
		ManifestApple string            `json:"manifest_apple"`
		Manifest      string            `json:"manifest"`
		Qualities     map[string]string `json:"qualities"`
		Duration      json.Number       `json:"duration"`
		Thumb         string            `json:"thumb"`
		ForAdults     bool              `json:"for_adults"`
		Premium       bool              `json:"premium"`
	} `json:"video"`
}

type CDAFolderItem struct {
	VideoID  string `json:"video_id"`
	URL      string `json:"url"`
	Title    string `json:"title"`
	Thumb    string `json:"thumb"`
	Duration string `json:"duration"`
}

// ─── Typy integracji *arr ─────────────────────────────────────────────────────

// ArrService opisuje jedno połączenie z serwisem *arr / qBit / SABnzbd
type ArrService struct {
	ID       string `json:"id"`        // "sonarr", "radarr", "qbit", "sabnzbd", "prowlarr", "bazarr"
	Name     string `json:"name"`
	URL      string `json:"url"`       // np. "http://localhost:8989"
	APIKey   string `json:"api_key"`
	Username string `json:"username"`  // qBittorrent: login
	Password string `json:"password"`  // qBittorrent: hasło
	Enabled  bool   `json:"enabled"`
}

// ArrStatus to wynik odpytania serwisu — zwracany do frontendu
type ArrStatus struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	State       string `json:"state"`        // "running" | "unreachable" | "disabled" | "error"
	Version     string `json:"version"`
	Active      int    `json:"active"`       // aktywne pobierania (queue count)
	Speed       string `json:"speed"`        // opis aktywności
	Err         string `json:"error,omitempty"`
	Enabled     bool   `json:"enabled"`
	HasKey      bool   `json:"has_key"`
	Username    string `json:"username"`
	HasPassword bool   `json:"has_password"`
}

// RSSFeed opisuje jeden feed RSS monitorowany przez nimbus-dl
type RSSFeed struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Enabled   bool   `json:"enabled"`
	Filter    string `json:"filter"`     // regex filtr tytułów
	DestDir   string `json:"dest_dir"`
	LastFetch string `json:"last_fetch,omitempty"`
	Items     int    `json:"items"`
	Matched   int    `json:"matched"`
	Dropped   int    `json:"dropped"`
}

// ArrConfig przechowuje konfigurację wszystkich serwisów i feedów
type ArrConfig struct {
	Services []ArrService `json:"services"`
	Feeds    []RSSFeed    `json:"rss_feeds"`
}

// ─── Stan globalny ────────────────────────────────────────────────────────────

var (
	dlMu    sync.Mutex
	dlTasks = map[string]*DownloadTask{}
	dlOrder []string

	dlPIDsMu sync.Mutex
	dlPIDs   = map[string]int{} // task ID → PID procesu

	dlSchedMu sync.Mutex
	dlActive  int
	dlWakeUp  = make(chan struct{}, 1)

	cdaSessionMu      sync.Mutex
	cdaSessionCookies string
	cdaSessionExpiry  time.Time

	statePath  string // /var/lib/nimbus/downloads.json
	configPath string // /etc/nas-panel/downloads-config.json
	cdaPath    string // /etc/nas-panel/cda-config.json
	arrPath    string // /etc/nas-panel/dl-integrations.json
)

// ─── main ─────────────────────────────────────────────────────────────────────

func main() {
	flag.Parse()

	statePath  = filepath.Join(*flagStateDir, "downloads.json")
	configPath = filepath.Join(*flagConfigDir, "downloads-config.json")
	cdaPath    = filepath.Join(*flagConfigDir, "cda-config.json")
	arrPath    = filepath.Join(*flagConfigDir, "dl-integrations.json")

	os.MkdirAll(*flagStateDir, 0755)
	os.MkdirAll(*flagConfigDir, 0755)
	os.MkdirAll(defaultDownloadDir(), 0755)

	loadState()
	go dlScheduler()
	go rssPoller() // odpytuje RSS feedy co 15 minut

	// Zatrzymaj aktywne zadania przy wyłączeniu
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-c
		log.Println("nimbus-dl: zatrzymuję...")
		killAllActive()
		os.Exit(0)
	}()

	mux := http.NewServeMux()
	registerRoutes(mux)

	addr := fmt.Sprintf(":%d", *flagPort)
	if *flagLocalhostOnly {
		addr = fmt.Sprintf("127.0.0.1:%d", *flagPort)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           corsMiddleware(authMiddleware(mux)),
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second, // długie dla streaming install-tool
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("nimbus-dl v%s nasłuchuję na %s", version, addr)
	if *flagToken != "" {
		log.Printf("nimbus-dl: autoryzacja Bearer token aktywna")
	} else {
		log.Printf("nimbus-dl: UWAGA — brak tokena, API dostępne bez autoryzacji")
	}

	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("nimbus-dl: błąd serwera: %v", err)
	}
}

// ─── Middleware ────────────────────────────────────────────────────────────────

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *flagToken == "" {
			// Brak tokena — akceptuj tylko z localhost
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				host = r.RemoteAddr
			}
			if host != "127.0.0.1" && host != "::1" && host != "localhost" {
				jsonErr(w, "unauthorized — ustaw -token dla dostępu zdalnego", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// Sprawdź token: X-Dl-Token header lub ?token= query param
		token := r.Header.Get("X-Dl-Token")
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		if token == "" {
			// Spróbuj też Authorization: Bearer ...
			if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
		}
		if token != *flagToken {
			jsonErr(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Dl-Token, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Routing ──────────────────────────────────────────────────────────────────

func registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/downloads",                 handleDownloadsList)
	mux.HandleFunc("/api/downloads/add",             handleDownloadsAdd)
	mux.HandleFunc("/api/downloads/cancel",          handleDownloadsCancel)
	mux.HandleFunc("/api/downloads/delete",          handleDownloadsDelete)
	mux.HandleFunc("/api/downloads/retry",           handleDownloadsRetry)
	mux.HandleFunc("/api/downloads/clear-done",      handleDownloadsClearDone)
	mux.HandleFunc("/api/downloads/config",          handleDownloadsConfig)
	mux.HandleFunc("/api/downloads/config/save",     handleDownloadsConfigSave)
	mux.HandleFunc("/api/downloads/tools",           handleDownloadsTools)
	mux.HandleFunc("/api/downloads/install-tool",    handleDownloadsInstallTool)
	mux.HandleFunc("/api/downloads/cda-config",      handleCDAConfig)
	mux.HandleFunc("/api/downloads/cda-config/save", handleCDAConfigSave)
	mux.HandleFunc("/api/downloads/cda-test",        handleCDATest)
	mux.HandleFunc("/api/downloads/cda-preview",     handleCDAPreview)
	mux.HandleFunc("/api/downloads/cda-folder",      handleCDAFolder)
	mux.HandleFunc("/api/downloads/sibnet-preview",  handleSibnetPreview)

	// Integracje *arr / qBit / SABnzbd
	mux.HandleFunc("/api/downloads/arr/services",        handleArrServices)     // GET lista + status
	mux.HandleFunc("/api/downloads/arr/services/save",   handleArrServicesSave) // POST zapis konfiguracji
	mux.HandleFunc("/api/downloads/arr/services/test",   handleArrServicesTest) // POST test połączenia
	mux.HandleFunc("/api/downloads/arr/status",          handleArrStatus)       // GET live status wszystkich
	mux.HandleFunc("/api/downloads/arr/notify",          handleArrNotify)       // POST wyślij powiadomienie po pobraniu
	mux.HandleFunc("/api/downloads/arr/queue",           handleArrQueue)        // GET zadania z qBit/Sonarr/Radarr

	// RSS monitorowanie
	mux.HandleFunc("/api/downloads/rss",             handleRSSList)    // GET lista feedów
	mux.HandleFunc("/api/downloads/rss/save",        handleRSSSave)    // POST zapisz feedy
	mux.HandleFunc("/api/downloads/rss/refresh",     handleRSSRefresh) // POST odśwież feed (id w body)
	mux.HandleFunc("/api/downloads/rss/history",     handleRSSHistory) // GET ostatnie matched itemy

	// Health / status
	mux.HandleFunc("/api/dl/status",  handleStatus)
	mux.HandleFunc("/api/dl/version", handleVersion)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

// ─── Persystencja ─────────────────────────────────────────────────────────────

func loadState() {
	data, err := os.ReadFile(statePath)
	if err != nil {
		return
	}
	var tasks []*DownloadTask
	if json.Unmarshal(data, &tasks) != nil {
		return
	}
	for _, t := range tasks {
		// Przy starcie resetnuj aktywne → queued, żeby retry działał
		if t.Status == "downloading" {
			t.Status = "queued"
			t.Speed  = ""
			t.ETA    = ""
		}
		dlTasks[t.ID] = t
		dlOrder = append(dlOrder, t.ID)
	}
	log.Printf("nimbus-dl: wczytano %d zadań z %s", len(tasks), statePath)
	// Obudź scheduler — mogą być zadania w queued
	dlEnqueue()
}

func saveState() {
	dlMu.Lock()
	result := make([]*DownloadTask, 0, len(dlOrder))
	for _, id := range dlOrder {
		if t, ok := dlTasks[id]; ok {
			result = append(result, t)
		}
	}
	dlMu.Unlock()

	data, _ := json.MarshalIndent(result, "", "  ")
	os.WriteFile(statePath, data, 0644)
}

// ─── Config helpers ───────────────────────────────────────────────────────────

func loadDLConfig() DLConfig {
	cfg := DLConfig{DefaultDir: defaultDownloadDir(), MaxConcurrent: 3}
	data, err := os.ReadFile(configPath)
	if err == nil {
		json.Unmarshal(data, &cfg)
	}
	if cfg.DefaultDir == "" {
		cfg.DefaultDir = defaultDownloadDir()
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 3
	}
	return cfg
}

func saveDLConfig(cfg DLConfig) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath, data, 0644)
}

func loadCDAConfig() CDAConfig {
	cfg := CDAConfig{DefaultQuality: "best"}
	data, err := os.ReadFile(cdaPath)
	if err == nil {
		json.Unmarshal(data, &cfg)
	}
	return cfg
}

func saveCDAConfig(cfg CDAConfig) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(cdaPath, data, 0600)
}

func defaultDownloadDir() string {
	return filepath.Join(*flagStateDir, "downloads")
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

func dlEnqueue() {
	select {
	case dlWakeUp <- struct{}{}:
	default:
	}
}

func dlScheduler() {
	for range dlWakeUp {
		for {
			dlSchedMu.Lock()
			maxC := loadDLConfig().MaxConcurrent

			if dlActive >= maxC {
				dlSchedMu.Unlock()
				break
			}

			dlMu.Lock()
			var nextID string
			for _, id := range dlOrder {
				if t, ok := dlTasks[id]; ok && t.Status == "queued" {
					nextID = id
					break
				}
			}
			dlMu.Unlock()

			if nextID == "" {
				dlSchedMu.Unlock()
				break
			}

			dlActive++
			dlSchedMu.Unlock()

			go func(id string) {
				defer func() {
					dlSchedMu.Lock()
					dlActive--
					dlSchedMu.Unlock()
					dlPIDsMu.Lock()
					delete(dlPIDs, id)
					dlPIDsMu.Unlock()
					dlEnqueue()
				}()
				runDownload(id)
			}(nextID)
		}
	}
}

func killAllActive() {
	dlPIDsMu.Lock()
	defer dlPIDsMu.Unlock()
	for _, pid := range dlPIDs {
		syscall.Kill(pid, syscall.SIGTERM)
	}
}

// ─── runDownload ──────────────────────────────────────────────────────────────

func runDownload(id string) {
	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok {
		dlMu.Unlock()
		return
	}
	t.Status = "downloading"
	cat := t.Category
	dlMu.Unlock()

	switch cat {
	case "cda":
		runCDADownload(id)
	case "sibnet":
		runSibnetDownload(id)
	case "yt":
		runYTDownload(id)
	case "torrent":
		runTorrentDownload(id)
	default:
		runWgetDownload(id)
	}
}

func dlSetError(id, msg string) {
	dlMu.Lock()
	if t, ok := dlTasks[id]; ok {
		t.Status = "error"
		t.Error  = msg
		t.Speed  = ""
		t.ETA    = ""
	}
	dlMu.Unlock()
	saveState()
	log.Printf("nimbus-dl [%s] BŁĄD: %s", id, msg)
}

func dlSetDone(id string) {
	dlMu.Lock()
	if t, ok := dlTasks[id]; ok {
		t.Status   = "done"
		t.Progress = 100
		t.DoneAt   = time.Now().Format("2006-01-02 15:04:05")
		t.Speed    = ""
		t.ETA      = ""
	}
	dlMu.Unlock()
	saveState()
	// Powiadom Sonarr/Radarr w tle
	go autoNotifyArr(id)
}

func dlIsCancelled(id string) bool {
	dlMu.Lock()
	defer dlMu.Unlock()
	t, ok := dlTasks[id]
	return ok && t.Status == "cancelled"
}

func dlSetMsg(id, msg string) {
	dlMu.Lock()
	if t, ok := dlTasks[id]; ok {
		t.Speed = msg
	}
	dlMu.Unlock()
}

func dlRegisterPID(id string, pid int) {
	dlPIDsMu.Lock()
	dlPIDs[id] = pid
	dlPIDsMu.Unlock()
}

// ─── wget downloader ──────────────────────────────────────────────────────────

func runWgetDownload(id string) {
	dlMu.Lock()
	t := dlTasks[id]
	dest := filepath.Join(t.DestDir, t.Filename)
	dlMu.Unlock()

	os.MkdirAll(filepath.Dir(dest), 0755)

	cmd := exec.Command("wget",
		"-c",
		"--progress=dot:mega",
		"-P", filepath.Dir(dest),
		"-O", dest,
	)

	dlMu.Lock()
	cmd.Args = append(cmd.Args, dlTasks[id].URL)
	dlMu.Unlock()

	pipe, _ := cmd.StderrPipe()
	cmd.Stdout = cmd.Stderr

	if err := cmd.Start(); err != nil {
		dlSetError(id, "wget: "+err.Error())
		return
	}
	dlRegisterPID(id, cmd.Process.Pid)

	if pipe != nil {
		go parseWgetOutput(id, pipe)
	}

	err := cmd.Wait()

	if dlIsCancelled(id) {
		os.Remove(dest)
		return
	}
	if err != nil {
		dlSetError(id, err.Error())
		return
	}
	dlSetDone(id)
}

func parseWgetOutput(id string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Split(scanLinesOrCR)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		dlMu.Lock()
		t, ok := dlTasks[id]
		if !ok {
			dlMu.Unlock()
			return
		}
		// wget: "  650K .......... 12% 1.23MB/s 45s"
		parts := strings.Fields(line)
		for i, p := range parts {
			if strings.HasSuffix(p, "%") {
				var pct float64
				fmt.Sscanf(p, "%f%%", &pct)
				t.Progress = pct
			}
			if strings.Contains(p, "B/s") {
				t.Speed = p
			}
			if i > 0 && strings.HasSuffix(p, "s") && !strings.Contains(p, "B/s") && i == len(parts)-1 {
				t.ETA = p
			}
			if i < len(parts)-1 && (strings.HasSuffix(p, "K") || strings.HasSuffix(p, "M") || strings.HasSuffix(p, "G")) {
				t.SizeDone = p
			}
		}
		dlMu.Unlock()
	}
}

// ─── yt-dlp downloader ────────────────────────────────────────────────────────

func runYTDownload(id string) {
	dlMu.Lock()
	t := dlTasks[id]
	destDir := t.DestDir
	rawURL  := t.URL
	dlMu.Unlock()

	os.MkdirAll(destDir, 0755)

	ytdlp, err := exec.LookPath("yt-dlp")
	if err != nil {
		if ytdlp, err = exec.LookPath("youtube-dl"); err != nil {
			dlSetError(id, "yt-dlp nie jest zainstalowany — pip3 install yt-dlp")
			return
		}
	}

	cmd := exec.Command(ytdlp,
		"--progress", "--newline",
		"-o", filepath.Join(destDir, "%(title)s.%(ext)s"),
		rawURL,
	)

	pipe, _ := cmd.StderrPipe()
	cmd.Stdout = cmd.Stderr

	if err := cmd.Start(); err != nil {
		dlSetError(id, "yt-dlp: "+err.Error())
		return
	}
	dlRegisterPID(id, cmd.Process.Pid)

	if pipe != nil {
		go parseYTOutput(id, pipe)
	}

	err = cmd.Wait()

	if dlIsCancelled(id) {
		return
	}
	if err != nil {
		dlSetError(id, err.Error())
		return
	}
	dlSetDone(id)
}

func parseYTOutput(id string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "[download]") {
			continue
		}
		dlMu.Lock()
		t, ok := dlTasks[id]
		if !ok {
			dlMu.Unlock()
			return
		}
		parts := strings.Fields(line)
		for i, p := range parts {
			if strings.HasSuffix(p, "%") {
				var pct float64
				fmt.Sscanf(p, "%f%%", &pct)
				t.Progress = pct
			}
			if p == "at" && i+1 < len(parts) {
				t.Speed = parts[i+1]
			}
			if p == "ETA" && i+1 < len(parts) {
				t.ETA = parts[i+1]
			}
			if p == "of" && i+1 < len(parts) {
				t.SizeTotal = parts[i+1]
			}
		}
		dlMu.Unlock()
	}
}

// ─── aria2c downloader ────────────────────────────────────────────────────────

func runTorrentDownload(id string) {
	dlMu.Lock()
	t := dlTasks[id]
	destDir := t.DestDir
	rawURL  := t.URL
	dlMu.Unlock()

	os.MkdirAll(destDir, 0755)

	aria2, err := exec.LookPath("aria2c")
	if err != nil {
		dlSetError(id, "aria2c nie jest zainstalowany — apt install aria2")
		return
	}

	cmd := exec.Command(aria2,
		"--dir="+destDir,
		"--summary-interval=1",
		"--show-console-readout=false",
		"--seed-time=0",           // nie seeduj po pobraniu — od razu wyjdź
		"--max-upload-limit=1K",   // ogranicz upload podczas pobierania
		"--bt-stop-timeout=30",    // zatrzymaj jeśli brak postępu przez 30s (stuck peers)
		rawURL,
	)

	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		dlSetError(id, "aria2c: "+err.Error())
		return
	}
	dlRegisterPID(id, cmd.Process.Pid)

	doneParsing := make(chan struct{})
	go func() {
		defer close(doneParsing)
		parseAria2Output(id, stdout)
	}()

	err = cmd.Wait()
	<-doneParsing // poczekaj aż goroutine skończy parsować

	if dlIsCancelled(id) {
		return
	}
	if err != nil {
		dlSetError(id, err.Error())
		return
	}
	// Wymuś 100% — aria2c mogło wyjść zanim ostatnia linia dotarła do parsera
	dlMu.Lock()
	if t2, ok := dlTasks[id]; ok {
		t2.Progress = 100
	}
	dlMu.Unlock()
	dlSetDone(id)
}

func parseAria2Output(id string, r io.Reader) {
	// aria2c wypisuje linie w różnych formatach:
	// Pobieranie: [#abc123 1.2MiB/5.0MiB(24%) CN:4 SD:3 DL:512KiB ETA:8s]
	// Zakończone: [#abc123 5.0MiB/5.0MiB(100%) CN:0 SD:5 DL:0B UL:0B]
	// Download complete: [#abc123]
	// *** Download complete! ***
	pctRe   := regexp.MustCompile(`\((\d+(?:\.\d+)?)\%\)`)
	dlRe    := regexp.MustCompile(`DL:([\d.]+\w+)`)
	etaRe   := regexp.MustCompile(`ETA:(\S+)`)
	sizeRe  := regexp.MustCompile(`([\d.]+\w+iB)/([\d.]+\w+iB)`)

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()

		// Linia z progresem — musi zawierać nawias z procentem
		if m := pctRe.FindStringSubmatch(line); len(m) > 1 {
			var pct float64
			fmt.Sscanf(m[1], "%f", &pct)

			dlMu.Lock()
			t, ok := dlTasks[id]
			if ok {
				t.Progress = pct
				if dm := dlRe.FindStringSubmatch(line); len(dm) > 1 {
					t.Speed = dm[1]
				}
				if em := etaRe.FindStringSubmatch(line); len(em) > 1 {
					t.ETA = em[1]
				}
				if sm := sizeRe.FindStringSubmatch(line); len(sm) > 2 {
					t.SizeDone  = sm[1]
					t.SizeTotal = sm[2]
				}
				if pct >= 100 {
					t.Speed = ""
					t.ETA   = ""
				}
			}
			dlMu.Unlock()
		}
	}
}

// ─── CDA downloader ───────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Sibnet downloader ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// parseSibnetPage pobiera stronę Sibnet i wyciąga bezpośredni URL do pliku MP4.
// Sibnet umieszcza URL w JS: player.src([{src: "/v/HASH/ID.mp4", type: "video/mp4"}])
// lub jako meta og:video.
func parseSibnetPage(rawURL string) (videoURL, title string, err error) {
	// Normalizuj URL — shell.php?videoid=X → video.sibnet.ru/videoX
	pageURL := rawURL
	if !strings.Contains(pageURL, "://") {
		pageURL = "https://" + pageURL
	}
	// shell.php?videoid=123 jest prawidłowym URL odtwarzacza
	// video.sibnet.ru/videoX też jest prawidłowy

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req.Header.Set("Accept-Language", "ru-RU,ru;q=0.9")
	req.Header.Set("Referer", "https://video.sibnet.ru/")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("HTTP GET: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", err
	}
	html := string(body)

	// Wyciągnij tytuł z og:title lub <title>
	if m := regexp.MustCompile(`(?i)<meta[^>]+property="og:title"[^>]+content="([^"]+)"`).FindStringSubmatch(html); len(m) > 1 {
		title = strings.TrimSpace(m[1])
	} else if m := regexp.MustCompile(`<title>([^<]+)</title>`).FindStringSubmatch(html); len(m) > 1 {
		title = strings.TrimSpace(strings.Split(m[1], " - ")[0])
	}

	// Metoda 1: player.src([{src: "/v/HASH/ID.mp4"}])
	// Sibnet wstawia URL w JavaScript po stronie HTML
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`player\.src\(\s*\[\s*\{\s*src\s*:\s*"(/v/[^"]+\.mp4)"`),
		regexp.MustCompile(`player\.src\(\s*\[\s*\{\s*src\s*:\s*'(/v/[^']+\.mp4)'`),
		regexp.MustCompile(`"src"\s*:\s*"(/v/[^"]+\.mp4)"`),
		regexp.MustCompile(`src:\s*"(/v/[^"]+\.mp4)"`),
	} {
		if m := re.FindStringSubmatch(html); len(m) > 1 {
			videoURL = "https://video.sibnet.ru" + m[1]
			return videoURL, title, nil
		}
	}

	// Metoda 2: og:video meta tag
	if m := regexp.MustCompile(`(?i)<meta[^>]+property="og:video"[^>]+content="([^"]+)"`).FindStringSubmatch(html); len(m) > 1 {
		videoURL = m[1]
		if !strings.HasPrefix(videoURL, "http") {
			videoURL = "https://video.sibnet.ru" + videoURL
		}
		return videoURL, title, nil
	}

	// Metoda 3: bezpośredni link .mp4 w źródle
	if m := regexp.MustCompile(`(https?://[^\s"']+\.mp4)`).FindStringSubmatch(html); len(m) > 1 {
		videoURL = m[1]
		return videoURL, title, nil
	}

	return "", title, fmt.Errorf("nie znaleziono URL wideo w źródle strony sibnet.ru")
}

func runSibnetDownload(id string) {
	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok {
		dlMu.Unlock()
		return
	}
	rawURL  := t.URL
	destDir := t.DestDir
	dlMu.Unlock()

	dlSetMsg(id, "Parsowanie strony Sibnet…")

	videoURL, title, err := parseSibnetPage(rawURL)
	if err != nil {
		dlSetError(id, "Sibnet: "+err.Error())
		return
	}

	log.Printf("nimbus-dl [%s] sibnet: videoURL=%q title=%q", id, videoURL, title)

	// Ustal nazwę pliku
	dlMu.Lock()
	if task := dlTasks[id]; task != nil {
		if task.Filename == "" || task.Filename == "auto" {
			if title != "" {
				sane := regexp.MustCompile(`[^a-zA-Z0-9а-яёА-ЯЁ\-_. ]`).ReplaceAllString(title, "_")
				sane  = strings.TrimSpace(sane)
				task.Filename = sane + ".mp4"
			} else {
				task.Filename = fmt.Sprintf("sibnet_%d.mp4", time.Now().Unix())
			}
		} else if !strings.Contains(task.Filename, ".") {
			task.Filename += ".mp4"
		}
		destDir = task.DestDir
	}
	dlMu.Unlock()

	if err := os.MkdirAll(destDir, 0755); err != nil {
		dlSetError(id, fmt.Sprintf("katalog %q: %v", destDir, err))
		return
	}

	dlMu.Lock()
	filename := dlTasks[id].Filename
	dlMu.Unlock()
	destPath := filepath.Join(destDir, filename)

	// Pobierz przez wget z obsługą przekierowań (Sibnet używa 302 → CDN)
	wget, err := exec.LookPath("wget")
	if err != nil {
		// Fallback: ffmpeg
		runSibnetFFmpeg(id, videoURL, destPath, rawURL)
		return
	}

	const maxRetries = 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if dlIsCancelled(id) {
			return
		}
		if attempt > 1 {
			dlSetMsg(id, fmt.Sprintf("Próba %d/%d…", attempt, maxRetries))
			time.Sleep(time.Duration(attempt*3) * time.Second)
			// Odśwież URL — Sibnet używa tokenizowanych linków
			if newURL, _, err2 := parseSibnetPage(rawURL); err2 == nil && newURL != "" {
				videoURL = newURL
			}
		}

		dlSetMsg(id, fmt.Sprintf("Pobieranie…%s", func() string {
			if attempt > 1 { return fmt.Sprintf(" (próba %d)", attempt) }
			return ""
		}()))

		cmd := exec.Command(wget,
			"-c",
			"--no-check-certificate",
			"-U", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
			"--header=Referer: https://video.sibnet.ru/",
			"-O", destPath,
			videoURL,
		)

		pipe, _ := cmd.StderrPipe()
		cmd.Stdout = cmd.Stderr
		if err := cmd.Start(); err != nil {
			dlSetError(id, "wget: "+err.Error())
			return
		}
		dlRegisterPID(id, cmd.Process.Pid)

		if pipe != nil {
			go parseWgetOutput(id, pipe)
		}

		wgetErr := cmd.Wait()

		if dlIsCancelled(id) {
			os.Remove(destPath)
			return
		}

		if wgetErr == nil {
			// Sprawdź czy plik nie jest pusty lub HTML (błąd strony)
			if info, err2 := os.Stat(destPath); err2 == nil && info.Size() > 102400 {
				dlSetDone(id)
				log.Printf("nimbus-dl [%s] sibnet gotowe: %s", id, destPath)
				return
			} else if err2 == nil && info.Size() < 102400 {
				os.Remove(destPath)
				if attempt < maxRetries {
					dlSetMsg(id, fmt.Sprintf("Plik za mały (%d B) — odświeżam URL…", info.Size()))
					continue
				}
			}
		}

		if attempt >= maxRetries {
			dlSetError(id, fmt.Sprintf("Sibnet wget: %v", wgetErr))
		}
	}
}

// runSibnetFFmpeg używa ffmpeg zamiast wget gdy wget nie jest dostępny
func runSibnetFFmpeg(id, videoURL, destPath, referer string) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		dlSetError(id, "ffmpeg ani wget nie są zainstalowane")
		return
	}

	cmd := exec.Command(ffmpeg,
		"-y", "-loglevel", "info", "-stats",
		"-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
		"-headers", "Referer: https://video.sibnet.ru/\r\n",
		"-i", videoURL,
		"-c", "copy",
		destPath,
	)

	pipe, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		dlSetError(id, "ffmpeg: "+err.Error())
		return
	}
	dlRegisterPID(id, cmd.Process.Pid)
	if pipe != nil {
		go parseWgetOutput(id, pipe)
	}

	if err := cmd.Wait(); err != nil {
		if !dlIsCancelled(id) {
			dlSetError(id, "Sibnet ffmpeg: "+err.Error())
		}
		return
	}
	if !dlIsCancelled(id) {
		dlSetDone(id)
	}
}

func runCDADownload(id string) {
	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok {
		dlMu.Unlock()
		return
	}
	rawURL   := t.URL
	filename := t.Filename
	destDir  := t.DestDir
	dlMu.Unlock()

	dlSetMsg(id, "Parsowanie strony CDA…")

	pd, err := parseCDAPage(rawURL)
	if err != nil {
		dlSetError(id, err.Error())
		return
	}

	// Wybierz stream URL na podstawie jakości
	streamURL := chooseCDAStream(pd, filename)

	// Log dla debugowania
	log.Printf("nimbus-dl [%s]: streamURL=%q ManifestApple=%q Manifest=%q qualities=%v",
		id, streamURL, pd.Video.ManifestApple, pd.Video.Manifest, pd.Video.Qualities)

	// Walidacja — musi być niepusty
	if streamURL == "" {
		dlSetError(id, fmt.Sprintf("Brak URL strumienia HLS — ManifestApple=%q Manifest=%q qualities=%v",
			pd.Video.ManifestApple, pd.Video.Manifest, pd.Video.Qualities))
		return
	}

	// Sprawdź DRM — pobierz jeden z sub-manifestów i szukaj SAMPLE-AES/FairPlay
	// Master manifest wskazuje na sub-manifesty (_cbcs.m3u8) które mogą być zaszyfrowane
	dlSetMsg(id, "Sprawdzanie strumienia…")
	if hasDRM, drmErr := checkCDADRM(streamURL, cdaGetSessionCookies()); hasDRM {
		dlSetError(id, "Film chroniony FairPlay DRM — pobieranie niemożliwe. "+
			"CDA Premium chroni ten tytuł szyfrowaniem Apple FairPlay (SAMPLE-AES). "+
			"Tylko Safari/iOS może go odtworzyć.")
		log.Printf("nimbus-dl [%s]: DRM wykryty, pomijam", id)
		return
	} else if drmErr != nil {
		log.Printf("nimbus-dl [%s]: błąd sprawdzania DRM: %v — kontynuuję", id, drmErr)
	}

	// Ustal destPath i filename
	title := pd.Video.Title
	if title == "" {
		title = pd.Video.ID
	}
	if dec, e := url.QueryUnescape(strings.ReplaceAll(title, "+", " ")); e == nil {
		title = dec
	}
	sanitized := regexp.MustCompile(`[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\-_. ]`).ReplaceAllString(title, "_")
	sanitized  = strings.TrimSpace(sanitized)

	dlMu.Lock()
	if task := dlTasks[id]; task != nil {
		if task.Filename == "" || task.Filename == "auto" {
			task.Filename = sanitized + ".mp4"
		} else if !strings.Contains(task.Filename, ".") {
			task.Filename += ".mp4"
		}
		// Usuń tag jakości z nazwy pliku
		task.Filename = regexp.MustCompile(`\s*\[\d+p\]`).ReplaceAllString(task.Filename, "")
		task.Filename = strings.TrimSpace(task.Filename)
		filename = task.Filename
		destDir  = task.DestDir
	}
	dlMu.Unlock()

	destPath := filepath.Join(destDir, filename)

	if err := os.MkdirAll(destDir, 0755); err != nil {
		dlSetError(id, fmt.Sprintf("katalog %q: %v", destDir, err))
		return
	}
	// Test zapisu
	if f, err2 := os.CreateTemp(destDir, ".nimbus_test_*"); err2 != nil {
		dlSetError(id, fmt.Sprintf("brak uprawnień w %q: %v", destDir, err2))
		return
	} else {
		f.Close()
		os.Remove(f.Name())
	}

	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		dlSetError(id, "ffmpeg nie jest zainstalowany — apt install ffmpeg")
		return
	}

	totalSec := parseDuration(pd.Video.Duration.String())
	log.Printf("nimbus-dl [%s]: duration raw=%q parsed=%.1fs streamURL=%q",
		id, pd.Video.Duration.String(), totalSec, streamURL)

	const maxRetries = 4
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if dlIsCancelled(id) {
			return
		}

		if attempt > 1 {
			wait := time.Duration(attempt*5) * time.Second
			dlSetMsg(id, fmt.Sprintf("Próba %d/%d — czekam %ds…", attempt, maxRetries, attempt*5))
			time.Sleep(wait)
			if dlIsCancelled(id) {
				return
			}
			// Odśwież URL HLS — tokeny wygasają
			dlSetMsg(id, fmt.Sprintf("Próba %d/%d — odświeżam URL…", attempt, maxRetries))
			if pd2, err2 := parseCDAPage(rawURL); err2 == nil {
				if newURL := chooseCDAStream(pd2, filename); newURL != "" {
					streamURL = newURL
				}
			}
		}

		// Nie wywołuj ffmpeg jeśli nie mamy URL streamu
		if streamURL == "" {
			if attempt < maxRetries {
				continue
			}
			dlSetError(id, "Nie można uzyskać URL streamu HLS z CDA — sprawdź połączenie i czy film jest dostępny")
			return
		}

		dlSetMsg(id, fmt.Sprintf("Pobieranie HLS…%s", func() string {
			if attempt > 1 {
				return fmt.Sprintf(" (próba %d)", attempt)
			}
			return ""
		}()))

		// Usuń poprzedni niedokończony plik
		if info, err2 := os.Stat(destPath); err2 == nil && info.Size() > 0 {
			os.Remove(destPath)
		}

		cookies := cdaGetSessionCookies()
		headers := "Referer: https://www.cda.pl/\r\nOrigin: https://www.cda.pl\r\n"
		if cookies != "" {
			headers += "Cookie: " + cookies + "\r\n"
		}

		args := []string{
			"-y",
			"-loglevel", "info",
			"-stats",
			"-reconnect", "1",
			"-reconnect_streamed", "1",
			"-reconnect_delay_max", "10",
			"-reconnect_on_network_error", "1",
			"-timeout", "30000000",
			"-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
			"-headers", headers,
			"-allowed_extensions", "ALL",
			"-i", streamURL,
			"-c", "copy",
			"-movflags", "+faststart",
			"-bsf:a", "aac_adtstoasc",
			destPath,
		}

		cmd := exec.Command(ffmpeg, args...)

		var stderrBuf strings.Builder
		stderrPipe, pipeErr := cmd.StderrPipe()
		if pipeErr != nil {
			dlSetError(id, fmt.Sprintf("pipe: %v", pipeErr))
			return
		}

		if err2 := cmd.Start(); err2 != nil {
			dlSetError(id, fmt.Sprintf("ffmpeg start: %v", err2))
			return
		}
		dlRegisterPID(id, cmd.Process.Pid)

		// Parser stderr
		doneParsing := make(chan struct{})
		go func() {
			defer close(doneParsing)
			buf := make([]byte, 8192)
			var line strings.Builder
			for {
				n, readErr := stderrPipe.Read(buf)
				if n > 0 {
					chunk := string(buf[:n])
					stderrBuf.WriteString(chunk)
					for _, b := range buf[:n] {
						if b == '\r' || b == '\n' {
							if line.Len() > 0 {
								parseFfmpegLine(id, line.String(), totalSec)
								line.Reset()
							}
						} else {
							line.WriteByte(b)
						}
					}
				}
				if readErr != nil {
					break
				}
			}
			if line.Len() > 0 {
				parseFfmpegLine(id, line.String(), totalSec)
			}
		}()

		// Watchdog: jeśli ani progress ani rozmiar pliku nie zmieniają się przez 180s → kill
		wdDone := make(chan struct{})
		go func() {
			defer close(wdDone)
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			var lastPct  float64
			var lastSize int64
			var lastChange = time.Now()
			for {
				select {
				case <-ticker.C:
					dlMu.Lock()
					t2, ok2 := dlTasks[id]
					if !ok2 {
						dlMu.Unlock()
						return
					}
					cancelled := t2.Status == "cancelled"
					pct := t2.Progress
					dlMu.Unlock()

					if cancelled {
						cmd.Process.Kill()
						return
					}
					// Finalizacja — nigdy nie killuj
					if pct >= 99 {
						continue
					}
					// Sprawdź rozmiar pliku na dysku
					currentSize := int64(0)
					if info, err := os.Stat(destPath); err == nil {
						currentSize = info.Size()
					}
					if pct != lastPct || currentSize != lastSize {
						lastPct    = pct
						lastSize   = currentSize
						lastChange = time.Now()
					} else if time.Since(lastChange) > 180*time.Second {
						dlMu.Lock()
						if t3, ok3 := dlTasks[id]; ok3 {
							t3.Speed = "Zatrzymało się — restartuję…"
						}
						dlMu.Unlock()
						cmd.Process.Kill()
						return
					}
				case <-doneParsing:
					return
				}
			}
		}()

		cmdErr := cmd.Wait()
		<-doneParsing
		select {
		case <-wdDone:
		case <-time.After(200 * time.Millisecond):
		}

		if dlIsCancelled(id) {
			os.Remove(destPath)
			return
		}

		if cmdErr == nil {
			dlSetDone(id)
			log.Printf("nimbus-dl [%s] gotowe: %s", id, destPath)
			return
		}

		// Loguj pełny stderr żeby zobaczyć co ffmpeg mówi
		log.Printf("nimbus-dl [%s] próba %d/%d stderr:\n%s", id, attempt, maxRetries, stderrBuf.String())

		// Błąd — wyciągnij ostatnią sensowną linię
		errMsg := buildFFmpegErrMsg(stderrBuf.String(), cmdErr)
		log.Printf("nimbus-dl [%s] próba %d/%d błąd: %s", id, attempt, maxRetries, errMsg)

		if attempt < maxRetries {
			dlSetMsg(id, fmt.Sprintf("Błąd (próba %d): %s", attempt, errMsg))
			continue
		}
		dlSetError(id, fmt.Sprintf("[próba %d/%d] %s", attempt, maxRetries, errMsg))
	}
}

// checkCDADRM sprawdza czy strumień HLS jest chroniony FairPlay DRM.
// Pobiera master manifest, wyciąga pierwszy sub-manifest i szuka EXT-X-KEY SAMPLE-AES.
// Zwraca (true, nil) jeśli DRM wykryty, (false, nil) jeśli brak DRM, (false, err) przy błędzie sieci.
func checkCDADRM(masterURL, cookies string) (bool, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	doGet := func(u string) (string, error) {
		req, err := http.NewRequest("GET", u, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
		req.Header.Set("Referer", "https://www.cda.pl/")
		if cookies != "" {
			req.Header.Set("Cookie", cookies)
		}
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		return string(body), err
	}

	// Pobierz master manifest
	master, err := doGet(masterURL)
	if err != nil {
		return false, err
	}

	// Jeśli sam master ma SAMPLE-AES — DRM
	if strings.Contains(master, "SAMPLE-AES") || strings.Contains(master, "skd://") {
		return true, nil
	}

	// Wyciągnij pierwszy sub-manifest URI z master
	// Linie URI mogą być względne (/24006292/v_hd_...m3u8) lub bezwzględne
	baseURL := masterURL[:strings.LastIndex(masterURL, "/")+1]
	for _, line := range strings.Split(master, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// To jest URI sub-manifestu
		subURL := line
		if strings.HasPrefix(line, "/") {
			// Względny do hosta
			parsed, err := url.Parse(masterURL)
			if err == nil {
				subURL = parsed.Scheme + "://" + parsed.Host + line
			}
		} else if !strings.HasPrefix(line, "http") {
			subURL = baseURL + line
		}

		sub, err := doGet(subURL)
		if err != nil {
			return false, err
		}
		if strings.Contains(sub, "SAMPLE-AES") || strings.Contains(sub, "skd://") {
			return true, nil
		}
		// Sprawdzamy tylko pierwszy sub-manifest — jeśli jeden ma DRM, wszystkie mają
		return false, nil
	}

	return false, nil
}

// chooseCDAStream wybiera najlepszy URL strumienia.
// W player_data CDA pole "qualities" zawiera aliasy jakości (hd/sd/lq/vl/auto),
// NIE prawidłowe URL-e. Prawdziwy strumień HLS jest zawsze w ManifestApple lub Manifest.
func chooseCDAStream(pd *cdaPlayerData, filename string) string {
	// ManifestApple = HLS m3u8 — preferowany (szybsze, lepsza kompatybilność)
	if pd.Video.ManifestApple != "" {
		return pd.Video.ManifestApple
	}
	// Fallback na DASH mpd
	if pd.Video.Manifest != "" {
		return pd.Video.Manifest
	}
	return ""
}

// parseFfmpegLine parsuje linię statystyk ffmpeg: "size= 2048kB time=00:01:05.50 bitrate=..."
func parseFfmpegLine(id, line string, totalSec float64) {
	line = strings.TrimSpace(line)
	if !strings.Contains(line, "time=") {
		return
	}

	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok {
		dlMu.Unlock()
		return
	}

	// time=HH:MM:SS.ss → progress
	if m := regexp.MustCompile(`time=\s*(\d+):(\d+):([\d.]+)`).FindStringSubmatch(line); len(m) == 4 {
		var h, min, sec float64
		fmt.Sscanf(m[1], "%f", &h)
		fmt.Sscanf(m[2], "%f", &min)
		fmt.Sscanf(m[3], "%f", &sec)
		currentSec := h*3600 + min*60 + sec

		if totalSec > 0 && currentSec > 0 {
			pct := (currentSec / totalSec) * 100
			if pct > 99 {
				pct = 99
			}
			t.Progress = pct
			remaining := totalSec - currentSec
			if remaining > 0 {
				mins := int(remaining) / 60
				secs := int(remaining) % 60
				if mins > 0 {
					t.ETA = fmt.Sprintf("%dm %ds", mins, secs)
				} else {
					t.ETA = fmt.Sprintf("%ds", secs)
				}
			}
		}
		// Czas jako SizeTotal żeby frontend wiedział ile materiału zostało
		totalMins := int(totalSec) / 60
		totalSecs := int(totalSec) % 60
		t.SizeTotal = fmt.Sprintf("%d:%02d", totalMins, totalSecs)
	}

	// speed=2.50x
	if m := regexp.MustCompile(`speed=\s*([\d.]+)x`).FindStringSubmatch(line); len(m) == 2 {
		t.Speed = m[1] + "×"
	}

	// size= 12345kB → SizeDone w MB
	if m := regexp.MustCompile(`size=\s*(\d+)kB`).FindStringSubmatch(line); len(m) == 2 {
		var kb float64
		fmt.Sscanf(m[1], "%f", &kb)
		if kb >= 1024 {
			t.SizeDone = fmt.Sprintf("%.1f MB", kb/1024)
		} else {
			t.SizeDone = fmt.Sprintf("%.0f kB", kb)
		}
		if totalSec == 0 && t.Progress == 0 && kb > 0 {
			t.Progress = 1
		}
	}

	dlMu.Unlock()
}

func buildFFmpegErrMsg(stderr string, cmdErr error) string {
	lines := strings.Split(stderr, "\n")
	var errLines []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if strings.ContainsAny(l, "Ee") &&
			(strings.Contains(l, "Error") || strings.Contains(l, "error") ||
				strings.Contains(l, "403") || strings.Contains(l, "404") ||
				strings.Contains(l, "410") || strings.Contains(l, "Failed") ||
				strings.Contains(l, "Invalid") || strings.Contains(l, "Connection")) {
			errLines = append(errLines, l)
		}
	}
	if len(errLines) > 0 {
		last := errLines[len(errLines)-1]
		if len(last) > 120 {
			last = last[:120] + "…"
		}
		return last
	}
	return cmdErr.Error()
}

// parseDuration konwertuje string "137" lub "2:17" na sekundy
func parseDuration(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" {
		return 0
	}
	// Może być "MM:SS" lub po prostu liczba sekund
	if strings.Contains(s, ":") {
		parts := strings.Split(s, ":")
		var total float64
		for _, p := range parts {
			var v float64
			fmt.Sscanf(p, "%f", &v)
			total = total*60 + v
		}
		return total
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

// ─── CDA helpers ──────────────────────────────────────────────────────────────

func cdaGetSessionCookies() string {
	cfg := loadCDAConfig()
	if cfg.SessionCookie != "" {
		return cfg.SessionCookie
	}

	cdaSessionMu.Lock()
	defer cdaSessionMu.Unlock()

	if time.Now().Before(cdaSessionExpiry) && cdaSessionCookies != "" {
		return cdaSessionCookies
	}

	req, err := http.NewRequest("GET", "https://www.cda.pl/", nil)
	if err != nil {
		return "cda.player=html5"
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req.Header.Set("Accept-Language", "pl-PL,pl;q=0.9")

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "cda.player=html5"
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	parts := []string{"cda.player=html5"}
	for _, c := range resp.Cookies() {
		parts = append(parts, c.Name+"="+c.Value)
	}
	cdaSessionCookies = strings.Join(parts, "; ")
	cdaSessionExpiry  = time.Now().Add(45 * time.Minute)
	return cdaSessionCookies
}

func parseCDAPage(rawURL string) (*cdaPlayerData, error) {
	pageURL := rawURL
	if !strings.Contains(pageURL, "://") {
		pageURL = "https://" + pageURL
	}
	pageURL = strings.Replace(pageURL, "://m.cda.pl", "://www.cda.pl", 1)
	// Usuń tylko fragment (#...) — /vfilm jest prawidłową częścią URL CDA
	if idx := strings.Index(pageURL, "#"); idx != -1 {
		pageURL = pageURL[:idx]
	}

	doReq := func(cookieStr string) (*http.Response, error) {
		req, err := http.NewRequest("GET", pageURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
		req.Header.Set("Accept-Language", "pl-PL,pl;q=0.9")
		req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
		req.Header.Set("Cookie", cookieStr)
		return (&http.Client{Timeout: 15 * time.Second}).Do(req)
	}

	resp, err := doReq(cdaGetSessionCookies())
	if err != nil {
		return nil, fmt.Errorf("HTTP GET: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 403 {
		// Unieważnij cache i spróbuj ponownie
		cdaSessionMu.Lock()
		cdaSessionExpiry = time.Time{}
		cdaSessionMu.Unlock()
		resp.Body.Close()
		resp, err = doReq(cdaGetSessionCookies())
		if err != nil {
			return nil, fmt.Errorf("HTTP 403 — brak dostępu")
		}
		defer resp.Body.Close()
	}
	if resp.StatusCode == 410 {
		return nil, fmt.Errorf("film niedostępny (HTTP 410) — usunięty lub wymaga premium")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	html := string(body)

	// Wyciągnij player_data — CDA używa apostrofów i może kodować HTML entities
	var playerJSON string
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`player_data='(\{[^']+\})'`),
		regexp.MustCompile(`player_data="(\{[^"]+\})"`),
		regexp.MustCompile(`data-player='(\{[^']+\})'`),
	} {
		if m := re.FindStringSubmatch(html); len(m) == 2 {
			playerJSON = m[1]
			break
		}
	}
	if playerJSON == "" {
		return nil, fmt.Errorf("nie znaleziono player_data — film wymaga logowania lub jest usunięty")
	}

	// Odkoduj HTML entities
	playerJSON = strings.ReplaceAll(playerJSON, "&quot;", `"`)
	playerJSON = strings.ReplaceAll(playerJSON, "&#039;", "'")
	playerJSON = strings.ReplaceAll(playerJSON, "&amp;", "&")
	playerJSON = strings.ReplaceAll(playerJSON, "&#x2F;", "/")

	var pd cdaPlayerData
	if err := json.Unmarshal([]byte(playerJSON), &pd); err != nil {
		return nil, fmt.Errorf("parsowanie player_data: %w", err)
	}

	if pd.Video.ManifestApple == "" && pd.Video.Manifest == "" {
		if pd.Video.Premium {
			return nil, fmt.Errorf("film wymaga CDA Premium")
		}
		return nil, fmt.Errorf("brak URL strumienia w player_data")
	}
	return &pd, nil
}

func parseCDAFolder(rawURL string) ([]CDAFolderItem, string, error) {
	if !strings.Contains(rawURL, "://") {
		rawURL = "https://" + rawURL
	}
	rawURL = strings.Replace(rawURL, "://m.cda.pl", "://www.cda.pl", 1)

	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req.Header.Set("Accept-Language", "pl-PL,pl;q=0.9")
	req.Header.Set("Cookie", cdaGetSessionCookies())

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("HTTP GET: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	html := string(body)

	folderTitle := ""
	if tm := regexp.MustCompile(`<title>([^<]+)</title>`).FindStringSubmatch(html); len(tm) > 1 {
		folderTitle = strings.TrimSpace(strings.Split(tm[1], " - ")[0])
	}

	reAnchor := regexp.MustCompile(`data-file_id=`)
	reVidID  := regexp.MustCompile(`href="/video/([a-z0-9]+)"`)
	reAlt    := regexp.MustCompile(`alt="([^"]+)"`)
	reSrc    := regexp.MustCompile(`src="(//icdn[^"]+)"`)
	reDur    := regexp.MustCompile(`time-thumb-fold[^>]*>([^<]+)<`)

	anchors := reAnchor.FindAllStringIndex(html, -1)
	items   := make([]CDAFolderItem, 0, len(anchors))
	seen    := map[string]bool{}

	for _, loc := range anchors {
		end := loc[0] + 1500
		if end > len(html) {
			end = len(html)
		}
		chunk := html[loc[0]:end]

		vidM := reVidID.FindStringSubmatch(chunk)
		altM := reAlt.FindStringSubmatch(chunk)
		if vidM == nil || altM == nil {
			continue
		}
		vidID := vidM[1]
		if seen[vidID] {
			continue
		}
		seen[vidID] = true

		thumb := ""
		if srcM := reSrc.FindStringSubmatch(chunk); srcM != nil {
			thumb = "https:" + srcM[1]
		}
		duration := ""
		if durM := reDur.FindStringSubmatch(chunk); durM != nil {
			duration = strings.TrimSpace(durM[1])
		}

		items = append(items, CDAFolderItem{
			VideoID:  vidID,
			URL:      "https://www.cda.pl/video/" + vidID,
			Title:    strings.TrimSpace(altM[1]),
			Thumb:    thumb,
			Duration: duration,
		})
	}

	if len(items) == 0 {
		return nil, folderTitle, fmt.Errorf("nie znaleziono filmów — folder prywatny lub zmieniona struktura CDA")
	}
	return items, folderTitle, nil
}

// ─── HTTP Handlers ─────────────────────────────────────────────────────────────

// GET /api/downloads
func handleDownloadsList(w http.ResponseWriter, r *http.Request) {
	dlMu.Lock()
	result := make([]*DownloadTask, 0, len(dlOrder))
	for _, id := range dlOrder {
		if t, ok := dlTasks[id]; ok {
			result = append(result, t)
		}
	}
	dlMu.Unlock()

	// Opcjonalne filtrowanie ?status=downloading
	if f := r.URL.Query().Get("status"); f != "" {
		filtered := result[:0]
		for _, t := range result {
			if t.Status == f {
				filtered = append(filtered, t)
			}
		}
		result = filtered
	}

	jsonOK(w, map[string]any{"tasks": result})
}

// POST /api/downloads/add
func handleDownloadsAdd(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		URL      string `json:"url"`
		DestDir  string `json:"dest_dir"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		jsonErr(w, "url jest wymagane", http.StatusBadRequest)
		return
	}
	if req.DestDir == "" {
		req.DestDir = loadDLConfig().DefaultDir
	}

	filename := req.Filename
	if filename == "" {
		l := strings.ToLower(req.URL)
		if strings.HasPrefix(l, "magnet:") {
			// Wyciągnij dn= (display name) z magnet URI
			// Format: magnet:?xt=urn:btih:...&dn=Nazwa+Torrentu&...
			if parsed, err := url.Parse(req.URL); err == nil {
				if dn := parsed.Query().Get("dn"); dn != "" {
					filename = sanitizeFilename(dn)
				}
			}
			if filename == "" {
				// Fallback — wyciągnij hash z xt= jako nazwę
				if m := regexp.MustCompile(`xt=urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})`).FindStringSubmatch(req.URL); len(m) > 1 {
					filename = "torrent-" + strings.ToLower(m[1][:8])
				} else {
					filename = fmt.Sprintf("torrent-%d", time.Now().Unix())
				}
			}
		} else if !strings.Contains(l, "cda.pl") && !strings.Contains(l, "sibnet.ru") {
			// Dla CDA i Sibnet backend ustali nazwę z tytułu strony podczas pobierania
			// — nie używaj filepath.Base (dałoby "shell.php" lub "video123")
			if parsed, err := url.Parse(req.URL); err == nil {
				filename = filepath.Base(parsed.Path)
			}
			if filename == "" || filename == "." || filename == "/" {
				filename = fmt.Sprintf("download-%d", time.Now().Unix())
			}
		}
	}

	// Duplikat?
	dlMu.Lock()
	for _, t := range dlTasks {
		if t.URL == req.URL && (t.Status == "queued" || t.Status == "downloading") {
			dlMu.Unlock()
			jsonErr(w, "to zadanie już jest w kolejce", http.StatusConflict)
			return
		}
	}

	id := fmt.Sprintf("dl-%d", time.Now().UnixNano())
	task := &DownloadTask{
		ID:        id,
		URL:       req.URL,
		Filename:  filename,
		DestDir:   req.DestDir,
		Status:    "queued",
		CreatedAt: time.Now().Format("2006-01-02 15:04:05"),
		Category:  guessCategory(req.URL),
	}
	dlTasks[id] = task
	dlOrder = append(dlOrder, id)
	dlMu.Unlock()

	saveState()
	dlEnqueue()
	jsonOK(w, map[string]any{"ok": true, "id": id})
}

// POST /api/downloads/cancel
func handleDownloadsCancel(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ ID string `json:"id"` }
	json.NewDecoder(r.Body).Decode(&req)

	dlMu.Lock()
	if t, ok := dlTasks[req.ID]; ok {
		t.Status = "cancelled"
		t.Speed  = ""
		t.ETA    = ""
	}
	dlMu.Unlock()

	// Zabij konkretny proces po PID
	dlPIDsMu.Lock()
	if pid, ok := dlPIDs[req.ID]; ok {
		syscall.Kill(pid, syscall.SIGTERM)
	}
	dlPIDsMu.Unlock()

	saveState()
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/delete
func handleDownloadsDelete(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ ID string `json:"id"` }
	json.NewDecoder(r.Body).Decode(&req)

	// Najpierw anuluj jeśli aktywne
	dlPIDsMu.Lock()
	if pid, ok := dlPIDs[req.ID]; ok {
		syscall.Kill(pid, syscall.SIGTERM)
	}
	dlPIDsMu.Unlock()

	dlMu.Lock()
	delete(dlTasks, req.ID)
	newOrder := dlOrder[:0]
	for _, id := range dlOrder {
		if id != req.ID {
			newOrder = append(newOrder, id)
		}
	}
	dlOrder = newOrder
	dlMu.Unlock()

	saveState()
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/retry
func handleDownloadsRetry(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ ID string `json:"id"` }
	json.NewDecoder(r.Body).Decode(&req)

	dlMu.Lock()
	t, ok := dlTasks[req.ID]
	if !ok {
		dlMu.Unlock()
		jsonErr(w, "task not found", http.StatusNotFound)
		return
	}
	if t.Status != "error" && t.Status != "cancelled" {
		dlMu.Unlock()
		jsonErr(w, "zadanie nie jest w stanie error/cancelled", http.StatusBadRequest)
		return
	}
	t.Status   = "queued"
	t.Progress = 0
	t.Speed    = ""
	t.ETA      = ""
	t.Error    = ""
	t.DoneAt   = ""
	t.SizeDone = ""
	dlMu.Unlock()

	saveState()
	dlEnqueue()
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/clear-done
func handleDownloadsClearDone(w http.ResponseWriter, r *http.Request) {
	dlMu.Lock()
	newOrder := dlOrder[:0]
	for _, id := range dlOrder {
		if t, ok := dlTasks[id]; ok {
			if t.Status == "downloading" || t.Status == "queued" {
				newOrder = append(newOrder, id)
			} else {
				delete(dlTasks, id)
			}
		}
	}
	dlOrder = newOrder
	dlMu.Unlock()
	saveState()
	jsonOK(w, map[string]any{"ok": true})
}

// GET /api/downloads/config
func handleDownloadsConfig(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, loadDLConfig())
}

// POST /api/downloads/config/save
func handleDownloadsConfigSave(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var cfg DLConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		jsonErr(w, "invalid json", http.StatusBadRequest)
		return
	}
	if cfg.DefaultDir == "" {
		cfg.DefaultDir = defaultDownloadDir()
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 3
	}
	if err := saveDLConfig(cfg); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

// GET /api/downloads/tools
func handleDownloadsTools(w http.ResponseWriter, r *http.Request) {
	check := func(name string) bool {
		_, err := exec.LookPath(name)
		return err == nil
	}
	jsonOK(w, map[string]any{
		"wget":       check("wget"),
		"ffmpeg":     check("ffmpeg"),
		"aria2c":     check("aria2c"),
		"yt-dlp":     check("yt-dlp"),
		"youtube-dl": check("youtube-dl"),
	})
}

// POST /api/downloads/install-tool  — streaming response
func handleDownloadsInstallTool(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ Tool string `json:"tool"` }
	json.NewDecoder(r.Body).Decode(&req)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, canFlush := w.(http.Flusher)
	write := func(s string) {
		fmt.Fprint(w, s)
		if canFlush {
			flusher.Flush()
		}
	}

	var cmd *exec.Cmd
	switch req.Tool {
	case "aria2c", "aria2":
		cmd = exec.Command("apt-get", "install", "-y", "aria2")
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	case "yt-dlp":
		cmd = exec.Command("pip3", "install", "--break-system-packages", "yt-dlp")
	case "ffmpeg":
		cmd = exec.Command("apt-get", "install", "-y", "ffmpeg")
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	case "wget":
		cmd = exec.Command("apt-get", "install", "-y", "wget")
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	default:
		write(fmt.Sprintf("[ERROR] Nieznane narzędzie: %s\n", req.Tool))
		return
	}

	pr, pw, err := os.Pipe()
	if err != nil {
		write(fmt.Sprintf("[ERROR] pipe: %v\n", err))
		return
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		write(fmt.Sprintf("[ERROR] start: %v\n", err))
		return
	}

	pw.Close() // child ma własną kopię
	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		write(scanner.Text() + "\n")
	}
	pr.Close()

	if err := cmd.Wait(); err != nil {
		write(fmt.Sprintf("\n[ERROR] %v\n", err))
	} else {
		write(fmt.Sprintf("\n[OK] %s zainstalowany pomyślnie.\n", req.Tool))
	}
}

// GET /api/downloads/cda-config
func handleCDAConfig(w http.ResponseWriter, r *http.Request) {
	cfg := loadCDAConfig()
	jsonOK(w, map[string]any{
		"default_quality": cfg.DefaultQuality,
		"has_session":     cfg.SessionCookie != "",
	})
}

// POST /api/downloads/cda-config/save
func handleCDAConfigSave(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		SessionCookie  string `json:"session_cookie"`
		DefaultQuality string `json:"default_quality"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	existing := loadCDAConfig()
	if req.DefaultQuality == "" {
		req.DefaultQuality = existing.DefaultQuality
	}
	if req.DefaultQuality == "" {
		req.DefaultQuality = "best"
	}

	cdaSessionMu.Lock()
	cdaSessionCookies = ""
	cdaSessionExpiry  = time.Time{}
	cdaSessionMu.Unlock()

	if err := saveCDAConfig(CDAConfig{
		DefaultQuality: req.DefaultQuality,
		SessionCookie:  req.SessionCookie,
	}); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/cda-test
func handleCDATest(w http.ResponseWriter, r *http.Request) {
	pd, err := parseCDAPage("https://www.cda.pl/video/5749950c")
	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	cfg := loadCDAConfig()
	jsonOK(w, map[string]any{
		"ok":         true,
		"logged_in":  cfg.SessionCookie != "",
		"test_title": pd.Video.Title,
	})
}

// GET /api/downloads/cda-preview?url=...
func handleCDAPreview(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		jsonErr(w, "url required", http.StatusBadRequest)
		return
	}
	pd, err := parseCDAPage(rawURL)
	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	title := pd.Video.Title
	if dec, e := url.QueryUnescape(strings.ReplaceAll(title, "+", " ")); e == nil {
		title = dec
	}
	thumb := pd.Video.Thumb
	if strings.HasPrefix(thumb, "//") {
		thumb = "https:" + thumb
	}
	var durSec float64
	fmt.Sscanf(pd.Video.Duration.String(), "%f", &durSec)
	jsonOK(w, map[string]any{
		"ok":        true,
		"title":     title,
		"duration":  durSec,
		"thumb":     thumb,
		"premium":   pd.Video.Premium,
		"qualities": pd.Video.Qualities,
		"has_hls":   pd.Video.ManifestApple != "",
	})
}

// GET /api/downloads/cda-folder?url=...
func handleCDAFolder(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		jsonErr(w, "url required", http.StatusBadRequest)
		return
	}
	items, title, err := parseCDAFolder(rawURL)
	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOK(w, map[string]any{
		"ok":    true,
		"title": title,
		"items": items,
		"count": len(items),
	})
}

// GET /api/downloads/sibnet-preview?url=...
func handleSibnetPreview(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		jsonErr(w, "url required", http.StatusBadRequest)
		return
	}
	videoURL, title, err := parseSibnetPage(rawURL)
	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOK(w, map[string]any{
		"ok":        true,
		"title":     title,
		"video_url": videoURL,
	})
}
func handleStatus(w http.ResponseWriter, r *http.Request) {
	dlMu.Lock()
	total := len(dlTasks)
	active, queued, done, errored := 0, 0, 0, 0
	for _, t := range dlTasks {
		switch t.Status {
		case "downloading":
			active++
		case "queued":
			queued++
		case "done":
			done++
		case "error", "cancelled":
			errored++
		}
	}
	dlMu.Unlock()

	dlSchedMu.Lock()
	running := dlActive
	dlSchedMu.Unlock()

	jsonOK(w, map[string]any{
		"status":     "ok",
		"version":    version,
		"port":       *flagPort,
		"tasks":      total,
		"active":     running,
		"queued":     queued,
		"done":       done,
		"error":      errored,
		"state_file": statePath,
	})
}

// GET /api/dl/version
func handleVersion(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"version": version, "name": "nimbus-dl"})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func guessCategory(rawURL string) string {
	l := strings.ToLower(rawURL)
	switch {
	case strings.Contains(l, "cda.pl"):
		return "cda"
	case strings.Contains(l, "sibnet.ru"):
		return "sibnet"
	case strings.Contains(l, "youtube.com") || strings.Contains(l, "youtu.be") ||
		strings.Contains(l, "vimeo.com") || strings.Contains(l, "twitch.tv"):
		return "yt"
	case strings.HasSuffix(l, ".torrent") || strings.HasPrefix(l, "magnet:"):
		return "torrent"
	case strings.HasSuffix(l, ".iso") || strings.HasSuffix(l, ".img"):
		return "iso"
	default:
		return "file"
	}
}

// scanLinesOrCR — bufio.SplitFunc obsługujący \r jako separator (wget używa \r)
func scanLinesOrCR(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// ─── flushWriter (dla streaming install-tool) — nieużywany, zastąpiony pipe ──

// Pomocnicza funkcja do debugowania — loguje request
func logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("nimbus-dl %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// ─── CDA login (opcjonalne, dla przyszłości) ──────────────────────────────────

func cdaLoginWithCredentials(username, password string) (string, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 15 * time.Second, Jar: jar}

	req, _ := http.NewRequest("GET", "https://www.cda.pl/login", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("GET login: %w", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	csrf := ""
	if m := regexp.MustCompile(`name="_token"\s+value="([^"]+)"`).FindStringSubmatch(string(body)); len(m) > 1 {
		csrf = m[1]
	}

	form := url.Values{"username": {username}, "password": {password}, "_token": {csrf}}
	req2, _ := http.NewRequest("POST", "https://www.cda.pl/login", strings.NewReader(form.Encode()))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req2.Header.Set("Referer", "https://www.cda.pl/login")
	resp2, err := client.Do(req2)
	if err != nil {
		return "", fmt.Errorf("POST login: %w", err)
	}
	resp2.Body.Close()

	u, _ := url.Parse("https://www.cda.pl")
	var parts []string
	for _, c := range jar.Cookies(u) {
		if c.Name == "PHPSESSID" || strings.HasPrefix(c.Name, "ps") {
			parts = append(parts, c.Name+"="+c.Value)
		}
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("logowanie nieudane")
	}
	return strings.Join(parts, "; "), nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Integracje *arr / qBittorrent / SABnzbd ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// defaultArrServices zwraca domyślną listę serwisów (wszystkie wyłączone)
func defaultArrServices() []ArrService {
	return []ArrService{
		{ID: "sonarr",  Name: "Sonarr",          URL: "http://localhost:8989", Enabled: false},
		{ID: "radarr",  Name: "Radarr",           URL: "http://localhost:7878", Enabled: false},
		{ID: "prowlarr",Name: "Prowlarr",         URL: "http://localhost:9696", Enabled: false},
		{ID: "qbit",    Name: "qBittorrent",      URL: "http://localhost:8080", Enabled: false},
		{ID: "sabnzbd", Name: "SABnzbd",          URL: "http://localhost:8090", Enabled: false},
		{ID: "bazarr",  Name: "Bazarr",           URL: "http://localhost:6767", Enabled: false},
	}
}

func loadArrConfig() ArrConfig {
	data, err := os.ReadFile(arrPath)
	if err != nil {
		return ArrConfig{Services: defaultArrServices(), Feeds: []RSSFeed{}}
	}
	var cfg ArrConfig
	if json.Unmarshal(data, &cfg) != nil {
		return ArrConfig{Services: defaultArrServices(), Feeds: []RSSFeed{}}
	}
	// Uzupełnij brakujące serwisy o domyślne (gdy dodamy nowy serwis w przyszłości)
	defaults := defaultArrServices()
	existing := map[string]bool{}
	for _, s := range cfg.Services {
		existing[s.ID] = true
	}
	for _, d := range defaults {
		if !existing[d.ID] {
			cfg.Services = append(cfg.Services, d)
		}
	}
	if cfg.Feeds == nil {
		cfg.Feeds = []RSSFeed{}
	}
	return cfg
}

func saveArrConfig(cfg ArrConfig) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(arrPath, data, 0644)
}

// arrHTTPGet wykonuje GET do serwisu *arr z timeout 5s
func arrHTTPGet(baseURL, path, apiKey string) ([]byte, int, error) {
	full := strings.TrimRight(baseURL, "/") + path
	req, err := http.NewRequest("GET", full, nil)
	if err != nil {
		return nil, 0, err
	}
	if apiKey != "" {
		req.Header.Set("X-Api-Key", apiKey)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}

// probeArrService odpytuje serwis i zwraca ArrStatus
func probeArrService(svc ArrService) ArrStatus {
	st := ArrStatus{
		ID:   svc.ID,
		Name: svc.Name,
		URL:  svc.URL,
	}
	if !svc.Enabled {
		st.State = "disabled"
		return st
	}

	switch svc.ID {
	case "sonarr", "radarr", "prowlarr", "bazarr":
		st = probeRadarrLike(svc, st)
	case "qbit":
		st = probeQBittorrent(svc, st)
	case "sabnzbd":
		st = probeSABnzbd(svc, st)
	default:
		st = probeRadarrLike(svc, st)
	}
	return st
}

// probeRadarrLike odpytuje Sonarr/Radarr/Prowlarr przez /api/v3/system/status
func probeRadarrLike(svc ArrService, st ArrStatus) ArrStatus {
	body, code, err := arrHTTPGet(svc.URL, "/api/v3/system/status", svc.APIKey)
	if err != nil {
		st.State = "unreachable"
		st.Err   = err.Error()
		return st
	}
	if code == 401 {
		st.State = "error"
		st.Err   = "nieprawidłowy klucz API"
		return st
	}
	if code != 200 {
		st.State = "error"
		st.Err   = fmt.Sprintf("HTTP %d", code)
		return st
	}

	var info struct {
		Version string `json:"version"`
	}
	json.Unmarshal(body, &info)
	st.Version = info.Version
	st.State   = "running"

	// Pobierz queue
	qBody, qCode, qErr := arrHTTPGet(svc.URL, "/api/v3/queue?pageSize=1", svc.APIKey)
	if qErr == nil && qCode == 200 {
		var q struct {
			TotalRecords int `json:"totalRecords"`
		}
		if json.Unmarshal(qBody, &q) == nil {
			st.Active = q.TotalRecords
			if q.TotalRecords > 0 {
				st.Speed = fmt.Sprintf("%d w kolejce", q.TotalRecords)
			} else {
				st.Speed = "idle"
			}
		}
	}
	return st
}

// qbitSession cachuje SID cookie per URL żeby nie logować się przy każdym zapytaniu
var (
	qbitSessionMu  sync.Mutex
	qbitSessions   = map[string]string{} // baseURL → SID cookie value
	qbitSessionExp = map[string]time.Time{}
)

// qbitLogin loguje się do qBittorrent i zwraca SID cookie
func qbitLogin(baseURL, username, password string) (string, error) {
	u := strings.TrimRight(baseURL, "/") + "/api/v2/auth/login"
	form := "username=" + url.QueryEscape(username) + "&password=" + url.QueryEscape(password)
	req, err := http.NewRequest("POST", u, strings.NewReader(form))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", strings.TrimRight(baseURL, "/")+"/")

	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	text := strings.TrimSpace(string(body))

	if text == "Fails." || text == "banned" {
		return "", fmt.Errorf("logowanie nieudane — zły login/hasło lub IP zablokowane")
	}

	// Wyciągnij SID z Set-Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "SID" {
			return c.Value, nil
		}
	}
	// qBit v5: może zwrócić token w body jako JSON
	if strings.HasPrefix(text, "{") {
		var obj map[string]string
		if json.Unmarshal(body, &obj) == nil {
			if sid, ok := obj["session"]; ok && sid != "" {
				return sid, nil
			}
		}
	}
	if text == "Ok." {
		// Brak SID w cookie — może być w Set-Cookie z inną nazwą
		for _, c := range resp.Cookies() {
			if strings.Contains(strings.ToLower(c.Name), "session") || strings.Contains(strings.ToLower(c.Name), "sid") {
				return c.Value, nil
			}
		}
	}
	return "", fmt.Errorf("brak SID cookie w odpowiedzi (body: %q)", text[:min(50, len(text))])
}

func min(a, b int) int {
	if a < b { return a }
	return b
}

// qbitGetSID zwraca aktualny SID dla danego serwisu, logując się w razie potrzeby
func qbitGetSID(svc ArrService) (string, error) {
	if svc.Username == "" {
		return "", nil // brak autoryzacji skonfigurowanej
	}
	key := svc.URL
	qbitSessionMu.Lock()
	sid := qbitSessions[key]
	exp := qbitSessionExp[key]
	qbitSessionMu.Unlock()

	// Sesja ważna przez 55 minut (qBit defaultowo 1h)
	if sid != "" && time.Now().Before(exp) {
		return sid, nil
	}

	newSID, err := qbitLogin(svc.URL, svc.Username, svc.Password)
	if err != nil {
		return "", err
	}

	qbitSessionMu.Lock()
	qbitSessions[key] = newSID
	qbitSessionExp[key] = time.Now().Add(55 * time.Minute)
	qbitSessionMu.Unlock()
	return newSID, nil
}

// qbitGet wykonuje GET do qBittorrent z opcjonalnym SID cookie
func qbitGet(baseURL, path, sid string) ([]byte, int, error) {
	full := strings.TrimRight(baseURL, "/") + path
	req, err := http.NewRequest("GET", full, nil)
	if err != nil {
		return nil, 0, err
	}
	if sid != "" {
		req.AddCookie(&http.Cookie{Name: "SID", Value: sid})
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

// probeQBittorrent odpytuje qBittorrent Web API v2 z obsługą logowania
func probeQBittorrent(svc ArrService, st ArrStatus) ArrStatus {
	// Pobierz/odśwież SID
	sid, loginErr := qbitGetSID(svc)
	if loginErr != nil {
		st.State = "error"
		st.Err   = "Logowanie nieudane: " + loginErr.Error()
		return st
	}

	// Wersja
	body, code, err := qbitGet(svc.URL, "/api/v2/app/version", sid)
	if err != nil {
		st.State = "unreachable"
		st.Err   = err.Error()
		return st
	}
	if code == 403 {
		// SID wygasł lub wymagane logowanie — wymuś re-login
		qbitSessionMu.Lock()
		delete(qbitSessions, svc.URL)
		qbitSessionMu.Unlock()

		if svc.Username != "" {
			// Spróbuj ponownie
			newSID, err2 := qbitLogin(svc.URL, svc.Username, svc.Password)
			if err2 != nil {
				st.State = "error"
				st.Err   = "Re-login nieudany: " + err2.Error()
				return st
			}
			qbitSessionMu.Lock()
			qbitSessions[svc.URL] = newSID
			qbitSessionExp[svc.URL] = time.Now().Add(55 * time.Minute)
			qbitSessionMu.Unlock()
			sid = newSID
			body, code, err = qbitGet(svc.URL, "/api/v2/app/version", sid)
			if err != nil || code != 200 {
				st.State = "error"
				st.Err   = fmt.Sprintf("HTTP %d po re-login", code)
				return st
			}
		} else {
			st.State = "error"
			st.Err   = "HTTP 403 — skonfiguruj login/hasło dla qBittorrent"
			return st
		}
	}
	if code != 200 {
		st.State = "error"
		st.Err   = fmt.Sprintf("HTTP %d", code)
		return st
	}
	st.Version = strings.TrimSpace(string(body))
	st.State   = "running"

	// Transfer info
	tBody, tCode, _ := qbitGet(svc.URL, "/api/v2/transfer/info", sid)
	if tCode == 200 {
		var ti struct {
			DlSpeedRaw int `json:"dl_info_speed"`
			UpSpeedRaw int `json:"up_info_speed"`
		}
		if json.Unmarshal(tBody, &ti) == nil {
			dlMBs := float64(ti.DlSpeedRaw) / 1024 / 1024
			upMBs := float64(ti.UpSpeedRaw) / 1024 / 1024
			st.Speed = fmt.Sprintf("↓ %.1f MB/s ↑ %.1f MB/s", dlMBs, upMBs)
		}
	}

	// Aktywne torrenty
	aBody, aCode, _ := qbitGet(svc.URL, "/api/v2/torrents/info?filter=active", sid)
	if aCode == 200 {
		var torrents []json.RawMessage
		if json.Unmarshal(aBody, &torrents) == nil {
			st.Active = len(torrents)
		}
	}
	return st
}

// probeSABnzbd odpytuje SABnzbd JSON API
func probeSABnzbd(svc ArrService, st ArrStatus) ArrStatus {
	apiKey := svc.APIKey
	url    := fmt.Sprintf("%s/api?mode=version&output=json&apikey=%s", strings.TrimRight(svc.URL, "/"), apiKey)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		st.State = "unreachable"
		st.Err   = err.Error()
		return st
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		st.State = "unreachable"
		st.Err   = err.Error()
		return st
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var ver struct{ Version string `json:"version"` }
	json.Unmarshal(body, &ver)
	st.Version = ver.Version
	st.State   = "running"

	// Queue
	qURL := fmt.Sprintf("%s/api?mode=qstatus&output=json&apikey=%s", strings.TrimRight(svc.URL, "/"), apiKey)
	qReq, _ := http.NewRequest("GET", qURL, nil)
	if qResp, qErr := client.Do(qReq); qErr == nil {
		defer qResp.Body.Close()
		qBody, _ := io.ReadAll(qResp.Body)
		var qs struct {
			Queue struct {
				NoofSlots int    `json:"noofslots"`
				Speed     string `json:"speed"`
			} `json:"queue"`
		}
		if json.Unmarshal(qBody, &qs) == nil {
			st.Active = qs.Queue.NoofSlots
			if qs.Queue.Speed != "" && qs.Queue.Speed != "0 " {
				st.Speed = "↓ " + strings.TrimSpace(qs.Queue.Speed) + "/s"
			} else {
				st.Speed = "idle"
			}
		}
	}
	return st
}

// ─── Handlers *arr ────────────────────────────────────────────────────────────

// GET /api/downloads/arr/services — zwraca konfigurację (bez API keys w odpowiedzi)
func handleArrServices(w http.ResponseWriter, r *http.Request) {
	cfg := loadArrConfig()
	// Zamaskuj klucze API — nie zwracamy ich do frontendu w plaintext
	safe := make([]map[string]any, len(cfg.Services))
	for i, s := range cfg.Services {
		safe[i] = map[string]any{
			"id":           s.ID,
			"name":         s.Name,
			"url":          s.URL,
			"enabled":      s.Enabled,
			"has_key":      s.APIKey != "",
			"username":     s.Username,
			"has_password": s.Password != "",
		}
	}
	jsonOK(w, map[string]any{"services": safe})
}

// POST /api/downloads/arr/services/save — zapisuje konfigurację
func handleArrServicesSave(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		Services []struct {
			ID       string `json:"id"`
			URL      string `json:"url"`
			APIKey   string `json:"api_key"`
			Username string `json:"username"`
			Password string `json:"password"`
			Enabled  bool   `json:"enabled"`
		} `json:"services"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid json", http.StatusBadRequest)
		return
	}

	cfg := loadArrConfig()
	// Zaktualizuj istniejące serwisy
	svcMap := map[string]*ArrService{}
	for i := range cfg.Services {
		svcMap[cfg.Services[i].ID] = &cfg.Services[i]
	}
	for _, upd := range req.Services {
		if svc, ok := svcMap[upd.ID]; ok {
			svc.URL     = upd.URL
			svc.Enabled = upd.Enabled
			if upd.APIKey != "" {
				svc.APIKey = upd.APIKey
			}
			if upd.Username != "" {
				svc.Username = upd.Username
			}
			if upd.Password != "" {
				svc.Password = upd.Password
				// Wymuś re-login przy następnym użyciu
				qbitSessionMu.Lock()
				delete(qbitSessions, svc.URL)
				qbitSessionMu.Unlock()
			}
		}
	}
	if err := saveArrConfig(cfg); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/arr/services/test — testuje połączenie z konkretnym serwisem
func handleArrServicesTest(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ ID string `json:"id"` }
	json.NewDecoder(r.Body).Decode(&req)

	cfg := loadArrConfig()
	var found *ArrService
	for i := range cfg.Services {
		if cfg.Services[i].ID == req.ID {
			found = &cfg.Services[i]
			break
		}
	}
	if found == nil {
		jsonErr(w, "serwis nie znaleziony", http.StatusNotFound)
		return
	}

	// Włącz tymczasowo na czas testu
	tmp := *found
	tmp.Enabled = true
	st := probeArrService(tmp)
	jsonOK(w, st)
}

// GET /api/downloads/arr/status — status wszystkich serwisów (włączonych i nie)
// Włączone — probe live; wyłączone — tylko dane konfiguracyjne + state=disabled
func handleArrStatus(w http.ResponseWriter, r *http.Request) {
	cfg := loadArrConfig()

	results := make([]ArrStatus, len(cfg.Services))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i, svc := range cfg.Services {
		// Ustaw dane konfiguracyjne zawsze
		results[i] = ArrStatus{
			ID:          svc.ID,
			Name:        svc.Name,
			URL:         svc.URL,
			Enabled:     svc.Enabled,
			HasKey:      svc.APIKey != "",
			Username:    svc.Username,
			HasPassword: svc.Password != "",
			State:       "disabled",
		}
		if !svc.Enabled {
			continue // nie probe wyłączonych
		}
		idx := i
		wg.Add(1)
		go func(s ArrService, resultIdx int) {
			defer wg.Done()
			st := probeArrService(s)
			// Zachowaj pola konfiguracyjne w wyniku live probe
			st.Enabled     = s.Enabled
			st.HasKey      = s.APIKey != ""
			st.Username    = s.Username
			st.HasPassword = s.Password != ""
			mu.Lock()
			results[resultIdx] = st
			mu.Unlock()
		}(svc, idx)
	}
	wg.Wait()

	// Sortuj według kolejności defaultowej
	order := map[string]int{"sonarr": 0, "radarr": 1, "prowlarr": 2, "qbit": 3, "sabnzbd": 4, "bazarr": 5}
	for i := 0; i < len(results)-1; i++ {
		for j := i + 1; j < len(results); j++ {
			if order[results[i].ID] > order[results[j].ID] {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	jsonOK(w, map[string]any{"services": results})
}

// GET /api/downloads/arr/queue — pobiera aktualne zadania z qBittorrent i kolejki Sonarr/Radarr
// Zwraca ujednoliconą listę zadań z zewnętrznych klientów
func handleArrQueue(w http.ResponseWriter, r *http.Request) {
	cfg := loadArrConfig()
	tasks := []map[string]any{}

	for _, svc := range cfg.Services {
		if !svc.Enabled {
			continue
		}
		switch svc.ID {
		case "qbit":
			tasks = append(tasks, fetchQbitTasks(svc)...)
		case "sonarr", "radarr":
			tasks = append(tasks, fetchArrTasks(svc)...)
		}
	}

	jsonOK(w, map[string]any{"tasks": tasks, "count": len(tasks)})
}

// fetchQbitTasks pobiera torrenty z qBittorrent Web API
func fetchQbitTasks(svc ArrService) []map[string]any {
	sid, err := qbitGetSID(svc)
	if err != nil {
		return nil
	}

	body, code, err := qbitGet(svc.URL, "/api/v2/torrents/info", sid)
	if err != nil || code != 200 {
		return nil
	}

	var torrents []struct {
		Hash       string  `json:"hash"`
		Name       string  `json:"name"`
		Size       int64   `json:"size"`
		Downloaded int64   `json:"downloaded"`
		DlSpeed    int64   `json:"dlspeed"`
		UpSpeed    int64   `json:"upspeed"`
		Progress   float64 `json:"progress"`
		State      string  `json:"state"`
		ETA        int64   `json:"eta"`
		Ratio      float64 `json:"ratio"`
		NumSeeds   int     `json:"num_seeds"`
		NumLeechs  int     `json:"num_leechs"`
		SavePath   string  `json:"save_path"`
		Category   string  `json:"category"`
		AddedOn    int64   `json:"added_on"`
		Tags       string  `json:"tags"`
	}
	if json.Unmarshal(body, &torrents) != nil {
		return nil
	}

	stateMap := map[string]string{
		"downloading": "downloading", "uploading": "seeding",
		"stalledDL":   "downloading", "stalledUP": "seeding",
		"pausedDL":    "paused",      "pausedUP":  "paused",
		"queuedDL":    "queued",      "queuedUP":  "queued",
		"checkingDL":  "downloading", "checkingUP": "done",
		"error":       "error",       "missingFiles": "error",
		"moving":      "downloading",
		"forcedDL":    "downloading", "forcedUP": "seeding",
	}

	result := make([]map[string]any, 0, len(torrents))
	for _, t := range torrents {
		status := stateMap[t.State]
		if status == "" {
			status = "queued"
		}
		dlMBs := float64(t.DlSpeed) / 1024 / 1024
		upMBs := float64(t.UpSpeed) / 1024 / 1024

		speedStr := ""
		if dlMBs > 0 {
			speedStr = fmt.Sprintf("↓%.1f MB/s", dlMBs)
		}
		if upMBs > 0 {
			if speedStr != "" { speedStr += " " }
			speedStr += fmt.Sprintf("↑%.1f MB/s", upMBs)
		}

		etaStr := ""
		if t.ETA > 0 && t.ETA < 8640000 {
			if t.ETA < 3600 {
				etaStr = fmt.Sprintf("%dm %ds", t.ETA/60, t.ETA%60)
			} else {
				etaStr = fmt.Sprintf("%dh %dm", t.ETA/3600, (t.ETA%3600)/60)
			}
		}

		sizeMB := float64(t.Size) / 1024 / 1024
		dlMB   := float64(t.Downloaded) / 1024 / 1024

		result = append(result, map[string]any{
			"id":         "qbit-" + t.Hash[:8],
			"name":       t.Name,
			"filename":   t.Name,
			"url":        "",
			"status":     status,
			"state":      status,
			"progress":   t.Progress * 100,
			"speed":      speedStr,
			"speedDn":    dlMBs,
			"speedUp":    upMBs,
			"size_total": fmt.Sprintf("%.1f GB", sizeMB/1024),
			"size_done":  fmt.Sprintf("%.1f GB", dlMB/1024),
			"size":       sizeMB / 1024,
			"done":       dlMB / 1024,
			"eta":        etaStr,
			"ratio":      t.Ratio,
			"peers": map[string]any{
				"seeds": t.NumSeeds,
				"leech": t.NumLeechs,
			},
			"dest_dir":   t.SavePath,
			"category":   "torrent",
			"kind":       "torrent",
			"tag":        "qbit",
			"source":     "qbit",
			"cat":        t.Category,
			"tags":       t.Tags,
		})
	}
	return result
}

// fetchArrTasks pobiera kolejkę z Sonarr lub Radarr
func fetchArrTasks(svc ArrService) []map[string]any {
	body, code, err := arrHTTPGet(svc.URL, "/api/v3/queue?pageSize=100&includeUnknownSeriesItems=true", svc.APIKey)
	if err != nil || code != 200 {
		return nil
	}

	var resp struct {
		Records []struct {
			ID                int64   `json:"id"`
			Title             string  `json:"title"`
			Size              float64 `json:"size"`
			Sizeleft          float64 `json:"sizeleft"`
			Status            string  `json:"status"`
			TrackedDownloadStatus string `json:"trackedDownloadStatus"`
			DownloadID        string  `json:"downloadId"`
			Protocol          string  `json:"protocol"`
			DownloadClient    string  `json:"downloadClient"`
			OutputPath        string  `json:"outputPath"`
			EstimatedCompletionTime string `json:"estimatedCompletionTime"`
		} `json:"records"`
	}
	if json.Unmarshal(body, &resp) != nil {
		return nil
	}

	stateMap := map[string]string{
		"downloading": "downloading",
		"queued":      "queued",
		"paused":      "paused",
		"completed":   "done",
		"failed":      "error",
		"warning":     "downloading",
		"delay":       "queued",
	}

	result := make([]map[string]any, 0, len(resp.Records))
	for _, rec := range resp.Records {
		status := stateMap[strings.ToLower(rec.Status)]
		if status == "" { status = "queued" }
		pct := 0.0
		if rec.Size > 0 {
			pct = (1 - rec.Sizeleft/rec.Size) * 100
		}
		sizeMB := rec.Size / 1024 / 1024
		result = append(result, map[string]any{
			"id":         fmt.Sprintf("%s-%d", svc.ID, rec.ID),
			"name":       rec.Title,
			"filename":   rec.Title,
			"status":     status,
			"state":      status,
			"progress":   pct,
			"size":       sizeMB / 1024,
			"size_total": fmt.Sprintf("%.1f GB", sizeMB/1024),
			"size_done":  fmt.Sprintf("%.1f GB", (sizeMB-rec.Sizeleft/1024/1024)/1024),
			"category":   svc.ID,
			"kind":       rec.Protocol,
			"tag":        svc.ID,
			"source":     svc.ID,
		})
	}
	return result
}

// POST /api/downloads/arr/notify — powiadamia *arr o ukończonym pobraniu
// Wywoływane automatycznie po zakończeniu zadania lub manualnie z frontendu
// Body: { "task_id": "dl-123", "path": "/mnt/downloads/film.mkv" }
func handleArrNotify(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		TaskID string `json:"task_id"`
		Path   string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Pobierz task z kolejki
	dlMu.Lock()
	var task *DownloadTask
	if req.TaskID != "" {
		task = dlTasks[req.TaskID]
	}
	// Jeśli nie podano task_id, sprawdź ostatnie ukończone
	if task == nil && req.TaskID == "" {
		for i := len(dlOrder) - 1; i >= 0; i-- {
			if t, ok := dlTasks[dlOrder[i]]; ok && t.Status == "done" {
				task = t
				break
			}
		}
	}
	dlMu.Unlock()

	if task == nil {
		jsonErr(w, "task not found", http.StatusNotFound)
		return
	}

	path := req.Path
	if path == "" {
		path = filepath.Join(task.DestDir, task.Filename)
	}

	results := notifyArr(task, path)
	jsonOK(w, map[string]any{"ok": true, "results": results})
}

// notifyArr wysyła powiadomienie do Sonarr/Radarr po ukończeniu pobrania
func notifyArr(task *DownloadTask, path string) []map[string]any {
	cfg := loadArrConfig()
	results := []map[string]any{}

	for _, svc := range cfg.Services {
		if !svc.Enabled || svc.APIKey == "" {
			continue
		}
		// Tylko Sonarr i Radarr mają endpoint /api/v3/command dla DownloadedEpisodesScan
		if svc.ID != "sonarr" && svc.ID != "radarr" {
			continue
		}

		commandName := "DownloadedEpisodesScan"
		if svc.ID == "radarr" {
			commandName = "DownloadedMoviesScan"
		}

		body, _ := json.Marshal(map[string]any{
			"name": commandName,
			"path": filepath.Dir(path),
		})

		req, err := http.NewRequest("POST",
			strings.TrimRight(svc.URL, "/")+"/api/v3/command",
			strings.NewReader(string(body)))
		if err != nil {
			results = append(results, map[string]any{"service": svc.ID, "ok": false, "error": err.Error()})
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Api-Key", svc.APIKey)

		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			results = append(results, map[string]any{"service": svc.ID, "ok": false, "error": err.Error()})
			continue
		}
		resp.Body.Close()

		results = append(results, map[string]any{
			"service": svc.ID,
			"ok":      resp.StatusCode == 201 || resp.StatusCode == 200,
			"status":  resp.StatusCode,
		})
		log.Printf("nimbus-dl: notify %s → %s HTTP %d", svc.ID, commandName, resp.StatusCode)
	}
	return results
}

// autoNotifyArr wywołuje notifyArr automatycznie po zakończeniu zadania
// Podpinamy to w dlSetDone
func autoNotifyArr(id string) {
	dlMu.Lock()
	task, ok := dlTasks[id]
	if !ok {
		dlMu.Unlock()
		return
	}
	path := filepath.Join(task.DestDir, task.Filename)
	taskCopy := *task
	dlMu.Unlock()

	results := notifyArr(&taskCopy, path)
	for _, r := range results {
		if ok, _ := r["ok"].(bool); ok {
			log.Printf("nimbus-dl [%s]: powiadomiono %s", id, r["service"])
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── RSS monitorowanie ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// rssHistoryMu chroni rssHistory
var (
	rssHistoryMu sync.Mutex
	rssHistory   []RSSHistoryItem
)

type RSSHistoryItem struct {
	FeedName  string `json:"feed_name"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	MatchedAt string `json:"matched_at"`
	TaskID    string `json:"task_id"`
	DestDir   string `json:"dest_dir"`
}

// GET /api/downloads/rss
func handleRSSList(w http.ResponseWriter, r *http.Request) {
	cfg := loadArrConfig()
	jsonOK(w, map[string]any{"feeds": cfg.Feeds})
}

// POST /api/downloads/rss/save
func handleRSSSave(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct {
		Feeds []RSSFeed `json:"feeds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid json", http.StatusBadRequest)
		return
	}
	// Uzupełnij brakujące ID
	for i := range req.Feeds {
		if req.Feeds[i].ID == "" {
			req.Feeds[i].ID = fmt.Sprintf("feed-%d", time.Now().UnixNano()+int64(i))
		}
		if req.Feeds[i].DestDir == "" {
			req.Feeds[i].DestDir = loadDLConfig().DefaultDir
		}
	}

	cfg := loadArrConfig()
	cfg.Feeds = req.Feeds
	if err := saveArrConfig(cfg); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/downloads/rss/refresh  { "id": "feed-..." }
func handleRSSRefresh(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	var req struct{ ID string `json:"id"` }
	json.NewDecoder(r.Body).Decode(&req)

	cfg := loadArrConfig()
	for i := range cfg.Feeds {
		if cfg.Feeds[i].ID == req.ID || req.ID == "" {
			matched := pollFeed(&cfg.Feeds[i])
			_ = saveArrConfig(cfg)
			jsonOK(w, map[string]any{"ok": true, "matched": matched})
			return
		}
	}
	jsonErr(w, "feed not found", http.StatusNotFound)
}

// GET /api/downloads/rss/history
func handleRSSHistory(w http.ResponseWriter, r *http.Request) {
	rssHistoryMu.Lock()
	h := make([]RSSHistoryItem, len(rssHistory))
	copy(h, rssHistory)
	rssHistoryMu.Unlock()
	jsonOK(w, map[string]any{"history": h})
}

// rssPoller co 15 minut odpytuje wszystkie włączone feedy
func rssPoller() {
	// Pierwsze odpytanie po 30 sekundach od startu
	time.Sleep(30 * time.Second)
	for {
		cfg := loadArrConfig()
		for i := range cfg.Feeds {
			if cfg.Feeds[i].Enabled {
				pollFeed(&cfg.Feeds[i])
			}
		}
		saveArrConfig(cfg)
		time.Sleep(15 * time.Minute)
	}
}

// pollFeed pobiera feed RSS i dodaje do kolejki pasujące itemy
// Zwraca liczbę nowo dopasowanych itemów
func pollFeed(feed *RSSFeed) int {
	if feed.URL == "" || !feed.Enabled {
		return 0
	}

	req, err := http.NewRequest("GET", feed.URL, nil)
	if err != nil {
		log.Printf("nimbus-dl RSS [%s]: błąd tworzenia req: %v", feed.Name, err)
		return 0
	}
	req.Header.Set("User-Agent", "nimbus-dl/"+version)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("nimbus-dl RSS [%s]: błąd HTTP: %v", feed.Name, err)
		return 0
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0
	}

	feed.LastFetch = time.Now().Format("2006-01-02 15:04:05")

	// Parsuj RSS/Atom — szukamy <item> lub <entry>
	items := parseRSSItems(string(body))
	feed.Items = len(items)

	if len(items) == 0 {
		return 0
	}

	// Kompiluj regex filtr
	var filterRe *regexp.Regexp
	if feed.Filter != "" {
		filterRe, err = regexp.Compile("(?i)" + feed.Filter)
		if err != nil {
			log.Printf("nimbus-dl RSS [%s]: nieprawidłowy regex %q: %v", feed.Name, feed.Filter, err)
		}
	}

	destDir := feed.DestDir
	if destDir == "" {
		destDir = loadDLConfig().DefaultDir
	}

	matched := 0
	dropped := 0

	for _, item := range items {
		if filterRe != nil && !filterRe.MatchString(item.Title) {
			dropped++
			continue
		}
		if item.Link == "" {
			dropped++
			continue
		}

		// Sprawdź czy już jest w kolejce
		dlMu.Lock()
		alreadyQueued := false
		for _, t := range dlTasks {
			if t.URL == item.Link {
				alreadyQueued = true
				break
			}
		}
		dlMu.Unlock()
		if alreadyQueued {
			continue
		}

		// Dodaj do kolejki
		taskID := fmt.Sprintf("dl-%d", time.Now().UnixNano())
		task := &DownloadTask{
			ID:        taskID,
			URL:       item.Link,
			Filename:  sanitizeFilename(item.Title),
			DestDir:   destDir,
			Status:    "queued",
			CreatedAt: time.Now().Format("2006-01-02 15:04:05"),
			Category:  guessCategory(item.Link),
		}

		dlMu.Lock()
		dlTasks[taskID] = task
		dlOrder = append(dlOrder, taskID)
		dlMu.Unlock()

		dlEnqueue()
		matched++

		rssHistoryMu.Lock()
		rssHistory = append([]RSSHistoryItem{{
			FeedName:  feed.Name,
			Title:     item.Title,
			URL:       item.Link,
			MatchedAt: time.Now().Format("2006-01-02 15:04:05"),
			TaskID:    taskID,
			DestDir:   destDir,
		}}, rssHistory...)
		// Ogranicz historię do 200 wpisów
		if len(rssHistory) > 200 {
			rssHistory = rssHistory[:200]
		}
		rssHistoryMu.Unlock()

		log.Printf("nimbus-dl RSS [%s]: dodano %q → %s", feed.Name, item.Title, taskID)
	}

	feed.Matched += matched
	feed.Dropped += dropped

	if matched > 0 {
		saveState()
	}
	return matched
}

type rssItem struct {
	Title string
	Link  string
}

// parseRSSItems parsuje RSS 2.0 i Atom — minimalistyczny parser bez xml.Unmarshal
func parseRSSItems(body string) []rssItem {
	var items []rssItem

	// RSS 2.0: <item>...</item>
	itemRe := regexp.MustCompile(`(?is)<item>(.*?)</item>`)
	titleRe := regexp.MustCompile(`(?i)<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
	linkRe  := regexp.MustCompile(`(?i)<link>([^<]+)</link>`)
	encRe   := regexp.MustCompile(`(?i)<enclosure[^>]+url="([^"]+)"`)

	for _, m := range itemRe.FindAllStringSubmatch(body, -1) {
		chunk := m[1]
		title, link := "", ""

		if tm := titleRe.FindStringSubmatch(chunk); len(tm) > 1 {
			title = strings.TrimSpace(tm[1])
		}
		if lm := linkRe.FindStringSubmatch(chunk); len(lm) > 1 {
			link = strings.TrimSpace(lm[1])
		}
		// Dla torrent RSS: link może być w <enclosure>
		if link == "" {
			if em := encRe.FindStringSubmatch(chunk); len(em) > 1 {
				link = strings.TrimSpace(em[1])
			}
		}
		if title != "" && link != "" {
			items = append(items, rssItem{Title: title, Link: link})
		}
	}

	// Atom: <entry>...</entry>
	entryRe   := regexp.MustCompile(`(?is)<entry>(.*?)</entry>`)
	atomLinkRe := regexp.MustCompile(`(?i)<link[^>]+href="([^"]+)"`)

	for _, m := range entryRe.FindAllStringSubmatch(body, -1) {
		chunk := m[1]
		title, link := "", ""
		if tm := titleRe.FindStringSubmatch(chunk); len(tm) > 1 {
			title = strings.TrimSpace(tm[1])
		}
		if lm := atomLinkRe.FindStringSubmatch(chunk); len(lm) > 1 {
			link = strings.TrimSpace(lm[1])
		}
		if title != "" && link != "" {
			items = append(items, rssItem{Title: title, Link: link})
		}
	}

	return items
}

func sanitizeFilename(s string) string {
	re := regexp.MustCompile(`[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\-_. ]`)
	return strings.TrimSpace(re.ReplaceAllString(s, "_"))
}

/*
─── INSTALACJA ────────────────────────────────────────────────────────────────

1. Kompilacja:
   go build -o /usr/local/bin/nimbus-dl nimbus-dl.go

2. Plik systemd: /etc/systemd/system/nimbus-dl.service

   [Unit]
   Description=Nimbus Download Center daemon
   After=network.target

   [Service]
   Type=simple
   ExecStart=/usr/local/bin/nimbus-dl \
     -port 9797 \
     -token YOUR_SECRET_TOKEN \
     -state /var/lib/nimbus \
     -config /etc/nas-panel
   Restart=on-failure
   RestartSec=5s
   User=root

   [Install]
   WantedBy=multi-user.target

3. Uruchomienie:
   systemctl daemon-reload
   systemctl enable --now nimbus-dl
   systemctl status nimbus-dl

4. Konfiguracja integracji (przez API lub ręcznie w /etc/nas-panel/dl-integrations.json):
   curl -X POST http://localhost:9797/api/downloads/arr/services/save \
     -H "X-Dl-Token: YOUR_SECRET_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"services":[
       {"id":"sonarr","url":"http://localhost:8989","api_key":"SONARR_KEY","enabled":true},
       {"id":"radarr","url":"http://localhost:7878","api_key":"RADARR_KEY","enabled":true},
       {"id":"qbit","url":"http://localhost:8080","enabled":true}
     ]}'

5. Proxy z głównego server.go (opcjonalne — frontend może też rozmawiać z :9797 bezpośrednio):

   import "net/http/httputil"

   func (s *Server) proxyToDownloader(w http.ResponseWriter, r *http.Request) {
       target, _ := url.Parse("http://127.0.0.1:9797")
       proxy := httputil.NewSingleHostReverseProxy(target)
       // Przekaż token
       r.Header.Set("X-Dl-Token", os.Getenv("NIMBUS_DL_TOKEN"))
       proxy.ServeHTTP(w, r)
   }

   // W routes():
   a("/api/downloads",    s.proxyToDownloader)
   a("/api/downloads/",   s.proxyToDownloader)

──────────────────────────────────────────────────────────────────────────────
*/
