package api

// terminal.go — Prawdziwy terminal PTY przez WebSocket
//
// Architektura:
//   Browser (xterm.js) ←→ WebSocket ←→ Go PTY ←→ /bin/bash
//
// Protokół WebSocket (binary frames):
//   Wejście (browser → server):
//     byte[0] = '0'  → stdin data (reszta = bajty do zapisu do PTY)
//     byte[0] = '1'  → resize: byte[1..4] = cols uint16 LE, byte[5..8] = rows uint16 LE
//   Wyjście (server → browser):
//     surowe bajty z PTY stdout (xterm.js je renderuje bezpośrednio)
//
// Endpointy:
//   GET  /terminal/ws?cols=N&rows=N   — WebSocket z PTY
//   GET  /terminal/sessions           — aktywne sesje
//   GET  /terminal/shells             — dostępne shelle

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// ── WebSocket upgrader ────────────────────────────────────────────────────────

var termUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true }, // auth przez middleware
}

// ── Sesja PTY ─────────────────────────────────────────────────────────────────

type ptySession struct {
	ID      string    `json:"id"`
	Shell   string    `json:"shell"`
	Created time.Time `json:"created"`
	PID     int       `json:"pid"`
}

var (
	ptySessions   = map[string]*ptySession{}
	ptySessionsMu sync.Mutex
)

// ── WebSocket handler — serce terminala ──────────────────────────────────────

// GET /terminal/ws?cols=220&rows=50&shell=/bin/bash
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	// Parametry startowe
	cols := uint16(220)
	rows := uint16(50)
	if v := r.URL.Query().Get("cols"); v != "" {
		if n, err := fmt.Sscanf(v, "%d", new(int)); n == 1 && err == nil {
			var tmp int
			fmt.Sscanf(v, "%d", &tmp)
			cols = uint16(tmp)
		}
	}
	if v := r.URL.Query().Get("rows"); v != "" {
		var tmp int
		fmt.Sscanf(v, "%d", &tmp)
		rows = uint16(tmp)
	}

	shell := r.URL.Query().Get("shell")
	if shell == "" {
		shell = os.Getenv("SHELL")
	}
	if shell == "" {
		for _, sh := range []string{"/bin/bash", "/bin/sh", "/usr/bin/bash"} {
			if _, err := os.Stat(sh); err == nil {
				shell = sh
				break
			}
		}
	}

	// Upgrade do WebSocket
	conn, err := termUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("terminal ws upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Uruchom shell w PTY
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		fmt.Sprintf("COLUMNS=%d", cols),
		fmt.Sprintf("LINES=%d", rows),
		"COLORTERM=truecolor",
		"HOME=/root",
		"HISTCONTROL=ignoreboth",
	)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("\r\nBłąd uruchomienia PTY: "+err.Error()+"\r\n"))
		return
	}
	defer func() {
		ptmx.Close()
		cmd.Process.Kill()
	}()

	// Zarejestruj sesję
	sessID := fmt.Sprintf("pty-%d", time.Now().UnixNano())
	sess := &ptySession{
		ID:      sessID,
		Shell:   shell,
		Created: time.Now(),
		PID:     cmd.Process.Pid,
	}
	ptySessionsMu.Lock()
	ptySessions[sessID] = sess
	ptySessionsMu.Unlock()
	defer func() {
		ptySessionsMu.Lock()
		delete(ptySessions, sessID)
		ptySessionsMu.Unlock()
	}()

	// ── Goroutine: PTY → WebSocket ────────────────────────────────────────
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err2 := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err2 != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// ── Pętla: WebSocket → PTY ────────────────────────────────────────────
	conn.SetReadDeadline(time.Time{}) // brak timeout na read
	for {
		select {
		case <-done:
			return
		default:
		}

		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if len(msg) == 0 {
			continue
		}

		switch msg[0] {
		case '0':
			// Dane wejściowe → stdin PTY
			ptmx.Write(msg[1:])

		case '1':
			// Resize: cols uint16 LE + rows uint16 LE
			if len(msg) >= 5 {
				newCols := binary.LittleEndian.Uint16(msg[1:3])
				newRows := binary.LittleEndian.Uint16(msg[3:5])
				if newCols > 0 && newRows > 0 {
					pty.Setsize(ptmx, &pty.Winsize{
						Cols: newCols,
						Rows: newRows,
					})
				}
			}
		}
	}
}

// ── Pozostałe handlery ────────────────────────────────────────────────────────

func (s *Server) handleTerminalSessions(w http.ResponseWriter, r *http.Request) {
	ptySessionsMu.Lock()
	list := make([]*ptySession, 0, len(ptySessions))
	for _, sess := range ptySessions {
		list = append(list, sess)
	}
	ptySessionsMu.Unlock()
	jsonOK(w, map[string]any{"sessions": list, "count": len(list)})
}

func (s *Server) handleTerminalSessionItem(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

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

func (s *Server) handleTerminalPreferences(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		jsonOK(w, map[string]string{"status": "ok"})
		return
	}
	jsonOK(w, map[string]any{
		"font_size":  14,
		"theme":      "dark",
		"scrollback": 5000,
		"bell":       false,
	})
}

func (s *Server) handleTerminalStats(w http.ResponseWriter, r *http.Request) {
	ptySessionsMu.Lock()
	count := len(ptySessions)
	ptySessionsMu.Unlock()
	jsonOK(w, map[string]any{"active_sessions": count})
}

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
		files = append(files, map[string]any{"name": e.Name(), "dir": e.IsDir(), "size": size})
	}
	jsonOK(w, map[string]any{"path": path, "files": files})
}

func (s *Server) handleTerminalCleanup(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"removed": 0})
}

// handleTerminalExecute zachowane dla kompatybilności (stary frontend)
func (s *Server) handleTerminalExecute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Command string `json:"command"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Command == "" {
		jsonOK(w, map[string]any{"output": "", "exit_code": 0})
		return
	}
	cmd := exec.Command("/bin/bash", "-c", req.Command)
	out, err := cmd.CombinedOutput()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = 1
		}
	}
	jsonOK(w, map[string]any{"output": string(out), "exit_code": code})
}
