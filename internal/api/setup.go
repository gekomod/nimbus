package api

// ─── Setup Wizard — pierwsze uruchomienie ────────────────────────────────────

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

const setupDoneFile = "/etc/nas-panel/setup-complete"

// SetupStatus — co jest zainstalowane, co nie
type SetupStatus struct {
	Done       bool                 `json:"done"`
	Components map[string]CompState `json:"components"`
}

type CompState struct {
	Installed bool   `json:"installed"`
	Active    bool   `json:"active"`
	Version   string `json:"version,omitempty"`
}

func setupDone() bool {
	_, err := os.Stat(setupDoneFile)
	return err == nil
}

func markSetupDone() {
	os.MkdirAll("/etc/nas-panel", 0755)
	os.WriteFile(setupDoneFile, []byte("1"), 0644)
}

func binVersion(name string, args ...string) string {
	if len(args) == 0 {
		args = []string{"--version"}
	}
	out, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	line := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
	// Skróć do max 30 znaków
	if len(line) > 30 {
		line = line[:30]
	}
	return line
}

func checkComp(bin string, versionArgs ...string) CompState {
	path, err := exec.LookPath(bin)
	if err != nil || path == "" {
		return CompState{Installed: false}
	}
	ver := binVersion(bin, versionArgs...)
	active := false
	// Sprawdź usługę systemd
	serviceMap := map[string]string{
		"docker":      "docker",
		"clamscan":    "clamav-daemon",
		"wg":          "wg-quick@wg0",
		"fail2ban-client": "fail2ban",
		"ufw":         "ufw",
		"zpool":       "",
		"python3":     "",
		"rsync":       "",
		"htop":        "",
		"iotop":       "",
		"ncdu":        "",
		"smartctl":    "",
		"lm-sensors":  "lm-sensors",
		"sensors":     "lm-sensors",
	}
	if svc, ok := serviceMap[bin]; ok && svc != "" {
		active = exec.Command("systemctl", "is-active", "--quiet", svc).Run() == nil
	}
	return CompState{Installed: true, Active: active, Version: ver}
}

// handleSetupStatus — GET /api/setup/status
func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	components := map[string]CompState{
		"docker":   checkComp("docker", "version", "--format", "{{.Client.Version}}"),
		"clamav":   checkComp("clamscan", "--version"),
		"wireguard": func() CompState {
			wg := checkComp("wg")
			wg.Active = isWGIfaceUp("wg0") || isAnyWGUp()
			return wg
		}(),
		"fail2ban": checkComp("fail2ban-client", "--version"),
		"ufw":      checkComp("ufw", "version"),
		"zfs":      checkComp("zpool", "version"),
		"rsync":    checkComp("rsync", "--version"),
		"smartmon": checkComp("smartctl", "--version"),
		"sensors":  checkComp("sensors"),
		"htop":     checkComp("htop", "--version"),
		"ncdu":     checkComp("ncdu", "--version"),
		"python3":  checkComp("python3", "--version"),
		"aria2":    checkComp("aria2c", "--version"),
		"iotop":    checkComp("iotop", "--version"),
	}
	jsonOK(w, SetupStatus{
		Done:       setupDone(),
		Components: components,
	})
}

// handleSetupComplete — POST /api/setup/complete
func (s *Server) handleSetupComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	markSetupDone()
	jsonOK(w, map[string]string{"status": "ok"})
}

// handleSetupInstall — POST /api/setup/install  body: {"packages": ["docker.io","clamav",...]}
func (s *Server) handleSetupInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Packages []string `json:"packages"`
		// Opcjonalne: "component" → instalacja z dodatkową konfiguracją
		Component string `json:"component"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Packages) == 0 {
		jsonErr(w, "packages required", http.StatusBadRequest)
		return
	}

	// Sanitize — tylko dozwolone znaki w nazwach pakietów
	for _, p := range req.Packages {
		for _, c := range p {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
				c == '-' || c == '.' || c == '_' || c == ':' || c == '+') {
				jsonErr(w, "invalid package name: "+p, http.StatusBadRequest)
				return
			}
		}
	}

	// apt-get update + install
	runCmd("apt-get", "update", "-qq")
	args := append([]string{"install", "-y", "--no-install-recommends"}, req.Packages...)
	out, err := runCmd("apt-get", args...)
	if err != nil {
		jsonErr(w, "install failed: "+strings.TrimSpace(out), http.StatusInternalServerError)
		return
	}

	// Post-install hooks dla konkretnych komponentów
	switch req.Component {
	case "docker":
		runCmd("systemctl", "enable", "docker")
		runCmd("systemctl", "start", "docker")
		// Dodaj użytkownika do grupy docker jeśli istnieje nie-root
		if user := os.Getenv("SUDO_USER"); user != "" && user != "root" {
			runCmd("usermod", "-aG", "docker", user)
		}
	case "clamav":
		runCmd("systemctl", "enable", "clamav-daemon")
		runCmd("systemctl", "start", "clamav-daemon")
		runCmd("freshclam") // Aktualizuj bazy wirusów (w tle)
	case "fail2ban":
		runCmd("systemctl", "enable", "fail2ban")
		runCmd("systemctl", "start", "fail2ban")
	case "wireguard":
		// WireGuard konfiguracja odbywa się przez /api/vpn
	case "ufw":
		runCmd("ufw", "allow", "22/tcp")   // SSH
		runCmd("ufw", "allow", "8585/tcp") // Nimbus
		runCmd("ufw", "--force", "enable")
		runCmd("systemctl", "enable", "ufw")
	case "sensors":
		runCmd("sensors-detect", "--auto")
	}

	jsonOK(w, map[string]any{
		"status":   "ok",
		"packages": req.Packages,
		"output":   out,
	})
}

// handleSetupReset — POST /api/setup/reset (debug — usuwa flagę)
func (s *Server) handleSetupReset(w http.ResponseWriter, r *http.Request) {
	os.Remove(setupDoneFile)
	jsonOK(w, map[string]string{"status": "ok"})
}
