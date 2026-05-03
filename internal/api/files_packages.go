package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ─── File Manager API ──────────────────────────────────────────────────────

type FileEntry struct {
	Name    string `json:"name"`
	Type    string `json:"type"`    // "dir", "file", "symlink"
	Size    int64  `json:"size"`    // bytes, -1 for dirs
	SizeStr string `json:"size_str"`
	Mtime   string `json:"mtime"`
	Perms   string `json:"perms"`
	Owner   string `json:"owner"`
	Group   string `json:"group"`
	IsDir   bool   `json:"is_dir"`
}

func guessFileType(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".mkv", ".mp4", ".avi", ".mov", ".m2ts", ".avi.ts", ".webm":
		return "video"
	case ".mp3", ".flac", ".aac", ".ogg", ".opus":
		return "audio"
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg":
		return "image"
	case ".txt", ".md", ".log", ".conf", ".yaml", ".yml", ".toml", ".ini", ".env":
		return "text"
	case ".sh", ".py", ".go", ".js", ".ts", ".jsx", ".tsx", ".c", ".cpp", ".rs":
		return "code"
	case ".zip", ".tar", ".gz", ".zst", ".bz2", ".xz", ".7z", ".rar":
		return "archive"
	case ".pdf":
		return "pdf"
	case ".sql":
		return "text"
	}
	return "file"
}

func humanSize(n int64) string {
	if n < 0 {
		return "—"
	}
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for n2 := n / unit; n2 >= unit; n2 /= unit {
		div *= unit
		exp++
	}
	labels := []string{"KB", "MB", "GB", "TB"}
	val := float64(n) / float64(div)
	if val >= 10 {
		return fmt.Sprintf("%.1f %s", val, labels[exp])
	}
	return fmt.Sprintf("%.2f %s", val, labels[exp])
}

// GET /api/files/list?path=/mnt/tank
func (s *Server) handleFilesList(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}
	// Safety: resolve to absolute, prevent traversal tricks
	clean := filepath.Clean(path)

	entries, err := os.ReadDir(clean)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	result := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		info, err2 := e.Info()
		if err2 != nil {
			continue
		}
		fe := FileEntry{
			Name:  e.Name(),
			IsDir: e.IsDir(),
			Mtime: info.ModTime().Format("2006-01-02 15:04"),
			Perms: info.Mode().String(),
		}
		if e.IsDir() {
			fe.Type = "dir"
			fe.Size = -1
			fe.SizeStr = "—"
		} else if e.Type()&os.ModeSymlink != 0 {
			fe.Type = "symlink"
			fe.Size = info.Size()
			fe.SizeStr = humanSize(info.Size())
		} else {
			fe.Type = guessFileType(e.Name())
			fe.Size = info.Size()
			fe.SizeStr = humanSize(info.Size())
		}

		// owner/group via stat
		owner, group := statOwner(filepath.Join(clean, e.Name()))
		fe.Owner = owner
		fe.Group = group

		result = append(result, fe)
	}

	// dirs first, then by name
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return result[i].Name < result[j].Name
	})

	jsonOK(w, map[string]any{
		"path":    clean,
		"entries": result,
	})
}

// POST /api/files/mkdir   body: {"path":"/mnt/tank/newfolder"}
func (s *Server) handleFilesMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	clean := filepath.Clean(req.Path)
	if err := os.MkdirAll(clean, 0755); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true, "path": clean})
}

// POST /api/files/delete  body: {"paths":["/mnt/tank/foo","/mnt/tank/bar"]}
func (s *Server) handleFilesDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Paths []string `json:"paths"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	var errs []string
	for _, p := range req.Paths {
		if err := os.RemoveAll(filepath.Clean(p)); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		jsonErr(w, strings.Join(errs, "; "), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true, "deleted": len(req.Paths)})
}

// POST /api/files/rename  body: {"from":"/mnt/tank/old","to":"/mnt/tank/new"}
func (s *Server) handleFilesRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if err := os.Rename(filepath.Clean(req.From), filepath.Clean(req.To)); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

// POST /api/files/chmod  body: {"path":"...","mode":"755","owner":"kuba","group":"media"}
func (s *Server) handleFilesChmod(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Path  string `json:"path"`
		Mode  string `json:"mode"`
		Owner string `json:"owner"`
		Group string `json:"group"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	clean := filepath.Clean(req.Path)

	if req.Mode != "" {
		mode, err := strconv.ParseUint(req.Mode, 8, 32)
		if err != nil {
			jsonErr(w, "invalid mode: "+req.Mode, http.StatusBadRequest)
			return
		}
		if err := os.Chmod(clean, os.FileMode(mode)); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if req.Owner != "" || req.Group != "" {
		arg := req.Owner + ":" + req.Group
		out, err := runCmd("chown", arg, clean)
		if err != nil {
			jsonErr(w, out, http.StatusInternalServerError)
			return
		}
	}
	jsonOK(w, map[string]any{"ok": true})
}

// GET /api/files/preview?path=/mnt/tank/docs/notes.md  (max 64 KB)
func (s *Server) handleFilesPreview(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Query().Get("path"))
	f, err := os.Open(path)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusNotFound)
		return
	}
	defer f.Close()
	buf := make([]byte, 65536)
	n, _ := f.Read(buf)
	jsonOK(w, map[string]any{
		"path":    path,
		"content": string(buf[:n]),
		"type":    guessFileType(path),
	})
}

// GET /api/files/download?path=/mnt/tank/docs/backup.sh
func (s *Server) handleFilesDownload(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Query().Get("path"))
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	name := filepath.Base(path)
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, f)
}

// POST /api/files/upload?path=/mnt/tank/drop  (multipart)
func (s *Server) handleFilesUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	dir := filepath.Clean(r.URL.Query().Get("path"))
	r.ParseMultipartForm(512 << 20) // 512 MB
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()
	dst := filepath.Join(dir, filepath.Base(header.Filename))
	out, err := os.Create(dst)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer out.Close()
	size, _ := io.Copy(out, file)
	jsonOK(w, map[string]any{"ok": true, "path": dst, "size": size})
}

// GET /api/files/mounts — lista zamontowanych punktów (ZFS/disk)
func (s *Server) handleFilesMounts(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("findmnt", "--json", "--real")
	if err != nil {
		// fallback
		out2, _ := runCmd("df", "-h", "--output=target,fstype,size,used,avail,pcent")
		jsonOK(w, map[string]any{"raw": out2})
		return
	}
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

// statOwner returns "owner" "group" strings using ls -la
func statOwner(path string) (string, string) {
	out, err := exec.Command("stat", "-c", "%U %G", path).Output()
	if err != nil {
		return "?", "?"
	}
	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) < 2 {
		return "?", "?"
	}
	return parts[0], parts[1]
}

// ─── Package Manager API ───────────────────────────────────────────────────

type AptPackage struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Section string   `json:"section"`
	SizeKB  int64    `json:"size_kb"`
	Auto    bool     `json:"auto"`
	Desc    string   `json:"desc"`
	Deps    []string `json:"deps"`
	Rdeps   []string `json:"rdeps"`
}

// GET /api/packages/installed
func (s *Server) handlePkgInstalled(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("dpkg-query", "-W",
		"-f=${Package}\t${Version}\t${Section}\t${Installed-Size}\t${db:Status-Abbrev}\t${Description}\n")
	if err != nil {
		jsonErr(w, "dpkg-query failed: "+out, http.StatusInternalServerError)
		return
	}
	autoOut, _ := runCmd("apt-mark", "showauto")
	autoSet := map[string]bool{}
	for _, l := range strings.Split(autoOut, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			autoSet[t] = true
		}
	}

	pkgs := []AptPackage{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 6 {
			continue
		}
		status := strings.TrimSpace(fields[4])
		if !strings.HasPrefix(status, "ii") {
			continue // not installed
		}
		name := fields[0]
		sizeKB, _ := strconv.ParseInt(strings.TrimSpace(fields[3]), 10, 64)
		sec := fields[2]
		if sec == "" {
			sec = "misc"
		}
		// strip section prefix like "admin/"
		if idx := strings.Index(sec, "/"); idx >= 0 {
			sec = sec[idx+1:]
		}
		pkgs = append(pkgs, AptPackage{
			Name:    name,
			Version: fields[1],
			Section: sec,
			SizeKB:  sizeKB,
			Auto:    autoSet[name],
			Desc:    strings.TrimSpace(fields[5]),
		})
	}
	jsonOK(w, pkgs)
}

// GET /api/packages/search?q=ncdu
func (s *Server) handlePkgSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		jsonErr(w, "missing q", http.StatusBadRequest)
		return
	}
	out, _ := runCmd("apt-cache", "search", "--names-only", q)
	// also get show for description + section
	type Result struct {
		Name      string `json:"name"`
		Desc      string `json:"desc"`
		Version   string `json:"version"`
		Section   string `json:"section"`
		SizeKB    int64  `json:"size_kb"`
		Installed bool   `json:"installed"`
	}
	// installed set
	instOut, _ := runCmd("dpkg-query", "-W", "-f=${Package}\t${db:Status-Abbrev}\n")
	instSet := map[string]bool{}
	for _, l := range strings.Split(instOut, "\n") {
		f := strings.Split(l, "\t")
		if len(f) == 2 && strings.HasPrefix(strings.TrimSpace(f[1]), "ii") {
			instSet[f[0]] = true
		}
	}

	results := []Result{}
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, " - ", 2)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		desc := strings.TrimSpace(parts[1])

		// get extra info
		showOut, _ := runCmd("apt-cache", "show", "--no-all-versions", name)
		version, section := "", "misc"
		var sizeKB int64
		for _, sl := range strings.Split(showOut, "\n") {
			if strings.HasPrefix(sl, "Version: ") {
				version = strings.TrimPrefix(sl, "Version: ")
			} else if strings.HasPrefix(sl, "Section: ") {
				section = strings.TrimPrefix(sl, "Section: ")
				if idx := strings.Index(section, "/"); idx >= 0 {
					section = section[idx+1:]
				}
			} else if strings.HasPrefix(sl, "Installed-Size: ") {
				fmt.Sscan(strings.TrimPrefix(sl, "Installed-Size: "), &sizeKB)
			}
		}
		results = append(results, Result{
			Name:      name,
			Desc:      desc,
			Version:   version,
			Section:   section,
			SizeKB:    sizeKB,
			Installed: instSet[name],
		})
	}
	jsonOK(w, results)
}

// GET /api/packages/show?name=nginx
func (s *Server) handlePkgShow(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		jsonErr(w, "missing name", http.StatusBadRequest)
		return
	}
	out, _ := runCmd("apt-cache", "show", "--no-all-versions", name)
	depsOut, _ := runCmd("apt-cache", "depends", name)
	rdepsOut, _ := runCmd("apt-cache", "rdepends", "--installed", name)

	parseDeps := func(s string) []string {
		var list []string
		for _, l := range strings.Split(s, "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "Depends:") {
				dep := strings.TrimSpace(strings.TrimPrefix(l, "Depends:"))
				// remove version constraints
				if idx := strings.Index(dep, " "); idx > 0 {
					dep = dep[:idx]
				}
				list = append(list, dep)
			}
		}
		return list
	}
	parseRdeps := func(s string) []string {
		var list []string
		lines := strings.Split(s, "\n")
		for i, l := range lines {
			if i < 1 {
				continue
			} // first line is header
			l = strings.TrimSpace(l)
			if l != "" && !strings.HasPrefix(l, "|") {
				list = append(list, l)
			}
		}
		return list
	}

	jsonOK(w, map[string]any{
		"name":  name,
		"info":  out,
		"deps":  parseDeps(depsOut),
		"rdeps": parseRdeps(rdepsOut),
	})
}

// POST /api/packages/install  body: {"name":"ncdu"}
// Streams apt output via chunked response
func (s *Server) handlePkgInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Name == "" {
		jsonErr(w, "missing name", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, canFlush := w.(http.Flusher)

	cmd := exec.Command("apt-get", "install", "-y", req.Name)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = &flushWriter{w: w, f: flusher, ok: canFlush}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	if err != nil {
		fmt.Fprintf(w, "\n[ERROR] %v\n", err)
	} else {
		fmt.Fprintf(w, "\n[OK] Installation complete.\n")
	}
	if canFlush {
		flusher.Flush()
	}
}

// POST /api/packages/remove  body: {"name":"ncdu","purge":false}
func (s *Server) handlePkgRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name  string `json:"name"`
		Purge bool   `json:"purge"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Name == "" {
		jsonErr(w, "missing name", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, canFlush := w.(http.Flusher)

	action := "remove"
	if req.Purge {
		action = "purge"
	}
	cmd := exec.Command("apt-get", action, "-y", req.Name)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = &flushWriter{w: w, f: flusher, ok: canFlush}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	if err != nil {
		fmt.Fprintf(w, "\n[ERROR] %v\n", err)
	} else {
		fmt.Fprintf(w, "\n[OK] Done.\n")
	}
	if canFlush {
		flusher.Flush()
	}
}

// POST /api/packages/mark-manual  body: {"name":"libcap2"}
func (s *Server) handlePkgMarkManual(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	out, err := runCmd("apt-mark", "manual", req.Name)
	jsonOK(w, map[string]any{"ok": err == nil, "output": out})
}

// POST /api/packages/autoremove  — removes unused auto packages
func (s *Server) handlePkgAutoremove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, canFlush := w.(http.Flusher)
	cmd := exec.Command("apt-get", "autoremove", "-y")
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = &flushWriter{w: w, f: flusher, ok: canFlush}
	cmd.Stderr = cmd.Stdout
	cmd.Run()
	if canFlush {
		flusher.Flush()
	}
}

// POST /api/packages/update  — apt-get update
func (s *Server) handlePkgUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, canFlush := w.(http.Flusher)
	cmd := exec.Command("apt-get", "update")
	cmd.Stdout = &flushWriter{w: w, f: flusher, ok: canFlush}
	cmd.Stderr = cmd.Stdout
	cmd.Run()
	if canFlush {
		flusher.Flush()
	}
}

// GET /api/packages/stats — total installed count and disk usage
func (s *Server) handlePkgStats(w http.ResponseWriter, r *http.Request) {
	countOut, _ := runCmd("dpkg-query", "-W", "-f=${db:Status-Abbrev}\n")
	count := 0
	for _, l := range strings.Split(countOut, "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "ii") {
			count++
		}
	}
	// total size from dpkg: sum of Installed-Size (in KB)
	sizeOut, _ := runCmd("dpkg-query", "-W", "-f=${Installed-Size}\n")
	var totalKB int64
	for _, l := range strings.Split(sizeOut, "\n") {
		var kb int64
		fmt.Sscan(strings.TrimSpace(l), &kb)
		totalKB += kb
	}
	autoOut, _ := runCmd("apt-mark", "showauto")
	autoCount := 0
	for _, l := range strings.Split(autoOut, "\n") {
		if strings.TrimSpace(l) != "" {
			autoCount++
		}
	}
	jsonOK(w, map[string]any{
		"installed":   count,
		"auto":        autoCount,
		"manual":      count - autoCount,
		"total_kb":    totalKB,
		"total_mb":    float64(totalKB) / 1024,
		"last_update": time.Now().Format(time.RFC3339),
	})
}

// flushWriter wraps http.ResponseWriter + Flusher for streaming
type flushWriter struct {
	w  http.ResponseWriter
	f  http.Flusher
	ok bool
}

func (fw *flushWriter) Write(p []byte) (int, error) {
	n, err := fw.w.Write(p)
	if fw.ok {
		fw.f.Flush()
	}
	return n, err
}
