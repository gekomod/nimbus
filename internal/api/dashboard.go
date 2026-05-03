package api

import (
	"encoding/json"
	"net/http"
	"sync"
)

// handleDashboard zbiera dane z 14 endpointów równolegle i zwraca w jednym JSON.
// Zastępuje 14 osobnych żądań z data.jsx co 5s → jedno żądanie.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	type result struct {
		key  string
		data any
		err  error
	}

	// Lista endpointów do odpytania równolegle
	endpoints := []struct {
		key     string
		handler func() (any, error)
	}{
		{"overview",    func() (any, error) { return s.fetchJSONWithReq("/api/overview", r) }},
		{"pools",       func() (any, error) { return s.fetchJSONWithReq("/api/zfs/pools", r) }},
		{"containers",  func() (any, error) { return s.fetchJSONWithReq("/services/docker/containers", r) }},
		{"mounts",      func() (any, error) { return s.fetchJSONWithReq("/api/storage/mounts", r) }},
		{"network",     func() (any, error) { return s.fetchJSONWithReq("/api/network", r) }},
		{"processes",   func() (any, error) { return s.fetchJSONWithReq("/api/processes", r) }},
		{"logs",        func() (any, error) { return s.fetchJSONWithReq("/api/logs?n=50", r) }},
		{"smb",         func() (any, error) { return s.fetchJSONWithReq("/services/samba/status", r) }},
		{"ssh",         func() (any, error) { return s.fetchJSONWithReq("/services/ssh/status", r) }},
		{"nfs",         func() (any, error) { return s.fetchJSONWithReq("/api/nfs-server/status", r) }},
		{"ftp",         func() (any, error) { return s.fetchJSONWithReq("/api/services/ftp-sftp/status", r) }},
		{"users",       func() (any, error) { return s.fetchJSONWithReq("/api/system/users", r) }},
		{"fstab",       func() (any, error) { return s.fetchJSONWithReq("/api/storage/fstab-content", r) }},
		{"media",       func() (any, error) { return s.fetchJSONWithReq("/api/media/status/all", r) }},
	}

	results := make(map[string]any, len(endpoints))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, ep := range endpoints {
		wg.Add(1)
		go func(key string, fn func() (any, error)) {
			defer wg.Done()
			data, err := fn()
			if err == nil && data != nil {
				mu.Lock()
				results[key] = data
				mu.Unlock()
			}
		}(ep.key, ep.handler)
	}

	wg.Wait()
	jsonOK(w, results)
}

// fetchJSONWithReq wywołuje handler wewnętrznie z sesją z oryginalnego requestu.
func (s *Server) fetchJSONWithReq(path string, original *http.Request) (any, error) {
	rec := &fakeResponseWriter{header: make(http.Header)}
	req, err := http.NewRequest("GET", path, nil)
	if err != nil { return nil, err }

	// Przekaż cookie sesji żeby auth middleware przepuścił
	if original != nil {
		for _, c := range original.Cookies() {
			req.AddCookie(c)
		}
	}

	s.mux.ServeHTTP(rec, req)

	if rec.status != 0 && rec.status != 200 {
		return nil, nil
	}
	if len(rec.body) == 0 { return nil, nil }

	var result any
	if err := json.Unmarshal(rec.body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// Backward compat
func (s *Server) fetchJSON(path string) (any, error) {
	return s.fetchJSONWithReq(path, nil)
}

// fakeResponseWriter przechwytuje odpowiedź handlera bez sieci
type fakeResponseWriter struct {
	header http.Header
	body   []byte
	status int
}

func (f *fakeResponseWriter) Header() http.Header        { return f.header }
func (f *fakeResponseWriter) WriteHeader(code int)       { f.status = code }
func (f *fakeResponseWriter) Write(b []byte) (int, error) {
	if f.status == 0 { f.status = 200 } // domyślnie 200 jeśli WriteHeader nie wywołany
	f.body = append(f.body, b...)
	return len(b), nil
}
