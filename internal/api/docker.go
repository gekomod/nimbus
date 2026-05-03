package api

import (
	"encoding/json"
	"os"
	"net/http"
	"nimbus/internal/sys"
	"strings"
	"sync"
	"time"
)

func (s *Server) handleDockerHealth(w http.ResponseWriter, r *http.Request) {
	_, err := runCmd("docker", "info")
	jsonOK(w, map[string]any{"ok": err == nil})
}

func (s *Server) handleDockerStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"active": serviceActive("docker"), "installed": isInstalled("docker")})
}

func (s *Server) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("systemctl", "start", "docker")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("systemctl", "stop", "docker")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("systemctl", "restart", "docker")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	go runCmd("bash", "-c", "curl -fsSL https://get.docker.com | sh")
	jsonOK(w, map[string]string{"status": "ok", "message": "Installing Docker..."})
}

func (s *Server) handleDockerCleanup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, _ := runCmd("docker", "system", "prune", "-f")
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]string{"config": readFileStr("/etc/docker/daemon.json")})
	case http.MethodPost:
		var req struct{ Config string `json:"config"` }
		json.NewDecoder(r.Body).Decode(&req)
		writeFile("/etc/docker/daemon.json", req.Config)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDockerContainers(w http.ResponseWriter, r *http.Request) {
	conts, err := sys.DockerContainers()
	if err != nil { jsonOK(w, map[string]any{"containers": []any{}, "error": err.Error()}); return }
	jsonOK(w, map[string]any{"containers": conts})
}

func (s *Server) handleDockerContainerCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct {
		Image, Name, Network, Restart string
		Ports, Volumes, Env           []string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Image == "" {
		jsonErr(w, "image required", http.StatusBadRequest); return
	}
	args := []string{"run", "-d"}
	if req.Name != "" { args = append(args, "--name", req.Name) }
	if req.Restart != "" { args = append(args, "--restart", req.Restart) }
	if req.Network != "" { args = append(args, "--network", req.Network) }
	for _, p := range req.Ports   { args = append(args, "-p", p) }
	for _, v := range req.Volumes { args = append(args, "-v", v) }
	for _, e := range req.Env    { args = append(args, "-e", e) }
	args = append(args, req.Image)
	out, err := runCmd("docker", args...)
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok", "id": strings.TrimSpace(out)})
}

func (s *Server) handleDockerContainerLogs(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/services/docker/container/logs/")
	tail := r.URL.Query().Get("tail"); if tail == "" { tail = "100" }
	out, _ := runCmd("docker", "logs", "--tail", tail, "--timestamps", id)
	jsonOK(w, map[string]any{"logs": strings.Split(out, "\n"), "id": id})
}

func (s *Server) handleDockerContainerStatus(w http.ResponseWriter, r *http.Request) {
	name := pathSuffix(r, "/services/docker/container/status/")
	out, _ := runCmd("docker", "inspect", "--format", "{{.State.Status}}", name)
	jsonOK(w, map[string]string{"name": name, "status": strings.TrimSpace(out)})
}

func (s *Server) handleDockerContainerAction(w http.ResponseWriter, r *http.Request) {
	// /services/docker/container/:id/:action  or  /services/docker/container/:id
	suffix := pathSuffix(r, "/services/docker/container/")
	parts  := strings.SplitN(suffix, "/", 2)
	id     := parts[0]
	action := ""
	if len(parts) > 1 { action = parts[1] }

	if id == "" { jsonErr(w, "container id required", http.StatusBadRequest); return }

	switch action {
	case "start":           runCmd("docker", "start", id)
	case "stop":            runCmd("docker", "stop", id)
	case "kill":            runCmd("docker", "kill", id)
	case "pause":           runCmd("docker", "pause", id)
	case "unpause":         runCmd("docker", "unpause", id)
	case "restart":         runCmd("docker", "restart", id)
	case "connect-network":
		var req struct{ Network string `json:"network"` }
		json.NewDecoder(r.Body).Decode(&req)
		runCmd("docker", "network", "connect", req.Network, id)
	case "mount-volume":
		jsonOK(w, map[string]string{"status": "ok"}); return
	case "config":
		switch r.Method {
		case http.MethodGet:
			out, _ := runCmd("docker", "inspect", id)
			jsonOK(w, json.RawMessage(safeJSON(out))); return
		case http.MethodPut:
			jsonOK(w, map[string]string{"status": "ok"}); return
		}
	default:
		switch r.Method {
		case http.MethodGet:
			out, _ := runCmd("docker", "inspect", id)
			jsonOK(w, json.RawMessage(safeJSON(out))); return
		case http.MethodDelete:
			args := []string{"rm"}
			if r.URL.Query().Get("force") == "true" { args = append(args, "-f") }
			args = append(args, id)
			runCmd("docker", args...)
		}
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerImages(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("docker", "images", "--format", `{"id":"{{.ID}}","repo":"{{.Repository}}","tag":"{{.Tag}}","size":"{{.Size}}","created":"{{.CreatedSince}}"}`)
	var imgs []json.RawMessage
	for _, l := range strings.Split(out, "\n") { if l = strings.TrimSpace(l); l != "" { imgs = append(imgs, json.RawMessage(l)) } }
	jsonOK(w, map[string]any{"images": imgs})
}

func (s *Server) handleDockerImagePull(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Image string `json:"image"` }
	json.NewDecoder(r.Body).Decode(&req)
	if req.Image == "" { jsonErr(w, "image required", http.StatusBadRequest); return }
	go runCmd("docker", "pull", req.Image)
	jsonOK(w, map[string]string{"status": "ok", "message": "Pulling " + req.Image})
}

func (s *Server) handleDockerImageRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Image string; Force bool }
	json.NewDecoder(r.Body).Decode(&req)
	args := []string{"rmi"}
	if req.Force { args = append(args, "-f") }
	args = append(args, req.Image)
	if _, err := runCmd("docker", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerImageSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q"); if q == "" { jsonErr(w, "q required", http.StatusBadRequest); return }
	out, _ := runCmd("docker", "search", "--format", `{"name":"{{.Name}}","description":"{{.Description}}","stars":"{{.StarCount}}","official":"{{.IsOfficial}}"}`, q)
	var res []json.RawMessage
	for _, l := range strings.Split(out, "\n") { if l = strings.TrimSpace(l); l != "" { res = append(res, json.RawMessage(l)) } }
	jsonOK(w, map[string]any{"results": res})
}

func (s *Server) handleDockerImageInspect(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/services/docker/images/inspect/")
	out, _ := runCmd("docker", "image", "inspect", id)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleDockerImageHistory(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/services/docker/images/history/")
	out, _ := runCmd("docker", "history", "--no-trunc", id)
	jsonOK(w, map[string]string{"raw": out})
}

func (s *Server) handleDockerImageCleanup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, _ := runCmd("docker", "image", "prune", "-f")
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerNetworks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("docker", "network", "ls", "--format", `{"id":"{{.ID}}","name":"{{.Name}}","driver":"{{.Driver}}","scope":"{{.Scope}}"}`)
		var nets []json.RawMessage
		for _, l := range strings.Split(out, "\n") { if l = strings.TrimSpace(l); l != "" { nets = append(nets, json.RawMessage(l)) } }
		jsonOK(w, map[string]any{"networks": nets})
	case http.MethodPost:
		var req struct { Name, Driver, Subnet string }
		json.NewDecoder(r.Body).Decode(&req)
		args := []string{"network", "create"}
		if req.Driver != "" { args = append(args, "--driver", req.Driver) }
		if req.Subnet != "" { args = append(args, "--subnet", req.Subnet) }
		args = append(args, req.Name)
		if _, err := runCmd("docker", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDockerNetworkPrune(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, _ := runCmd("docker", "network", "prune", "-f")
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerNetworkItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/services/docker/networks/")
	parts  := strings.SplitN(suffix, "/", 2)
	id     := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }
	switch {
	case action == "inspect":
		out, _ := runCmd("docker", "network", "inspect", id)
		jsonOK(w, json.RawMessage(safeJSON(out)))
	case action == "disconnect-all":
		runCmd("bash", "-c", "docker network inspect "+id+" -f '{{range .Containers}}{{.Name}} {{end}}' | xargs -r -n1 docker network disconnect "+id)
		jsonOK(w, map[string]string{"status": "ok"})
	case r.Method == http.MethodDelete:
		runCmd("docker", "network", "rm", id)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonOK(w, map[string]string{"status": "ok"})
	}
}

func (s *Server) handleDockerVolumes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("docker", "volume", "ls", "--format", `{"name":"{{.Name}}","driver":"{{.Driver}}","mountpoint":"{{.Mountpoint}}"}`)
		var vols []json.RawMessage
		for _, l := range strings.Split(out, "\n") { if l = strings.TrimSpace(l); l != "" { vols = append(vols, json.RawMessage(l)) } }
		jsonOK(w, map[string]any{"volumes": vols})
	case http.MethodPost:
		var req struct { Name, Driver string }
		json.NewDecoder(r.Body).Decode(&req)
		args := []string{"volume", "create"}
		if req.Driver != "" { args = append(args, "--driver", req.Driver) }
		if req.Name != "" { args = append(args, req.Name) }
		if _, err := runCmd("docker", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDockerVolumeStats(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"volumes": []any{}})
}

func (s *Server) handleDockerVolumePrune(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, _ := runCmd("docker", "volume", "prune", "-f")
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerVolumeItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/services/docker/volumes/")
	parts  := strings.SplitN(suffix, "/", 2)
	name   := parts[0]; action := ""; if len(parts) > 1 { action = parts[1] }
	switch {
	case action == "inspect":
		out, _ := runCmd("docker", "volume", "inspect", name)
		jsonOK(w, json.RawMessage(safeJSON(out)))
	case action == "browse":
		mp, _ := runCmd("docker", "volume", "inspect", "--format", "{{.Mountpoint}}", name)
		out, _ := runCmd("ls", "-la", strings.TrimSpace(mp))
		jsonOK(w, map[string]any{"mountpoint": mp, "files": out})
	case action == "mounts":
		jsonOK(w, map[string]any{"mounts": []any{}})
	case action == "copy":
		jsonOK(w, map[string]string{"status": "ok"})
	case action == "mkdir":
		var req struct{ Path string `json:"path"` }
		json.NewDecoder(r.Body).Decode(&req)
		mp, _ := runCmd("docker", "volume", "inspect", "--format", "{{.Mountpoint}}", name)
		runCmd("mkdir", "-p", strings.TrimSpace(mp)+"/"+req.Path)
		jsonOK(w, map[string]string{"status": "ok"})
	case action == "delete":
		runCmd("docker", "volume", "rm", name)
		jsonOK(w, map[string]string{"status": "ok"})
	case r.Method == http.MethodDelete:
		runCmd("docker", "volume", "rm", name)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonOK(w, map[string]string{"status": "ok"})
	}
}

func (s *Server) handleDockerCompose(w http.ResponseWriter, r *http.Request) {
	// Znajdź wszystkie pliki docker-compose na dysku
	out, _ := runCmd("bash", "-c", "find /opt/stacks /srv /home /root -maxdepth 4 -name 'docker-compose.yml' -o -name 'docker-compose.yaml' 2>/dev/null")
	var files []string
	for _, f := range strings.Split(out, "\n") {
		if f = strings.TrimSpace(f); f != "" {
			files = append(files, f)
		}
	}

	type StackInfo struct {
		Name     string   `json:"name"`
		File     string   `json:"file"`
		Status   string   `json:"status"`
		Services []string `json:"services"`
		Updated  string   `json:"updated"`
	}

	var stacks []StackInfo

	for _, file := range files {
		dir := file[:strings.LastIndex(file, "/")]
		// Nazwa stosu = nazwa katalogu
		parts := strings.Split(dir, "/")
		name := parts[len(parts)-1]

		// Pobierz listę usług z pliku (szybkie grep)
		servicesOut, _ := runCmd("bash", "-c",
			`grep -E "^  [a-zA-Z][a-zA-Z0-9_-]+:" `+file+` 2>/dev/null | sed "s/://g" | tr -d " "`)
		var services []string
		for _, sv := range strings.Split(servicesOut, "\n") {
			if sv = strings.TrimSpace(sv); sv != "" && sv != "version" && sv != "services" {
				services = append(services, sv)
			}
		}

		// Sprawdź status przez docker compose ps
		psOut, _ := runCmd("docker", "compose", "-f", file, "ps", "--format", "json")
		status := "stopped"
		if strings.Contains(psOut, `"running"`) || strings.Contains(psOut, `"Up"`) {
			runningCount := strings.Count(psOut, `"running"`) + strings.Count(psOut, `"Up"`)
			if runningCount == len(services) || len(services) == 0 {
				status = "running"
			} else {
				status = "partial"
			}
		}

		// Data modyfikacji pliku
		var updated string
		if fi, err := os.Stat(file); err == nil {
			updated = fi.ModTime().Format("2006-01-02")
		}

		stacks = append(stacks, StackInfo{
			Name:     name,
			File:     file,
			Status:   status,
			Services: services,
			Updated:  updated,
		})
	}

	if stacks == nil {
		stacks = []StackInfo{}
	}
	jsonOK(w, map[string]any{"stacks": stacks, "files": files})
}

// POST /services/docker/compose — utwórz nowy stos (zapisz plik + docker compose up -d)
func (s *Server) handleDockerComposeCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Content string `json:"content"`
		Deploy  bool   `json:"deploy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		jsonErr(w, "name required", http.StatusBadRequest)
		return
	}

	// Sanitize name — tylko bezpieczne znaki
	safeName := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, req.Name)
	if safeName == "" {
		jsonErr(w, "invalid stack name", http.StatusBadRequest)
		return
	}

	// Upewnij się że /opt/stacks istnieje
	if err := os.MkdirAll("/opt/stacks", 0755); err != nil {
		jsonErr(w, "cannot create /opt/stacks: "+err.Error(), http.StatusInternalServerError)
		return
	}

	dir := "/opt/stacks/" + safeName
	file := dir + "/docker-compose.yml"

	if err := os.MkdirAll(dir, 0755); err != nil {
		jsonErr(w, "cannot create stack dir "+dir+": "+err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Content == "" {
		req.Content = "services:\n  app:\n    image: nginx:alpine\n    restart: unless-stopped\n"
	}

	if err := writeFile(file, req.Content); err != nil {
		jsonErr(w, "cannot write file "+file+": "+err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Deploy {
		out, err := runCmd("docker", "compose", "-f", file, "up", "-d")
		if err != nil {
			jsonErr(w, out, http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]any{"status": "ok", "file": file, "output": out})
		return
	}
	jsonOK(w, map[string]any{"status": "ok", "file": file, "name": safeName})
}

func (s *Server) handleDockerComposeDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ File string `json:"file"` }
	json.NewDecoder(r.Body).Decode(&req)
	out, err := runCmd("docker", "compose", "-f", req.File, "up", "-d")
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerComposeAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerComposeItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/services/docker/compose/")

	// /services/docker/compose/create — POST tworzy nowy stos
	if suffix == "create" {
		s.handleDockerComposeCreate(w, r)
		return
	}

	filename := suffix
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]string{"filename": filename, "content": readFileStr(filename)})
	case http.MethodPut:
		var req struct{ Content string `json:"content"` }
		json.NewDecoder(r.Body).Decode(&req)
		writeFile(filename, req.Content)
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete:
		out, _ := runCmd("docker", "compose", "-f", filename, "down")
		jsonOK(w, map[string]any{"status": "ok", "output": out})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDockerComposeStream(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── Docker stats background poller ───────────────────────────────────────────
// docker stats --no-stream blokuje ~1s — robimy to w tle, API zwraca z cache

var (
	_dockerStatsCache   []json.RawMessage
	_dockerStatsCacheMu sync.RWMutex
	_dockerStatsOnce    sync.Once
)

func startDockerStatsPoller() {
	_dockerStatsOnce.Do(func() {
		go func() {
			for {
				// Sprawdź czy Docker działa zanim odpytamy stats
				if _, err := runCmd("docker", "info"); err != nil {
					time.Sleep(30 * time.Second)
					continue
				}
				out, err := runCmd("docker", "stats", "--no-stream", "--format",
					`{"id":"{{.ID}}","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","net":"{{.NetIO}}","block":"{{.BlockIO}}"}`)
				if err == nil && out != "" {
					var stats []json.RawMessage
					for _, l := range strings.Split(out, "\n") {
						if l = strings.TrimSpace(l); l != "" {
							stats = append(stats, json.RawMessage(l))
						}
					}
					_dockerStatsCacheMu.Lock()
					_dockerStatsCache = stats
					_dockerStatsCacheMu.Unlock()
				}
				// 5s zamiast 2s — wystarczy dla live stats, mniej procesów
				time.Sleep(5 * time.Second)
			}
		}()
	})
}

func (s *Server) handleDockerStatsBatch(w http.ResponseWriter, r *http.Request) {
	startDockerStatsPoller()
	_dockerStatsCacheMu.RLock()
	stats := make([]json.RawMessage, len(_dockerStatsCache))
	copy(stats, _dockerStatsCache)
	_dockerStatsCacheMu.RUnlock()
	jsonOK(w, map[string]any{"stats": stats})
}

func (s *Server) handleDockerStatsContainer(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/services/docker/stats/container/")
	out, _ := runCmd("docker", "stats", "--no-stream", "--format", `{"id":"{{.ID}}","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}"}`, id)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleDockerAutoUpdate(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{"enabled": false})
	case http.MethodPost: jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDockerAutoUpdateCheck(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"updates": []any{}})
}

func (s *Server) handleDockerRegistryList(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"registries": []any{}})
}

func (s *Server) handleDockerRegistryLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Registry, Username, Password string }
	json.NewDecoder(r.Body).Decode(&req)
	args := []string{"login", "-u", req.Username, "--password-stdin"}
	if req.Registry != "" { args = append(args, req.Registry) }
	out, err := runCmd("bash", "-c", "echo '"+req.Password+"' | docker "+strings.Join(args, " "))
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleDockerBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Container, Path string }
	json.NewDecoder(r.Body).Decode(&req)
	dest := req.Path; if dest == "" { dest = "/tmp/" + req.Container + "-backup.tar" }
	go runCmd("docker", "export", "-o", dest, req.Container)
	jsonOK(w, map[string]any{"status": "ok", "path": dest})
}

func (s *Server) handleDockerBackupList(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"backups": []any{}})
}

func (s *Server) handleDockerBackupRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerBackupSchedule(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerBackupSchedules(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"schedules": []any{}})
}

func (s *Server) handleDockerBackupScheduleItem(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerBuilds(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"builds": []any{}})
}

func (s *Server) handleDockerBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok", "id": "1"})
}

func (s *Server) handleDockerBuildGitHub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDockerBuildItem(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{})
}

func (s *Server) handleServicesConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:  jsonOK(w, map[string]any{})
	case http.MethodPut:  jsonOK(w, map[string]string{"status": "ok"})
	default: jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ─── Docker Inspect — GET /api/docker/inspect/:id ────────────────────────────

func (s *Server) handleDockerInspect(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/docker/inspect/")
	if id == "" {
		jsonErr(w, "container id required", http.StatusBadRequest)
		return
	}

	out, err := runCmd("docker", "inspect", id)
	if err != nil {
		jsonErr(w, "docker inspect failed: "+out, http.StatusInternalServerError)
		return
	}

	// docker inspect zwraca tablicę — weź pierwszy element
	var raw []json.RawMessage
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &raw); err != nil || len(raw) == 0 {
		jsonErr(w, "failed to parse docker inspect output", http.StatusInternalServerError)
		return
	}

	var full map[string]json.RawMessage
	json.Unmarshal(raw[0], &full)

	// Wyciągnij przydatne pola do struktury

	// State
	var state struct {
		Status  string `json:"Status"`
		Running bool   `json:"Running"`
		Paused  bool   `json:"Paused"`
		Pid     int    `json:"Pid"`
	}
	if v, ok := full["State"]; ok {
		json.Unmarshal(v, &state)
	}

	// Config
	var cfg struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
		Cmd    []string          `json:"Cmd"`
		User   string            `json:"User"`
	}
	if v, ok := full["Config"]; ok {
		json.Unmarshal(v, &cfg)
	}

	// NetworkSettings
	var netSettings struct {
		IPAddress   string `json:"IPAddress"`
		MacAddress  string `json:"MacAddress"`
		Gateway     string `json:"Gateway"`
	}
	if v, ok := full["NetworkSettings"]; ok {
		json.Unmarshal(v, &netSettings)
	}

	// Mounts
	type Mount struct {
		Type        string `json:"Type"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		Mode        string `json:"Mode"`
		RW          bool   `json:"RW"`
	}
	var mounts []Mount
	if v, ok := full["Mounts"]; ok {
		json.Unmarshal(v, &mounts)
	}

	// HostConfig — Ports, RestartPolicy
	var hostCfg struct {
		PortBindings  map[string]json.RawMessage `json:"PortBindings"`
		RestartPolicy struct {
			Name string `json:"Name"`
		} `json:"RestartPolicy"`
		Memory    int64 `json:"Memory"`
		CPUShares int64 `json:"CpuShares"`
	}
	if v, ok := full["HostConfig"]; ok {
		json.Unmarshal(v, &hostCfg)
	}

	// Ports — zbierz jako czytelny string
	var ports []string
	for k, v := range hostCfg.PortBindings {
		var bindings []struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		}
		if json.Unmarshal(v, &bindings) == nil {
			for _, b := range bindings {
				if b.HostPort != "" {
					host := b.HostIP
					if host == "" || host == "0.0.0.0" {
						host = "*"
					}
					ports = append(ports, host+":"+b.HostPort+"->"+k)
				}
			}
		}
	}

	// ID i Name
	var contID, contName string
	if v, ok := full["Id"]; ok {
		json.Unmarshal(v, &contID)
	}
	if v, ok := full["Name"]; ok {
		json.Unmarshal(v, &contName)
		contName = strings.TrimPrefix(contName, "/")
	}

	// Created
	var created string
	if v, ok := full["Created"]; ok {
		json.Unmarshal(v, &created)
	}

	jsonOK(w, map[string]any{
		"id":             contID,
		"name":           contName,
		"image":          cfg.Image,
		"created":        created,
		"state":          state.Status,
		"running":        state.Running,
		"pid":            state.Pid,
		"env":            cfg.Env,
		"labels":         cfg.Labels,
		"cmd":            cfg.Cmd,
		"user":           cfg.User,
		"ports":          ports,
		"restart_policy": hostCfg.RestartPolicy.Name,
		"memory_limit":   hostCfg.Memory,
		"cpu_shares":     hostCfg.CPUShares,
		"mounts":         mounts,
		"network": map[string]any{
			"ip":      netSettings.IPAddress,
			"mac":     netSettings.MacAddress,
			"gateway": netSettings.Gateway,
		},
		"raw": raw[0],
	})
}

// ─── Docker Exec — POST /api/docker/exec/:id ─────────────────────────────────
// Uruchamia pojedyncze polecenie w kontenerze przez docker exec
// Body: {"cmd": "ls -la /etc"}
// Zwraca: {"output":"...","exit_code":0}

func (s *Server) handleDockerExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := pathSuffix(r, "/api/docker/exec/")
	if id == "" {
		jsonErr(w, "container id required", http.StatusBadRequest)
		return
	}
	var req struct {
		Cmd string `json:"cmd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Cmd == "" {
		jsonErr(w, "cmd required", http.StatusBadRequest)
		return
	}

	// Uruchom przez docker exec z /bin/sh -c żeby obsłużyć pipelines/redirects
	out, err := runCmd("docker", "exec", id, "/bin/sh", "-c", req.Cmd)
	exitCode := 0
	if err != nil {
		exitCode = 1
	}
	jsonOK(w, map[string]any{
		"output":    out,
		"exit_code": exitCode,
	})
}
