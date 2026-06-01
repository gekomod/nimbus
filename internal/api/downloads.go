package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ─── Typy ─────────────────────────────────────────────────────────────────────

type DownloadTask struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	Filename  string  `json:"filename"`
	DestDir   string  `json:"dest_dir"`
	Status    string  `json:"status"`   // "queued" | "downloading" | "done" | "error" | "cancelled"
	Progress  float64 `json:"progress"` // 0-100
	Speed     string  `json:"speed"`    // "1.2 MB/s"
	SizeTotal string  `json:"size_total"`
	SizeDone  string  `json:"size_done"`
	ETA       string  `json:"eta"`
	Error     string  `json:"error,omitempty"`
	CreatedAt string  `json:"created_at"`
	DoneAt    string  `json:"done_at,omitempty"`
	Category  string  `json:"category"` // "file" | "iso" | "torrent" | "yt"
}

// ─── Stan globalny ────────────────────────────────────────────────────────────

var dlMu    sync.Mutex
var dlTasks = map[string]*DownloadTask{}
var dlOrder []string // kolejność ID

const dlConfigPath = "/var/lib/nimbus/downloads.json"

func init() {
	os.MkdirAll("/var/lib/nimbus", 0755)
	loadDownloads()
}

func loadDownloads() {
	data, err := os.ReadFile(dlConfigPath)
	if err != nil { return }
	var tasks []*DownloadTask
	if json.Unmarshal(data, &tasks) != nil { return }
	for _, t := range tasks {
		dlTasks[t.ID] = t
		dlOrder = append(dlOrder, t.ID)
	}
}

func saveDownloads() {
	tasks := orderedTasks()
	data, _ := json.MarshalIndent(tasks, "", "  ")
	os.WriteFile(dlConfigPath, data, 0644)
}

func orderedTasks() []*DownloadTask {
	dlMu.Lock()
	defer dlMu.Unlock()
	result := make([]*DownloadTask, 0, len(dlOrder))
	for _, id := range dlOrder {
		if t, ok := dlTasks[id]; ok {
			result = append(result, t)
		}
	}
	return result
}

func newDLID() string {
	return fmt.Sprintf("dl-%d", time.Now().UnixNano())
}

// ─── Kategoria po rozszerzeniu/URL ───────────────────────────────────────────

func guessCategory(rawURL string) string {
	lower := strings.ToLower(rawURL)
	switch {
	case strings.Contains(lower, "cda.pl"):
		return "cda"
	case strings.Contains(lower, "youtube.com") || strings.Contains(lower, "youtu.be") ||
		strings.Contains(lower, "vimeo.com") || strings.Contains(lower, "twitch.tv"):
		return "yt"
	case strings.HasSuffix(lower, ".torrent") || strings.HasPrefix(lower, "magnet:"):
		return "torrent"
	case strings.HasSuffix(lower, ".iso") || strings.HasSuffix(lower, ".img"):
		return "iso"
	default:
		return "file"
	}
}

// ─── Scheduler pobierań ───────────────────────────────────────────────────────

var dlSchedMu  sync.Mutex
var dlActive   int            // liczba aktualnie aktywnych pobierań
var dlWakeUp   = make(chan struct{}, 1) // sygnał do sprawdzenia kolejki

func init() {
	go dlScheduler()
}

// dlScheduler to jedyna goroutine która uruchamia pobierania.
// Sprawdza kolejkę i uruchamia zadania gdy są wolne sloty.
func dlScheduler() {
	for range dlWakeUp {
		for {
			dlSchedMu.Lock()
			maxC := dlGetMaxConcurrent()
			if dlActive >= maxC {
				dlSchedMu.Unlock()
				break
			}

			// Znajdź pierwsze zadanie w statusie "queued"
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
				runDownload(id)
				dlSchedMu.Lock()
				dlActive--
				dlSchedMu.Unlock()
				// Obudź scheduler po zakończeniu — może być kolejne zadanie
				select {
				case dlWakeUp <- struct{}{}:
				default:
				}
			}(nextID)
		}
	}
}

func dlGetMaxConcurrent() int {
	data, err := os.ReadFile("/etc/nas-panel/downloads-config.json")
	if err != nil { return 3 }
	var cfg struct{ MaxConcurrent int `json:"max_concurrent"` }
	json.Unmarshal(data, &cfg)
	if cfg.MaxConcurrent <= 0 { return 3 }
	return cfg.MaxConcurrent
}

// dlEnqueue dodaje zadanie do kolejki i budzi scheduler
func dlEnqueue() {
	select {
	case dlWakeUp <- struct{}{}:
	default:
	}
}

// ─── Wykonywanie pobierania ───────────────────────────────────────────────────

func runDownload(id string) {
	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok { dlMu.Unlock(); return }
	t.Status = "downloading"
	dlMu.Unlock()

	dest := filepath.Join(t.DestDir, t.Filename)
	os.MkdirAll(t.DestDir, 0755)

	var cmd *exec.Cmd

	switch t.Category {
	case "cda":
		// Własny downloader CDA — parsuje player_data z HTML i pobiera przez HLS (m3u8)
		runCDADownload(id, t)
		return

	case "yt":
		// yt-dlp jeśli zainstalowany
		ytdlp, err := exec.LookPath("yt-dlp")
		if err != nil {
			ytdlp, err = exec.LookPath("youtube-dl")
		}
		if err != nil {
			dlSetError(id, "yt-dlp nie jest zainstalowany. Zainstaluj przez: pip3 install yt-dlp")
			return
		}
		cmd = exec.Command(ytdlp,
			"--progress", "--newline",
			"-o", filepath.Join(t.DestDir, "%(title)s.%(ext)s"),
			t.URL,
		)
	case "torrent":
		// aria2c dla torrentów i magnet
		aria2, err := exec.LookPath("aria2c")
		if err != nil {
			dlSetError(id, "aria2c nie jest zainstalowany. Zainstaluj przez: apt install aria2")
			return
		}
		cmd = exec.Command(aria2,
			"--dir="+t.DestDir,
			"--summary-interval=1",
			"--show-console-readout=false",
			t.URL,
		)
	default:
		// wget dla zwykłych plików
		cmd = exec.Command("wget",
			"-c",             // kontynuuj przerwane
			"--progress=dot:mega",
			"-P", t.DestDir,
			"-O", dest,
			t.URL,
		)
	}

	// Przechwytuj stdout+stderr
	pipe, err := cmd.StderrPipe()
	if err == nil {
		cmd.Stdout = cmd.Stderr
	}
	if err2 := cmd.Start(); err2 != nil {
		dlSetError(id, err2.Error())
		return
	}

	// Parsuj postęp w tle
	if pipe != nil {
		go parseWgetProgress(id, pipe, t.Category)
	}

	err = cmd.Wait()

	dlMu.Lock()
	t2, ok2 := dlTasks[id]
	if ok2 {
		if t2.Status == "cancelled" {
			os.Remove(dest)
		} else if err != nil && t2.Status != "cancelled" {
			t2.Status = "error"
			t2.Error  = err.Error()
		} else {
			t2.Status   = "done"
			t2.Progress = 100
			t2.DoneAt   = time.Now().Format("2006-01-02 15:04:05")
			t2.Speed    = ""
			t2.ETA      = ""
		}
	}
	dlMu.Unlock()
	saveDownloads()
}

func dlSetError(id, msg string) {
	dlMu.Lock()
	if t, ok := dlTasks[id]; ok {
		t.Status = "error"
		t.Error  = msg
	}
	dlMu.Unlock()
	saveDownloads()
}

// parseWgetProgress parsuje linie postępu z wget
func parseWgetProgress(id string, r io.Reader, category string) {
	buf := make([]byte, 4096)
	var line strings.Builder
	for {
		n, err := r.Read(buf)
		if n > 0 {
			for _, b := range buf[:n] {
				if b == '\r' || b == '\n' {
					parseSingleLine(id, line.String(), category)
					line.Reset()
				} else {
					line.WriteByte(b)
				}
			}
		}
		if err != nil { break }
	}
}

func parseSingleLine(id, line, category string) {
	line = strings.TrimSpace(line)
	if line == "" { return }

	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok { dlMu.Unlock(); return }

	switch category {
	case "yt":
		// [download]  12.5% of 45.23MiB at 1.23MiB/s ETA 00:35
		if strings.HasPrefix(line, "[download]") {
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
		}
	case "torrent":
		// aria2c: [#abc 1.2MiB/10MiB(12%) CN:1 DL:500KiB ETA:30s]
		if strings.Contains(line, "DL:") {
			var pct float64
			if idx := strings.Index(line, "("); idx >= 0 {
				fmt.Sscanf(line[idx:], "(%f%%)", &pct)
				t.Progress = pct
			}
			if idx := strings.Index(line, "DL:"); idx >= 0 {
				parts := strings.Fields(line[idx:])
				if len(parts) > 0 {
					t.Speed = strings.TrimPrefix(parts[0], "DL:")
				}
			}
		}
	default:
		// wget: 650K .......... 12% 1.23MB/s 45s
		if len(line) > 0 && (line[0] == ' ' || strings.Contains(line, "%")) {
			parts := strings.Fields(line)
			for i, p := range parts {
				if strings.HasSuffix(p, "%") {
					var pct float64
					fmt.Sscanf(p, "%f%%", &pct)
					t.Progress = pct
				}
				if i+1 < len(parts) && (strings.HasSuffix(p, "K") || strings.HasSuffix(p, "M") || strings.HasSuffix(p, "G")) {
					t.SizeDone = p
				}
				if strings.Contains(p, "B/s") {
					t.Speed = p
				}
				if strings.HasSuffix(p, "s") && !strings.Contains(p, "B/s") && i == len(parts)-1 {
					t.ETA = p
				}
			}
		}
	}
	dlMu.Unlock()
}

// ─── CDA helpers ─────────────────────────────────────────────────────────────

type cdaPlayerData struct {
	Video struct {
		ID            string            `json:"id"`
		Title         string            `json:"title"`
		ManifestApple string            `json:"manifest_apple"` // HLS m3u8
		Manifest      string            `json:"manifest"`       // DASH mpd
		Qualities     map[string]string `json:"qualities"`
		Duration      json.Number       `json:"duration"` // CDA zwraca liczbę sekund, nie string
		Thumb         string            `json:"thumb"`
		ForAdults     bool              `json:"for_adults"`
		Premium       bool              `json:"premium"`
	} `json:"video"`
}

// cdaSession przechowuje cookies sesji CDA (PHPSESSID + ps*) pobrane z głównej strony.
// Odświeżamy je co 45 minut albo gdy otrzymamy błąd 403.
var (
	cdaSessionMu      sync.Mutex
	cdaSessionCookies string
	cdaSessionExpiry  time.Time
)

// cdaGetSessionCookies zwraca string z cookies do wysłania do CDA.
// Gdy użytkownik zapisał swoją sesję — używa jej bezpośrednio.
// W przeciwnym razie pobiera anonimową sesję z głównej strony CDA.
func cdaGetSessionCookies() string {
	// Jeśli użytkownik ma zapisaną sesję — użyj jej, nie mieszaj z anonimowymi cookies
	if cfg := loadCDAConfig(); cfg.SessionCookie != "" {
		return cfg.SessionCookie
	}

	// Brak sesji użytkownika — pobierz anonimową sesję (PHPSESSID + ps*)
	cdaSessionMu.Lock()
	defer cdaSessionMu.Unlock()

	if time.Now().Before(cdaSessionExpiry) && cdaSessionCookies != "" {
		return cdaSessionCookies
	}

	req, err := http.NewRequest("GET", "https://www.cda.pl/", nil)
	if err != nil {
		return "cda.player=html5"
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
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

// parseCDAPage pobiera stronę CDA i wyciąga player_data
// checkCDADRM sprawdza czy strumień HLS ma FairPlay DRM (SAMPLE-AES).
// Pobiera master manifest i pierwszy sub-manifest, szuka EXT-X-KEY SAMPLE-AES.
func checkCDADRM(masterURL, cookies string) (bool, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	doGet := func(u string) (string, error) {
		req, err := http.NewRequest("GET", u, nil)
		if err != nil { return "", err }
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
		req.Header.Set("Referer", "https://www.cda.pl/")
		if cookies != "" { req.Header.Set("Cookie", cookies) }
		resp, err := client.Do(req)
		if err != nil { return "", err }
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return string(body), nil
	}
	master, err := doGet(masterURL)
	if err != nil { return false, err }
	if strings.Contains(master, "SAMPLE-AES") || strings.Contains(master, "skd://") {
		return true, nil
	}
	// Sprawdź pierwszy sub-manifest
	parsed, _ := url.Parse(masterURL)
	for _, line := range strings.Split(master, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") { continue }
		subURL := line
		if strings.HasPrefix(line, "/") {
			subURL = parsed.Scheme + "://" + parsed.Host + line
		} else if !strings.HasPrefix(line, "http") {
			subURL = masterURL[:strings.LastIndex(masterURL, "/")+1] + line
		}
		sub, err := doGet(subURL)
		if err != nil { return false, err }
		return strings.Contains(sub, "SAMPLE-AES") || strings.Contains(sub, "skd://"), nil
	}
	return false, nil
}

func parseCDAPage(rawURL string) (*cdaPlayerData, error) {
	// Normalizuj URL
	pageURL := rawURL
	if !strings.Contains(pageURL, "://") {
		pageURL = "https://" + pageURL
	}
	pageURL = strings.Replace(pageURL, "://m.cda.pl", "://www.cda.pl", 1)
	// Usuń tylko fragment (#...) — /vfilm jest prawidłową częścią URL CDA
	if idx := strings.Index(pageURL, "#"); idx != -1 {
		pageURL = pageURL[:idx]
	}

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil { return nil, err }
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req.Header.Set("Accept-Language", "pl-PL,pl;q=0.9")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Cookie", cdaGetSessionCookies())

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return nil, fmt.Errorf("HTTP GET: %w", err) }
	defer resp.Body.Close()

	if resp.StatusCode == 410 {
		return nil, fmt.Errorf("film niedostępny (HTTP 410) — może być usunięty lub wymaga premium")
	}
	if resp.StatusCode == 403 {
		// Wymuś odświeżenie sesji i spróbuj jeszcze raz
		cdaSessionMu.Lock()
		cdaSessionExpiry = time.Time{} // invalidate cache
		cdaSessionMu.Unlock()

		req2, _ := http.NewRequest("GET", pageURL, nil)
		req2.Header.Set("User-Agent", req.Header.Get("User-Agent"))
		req2.Header.Set("Accept-Language", req.Header.Get("Accept-Language"))
		req2.Header.Set("Accept", req.Header.Get("Accept"))
		req2.Header.Set("Cookie", cdaGetSessionCookies())
		client2 := &http.Client{Timeout: 15 * time.Second}
		if resp2, err2 := client2.Do(req2); err2 == nil {
			resp.Body.Close()
			resp = resp2
		} else {
			return nil, fmt.Errorf("HTTP 403 — brak dostępu (może wymagać konta CDA)")
		}
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil { return nil, err }
	html := string(body)

	// Wyciągnij player_data='...' z HTML
	// CDA może kodować apostrofy jako &#039; lub &apos; i używać cudzysłowów
	re := regexp.MustCompile(`player_data='(\{[^']+\})'`)
	m := re.FindStringSubmatch(html)
	if len(m) < 2 {
		re2 := regexp.MustCompile(`player_data="(\{[^"]+\})"`)
		m2 := re2.FindStringSubmatch(html)
		if len(m2) < 2 {
			// Ostatnia szansa — szukaj data-player='...'
			re3 := regexp.MustCompile(`data-player='(\{[^']+\})'`)
			m3 := re3.FindStringSubmatch(html)
			if len(m3) < 2 {
				return nil, fmt.Errorf("nie znaleziono player_data w HTML — możliwe że film wymaga logowania lub jest usunięty")
			}
			m = m3
		} else {
			m = m2
		}
	}

	// Odkoduj HTML entities które CDA wstawia w JSON (np. &quot; → ", &#039; → ')
	playerJSON := m[1]
	playerJSON = strings.ReplaceAll(playerJSON, "&quot;", `"`)
	playerJSON = strings.ReplaceAll(playerJSON, "&#039;", "'")
	playerJSON = strings.ReplaceAll(playerJSON, "&amp;", "&")
	playerJSON = strings.ReplaceAll(playerJSON, "&#x2F;", "/")

	var pd cdaPlayerData
	if err := json.Unmarshal([]byte(playerJSON), &pd); err != nil {
		return nil, fmt.Errorf("błąd parsowania player_data: %w", err)
	}

	if pd.Video.ManifestApple == "" && pd.Video.Manifest == "" {
		if pd.Video.Premium {
			return nil, fmt.Errorf("film wymaga CDA Premium")
		}
		return nil, fmt.Errorf("brak URL do strumienia w player_data")
	}

	return &pd, nil
}

// runCDADownload pobiera film z CDA bez yt-dlp: parsuje player_data, bierze HLS URL,
// pobiera przez ffmpeg z retry przy przerwaniu
func runCDADownload(id string, t *DownloadTask) {
	setMsg := func(msg string) {
		dlMu.Lock()
		if task, ok := dlTasks[id]; ok { task.Speed = msg }
		dlMu.Unlock()
	}
	setStatus := func(s string) {
		dlMu.Lock()
		if task, ok := dlTasks[id]; ok { task.Status = s }
		dlMu.Unlock()
	}
	isCancelled := func() bool {
		dlMu.Lock()
		defer dlMu.Unlock()
		t2, ok := dlTasks[id]
		return ok && t2.Status == "cancelled"
	}

	setStatus("downloading")
	setMsg("Parsowanie strony CDA…")

	// 1. Parsuj stronę CDA
	pd, err := parseCDAPage(t.URL)
	if err != nil {
		dlSetError(id, err.Error())
		return
	}

	// qualities w player_data CDA zawiera aliasy (hd/sd/lq), NIE prawdziwe URL-e.
	// Prawidłowy strumień HLS jest zawsze w ManifestApple lub Manifest.
	streamURL := pd.Video.ManifestApple
	if streamURL == "" {
		streamURL = pd.Video.Manifest
	}
	if streamURL == "" {
		dlSetError(id, fmt.Sprintf("Brak URL streamu — ManifestApple=%q Manifest=%q", pd.Video.ManifestApple, pd.Video.Manifest))
		return
	}

	// Sprawdź DRM przed próbą pobierania
	setMsg("Sprawdzanie strumienia…")
	if hasDRM, _ := checkCDADRM(streamURL, cdaGetSessionCookies()); hasDRM {
		dlSetError(id, "Film chroniony FairPlay DRM — pobieranie niemożliwe. CDA chroni ten tytuł szyfrowaniem Apple FairPlay (SAMPLE-AES). Tylko Safari/iOS może go odtworzyć.")
		return
	}

	// 2. Ustal nazwę pliku
	dlMu.Lock()
	task := dlTasks[id]
	if task == nil { dlMu.Unlock(); return }

	title := pd.Video.Title
	if title == "" { title = pd.Video.ID }
	if dec, e2 := url.QueryUnescape(strings.ReplaceAll(title, "+", " ")); e2 == nil { title = dec }
	sanitized := regexp.MustCompile(`[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\-_. ]`).ReplaceAllString(title, "_")
	sanitized = strings.TrimSpace(sanitized)

	if task.Filename == "" || task.Filename == "auto" {
		task.Filename = sanitized + ".mp4"
	} else if !strings.Contains(task.Filename, ".") {
		task.Filename += ".mp4"
	}
	// Usuń tag jakości z nazwy jeśli istnieje (aliasy CDA, nie używamy do wyboru URL)
	task.Filename = regexp.MustCompile(`\s*\[\d+p\]`).ReplaceAllString(task.Filename, "")
	task.Filename = strings.TrimSpace(task.Filename)

	destPath := filepath.Join(task.DestDir, task.Filename)
	destDir  := task.DestDir
	dlMu.Unlock()

	// Upewnij się że katalog istnieje i jest zapisywalny
	if err := os.MkdirAll(destDir, 0755); err != nil {
		dlSetError(id, fmt.Sprintf("Nie można utworzyć katalogu %q: %v", destDir, err))
		return
	}
	if testF, err2 := os.CreateTemp(destDir, ".nimbus_test_*"); err2 != nil {
		dlSetError(id, fmt.Sprintf("Brak uprawnień do zapisu w %q: %v", destDir, err2))
		return
	} else {
		testF.Close()
		os.Remove(testF.Name())
	}

	ffmpeg, ffErr := exec.LookPath("ffmpeg")
	if ffErr != nil {
		dlSetError(id, "ffmpeg nie jest zainstalowany — apt install ffmpeg")
		return
	}

	// Czas trwania z player_data — json.Number może być "137" lub 137
	totalSec := parseDurationStr(pd.Video.Duration.String())

	// 3. Próby pobierania z retry
	const maxRetries = 4
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if isCancelled() { return }

		if attempt > 1 {
			waitSec := attempt * 5
			setMsg(fmt.Sprintf("Próba %d/%d (czekam %ds po błędzie)…", attempt, maxRetries, waitSec))
			setStatus("downloading")
			time.Sleep(time.Duration(waitSec) * time.Second)
			if isCancelled() { return }

			// Odśwież stream URL — linki HLS wygasają po czasie
			setMsg(fmt.Sprintf("Próba %d/%d — odświeżam link…", attempt, maxRetries))
			if pd2, err2 := parseCDAPage(t.URL); err2 == nil {
				newStream := pd2.Video.ManifestApple
				if newStream == "" { newStream = pd2.Video.Manifest }
				if newStream != "" { streamURL = newStream }
			}
		}

		// Nie wywołuj ffmpeg jeśli nie mamy prawidłowego URL streamu
		if streamURL == "" {
			if attempt < maxRetries {
				setMsg(fmt.Sprintf("Próba %d/%d — brak URL streamu, czekam…", attempt, maxRetries))
				time.Sleep(time.Duration(attempt*5) * time.Second)
				if pd2, err2 := parseCDAPage(t.URL); err2 == nil {
					newStream := pd2.Video.ManifestApple
					if newStream == "" { newStream = pd2.Video.Manifest }
					if newStream != "" { streamURL = newStream }
				}
				continue
			}
			dlSetError(id, "Nie można uzyskać URL streamu HLS z CDA — sprawdź połączenie i czy film jest dostępny")
			return
		}

		setMsg(fmt.Sprintf("Pobieranie HLS…%s", func() string {
			if attempt > 1 { return fmt.Sprintf(" (próba %d)", attempt) }
			return ""
		}()))

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
		}

		// Wznów pobieranie jeśli plik już częściowo istnieje
		if info, err2 := os.Stat(destPath); err2 == nil && info.Size() > 0 {
			// ffmpeg nie obsługuje resume dla HLS — skasuj i zacznij od nowa
			// (HLS segmenty i tak są pobierane od początku manifestu)
			os.Remove(destPath)
		}

		args = append(args, destPath)

		cmd := exec.Command(ffmpeg, args...)

		// Przechwyć CAŁY stderr — zarówno statystyki jak i błędy
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

		// Parsuj stderr w osobnej goroutine + zbieraj do bufora
		doneParsing := make(chan struct{})
		go func() {
			defer close(doneParsing)
			buf := make([]byte, 4096)
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
				if readErr != nil { break }
			}
			if line.Len() > 0 {
				parseFfmpegLine(id, line.String(), totalSec)
			}
		}()

		// Watchdog: jeśli ani progress ani rozmiar pliku nie zmieniają się przez 180s → kill
		type watchdogState struct {
			lastProgress float64
			lastSize     int64
			lastChange   time.Time
		}
		wdState := &watchdogState{lastChange: time.Now()}
		wdDone := make(chan struct{})
		go func() {
			defer close(wdDone)
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					dlMu.Lock()
					t2, ok2 := dlTasks[id]
					if !ok2 { dlMu.Unlock(); return }
					cancelled  := t2.Status == "cancelled"
					currentPct := t2.Progress
					dlMu.Unlock()

					if cancelled {
						cmd.Process.Kill()
						return
					}
					if currentPct >= 99 {
						continue
					}
					currentSize := int64(0)
					if info, err := os.Stat(destPath); err == nil {
						currentSize = info.Size()
					}
					if currentPct != wdState.lastProgress || currentSize != wdState.lastSize {
						wdState.lastProgress = currentPct
						wdState.lastSize     = currentSize
						wdState.lastChange   = time.Now()
					} else if time.Since(wdState.lastChange) > 180*time.Second {
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
		// Watchdog może wciąż działać — daj mu chwilę
		select {
		case <-wdDone:
		case <-time.After(100 * time.Millisecond):
		}

		// Sprawdź czy anulowano
		if isCancelled() {
			os.Remove(destPath)
			dlMu.Lock()
			if t2, ok2 := dlTasks[id]; ok2 { t2.Status = "cancelled" }
			dlMu.Unlock()
			saveDownloads()
			return
		}

		if cmdErr == nil {
			// Sukces
			dlMu.Lock()
			if t2, ok2 := dlTasks[id]; ok2 {
				t2.Status   = "done"
				t2.Progress = 100
				t2.DoneAt   = time.Now().Format("2006-01-02 15:04:05")
				t2.Speed    = ""
				t2.ETA      = ""
			}
			dlMu.Unlock()
			saveDownloads()
			return
		}

		// Błąd — przygotuj czytelny komunikat
		stderr := strings.TrimSpace(stderrBuf.String())
		// Wyciągnij ostatnie sensowne linie błędu (pomiń statystyki)
		errLines := []string{}
		for _, line := range strings.Split(stderr, "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "Error") || strings.Contains(line, "error") ||
				strings.Contains(line, "Invalid") || strings.Contains(line, "Failed") ||
				strings.Contains(line, "Connection") || strings.Contains(line, "Timeout") ||
				strings.Contains(line, "HTTP") || strings.Contains(line, "forbidden") ||
				strings.Contains(line, "403") || strings.Contains(line, "404") ||
				strings.Contains(line, "410") {
				errLines = append(errLines, line)
			}
		}

		errMsg := cmdErr.Error()
		if len(errLines) > 0 {
			// Weź ostatni błąd (najbardziej aktualny)
			last := errLines[len(errLines)-1]
			// Skróć jeśli za długi
			if len(last) > 120 {
				last = last[:120] + "…"
			}
			errMsg = last
		}

		if attempt < maxRetries {
			dlMu.Lock()
			if t2, ok2 := dlTasks[id]; ok2 {
				t2.Speed = fmt.Sprintf("Błąd (próba %d): %s", attempt, errMsg)
			}
			dlMu.Unlock()
			continue
		}

		// Ostatnia próba — ustaw error
		dlSetError(id, fmt.Sprintf("[próba %d/%d] %s", attempt, maxRetries, errMsg))
		saveDownloads()
	}
}

// parseFfmpegProgress parsuje output ffmpeg: "size= 2048kB time=00:00:20.50 bitrate= 819.2kbits/s speed=2.05x"
// ffmpeg pisze status na stderr używając \r (nadpisuje linię) — obsługujemy obie opcje
func parseFfmpegProgress(id string, r io.Reader, durationStr string) {
	var totalSec float64
	if durationStr != "" {
		fmt.Sscanf(durationStr, "%f", &totalSec)
	}

	buf := make([]byte, 8192)
	var line strings.Builder
	for {
		n, err := r.Read(buf)
		if n > 0 {
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
		if err != nil { break }
	}
	// Flush ostatniej linii
	if line.Len() > 0 {
		parseFfmpegLine(id, line.String(), totalSec)
	}
}

var (
	reFFTime    = regexp.MustCompile(`time=\s*(\d+):(\d+):([\d.]+)`)
	reFFSpeed   = regexp.MustCompile(`speed=\s*([\d.]+)x`)
	reFFSize    = regexp.MustCompile(`size=\s*(\d+)kB`)
	reFFBitrate = regexp.MustCompile(`bitrate=\s*([\d.]+\s*\w+bits/s)`)
)


// parseDurationStr konwertuje string ("137") lub json.Number na float64 sekund
func parseDurationStr(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" {
		return 0
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

func parseFfmpegLine(id, line string, totalSec float64) {
	line = strings.TrimSpace(line)
	if line == "" || !strings.Contains(line, "time=") { return }

	dlMu.Lock()
	t, ok := dlTasks[id]
	if !ok { dlMu.Unlock(); return }

	// Czas przetworzony → progress
	if timeM := reFFTime.FindStringSubmatch(line); len(timeM) == 4 {
		var h, m, s float64
		fmt.Sscanf(timeM[1], "%f", &h)
		fmt.Sscanf(timeM[2], "%f", &m)
		fmt.Sscanf(timeM[3], "%f", &s)
		currentSec := h*3600 + m*60 + s
		if totalSec > 0 && currentSec > 0 {
			pct := (currentSec / totalSec) * 100
			if pct > 99 { pct = 99 }
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
		// SizeTotal = całkowity czas trwania (czytelny)
		totalMins := int(totalSec) / 60
		totalSecs := int(totalSec) % 60
		t.SizeTotal = fmt.Sprintf("%d:%02d", totalMins, totalSecs)
	}

	// Speed (np. "2.50x")
	if speedM := reFFSpeed.FindStringSubmatch(line); len(speedM) == 2 {
		t.Speed = speedM[1] + "×"
	}

	// Rozmiar pobrany w MB → SizeDone
	if sizeM := reFFSize.FindStringSubmatch(line); len(sizeM) == 2 {
		var kb float64
		fmt.Sscanf(sizeM[1], "%f", &kb)
		if kb >= 1024 {
			t.SizeDone = fmt.Sprintf("%.1f MB", kb/1024)
		} else {
			t.SizeDone = fmt.Sprintf("%.0f kB", kb)
		}
	}

	dlMu.Unlock()
}

// extractCDAQuality wyciąga żądaną jakość z pola Filename
// np. "moj_film [720p]" → "720"
func extractCDAQuality(filename string) string {
	re := regexp.MustCompile(`\[(\d+)p\]`)
	m := re.FindStringSubmatch(filename)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func cleanCDAQualityTag(filename string) string {
	re := regexp.MustCompile(`\s*\[\d+p\]`)
	return strings.TrimSpace(re.ReplaceAllString(filename, ""))
}

type CDAConfig struct {
	DefaultQuality string `json:"default_quality"`
	SessionCookie  string `json:"session_cookie"` // wklejone z przeglądarki przez użytkownika
}

const cdaConfigPath = "/etc/nas-panel/cda-config.json"



func loadCDAConfig() CDAConfig {
	data, err := os.ReadFile(cdaConfigPath)
	cfg := CDAConfig{DefaultQuality: "best"}
	if err == nil { json.Unmarshal(data, &cfg) }
	return cfg
}

func saveCDAConfig(cfg CDAConfig) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.MkdirAll("/etc/nas-panel", 0755)
	return os.WriteFile(cdaConfigPath, data, 0600)
}

// cdaLogin loguje się do CDA przez HTTP i zapisuje session cookie
func cdaLogin(username, password string) (string, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}

	// 1. Pobierz token CSRF ze strony logowania
	req, _ := http.NewRequest("GET", "https://www.cda.pl/login", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req.Header.Set("Cookie", "cda.player=html5")
	resp, err := client.Do(req)
	if err != nil { return "", fmt.Errorf("GET login page: %w", err) }
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	html := string(body)

	// Wyciągnij CSRF token
	csrfRe := regexp.MustCompile(`name="_token"\s+value="([^"]+)"`)
	csrfM  := csrfRe.FindStringSubmatch(html)
	csrf   := ""
	if len(csrfM) > 1 { csrf = csrfM[1] }

	// 2. POST login
	formData := url.Values{
		"username": {username},
		"password": {password},
		"_token":   {csrf},
	}
	req2, _ := http.NewRequest("POST", "https://www.cda.pl/login", strings.NewReader(formData.Encode()))
	req2.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req2.Header.Set("Referer", "https://www.cda.pl/login")
	req2.Header.Set("Cookie", "cda.player=html5")

	resp2, err := client.Do(req2)
	if err != nil { return "", fmt.Errorf("POST login: %w", err) }
	resp2.Body.Close()

	// 3. Zbierz session cookies z jar
	u, _ := url.Parse("https://www.cda.pl")
	cookies := jar.Cookies(u)
	var sessionParts []string
	for _, c := range cookies {
		if c.Name == "cda_session" || c.Name == "remember_me" ||
			c.Name == "PHPSESSID" || strings.HasPrefix(c.Name, "cda_") {
			sessionParts = append(sessionParts, c.Name+"="+c.Value)
		}
	}

	if len(sessionParts) == 0 {
		return "", fmt.Errorf("logowanie nieudane — sprawdź login i hasło")
	}
	return strings.Join(sessionParts, "; "), nil
}


// ─── HTTP Handlers — zastąpione przez nimbus-dl proxy ───────────────────────
//
// Wszystkie handleDownloads* i handleCDA* metody zostały usunięte.
// server.go proxy-uje /api/downloads/* bezpośrednio do nimbus-dl (:9797).
// Patrz: handleDownloadsProxy w server.go
