package api

// hardware.go — inwentarz sprzętu: CPU, RAM, PCIe, USB, BIOS, NIC
// Źródła danych: /proc/cpuinfo, dmidecode, lspci, lsusb, ethtool, ip link

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// ── Struktury ─────────────────────────────────────────────────────────────────

type HWCpu struct {
	Model     string   `json:"model"`
	Cores     int      `json:"cores"`
	Threads   int      `json:"threads"`
	Socket    string   `json:"socket"`
	BaseGHz   string   `json:"base_ghz"`
	BoostGHz  string   `json:"boost_ghz"`
	Cache     string   `json:"cache"`
	Microcode string   `json:"microcode"`
	Vendor    string   `json:"vendor"`
	Family    string   `json:"family"`
	Flags     []string `json:"flags"`
	TDP       string   `json:"tdp"`
}

type HWRamSlot struct {
	Slot   string `json:"slot"`
	SizeGB int    `json:"size_gb"` // 0 = pusty
	Type   string `json:"type"`
	Speed  string `json:"speed"`
	Mfr    string `json:"mfr"`
	PN     string `json:"pn"`
	SN     string `json:"sn"`
}

type HWPcie struct {
	Slot     string `json:"slot"`
	Lanes    string `json:"lanes"`
	Occupied bool   `json:"occupied"`
	Device   string `json:"device"`
	Vendor   string `json:"vendor"`
	Driver   string `json:"driver"`
	Power    string `json:"power"`
}

type HWUSB struct {
	Bus    string `json:"bus"`
	Port   string `json:"port"`
	Vendor string `json:"vendor"`
	Device string `json:"device"`
	Speed  string `json:"speed"`
}

type HWBIOS struct {
	Vendor     string `json:"vendor"`
	Version    string `json:"version"`
	Date       string `json:"date"`
	EFI        string `json:"efi"`
	TPM        string `json:"tpm"`
	SecureBoot string `json:"secure_boot"`
	Board      string `json:"board"`
	BoardRev   string `json:"board_rev"`
	BoardSN    string `json:"board_sn"`
	Chassis    string `json:"chassis"`
	ChassisSN  string `json:"chassis_sn"`
}

type HWNIC struct {
	Name   string `json:"name"`
	MAC    string `json:"mac"`
	Driver string `json:"driver"`
	Speed  string `json:"speed"`
	MTU    int    `json:"mtu"`
	State  string `json:"state"`
}

// ── CPU (/proc/cpuinfo + dmidecode) ──────────────────────────────────────────

func readHWCpu() HWCpu {
	cpu := HWCpu{Model: "Unknown", Vendor: "Unknown"}

	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return cpu
	}

	physicalIDs := map[string]bool{}
	logicalCount := 0

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		kv := strings.SplitN(line, ":", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])

		switch k {
		case "model name":
			if cpu.Model == "Unknown" {
				cpu.Model = v
			}
		case "vendor_id":
			cpu.Vendor = v
		case "cpu family":
			cpu.Family = v
		case "physical id":
			physicalIDs[v] = true
		case "processor":
			logicalCount++
		case "cpu MHz":
			if cpu.BaseGHz == "" {
				mhz, _ := strconv.ParseFloat(v, 64)
				cpu.BaseGHz = fmt.Sprintf("%.2f GHz", mhz/1000)
			}
		case "cache size":
			if cpu.Cache == "" {
				cpu.Cache = v
			}
		case "microcode":
			cpu.Microcode = v
		case "flags":
			interestingFlags := []string{"avx2", "avx512f", "sse4_2", "aes", "vmx", "svm", "sha_ni", "bmi2", "rdrand"}
			parts := strings.Fields(v)
			flagSet := map[string]bool{}
			for _, f := range parts {
				flagSet[f] = true
			}
			for _, f := range interestingFlags {
				if flagSet[f] {
					cpu.Flags = append(cpu.Flags, f)
				}
			}
		}
	}

	cpu.Threads = logicalCount
	if len(physicalIDs) > 0 {
		cpu.Cores = logicalCount / len(physicalIDs) / 2
		if cpu.Cores == 0 {
			cpu.Cores = logicalCount
		}
	} else {
		cpu.Cores = logicalCount
	}

	// Próbuj dmidecode dla dodatkowych info (socket, boost, TDP)
	if out, err := runCmd("dmidecode", "-t", "processor"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Socket Designation:") {
				cpu.Socket = strings.TrimSpace(strings.TrimPrefix(line, "Socket Designation:"))
			}
			if strings.HasPrefix(line, "Max Speed:") {
				cpu.BoostGHz = strings.TrimSpace(strings.TrimPrefix(line, "Max Speed:"))
			}
			if strings.HasPrefix(line, "Core Count:") {
				if v, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "Core Count:"))); err == nil {
					cpu.Cores = v
				}
			}
			if strings.HasPrefix(line, "Thread Count:") {
				if v, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "Thread Count:"))); err == nil {
					cpu.Threads = v
				}
			}
		}
	}

	return cpu
}

// ── RAM (dmidecode type 17) ───────────────────────────────────────────────────

func readHWRam() []HWRamSlot {
	out, err := runCmd("dmidecode", "-t", "memory")
	if err != nil || out == "" {
		// Fallback: /proc/meminfo dla łącznej wielkości
		return readHWRamFallback()
	}

	var slots []HWRamSlot
	var cur *HWRamSlot

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)

		if line == "Memory Device" {
			if cur != nil {
				slots = append(slots, *cur)
			}
			cur = &HWRamSlot{}
			continue
		}
		if cur == nil {
			continue
		}

		kv := strings.SplitN(line, ":", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])

		switch k {
		case "Locator":
			if !strings.HasPrefix(strings.ToUpper(v), "SYSTEM") {
				cur.Slot = v
			}
		case "Bank Locator":
			if cur.Slot == "" {
				cur.Slot = v
			}
		case "Size":
			if v != "No Module Installed" && v != "Unknown" {
				// "32 GB" lub "32768 MB"
				parts := strings.Fields(v)
				if len(parts) == 2 {
					size, _ := strconv.Atoi(parts[0])
					if strings.EqualFold(parts[1], "MB") {
						size = size / 1024
					}
					cur.SizeGB = size
				}
			}
		case "Type":
			cur.Type = v
		case "Speed":
			if v != "Unknown" {
				cur.Speed = v
			}
		case "Manufacturer":
			if v != "Unknown" {
				cur.Mfr = v
			}
		case "Part Number":
			cur.PN = strings.TrimSpace(v)
		case "Serial Number":
			if v != "Unknown" {
				cur.SN = v
			}
		}
	}
	if cur != nil {
		slots = append(slots, *cur)
	}

	// Usuń sloty bez etykiety
	var clean []HWRamSlot
	for _, s := range slots {
		if s.Slot != "" {
			clean = append(clean, s)
		}
	}
	return clean
}

func readHWRamFallback() []HWRamSlot {
	data, _ := os.ReadFile("/proc/meminfo")
	totalKB := uint64(0)
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				totalKB, _ = strconv.ParseUint(fields[1], 10, 64)
			}
		}
	}
	totalGB := int(totalKB / 1048576)
	return []HWRamSlot{
		{Slot: "RAM", SizeGB: totalGB, Type: "DDR", Speed: "Unknown"},
	}
}

// ── PCIe (lspci) ─────────────────────────────────────────────────────────────

func readHWPcie() []HWPcie {
	// lspci -vmm: machine-readable verbose output
	out, err := runCmd("lspci", "-vmm")
	if err != nil || out == "" {
		return nil
	}

	var devices []HWPcie
	var cur map[string]string

	flush := func() {
		if cur == nil {
			return
		}
		class := cur["Class"]
		device := cur["Device"]
		vendor := cur["Vendor"]
		slot := cur["Slot"]
		if slot == "" || class == "" {
			return
		}

		// Pomijamy mosty i inne kontrolery systemu wew.
		skipClasses := []string{"Bridge", "ISA bridge", "SMBus", "Signal processing"}
		skip := false
		for _, sc := range skipClasses {
			if strings.Contains(class, sc) {
				skip = true
				break
			}
		}
		if skip {
			return
		}

		// Pobierz driver
		driver := ""
		if dOut, err := runCmd("lspci", "-k", "-s", slot); err == nil {
			for _, l := range strings.Split(dOut, "\n") {
				if strings.Contains(l, "Kernel driver in use:") {
					driver = strings.TrimSpace(strings.TrimPrefix(l, "\tKernel driver in use:"))
					driver = strings.TrimSpace(strings.TrimPrefix(driver, "Kernel driver in use:"))
				}
			}
		}

		vendorID := cur["SVendor"]
		if vendorID == "" {
			vendorID = vendor
		}

		devices = append(devices, HWPcie{
			Slot:     slot + " (" + class + ")",
			Lanes:    "x" + cur["Width"],
			Occupied: true,
			Device:   device,
			Vendor:   vendorID,
			Driver:   driver,
		})
	}

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			flush()
			cur = nil
			continue
		}
		if cur == nil {
			cur = map[string]string{}
		}
		kv := strings.SplitN(line, ":", 2)
		if len(kv) == 2 {
			cur[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	flush()

	return devices
}

// ── USB (lsusb) ───────────────────────────────────────────────────────────────

func readHWUsb() []HWUSB {
	out, err := runCmd("lsusb")
	if err != nil || out == "" {
		return nil
	}

	// Przykład: Bus 001 Device 003: ID 046d:c52b Logitech, Inc. Unifying Receiver
	re := regexp.MustCompile(`Bus\s+(\d+)\s+Device\s+\d+:\s+ID\s+([\w:]+)\s+(.+)`)
	var usbs []HWUSB

	for _, line := range strings.Split(out, "\n") {
		m := re.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		bus := m[1]
		vendor := m[2]
		device := strings.TrimSpace(m[3])

		// Pomiń roothuby
		if strings.Contains(strings.ToLower(device), "root hub") ||
			strings.Contains(strings.ToLower(device), "linux foundation") {
			continue
		}

		usbs = append(usbs, HWUSB{
			Bus:    bus,
			Port:   "USB",
			Vendor: vendor,
			Device: device,
			Speed:  "",
		})
	}

	return usbs
}

// ── BIOS (dmidecode type 0, 1, 2, 3) ─────────────────────────────────────────

func readHWBios() HWBIOS {
	bios := HWBIOS{}

	// Typ 0 = BIOS
	if out, err := runCmd("dmidecode", "-t", "0"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "Vendor":
				bios.Vendor = v
			case "Version":
				bios.Version = v
			case "Release Date":
				bios.Date = v
			case "BIOS Revision":
				// ignoruj
			}
		}
	}

	// Typ 1 = System
	if out, err := runCmd("dmidecode", "-t", "1"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "Serial Number":
				if bios.ChassisSN == "" {
					bios.ChassisSN = v
				}
			}
		}
	}

	// Typ 2 = Baseboard
	if out, err := runCmd("dmidecode", "-t", "2"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "Manufacturer":
				// board manufacturer
			case "Product Name":
				bios.Board = v
			case "Version":
				bios.BoardRev = v
			case "Serial Number":
				bios.BoardSN = v
			}
		}
	}

	// Typ 3 = Chassis
	if out, err := runCmd("dmidecode", "-t", "3"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "Manufacturer":
				bios.Chassis = v
			case "Serial Number":
				if v != "Unknown" && v != "" {
					bios.ChassisSN = v
				}
			}
		}
	}

	// UEFI / TPM / Secure Boot
	if out, err := runCmd("mokutil", "--sb-state"); err == nil {
		if strings.Contains(strings.ToLower(out), "enabled") {
			bios.SecureBoot = "Enabled"
		} else {
			bios.SecureBoot = "Disabled"
		}
	} else {
		// Fallback: sprawdź /sys/firmware/efi
		if _, err := os.Stat("/sys/firmware/efi"); err == nil {
			bios.EFI = "UEFI"
			bios.SecureBoot = "Unknown"
		} else {
			bios.EFI = "Legacy BIOS"
			bios.SecureBoot = "N/A"
		}
	}

	if bios.EFI == "" {
		if _, err := os.Stat("/sys/firmware/efi"); err == nil {
			bios.EFI = "UEFI"
		} else {
			bios.EFI = "Legacy BIOS"
		}
	}

	// TPM
	if _, err := os.Stat("/sys/class/tpm/tpm0"); err == nil {
		bios.TPM = "TPM 2.0"
		if data, err := os.ReadFile("/sys/class/tpm/tpm0/tpm_version_major"); err == nil {
			if strings.TrimSpace(string(data)) == "1" {
				bios.TPM = "TPM 1.2"
			}
		}
	} else {
		bios.TPM = "Not detected"
	}

	return bios
}

// ── NIC (ip link + ethtool) ───────────────────────────────────────────────────

func readHWNics() []HWNIC {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	var nics []HWNIC
	for _, iface := range ifaces {
		// Pomiń loopback i wirtualne interfejsy dockera/wg
		name := iface.Name
		if name == "lo" ||
			strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "br-") ||
			strings.HasPrefix(name, "docker") ||
			strings.HasPrefix(name, "virbr") {
			continue
		}

		state := "down"
		if iface.Flags&net.FlagUp != 0 {
			state = "up"
		}

		mac := iface.HardwareAddr.String()

		// Driver z /sys/class/net/<iface>/device/driver
		driver := ""
		driverLink, _ := os.Readlink(fmt.Sprintf("/sys/class/net/%s/device/driver", name))
		if driverLink != "" {
			parts := strings.Split(driverLink, "/")
			driver = parts[len(parts)-1]
		}

		// Prędkość z ethtool
		speed := "—"
		if out, err := runCmd("ethtool", name); err == nil {
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "Speed:") {
					speed = strings.TrimSpace(strings.TrimPrefix(line, "Speed:"))
					break
				}
			}
		}
		// Fallback: /sys/class/net/<iface>/speed
		if speed == "—" || speed == "Unknown!" {
			if data, err := os.ReadFile(fmt.Sprintf("/sys/class/net/%s/speed", name)); err == nil {
				mbps, _ := strconv.Atoi(strings.TrimSpace(string(data)))
				if mbps > 0 {
					if mbps >= 1000 {
						speed = fmt.Sprintf("%d Gb/s", mbps/1000)
					} else {
						speed = fmt.Sprintf("%d Mb/s", mbps)
					}
				}
			}
		}

		nics = append(nics, HWNIC{
			Name:   name,
			MAC:    mac,
			Driver: driver,
			Speed:  speed,
			MTU:    iface.MTU,
			State:  state,
		})
	}

	return nics
}

// ── Handler ───────────────────────────────────────────────────────────────────

func (s *Server) handleHardware(w http.ResponseWriter, r *http.Request) {
	// Sprawdź czy dmidecode jest dostępny
	_, dmidecodeAvail := runCmd("which", "dmidecode")
	_, lspciAvail := runCmd("which", "lspci")
	_, lsusbAvail := runCmd("which", "lsusb")

	cpu := readHWCpu()
	ram := readHWRam()

	var pcie []HWPcie
	if lspciAvail == nil {
		pcie = readHWPcie()
	}

	var usb []HWUSB
	if lsusbAvail == nil {
		usb = readHWUsb()
	}

	var bios HWBIOS
	if dmidecodeAvail == nil {
		bios = readHWBios()
	}

	nics := readHWNics()

	// RAM summary
	totalRamGB := 0
	ramUsed := 0
	for _, slot := range ram {
		if slot.SizeGB > 0 {
			totalRamGB += slot.SizeGB
			ramUsed++
		}
	}

	jsonOK(w, map[string]any{
		"cpu":              cpu,
		"ram":              ram,
		"ram_total_gb":     totalRamGB,
		"ram_slots_used":   ramUsed,
		"ram_slots_total":  len(ram),
		"pcie":             pcie,
		"usb":              usb,
		"bios":             bios,
		"nics":             nics,
		"dmidecode_avail":  dmidecodeAvail == nil,
		"lspci_avail":      lspciAvail == nil,
		"lsusb_avail":      lsusbAvail == nil,
	})
}

func (s *Server) handleHardwareInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("apt-get", "install", "-y", "pciutils", "usbutils", "dmidecode")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}
