package api

// bay_leds.go — Sterowanie LED zatok dyskowych (HP Smart Array P410)
//
// KLUCZOWE:
//   - Wszystkie wywołania ssacli mają timeout 15s (context.WithTimeout)
//   - enclosure info jest cache'owane na 60s — nie blokuję przy każdym request
//   - scanBays() cache 10s
//   - Żaden handler nie blokuje dłużej niż timeout

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
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

const ssacliTimeout = 15 * time.Second

// ── Typy ─────────────────────────────────────────────────────────────────────

type BaySlot struct {
	Slot     int    `json:"slot"`
	Bay      string `json:"bay"`
	Device   string `json:"device"`
	PDID     string `json:"pd_id"`
	SASAddr  string `json:"sas_addr"`
	Occupied bool   `json:"occupied"`
	LED      string `json:"led"`
	LEDColor string `json:"led_color"`
	Model    string  `json:"model,omitempty"`
	Serial   string  `json:"serial,omitempty"`
	Size     string  `json:"size,omitempty"`
	Temp     float64 `json:"temp,omitempty"`
	Hours    int     `json:"hours,omitempty"`
	Smart    string  `json:"smart,omitempty"`
}

type EnclosureInfo struct {
	Name       string     `json:"name"`
	Driver     string     `json:"driver"`
	CtrlSlot   int        `json:"ctrl_slot"`
	SESDevice  string     `json:"ses_device"`
	TotalSlots int        `json:"total_slots"`
	Tool       string     `json:"tool"`
	Tools      []ToolInfo `json:"tools"`
}

type ToolInfo struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Note      string `json:"note"`
}

type LEDAction struct {
	Action string `json:"action"`
	Tool   string `json:"tool"`
}

type LEDResult struct {
	OK      bool   `json:"ok"`
	Command string `json:"command"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
	NewLED  string `json:"new_led"`
}

// ── ssacli z timeout ──────────────────────────────────────────────────────────

func ssacliRun(toolPath string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), ssacliTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, toolPath, args...).CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("ssacli timeout po %s", ssacliTimeout)
	}
	return string(out), err
}

func findSSACLITool() string {
	for _, name := range []string{"ssacli", "hpssacli"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// ── Cache enclosure (60s) ─────────────────────────────────────────────────────

var (
	encCache     *EnclosureInfo
	encCacheAt   time.Time
	encCacheMu   sync.Mutex
	encCacheTTL  = 60 * time.Second
)

func detectEnclosure() EnclosureInfo {
	encCacheMu.Lock()
	defer encCacheMu.Unlock()
	if encCache != nil && time.Since(encCacheAt) < encCacheTTL {
		return *encCache
	}
	enc := buildEnclosureInfo()
	encCache = &enc
	encCacheAt = time.Now()
	return enc
}

func buildEnclosureInfo() EnclosureInfo {
	enc := EnclosureInfo{Name: "Nieznana obudowa", Driver: "unknown"}
	enc.Tools = detectTools()
	enc.Tool = bestTool(enc.Tools)

	// Sterownik
	if out, _ := runCmd("lsmod"); strings.Contains(out, "hpsa") || strings.Contains(out, "cciss") {
		enc.Driver = "hpsa"
		enc.Name = "HP Smart Array"
	} else if out, _ := runCmd("lsmod"); strings.Contains(out, "mpt3sas") || strings.Contains(out, "mpt2sas") {
		enc.Driver = "mpt3sas"
		enc.Name = "LSI/Broadcom SAS HBA"
	}

	// Slot kontrolera i Drive Bays — z ssacli z timeout
	toolPath := findSSACLITool()
	if toolPath != "" {
		if out, err := ssacliRun(toolPath, "ctrl", "all", "show", "status"); err == nil {
			re := regexp.MustCompile(`(?i)Slot\s+(\d+)`)
			if m := re.FindStringSubmatch(out); len(m) > 1 {
				enc.CtrlSlot, _ = strconv.Atoi(m[1])
			}
		}
		if out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", enc.CtrlSlot),
			"enclosure", "all", "show", "detail"); err == nil {
			re := regexp.MustCompile(`(?i)Drive Bays:\s*(\d+)`)
			if m := re.FindStringSubmatch(out); len(m) > 1 {
				enc.TotalSlots, _ = strconv.Atoi(m[1])
			}
		}
	}

	if enc.TotalSlots == 0 {
		enc.TotalSlots = countSlotsFallback()
	}

	// SES device
	for _, sg := range func() []string { g, _ := filepath.Glob("/dev/sg*"); return g }() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		out, err := exec.CommandContext(ctx, "sg_inq", "--brief", sg).Output()
		cancel()
		if err == nil && strings.Contains(strings.ToLower(string(out)), "enclosure") {
			enc.SESDevice = sg
			break
		}
	}

	return enc
}

func countSlotsFallback() int {
	out, err := exec.Command("lsblk", "-d", "-o", "NAME,TYPE").Output()
	if err != nil {
		return 0
	}
	n := 0
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasSuffix(strings.TrimSpace(line), "disk") {
			n++
		}
	}
	return n
}

// ── Narzędzia ─────────────────────────────────────────────────────────────────

func detectTools() []ToolInfo {
	defs := []ToolInfo{
		{Name: "ssacli",    Note: "HP Smart Array CLI — P410, P420, P421, Gen8/Gen9"},
		{Name: "hpssacli",  Note: "Starszy HP Smart Array CLI"},
		{Name: "ledctl",    Note: "Część pakietu ledmon — bezpośrednie sterowanie LED"},
		{Name: "ledmon",    Note: "Linux LED monitor — steruje locate i fault przez SGPIO/SES"},
		{Name: "sas2ircu",  Note: "LSI/Broadcom SAS HBA — locate przez adres enclosure:slot"},
		{Name: "sas3ircu",  Note: "LSI/Broadcom SAS3 HBA (12Gbps)"},
		{Name: "sg_ses",    Note: "SCSI Enclosure Services — bezpośrednie sterowanie SES-2"},
		{Name: "storcli64", Note: "Broadcom/MegaRAID StorCLI"},
	}
	for i, t := range defs {
		if p, err := exec.LookPath(t.Name); err == nil {
			defs[i].Available = true
			defs[i].Path = p
		}
	}
	return defs
}

func bestTool(tools []ToolInfo) string {
	for _, name := range []string{"ssacli", "hpssacli", "ledctl", "ledmon", "sas3ircu", "sas2ircu", "sg_ses", "storcli64"} {
		for _, t := range tools {
			if t.Name == name && t.Available {
				return t.Name
			}
		}
	}
	return "mock"
}

// ── Cache skanowania zatok (10s) ─────────────────────────────────────────────

var (
	bayCache    []BaySlot
	bayCacheMu  sync.Mutex
	bayLastScan time.Time
)

func scanBays() []BaySlot {
	bayCacheMu.Lock()
	defer bayCacheMu.Unlock()

	if time.Since(bayLastScan) < 10*time.Second && len(bayCache) > 0 {
		return bayCache
	}

	// Zachowaj stany LED
	oldLEDs := map[int]string{}
	for _, b := range bayCache {
		if b.LED != "" && b.LED != "off" {
			oldLEDs[b.Slot] = b.LED
		}
	}

	var slots []BaySlot
	if s := scanViaSSACLI(); len(s) > 0 {
		slots = s
	} else if s := scanViaLsscsi(); len(s) > 0 {
		slots = s
	} else {
		slots = scanViaLsblk()
	}

	// Przywróć LED
	for i, s := range slots {
		if led, ok := oldLEDs[s.Slot]; ok {
			slots[i].LED = led
			switch led {
			case "locate":
				slots[i].LEDColor = "blue"
			case "fault":
				slots[i].LEDColor = "amber"
			}
		}
	}

	bayCache = slots
	bayLastScan = time.Now()
	return slots
}

// ── ssacliPDInfo ──────────────────────────────────────────────────────────────

type ssacliPDInfo struct {
	pdID    string
	bay     int
	serial  string
	model   string
	size    string
	temp    float64
	smart   string
	devPath string
}

// ── Parsowanie enclosure all show detail ──────────────────────────────────────
//
// Format (z rzeczywistego outputu):
//   Drive Bays: 25
//   physicaldrive 1I:1:6 (port 1I:box 1:bay 6, SATA HDD, 1 TB, OK)
//   physicaldrive 1I:1:21 (port 1I:box 1:bay 21, SATA HDD, 500 GB, Predictive Failure)

func parseEnclosureOutput(out string) (map[int]ssacliPDInfo, int) {
	occupied := map[int]ssacliPDInfo{}
	totalBays := 0

	reBays := regexp.MustCompile(`(?i)Drive Bays:\s*(\d+)`)
	if m := reBays.FindStringSubmatch(out); len(m) > 1 {
		totalBays, _ = strconv.Atoi(m[1])
	}

	// physicaldrive 1I:1:6 (port 1I:box 1:bay 6, SATA HDD, 1 TB, OK)
	rePD := regexp.MustCompile(`physicaldrive\s+(\S+)\s+\(port\s+\S+:box\s+\d+:bay\s+(\d+),\s*[^,]+,\s*([^,]+),\s*([^)]+)\)`)
	for _, m := range rePD.FindAllStringSubmatch(out, -1) {
		if len(m) < 5 {
			continue
		}
		pdID := m[1]
		bay, _ := strconv.Atoi(m[2])
		size := strings.TrimSpace(m[3])
		status := strings.TrimSpace(m[4])
		smart := "ok"
		if strings.Contains(strings.ToLower(status), "predictive") ||
			strings.Contains(strings.ToLower(status), "fail") {
			smart = "warn"
		}
		occupied[bay] = ssacliPDInfo{pdID: pdID, bay: bay, size: size, smart: smart}
	}

	return occupied, totalBays
}

// ── Parsowanie show config detail — serial, model, temp, /dev/sdX ────────────
//
// Strategia: w każdym bloku "Array X" jest:
//   Disk Name: /dev/sdX   (poziom Logical Drive)
//   physicaldrive 1I:1:N  (poziom physicaldrive, bez nawiasów)
//     Bay: N
//     Serial Number: ...
//     Model: ATA ST1000...
//     Current Temperature (C): 22

func parseConfigDetailOutput(out string) map[int]ssacliPDInfo {
	result := map[int]ssacliPDInfo{}
	curDev := ""
	var cur *ssacliPDInfo
	var curBay int

	flush := func() {
		if cur != nil && curBay > 0 {
			result[curBay] = *cur
		}
		cur = nil
		curBay = 0
	}

	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "Logical Drive:") {
			curDev = ""
			continue
		}
		if strings.HasPrefix(line, "Disk Name:") {
			curDev = strings.TrimSpace(strings.TrimPrefix(line, "Disk Name:"))
			continue
		}

		// Nowy blok physicaldrive (bez nawiasów = szczegółowy)
		if strings.HasPrefix(line, "physicaldrive ") && !strings.Contains(line, "(") {
			flush()
			pdID := strings.TrimSpace(strings.TrimPrefix(line, "physicaldrive"))
			cur = &ssacliPDInfo{pdID: pdID, devPath: curDev}
			continue
		}

		if cur == nil {
			continue
		}

		idx := strings.Index(line, ":")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])

		switch key {
		case "Bay":
			curBay, _ = strconv.Atoi(val)
			cur.bay = curBay
		case "Serial Number":
			cur.serial = val
		case "Model":
			m := strings.TrimSpace(val)
			m = strings.TrimPrefix(m, "ATA ")
			m = strings.TrimPrefix(m, "ATA\t")
			m = strings.TrimSpace(strings.TrimPrefix(m, "ATA"))
			cur.model = m
		case "Current Temperature (C)":
			cur.temp, _ = strconv.ParseFloat(val, 64)
		case "Disk Name":
			cur.devPath = val
		}
	}
	flush()

	return result
}

// ── scan via ssacli ───────────────────────────────────────────────────────────

func scanViaSSACLI() []BaySlot {
	toolPath := findSSACLITool()
	if toolPath == "" {
		return nil
	}

	// Znajdź slot kontrolera
	ctrlSlot := 0
	if out, err := ssacliRun(toolPath, "ctrl", "all", "show", "status"); err == nil {
		re := regexp.MustCompile(`(?i)Slot\s+(\d+)`)
		if m := re.FindStringSubmatch(out); len(m) > 1 {
			ctrlSlot, _ = strconv.Atoi(m[1])
		}
	}

	// Krok 1: enclosure all show detail → Drive Bays + zajęte zatoki
	encOut, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", ctrlSlot),
		"enclosure", "all", "show", "detail")
	if err != nil {
		return nil
	}
	occupied, totalBays := parseEnclosureOutput(encOut)
	if totalBays == 0 && len(occupied) == 0 {
		return nil
	}
	if totalBays == 0 {
		for bay := range occupied {
			if bay > totalBays {
				totalBays = bay
			}
		}
	}

	// Krok 2: show config detail → serial, model, temp, /dev/sdX
	if cfgOut, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", ctrlSlot),
		"show", "config", "detail"); err == nil {
		details := parseConfigDetailOutput(cfgOut)
		for bay, pd := range occupied {
			if det, ok := details[bay]; ok {
				pd.serial  = det.serial
				pd.model   = det.model
				pd.devPath = det.devPath
				if det.temp > 0 {
					pd.temp = det.temp
				}
				occupied[bay] = pd
			}
		}
	}

	// Krok 3: fallback mapowanie serial → /dev/sdX przez lsblk
	serialMap := buildSerialToDeviceMap()
	for bay, pd := range occupied {
		if pd.devPath == "" && pd.serial != "" {
			if dev, ok := serialMap[strings.ToUpper(strings.TrimSpace(pd.serial))]; ok {
				pd.devPath = dev
				occupied[bay] = pd
			}
		}
	}

	// Krok 4: generuj pełną siatkę 1..totalBays
	slots := make([]BaySlot, totalBays)
	for i := range slots {
		bayNum := i + 1
		s := BaySlot{Slot: bayNum, LED: "off", LEDColor: "off"}

		if pd, ok := occupied[bayNum]; ok {
			s.Occupied = true
			s.PDID     = pd.pdID
			s.Device   = pd.devPath
			s.Bay      = strings.TrimPrefix(pd.devPath, "/dev/")
			s.Model    = pd.model
			s.Serial   = pd.serial
			s.Size     = pd.size
			s.Temp     = pd.temp
			s.Smart    = pd.smart

			// Godziny pracy z SMART
			if s.Bay != "" {
				if smart := getSMARTData(s.Bay, s.Serial); smart != nil {
					if h, ok := smart["hours"].(float64); ok && h > 0 {
						s.Hours = int(h)
					}
					if t, ok := smart["temp"].(float64); ok && t > 0 && s.Temp == 0 {
						s.Temp = t
					}
				}
			}
		}
		slots[i] = s
	}
	return slots
}

// ── Fallbacki ────────────────────────────────────────────────────────────────

func scanViaLsscsi() []BaySlot {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "lsscsi").Output()
	if err != nil {
		return nil
	}
	var slots []BaySlot
	n := 0
	reAddr := regexp.MustCompile(`\[(\d+:\d+:\d+:\d+)\]`)
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.Contains(line, "disk") {
			continue
		}
		n++
		devPath := ""
		for _, p := range strings.Fields(line) {
			if strings.HasPrefix(p, "/dev/sd") || strings.HasPrefix(p, "/dev/nvme") {
				devPath = p
				break
			}
		}
		sasAddr := ""
		if m := reAddr.FindStringSubmatch(line); len(m) > 1 {
			sasAddr = m[1]
		}
		devName := strings.TrimPrefix(devPath, "/dev/")
		s := BaySlot{Slot: n, Bay: devName, Device: devPath, SASAddr: sasAddr,
			Occupied: devPath != "", LED: "off", LEDColor: "off"}
		if devName != "" {
			enrichFromLsblk(&s)
		}
		slots = append(slots, s)
	}
	return slots
}

func scanViaLsblk() []BaySlot {
	out, err := exec.Command("lsblk", "-d", "-o", "NAME,TYPE,MODEL,SERIAL,SIZE", "--json").Output()
	if err != nil {
		return nil
	}
	var data struct {
		Blockdevices []struct {
			Name   string `json:"name"`
			Type   string `json:"type"`
			Model  string `json:"model"`
			Serial string `json:"serial"`
			Size   string `json:"size"`
		} `json:"blockdevices"`
	}
	if json.Unmarshal(out, &data) != nil {
		return nil
	}
	var slots []BaySlot
	n := 0
	for _, d := range data.Blockdevices {
		if d.Type != "disk" {
			continue
		}
		n++
		slots = append(slots, BaySlot{
			Slot: n, Bay: d.Name, Device: "/dev/" + d.Name,
			Model: strings.TrimSpace(d.Model), Serial: d.Serial, Size: d.Size,
			Occupied: true, LED: "off", LEDColor: "off",
		})
	}
	return slots
}

func enrichFromLsblk(s *BaySlot) {
	out, err := exec.Command("lsblk", "-d", "-o", "MODEL,SERIAL,SIZE", "-n", "/dev/"+s.Bay).Output()
	if err != nil {
		return
	}
	f := strings.Fields(string(out))
	switch len(f) {
	case 3:
		s.Model, s.Serial, s.Size = f[0], f[1], f[2]
	case 2:
		s.Model, s.Size = f[0], f[1]
	case 1:
		s.Size = f[0]
	}
}

func buildSerialToDeviceMap() map[string]string {
	m := map[string]string{}
	out, err := exec.Command("lsblk", "-d", "-o", "NAME,SERIAL", "--json").Output()
	if err != nil {
		return m
	}
	var data struct {
		Blockdevices []struct {
			Name   string `json:"name"`
			Serial string `json:"serial"`
		} `json:"blockdevices"`
	}
	if json.Unmarshal(out, &data) != nil {
		return m
	}
	for _, d := range data.Blockdevices {
		if d.Serial != "" {
			m[strings.ToUpper(strings.TrimSpace(d.Serial))] = "/dev/" + d.Name
		}
	}
	return m
}

func getSASAddress(devName string) string {
	b, err := os.ReadFile(fmt.Sprintf("/sys/block/%s/device/sas_address", devName))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// ── Sterowanie LED ────────────────────────────────────────────────────────────

func applyLED(slot BaySlot, action, tool string, enc EnclosureInfo) LEDResult {
	if tool == "" {
		tool = enc.Tool
	}
	if tool == "" || tool == "mock" {
		return mockLED(slot, action)
	}

	var res LEDResult
	switch tool {
	case "ssacli", "hpssacli":
		res = ssacliLED(slot, action, enc.CtrlSlot, tool)
	case "ledctl", "ledmon":
		res = ledctlLED(slot, action)
	case "sas2ircu":
		res = irgLED("sas2ircu", slot, action, 0)
	case "sas3ircu":
		res = irgLED("sas3ircu", slot, action, 0)
	case "sg_ses":
		res = sgSESLED(slot, action, enc.SESDevice)
	case "storcli64":
		res = storcliLED(slot, action)
	default:
		res = mockLED(slot, action)
	}

	// Aktualizuj cache LED
	newLED := "off"
	switch action {
	case "locate-on":
		newLED = "locate"
	case "fault-on":
		newLED = "fault"
	}
	bayCacheMu.Lock()
	for i, b := range bayCache {
		if b.Slot == slot.Slot {
			bayCache[i].LED = newLED
			switch newLED {
			case "locate":
				bayCache[i].LEDColor = "blue"
			case "fault":
				bayCache[i].LEDColor = "amber"
			default:
				bayCache[i].LEDColor = "off"
			}
			break
		}
	}
	bayCacheMu.Unlock()
	res.NewLED = newLED
	return res
}

func runLEDCmd(name string, args ...string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), ssacliTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return name + " " + strings.Join(args, " "), strings.TrimSpace(string(out)), err
}

func ssacliLED(slot BaySlot, action string, ctrlSlot int, tool string) LEDResult {
	pdAddr := slot.PDID
	if pdAddr == "" {
		pdAddr = fmt.Sprintf("1I:1:%d", slot.Slot)
	}
	ledVal := "off"
	if action == "locate-on" || action == "fault-on" {
		ledVal = "on"
	}
	cmd, out, err := runLEDCmd(tool,
		"ctrl", fmt.Sprintf("slot=%d", ctrlSlot),
		"pd", pdAddr,
		"modify", fmt.Sprintf("led=%s", ledVal),
	)
	res := LEDResult{Command: cmd, Output: out}
	if err != nil {
		if strings.Contains(out, "Error") || strings.Contains(out, "not found") {
			res.Error = out
		} else {
			res.OK = true
		}
	} else {
		res.OK = true
	}
	return res
}

func ledctlLED(slot BaySlot, action string) LEDResult {
	dev := slot.Device
	if dev == "" {
		return LEDResult{Error: "brak /dev/sdX dla tej zatoki (pusta zatoka)"}
	}
	var arg string
	switch action {
	case "locate-on":
		arg = "locate=" + dev
	case "locate-off":
		arg = "locate_off=" + dev
	case "fault-on":
		arg = "failure=" + dev
	default:
		arg = "normal=" + dev
	}
	tool := "ledctl"
	if _, err := exec.LookPath("ledctl"); err != nil {
		tool = "ledmon"
	}
	cmd, out, err := runLEDCmd(tool, arg)
	res := LEDResult{Command: cmd, Output: out}
	if err != nil {
		res.Error = err.Error()
		if strings.Contains(out, "No enclosure") || strings.Contains(out, "not found") {
			res.OK = true
		}
	} else {
		res.OK = true
	}
	return res
}

func irgLED(tool string, slot BaySlot, action string, ctrlIdx int) LEDResult {
	switch action {
	case "fault-on", "fault-off":
		return LEDResult{OK: true, Command: "# " + tool + ": fault LED sterowany przez firmware"}
	}
	addr := slot.SASAddr
	if addr == "" {
		addr = getSASAddress(slot.Bay)
	}
	if addr == "" {
		addr = fmt.Sprintf("252:%d", slot.Slot-1)
	}
	onOff := "OFF"
	if action == "locate-on" {
		onOff = "ON"
	}
	cmd, out, err := runLEDCmd(tool, strconv.Itoa(ctrlIdx), "LOCATE", addr, onOff)
	res := LEDResult{Command: cmd, Output: out}
	if err != nil {
		res.Error = err.Error()
	} else {
		res.OK = true
	}
	return res
}

func sgSESLED(slot BaySlot, action string, sesDev string) LEDResult {
	if sesDev == "" {
		sesDev = "/dev/sg0"
	}
	idx := strconv.Itoa(slot.Slot - 1)
	var cmd, out string
	var err error
	switch action {
	case "locate-on":
		cmd, out, err = runLEDCmd("sg_ses", "--index="+idx, "--set=ident", sesDev)
	case "locate-off", "off":
		cmd, out, err = runLEDCmd("sg_ses", "--index="+idx, "--clear=ident", sesDev)
	case "fault-on":
		cmd, out, err = runLEDCmd("sg_ses", "--index="+idx, "--set=fault", sesDev)
	case "fault-off":
		cmd, out, err = runLEDCmd("sg_ses", "--index="+idx, "--clear=fault", sesDev)
	}
	res := LEDResult{Command: cmd, Output: out}
	if err != nil {
		res.Error = err.Error()
	} else {
		res.OK = true
	}
	return res
}

func storcliLED(slot BaySlot, action string) LEDResult {
	tool := "storcli64"
	if _, err := exec.LookPath(tool); err != nil {
		tool = "storcli"
	}
	switch action {
	case "fault-on", "fault-off":
		return LEDResult{OK: true, Command: "# storcli: fault LED sterowany przez kontroler"}
	}
	addr := fmt.Sprintf("/c0/e252/s%d", slot.Slot-1)
	subcmd := "stop locate"
	if action == "locate-on" {
		subcmd = "start locate"
	}
	parts := append([]string{addr}, strings.Fields(subcmd)...)
	cmd, out, err := runLEDCmd(tool, parts...)
	res := LEDResult{Command: cmd, Output: out}
	if err != nil {
		res.Error = err.Error()
	} else {
		res.OK = true
	}
	return res
}

func mockLED(slot BaySlot, action string) LEDResult {
	newLED := "off"
	switch action {
	case "locate-on":
		newLED = "locate"
	case "fault-on":
		newLED = "fault"
	}
	return LEDResult{
		OK:      true,
		Command: fmt.Sprintf("# DEMO: %s zatoka %d → %s", action, slot.Slot, newLED),
		NewLED:  newLED,
	}
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleBaysInfo(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, detectEnclosure())
}

func (s *Server) handleBaysTools(w http.ResponseWriter, r *http.Request) {
	tools := detectTools()
	jsonOK(w, map[string]any{"tools": tools, "best": bestTool(tools)})
}

func (s *Server) handleBays(w http.ResponseWriter, r *http.Request) {
	slots := scanBays()
	enc := detectEnclosure()
	occupied := 0
	for _, sl := range slots {
		if sl.Occupied {
			occupied++
		}
	}
	jsonOK(w, map[string]any{
		"slots":    slots,
		"total":    len(slots),
		"occupied": occupied,
		"tool":     enc.Tool,
	})
}

func (s *Server) handleBaysScan(w http.ResponseWriter, r *http.Request) {
	// Reset cache — wymusi pełny reskan przy następnym żądaniu
	bayCacheMu.Lock()
	bayLastScan = time.Time{}
	bayCacheMu.Unlock()
	encCacheMu.Lock()
	encCache = nil
	encCacheMu.Unlock()
	slots := scanBays()
	jsonOK(w, map[string]any{"slots": len(slots), "status": "ok"})
}

func (s *Server) handleBayLED(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	slotStr := strings.TrimSuffix(pathSuffix(r, "/api/bays/"), "/led")
	slotNum, err := strconv.Atoi(slotStr)
	if err != nil {
		jsonErr(w, "nieprawidłowy numer slotu", http.StatusBadRequest)
		return
	}
	var req LEDAction
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Action == "" {
		jsonErr(w, "wymagane pole: action", http.StatusBadRequest)
		return
	}
	slots := scanBays()
	var target *BaySlot
	for i := range slots {
		if slots[i].Slot == slotNum {
			target = &slots[i]
			break
		}
	}
	if target == nil {
		jsonErr(w, fmt.Sprintf("slot %d nie istnieje", slotNum), http.StatusNotFound)
		return
	}
	enc := detectEnclosure()
	jsonOK(w, applyLED(*target, req.Action, req.Tool, enc))
}

func (s *Server) handleBaysAllOff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	slots := scanBays()
	enc := detectEnclosure()
	var results []LEDResult
	for _, slot := range slots {
		if slot.LED != "" && slot.LED != "off" {
			results = append(results, applyLED(slot, "off", "", enc))
		}
	}
	jsonOK(w, map[string]any{"results": results, "status": "ok"})
}
