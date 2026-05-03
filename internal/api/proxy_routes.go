package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
)

// ProxyRoute opisuje jedną trasę reverse proxy.
type ProxyRoute struct {
	ID      string `json:"id"`
	Domain  string `json:"domain"`  // np. radarr.nasserver.pl
	Target  string `json:"target"`  // np. 192.168.1.23:7878
	SSL     bool   `json:"ssl"`
	HTTPS   bool   `json:"https"`
	WSProxy bool   `json:"ws_proxy"`
	Active  bool   `json:"active"`
	Comment string `json:"comment"`
}

const proxyRoutesFile = "/etc/nas-panel/proxy-routes.json"

var (
	proxyRoutes   []ProxyRoute
	proxyRoutesMu sync.RWMutex
	// cache proxies: domain → *httputil.ReverseProxy
	proxyCache   = map[string]*httputil.ReverseProxy{}
	proxyCacheMu sync.RWMutex
)

func init() {
	loadProxyRoutes()
}

func loadProxyRoutes() {
	data, err := os.ReadFile(proxyRoutesFile)
	if err != nil { return }
	proxyRoutesMu.Lock()
	defer proxyRoutesMu.Unlock()
	json.Unmarshal(data, &proxyRoutes)
	rebuildProxyCache()
}

func saveProxyRoutes() error {
	proxyRoutesMu.RLock()
	data, _ := json.MarshalIndent(proxyRoutes, "", "  ")
	proxyRoutesMu.RUnlock()
	os.MkdirAll("/etc/nas-panel", 0755)
	err := os.WriteFile(proxyRoutesFile, data, 0644)
	if err == nil {
		proxyRoutesMu.RLock()
		rebuildProxyCache()
		proxyRoutesMu.RUnlock()
	}
	return err
}

// rebuildProxyCache odbudowuje mapę domain→proxy po każdej zmianie tras.
// Musi być wołany z trzymanym proxyRoutesMu.
func rebuildProxyCache() {
	newCache := map[string]*httputil.ReverseProxy{}
	for _, r := range proxyRoutes {
		if !r.Active || r.Domain == "" || r.Target == "" { continue }
		target := r.Target
		if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
			target = "http://" + target
		}
		u, err := url.Parse(target)
		if err != nil { continue }
		rp := httputil.NewSingleHostReverseProxy(u)

		// Capture loop variable
		targetURL := u
		origDomain := r.Domain

		rp.Director = func(req *http.Request) {
			// Kieruj żądanie na backend
			req.URL.Scheme = targetURL.Scheme
			req.URL.Host   = targetURL.Host
			// Zachowaj oryginalną ścieżkę
			if targetURL.Path != "" && targetURL.Path != "/" {
				req.URL.Path = targetURL.Path + req.URL.Path
			}
			// WAŻNE: zachowaj oryginalny Host z żądania klienta
			// NIE ustawiaj req.Host = targetURL.Host — to powoduje
			// że aplikacje jak Sonarr/Radarr robią redirect na swój IP
			// req.Host pozostaje niezmieniony (np. sonarr.nasserver.pl)

			// Dodaj standardowe proxy headery
			req.Header.Set("X-Real-IP",       req.RemoteAddr)
			req.Header.Set("X-Forwarded-Host", origDomain)
			req.Header.Set("X-Forwarded-Proto", "http")
			if req.Header.Get("X-Forwarded-For") == "" {
				req.Header.Set("X-Forwarded-For", req.RemoteAddr)
			}
		}

		// Napraw Location headery w odpowiedzi — jeśli backend robi redirect
		// na swój wewnętrzny IP, zamieniamy go z powrotem na domenę
		rp.ModifyResponse = func(resp *http.Response) error {
			loc := resp.Header.Get("Location")
			if loc == "" { return nil }
			// Zamień http://192.168.x.x:port/... → http://domena/...
			if strings.Contains(loc, targetURL.Host) {
				fixed := strings.Replace(loc, targetURL.Scheme+"://"+targetURL.Host, "http://"+origDomain, 1)
				resp.Header.Set("Location", fixed)
			}
			return nil
		}

		newCache[r.Domain] = rp
	}
	proxyCacheMu.Lock()
	proxyCache = newCache
	proxyCacheMu.Unlock()
}

// ProxyHandler sprawdza Host header i kieruje żądanie do właściwego backendu.
// Podpinany w server.go jako middleware przed normalnym mux.
func (s *Server) ProxyHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		// Usuń port z hosta jeśli jest
		if idx := strings.LastIndex(host, ":"); idx >= 0 {
			host = host[:idx]
		}

		proxyCacheMu.RLock()
		rp, found := proxyCache[host]
		proxyCacheMu.RUnlock()

		if found {
			// Przekaż do backendu
			rp.ServeHTTP(w, r)
			return
		}
		// Normalny ruch nimbusa
		next.ServeHTTP(w, r)
	})
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleProxyRoutes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxyRoutesMu.RLock()
		list := make([]ProxyRoute, len(proxyRoutes))
		copy(list, proxyRoutes)
		proxyRoutesMu.RUnlock()
		jsonOK(w, map[string]any{"routes": list})

	case http.MethodPost:
		var route ProxyRoute
		if err := json.NewDecoder(r.Body).Decode(&route); err != nil || route.Domain == "" || route.Target == "" {
			jsonErr(w, "domain i target są wymagane", http.StatusBadRequest)
			return
		}
		if route.ID == "" {
			route.ID = fmt.Sprintf("%s_%s",
				strings.ReplaceAll(route.Domain, ".", "_"),
				strings.ReplaceAll(strings.ReplaceAll(route.Target, ":", "_"), ".", "_"),
			)
		}
		route.Active = true
		proxyRoutesMu.Lock()
		proxyRoutes = append(proxyRoutes, route)
		proxyRoutesMu.Unlock()
		saveProxyRoutes()
		jsonOK(w, map[string]any{"status": "ok", "id": route.ID})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleProxyRouteItem(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/proxy/routes/")

	proxyRoutesMu.Lock()
	idx := -1
	for i, rt := range proxyRoutes {
		if rt.ID == id { idx = i; break }
	}

	if idx < 0 {
		proxyRoutesMu.Unlock()
		jsonErr(w, "not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodPut:
		var updated ProxyRoute
		json.NewDecoder(r.Body).Decode(&updated)
		updated.ID = id
		proxyRoutes[idx] = updated
		proxyRoutesMu.Unlock()
		saveProxyRoutes()
		jsonOK(w, map[string]any{"status": "ok"})

	case http.MethodDelete:
		proxyRoutes = append(proxyRoutes[:idx], proxyRoutes[idx+1:]...)
		proxyRoutesMu.Unlock()
		saveProxyRoutes()
		jsonOK(w, map[string]any{"status": "ok"})

	default:
		proxyRoutesMu.Unlock()
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleProxyStatus(w http.ResponseWriter, r *http.Request) {
	proxyCacheMu.RLock()
	active := len(proxyCache)
	proxyCacheMu.RUnlock()
	proxyRoutesMu.RLock()
	total := len(proxyRoutes)
	proxyRoutesMu.RUnlock()
	jsonOK(w, map[string]any{
		"running":        true,
		"engine":         "nimbus built-in (httputil.ReverseProxy)",
		"active_routes":  active,
		"total_routes":   total,
	})
}

func (s *Server) handleProxyPreview(w http.ResponseWriter, r *http.Request) {
	proxyRoutesMu.RLock()
	routes := make([]ProxyRoute, len(proxyRoutes))
	copy(routes, proxyRoutes)
	proxyRoutesMu.RUnlock()

	var sb strings.Builder
	sb.WriteString("# Trasy reverse proxy — nimbus built-in\n\n")
	for _, rt := range routes {
		status := "ACTIVE"
		if !rt.Active { status = "DISABLED" }
		sb.WriteString(fmt.Sprintf("[%s] %s  →  %s\n", status, rt.Domain, rt.Target))
		if rt.Comment != "" { sb.WriteString(fmt.Sprintf("    # %s\n", rt.Comment)) }
		var opts []string
		if rt.SSL     { opts = append(opts, "SSL") }
		if rt.HTTPS   { opts = append(opts, "HTTPS-redirect") }
		if rt.WSProxy { opts = append(opts, "WebSocket") }
		if len(opts) > 0 { sb.WriteString(fmt.Sprintf("    opcje: %s\n", strings.Join(opts, ", "))) }
		sb.WriteString("\n")
	}
	jsonOK(w, map[string]any{"config": sb.String()})
}
