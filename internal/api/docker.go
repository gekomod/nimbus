package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"net/http"
	"net/url"
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
		out2, err2 := runCmd("docker", "volume", "rm", name)
		if err2 != nil {
			jsonErr(w, "Nie można usunąć: "+strings.TrimSpace(out2), http.StatusConflict)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})
	case r.Method == http.MethodDelete:
		// Sprawdź czy force=true
		force := r.URL.Query().Get("force") == "true"
		var out string
		var err error
		if force {
			// Znajdź kontenery używające tego woluminu i usuń je najpierw
			contOut, _ := runCmd("docker", "ps", "-a", "--filter", "volume="+name, "--format", "{{.ID}}")
			for _, cid := range strings.Fields(contOut) {
				runCmd("docker", "rm", "-f", cid)
			}
			out, err = runCmd("docker", "volume", "rm", name)
		} else {
			out, err = runCmd("docker", "volume", "rm", name)
		}
		if err != nil {
			// Wyciągnij ID kontenerów z błędu i pokaż czytelnie
			msg := strings.TrimSpace(out)
			if strings.Contains(msg, "volume is in use") {
				jsonErr(w, "Wolumin jest używany przez zatrzymany kontener. Użyj przycisku 'Wymuś usunięcie'.", http.StatusConflict)
			} else {
				jsonErr(w, msg, http.StatusConflict)
			}
			return
		}
		jsonOK(w, map[string]string{"status": "ok", "name": name})
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

		// Sprawdź status przez docker compose ps (z --project-name)
		// Nazwa projektu = nazwa katalogu (tak jak docker compose domyślnie)
		// Sprawdź status — 3 metody
		status := "stopped"

		// 1. docker compose ps z nazwą projektu
		psOut, _ := runCmd("docker", "compose", "-f", file, "--project-name", name, "ps", "--format", "json")
		if strings.Contains(psOut, `"running"`) || strings.Contains(psOut, "running") {
			runningCount := strings.Count(psOut, `"running"`)
			if runningCount >= len(services) || len(services) == 0 {
				status = "running"
			} else {
				status = "partial"
			}
		}

		// 2. Fallback — sprawdź przez docker ps wg nazwy projektu i nazw serwisów
		if status == "stopped" {
			psOut2, _ := runCmd("docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Labels}}")
			running := 0

			// Zbierz kandydatów — kontenery których nazwa zawiera nazwę projektu LUB serwisu
			candidates := append(services, name)
			for _, line := range strings.Split(psOut2, "\n") {
				lower := strings.ToLower(line)
				if !strings.Contains(lower, "\tup") { continue }
				for _, cand := range candidates {
					if strings.Contains(lower, strings.ToLower(cand)) {
						running++
						break
					}
				}
			}

			// Sprawdź też przez label com.docker.compose.project
			psLabel, _ := runCmd("docker", "ps",
				"--filter", "label=com.docker.compose.project="+name,
				"--format", "{{.Names}}")
			labelCount := 0
			for _, l := range strings.Split(strings.TrimSpace(psLabel), "\n") {
				if strings.TrimSpace(l) != "" { labelCount++ }
			}

			total := running
			if labelCount > total { total = labelCount }

			if total > 0 {
				if len(services) == 0 || total >= len(services) {
					status = "running"
				} else {
					status = "partial"
				}
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

	if req.Content == "" {
		req.Content = "services:\n  app:\n    image: nginx:alpine\n    restart: unless-stopped\n"
	}

	file, out, err := createComposeStack(req.Name, req.Content, req.Deploy)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Deploy {
		jsonOK(w, map[string]any{"status": "ok", "file": file, "output": out})
		return
	}
	jsonOK(w, map[string]any{"status": "ok", "file": file, "name": sanitizeStackName(req.Name)})
}

// sanitizeStackName oczyszcza nazwę stosu do bezpiecznych znaków — używane
// zarówno przy tworzeniu stosu od zera, jak i przy instalacji z szablonu.
func sanitizeStackName(name string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, name)
}

// createComposeStack zapisuje docker-compose.yml pod /opt/stacks/<name>/
// i opcjonalnie od razu go uruchamia ("docker compose up -d"). Wspólna
// logika dla "Nowy stos" (ręczny YAML) oraz instalacji z szablonu.
func createComposeStack(name, content string, deploy bool) (file string, output string, err error) {
	safeName := sanitizeStackName(name)
	if safeName == "" {
		return "", "", errors.New("invalid stack name")
	}

	if err := os.MkdirAll("/opt/stacks", 0755); err != nil {
		return "", "", errors.New("cannot create /opt/stacks: " + err.Error())
	}

	dir := "/opt/stacks/" + safeName
	file = dir + "/docker-compose.yml"

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", errors.New("cannot create stack dir " + dir + ": " + err.Error())
	}

	if err := writeFile(file, content); err != nil {
		return "", "", errors.New("cannot write file " + file + ": " + err.Error())
	}

	if deploy {
		out, runErr := runCmd("docker", "compose", "-f", file, "up", "-d")
		if runErr != nil {
			return file, out, errors.New(out)
		}
		return file, out, nil
	}
	return file, "", nil
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

	// Dekoduj URL — pełna ścieżka może być zakodowana (%2F zamiast /)
	// Odkoduj ścieżkę — suffix może być:
	// 1. /opt/stacks/... (Go odkodował %2F → /)  → trzeba dodać /
	// 2. opt/stacks/...  (bez wiodącego /)        → trzeba dodać /
	// 3. zakodowany %2Fopt%2F...                  → QueryUnescape
	filename := suffix
	if decoded, err := url.QueryUnescape(suffix); err == nil {
		filename = decoded
	}
	// Upewnij się że ścieżka zaczyna od /
	if filename != "" && filename[0] != '/' {
		filename = "/" + filename
	}
	// Bezpieczeństwo — tylko pliki compose
	if !strings.HasSuffix(filename, ".yml") && !strings.HasSuffix(filename, ".yaml") {
		jsonErr(w, "nieprawidłowa ścieżka compose: "+filename, http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]string{"filename": filename, "content": readFileStr(filename)})
	case http.MethodPut:
		var req struct{ Content string `json:"content"` }
		json.NewDecoder(r.Body).Decode(&req)
		writeFile(filename, req.Content)
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete:
		// 1. docker compose down — zatrzymaj i usuń kontenery
		out, err := runCmd("docker", "compose", "-f", filename, "down", "--remove-orphans", "-v")
		if err != nil {
			// Spróbuj bez -v
			out, _ = runCmd("docker", "compose", "-f", filename, "down", "--remove-orphans")
		}
		// 2. Usuń katalog stosu
		dir := filepath.Dir(filename)
		os.RemoveAll(dir)
		jsonOK(w, map[string]any{"status": "ok", "output": out, "removed_dir": dir})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleDockerComposeFile — pobiera zawartość pliku compose po ścieżce
// GET /api/docker/compose-file?path=/opt/stacks/jellyfin/docker-compose.yml
func (s *Server) handleDockerComposeFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		jsonErr(w, "brak parametru path", http.StatusBadRequest)
		return
	}
	// Walidacja — tylko pliki compose
	if !strings.HasSuffix(path, ".yml") && !strings.HasSuffix(path, ".yaml") {
		jsonErr(w, "niedozwolony typ pliku", http.StatusForbidden)
		return
	}
	content := readFileStr(path)
	jsonOK(w, map[string]string{"content": content, "path": path})
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

	// NetworkSettings — w tym sieci kontenera
	var netSettings struct {
		IPAddress   string                     `json:"IPAddress"`
		MacAddress  string                     `json:"MacAddress"`
		Gateway     string                     `json:"Gateway"`
		Networks    map[string]json.RawMessage `json:"Networks"`
	}
	if v, ok := full["NetworkSettings"]; ok {
		json.Unmarshal(v, &netSettings)
	}
	var networkNames []string
	for netName := range netSettings.Networks {
		networkNames = append(networkNames, netName)
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

	// HostConfig — Ports, RestartPolicy, Binds, NanoCpus
	var hostCfg struct {
		PortBindings  map[string]json.RawMessage `json:"PortBindings"`
		RestartPolicy struct {
			Name string `json:"Name"`
		} `json:"RestartPolicy"`
		Memory    int64    `json:"Memory"`
		NanoCpus  int64    `json:"NanoCpus"`
		CPUShares int64    `json:"CpuShares"`
		Binds     []string `json:"Binds"`
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
		"binds":          hostCfg.Binds,
		"network_names":  networkNames,
		"nano_cpus":      hostCfg.NanoCpus,
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

// ═══════════════════════════════════════════════════════════════════════════
// Docker Templates — gotowe szablony aplikacji do zainstalowania jednym klikiem
// GET  /services/docker/templates          — lista dostępnych szablonów
// POST /services/docker/templates/install  — zapisuje docker-compose.yml
//      wygenerowany z szablonu (podstawiając zmienne) i wdraża go
// ═══════════════════════════════════════════════════════════════════════════

// TemplateVar — pojedyncze pole konfiguracyjne szablonu (np. port, ścieżka).
// Placeholder w polu Compose ma postać {{KLUCZ}} i jest podmieniany przy
// instalacji na wartość podaną przez użytkownika (albo Default, jeśli pusta).
type TemplateVar struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Default string `json:"default"`
}

// DockerTemplate — definicja gotowej aplikacji do zainstalowania.
type DockerTemplate struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Category    string        `json:"category"`
	Icon        string        `json:"icon"`
	Compose     string        `json:"compose"`
	Vars        []TemplateVar `json:"vars"`
}

// dockerTemplates — wbudowana biblioteka szablonów. Każdy wpis to kompletny
// docker-compose.yml z placeholderami {{...}} podmienianymi przy instalacji.
var dockerTemplates = []DockerTemplate{
	{
		ID: "portainer", Name: "Portainer", Category: "Zarządzanie", Icon: "settings",
		Description: "Graficzny panel do zarządzania Dockerem (kontenery, obrazy, sieci) przez przeglądarkę.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "9000"},
		},
		Compose: "services:\n" +
			"  portainer:\n" +
			"    image: portainer/portainer-ce:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:9000\"\n" +
			"    volumes:\n" +
			"      - /var/run/docker.sock:/var/run/docker.sock\n" +
			"      - portainer_data:/data\n" +
			"volumes:\n" +
			"  portainer_data:\n",
	},
	{
		ID: "jellyfin", Name: "Jellyfin", Category: "Multimedia", Icon: "play",
		Description: "Serwer multimediów (filmy, seriale, muzyka) ze streamingiem do dowolnego urządzenia.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "8096"},
			{Key: "MEDIA_PATH", Label: "Ścieżka do biblioteki mediów", Default: "/srv/media"},
			{Key: "TZ", Label: "Strefa czasowa", Default: "Europe/Warsaw"},
		},
		Compose: "services:\n" +
			"  jellyfin:\n" +
			"    image: jellyfin/jellyfin:latest\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - TZ={{TZ}}\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:8096\"\n" +
			"    volumes:\n" +
			"      - jellyfin_config:/config\n" +
			"      - jellyfin_cache:/cache\n" +
			"      - {{MEDIA_PATH}}:/media\n" +
			"volumes:\n" +
			"  jellyfin_config:\n" +
			"  jellyfin_cache:\n",
	},
	{
		ID: "nextcloud", Name: "Nextcloud", Category: "Pliki", Icon: "folder",
		Description: "Prywatna chmura plików — synchronizacja, kalendarz, kontakty (jak własny Dropbox).",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "8080"},
			{Key: "DATA_PATH", Label: "Ścieżka do danych", Default: "/srv/nextcloud"},
		},
		Compose: "services:\n" +
			"  nextcloud:\n" +
			"    image: nextcloud:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:80\"\n" +
			"    volumes:\n" +
			"      - {{DATA_PATH}}:/var/www/html\n",
	},
	{
		ID: "pihole", Name: "Pi-hole", Category: "Sieć", Icon: "shield",
		Description: "Blokowanie reklam i trackerów w całej sieci na poziomie DNS.",
		Vars: []TemplateVar{
			{Key: "WEB_PORT", Label: "Port panelu WWW", Default: "8081"},
			{Key: "PASSWORD", Label: "Hasło do panelu", Default: "changeme"},
			{Key: "TZ", Label: "Strefa czasowa", Default: "Europe/Warsaw"},
		},
		Compose: "services:\n" +
			"  pihole:\n" +
			"    image: pihole/pihole:latest\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - TZ={{TZ}}\n" +
			"      - WEBPASSWORD={{PASSWORD}}\n" +
			"    ports:\n" +
			"      - \"53:53/tcp\"\n" +
			"      - \"53:53/udp\"\n" +
			"      - \"{{WEB_PORT}}:80\"\n" +
			"    volumes:\n" +
			"      - pihole_etc:/etc/pihole\n" +
			"      - pihole_dnsmasq:/etc/dnsmasq.d\n" +
			"    cap_add:\n" +
			"      - NET_ADMIN\n" +
			"volumes:\n" +
			"  pihole_etc:\n" +
			"  pihole_dnsmasq:\n",
	},
	{
		ID: "vaultwarden", Name: "Vaultwarden", Category: "Bezpieczeństwo", Icon: "key",
		Description: "Lekki, samodzielnie hostowany serwer haseł kompatybilny z klientami Bitwarden.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "8082"},
		},
		Compose: "services:\n" +
			"  vaultwarden:\n" +
			"    image: vaultwarden/server:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:80\"\n" +
			"    volumes:\n" +
			"      - vaultwarden_data:/data\n" +
			"volumes:\n" +
			"  vaultwarden_data:\n",
	},
	{
		ID: "homeassistant", Name: "Home Assistant", Category: "Automatyka domowa", Icon: "settings",
		Description: "Centrum automatyki domowej — integracja czujników, urządzeń IoT i scenariuszy.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "8123"},
			{Key: "TZ", Label: "Strefa czasowa", Default: "Europe/Warsaw"},
		},
		Compose: "services:\n" +
			"  homeassistant:\n" +
			"    image: ghcr.io/home-assistant/home-assistant:stable\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - TZ={{TZ}}\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:8123\"\n" +
			"    volumes:\n" +
			"      - homeassistant_config:/config\n" +
			"volumes:\n" +
			"  homeassistant_config:\n",
	},
	{
		ID: "qbittorrent", Name: "qBittorrent", Category: "Multimedia", Icon: "download",
		Description: "Klient torrent z panelem WWW, przydatny do pobierania w tle na serwerze.",
		Vars: []TemplateVar{
			{Key: "WEB_PORT", Label: "Port panelu WWW", Default: "8083"},
			{Key: "TORRENT_PORT", Label: "Port ruchu torrent", Default: "6881"},
			{Key: "DOWNLOADS_PATH", Label: "Ścieżka pobierania", Default: "/srv/downloads"},
			{Key: "TZ", Label: "Strefa czasowa", Default: "Europe/Warsaw"},
		},
		Compose: "services:\n" +
			"  qbittorrent:\n" +
			"    image: lscr.io/linuxserver/qbittorrent:latest\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - TZ={{TZ}}\n" +
			"      - WEBUI_PORT={{WEB_PORT}}\n" +
			"    ports:\n" +
			"      - \"{{WEB_PORT}}:{{WEB_PORT}}\"\n" +
			"      - \"{{TORRENT_PORT}}:{{TORRENT_PORT}}\"\n" +
			"      - \"{{TORRENT_PORT}}:{{TORRENT_PORT}}/udp\"\n" +
			"    volumes:\n" +
			"      - qbittorrent_config:/config\n" +
			"      - {{DOWNLOADS_PATH}}:/downloads\n" +
			"volumes:\n" +
			"  qbittorrent_config:\n",
	},
	{
		ID: "uptimekuma", Name: "Uptime Kuma", Category: "Monitoring", Icon: "thermometer",
		Description: "Monitorowanie dostępności usług i stron z powiadomieniami przy awarii.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "3001"},
		},
		Compose: "services:\n" +
			"  uptime-kuma:\n" +
			"    image: louislam/uptime-kuma:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:3001\"\n" +
			"    volumes:\n" +
			"      - uptimekuma_data:/app/data\n" +
			"volumes:\n" +
			"  uptimekuma_data:\n",
	},
	{
		ID: "nginx-proxy-manager", Name: "Nginx Proxy Manager", Category: "Sieć", Icon: "globe",
		Description: "Reverse proxy z certyfikatami SSL (Let's Encrypt) zarządzany przez panel WWW.",
		Vars: []TemplateVar{
			{Key: "ADMIN_PORT", Label: "Port panelu admina", Default: "81"},
			{Key: "HTTP_PORT", Label: "Port HTTP", Default: "80"},
			{Key: "HTTPS_PORT", Label: "Port HTTPS", Default: "443"},
		},
		Compose: "services:\n" +
			"  npm:\n" +
			"    image: jc21/nginx-proxy-manager:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{HTTP_PORT}}:80\"\n" +
			"      - \"{{HTTPS_PORT}}:443\"\n" +
			"      - \"{{ADMIN_PORT}}:81\"\n" +
			"    volumes:\n" +
			"      - npm_data:/data\n" +
			"      - npm_letsencrypt:/etc/letsencrypt\n" +
			"volumes:\n" +
			"  npm_data:\n" +
			"  npm_letsencrypt:\n",
	},
	{
		ID: "grafana", Name: "Grafana", Category: "Monitoring", Icon: "log",
		Description: "Dashboardy i wizualizacja metryk — najczęściej łączony z Prometheusem lub InfluxDB.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "3000"},
		},
		Compose: "services:\n" +
			"  grafana:\n" +
			"    image: grafana/grafana:latest\n" +
			"    restart: unless-stopped\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:3000\"\n" +
			"    volumes:\n" +
			"      - grafana_data:/var/lib/grafana\n" +
			"volumes:\n" +
			"  grafana_data:\n",
	},
	{
		ID: "watchtower", Name: "Watchtower", Category: "Zarządzanie", Icon: "refresh",
		Description: "Automatycznie aktualizuje obrazy uruchomionych kontenerów, gdy pojawi się nowa wersja.",
		Vars: []TemplateVar{
			{Key: "INTERVAL", Label: "Interwał sprawdzania (sekundy)", Default: "86400"},
		},
		Compose: "services:\n" +
			"  watchtower:\n" +
			"    image: containrrr/watchtower:latest\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - WATCHTOWER_POLL_INTERVAL={{INTERVAL}}\n" +
			"      - WATCHTOWER_CLEANUP=true\n" +
			"    volumes:\n" +
			"      - /var/run/docker.sock:/var/run/docker.sock\n",
	},
	{
		ID: "code-server", Name: "code-server", Category: "Deweloperskie", Icon: "terminal",
		Description: "VS Code działający w przeglądarce — kodowanie zdalnie z dowolnego urządzenia.",
		Vars: []TemplateVar{
			{Key: "PORT", Label: "Port WWW", Default: "8443"},
			{Key: "PASSWORD", Label: "Hasło logowania", Default: "changeme"},
			{Key: "PROJECTS_PATH", Label: "Ścieżka do projektów", Default: "/srv/projects"},
		},
		Compose: "services:\n" +
			"  code-server:\n" +
			"    image: lscr.io/linuxserver/code-server:latest\n" +
			"    restart: unless-stopped\n" +
			"    environment:\n" +
			"      - PASSWORD={{PASSWORD}}\n" +
			"    ports:\n" +
			"      - \"{{PORT}}:8443\"\n" +
			"    volumes:\n" +
			"      - codeserver_config:/config\n" +
			"      - {{PROJECTS_PATH}}:/config/workspace\n" +
			"volumes:\n" +
			"  codeserver_config:\n",
	},
}

// GET /services/docker/templates — lista dostępnych szablonów
func (s *Server) handleDockerTemplates(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"templates": dockerTemplates})
}

// POST /services/docker/templates/install
// Body: {"id":"jellyfin","name":"jellyfin","vars":{"PORT":"8096",...},"deploy":true}
func (s *Server) handleDockerTemplateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID     string            `json:"id"`
		Name   string            `json:"name"`
		Vars   map[string]string `json:"vars"`
		Deploy *bool             `json:"deploy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		jsonErr(w, "id required", http.StatusBadRequest)
		return
	}

	var tpl *DockerTemplate
	for i := range dockerTemplates {
		if dockerTemplates[i].ID == req.ID {
			tpl = &dockerTemplates[i]
			break
		}
	}
	if tpl == nil {
		jsonErr(w, "nieznany szablon: "+req.ID, http.StatusNotFound)
		return
	}

	stackName := req.Name
	if stackName == "" {
		stackName = tpl.ID
	}

	// Podstaw zmienne — brakujące pola wypełnij domyślnymi wartościami szablonu
	content := tpl.Compose
	for _, v := range tpl.Vars {
		val := ""
		if req.Vars != nil {
			val = strings.TrimSpace(req.Vars[v.Key])
		}
		if val == "" {
			val = v.Default
		}
		content = strings.ReplaceAll(content, "{{"+v.Key+"}}", val)
	}

	deploy := true // domyślnie od razu uruchamiamy zainstalowaną aplikację
	if req.Deploy != nil {
		deploy = *req.Deploy
	}

	file, out, err := createComposeStack(stackName, content, deploy)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{
		"status": "ok",
		"name":   sanitizeStackName(stackName),
		"file":   file,
		"output": out,
	})
}
