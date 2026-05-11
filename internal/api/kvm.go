package api

// kvm.go — KVM/QEMU/libvirt API
// Wymaga: libvirt-clients (virsh), qemu-kvm

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Konfiguracja kvm.json ─────────────────────────────────────────────────────

type KVMConfig struct {
	ISOPaths    []string `json:"iso_paths"`    // katalogi do szukania ISO
	ImagePath   string   `json:"image_path"`   // gdzie tworzyć dyski VM
	NoVNCPath   string   `json:"novnc_path"`   // ścieżka instalacji noVNC
	NoVNCPort   int      `json:"novnc_port"`   // port websockify (domyślnie 6080)
}

const kvmConfigPath = "/etc/nimbus/kvm.json"

func loadKVMConfig() KVMConfig {
	cfg := KVMConfig{
		ISOPaths:  []string{"/var/lib/libvirt/boot", "/var/lib/libvirt/images"},
		ImagePath: "/var/lib/libvirt/images",
		NoVNCPort: 6080,
	}
	data, err := os.ReadFile(kvmConfigPath)
	if err != nil { return cfg }
	json.Unmarshal(data, &cfg)
	if len(cfg.ISOPaths) == 0 {
		cfg.ISOPaths = []string{"/var/lib/libvirt/boot", "/var/lib/libvirt/images"}
	}
	if cfg.ImagePath == "" { cfg.ImagePath = "/var/lib/libvirt/images" }
	if cfg.NoVNCPort == 0  { cfg.NoVNCPort = 6080 }
	return cfg
}

func saveKVMConfig(cfg KVMConfig) error {
	os.MkdirAll(filepath.Dir(kvmConfigPath), 0755)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil { return err }
	return os.WriteFile(kvmConfigPath, data, 0644)
}

// ── Struktury ─────────────────────────────────────────────────────────────────

type VMInfo struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	State    string  `json:"state"`    // running|stopped|paused
	OS       string  `json:"os"
	"os/exec"`       // linux|windows|bsd|other
	Icon     string  `json:"icon"`
	CPU      int     `json:"cpu"`
	CPUUsed  float64 `json:"cpuUsed"`
	RAM      int     `json:"ram"`      // MB
	RAMUsed  int     `json:"ramUsed"`  // MB
	Disk     string  `json:"disk"`
	DiskUsed int     `json:"diskUsed"` // GB
	IP       string  `json:"ip"`
	VNC      string  `json:"vnc"`
	Uptime   string  `json:"uptime"`
	Snapshot int     `json:"snapshot"`
	Boot     string  `json:"boot"`
}

type VMSnapshot struct {
	Name string `json:"name"`
	Date string `json:"date"`
	Size string `json:"size"`
	Desc string `json:"desc"`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func kvmInstalled() bool {
	_, err := runCmd("which", "virsh")
	return err == nil
}

type CPUVirtInfo struct {
	Supported bool   `json:"supported"` // czy CPU obsługuje wirtualizację
	Type      string `json:"type"`      // "vmx" (Intel VT-x) lub "amd-v" (AMD-V)
	KVMModule bool   `json:"kvm_module"` // czy moduł kvm jest załadowany
}

func cpuVirtInfo() CPUVirtInfo {
	info := CPUVirtInfo{}
	// Sprawdź flagi CPU
	cpuFlags, _ := os.ReadFile("/proc/cpuinfo")
	flags := strings.ToLower(string(cpuFlags))
	if strings.Contains(flags, " vmx") {
		info.Supported = true
		info.Type = "Intel VT-x"
	} else if strings.Contains(flags, " svm") {
		info.Supported = true
		info.Type = "AMD-V"
	}
	// Sprawdź czy moduł kvm jest załadowany
	modules, _ := os.ReadFile("/proc/modules")
	info.KVMModule = strings.Contains(string(modules), "kvm_")
	return info
}

func osGuess(name string) (string, string) {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "win"):
		return "windows", "🪟"
	case strings.Contains(lower, "ubuntu"), strings.Contains(lower, "debian"),
		strings.Contains(lower, "centos"), strings.Contains(lower, "fedora"),
		strings.Contains(lower, "arch"), strings.Contains(lower, "linux"):
		return "linux", "🐧"
	case strings.Contains(lower, "pfsense"), strings.Contains(lower, "freebsd"),
		strings.Contains(lower, "openbsd"), strings.Contains(lower, "bsd"):
		return "bsd", "🔥"
	case strings.Contains(lower, "macos"), strings.Contains(lower, "osx"):
		return "macos", "🍎"
	default:
		return "linux", "💻"
	}
}

func parseStateStr(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch {
	case strings.Contains(s, "running"):
		return "running"
	case strings.Contains(s, "paused"), strings.Contains(s, "pmsuspended"):
		return "paused"
	case strings.Contains(s, "in shutdown"), strings.Contains(s, "shutdown"):
		return "shutting_down"
	case strings.Contains(s, "shut off"), strings.Contains(s, "crashed"),
		strings.Contains(s, "dying"), strings.Contains(s, "no state"):
		return "stopped"
	}
	return "stopped"
}

// vmStateAccurate odpytuje virsh domstate + weryfikuje przez QEMU process
func vmStateAccurate(name string) string {
	out, err := runCmd("virsh", "domstate", name)
	if err != nil {
		// virsh nie działa w ogóle — sprawdź czy proces żyje
		ps, _ := runCmd("bash", "-c", "pgrep -af qemu-system | grep -F ' guest="+name+",' | grep -v grep")
		if strings.TrimSpace(ps) != "" { return "running" }
		return "stopped"
	}
	state := parseStateStr(out)

	// Jeśli libvirt mówi stopped ale QEMU żyje — libvirt zgubił VM (np. po restarcie instalatora)
	// Sprawdź przez QEMU process z DOKŁADNĄ nazwą domeny (nie substring)
	if state == "stopped" {
		ps, _ := runCmd("bash", "-c", "pgrep -af qemu-system | grep -F ' guest="+name+",' | grep -v grep")
		if strings.TrimSpace(ps) != "" {
			return "running"
		}
	}
	return state
}

// vmStateAccurateAfterStop — jak vmStateAccurate ale NIE używa pgrep fallback
// Używaj po virsh shutdown żeby nie mylić graceful shutdown z running
func vmStateAccurateAfterStop(name string) string {
	out, err := runCmd("virsh", "domstate", name)
	if err != nil { return "stopped" }
	return parseStateStr(out)
}

func parseVirshList(out string) []VMInfo {
	var vms []VMInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Id") || strings.HasPrefix(line, "--") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 { continue }

		name := fields[1]
		os_, icon := osGuess(name)
		vms = append(vms, VMInfo{
			ID:   name,
			Name: name,
			// Stan zostanie nadpisany przez vmStateAccurate w enrichVM
			State: parseStateStr(strings.Join(fields[2:], " ")),
			OS:   os_,
			Icon: icon,
			Boot: "hd",
		})
	}
	return vms
}

func enrichVM(vm *VMInfo) {
	// Najpierw zweryfikuj stan — virsh list bywa nieprecyzyjny podczas instalacji
	vm.State = vmStateAccurate(vm.ID)

	// CPU count z konfiguracji — zawsze dostępne
	cpuOut, _ := runCmd("virsh", "vcpucount", vm.ID, "--maximum", "--config")
	if n, err := strconv.Atoi(strings.TrimSpace(cpuOut)); err == nil {
		vm.CPU = n
	}
	if vm.CPU == 0 { vm.CPU = 1 }

	// RAM z XML konfiguracji — zawsze dostępne, niezależnie od stanu VM
	xmlOutMem, _ := runCmd("virsh", "dumpxml", vm.ID)
	reRAM := regexp.MustCompile(`<memory unit='KiB'>(\d+)</memory>`)
	if m := reRAM.FindStringSubmatch(xmlOutMem); m != nil {
		if v, err := strconv.ParseInt(m[1], 10, 64); err == nil {
			vm.RAM = int(v / 1024)
		}
	}

	// Live stats tylko dla działających VM
	if vm.State == "running" {
		memOut, _ := runCmd("virsh", "dommemstat", vm.ID)
		for _, line := range strings.Split(memOut, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 { continue }
			if fields[0] == "rss" {
				if v, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
					vm.RAMUsed = int(v / 1024)
				}
			}
		}
		cpuStatOut, _ := runCmd("virsh", "cpu-stats", vm.ID, "--total")
		reCPU := regexp.MustCompile(`cpu_time\s+([\d.]+)`)
		if m := reCPU.FindStringSubmatch(cpuStatOut); m != nil {
			if v, err := strconv.ParseFloat(m[1], 64); err == nil {
				vm.CPUUsed = v
			}
		}
	} else {
		// Zatrzymana / pauza — zeruj live stats
		vm.CPUUsed = 0
		vm.RAMUsed = 0
	}

	// IP z dominfo lub domifaddr
	if vm.State == "running" {
		ipOut, _ := runCmd("virsh", "domifaddr", vm.ID)
		reIP := regexp.MustCompile(`(\d+\.\d+\.\d+\.\d+)`)
		if m := reIP.FindStringSubmatch(ipOut); m != nil {
			vm.IP = m[1]
		}
		if vm.IP == "" { vm.IP = "—" }
	} else {
		vm.IP = "—"
	}

	// Uptime
	if vm.State == "running" {
		uptimeOut, _ := runCmd("virsh", "dominfo", vm.ID)
		for _, line := range strings.Split(uptimeOut, "\n") {
			if strings.Contains(line, "CPU time") {
				vm.Uptime = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
				break
			}
		}
	}
	if vm.Uptime == "" { vm.Uptime = "—" }

	// Snapshots count
	snapOut, _ := runCmd("virsh", "snapshot-list", vm.ID, "--name")
	count := 0
	for _, l := range strings.Split(snapOut, "\n") {
		if strings.TrimSpace(l) != "" { count++ }
	}
	vm.Snapshot = count

	// Dysk — pobierz z XML
	xmlOut, _ := runCmd("virsh", "dumpxml", vm.ID)
	reDisk := regexp.MustCompile(`<source file='([^']+)'`)
	if m := reDisk.FindStringSubmatch(xmlOut); m != nil {
		// Rozmiar pliku dysku
		if fi, err := os.Stat(m[1]); err == nil {
			vm.DiskUsed = int(fi.Size() / 1024 / 1024 / 1024)
			// Wirtualny rozmiar dysku
			infoOut, _ := runCmd("qemu-img", "info", "--output=json", m[1])
			var imgInfo struct{ VirtualSize int64 `json:"virtual-size"` }
			if err := json.Unmarshal([]byte(infoOut), &imgInfo); err == nil {
				vm.Disk = fmt.Sprintf("%d GB", imgInfo.VirtualSize/1024/1024/1024)
			}
		}
	}
	if vm.Disk == "" { vm.Disk = "—" }

	// VNC port
	vncOut, _ := runCmd("virsh", "vncdisplay", vm.ID)
	if strings.Contains(vncOut, ":") {
		parts := strings.Split(strings.TrimSpace(vncOut), ":")
		if len(parts) >= 2 {
			if port, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
				vm.VNC = strconv.Itoa(5900 + port)
			}
		}
	}
	if vm.VNC == "" { vm.VNC = "—" }
}

// ── VNC proxy registry — per-VM websockify ports ─────────────────────────────
var (
	vncProxyMu   sync.Mutex
	vncProxyMap  = map[string]int{} // vmName → wsPort
)

// findFreePort szuka wolnego portu TCP startując od basePort
func findFreePort(basePort int) int {
	for p := basePort; p < basePort+100; p++ {
		out, _ := runCmd("bash", "-c", fmt.Sprintf("ss -tln | grep ':%d '", p))
		if strings.TrimSpace(out) == "" {
			return p
		}
	}
	return basePort
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleKVMStatus(w http.ResponseWriter, r *http.Request) {
	installed := kvmInstalled()
	cfg := loadKVMConfig()

	// Sprawdź czy noVNC jest zainstalowane
	noVNCInstalled := false
	noVNCPaths := []string{cfg.NoVNCPath, "/usr/share/novnc", "/opt/novnc"}
	for _, p := range noVNCPaths {
		if p == "" { continue }
		if _, err := os.Stat(p); err == nil { noVNCInstalled = true; break }
	}
	// Sprawdź websockify
	_, wsErr := runCmd("which", "websockify")
	websockifyInstalled := wsErr == nil

	jsonOK(w, map[string]any{
		"installed":            installed,
		"running":              installed && func() bool { _, e := runCmd("systemctl", "is-active", "libvirtd"); return e == nil }(),
		"cpu_virt":             cpuVirtInfo(),
		"novnc_installed":      noVNCInstalled && websockifyInstalled,
		"novnc_port":           cfg.NoVNCPort,
		"image_path":           cfg.ImagePath,
	})
}

func (s *Server) handleKVMList(w http.ResponseWriter, r *http.Request) {
	if !kvmInstalled() {
		jsonOK(w, map[string]any{"vms": []any{}, "installed": false})
		return
	}

	// Pobierz uruchomione VM
	out, _ := runCmd("virsh", "list", "--all")
	vms := parseVirshList(out)

	// Wzbogać dane (równolegle byłoby szybciej, ale dla prostoty sekwencyjnie)
	for i := range vms {
		enrichVM(&vms[i])
	}

	if vms == nil { vms = []VMInfo{} }
	jsonOK(w, map[string]any{"vms": vms, "installed": true})
}

func (s *Server) handleKVMAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		VM     string `json:"vm"`
		Action string `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.VM == "" || req.Action == "" {
		jsonErr(w, "vm i action są wymagane", http.StatusBadRequest)
		return
	}

	allowed := map[string][]string{
		"start":   {"virsh", "start", req.VM},
		"stop":    {"virsh", "shutdown", req.VM},
		"force-stop": {"virsh", "destroy", req.VM},
		"pause":   {"virsh", "suspend", req.VM},
		"resume":  {"virsh", "resume", req.VM},
		"restart": {"virsh", "reboot", req.VM},
		"delete":  {"virsh", "undefine", req.VM},  // dyski usuwamy osobno przez handleKVMDelete
	}

	cmd, ok := allowed[req.Action]
	if !ok {
		jsonErr(w, "unknown action: "+req.Action, http.StatusBadRequest)
		return
	}

	out, err := runCmd(cmd[0], cmd[1:]...)
	if err != nil {
		// Jeśli VM jest już w żądanym stanie — nie traktuj jako błąd
		outLower := strings.ToLower(out)
		if req.Action == "start" && (strings.Contains(outLower, "już aktywna") ||
			strings.Contains(outLower, "already active") || strings.Contains(outLower, "already running")) {
			currentState := vmStateAccurate(req.VM)
			jsonOK(w, map[string]any{"status": "ok", "confirmed_state": currentState, "note": "already_active"})
			return
		}
		if (req.Action == "stop" || req.Action == "force-stop") && (strings.Contains(outLower, "not running") ||
			strings.Contains(outLower, "nie jest uruchomiona") || strings.Contains(outLower, "domain is not running")) {
			jsonOK(w, map[string]any{"status": "ok", "confirmed_state": "stopped", "note": "already_stopped"})
			return
		}
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}

	// Dla start/stop poczekaj aż libvirt potwierdzi zmianę stanu (max 6s)
	confirmedState := ""
	if req.Action == "start" || req.Action == "resume" {
		for i := 0; i < 12; i++ {
			time.Sleep(500 * time.Millisecond)
			if s := vmStateAccurate(req.VM); s == "running" {
				confirmedState = "running"
				break
			}
		}
		if confirmedState == "" { confirmedState = "running" } // zakładamy sukces
	} else if req.Action == "stop" {
		// Graceful shutdown — może trwać długo (gość musi się zamknąć)
		// Zwróć "shutting_down" — front będzie pollował aż libvirt potwierdzi stopped
		confirmedState = "shutting_down"
	} else if req.Action == "force-stop" {
		// Force stop (destroy) — natychmiastowe, czekamy na potwierdzenie
		// Używamy AfterStop żeby pgrep nie dawał false positive
		for i := 0; i < 10; i++ {
			time.Sleep(300 * time.Millisecond)
			if s := vmStateAccurateAfterStop(req.VM); s == "stopped" {
				confirmedState = "stopped"
				break
			}
		}
		if confirmedState == "" { confirmedState = "stopped" }
	} else if req.Action == "pause" {
		confirmedState = "paused"
	}

	jsonOK(w, map[string]any{"status": "ok", "output": out, "confirmed_state": confirmedState})
}

func (s *Server) handleKVMCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
		OS   string `json:"os"
	"os/exec"`
		CPU  int    `json:"cpu"`
		RAM  int    `json:"ram"`  // MB
		Disk int    `json:"disk"` // GB
		Net  string `json:"net"`
		ISO  string `json:"iso"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.Name == "" {
		jsonErr(w, "name jest wymagane", http.StatusBadRequest)
		return
	}
	// Sanityzuj nazwę — virsh/virt-install nie akceptuje spacji ani znaków specjalnych
	req.Name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, req.Name)
	req.Name = strings.Trim(req.Name, "-")
	if req.Name == "" {
		jsonErr(w, "Nieprawidłowa nazwa VM — użyj liter, cyfr, myślnika lub podkreślenia", http.StatusBadRequest)
		return
	}
	if req.CPU == 0  { req.CPU = 2 }
	if req.RAM == 0  { req.RAM = 2048 }
	if req.Disk == 0 { req.Disk = 32 }
	if req.Net == "" { req.Net = "default" }

	cfg := loadKVMConfig()
	// Utwórz dysk w ścieżce z konfiguracji
	diskPath := fmt.Sprintf("%s/%s.qcow2", strings.TrimRight(cfg.ImagePath, "/"), req.Name)
	out, err := runCmd("qemu-img", "create", "-f", "qcow2", diskPath,
		fmt.Sprintf("%dG", req.Disk))
	if err != nil {
		jsonErr(w, "qemu-img: "+out, http.StatusInternalServerError)
		return
	}

	// Upewnij się że sieć jest aktywna
	netActive, _ := runCmd("virsh", "net-info", req.Net)
	if !strings.Contains(netActive, "Active:          yes") {
		runCmd("virsh", "net-start", req.Net)
		runCmd("virsh", "net-autostart", req.Net)
	}

	// virt-install
	args := []string{
		"--name", req.Name,
		"--memory", strconv.Itoa(req.RAM),
		"--vcpus", strconv.Itoa(req.CPU),
		"--disk", diskPath + ",format=qcow2",
		"--network", "network=" + req.Net,
		"--graphics", "vnc",
		"--noautoconsole",
		"--os-variant", func() string {
			switch req.OS {
			case "windows": return "win10"
			case "bsd":     return "freebsd13.0"
			default:        return "ubuntu22.04"
			}
		}(),
	}
	if req.ISO != "" {
		args = append(args, "--cdrom", req.ISO)
	} else {
		args = append(args, "--import")
	}

	out, err = runCmd("virt-install", args...)
	if err != nil {
		jsonErr(w, "virt-install: "+out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"status": "ok", "output": out, "name": req.Name})
}

func (s *Server) handleKVMDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		VM          string `json:"vm"`
		RemoveDisks bool   `json:"remove_disks"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.VM == "" {
		jsonErr(w, "vm required", http.StatusBadRequest)
		return
	}

	// Pobierz listę dysków z XML ZANIM usuniemy definicję (potem XML zniknie)
	// Parsujemy XML żeby odróżnić dyski od CD-ROM — nie usuwamy ISO!
	var diskPaths []string
	xmlOut, _ := runCmd("virsh", "dumpxml", req.VM)
	// Szukamy bloków <disk type='file' device='disk'> — NIE device='cdrom'
	reDiskBlock := regexp.MustCompile(`(?s)<disk[^>]+device='disk'[^>]*>.*?</disk>`)
	reSource    := regexp.MustCompile(`<source file='([^']+)'`)
	for _, block := range reDiskBlock.FindAllString(xmlOut, -1) {
		if m := reSource.FindStringSubmatch(block); m != nil {
			// Tylko pliki obrazów dysków (nie ISO)
			p := m[1]
			ext := strings.ToLower(p)
			if strings.HasSuffix(ext, ".qcow2") || strings.HasSuffix(ext, ".raw") ||
				strings.HasSuffix(ext, ".img") || strings.HasSuffix(ext, ".vmdk") {
				diskPaths = append(diskPaths, p)
			}
		}
	}

	// Pobierz info o VM
	domInfoOut, _ := runCmd("virsh", "dominfo", req.VM)
	persistent    := strings.Contains(domInfoOut, "Persistent:      yes") ||
		strings.Contains(domInfoOut, "Trwałe:") && strings.Contains(domInfoOut, "tak") ||
		strings.Contains(domInfoOut, "Persistent:") && !strings.Contains(domInfoOut, "no")
	currentState  := vmStateAccurateAfterStop(req.VM)

	// Zatrzymaj VM tylko jeśli aktualnie działa
	if currentState == "running" || currentState == "shutting_down" || currentState == "paused" {
		runCmd("virsh", "destroy", req.VM)
		time.Sleep(800 * time.Millisecond)
	}

	// Usuń definicję
	var undefineOut string
	var undefineErr error
	if persistent {
		undefineOut, undefineErr = runCmd("virsh", "undefine", req.VM, "--nvram")
		if undefineErr != nil {
			undefineOut, undefineErr = runCmd("virsh", "undefine", req.VM)
		}
	} else {
		// Transient — destroy już usunął, undefine nie jest potrzebne
		undefineOut = "transient-skipped"
	}

	// Usuń dyski jeśli requested
	removed := []string{}
	failed  := []string{}
	if req.RemoveDisks {
		for _, path := range diskPaths {
			err := os.Remove(path)
			if err == nil || os.IsNotExist(err) {
				removed = append(removed, path)
			} else {
				failed = append(failed, path+": "+err.Error())
			}
		}
	}

	// Finalna weryfikacja
	time.Sleep(400 * time.Millisecond)
	finalCheck, _ := runCmd("virsh", "list", "--all", "--name")
	stillThere := false
	for _, n := range strings.Split(finalCheck, "\n") {
		if strings.TrimSpace(n) == req.VM {
			stillThere = true
			break
		}
	}

	if stillThere {
		// Zwróć diagnostykę zamiast generycznego błędu
		domInfo2, _ := runCmd("virsh", "dominfo", req.VM)
		jsonErr(w, fmt.Sprintf(
			"VM nadal widoczna. undefine_out=%q persistent=%v state=%q dominfo=%q",
			strings.TrimSpace(undefineOut), persistent, currentState, strings.TrimSpace(domInfo2),
		), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"status":        "ok",
		"disks_removed": removed,
		"disks_failed":  failed,
		"disk_paths":    diskPaths,
	})
}

func (s *Server) handleKVMSnapshots(w http.ResponseWriter, r *http.Request) {
	vm := r.URL.Query().Get("vm")
	if vm == "" {
		jsonErr(w, "vm required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("virsh", "snapshot-list", vm, "--name")
		var snaps []VMSnapshot
		for _, name := range strings.Split(out, "\n") {
			name = strings.TrimSpace(name)
			if name == "" { continue }
			// Szczegóły snapshota
			infoOut, _ := runCmd("virsh", "snapshot-dumpxml", vm, name)
			date := ""
			reDate := regexp.MustCompile(`<creationTime>(\d+)</creationTime>`)
			if m := reDate.FindStringSubmatch(infoOut); m != nil {
				ts, _ := strconv.ParseInt(m[1], 10, 64)
				if ts > 0 {
					date = fmt.Sprintf("%d", ts)
				}
			}
			snaps = append(snaps, VMSnapshot{Name: name, Date: date, Size: "—"})
		}
		if snaps == nil { snaps = []VMSnapshot{} }
		jsonOK(w, map[string]any{"snapshots": snaps})

	case http.MethodPost:
		var req struct {
			Name string `json:"name"`
			Desc string `json:"desc"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Name == "" {
			req.Name = fmt.Sprintf("snap-%d", len(vm))
		}
		args := []string{"snapshot-create-as", vm, req.Name}
		if req.Desc != "" { args = append(args, "--description", req.Desc) }
		out, err := runCmd("virsh", args...)
		if err != nil { jsonErr(w, out, http.StatusInternalServerError); return }
		jsonOK(w, map[string]any{"status": "ok", "output": out})

	case http.MethodDelete:
		snapName := r.URL.Query().Get("snap")
		if snapName == "" { jsonErr(w, "snap required", http.StatusBadRequest); return }
		out, err := runCmd("virsh", "snapshot-delete", vm, snapName)
		if err != nil { jsonErr(w, out, http.StatusInternalServerError); return }
		jsonOK(w, map[string]any{"status": "ok"})
	}
}

// handleKVMVNCProxy uruchamia websockify dla podanej VM i zwraca URL noVNC
func (s *Server) handleKVMVNCProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		VM string `json:"vm"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.VM == "" {
		jsonErr(w, "vm required", http.StatusBadRequest)
		return
	}

	// Pobierz port VNC — najpierw virsh vncdisplay, fallback na XML
	vncPort := 0
	vncOut, err := runCmd("virsh", "vncdisplay", req.VM)
	if err == nil && strings.TrimSpace(vncOut) != "" {
		parts := strings.Split(strings.TrimSpace(vncOut), ":")
		display, _ := strconv.Atoi(parts[len(parts)-1])
		vncPort = 5900 + display
	}
	// Fallback: odczytaj port z XML domeny (działa też podczas instalacji)
	if vncPort == 0 {
		xmlOut, _ := runCmd("virsh", "dumpxml", req.VM)
		reVNC := regexp.MustCompile(`type='vnc'[^/]*port='(\d+)'`)
		if m := reVNC.FindStringSubmatch(xmlOut); m != nil {
			vncPort, _ = strconv.Atoi(m[1])
		}
	}
	// port=-1 w XML oznacza auto-assign przez QEMU — znajdź rzeczywisty port
	if vncPort < 0 || vncPort == 0 {
		// Szukaj przez ss — QEMU słucha na 127.0.0.1:590x
		out2, _ := runCmd("bash", "-c", "ss -tlnp | grep qemu | grep -o '127.0.0.1:[0-9]*' | grep -o '[0-9]*$' | head -1")
		if p, err := strconv.Atoi(strings.TrimSpace(out2)); err == nil && p > 0 {
			vncPort = p
		}
	}
	if vncPort <= 0 {
		jsonErr(w, "Nie można znaleźć portu VNC — sprawdź czy VM jest uruchomiona", http.StatusBadRequest)
		return
	}

	cfg := loadKVMConfig()
	basePort := cfg.NoVNCPort
	if basePort == 0 { basePort = 6080 }

	// Szukaj noVNC
	noVNCDir := cfg.NoVNCPath
	if noVNCDir == "" {
		for _, p := range []string{"/usr/share/novnc", "/opt/novnc"} {
			if _, err := os.Stat(p); err == nil { noVNCDir = p; break }
		}
	}

	// Każda VM dostaje swój port websockify
	vncProxyMu.Lock()
	wsPort, exists := vncProxyMap[req.VM]
	if !exists {
		// Przydziel nowy wolny port dla tej VM
		wsPort = findFreePort(basePort)
		vncProxyMap[req.VM] = wsPort
	}
	vncProxyMu.Unlock()

	// Sprawdź czy websockify już działa dla tego portu
	psCheck, _ := runCmd("bash", "-c", fmt.Sprintf("ss -tlnp | grep ':%d '", wsPort))
	if strings.TrimSpace(psCheck) == "" {
		// Uruchom websockify jako osobny proces (nie przez runCmd który może czekać)
		logFile := fmt.Sprintf("/tmp/websockify-%d.log", wsPort)
		var wsCmd *exec.Cmd
		if noVNCDir != "" {
			wsCmd = exec.Command("websockify",
				fmt.Sprintf("--web=%s", noVNCDir),
				strconv.Itoa(wsPort),
				fmt.Sprintf("localhost:%d", vncPort))
		} else {
			wsCmd = exec.Command("websockify",
				strconv.Itoa(wsPort),
				fmt.Sprintf("localhost:%d", vncPort))
		}
		// Przekieruj output do pliku logu
		if lf, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
			wsCmd.Stdout = lf
			wsCmd.Stderr = lf
			defer lf.Close()
		}
		wsCmd.Start() // Start() nie czeka na zakończenie — websockify żyje w tle
		// Poczekaj aż websockify faktycznie zacznie słuchać (max 3s)
		for i := 0; i < 6; i++ {
			time.Sleep(500 * time.Millisecond)
			chk, _ := runCmd("bash", "-c", fmt.Sprintf("ss -tlnp | grep ':%d '", wsPort))
			if strings.TrimSpace(chk) != "" { break }
		}
	}
	// Odczytaj log websockify dla diagnostyki
	wsLog, _ := runCmd("bash", "-c", fmt.Sprintf("tail -5 /tmp/websockify-%d.log 2>/dev/null", wsPort))

	noVNCURL := ""
	host := strings.Split(r.Host, ":")[0]
	if noVNCDir != "" {
		// Znajdź właściwy plik HTML
		novncPage := ""
		for _, candidate := range []string{"vnc.html", "vnc_lite.html", "index.html"} {
			if _, err := os.Stat(noVNCDir + "/" + candidate); err == nil {
				novncPage = candidate
				break
			}
		}
		if novncPage == "" {
			entries, _ := os.ReadDir(noVNCDir)
			for _, e := range entries {
				if !e.IsDir() && strings.HasSuffix(e.Name(), ".html") {
					novncPage = e.Name()
					break
				}
			}
		}
		// Bezpośredni URL do websockify (który sam serwuje noVNC przez --web=)
		// NIE przez /novnc/ proxy Nimbusa — websockify serwuje własne pliki
		noVNCURL = fmt.Sprintf("http://%s:%d/%s?autoconnect=true&resize=scale",
			host, wsPort, novncPage)
	}

	// Finalne sprawdzenie czy websockify słucha
	wsFinal, _ := runCmd("bash", "-c", fmt.Sprintf("ss -tlnp | grep ':%d '", wsPort))
	wsReady := strings.TrimSpace(wsFinal) != ""

	jsonOK(w, map[string]any{
		"status":       "ok",
		"vnc_port":     vncPort,
		"ws_port":      wsPort,
		"novnc_url":    noVNCURL,
		"novnc_ready":  noVNCDir != "" && wsReady,
		"ws_ready":     wsReady,
		"ws_log":       strings.TrimSpace(wsLog),
		"direct_vnc":   fmt.Sprintf("%s:%d", strings.Split(r.Host, ":")[0], vncPort),
	})
}

func (s *Server) handleKVMInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("apt-get", "install", "-y",
		"qemu-kvm", "libvirt-daemon-system", "libvirt-clients",
		"bridge-utils", "virtinst", "novnc", "websockify")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	runCmd("systemctl", "enable", "--now", "libvirtd")

	// Zapisz domyślną konfigurację jeśli nie istnieje
	if _, err := os.Stat(kvmConfigPath); os.IsNotExist(err) {
		saveKVMConfig(loadKVMConfig())
	}

	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleKVMNetworks(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("virsh", "net-list", "--all")
	type NetInfo struct {
		Name   string `json:"name"`
		Active bool   `json:"active"`
	}
	var nets []NetInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Name") || strings.HasPrefix(line, "---") { continue }
		fields := strings.Fields(line)
		if len(fields) < 2 { continue }
		nets = append(nets, NetInfo{
			Name:   fields[0],
			Active: fields[1] == "active",
		})
	}
	if nets == nil { nets = []NetInfo{{Name: "default", Active: false}} }
	jsonOK(w, map[string]any{"networks": nets})
}

func (s *Server) handleKVMISOs(w http.ResponseWriter, r *http.Request) {
	cfg := loadKVMConfig()

	type ISOEntry struct {
		Path string `json:"path"`
		Name string `json:"name"`
		Size int64  `json:"size"`
	}

	var isos []ISOEntry
	seen := map[string]bool{}

	for _, dir := range cfg.ISOPaths {
		out, _ := runCmd("find", dir, "-maxdepth", "4", "-name", "*.iso", "-type", "f")
		for _, line := range strings.Split(out, "\n") {
			path := strings.TrimSpace(line)
			if path == "" || seen[path] { continue }
			seen[path] = true
			fi, err := os.Stat(path)
			size := int64(0)
			if err == nil { size = fi.Size() }
			isos = append(isos, ISOEntry{
				Path: path,
				Name: filepath.Base(path),
				Size: size,
			})
		}
	}
	if isos == nil { isos = []ISOEntry{} }
	jsonOK(w, map[string]any{"isos": isos, "paths": cfg.ISOPaths})
}

// ── ISO Downloader ───────────────────────────────────────────────────────────

type ISODownload struct {
	ID       string  `json:"id"`
	URL      string  `json:"url"`
	Filename string  `json:"filename"`
	DestPath string  `json:"dest_path"`
	Total    int64   `json:"total"`
	Done     int64   `json:"done"`
	Pct      float64 `json:"pct"`
	Speed    string  `json:"speed"`
	Status   string  `json:"status"` // downloading|done|error
	Error    string  `json:"error,omitempty"`
}

var (
	isoDownloadsMu sync.RWMutex
	isoDownloads   = map[string]*ISODownload{}
)

func (s *Server) handleKVMISODownload(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Zwróć listę aktywnych/zakończonych pobrań
		isoDownloadsMu.RLock()
		list := make([]*ISODownload, 0, len(isoDownloads))
		for _, d := range isoDownloads { list = append(list, d) }
		isoDownloadsMu.RUnlock()
		jsonOK(w, map[string]any{"downloads": list})

	case http.MethodPost:
		var req struct {
			URL      string `json:"url"`
			Filename string `json:"filename"`
			DestDir  string `json:"dest_dir"` // katalog docelowy — opcjonalny
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.URL == "" {
			jsonErr(w, "url jest wymagane", http.StatusBadRequest)
			return
		}

		cfg := loadKVMConfig()
		// Użyj katalogu z requesta lub pierwszego z konfiguracji
		destDir := req.DestDir
		if destDir == "" && len(cfg.ISOPaths) > 0 { destDir = cfg.ISOPaths[0] }
		if destDir == "" { destDir = "/var/lib/libvirt/boot" }
		os.MkdirAll(destDir, 0755)

		// Nazwa pliku z URL jeśli nie podana
		filename := req.Filename
		if filename == "" {
			parts := strings.Split(req.URL, "/")
			filename = parts[len(parts)-1]
			// Usuń query string
			if idx := strings.Index(filename, "?"); idx >= 0 {
				filename = filename[:idx]
			}
		}
		if !strings.HasSuffix(strings.ToLower(filename), ".iso") {
			filename += ".iso"
		}

		destPath := destDir + "/" + filename
		id := fmt.Sprintf("dl-%d", time.Now().UnixNano())

		dl := &ISODownload{
			ID:       id,
			URL:      req.URL,
			Filename: filename,
			DestPath: destPath,
			Status:   "downloading",
		}
		isoDownloadsMu.Lock()
		isoDownloads[id] = dl
		isoDownloadsMu.Unlock()

		// Pobierz w tle
		go downloadISO(dl)

		jsonOK(w, map[string]any{"id": id, "filename": filename, "dest": destPath})

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		isoDownloadsMu.Lock()
		delete(isoDownloads, id)
		isoDownloadsMu.Unlock()
		jsonOK(w, map[string]any{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func downloadISO(dl *ISODownload) {
	resp, err := httpGet(dl.URL)
	if err != nil {
		isoDownloadsMu.Lock()
		dl.Status = "error"
		dl.Error = err.Error()
		isoDownloadsMu.Unlock()
		return
	}
	defer resp.Body.Close()

	total := resp.ContentLength
	isoDownloadsMu.Lock()
	dl.Total = total
	isoDownloadsMu.Unlock()

	f, err := os.Create(dl.DestPath)
	if err != nil {
		isoDownloadsMu.Lock()
		dl.Status = "error"
		dl.Error = "Nie można utworzyć pliku: " + err.Error()
		isoDownloadsMu.Unlock()
		return
	}
	defer f.Close()

	buf := make([]byte, 256*1024) // 256KB chunks
	var done int64
	start := time.Now()

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			f.Write(buf[:n])
			done += int64(n)
			elapsed := time.Since(start).Seconds()
			speed := ""
			if elapsed > 0 {
				mbps := float64(done) / elapsed / 1024 / 1024
				if mbps >= 1 {
					speed = fmt.Sprintf("%.1f MB/s", mbps)
				} else {
					speed = fmt.Sprintf("%.0f KB/s", mbps*1024)
				}
			}
			pct := 0.0
			if total > 0 { pct = float64(done) / float64(total) * 100 }

			isoDownloadsMu.Lock()
			dl.Done  = done
			dl.Pct   = math.Round(pct*10) / 10
			dl.Speed = speed
			isoDownloadsMu.Unlock()
		}
		if err != nil { break }
	}

	isoDownloadsMu.Lock()
	if dl.Status != "error" {
		dl.Status = "done"
		dl.Pct    = 100
		dl.Done   = done
	}
	isoDownloadsMu.Unlock()
}

// httpGet wykonuje GET z przekierowaniami
func httpGet(url string) (*http.Response, error) {
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 { return fmt.Errorf("too many redirects") }
			return nil
		},
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil { return nil, err }
	req.Header.Set("User-Agent", "Mozilla/5.0 Nimbus/1.0")
	return client.Do(req)
}

func (s *Server) handleKVMNoVNCDiag(w http.ResponseWriter, r *http.Request) {
	type DirInfo struct {
		Path   string   `json:"path"`
		Exists bool     `json:"exists"`
		Files  []string `json:"files"`
	}
	var dirs []DirInfo
	searchPaths := []string{"/usr/share/novnc", "/usr/share/novnc/app", "/opt/novnc", "/usr/local/share/novnc"}
	cfg := loadKVMConfig()
	if cfg.NoVNCPath != "" { searchPaths = append([]string{cfg.NoVNCPath}, searchPaths...) }

	for _, p := range searchPaths {
		info := DirInfo{Path: p}
		entries, err := os.ReadDir(p)
		if err == nil {
			info.Exists = true
			for _, e := range entries {
				info.Files = append(info.Files, e.Name())
			}
		}
		dirs = append(dirs, info)
	}
	// Sprawdź websockify
	wsOut, wsErr := runCmd("which", "websockify")
	jsonOK(w, map[string]any{
		"dirs":              dirs,
		"websockify_path":   strings.TrimSpace(wsOut),
		"websockify_ok":     wsErr == nil,
	})
}

func (s *Server) handleKVMConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg := loadKVMConfig()
		jsonOK(w, cfg)
	case http.MethodPost:
		var cfg KVMConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonErr(w, "invalid json", http.StatusBadRequest)
			return
		}
		if err := saveKVMConfig(cfg); err != nil {
			jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]any{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
