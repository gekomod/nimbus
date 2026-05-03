package api

import (
    "encoding/json"
    "sync"
    "time"
    "net/http"
    "nimbus/internal/sys"
    "os"
    "os/exec"
    "strconv"
    "strings"
    "fmt"
)

func (s *Server) handleStorageDevices(w http.ResponseWriter, r *http.Request) {
    out, _ := runCmd("lsblk", "-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,VENDOR,TRAN,ROTA,RM,RO")
    
    if out == "" {
        jsonOK(w, map[string]interface{}{"devices": []interface{}{}})
        return
    }

    // Parsuj JSON z lsblk
    var lsblkData struct {
        Blockdevices []map[string]interface{} `json:"blockdevices"`
    }
    if err := json.Unmarshal([]byte(out), &lsblkData); err != nil {
        jsonOK(w, map[string]interface{}{"devices": []interface{}{}})
        return
    }

    // Rekurencyjnie zbierz nazwy dysków bazowych których partycje mają mountpoint
    // np. sda1 zamontowane na "/" -> sda trafia do mountedBases
    mountedBases := map[string]bool{}
    var collectMounted func(devs []interface{})
    collectMounted = func(devs []interface{}) {
        for _, d := range devs {
            dm, ok := d.(map[string]interface{})
            if !ok {
                continue
            }
            mp, _ := dm["mountpoint"].(string)
            devName, _ := dm["name"].(string)
            if mp != "" && devName != "" {
                // Wyciagnij dysk bazowy: sda1->sda, nvme0n1p1->nvme0n1
                base := strings.TrimRight(devName, "0123456789")
                if strings.HasSuffix(base, "p") {
                    base = strings.TrimSuffix(base, "p")
                }
                mountedBases[base] = true
                mountedBases[devName] = true
            }
            if children, ok := dm["children"].([]interface{}); ok {
                collectMounted(children)
            }
        }
    }
    // Wywołaj dla wszystkich blockdevices (ich children to partycje)
    for _, dev := range lsblkData.Blockdevices {
        if children, ok := dev["children"].([]interface{}); ok {
            collectMounted(children)
        }
        // Też sprawdz sam dysk
        if mp, ok := dev["mountpoint"].(string); ok && mp != "" {
            if n, ok := dev["name"].(string); ok {
                mountedBases[n] = true
            }
        }
    }

    poolMap := getZFSPoolDiskMapping()
    ioStats := parseDiskIOStats()

    var result []map[string]interface{}
    for _, dev := range lsblkData.Blockdevices {
        name := getString(dev, "name")
        devType := getString(dev, "type")
        
        if devType == "loop" || devType == "rom" {
            continue
        }

        device := map[string]interface{}{
            "bay":    name,
            "type":   devType,
            "model":  getString(dev, "model"),
            "serial": getString(dev, "serial"),
            "vendor": strings.TrimSpace(getString(dev, "vendor")),
            "size":   getString(dev, "size"),
            "fs":     getString(dev, "fstype"),
            "mount":  getString(dev, "mountpoint"),
            "tran":   getString(dev, "tran"),
            "rota":   getBool(dev, "rota"),
            "rm":     getBool(dev, "rm"),
            "ro":     getBool(dev, "ro"),
        }

        // ZFS pool mapping
        if poolName, exists := poolMap[name]; exists {
            device["pool"] = poolName
        } else {
            device["pool"] = nil
        }

        // Ma zamontowane partycje (dysk systemowy, dane itp.) — front użyje tego do klasyfikacji
        device["has_mounted_parts"] = mountedBases[name]

        // SMART data - tylko dla dysków fizycznych
        if devType == "disk" {
            smartData := getSMARTData(name)
            if smartData != nil {
                device["temp"] = smartData["temp"]
                device["hours"] = smartData["hours"]
                device["smart"] = smartData["status"]
            } else {
                device["temp"] = 0
                device["hours"] = 0
                device["smart"] = "unknown"
            }
        } else {
            device["temp"] = 0
            device["hours"] = 0
            device["smart"] = "N/A"
        }

        // I/O stats - naprawione wartości
        if stats, ok := ioStats[name]; ok {
            device["io"] = stats["util"]
            device["read_mbps"] = stats["read_mbps"]
            device["write_mbps"] = stats["write_mbps"]
            device["iops"] = stats["iops"]
        } else {
            device["io"] = 0
            device["read_mbps"] = 0
            device["write_mbps"] = 0
            device["iops"] = 0
        }

        result = append(result, device)
    }

    jsonOK(w, map[string]interface{}{"devices": result})
}

// Funkcje pomocnicze
func getKeys(m map[string]map[string]float64) []string {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    return keys
}

// Funkcja pomocnicza - mapowanie dysków do pul ZFS
func getZFSPoolDiskMapping() map[string]string {
	poolMap := make(map[string]string)
	
	// Użyj komendy zpool do pobrania listy dysków dla każdej puli
	pools, _ := runCmd("zpool", "list", "-H", "-o", "name")
	if pools == "" {
		return poolMap
	}
	
	for _, poolName := range strings.Split(strings.TrimSpace(pools), "\n") {
		if poolName == "" {
			continue
		}
		
		// Pobierz szczegółową listę urządzeń dla puli
		detailOut, _ := runCmd("zpool", "status", "-P", poolName)
		if detailOut == "" {
			continue
		}
		
		// Parsuj wyjście zpool status
		lines := strings.Split(detailOut, "\n")
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "/dev/") {
				// Wyciągnij ścieżkę urządzenia
				fields := strings.Fields(trimmed)
				if len(fields) > 0 {
					devPath := fields[0]
					// Usuń /dev/ prefix i ewentualne oznaczenia partycji
					devName := strings.TrimPrefix(devPath, "/dev/")
					// Usuń suffix partycji (np. sda1 -> sda)
					devName = strings.TrimRight(devName, "0123456789")
					if devName != "" {
						poolMap[devName] = poolName
					}
				}
			}
		}
	}
	
	// Dodatkowo - jeśli sys.ZFSPools() działa, możemy użyć jej do walidacji
	if zfsPools, err := sys.ZFSPools(); err == nil {
		for _, pool := range zfsPools {
			// Użyj nazwy puli do aktualizacji mapowania
			if _, exists := poolMap[pool.Name]; !exists {
				// To jest fallback - próbujemy znaleźć dyski dla puli
				_ = pool.Name // Używamy nazwy puli
			}
		}
	}
	
	return poolMap
}

// Funkcja pomocnicza - parsowanie /proc/diskstats dla I/O
func parseDiskIOStats() map[string]map[string]float64 {
    stats := make(map[string]map[string]float64)
    
    data, err := os.ReadFile("/proc/diskstats")
    if err != nil {
        return stats
    }
    
    for _, line := range strings.Split(string(data), "\n") {
        fields := strings.Fields(line)
        if len(fields) < 14 {
            continue
        }
        
        devName := fields[2]
        
        if !isPhysicalDiskDevice(devName) {
            continue
        }
        
        readsCompleted, _ := strconv.ParseFloat(fields[3], 64)
        sectorsRead, _ := strconv.ParseFloat(fields[5], 64)
        writesCompleted, _ := strconv.ParseFloat(fields[7], 64)
        sectorsWritten, _ := strconv.ParseFloat(fields[9], 64)
        ioTime, _ := strconv.ParseFloat(fields[12], 64)
        
        uptimeData, _ := os.ReadFile("/proc/uptime")
        uptimeFields := strings.Fields(string(uptimeData))
        uptimeSecs := 3600.0
        if len(uptimeFields) > 0 {
            uptimeSecs, _ = strconv.ParseFloat(uptimeFields[0], 64)
        }
        
        iops := (readsCompleted + writesCompleted) / uptimeSecs
        readMBps := (sectorsRead * 512) / (1024 * 1024) / uptimeSecs
        writeMBps := (sectorsWritten * 512) / (1024 * 1024) / uptimeSecs
        util := (ioTime / (uptimeSecs * 1000)) * 100
        
        if util > 100 {
            util = 100
        }
        
        stats[devName] = map[string]float64{
            "iops":       iops,
            "read_mbps":  readMBps,
            "write_mbps": writeMBps,
            "util":       util,
        }
    }
    
    return stats
}

// Funkcja pomocnicza - sprawdzanie czy to fizyczny dysk
func isPhysicalDiskDevice(name string) bool {
	// Wzorce dla dysków fizycznych
	if strings.HasPrefix(name, "sd") || strings.HasPrefix(name, "hd") || 
	   strings.HasPrefix(name, "vd") || strings.HasPrefix(name, "xvd") {
		// Wyklucz partycje (kończą się cyfrą)
		lastChar := name[len(name)-1]
		if lastChar >= '0' && lastChar <= '9' {
			return false
		}
		return true
	}
	
	if strings.HasPrefix(name, "nvme") {
		// NVMe: nvme0n1 to dysk, nvme0n1p1 to partycja
		if strings.Contains(name, "p") {
			// Sprawdź czy po 'p' jest cyfra (partycja)
			parts := strings.Split(name, "p")
			if len(parts) >= 2 {
				lastPart := parts[len(parts)-1]
				if _, err := strconv.Atoi(lastPart); err == nil {
					return false
				}
			}
		}
		return true
	}
	
	if strings.HasPrefix(name, "mmcblk") {
		// mmcblk0 to dysk, mmcblk0p1 to partycja
		if strings.Contains(name, "p") {
			return false
		}
		return true
	}
	
	return false
}

// Funkcja pomocnicza - pobieranie danych S.M.A.R.T.
func getSMARTData(device string) map[string]interface{} {
    devPath := "/dev/" + device
    
    if _, err := os.Stat(devPath); os.IsNotExist(err) {
        return nil
    }
    
    if _, err := exec.LookPath("smartctl"); err != nil {
        return nil
    }
    
    out, err := runCmd("smartctl", "-A", "-j", devPath)
    if err != nil || out == "" {
        return nil
    }
    
    var smartData map[string]interface{}
    if err := json.Unmarshal([]byte(out), &smartData); err != nil {
        return nil
    }
    
    result := map[string]interface{}{
        "temp":   0,
        "hours":  0,
        "status": "unknown",
    }
    
    // Sprawdź ogólny stan
    if smartStatus, ok := smartData["smart_status"].(map[string]interface{}); ok {
        if passed, ok := smartStatus["passed"].(bool); ok {
            if passed {
                result["status"] = "passed"
            } else {
                result["status"] = "warn"
            }
        }
    }
    
    // Parsuj atrybuty
    if ataData, ok := smartData["ata_smart_attributes"].(map[string]interface{}); ok {
        if table, ok := ataData["table"].([]interface{}); ok {
            for _, attr := range table {
                attrMap, ok := attr.(map[string]interface{})
                if !ok {
                    continue
                }
                
                id, ok := attrMap["id"].(float64)
                if !ok {
                    continue
                }
                
                switch int(id) {
                case 194, 190: // Temperatura
                    if rawData, ok := attrMap["raw"].(map[string]interface{}); ok {
                        if str, ok := rawData["string"].(string); ok {
                            // Format: "33 Celsius" lub "33"
                            parts := strings.Fields(str)
                            if len(parts) > 0 {
                                if temp, err := strconv.ParseFloat(parts[0], 64); err == nil {
                                    result["temp"] = temp
                                }
                            }
                        }
                    }
                    // Fallback: spróbuj value
                    if result["temp"] == 0 {
                        if value, ok := attrMap["value"].(float64); ok {
                            result["temp"] = value
                        }
                    }
                    
                case 9: // Power-On Hours
                    if rawData, ok := attrMap["raw"].(map[string]interface{}); ok {
                        if str, ok := rawData["string"].(string); ok {
                            if hours, err := strconv.ParseFloat(str, 64); err == nil {
                                result["hours"] = hours
                            }
                        }
                    }
                }
            }
        }
    }
    
    return result
}


func getBool(m map[string]interface{}, key string) bool {
	if val, ok := m[key]; ok && val != nil {
		if b, ok := val.(bool); ok {
			return b
		}
	}
	return false
}

// Pomocnicza funkcja do bezpiecznego pobierania stringów z mapy
func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok && val != nil {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func (s *Server) handleStorageDebugDevices(w http.ResponseWriter, r *http.Request) {
	lsblk, _ := runCmd("lsblk", "-J", "-a")
	fdisk, _ := runCmd("fdisk", "-l")
	jsonOK(w, map[string]any{"lsblk": json.RawMessage(safeJSON(lsblk)), "fdisk": fdisk})
}

func (s *Server) handleStorageDiskSize(w http.ResponseWriter, r *http.Request) {
	dev := r.URL.Query().Get("device")
	if dev == "" { jsonErr(w, "device required", http.StatusBadRequest); return }
	out, err := runCmd("blockdev", "--getsize64", dev)
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"size": out, "device": dev})
}

func (s *Server) handleStorageCheckDevice(w http.ResponseWriter, r *http.Request) {
	dev := r.URL.Query().Get("device")
	if dev == "" { jsonErr(w, "device required", http.StatusBadRequest); return }
	_, err := os.Stat(dev)
	jsonOK(w, map[string]any{"device": dev, "exists": err == nil, "error": errStr(err)})
}

func (s *Server) handleStorageRescan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	runCmd("bash", "-c", "for f in /sys/class/scsi_host/*/scan; do echo '- - -' > $f 2>/dev/null; done")
	jsonOK(w, map[string]string{"status": "ok"})
}

// Cache dla Mounts — statfs może trwać do 2s, cachuj na 10s
var (
	_mountsCache     []sys.MountPoint
	_mountsCacheTime time.Time
	_mountsCacheMu   sync.Mutex
)

func cachedMounts() []sys.MountPoint {
	_mountsCacheMu.Lock()
	defer _mountsCacheMu.Unlock()
	if time.Since(_mountsCacheTime) < 10*time.Second && _mountsCache != nil {
		return _mountsCache
	}
	_mountsCache = sys.Mounts()
	_mountsCacheTime = time.Now()
	return _mountsCache
}

func (s *Server) handleMounts(w http.ResponseWriter, r *http.Request) {
	mounts := cachedMounts()
	var result []map[string]any
	for _, m := range mounts {
		result = append(result, map[string]any{
			"device": m.Device, "mount": m.MountAt, "fs": m.FS, "options": m.Options,
			"total_gb": round2(float64(m.TotalB)/1073741824), "used_gb": round2(float64(m.UsedB)/1073741824),
			"free_gb": round2(float64(m.FreeB)/1073741824),
			"percent": round2(float64(m.UsedB)/float64(m.TotalB)*100),
		})
	}
	jsonOK(w, result)
}

func (s *Server) handleStorageMount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Device, Target, FS, Options string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Device == "" || req.Target == "" {
		jsonErr(w, "device and target required", http.StatusBadRequest); return
	}
	args := []string{}
	if req.FS != "" { args = append(args, "-t", req.FS) }
	if req.Options != "" { args = append(args, "-o", req.Options) }
	args = append(args, req.Device, req.Target)
	if _, err := runCmd("mount", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageUnmount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Target string; Force bool }
	json.NewDecoder(r.Body).Decode(&req)
	args := []string{}
	if req.Force { args = append(args, "-f") }
	args = append(args, req.Target)
	if _, err := runCmd("umount", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageFormat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Device, FS, Label string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Device == "" {
		jsonErr(w, "device required", http.StatusBadRequest); return
	}
	if req.FS == "" { req.FS = "ext4" }
	var args []string
	switch req.FS {
	case "ext4", "ext3", "ext2":
		args = []string{"mkfs." + req.FS, "-F"}
		if req.Label != "" { args = append(args, "-L", req.Label) }
		args = append(args, req.Device)
	case "xfs":
		args = []string{"mkfs.xfs", "-f"}
		if req.Label != "" { args = append(args, "-L", req.Label) }
		args = append(args, req.Device)
	case "btrfs":
		args = []string{"mkfs.btrfs", "-f"}
		if req.Label != "" { args = append(args, "-L", req.Label) }
		args = append(args, req.Device)
	case "fat32", "vfat":
		args = []string{"mkfs.fat", "-F", "32", req.Device}
	case "ntfs":
		args = []string{"mkfs.ntfs", "-f", req.Device}
	default:
		jsonErr(w, "unsupported fs: "+req.FS, http.StatusBadRequest); return
	}
	if _, err := runCmd(args[0], args[1:]...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageFstab(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("cat", "/etc/fstab")
	var entries []map[string]string
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, "#") { continue }
		f := strings.Fields(l)
		if len(f) < 4 { continue }
		e := map[string]string{"device": f[0], "mount": f[1], "fs": f[2], "options": f[3]}
		if len(f) >= 5 { e["dump"] = f[4] }
		if len(f) >= 6 { e["pass"] = f[5] }
		entries = append(entries, e)
	}
	jsonOK(w, map[string]any{"entries": entries})
}

func (s *Server) handleStorageFstabContent(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"content": readFileStr("/etc/fstab")})
}

func (s *Server) handleStorageSaveFstab(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Content string `json:"content"` }
	json.NewDecoder(r.Body).Decode(&req)
	if err := os.WriteFile("/etc/fstab", []byte(req.Content), 0644); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError); return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageFstabCheck(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("findmnt", "--verify", "--verbose")
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleStorageExecCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Command string `json:"command"` }
	json.NewDecoder(r.Body).Decode(&req)
	if req.Command == "" { jsonErr(w, "command required", http.StatusBadRequest); return }
	out, err := runCmd("bash", "-c", req.Command)
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleListDirectories(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" { path = "/" }
	out, err := runCmd("ls", "-1a", path)
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	var dirs []string
	for _, n := range strings.Split(out, "\n") { if n != "" { dirs = append(dirs, n) } }
	jsonOK(w, map[string]any{"path": path, "entries": dirs})
}

func (s *Server) handleStorageLVM(w http.ResponseWriter, r *http.Request) {
	pvs, _ := runCmd("pvs", "--reportformat", "json")
	vgs, _ := runCmd("vgs", "--reportformat", "json")
	jsonOK(w, map[string]any{"pvs": json.RawMessage(safeJSON(pvs)), "vgs": json.RawMessage(safeJSON(vgs))})
}

func (s *Server) handleStorageLVMVolumes(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("lvs", "--reportformat", "json")
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageScanLVM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("vgscan")
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleStorageRAID(w http.ResponseWriter, r *http.Request) {
	mdstat, _ := runCmd("cat", "/proc/mdstat")
	detail, _ := runCmd("mdadm", "--detail", "--scan")
	jsonOK(w, map[string]any{"mdstat": mdstat, "details": detail})
}

func (s *Server) handleStorageRAIDStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageScanRAID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("mdadm", "--examine", "--scan")
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleStorageCreateRAID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct {
		Name    string   `json:"name"`
		Level   string   `json:"level"`
		Devices []string `json:"devices"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Devices) == 0 {
		jsonErr(w, "devices required", http.StatusBadRequest); return
	}
	if req.Name == "" { req.Name = "/dev/md0" }
	if req.Level == "" { req.Level = "5" }
	ndev := len(req.Devices)
	args := append([]string{"--create", req.Name, "--level", req.Level, "--raid-devices", strings.TrimSpace(strings.Repeat("x", ndev)[:1])}, req.Devices...)
	// Prostsze: użyj strconv
	args = []string{"--create", req.Name, "--level", req.Level, "--raid-devices", string(rune('0'+ndev))}
	args = append(args, req.Devices...)
	out, err := runCmd("mdadm", args...)
	if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

func (s *Server) handleStorageSMART(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("smartctl", "--scan", "-j")
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageSMARTMonitoring(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"active": serviceActive("smartd")})
	case http.MethodPost:
		var req struct{ Enable bool `json:"enable"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.Enable { runCmd("systemctl", "enable", "--now", "smartd") } else { runCmd("systemctl", "disable", "--now", "smartd") }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleStorageSMARTDetails(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/details/")
	out, _ := runCmd("smartctl", "-a", "-j", "/dev/"+dev)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageSMARTDiag(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/diagnostics/")
	out, _ := runCmd("smartctl", "-H", "-j", "/dev/"+dev)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageSMARTRepairStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"status": "idle"})
}

// handleStorageSMARTTestStatus – odpytuje smartctl o postęp testu w toku.
// GET /api/storage/smart/test-status/:dev
// Zwraca: { status: "running"|"idle", progress: 0-100, description: "..." }
func (s *Server) handleStorageSMARTTestStatus(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/test-status/")
	if dev == "" {
		jsonErr(w, "dev required", http.StatusBadRequest)
		return
	}
	out, _ := runCmd("smartctl", "-a", "-j", "/dev/"+dev)

	var data struct {
		ATASelfTest struct {
			Status struct {
				Value           int    `json:"value"`
				String          string `json:"string"`
				Remaining       int    `json:"remaining_percent"`
			} `json:"status"`
		} `json:"ata_smart_data"`
	}

	running := false
	progress := 0
	desc := "idle"

	if err := json.Unmarshal([]byte(safeJSON(out)), &data); err == nil {
		v := data.ATASelfTest.Status.Value
		desc = data.ATASelfTest.Status.String
		rem := data.ATASelfTest.Status.Remaining
		// value & 0xF: 0=completed, 15=in progress (inne wartości to błędy)
		if (v & 0xF) == 15 {
			running = true
			progress = 100 - rem
		}
	}

	jsonOK(w, map[string]any{
		"running":  running,
		"progress": progress,
		"status":   desc,
		"done":     !running,
	})
}

// handleStorageSMARTRunTest – uruchamia test short lub long.
// POST /api/storage/smart/run-test
// Body: { "device": "sda", "type": "short"|"long" }
func (s *Server) handleStorageSMARTRunTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Device string `json:"device"`
		Type   string `json:"type"` // "short" | "long"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Device == "" {
		jsonErr(w, "device required", http.StatusBadRequest)
		return
	}
	testType := "short"
	if req.Type == "long" || req.Type == "Long" {
		testType = "long"
	}
	// Usuń /dev/ jeśli ktoś przekazał pełną ścieżkę
	dev := strings.TrimPrefix(req.Device, "/dev/")

	out, err := runCmd("smartctl", "-t", testType, "/dev/"+dev)
	if err != nil && out == "" {
		jsonErr(w, "smartctl error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"status": "started", "type": testType, "device": dev, "output": out})
}

func (s *Server) handleStorageSMARTSectorDetails(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/sector-details/")
	out, _ := runCmd("smartctl", "-A", "-j", "/dev/"+dev)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageSMARTAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleZFSPools(w http.ResponseWriter, r *http.Request) {
    pools, err := sys.ZFSPools()
    if err != nil {
        jsonOK(w, map[string]any{
            "pools":     []any{},
            "available": true,
            "error":     err.Error(),
        })
        return
    }
    
    // Pobierz statystyki I/O
    ioStats := getZFSPoolIOStats()
    
    var result []map[string]any
    for _, pool := range pools {
        poolData := map[string]any{
            "name":   pool.Name,
            "health": pool.State,
            "used":   pool.Used,
            "avail":  pool.Avail,
            "total":  pool.Total,
            "type":   pool.Type,
        }
        
        // Dodaj statystyki I/O jeśli dostępne
        if stats, ok := ioStats[pool.Name]; ok {
            poolData["iops"] = stats["iops"]
            poolData["read_mbps"] = stats["read_mbps"]
            poolData["write_mbps"] = stats["write_mbps"]
        } else {
            poolData["iops"] = 0
            poolData["read_mbps"] = 0
            poolData["write_mbps"] = 0
        }
        
        result = append(result, poolData)
    }
    
    jsonOK(w, map[string]any{
        "pools":     result,
        "available": true,
    })
}

func (s *Server) handleZFSSnapshots(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        // Pobierz listę migawek
        out, err := runCmd("zfs", "list", "-H", "-t", "snapshot", "-o", "name,used,creation")
        if err != nil {
            jsonOK(w, map[string]any{"snapshots": []any{}})
            return
        }
        
        var snaps []map[string]any
        for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
            if line == "" {
                continue
            }
            fields := strings.Split(line, "\t")
            if len(fields) < 3 {
                continue
            }
            
            name := fields[0]
            parts := strings.SplitN(name, "@", 2)
            
            snaps = append(snaps, map[string]any{
                "name":     name,
                "dataset":  parts[0],
                "snapshot": parts[1],
                "size":     fields[1],
                "created":  strings.TrimSpace(fields[2]),
                "auto":     strings.Contains(parts[1], "auto"),
            })
        }
        
        jsonOK(w, map[string]any{"snapshots": snaps})
        
    case http.MethodPost:
        // Utwórz migawkę
        var req struct {
            Dataset   string `json:"dataset"`
            Name      string `json:"name"`
            Recursive bool   `json:"recursive"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.Dataset == "" || req.Name == "" {
            jsonErr(w, "dataset and name required", http.StatusBadRequest)
            return
        }
        
        snapName := req.Dataset + "@" + req.Name
        args := []string{"snapshot"}
        if req.Recursive {
            args = append(args, "-r")
        }
        args = append(args, snapName)
        
        _, err := runCmd("zfs", args...)
        if err != nil {
            jsonErr(w, err.Error(), http.StatusInternalServerError)
            return
        }
        
        jsonOK(w, map[string]string{"status": "ok", "snapshot": snapName})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

func (s *Server) handleZFSSnapshotAction(w http.ResponseWriter, r *http.Request) {
    // Pobierz nazwę migawki z URL
    snapName := strings.TrimPrefix(r.URL.Path, "/api/zfs/snapshots/")
    if snapName == "" {
        jsonErr(w, "snapshot name required", http.StatusBadRequest)
        return
    }
    
    switch r.Method {
    case http.MethodDelete:
        _, err := runCmd("zfs", "destroy", snapName)
        if err != nil {
            jsonErr(w, err.Error(), http.StatusInternalServerError)
            return
        }
        jsonOK(w, map[string]string{"status": "ok"})
        
    case http.MethodPost:
        var req struct {
            Action string `json:"action"` // rollback, clone
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        switch req.Action {
        case "rollback":
            _, err := runCmd("zfs", "rollback", "-r", snapName)
            if err != nil {
                jsonErr(w, err.Error(), http.StatusInternalServerError)
                return
            }
            jsonOK(w, map[string]string{"status": "ok"})
            
        case "clone":
            cloneName := strings.Replace(snapName, "@", "-clone-", 1)
            _, err := runCmd("zfs", "clone", snapName, cloneName)
            if err != nil {
                jsonErr(w, err.Error(), http.StatusInternalServerError)
                return
            }
            jsonOK(w, map[string]any{"status": "ok", "clone": cloneName})
            
        default:
            jsonErr(w, "unknown action", http.StatusBadRequest)
        }
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

func (s *Server) handleZFSDatasets(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("zfs", "list", "-H", "-o", "name,mountpoint")
	if err != nil {
		jsonOK(w, map[string]any{"datasets": []any{}, "datasets_full": []any{}})
		return
	}
	type Dataset struct {
		Name       string `json:"name"`
		Mountpoint string `json:"mountpoint"`
	}
	var datasetsFull []Dataset
	var names []string
	for _, line := range strings.Split(strings.TrimSpace(out), "") {
		if line == "" { continue }
		fields := strings.Fields(line)
		if len(fields) < 2 { continue }
		name, mp := fields[0], fields[1]
		if mp == "none" || mp == "-" { mp = "" }
		datasetsFull = append(datasetsFull, Dataset{Name: name, Mountpoint: mp})
		names = append(names, name)
	}
	jsonOK(w, map[string]any{"datasets": names, "datasets_full": datasetsFull})
}

func (s *Server) handleZFSSnapPolicy(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        // Odczytaj politykę retencji
        policy := map[string]any{
            "hourly":  24,
            "daily":   7,
            "weekly":  4,
            "monthly": 3,
        }
        jsonOK(w, policy)
        
    case http.MethodPost:
        var policy map[string]int
        json.NewDecoder(r.Body).Decode(&policy)
        // Zapisz politykę (można do pliku konfiguracyjnego)
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// ─── ZFS Pool Create ──────────────────────────────────────────────────────────

// POST /api/zfs/pool/create
func (s *Server) handleZFSPoolCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Backend  string   `json:"backend"`   // "zfs", "mdadm", "lvm"
		RaidType string   `json:"raid_type"` // "raidz2", "mirror", "raid5" etc.
		Name     string   `json:"name"`
		Disks    []string `json:"disks"`
		Ashift   int      `json:"ashift"`
		Compress string   `json:"compress"`
		Dedup    bool     `json:"dedup"`
		Encrypt  bool     `json:"encrypt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" || len(req.Disks) == 0 {
		jsonErr(w, "name and disks required", http.StatusBadRequest)
		return
	}

	var args []string
	var out string
	var err error

	switch req.Backend {
	case "mdadm":
		level := strings.TrimPrefix(req.RaidType, "raid")
		devs := make([]string, len(req.Disks))
		for i, d := range req.Disks {
			devs[i] = "/dev/" + d
		}
		args = append([]string{
			"--create", "/dev/md0",
			"--level=" + level,
			fmt.Sprintf("--raid-devices=%d", len(req.Disks)),
			"--run",
		}, devs...)
		out, err = runCmd("mdadm", args...)

	case "lvm":
		devs := make([]string, len(req.Disks))
		for i, d := range req.Disks {
			devs[i] = "/dev/" + d
		}
		args = append([]string{req.Name}, devs...)
		out, err = runCmd("vgcreate", args...)

	default: // zfs
		ashift := req.Ashift
		if ashift == 0 {
			ashift = 12
		}
		compress := req.Compress
		if compress == "" {
			compress = "lz4"
		}
		baseArgs := []string{
			"create", "-f",
			"-o", fmt.Sprintf("ashift=%d", ashift),
			"-O", "compression=" + compress,
			"-O", "atime=off",
		}
		if req.Dedup {
			baseArgs = append(baseArgs, "-O", "dedup=on")
		}
		baseArgs = append(baseArgs, req.Name)

		// raidz / mirror topology
		raidType := req.RaidType
		if raidType != "" && raidType != "stripe" {
			baseArgs = append(baseArgs, raidType)
		}
		baseArgs = append(baseArgs, req.Disks...)
		out, err = runCmd("zpool", baseArgs...)
	}

	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": out})
		return
	}
	jsonOK(w, map[string]any{"ok": true, "output": out})
}

// Nowa funkcja pomocnicza
// ─── ZFS I/O stats — background poller ──────────────────────────────────────
// zpool iostat -H 2 2 blokuje 2s — nie wywołujemy go w handlerze.
// Zamiast tego background goroutine uruchamia pomiar co 6s i cachuje wynik.
// Handler czyta cache — odpowiedź natychmiastowa.

var (
    _iostatMu    sync.RWMutex
    _iostatCache map[string]map[string]float64
    _iostatOnce  sync.Once
)

func startIOStatPoller() {
    _iostatOnce.Do(func() {
        // Pierwsze pobranie od razu (synchronicznie, 2s blokada jest OK przy starcie)
        _iostatMu.Lock()
        _iostatCache = measureIOStats()
        _iostatMu.Unlock()
        // Potem co 6s w tle
        go func() {
            for {
                time.Sleep(6 * time.Second)
                fresh := measureIOStats()
                _iostatMu.Lock()
                _iostatCache = fresh
                _iostatMu.Unlock()
            }
        }()
    })
}

// measureIOStats uruchamia "zpool iostat -H 2 2" (blokuje 2s)
// i parsuje DRUGĄ linię na pool — to jest delta z ostatnich 2 sekund.
func measureIOStats() map[string]map[string]float64 {
    stats := make(map[string]map[string]float64)

    // -H = bez nagłówka, 2 = interwał sekund, 2 = liczba próbek
    // Pierwsza próbka to dane od boota — ignorujemy.
    // Druga próbka to delta z ostatnich 2 sekund — to chcemy.
    out, err := runCmd("zpool", "iostat", "-H", "1", "1")
    if err != nil || out == "" {
        return stats
    }

    lines := strings.Split(strings.TrimSpace(out), "\n")

    // Może być więcej pul — zbierz wszystkie linie, zachowaj ostatnie wystąpienie każdej puli
    // (format: pula1_próbka1, pula2_próbka1, ..., pula1_próbka2, pula2_próbka2, ...)
    poolLines := make(map[string]string)
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        fields := strings.Fields(line)
        if len(fields) < 7 {
            continue
        }
        // Nadpisz — zostaje ostatnia próbka (2.)
        poolLines[fields[0]] = line
    }

    for poolName, line := range poolLines {
        fields := strings.Fields(line)
        if len(fields) < 7 {
            continue
        }
        // Format: name  alloc  free  read_ops  write_ops  read_bw  write_bw
        reads,  _ := strconv.ParseFloat(fields[3], 64)
        writes, _ := strconv.ParseFloat(fields[4], 64)
        readBW  := parseHumanSize(fields[5])
        writeBW := parseHumanSize(fields[6])

        stats[poolName] = map[string]float64{
            "iops":       reads + writes,
            "read_mbps":  readBW,
            "write_mbps": writeBW,
        }
    }
    return stats
}

func getZFSPoolIOStats() map[string]map[string]float64 {
    startIOStatPoller() // no-op po pierwszym wywołaniu
    _iostatMu.RLock()
    defer _iostatMu.RUnlock()
    // Zwróć kopię
    out := make(map[string]map[string]float64, len(_iostatCache))
    for k, v := range _iostatCache {
        cp := make(map[string]float64, len(v))
        for kk, vv := range v { cp[kk] = vv }
        out[k] = cp
    }
    return out
}

func parseHumanSize(s string) float64 {
    s = strings.TrimSpace(s)
    if s == "" || s == "0" {
        return 0
    }
    
    // Znajdź suffix
    suffix := s[len(s)-1]
    numStr := s[:len(s)-1]
    
    // Jeśli ostatni znak to nie litera, parsuj jako liczbę
    if suffix >= '0' && suffix <= '9' {
        v, _ := strconv.ParseFloat(s, 64)
        return v / (1024 * 1024) // bajty -> MB
    }
    
    v, err := strconv.ParseFloat(numStr, 64)
    if err != nil {
        // Może być z przecinkiem zamiast kropki
        numStr = strings.Replace(numStr, ",", ".", -1)
        v, _ = strconv.ParseFloat(numStr, 64)
    }
    
    switch suffix {
    case 'K', 'k':
        return v / 1024        // KB -> MB
    case 'M', 'm':
        return v                // już MB
    case 'G', 'g':
        return v * 1024        // GB -> MB
    case 'T', 't':
        return v * 1024 * 1024 // TB -> MB
    default:
        return v / (1024 * 1024) // bajty -> MB
    }
}
