package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"io"
	"time"
)

const mediaConfigPath = "/etc/nas-panel/media.json"

type MediaLibrary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

type MediaServer struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Enabled       bool           `json:"enabled"`
	Port          int            `json:"port"`
	APIKey        string         `json:"api_key"`
	URL           string         `json:"url"`
	Version       string         `json:"version"`
	Libraries     []MediaLibrary `json:"libraries"`
	ActiveStreams int            `json:"active_streams"`
	Transcode     bool           `json:"transcode"`
}

type MediaConfig struct {
	Servers []MediaServer `json:"servers"`
	mu      sync.RWMutex
}

var mediaConfig = &MediaConfig{
	Servers: []MediaServer{
		{ID: "jellyfin", Name: "Jellyfin", Port: 8096, URL: "http://localhost:8096", Enabled: false, Version: "—", Libraries: []MediaLibrary{}, ActiveStreams: 0},
		{ID: "plex", Name: "Plex", Port: 32400, URL: "http://localhost:32400", Enabled: false, Version: "—", Libraries: []MediaLibrary{}, ActiveStreams: 0},
		{ID: "emby", Name: "Emby", Port: 8096, URL: "http://localhost:8096", Enabled: false, Version: "—", Libraries: []MediaLibrary{}, ActiveStreams: 0},
		{ID: "navidrome", Name: "Navidrome", Port: 4533, URL: "http://localhost:4533", Enabled: false, Version: "—", Libraries: []MediaLibrary{}, ActiveStreams: 0},
	},
}

var mediaSvcMap = map[string]string{
	"jellyfin":  "jellyfin",
	"plex":      "plexmediaserver",
	"emby":      "emby-server",
	"navidrome": "navidrome",
}

func init() {
	loadMediaConfig()
}

func loadMediaConfig() {
	data, err := os.ReadFile(mediaConfigPath)
	if err != nil {
		saveMediaConfig()
		return
	}
	mediaConfig.mu.Lock()
	defer mediaConfig.mu.Unlock()
	if err := json.Unmarshal(data, &mediaConfig.Servers); err != nil {
		saveMediaConfig()
	}
}

func saveMediaConfig() {
	mediaConfig.mu.RLock()
	defer mediaConfig.mu.RUnlock()
	data, err := json.MarshalIndent(mediaConfig.Servers, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(mediaConfigPath, data, 0644)
}

func updateServerInConfig(id string, updater func(*MediaServer)) {
	mediaConfig.mu.Lock()
	defer mediaConfig.mu.Unlock()
	for i := range mediaConfig.Servers {
		if mediaConfig.Servers[i].ID == id {
			updater(&mediaConfig.Servers[i])
			break
		}
	}
	saveMediaConfig()
}

// Sprawdza czy serwer odpowiada na HTTP
func checkMediaServerHTTP(url string, timeout time.Duration) bool {
	client := http.Client{Timeout: timeout}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200 || resp.StatusCode == 302 || resp.StatusCode == 401
}

// Pobiera wersję serwera przez API
func getMediaServerVersion(server *MediaServer) string {
	if server.URL == "" {
		return "—"
	}
	
	var url string
	switch server.ID {
	case "jellyfin":
		url = server.URL + "/System/Info"
		if server.APIKey != "" {
			url += "?api_key=" + server.APIKey
		}
	case "plex":
		url = server.URL + "/identity"
	case "emby":
		url = server.URL + "/emby/System/Info"
		if server.APIKey != "" {
			url += "?api_key=" + server.APIKey
		}
	default:
		return "—"
	}
	
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "—"
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "—"
	}
	
	switch server.ID {
	case "jellyfin":
		var info struct { Version string `json:"Version"` }
		if json.Unmarshal(body, &info) == nil && info.Version != "" {
			return info.Version
		}
	case "plex":
		version := resp.Header.Get("X-Plex-Version")
		if version != "" {
			return version
		}
	case "emby":
		var info struct { Version string `json:"Version"` }
		if json.Unmarshal(body, &info) == nil && info.Version != "" {
			return info.Version
		}
	}
	return "—"
}

// Pobiera aktywne strumienie
func getActiveStreams(server *MediaServer) int {
	if server.URL == "" || server.APIKey == "" {
		return 0
	}
	
	var url string
	switch server.ID {
	case "jellyfin":
		url = server.URL + "/Sessions?api_key=" + server.APIKey
	case "plex":
		url = server.URL + "/status/sessions?X-Plex-Token=" + server.APIKey
	case "emby":
		url = server.URL + "/emby/Sessions?api_key=" + server.APIKey
	default:
		return 0
	}
	
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0
	}
	
	switch server.ID {
	case "jellyfin", "emby":
		var sessions []interface{}
		if json.Unmarshal(body, &sessions) == nil {
			return len(sessions)
		}
	case "plex":
		var sessions struct {
			MediaContainer struct {
				Metadata []interface{} `json:"Metadata"`
			} `json:"MediaContainer"`
		}
		if json.Unmarshal(body, &sessions) == nil {
			return len(sessions.MediaContainer.Metadata)
		}
	}
	return 0
}

func (s *Server) handleMediaHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"ok": true})
}

func (s *Server) handleMediaConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mediaConfig.mu.RLock()
		defer mediaConfig.mu.RUnlock()
		jsonOK(w, map[string]any{"servers": mediaConfig.Servers})

	case http.MethodPost:
		var req struct {
			Servers []MediaServer `json:"servers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "invalid request", http.StatusBadRequest)
			return
		}
		mediaConfig.mu.Lock()
		mediaConfig.Servers = req.Servers
		mediaConfig.mu.Unlock()
		saveMediaConfig()
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMediaStatusAll(w http.ResponseWriter, r *http.Request) {
	mediaConfig.mu.RLock()
	defer mediaConfig.mu.RUnlock()

	result := map[string]any{}
	for i, svr := range mediaConfig.Servers {
		// Sprawdź czy serwer odpowiada na HTTP
		url := strings.TrimSuffix(svr.URL, "/")
		healthURL := url
		switch svr.ID {
		case "jellyfin":
			healthURL = url + "/health"
		case "plex":
			healthURL = url + "/identity"
		case "emby":
			healthURL = url + "/emby/System/Info"
		default:
			healthURL = url
		}
		
		isActive := checkMediaServerHTTP(healthURL, 2*time.Second)
		
		// Pobierz wersję
		version := svr.Version
		if isActive {
			version = getMediaServerVersion(&svr)
		}
		
		// Pobierz aktywne strumienie
		activeStreams := 0
		if isActive && svr.APIKey != "" {
			activeStreams = getActiveStreams(&svr)
		}
		
		// Aktualizuj konfigurację w pamięci
		mediaConfig.Servers[i].Enabled = isActive
		mediaConfig.Servers[i].Version = version
		mediaConfig.Servers[i].ActiveStreams = activeStreams
		
		result[svr.ID] = map[string]any{
			"active":         isActive,
			"installed":      true,
			"version":        version,
			"active_streams": activeStreams,
			"port":           svr.Port,
			"url":            svr.URL,
			"name":           svr.Name,
		}
	}
	
	// Zapisz zaktualizowane dane
	go saveMediaConfig()
	
	jsonOK(w, result)
}

func (s *Server) handleMediaStatusSingle(w http.ResponseWriter, r *http.Request) {
	svcID := strings.TrimPrefix(r.URL.Path, "/api/media/status/")
	
	mediaConfig.mu.RLock()
	defer mediaConfig.mu.RUnlock()
	
	var server *MediaServer
	for i := range mediaConfig.Servers {
		if mediaConfig.Servers[i].ID == svcID {
			server = &mediaConfig.Servers[i]
			break
		}
	}
	
	if server == nil {
		jsonErr(w, "service not found", http.StatusNotFound)
		return
	}
	
	// Sprawdź status
	url := strings.TrimSuffix(server.URL, "/")
	healthURL := url
	switch server.ID {
	case "jellyfin":
		healthURL = url + "/health"
	case "plex":
		healthURL = url + "/identity"
	case "emby":
		healthURL = url + "/emby/System/Info"
	default:
		healthURL = url
	}
	
	isActive := checkMediaServerHTTP(healthURL, 2*time.Second)
	version := getMediaServerVersion(server)
	activeStreams := 0
	if isActive && server.APIKey != "" {
		activeStreams = getActiveStreams(server)
	}
	
	jsonOK(w, map[string]any{
		"active":         isActive,
		"installed":      true,
		"version":        version,
		"port":           server.Port,
		"url":            server.URL,
		"active_streams": activeStreams,
		"libraries":      server.Libraries,
	})
}

func (s *Server) handleMediaItem(w http.ResponseWriter, r *http.Request) {
	// /api/media/:serviceId/:action
	path := strings.TrimPrefix(r.URL.Path, "/api/media/")
	parts := strings.SplitN(path, "/", 2)
	svcID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	mediaConfig.mu.RLock()
	var server *MediaServer
	for i := range mediaConfig.Servers {
		if mediaConfig.Servers[i].ID == svcID {
			server = &mediaConfig.Servers[i]
			break
		}
	}
	mediaConfig.mu.RUnlock()

	if server == nil {
		jsonErr(w, "unknown service: "+svcID, http.StatusBadRequest)
		return
	}

	switch action {
	case "status":
		url := strings.TrimSuffix(server.URL, "/")
		healthURL := url
		switch server.ID {
		case "jellyfin":
			healthURL = url + "/health"
		case "plex":
			healthURL = url + "/identity"
		case "emby":
			healthURL = url + "/emby/System/Info"
		default:
			healthURL = url
		}
		isActive := checkMediaServerHTTP(healthURL, 2*time.Second)
		jsonOK(w, map[string]any{
			"active":    isActive,
			"installed": true,
			"version":   server.Version,
		})

	case "start":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Uruchom przez systemctl lub docker
		if svc, ok := mediaSvcMap[svcID]; ok {
			runCmd("systemctl", "start", svc)
		}
		updateServerInConfig(svcID, func(s *MediaServer) { s.Enabled = true })
		jsonOK(w, map[string]string{"status": "ok"})

	case "stop":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if svc, ok := mediaSvcMap[svcID]; ok {
			runCmd("systemctl", "stop", svc)
		}
		updateServerInConfig(svcID, func(s *MediaServer) { s.Enabled = false })
		jsonOK(w, map[string]string{"status": "ok"})

	case "restart":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if svc, ok := mediaSvcMap[svcID]; ok {
			runCmd("systemctl", "restart", svc)
		}
		jsonOK(w, map[string]string{"status": "ok"})

	case "config":
		switch r.Method {
		case http.MethodGet:
			jsonOK(w, server)
		case http.MethodPost:
			var updated MediaServer
			if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
				jsonErr(w, "invalid request", http.StatusBadRequest)
				return
			}
			updateServerInConfig(svcID, func(s *MediaServer) {
				s.Name = updated.Name
				s.Port = updated.Port
				s.APIKey = updated.APIKey
				s.URL = updated.URL
				s.Libraries = updated.Libraries
			})
			jsonOK(w, map[string]string{"status": "ok"})
		default:
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	default:
		jsonOK(w, map[string]any{"service": svcID, "action": action})
	}
}

func (s *Server) handleMediaSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Synchronizacja konfiguracji mediów
	saveMediaConfig()
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMediaLibraries(w http.ResponseWriter, r *http.Request) {
	svcID := strings.TrimPrefix(r.URL.Path, "/api/media/libraries/")
	
	mediaConfig.mu.RLock()
	defer mediaConfig.mu.RUnlock()
	
	var server *MediaServer
	for i := range mediaConfig.Servers {
		if mediaConfig.Servers[i].ID == svcID {
			server = &mediaConfig.Servers[i]
			break
		}
	}
	
	if server == nil {
		jsonErr(w, "service not found", http.StatusNotFound)
		return
	}
	
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"libraries": server.Libraries})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
