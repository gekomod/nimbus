package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

const serversConfigPath = "/etc/nas-panel/servers.json"

type remoteServer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	KeyPath  string `json:"key_path,omitempty"`
}

var (
	remoteServers   = map[string]remoteServer{}
	remoteServersMu sync.Mutex
)

func init() {
	loadServersFromDisk()
}

func loadServersFromDisk() {
	data, err := os.ReadFile(serversConfigPath)
	if err != nil {
		return // plik nie istnieje — pierwsza instalacja
	}
	var list []remoteServer
	if err := json.Unmarshal(data, &list); err != nil {
		return
	}
	remoteServersMu.Lock()
	defer remoteServersMu.Unlock()
	for _, srv := range list {
		remoteServers[srv.ID] = srv
	}
}

func saveServersToDisk() error {
	remoteServersMu.Lock()
	list := make([]remoteServer, 0, len(remoteServers))
	for _, v := range remoteServers {
		list = append(list, v)
	}
	remoteServersMu.Unlock()

	if err := os.MkdirAll("/etc/nas-panel", 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(serversConfigPath, data, 0600) // 0600 — hasła w środku
}

// sshRun łączy przez SSH z auth hasłem (bez interaktywnego terminala).
func sshRun(srv remoteServer, cmd string) (string, error) {
	var authMethods []gossh.AuthMethod

	if srv.Password != "" {
		authMethods = append(authMethods, gossh.Password(srv.Password))
		authMethods = append(authMethods, gossh.KeyboardInteractive(
			func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = srv.Password
				}
				return answers, nil
			},
		))
	}

	if len(authMethods) == 0 {
		return "", fmt.Errorf("brak metody autoryzacji — podaj hasło lub klucz SSH")
	}

	cfg := &gossh.ClientConfig{
		User:            srv.Username,
		Auth:            authMethods,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}

	client, err := gossh.Dial("tcp", fmt.Sprintf("%s:%d", srv.Host, srv.Port), cfg)
	if err != nil {
		return "", fmt.Errorf("połączenie nieudane: %w", err)
	}
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("sesja nieudana: %w", err)
	}
	defer sess.Close()

	var buf bytes.Buffer
	sess.Stdout = &buf
	sess.Stderr = &buf
	sess.Run(cmd)
	return strings.TrimSpace(buf.String()), nil
}

// sshReachable sprawdza TCP — bez auth.
func sshReachable(srv remoteServer) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", srv.Host, srv.Port), 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}


// ── Handlers ────────────────────────────────────────────────────────────────

func (s *Server) handleServers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		remoteServersMu.Lock()
		list := make([]remoteServer, 0, len(remoteServers))
		for _, v := range remoteServers { sv := v; sv.Password = ""; list = append(list, sv) }
		remoteServersMu.Unlock()
		jsonOK(w, map[string]any{"servers": list})

	case http.MethodPost:
		var srv remoteServer
		if err := json.NewDecoder(r.Body).Decode(&srv); err != nil || srv.Host == "" {
			jsonErr(w, "host required", http.StatusBadRequest); return
		}
		if srv.ID == "" {
			srv.ID = strings.ReplaceAll(srv.Host, ".", "-") + "-" + strings.ReplaceAll(srv.Name, " ", "-")
		}
		if srv.Port == 0 { srv.Port = 22 }

		remoteServersMu.Lock()
		remoteServers[srv.ID] = srv
		remoteServersMu.Unlock()

		if err := saveServersToDisk(); err != nil {
			jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError); return
		}
		jsonOK(w, map[string]string{"status": "ok", "id": srv.ID})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleServerItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/servers/")
	parts  := strings.SplitN(suffix, "/", 2)
	id     := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }

	remoteServersMu.Lock()
	srv, ok := remoteServers[id]
	remoteServersMu.Unlock()

	if !ok && action == "" && (r.Method == http.MethodGet || r.Method == http.MethodDelete || r.Method == http.MethodPut) {
		jsonErr(w, "server not found", http.StatusNotFound); return
	}

	run := func(cmd string) (string, error) { return sshRun(srv, cmd) }

	switch action {
	case "":
		switch r.Method {
		case http.MethodGet:
			sv := srv; sv.Password = ""; jsonOK(w, sv)

		case http.MethodPut:
			var updated remoteServer
			json.NewDecoder(r.Body).Decode(&updated)
			updated.ID = id
			// Zachowaj hasło jeśli nie przesłano nowego
			if updated.Password == "" {
				remoteServersMu.Lock()
				if ex, exists := remoteServers[id]; exists { updated.Password = ex.Password }
				remoteServersMu.Unlock()
			}
			remoteServersMu.Lock()
			remoteServers[id] = updated
			remoteServersMu.Unlock()
			if err := saveServersToDisk(); err != nil {
				jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError); return
			}
			jsonOK(w, map[string]string{"status": "ok"})

		case http.MethodDelete:
			remoteServersMu.Lock()
			delete(remoteServers, id)
			remoteServersMu.Unlock()
			if err := saveServersToDisk(); err != nil {
				jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError); return
			}
			jsonOK(w, map[string]string{"status": "ok"})

		default:
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	case "test":
		out, err := run("echo ok")
		jsonOK(w, map[string]any{"ok": err == nil, "output": out, "error": errStr(err)})

	case "connect":
		out, err := run("echo connected")
		if err != nil { jsonErr(w, "połączenie nieudane: "+err.Error(), http.StatusBadGateway); return }
		jsonOK(w, map[string]string{"status": "ok", "id": id, "output": out})

	case "disconnect":
		jsonOK(w, map[string]string{"status": "ok"})

	case "ping":
		ok := sshReachable(srv)
		jsonOK(w, map[string]any{"ok": ok, "reachable": ok, "host": srv.Host})

	case "fast-ping", "simple-ping":
		ok := sshReachable(srv)
		jsonOK(w, map[string]any{"reachable": ok, "host": srv.Host})

	case "status":
		_, err := run("uptime")
		jsonOK(w, map[string]any{"online": err == nil, "host": srv.Host})

	case "stats":
		uptime, _ := run("uptime")
		mem, _    := run("free -m")
		jsonOK(w, map[string]any{"uptime": uptime, "memory": mem})

	case "hostname":
		out, _ := run("hostname")
		jsonOK(w, map[string]string{"hostname": strings.TrimSpace(out)})

	case "network":
		out, _ := run("ip addr")
		jsonOK(w, map[string]any{"raw": out})

	case "disks":
		out, _ := run("df -h")
		jsonOK(w, map[string]any{"raw": out})

	case "processes":
		out, _ := run("ps aux --sort=-%cpu | head -25")
		jsonOK(w, map[string]any{"raw": out})

	case "logs":
		n := r.URL.Query().Get("n"); if n == "" { n = "50" }
		out, _ := run("journalctl -n " + n + " --no-pager 2>/dev/null || tail -n " + n + " /var/log/syslog 2>/dev/null || echo 'brak logów'")
		jsonOK(w, map[string]any{"logs": strings.Split(out, "\n")})

	case "users":
		out, _ := run("who")
		jsonOK(w, map[string]any{"raw": out})

	case "restart":
		if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
		run("systemctl reboot")
		jsonOK(w, map[string]string{"status": "ok"})

	case "shutdown":
		if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
		run("systemctl poweroff")
		jsonOK(w, map[string]string{"status": "ok"})

	case "services":
		out, _ := run("systemctl list-units --type=service --state=running --no-pager --no-legend")
		jsonOK(w, map[string]any{"raw": out})

	case "services/active":
		out, _ := run("systemctl list-units --type=service --state=active --no-pager --no-legend")
		jsonOK(w, map[string]any{"raw": out})

	default:
		if strings.HasPrefix(action, "processes/") && strings.HasSuffix(action, "/kill") {
			pid := strings.TrimSuffix(strings.TrimPrefix(action, "processes/"), "/kill")
			run("kill -15 " + pid)
			jsonOK(w, map[string]string{"status": "ok"}); return
		}
		if strings.HasPrefix(action, "services/") {
			parts2 := strings.Split(strings.TrimPrefix(action, "services/"), "/")
			if len(parts2) >= 2 {
				run("systemctl " + parts2[1] + " " + parts2[0])
				jsonOK(w, map[string]string{"status": "ok"}); return
			}
		}
		jsonOK(w, map[string]any{"action": action})
	}
}

func itoa(n int) string {
	if n == 0 { return "0" }
	s := ""
	for n > 0 { s = string(rune('0'+n%10)) + s; n /= 10 }
	return s
}
