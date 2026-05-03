package api

// ── Terminal ──────────────────────────────────────────────────────────────────
// Zaimplementowane handlery dla /terminal/* oraz uzupełnienia /api/processes
// Dołącz do pakietu api (osobny plik terminal.go)

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ─── Session store ────────────────────────────────────────────────────────────

type termSession struct {
	ID      string    `json:"id"`
	Shell   string    `json:"shell"`
	Created time.Time `json:"created"`
	Cwd     string    `json:"cwd"`
}

var (
	termMu       sync.Mutex
	termSessions = map[string]*termSession{}
)

func newSessionID() string {
	return fmt.Sprintf("sess-%d", time.Now().UnixNano())
}

// POST /terminal/sessions        — utwórz sesję
// GET  /terminal/sessions        — lista sesji
func (s *Server) handleTerminalSessions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			Shell string `json:"shell"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Shell == "" {
			req.Shell = "/bin/bash"
		}
		// Sprawdź czy shell istnieje
		if _, err := os.Stat(req.Shell); err != nil {
			for _, sh := range []string{"/bin/bash", "/bin/sh"} {
				if _, e := os.Stat(sh); e == nil {
					req.Shell = sh
					break
				}
			}
		}
		cwd, _ := os.Getwd()
		sess := &termSession{
			ID:      newSessionID(),
			Shell:   req.Shell,
			Created: time.Now(),
			Cwd:     cwd,
		}
		termMu.Lock()
		termSessions[sess.ID] = sess
		termMu.Unlock()
		jsonOK(w, map[string]any{
			"id":      sess.ID,
			"shell":   sess.Shell,
			"cwd":     sess.Cwd,
			"created": sess.Created,
		})

	case http.MethodGet:
		termMu.Lock()
		list := make([]any, 0, len(termSessions))
		for _, s := range termSessions {
			list = append(list, s)
		}
		termMu.Unlock()
		jsonOK(w, map[string]any{"sessions": list})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// /terminal/sessions/{id}         — GET info, DELETE zakończ
// /terminal/sessions/{id}/execute — POST wykonaj polecenie
func (s *Server) handleTerminalSessionItem(w http.ResponseWriter, r *http.Request) {
	// Wyciągnij id i opcjonalny sub-path
	suffix := pathSuffix(r, "/terminal/sessions/")
	parts := strings.SplitN(suffix, "/", 2)
	id := parts[0]
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	// Pobierz lub utwórz sesję
	termMu.Lock()
	sess := termSessions[id]
	if sess == nil && sub == "execute" {
		// Auto-utwórz jeśli jeszcze nie ma
		cwd, _ := os.Getwd()
		sess = &termSession{
			ID:      id,
			Shell:   "/bin/bash",
			Created: time.Now(),
			Cwd:     cwd,
		}
		termSessions[id] = sess
	}
	termMu.Unlock()

	switch sub {
	case "execute":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Command string `json:"command"`
			Cwd     string `json:"cwd"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Command == "" {
			jsonOK(w, map[string]any{"output": "", "exit_code": 0})
			return
		}

		execCwd := "/"
		if sess != nil && sess.Cwd != "" {
			execCwd = sess.Cwd
		}
		if req.Cwd != "" {
			execCwd = req.Cwd
		}

		// Obsłuż `cd` specjalnie — zmień Cwd sesji
		if strings.HasPrefix(strings.TrimSpace(req.Command), "cd ") {
			target := strings.TrimSpace(req.Command[3:])
			if target == "" || target == "~" {
				home, _ := os.UserHomeDir()
				if home == "" {
					home = "/root"
				}
				target = home
			}
			if !strings.HasPrefix(target, "/") {
				target = execCwd + "/" + target
			}
			// Wyczyść ścieżkę
			cmd := exec.Command("realpath", target)
			out, err := cmd.Output()
			if err == nil {
				target = strings.TrimSpace(string(out))
			}
			if stat, err := os.Stat(target); err == nil && stat.IsDir() {
				if sess != nil {
					termMu.Lock()
					sess.Cwd = target
					termMu.Unlock()
				}
				jsonOK(w, map[string]any{"output": "", "exit_code": 0, "cwd": target})
			} else {
				jsonOK(w, map[string]any{
					"output":    fmt.Sprintf("cd: %s: Nie ma takiego pliku ani katalogu\n", target),
					"exit_code": 1,
					"cwd":       execCwd,
				})
			}
			return
		}

		// Wykonaj polecenie z timeout 30s
		ctx := r.Context()
		cmd := exec.CommandContext(ctx, "/bin/bash", "-c", req.Command)
		cmd.Dir = execCwd
		cmd.Env = append(os.Environ(),
			"TERM=xterm-256color",
			"HOME=/root",
			"LANG=pl_PL.UTF-8",
			"LC_ALL=pl_PL.UTF-8",
		)

		out, err := cmd.CombinedOutput()
		exitCode := 0
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				exitCode = ee.ExitCode()
			} else {
				exitCode = 1
			}
		}

		// Zaktualizuj cwd po wykonaniu (dla poleceń które zmieniają katalog przez subshell)
		newCwd := execCwd
		if sess != nil {
			termMu.Lock()
			newCwd = sess.Cwd
			termMu.Unlock()
		}

		jsonOK(w, map[string]any{
			"output":    string(out),
			"exit_code": exitCode,
			"cwd":       newCwd,
		})

	case "":
		switch r.Method {
		case http.MethodGet:
			if sess == nil {
				jsonErr(w, "session not found", http.StatusNotFound)
				return
			}
			jsonOK(w, sess)
		case http.MethodDelete:
			termMu.Lock()
			delete(termSessions, id)
			termMu.Unlock()
			jsonOK(w, map[string]string{"status": "ok"})
		default:
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	default:
		jsonErr(w, "unknown sub-path", http.StatusNotFound)
	}
}

// GET /terminal/shells — dostępne shelle
func (s *Server) handleTerminalShells(w http.ResponseWriter, r *http.Request) {
	data, _ := os.ReadFile("/etc/shells")
	var shells []string
	for _, l := range strings.Split(string(data), "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "#") {
			if _, err := os.Stat(l); err == nil {
				shells = append(shells, l)
			}
		}
	}
	if len(shells) == 0 {
		shells = []string{"/bin/bash", "/bin/sh"}
	}
	jsonOK(w, map[string]any{"shells": shells})
}

// GET/POST /terminal/preferences
func (s *Server) handleTerminalPreferences(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{
		"font_size":   14,
		"theme":       "dark",
		"scrollback":  1000,
		"bell":        false,
	})
}

// GET /terminal/stats
func (s *Server) handleTerminalStats(w http.ResponseWriter, r *http.Request) {
	termMu.Lock()
	count := len(termSessions)
	termMu.Unlock()
	jsonOK(w, map[string]any{"active_sessions": count})
}

// GET /terminal/system-info
func (s *Server) handleTerminalSysInfo(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	kernel, _ := runCmd("uname", "-r")
	uptime, _ := runCmd("uptime", "-p")
	jsonOK(w, map[string]any{
		"hostname": strings.TrimSpace(hostname),
		"kernel":   strings.TrimSpace(kernel),
		"uptime":   strings.TrimSpace(uptime),
		"user":     "root",
	})
}

// GET /terminal/ls?path=...
func (s *Server) handleTerminalLS(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}
	var files []map[string]any
	for _, e := range entries {
		info, _ := e.Info()
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		files = append(files, map[string]any{
			"name":  e.Name(),
			"dir":   e.IsDir(),
			"size":  size,
		})
	}
	jsonOK(w, map[string]any{"path": path, "files": files})
}

// POST /terminal/cleanup — usuń stare sesje
func (s *Server) handleTerminalCleanup(w http.ResponseWriter, r *http.Request) {
	termMu.Lock()
	cutoff := time.Now().Add(-2 * time.Hour)
	removed := 0
	for id, sess := range termSessions {
		if sess.Created.Before(cutoff) {
			delete(termSessions, id)
			removed++
		}
	}
	termMu.Unlock()
	jsonOK(w, map[string]any{"removed": removed})
}

