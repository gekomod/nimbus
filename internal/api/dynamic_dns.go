package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const ddnsConfigPath = "/etc/nas-panel/dynamic-dns.json"

// ─── Typy ─────────────────────────────────────────────────────────────────────

type DDNSEntry struct {
	ID         string `json:"id"`
	Provider   string `json:"provider"`   // noip | duckdns | cloudflare | freedns | dynu | afraid
	Enabled    bool   `json:"enabled"`
	Hostname   string `json:"hostname"`
	Username   string `json:"username,omitempty"`
	Password   string `json:"password,omitempty"`
	Token      string `json:"token,omitempty"`
	UpdateURL  string `json:"updateUrl,omitempty"` // freedns custom URL
	ZoneID     string `json:"zone_id,omitempty"`
	RecordID   string `json:"record_id,omitempty"`
	APIKey     string `json:"api_key,omitempty"`
	Email      string `json:"email,omitempty"`
	LastUpdate string `json:"lastUpdate,omitempty"`
	LastIP     string `json:"lastIp,omitempty"`
	Status     string `json:"status"` // active | error | pending
	StatusMsg  string `json:"statusMsg,omitempty"`
}

type DDNSConfig struct {
	Services []DDNSEntry `json:"services"`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func loadDDNSConfig() DDNSConfig {
	cfg := DDNSConfig{Services: []DDNSEntry{}}
	b, err := os.ReadFile(ddnsConfigPath)
	if err != nil {
		return cfg
	}
	json.Unmarshal(b, &cfg)
	if cfg.Services == nil {
		cfg.Services = []DDNSEntry{}
	}
	return cfg
}

func saveDDNSConfig(cfg DDNSConfig) error {
	os.MkdirAll("/etc/nas-panel", 0755)
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ddnsConfigPath, b, 0644)
}

// getPublicIP pobiera publiczny IP z kilku źródeł
func getPublicIP() (string, error) {
	sources := []string{
		"https://api4.ipify.org",
		"https://checkip.amazonaws.com",
		"https://icanhazip.com",
	}
	client := &http.Client{Timeout: 8 * time.Second}
	for _, url := range sources {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 64))
		resp.Body.Close()
		if err != nil {
			continue
		}
		ip := strings.TrimSpace(string(body))
		if ip != "" {
			return ip, nil
		}
	}
	return "", fmt.Errorf("nie można pobrać publicznego IP")
}

// updateDDNSEntry aktualizuje jeden wpis — obsługuje każdego providera
func updateDDNSEntry(entry DDNSEntry, ip string) (string, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	switch entry.Provider {

	case "noip":
		// No-IP: HTTP Basic Auth
		url := fmt.Sprintf("https://dynupdate.no-ip.com/nic/update?hostname=%s&myip=%s",
			entry.Hostname, ip)
		req, _ := http.NewRequest("GET", url, nil)
		req.SetBasicAuth(entry.Username, entry.Password)
		req.Header.Set("User-Agent", "NimbusNAS/1.0 "+entry.Email)
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		if strings.HasPrefix(result, "good") || strings.HasPrefix(result, "nochg") {
			return result, nil
		}
		return "", fmt.Errorf("No-IP error: %s", result)

	case "duckdns":
		// DuckDNS: token + hostname (bez .duckdns.org)
		host := strings.TrimSuffix(entry.Hostname, ".duckdns.org")
		url := fmt.Sprintf("https://www.duckdns.org/update?domains=%s&token=%s&ip=%s",
			host, entry.Token, ip)
		resp, err := client.Get(url)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		if result == "OK" {
			return "OK", nil
		}
		return "", fmt.Errorf("DuckDNS error: %s", result)

	case "dynu":
		// Dynu: HTTP Basic Auth, podobnie jak No-IP
		url := fmt.Sprintf("https://api.dynu.com/nic/update?hostname=%s&myip=%s",
			entry.Hostname, ip)
		req, _ := http.NewRequest("GET", url, nil)
		req.SetBasicAuth(entry.Username, entry.Password)
		req.Header.Set("User-Agent", "NimbusNAS/1.0")
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		if strings.HasPrefix(result, "good") || strings.HasPrefix(result, "nochg") {
			return result, nil
		}
		return "", fmt.Errorf("Dynu error: %s", result)

	case "freedns", "afraid":
		// FreeDNS afraid.org: custom update URL z tokenem
		updateURL := entry.UpdateURL
		if updateURL == "" {
			return "", fmt.Errorf("FreeDNS wymaga pola updateUrl z tokenem")
		}
		// Dodaj IP jeśli nie ma w URL
		if !strings.Contains(updateURL, "address=") {
			if strings.Contains(updateURL, "?") {
				updateURL += "&address=" + ip
			} else {
				updateURL += "?address=" + ip
			}
		}
		resp, err := client.Get(updateURL)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		// FreeDNS zwraca "Updated X host(s)" lub "ERROR"
		if strings.Contains(strings.ToLower(result), "updated") ||
			strings.Contains(strings.ToLower(result), "has not changed") {
			return result, nil
		}
		return "", fmt.Errorf("FreeDNS: %s", result)

	case "cloudflare":
		// Cloudflare: API Token + Zone ID + Record ID
		if entry.APIKey == "" || entry.ZoneID == "" || entry.RecordID == "" {
			return "", fmt.Errorf("Cloudflare wymaga api_key, zone_id i record_id")
		}
		payload := fmt.Sprintf(`{"type":"A","name":"%s","content":"%s","ttl":120,"proxied":false}`,
			entry.Hostname, ip)
		url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s",
			entry.ZoneID, entry.RecordID)
		req, _ := http.NewRequest("PUT", url, strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+entry.APIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		var cf struct {
			Success bool `json:"success"`
			Errors  []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		json.NewDecoder(resp.Body).Decode(&cf)
		if cf.Success {
			return "Cloudflare updated", nil
		}
		if len(cf.Errors) > 0 {
			return "", fmt.Errorf("Cloudflare: %s", cf.Errors[0].Message)
		}
		return "", fmt.Errorf("Cloudflare: unknown error")

	case "he", "hurricane":
		// Hurricane Electric (he.net): Basic auth
		url := fmt.Sprintf("https://dyn.dns.he.net/nic/update?hostname=%s&myip=%s",
			entry.Hostname, ip)
		req, _ := http.NewRequest("GET", url, nil)
		req.SetBasicAuth(entry.Hostname, entry.Password)
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		if strings.HasPrefix(result, "good") || strings.HasPrefix(result, "nochg") {
			return result, nil
		}
		return "", fmt.Errorf("HE.net error: %s", result)

	case "ovh":
		// OVH DynHost: Basic Auth
		url := fmt.Sprintf("https://www.ovh.com/nic/update?system=dyndns&hostname=%s&myip=%s",
			entry.Hostname, ip)
		req, _ := http.NewRequest("GET", url, nil)
		req.SetBasicAuth(entry.Username, entry.Password)
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		result := strings.TrimSpace(string(body))
		if strings.HasPrefix(result, "good") || strings.HasPrefix(result, "nochg") {
			return result, nil
		}
		return "", fmt.Errorf("OVH error: %s", result)

	default:
		return "", fmt.Errorf("nieznany provider: %s", entry.Provider)
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GET /network/dynamic-dns        — lista wpisów
// POST /network/dynamic-dns       — dodaj wpis
func (s *Server) handleDynDNS(w http.ResponseWriter, r *http.Request) {
	cfg := loadDDNSConfig()
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"entries": cfg.Services})

	case http.MethodPost:
		var entry DDNSEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			jsonErr(w, "bad request: "+err.Error(), http.StatusBadRequest)
			return
		}
		if entry.ID == "" {
			entry.ID = fmt.Sprintf("%d", time.Now().UnixNano())
		}
		if entry.Status == "" {
			entry.Status = "pending"
		}
		cfg.Services = append(cfg.Services, entry)
		if err := saveDDNSConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, entry)

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// GET    /network/dynamic-dns/:id         — pobierz wpis
// PUT    /network/dynamic-dns/:id         — zaktualizuj konfigurację wpisu
// DELETE /network/dynamic-dns/:id         — usuń wpis
// POST   /network/dynamic-dns/:id/update  — wymuś aktualizację IP
func (s *Server) handleDynDNSItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/network/dynamic-dns/")
	parts := strings.Split(strings.Trim(suffix, "/"), "/")
	id := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	cfg := loadDDNSConfig()

	// Znajdź wpis
	idx := -1
	for i, e := range cfg.Services {
		if e.ID == id {
			idx = i
			break
		}
	}

	// Akcja /update — wymuś aktualizację IP
	if action == "update" {
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if idx < 0 {
			jsonErr(w, "not found", http.StatusNotFound)
			return
		}
		entry := cfg.Services[idx]
		ip, err := getPublicIP()
		if err != nil {
			cfg.Services[idx].Status = "error"
			cfg.Services[idx].StatusMsg = "Nie można pobrać publicznego IP: " + err.Error()
			cfg.Services[idx].LastUpdate = time.Now().Format(time.RFC3339)
			saveDDNSConfig(cfg)
			jsonErr(w, cfg.Services[idx].StatusMsg, http.StatusInternalServerError)
			return
		}
		result, err := updateDDNSEntry(entry, ip)
		now := time.Now().Format(time.RFC3339)
		if err != nil {
			cfg.Services[idx].Status = "error"
			cfg.Services[idx].StatusMsg = err.Error()
		} else {
			cfg.Services[idx].Status = "active"
			cfg.Services[idx].StatusMsg = result
			cfg.Services[idx].LastIP = ip
		}
		cfg.Services[idx].LastUpdate = now
		saveDDNSConfig(cfg)
		jsonOK(w, map[string]any{
			"ok":         err == nil,
			"ip":         ip,
			"result":     result,
			"status":     cfg.Services[idx].Status,
			"statusMsg":  cfg.Services[idx].StatusMsg,
			"lastUpdate": now,
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		if idx < 0 {
			jsonErr(w, "not found", http.StatusNotFound)
			return
		}
		jsonOK(w, cfg.Services[idx])

	case http.MethodPut:
		var upd DDNSEntry
		if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest)
			return
		}
		upd.ID = id
		if idx < 0 {
			cfg.Services = append(cfg.Services, upd)
		} else {
			cfg.Services[idx] = upd
		}
		saveDDNSConfig(cfg)
		jsonOK(w, upd)

	case http.MethodDelete:
		if idx >= 0 {
			cfg.Services = append(cfg.Services[:idx], cfg.Services[idx+1:]...)
			saveDDNSConfig(cfg)
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// POST /network/dynamic-dns/update-all — aktualizuj wszystkie aktywne wpisy
func (s *Server) handleDynDNSUpdateAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cfg := loadDDNSConfig()
	ip, err := getPublicIP()
	if err != nil {
		jsonErr(w, "nie można pobrać IP: "+err.Error(), http.StatusInternalServerError)
		return
	}
	now := time.Now().Format(time.RFC3339)
	type Result struct {
		ID       string `json:"id"`
		Hostname string `json:"hostname"`
		Status   string `json:"status"`
		Msg      string `json:"msg"`
	}
	var results []Result
	for i, entry := range cfg.Services {
		if !entry.Enabled {
			continue
		}
		result, err2 := updateDDNSEntry(entry, ip)
		if err2 != nil {
			cfg.Services[i].Status = "error"
			cfg.Services[i].StatusMsg = err2.Error()
			results = append(results, Result{entry.ID, entry.Hostname, "error", err2.Error()})
		} else {
			cfg.Services[i].Status = "active"
			cfg.Services[i].StatusMsg = result
			cfg.Services[i].LastIP = ip
			results = append(results, Result{entry.ID, entry.Hostname, "active", result})
		}
		cfg.Services[i].LastUpdate = now
	}
	saveDDNSConfig(cfg)
	jsonOK(w, map[string]any{"ip": ip, "updated": len(results), "results": results})
}

// GET/POST /network/dynamic-dns/settings
func (s *Server) handleDynDNSSettings(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"config_path": ddnsConfigPath})
}

// POST /network/dynamic-dns/install-cron — dodaj cron co 5 minut
func (s *Server) handleDynDNSInstallCron(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Interval int `json:"interval"` // minuty: 5, 15, 30, 60
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Interval <= 0 {
		req.Interval = 5
	}

	// Sprawdź ścieżkę binarki
	selfPath, _ := os.Executable()
	if selfPath == "" {
		selfPath = "/usr/local/bin/nimbus"
	}

	cronLine := fmt.Sprintf("*/%d * * * * root curl -sf -X POST http://localhost:8585/network/dynamic-dns/update-all -H 'Cookie: session=$(cat /etc/nas-panel/.session 2>/dev/null)' > /dev/null 2>&1", req.Interval)
	marker := "# NimbusNAS DynDNS"
	cronFile := "/etc/cron.d/nimbus-ddns"

	content := marker + "\n" + cronLine + "\n"
	if err := os.WriteFile(cronFile, []byte(content), 0644); err != nil {
		jsonErr(w, "nie można zapisać crona: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// Upewnij się że cron.d jest obsługiwane
	runCmd("systemctl", "reload", "cron")

	jsonOK(w, map[string]any{
		"installed": true,
		"file":      cronFile,
		"interval":  req.Interval,
		"line":      cronLine,
	})
}

// GET /network/dynamic-dns/cron-status
func (s *Server) handleDynDNSCronStatus(w http.ResponseWriter, r *http.Request) {
	cronFile := "/etc/cron.d/nimbus-ddns"
	content := readFileStr(cronFile)
	installed := content != ""

	interval := 5
	if installed {
		for _, line := range strings.Split(content, "\n") {
			if strings.HasPrefix(line, "*/") {
				var n int
				fmt.Sscanf(line, "*/%d", &n)
				if n > 0 {
					interval = n
				}
			}
		}
	}

	jsonOK(w, map[string]any{
		"installed": installed,
		"interval":  interval,
		"file":      cronFile,
		"content":   content,
	})
}
