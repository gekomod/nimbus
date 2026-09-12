package api

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type VMTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Family      string `json:"family"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Format      string `json:"format"`
	MinCPU      int    `json:"min_cpu"`
	MinRAM      int    `json:"min_ram"`
	MinDisk     int    `json:"min_disk"`
	Custom      bool   `json:"custom,omitempty"`
	LocalPath   string `json:"-"`
}

const vmTemplatesPath = "/etc/nimbus/kvm-templates.json"

var vmTemplatesMu sync.Mutex

var vmTemplates = []VMTemplate{
	{ID: "ubuntu-2404", Name: "Ubuntu Server", Version: "24.04 LTS", Family: "ubuntu", Icon: "🟠", Description: "Cloud image · cloud-init · QEMU Guest Agent", URL: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img", Format: "qcow2", MinCPU: 2, MinRAM: 2048, MinDisk: 20},
	{ID: "debian-12", Name: "Debian", Version: "12 Bookworm", Family: "debian", Icon: "🔴", Description: "Oficjalny generic cloud image", URL: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2", Format: "qcow2", MinCPU: 1, MinRAM: 1024, MinDisk: 10},
	{ID: "rocky-9", Name: "Rocky Linux", Version: "9", Family: "rocky", Icon: "🟢", Description: "Generic cloud image dla serwerów", URL: "https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2", Format: "qcow2", MinCPU: 2, MinRAM: 2048, MinDisk: 20},
	{ID: "alpine-320", Name: "Alpine Linux", Version: "3.20", Family: "alpine", Icon: "🔷", Description: "Lekki system do małych usług", URL: "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/cloud/nocloud_alpine-3.20.3-x86_64-bios-cloudinit-r0.qcow2", Format: "qcow2", MinCPU: 1, MinRAM: 512, MinDisk: 2},
	{ID: "parrot-security-73", Name: "Parrot Security", Version: "7.3", Family: "debian", Icon: "🦜", Description: "Security Edition · gotowy dysk QCOW2 w archiwum ZIP", URL: "https://deb.parrot.sh/parrot/iso/7.3/Parrot-security-7.3_amd64.qcow2.zip", Format: "qcow2.zip", MinCPU: 2, MinRAM: 4096, MinDisk: 40},
}

func loadCustomVMTemplates() []VMTemplate {
	vmTemplatesMu.Lock()
	defer vmTemplatesMu.Unlock()

	var templates []VMTemplate
	data, err := os.ReadFile(vmTemplatesPath)
	if err == nil {
		_ = json.Unmarshal(data, &templates)
	}
	for i := range templates {
		templates[i].Custom = true
		templates[i].Format = normalizeTemplateFormat(templates[i].Format, templates[i].URL)
	}
	return templates
}

func saveCustomVMTemplates(templates []VMTemplate) error {
	vmTemplatesMu.Lock()
	defer vmTemplatesMu.Unlock()

	if err := os.MkdirAll(filepath.Dir(vmTemplatesPath), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(templates, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(vmTemplatesPath, data, 0644)
}

func allVMTemplates() []VMTemplate {
	templates := append([]VMTemplate{}, vmTemplates...)
	return append(templates, loadCustomVMTemplates()...)
}

func normalizeTemplateFormat(format string, imageURL string) string {
	format = strings.ToLower(strings.TrimSpace(format))
	urlIsZIP := false
	if parsed, err := url.Parse(imageURL); err == nil {
		urlIsZIP = strings.HasSuffix(strings.ToLower(parsed.Path), ".zip")
	}
	switch format {
	case "zip", "qcow2-zip", "qcow2_zip", "qcow2.zip":
		return "qcow2.zip"
	case "qcow2", "":
		if urlIsZIP {
			return "qcow2.zip"
		}
		return "qcow2"
	default:
		return format
	}
}

func validateVMTemplate(t *VMTemplate) error {
	t.ID = safeVMName(strings.ToLower(t.ID))
	t.Name = strings.TrimSpace(t.Name)
	t.URL = strings.TrimSpace(t.URL)
	if t.ID == "" || t.Name == "" {
		return fmt.Errorf("ID i nazwa są wymagane")
	}
	parsed, err := url.ParseRequestURI(t.URL)
	if err != nil || parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("wymagany poprawny adres HTTP/HTTPS obrazu")
	}
	t.Format = normalizeTemplateFormat(t.Format, t.URL)
	if t.Format != "qcow2" && t.Format != "qcow2.zip" {
		return fmt.Errorf("obsługiwane formaty obrazu: QCOW2 oraz QCOW2 w archiwum ZIP")
	}
	if t.MinCPU < 1 {
		t.MinCPU = 1
	}
	if t.MinRAM < 256 {
		t.MinRAM = 256
	}
	if t.MinDisk < 1 {
		t.MinDisk = 1
	}
	if t.Icon == "" {
		t.Icon = "💿"
	}
	t.Custom = true
	return nil
}

type templateJob struct {
	ID        string    `json:"id"`
	Template  string    `json:"template"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	Step      string    `json:"step"`
	Error     string    `json:"error,omitempty"`
	Progress  int       `json:"progress"`
	Started   time.Time `json:"started"`
	ImagePath string    `json:"image_path,omitempty"`
}

var templateJobs = struct {
	sync.RWMutex
	M map[string]*templateJob
}{M: map[string]*templateJob{}}

var templateBaseLocks = struct {
	sync.Mutex
	M map[string]*sync.Mutex
}{M: map[string]*sync.Mutex{}}

func safeVMName(v string) string {
	v = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, v)
	return strings.Trim(v, "-")
}

func (s *Server) handleKVMTemplates(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"templates": allVMTemplates(), "custom_path": vmTemplatesPath})
	case http.MethodPost:
		var t VMTemplate
		if json.NewDecoder(r.Body).Decode(&t) != nil {
			jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
			return
		}
		if err := validateVMTemplate(&t); err != nil {
			jsonErr(w, err.Error(), http.StatusBadRequest)
			return
		}
		for _, existing := range allVMTemplates() {
			if existing.ID == t.ID {
				jsonErr(w, "szablon o tym ID już istnieje", http.StatusConflict)
				return
			}
		}
		custom := append(loadCustomVMTemplates(), t)
		if err := saveCustomVMTemplates(custom); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, t)
	case http.MethodPut:
		var t VMTemplate
		if json.NewDecoder(r.Body).Decode(&t) != nil {
			jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
			return
		}
		if err := validateVMTemplate(&t); err != nil {
			jsonErr(w, err.Error(), http.StatusBadRequest)
			return
		}
		custom := loadCustomVMTemplates()
		found := false
		for i := range custom {
			if custom[i].ID == t.ID {
				custom[i] = t
				found = true
				break
			}
		}
		if !found {
			jsonErr(w, "można edytować tylko własny szablon", http.StatusNotFound)
			return
		}
		if err := saveCustomVMTemplates(custom); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, t)
	case http.MethodDelete:
		id := safeVMName(strings.ToLower(r.URL.Query().Get("id")))
		if id == "" {
			jsonErr(w, "ID jest wymagane", http.StatusBadRequest)
			return
		}
		custom := loadCustomVMTemplates()
		next := custom[:0]
		found := false
		for _, t := range custom {
			if t.ID == id {
				found = true
				continue
			}
			next = append(next, t)
		}
		if !found {
			jsonErr(w, "można usunąć tylko własny szablon", http.StatusNotFound)
			return
		}
		if err := saveCustomVMTemplates(next); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleKVMTemplateJobs(w http.ResponseWriter, r *http.Request) {
	templateJobs.RLock()
	jobs := make([]templateJob, 0, len(templateJobs.M))
	for _, job := range templateJobs.M {
		jobs = append(jobs, *job)
	}
	templateJobs.RUnlock()
	sort.Slice(jobs, func(i, k int) bool { return jobs[i].Started.After(jobs[k].Started) })
	jsonOK(w, map[string]any{"jobs": jobs})
}

func (s *Server) handleKVMTemplateDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var q struct {
		Template, Name, Network, SSHKey, DownloadID string
		CPU, RAM, Disk                              int
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
		return
	}
	q.Name = safeVMName(q.Name)
	if q.Name == "" {
		jsonErr(w, "nazwa VM jest wymagana", http.StatusBadRequest)
		return
	}
	templates := allVMTemplates()
	var tpl *VMTemplate
	for i := range templates {
		if templates[i].ID == q.Template {
			tpl = &templates[i]
			break
		}
	}
	if q.DownloadID != "" {
		var err error
		tpl, err = s.templateFromDownload(r, q.DownloadID)
		if err != nil {
			jsonErr(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if tpl == nil {
		jsonErr(w, "nieznany szablon", http.StatusBadRequest)
		return
	}
	if q.CPU < tpl.MinCPU {
		q.CPU = tpl.MinCPU
	}
	if q.RAM < tpl.MinRAM {
		q.RAM = tpl.MinRAM
	}
	if q.Disk < tpl.MinDisk {
		q.Disk = tpl.MinDisk
	}
	if q.Network == "" {
		q.Network = "default"
	}
	if err := templatePreflight(q.Network); err != nil {
		jsonErr(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	target := filepath.Join(loadKVMConfig().ImagePath, q.Name+".qcow2")
	if _, err := os.Lstat(target); err == nil {
		jsonErr(w, "Dysk tej maszyny już istnieje: "+target+". Wybierz inną nazwę lub sprawdź poprzednie wdrożenie.", http.StatusConflict)
		return
	}
	if out, err := templateExec("virsh", "dominfo", q.Name); err == nil && out != "" {
		jsonErr(w, "VM o tej nazwie już istnieje", http.StatusConflict)
		return
	}
	job := &templateJob{ID: strconv.FormatInt(time.Now().UnixNano(), 36), Template: tpl.ID, Name: q.Name, Status: "queued", Step: "Oczekiwanie", Started: time.Now()}
	templateJobs.Lock()
	templateJobs.M[job.ID] = job
	templateJobs.Unlock()
	go deployTemplate(job, *tpl, q.Name, q.Network, q.SSHKey, q.CPU, q.RAM, q.Disk)
	jsonOK(w, map[string]any{"status": "accepted", "job_id": job.ID})
}

// Resolve a completed daemon task, never accept a client-provided filesystem path.
func (s *Server) templateFromDownload(r *http.Request, id string) (*VMTemplate, error) {
	raw, err := s.fetchJSONWithReq("/api/downloads", r)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var data struct {
		Tasks []struct {
			ID       string `json:"id"`
			Filename string `json:"filename"`
			Dir      string `json:"dest_dir"`
			Status   string `json:"status"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(encoded, &data); err != nil {
		return nil, err
	}
	for _, task := range data.Tasks {
		if task.ID != id {
			continue
		}
		if task.Status != "done" {
			return nil, fmt.Errorf("pobieranie nie zostało ukończone")
		}
		name := strings.ToLower(task.Filename)
		if !strings.HasSuffix(name, ".qcow2") && !strings.HasSuffix(name, ".qcow2.zip") {
			return nil, fmt.Errorf("wybierz plik QCOW2 lub QCOW2.ZIP")
		}
		if filepath.Base(task.Filename) != task.Filename || !filepath.IsAbs(task.Dir) {
			return nil, fmt.Errorf("nieprawidłowa ścieżka pobranego pliku")
		}
		path := filepath.Join(task.Dir, task.Filename)
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("obraz nie jest zwykłym plikiem")
		}
		return &VMTemplate{ID: "download-" + safeVMName(id), Name: task.Filename, LocalPath: path, Format: normalizeTemplateFormat("qcow2", name), MinCPU: 1, MinRAM: 512, MinDisk: 1}, nil
	}
	return nil, fmt.Errorf("nie znaleziono ukończonego zadania Download Center")
}

func copyTemplateImage(source, destination string, progress func(int64, int64)) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	if info.Size() == 0 {
		return fmt.Errorf("obraz źródłowy jest pusty")
	}
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()
	buf := make([]byte, 4*1024*1024)
	var done int64
	last := time.Now()
	for {
		n, readErr := in.Read(buf)
		if n > 0 {
			written, writeErr := out.Write(buf[:n])
			done += int64(written)
			if writeErr != nil {
				return writeErr
			}
			if written != n {
				return io.ErrShortWrite
			}
			if progress != nil && time.Since(last) > time.Second {
				progress(done, info.Size())
				last = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if done != info.Size() {
		return fmt.Errorf("rozmiar pliku zmienił się podczas kopiowania")
	}
	if progress != nil {
		progress(done, info.Size())
	}
	return out.Sync()
}

var templateCommands = make(chan struct{}, 2)

func templateExec(name string, args ...string) (string, error) {
	select {
	case templateCommands <- struct{}{}:
	case <-time.After(5 * time.Second):
		return "", fmt.Errorf("kolejka poleceń KVM jest zajęta; ponów za chwilę")
	}
	defer func() { <-templateCommands }()
	limit := 30 * time.Second
	if name == "virsh" {
		limit = 5 * time.Second
	}
	if name == "virt-install" {
		limit = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if ctx.Err() != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("%s: przekroczono limit %s", name, limit)
	}
	return strings.TrimSpace(string(out)), err
}

func templateCommandError(command, output string, err error) error {
	message := strings.TrimSpace(output)
	if message == "" && err != nil {
		message = err.Error()
	}
	if message == "" {
		message = "polecenie nie zwróciło szczegółów"
	}
	return fmt.Errorf("%s: %s", command, message)
}

func templatePreflight(network string) error {
	for _, tool := range []string{"qemu-img", "virsh", "virt-install", "genisoimage"} {
		if _, err := exec.LookPath(tool); err != nil {
			return fmt.Errorf("Brak %s. Zainstaluj pakiety KVM (qemu-utils, virtinst, genisoimage) przed pobraniem obrazu.", tool)
		}
	}
	if out, err := templateExec("virsh", "uri"); err != nil {
		return templateCommandError("Połączenie z libvirt", out, err)
	}
	if out, err := templateExec("virsh", "net-info", network); err != nil {
		return templateCommandError("Sieć "+network, out, err)
	}
	return nil
}

// Some download links omit .zip; inspect bytes instead of trusting the suffix.
func templateIsZIP(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	var magic [4]byte
	if _, err := io.ReadFull(f, magic[:]); err != nil {
		return false, fmt.Errorf("pobrany plik jest pusty lub niekompletny: %w", err)
	}
	return magic == [4]byte{'P', 'K', 3, 4}, nil
}

func setTemplateJob(j *templateJob, status, step string, progress int, err error) {
	templateJobs.Lock()
	defer templateJobs.Unlock()
	j.Status = status
	j.Step = step
	j.Progress = progress
	if err != nil {
		j.Error = err.Error()
	} else {
		j.Error = ""
	}
}

func lockTemplateBase(id string) func() {
	templateBaseLocks.Lock()
	lock := templateBaseLocks.M[id]
	if lock == nil {
		lock = &sync.Mutex{}
		templateBaseLocks.M[id] = lock
	}
	templateBaseLocks.Unlock()
	lock.Lock()
	return lock.Unlock
}

func humanTemplateBytes(size int64) string {
	const unit = int64(1024)
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := unit, 0
	for n := size / unit; n >= unit && exp < 4; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(size)/float64(div), "KMGTPE"[exp])
}

func partialContentRangeStart(value string) (int64, bool) {
	var start, end, total int64
	if _, err := fmt.Sscanf(value, "bytes %d-%d/%d", &start, &end, &total); err != nil || start < 0 || end < start || total <= end {
		return 0, false
	}
	return start, true
}

func unsatisfiedContentRangeSize(value string) (int64, bool) {
	var total int64
	if _, err := fmt.Sscanf(value, "bytes */%d", &total); err != nil || total < 0 {
		return 0, false
	}
	return total, true
}

func downloadTemplateFile(ctx context.Context, imageURL, destination string, progress func(done, total int64)) error {
	existingSize := int64(0)
	if stat, err := os.Stat(destination); err == nil {
		existingSize = stat.Size()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return err
	}
	if existingSize > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", existingSize))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable && existingSize > 0 {
		if total, ok := unsatisfiedContentRangeSize(resp.Header.Get("Content-Range")); ok && total == existingSize {
			if progress != nil {
				progress(existingSize, existingSize)
			}
			return nil
		}
		return fmt.Errorf("serwer odrzucił wznowienie pobierania (lokalnie %s)", humanTemplateBytes(existingSize))
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("serwer obrazu zwrócił HTTP %d", resp.StatusCode)
	}
	appendDownload := existingSize > 0 && resp.StatusCode == http.StatusPartialContent
	if appendDownload {
		start, ok := partialContentRangeStart(resp.Header.Get("Content-Range"))
		if !ok || start != existingSize {
			return fmt.Errorf("serwer zwrócił nieprawidłowy zakres przy wznowieniu pobierania")
		}
	}
	if !appendDownload {
		existingSize = 0
	}

	flags := os.O_CREATE | os.O_WRONLY
	if appendDownload {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}
	out, err := os.OpenFile(destination, flags, 0644)
	if err != nil {
		return err
	}
	defer out.Close()

	total := int64(-1)
	if resp.ContentLength >= 0 {
		total = existingSize + resp.ContentLength
	}
	done := existingSize
	if progress != nil {
		progress(done, total)
	}
	buffer := make([]byte, 4*1024*1024)
	lastUpdate := time.Now()
	lastPercent := -1
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			written, writeErr := out.Write(buffer[:n])
			done += int64(written)
			if writeErr != nil {
				return writeErr
			}
			if written != n {
				return io.ErrShortWrite
			}
			percent := -1
			if total > 0 {
				percent = int(done * 100 / total)
			}
			if progress != nil && (percent != lastPercent || time.Since(lastUpdate) >= time.Second) {
				progress(done, total)
				lastPercent = percent
				lastUpdate = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if total > 0 && done != total {
		return fmt.Errorf("pobrano %s z %s", humanTemplateBytes(done), humanTemplateBytes(total))
	}
	if err := out.Sync(); err != nil {
		return err
	}
	if progress != nil {
		progress(done, total)
	}
	return nil
}

func extractQCOW2FromZIP(archivePath, destination string, progress func(done, total uint64)) error {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("nieprawidłowe archiwum ZIP: %w", err)
	}
	defer archive.Close()

	var image *zip.File
	for _, entry := range archive.File {
		if entry.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name), ".qcow2") {
			continue
		}
		if image == nil || entry.UncompressedSize64 > image.UncompressedSize64 {
			image = entry
		}
	}
	if image == nil {
		return fmt.Errorf("archiwum ZIP nie zawiera pliku .qcow2")
	}
	if image.UncompressedSize64 == 0 || image.UncompressedSize64 > 4*1024*1024*1024*1024 {
		return fmt.Errorf("nieprawidłowy rozmiar obrazu QCOW2 w archiwum")
	}

	reader, err := image.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		_ = out.Close()
		if !ok {
			_ = os.Remove(destination)
		}
	}()

	buffer := make([]byte, 4*1024*1024)
	var done uint64
	lastPercent := -1
	for {
		n, readErr := reader.Read(buffer)
		if n > 0 {
			written, writeErr := out.Write(buffer[:n])
			done += uint64(written)
			if writeErr != nil {
				return writeErr
			}
			if written != n {
				return io.ErrShortWrite
			}
			percent := int(done * 100 / image.UncompressedSize64)
			if progress != nil && percent != lastPercent {
				progress(done, image.UncompressedSize64)
				lastPercent = percent
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if done != image.UncompressedSize64 {
		return fmt.Errorf("rozpakowano %s z %s", humanTemplateBytes(int64(done)), humanTemplateBytes(int64(image.UncompressedSize64)))
	}
	if err := out.Sync(); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	ok = true
	if progress != nil {
		progress(done, image.UncompressedSize64)
	}
	return nil
}

func inspectQCOW2(path string) (int64, error) {
	out, err := templateExec("qemu-img", "info", "--output=json", path)
	if err != nil {
		if out == "" {
			out = err.Error()
		}
		return 0, fmt.Errorf("qemu-img nie rozpoznał obrazu: %s", out)
	}
	var info struct {
		Format      string `json:"format"`
		VirtualSize int64  `json:"virtual-size"`
	}
	if err := json.Unmarshal([]byte(out), &info); err != nil {
		return 0, fmt.Errorf("nie można odczytać informacji o obrazie: %w", err)
	}
	if info.Format != "qcow2" {
		return 0, fmt.Errorf("pobrany plik ma format %q zamiast qcow2", info.Format)
	}
	if info.VirtualSize <= 0 {
		return 0, fmt.Errorf("obraz QCOW2 nie zgłasza poprawnego rozmiaru wirtualnego")
	}
	return info.VirtualSize, nil
}

func validateQCOW2(path string) error {
	_, err := inspectQCOW2(path)
	return err
}

func currentTemplateJobProgress(j *templateJob) int {
	templateJobs.RLock()
	defer templateJobs.RUnlock()
	return j.Progress
}

func ensureTemplateBase(j *templateJob, t VMTemplate, base string) error {
	unlock := lockTemplateBase(t.ID)
	defer unlock()

	if _, err := os.Stat(base); err == nil {
		validationErr := validateQCOW2(base)
		if validationErr == nil {
			setTemplateJob(j, "running", "Obraz bazowy jest już pobrany", 52, nil)
			return nil
		}
		return fmt.Errorf("nie można sprawdzić istniejącego obrazu bazowego %s. Zachowano go bez zmian, ponieważ mogą korzystać z niego inne VM: %w", base, validationErr)
	}

	imagePart := base + ".part"
	if _, err := os.Stat(imagePart); err == nil {
		setTemplateJob(j, "running", "Ponowne sprawdzanie zachowanego obrazu", 49, nil)
		if err := validateQCOW2(imagePart); err == nil {
			return os.Rename(imagePart, base)
		}
		// Preserve the bytes for diagnosis while allowing a clean download on retry.
		if err := os.Rename(imagePart, imagePart+".invalid-"+strconv.FormatInt(time.Now().UnixNano(), 10)); err != nil {
			return err
		}
	}
	format := normalizeTemplateFormat(t.Format, t.URL)
	downloadPath := base + ".download.part"
	if format == "qcow2.zip" {
		downloadPath = base + ".zip.part"
	}
	downloadProgress := func(done, total int64) {
		percent := 15
		step := "Pobieranie obrazu: " + humanTemplateBytes(done)
		if total > 0 {
			percent += int(float64(done) / float64(total) * 20)
			step += " / " + humanTemplateBytes(total)
		}
		setTemplateJob(j, "running", step, percent, nil)
	}
	setTemplateJob(j, "running", "Łączenie z serwerem obrazu", 12, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Hour)
	defer cancel()
	if t.LocalPath != "" {
		setTemplateJob(j, "running", "Kopiowanie obrazu z Download Center", 15, nil)
		if err := copyTemplateImage(t.LocalPath, downloadPath, func(done, total int64) {
			setTemplateJob(j, "running", "Kopiowanie: "+humanTemplateBytes(done)+" / "+humanTemplateBytes(total), 15+int(float64(done)/float64(total)*20), nil)
		}); err != nil {
			return err
		}
	} else if err := downloadTemplateFile(ctx, t.URL, downloadPath, downloadProgress); err != nil {
		return fmt.Errorf("pobieranie obrazu: %w (częściowy plik zachowano do wznowienia)", err)
	}

	zipContent, err := templateIsZIP(downloadPath)
	if err != nil {
		return err
	}
	if zipContent {
		format = "qcow2.zip"
	}
	if format == "qcow2.zip" {
		setTemplateJob(j, "running", "Rozpakowywanie obrazu QCOW2", 36, nil)
		err := extractQCOW2FromZIP(downloadPath, imagePart, func(done, total uint64) {
			progress := 36 + int(float64(done)/float64(total)*12)
			setTemplateJob(j, "running", "Rozpakowywanie: "+humanTemplateBytes(int64(done))+" / "+humanTemplateBytes(int64(total)), progress, nil)
		})
		if err != nil {
			if errors.Is(err, zip.ErrChecksum) || errors.Is(err, zip.ErrFormat) {
				bad := downloadPath + ".invalid-" + strconv.FormatInt(time.Now().UnixNano(), 10)
				if moveErr := os.Rename(downloadPath, bad); moveErr == nil {
					return fmt.Errorf("%w. Uszkodzone archiwum zachowano: %s; ponowienie pobierze nową kopię", err, bad)
				}
			}
			return fmt.Errorf("rozpakowanie QCOW2: %w. Archiwum zachowano: %s", err, downloadPath)
		}
	} else if err := os.Rename(downloadPath, imagePart); err != nil {
		return fmt.Errorf("przygotowanie pobranego obrazu: %w", err)
	}

	setTemplateJob(j, "running", "Sprawdzanie obrazu QCOW2", 49, nil)
	if err := validateQCOW2(imagePart); err != nil {
		return fmt.Errorf("%w. Pobrany obraz zachowano: %s", err, imagePart)
	}
	if err := os.Rename(imagePart, base); err != nil {
		return fmt.Errorf("zapisywanie obrazu bazowego: %w", err)
	}
	if format == "qcow2.zip" {
		_ = os.Remove(downloadPath)
	}
	setTemplateJob(j, "running", "Obraz bazowy gotowy", 52, nil)
	return nil
}

func deployTemplate(j *templateJob, t VMTemplate, name, network, sshKey string, cpu, ram, disk int) {
	unlockName := lockTemplateBase("vm:" + name)
	defer unlockName()
	cfg := loadKVMConfig()
	absolute, err := filepath.Abs(cfg.ImagePath)
	if err != nil {
		setTemplateJob(j, "error", "Katalog obrazów", 0, err)
		return
	}
	cfg.ImagePath = absolute
	if _, err := os.Lstat(filepath.Join(cfg.ImagePath, name+".qcow2")); err == nil {
		setTemplateJob(j, "error", "Dysk już istnieje", 0, fmt.Errorf("Nie nadpisano dysku %s. Wybierz inną nazwę maszyny.", name))
		return
	}
	if err := os.MkdirAll(cfg.ImagePath, 0755); err != nil {
		setTemplateJob(j, "error", "Tworzenie katalogu", 0, err)
		return
	}
	baseDir := filepath.Join(cfg.ImagePath, "templates")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		setTemplateJob(j, "error", "Tworzenie katalogu", 0, err)
		return
	}
	base := filepath.Join(baseDir, t.ID+".qcow2")
	templateJobs.Lock()
	j.ImagePath = base
	templateJobs.Unlock()
	target := filepath.Join(cfg.ImagePath, name+".qcow2")
	if err := ensureTemplateBase(j, t, base); err != nil {
		setTemplateJob(j, "error", "Przygotowanie obrazu bazowego", currentTemplateJobProgress(j), err)
		return
	}

	reserved, reserveErr := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if reserveErr != nil {
		setTemplateJob(j, "error", "Rezerwowanie dysku maszyny", 55, reserveErr)
		return
	}
	reserved.Close()
	setTemplateJob(j, "running", "Tworzenie dysku maszyny", 56, nil)
	if out, err := templateExec("qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", base, target); err != nil {
		_ = os.Remove(target)
		setTemplateJob(j, "error", "Tworzenie dysku", 56, templateCommandError("qemu-img", out, err))
		return
	}
	virtualSize, err := inspectQCOW2(target)
	if err != nil {
		_ = os.Remove(target)
		setTemplateJob(j, "error", "Sprawdzanie dysku maszyny", 60, err)
		return
	}
	requestedSize := int64(disk) * 1024 * 1024 * 1024
	if requestedSize > virtualSize {
		if out, err := templateExec("qemu-img", "resize", target, fmt.Sprintf("%dG", disk)); err != nil {
			_ = os.Remove(target)
			setTemplateJob(j, "error", "Powiększanie dysku", 62, templateCommandError("qemu-img", out, err))
			return
		}
	}

	setTemplateJob(j, "running", "Konfiguracja cloud-init", 70, nil)
	seed := filepath.Join(cfg.ImagePath, name+"-seed.iso")
	userData := "#cloud-config\npackage_update: true\npackages: [qemu-guest-agent]\nruncmd:\n  - systemctl enable --now qemu-guest-agent\n"
	if strings.TrimSpace(sshKey) != "" {
		userData += "ssh_authorized_keys:\n  - " + strings.TrimSpace(sshKey) + "\n"
	}
	tmp, err := os.MkdirTemp("", "nimbus-cloudinit-")
	if err != nil {
		setTemplateJob(j, "error", "Cloud-init", 70, err)
		return
	}
	defer os.RemoveAll(tmp)
	if err := os.WriteFile(filepath.Join(tmp, "user-data"), []byte(userData), 0600); err != nil {
		_ = os.Remove(target)
		setTemplateJob(j, "error", "Cloud-init", 70, err)
		return
	}
	if err := os.WriteFile(filepath.Join(tmp, "meta-data"), []byte("instance-id: "+name+"\nlocal-hostname: "+name+"\n"), 0644); err != nil {
		_ = os.Remove(target)
		setTemplateJob(j, "error", "Cloud-init", 70, err)
		return
	}
	if out, err := templateExec("genisoimage", "-output", seed, "-volid", "cidata", "-joliet", "-rock", filepath.Join(tmp, "user-data"), filepath.Join(tmp, "meta-data")); err != nil {
		_ = os.Remove(target)
		setTemplateJob(j, "error", "Cloud-init ISO", 76, templateCommandError("genisoimage", out, err))
		return
	}

	if err := os.Chmod(seed, 0644); err != nil {
		setTemplateJob(j, "error", "Uprawnienia cloud-init", 80, err)
		return
	}
	// A defined but inactive network cannot be used by virt-install.
	if out, err := templateExec("virsh", "net-start", network); err != nil {
		// net-start also fails when already active; confirm by listing active names.
		active, checkErr := templateExec("virsh", "net-list", "--name")
		found := false
		for _, n := range strings.Fields(active) {
			if n == network {
				found = true
			}
		}
		if checkErr != nil || !found {
			setTemplateJob(j, "error", "Uruchamianie sieci", 82, templateCommandError("virsh net-start", out, err))
			return
		}
	}
	setTemplateJob(j, "running", "Rejestrowanie maszyny", 86, nil)
	args := []string{"--name", name, "--memory", strconv.Itoa(ram), "--vcpus", strconv.Itoa(cpu), "--import", "--disk", "path=" + target + ",format=qcow2,bus=virtio", "--disk", "path=" + seed + ",device=cdrom", "--network", "network=" + network + ",model=virtio", "--graphics", "vnc,listen=127.0.0.1", "--noautoconsole", "--wait", "0", "--os-variant", "generic"}
	if out, err := templateExec("virt-install", args...); err != nil {
		setTemplateJob(j, "error", "Rejestrowanie VM", 86, fmt.Errorf("%w. Sprawdź listę VM przed ponowieniem; zachowano dysk: %s", templateCommandError("virt-install", out, err), target))
		return
	}
	if out, err := templateExec("virsh", "dominfo", name); err != nil {
		setTemplateJob(j, "error", "Weryfikacja rejestracji VM", 95, templateCommandError("virsh dominfo", out, err))
		return
	}
	setTemplateJob(j, "done", "System gotowy", 100, nil)
}
