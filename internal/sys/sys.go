package sys

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ─── CPU ────────────────────────────────────────────────────────────────────

type CPUSample struct {
	User   uint64
	System uint64
	Idle   uint64
	Total  uint64
}

func readCPUSample() CPUSample {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return CPUSample{}
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 8 {
			break
		}
		p := func(s string) uint64 { v, _ := strconv.ParseUint(s, 10, 64); return v }
		user := p(fields[1]) + p(fields[2])
		sys := p(fields[3])
		idle := p(fields[4]) + p(fields[5])
		total := user + sys + idle + p(fields[6]) + p(fields[7])
		return CPUSample{User: user, System: sys, Idle: idle, Total: total}
	}
	return CPUSample{}
}

// CPUPercent — patrz sysmon.go

func CPUInfo() map[string]string {
	info := map[string]string{"model": "Unknown", "cores": "1", "threads": "1", "freq_ghz": "0"}
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return info
	}
	cores := 0
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "model name") && info["model"] == "Unknown" {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				info["model"] = strings.TrimSpace(parts[1])
			}
		}
		if strings.HasPrefix(line, "processor") {
			cores++
		}
		if strings.HasPrefix(line, "cpu MHz") && info["freq_ghz"] == "0" {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				mhz, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
				info["freq_ghz"] = fmt.Sprintf("%.2f", mhz/1000)
			}
		}
	}
	info["cores"] = strconv.Itoa(cores)
	info["threads"] = strconv.Itoa(cores) // logical
	return info
}

func CPUTemp() float64 {
	// Try hwmon first
	matches, _ := filepath.Glob("/sys/class/hwmon/hwmon*/temp*_input")
	for _, p := range matches {
		data, err := os.ReadFile(p)
		if err == nil {
			v, _ := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
			if v > 1000 {
				return v / 1000
			}
		}
	}
	// Fallback: thermal_zone
	matches, _ = filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	for _, p := range matches {
		data, err := os.ReadFile(p)
		if err == nil {
			v, _ := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
			if v > 1000 {
				return v / 1000
			}
		}
	}
	return 0
}

func LoadAvg() [3]float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return [3]float64{}
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return [3]float64{}
	}
	p := func(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }
	return [3]float64{p(fields[0]), p(fields[1]), p(fields[2])}
}

// ─── Memory ─────────────────────────────────────────────────────────────────

type MemInfo struct {
	TotalKB     uint64
	FreeKB      uint64
	AvailableKB uint64
	BuffersKB   uint64
	CachedKB    uint64
	SwapTotalKB uint64
	SwapFreeKB  uint64
}

func Memory() MemInfo {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return MemInfo{}
	}
	m := MemInfo{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(fields[1], 10, 64)
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			m.TotalKB = val
		case "MemFree":
			m.FreeKB = val
		case "MemAvailable":
			m.AvailableKB = val
		case "Buffers":
			m.BuffersKB = val
		case "Cached":
			m.CachedKB = val
		case "SwapTotal":
			m.SwapTotalKB = val
		case "SwapFree":
			m.SwapFreeKB = val
		}
	}
	return m
}

// ─── Network ────────────────────────────────────────────────────────────────

type NetIface struct {
	Name  string
	RxB   uint64
	TxB   uint64
	State string
	IP    string
	MAC   string
	Speed string
}

func NetInterfaces() []NetIface {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}
	var ifaces []NetIface
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		if lineNo <= 2 {
			continue
		}
		line := scanner.Text()
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colonIdx])
		fields := strings.Fields(line[colonIdx+1:])
		if len(fields) < 9 {
			continue
		}
		rxB, _ := strconv.ParseUint(fields[0], 10, 64)
		txB, _ := strconv.ParseUint(fields[8], 10, 64)

		state := "down"
		stateData, _ := os.ReadFile("/sys/class/net/" + name + "/operstate")
		if strings.TrimSpace(string(stateData)) == "up" {
			state = "up"
		}

		ip := ""
		macData, _ := os.ReadFile("/sys/class/net/" + name + "/address")
		mac := strings.TrimSpace(string(macData))

		speedData, _ := os.ReadFile("/sys/class/net/" + name + "/speed")
		speedMbps, _ := strconv.ParseInt(strings.TrimSpace(string(speedData)), 10, 64)
		speed := ""
		switch {
		case speedMbps >= 10000:
			speed = "10 GbE"
		case speedMbps >= 1000:
			speed = "1 GbE"
		case speedMbps > 0:
			speed = fmt.Sprintf("%d Mbps", speedMbps)
		}

		// Get IP via /proc/net/if_inet6 or ip command
		out, _ := exec.Command("ip", "-brief", "addr", "show", name).Output()
		for _, l := range strings.Split(string(out), "\n") {
			fields := strings.Fields(l)
			if len(fields) >= 3 {
				for _, f := range fields[2:] {
					if strings.Contains(f, ".") {
						ip = strings.Split(f, "/")[0]
						break
					}
				}
			}
		}

		ifaces = append(ifaces, NetIface{
			Name:  name,
			RxB:   rxB,
			TxB:   txB,
			State: state,
			IP:    ip,
			MAC:   mac,
			Speed: speed,
		})
	}
	return ifaces
}

type NetSpeed struct {
	RxMBs float64
	TxMBs float64
}

func NetSpeed1s(iface string) NetSpeed {
	read := func() (uint64, uint64) {
		data, err := os.ReadFile("/proc/net/dev")
		if err != nil {
			return 0, 0
		}
		for _, line := range strings.Split(string(data), "\n") {
			colonIdx := strings.Index(line, ":")
			if colonIdx < 0 {
				continue
			}
			if strings.TrimSpace(line[:colonIdx]) != iface {
				continue
			}
			fields := strings.Fields(line[colonIdx+1:])
			if len(fields) < 9 {
				return 0, 0
			}
			rx, _ := strconv.ParseUint(fields[0], 10, 64)
			tx, _ := strconv.ParseUint(fields[8], 10, 64)
			return rx, tx
		}
		return 0, 0
	}
	rx1, tx1 := read()
	time.Sleep(500 * time.Millisecond)
	rx2, tx2 := read()
	return NetSpeed{
		RxMBs: float64(rx2-rx1) / 500000,
		TxMBs: float64(tx2-tx1) / 500000,
	}
}

// ─── Disks ──────────────────────────────────────────────────────────────────

type DiskStat struct {
	Device string
	ReadKB uint64
	WriteKB uint64
}

func DiskIO() []DiskStat {
	data, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return nil
	}
	var out []DiskStat
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 14 {
			continue
		}
		dev := fields[2]
		// Only physical disks (sda, nvme0n1, etc.)
		if !strings.HasPrefix(dev, "sd") && !strings.HasPrefix(dev, "nvme") && !strings.HasPrefix(dev, "hd") {
			continue
		}
		if strings.ContainsAny(dev[len(dev)-1:], "0123456789") && strings.HasPrefix(dev, "sd") {
			continue // skip partitions like sda1
		}
		readSect, _ := strconv.ParseUint(fields[5], 10, 64)
		writeSect, _ := strconv.ParseUint(fields[9], 10, 64)
		out = append(out, DiskStat{
			Device:  dev,
			ReadKB:  readSect / 2,
			WriteKB: writeSect / 2,
		})
	}
	return out
}

type MountPoint struct {
	Device  string
	MountAt string
	FS      string
	Options string
	TotalB  uint64
	UsedB   uint64
	FreeB   uint64
}

func Mounts() []MountPoint {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []MountPoint
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		dev, mp, fs, opts := fields[0], fields[1], fields[2], fields[3]
		if fs == "proc" || fs == "sysfs" || fs == "devtmpfs" || fs == "cgroup" || fs == "cgroup2" ||
			fs == "tmpfs" || fs == "devpts" || fs == "securityfs" || fs == "pstore" ||
			fs == "mqueue" || fs == "hugetlbfs" || fs == "debugfs" || fs == "tracefs" ||
			fs == "fusectl" || fs == "overlay" || strings.HasPrefix(mp, "/sys") ||
			strings.HasPrefix(mp, "/proc") || strings.HasPrefix(mp, "/dev") ||
			strings.HasPrefix(mp, "/run") {
			continue
		}
		if seen[mp] {
			continue
		}
		seen[mp] = true

		// statfs z timeoutem — zawieszone NFS/CIFS blokuje w nieskończoność
		type statResult struct {
			mp    MountPoint
			ok    bool
		}
		ch := make(chan statResult, 1)
		mpCopy, devCopy, fsCopy, optsCopy := mp, dev, fs, opts
		go func() {
			var stat syscallStatfs
			if err := statfs(mpCopy, &stat); err == nil {
				total := stat.Bsize * int64(stat.Blocks)
				free  := stat.Bsize * int64(stat.Bfree)
				ch <- statResult{ok: true, mp: MountPoint{
					Device:  devCopy,
					MountAt: mpCopy,
					FS:      fsCopy,
					Options: optsCopy,
					TotalB:  uint64(total),
					UsedB:   uint64(total - free),
					FreeB:   uint64(free),
				}}
			} else {
				ch <- statResult{ok: false}
			}
		}()
		select {
		case res := <-ch:
			if res.ok {
				out = append(out, res.mp)
			}
		case <-time.After(2 * time.Second):
			// Punkt montowania nie odpowiada — pomijamy
		}
	}
	return out
}

// ─── Processes ──────────────────────────────────────────────────────────────

type Process struct {
	PID  int
	Name string
	User string
	CPU  float64
	Mem  float64
}

// Processes — patrz sysmon.go
func collectProcs(s1, s2 CPUSample) []Process {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

	// Get total memory for % calc
	mem := Memory()
	totalKB := float64(mem.TotalKB)

	totalTicks := float64(s2.Total - s1.Total)

	var procs []Process
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		statData, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if err != nil {
			continue
		}
		statStr := string(statData)
		// Extract name between parens
		start := strings.Index(statStr, "(")
		end := strings.LastIndex(statStr, ")")
		if start < 0 || end < 0 {
			continue
		}
		name := statStr[start+1 : end]
		rest := strings.Fields(statStr[end+2:])
		if len(rest) < 14 {
			continue
		}
		utime, _ := strconv.ParseFloat(rest[11], 64)
		stime, _ := strconv.ParseFloat(rest[12], 64)
		cpuPct := 0.0
		if totalTicks > 0 {
			cpuPct = (utime + stime) / totalTicks * 100
		}

		// RSS memory
		statusData, _ := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		rssKB := 0.0
		for _, line := range strings.Split(string(statusData), "\n") {
			if strings.HasPrefix(line, "VmRSS:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					rssKB, _ = strconv.ParseFloat(fields[1], 64)
				}
				break
			}
		}
		memPct := 0.0
		if totalKB > 0 {
			memPct = rssKB / totalKB * 100
		}

		// Get UID -> username
		user := ""
		loginData, _ := os.ReadFile(fmt.Sprintf("/proc/%d/loginuid", pid))
		uid := strings.TrimSpace(string(loginData))
		if uid != "" && uid != "4294967295" {
			if uidInt, err := strconv.Atoi(uid); err == nil {
				user = uidToName(uidInt)
			}
		}

		procs = append(procs, Process{
			PID:  pid,
			Name: name,
			User: user,
			CPU:  cpuPct,
			Mem:  memPct,
		})
	}
	return procs
}

var uidCache = map[int]string{}

func uidToName(uid int) string {
	if name, ok := uidCache[uid]; ok {
		return name
	}
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return strconv.Itoa(uid)
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) < 4 {
			continue
		}
		if parts[2] == strconv.Itoa(uid) {
			uidCache[uid] = parts[0]
			return parts[0]
		}
	}
	name := strconv.Itoa(uid)
	uidCache[uid] = name
	return name
}

// ─── Uptime / Hostname ───────────────────────────────────────────────────────

func Uptime() time.Duration {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	secs, _ := strconv.ParseFloat(fields[0], 64)
	return time.Duration(secs) * time.Second
}

func Hostname() string {
	h, _ := os.Hostname()
	return h
}

// ─── Kernel version ─────────────────────────────────────────────────────────

func KernelVersion() string {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return "unknown"
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		return fields[2]
	}
	return strings.TrimSpace(string(data))
}

// ─── Logs ───────────────────────────────────────────────────────────────────

type LogEntry struct {
	Time string `json:"t"`
	Src  string `json:"src"`
	Lvl  string `json:"lvl"`
	Msg  string `json:"msg"`
}

func JournalLogs(n int) []LogEntry {
	out, err := exec.Command("journalctl", "-n", strconv.Itoa(n), "--no-pager",
		"-o", "short-iso", "--utc").Output()
	if err != nil {
		return fallbackSyslog(n)
	}
	var entries []LogEntry
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		// Format: 2024-01-01T12:34:56+0000 hostname unit[pid]: message
		parts := strings.SplitN(line, " ", 4)
		if len(parts) < 4 {
			continue
		}
		t := parts[0]
		if len(t) > 16 {
			t = t[11:16] // HH:MM
		}
		unitParts := strings.SplitN(parts[2], "[", 2)
		src := strings.TrimSuffix(unitParts[0], ":")

		msg := strings.TrimSpace(parts[3])
		lvl := "INFO"
		lower := strings.ToLower(msg)
		switch {
		case strings.Contains(lower, "error") || strings.Contains(lower, "failed") || strings.Contains(lower, "fail"):
			lvl = "ERROR"
		case strings.Contains(lower, "warn") || strings.Contains(lower, "warning"):
			lvl = "WARN"
		case strings.Contains(lower, "debug"):
			lvl = "DEBUG"
		case strings.Contains(lower, "ok") || strings.Contains(lower, "success"):
			lvl = "OK"
		}

		entries = append(entries, LogEntry{Time: t, Src: src, Lvl: lvl, Msg: msg})
	}
	return entries
}

func fallbackSyslog(n int) []LogEntry {
	files := []string{"/var/log/syslog", "/var/log/messages"}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		start := 0
		if len(lines) > n {
			start = len(lines) - n
		}
		var out []LogEntry
		for _, line := range lines[start:] {
			fields := strings.Fields(line)
			if len(fields) < 4 {
				continue
			}
			src := strings.TrimSuffix(fields[3], ":")
			msg := strings.Join(fields[4:], " ")
			out = append(out, LogEntry{
				Time: fields[2],
				Src:  src,
				Lvl:  "INFO",
				Msg:  msg,
			})
		}
		return out
	}
	return nil
}

// ─── Docker ─────────────────────────────────────────────────────────────────

type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`
	Status string `json:"uptime"`
	CPU    float64 `json:"cpu"`
	Mem    float64 `json:"mem"`
	Ports  string  `json:"ports"`
}

func DockerContainers() ([]Container, error) {
	out, err := exec.Command("docker", "ps", "-a",
		"--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}").Output()
	if err != nil {
		return nil, err
	}
	var containers []Container
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 5 {
			continue
		}
		id := parts[0]
		name := parts[1]
		image := parts[2]
		state := parts[3]
		status := parts[4]
		ports := ""
		if len(parts) >= 6 {
			ports = parts[5]
		}

		// Get CPU/mem stats (non-blocking, best-effort)
		cpu, mem := containerStats(id)

		containers = append(containers, Container{
			ID:     id[:min(12, len(id))],
			Name:   name,
			Image:  image,
			State:  state,
			Status: status,
			CPU:    cpu,
			Mem:    mem,
			Ports:  ports,
		})
	}
	return containers, nil
}

func containerStats(id string) (float64, float64) {
	out, err := exec.Command("docker", "stats", "--no-stream", "--format",
		"{{.CPUPerc}}\t{{.MemUsage}}", id).Output()
	if err != nil {
		return 0, 0
	}
	parts := strings.Split(strings.TrimSpace(string(out)), "\t")
	if len(parts) < 2 {
		return 0, 0
	}
	cpuStr := strings.TrimSuffix(parts[0], "%")
	cpu, _ := strconv.ParseFloat(cpuStr, 64)

	memStr := strings.Split(parts[1], " / ")[0]
	mem := parseMem(memStr)
	return cpu, mem
}

func parseMem(s string) float64 {
	s = strings.TrimSpace(s)
	mult := 1.0
	if strings.HasSuffix(s, "GiB") {
		mult = 1024
		s = strings.TrimSuffix(s, "GiB")
	} else if strings.HasSuffix(s, "MiB") {
		s = strings.TrimSuffix(s, "MiB")
	} else if strings.HasSuffix(s, "kB") {
		mult = 1.0 / 1024
		s = strings.TrimSuffix(s, "kB")
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v * mult
}

func DockerAction(name, action string) error {
	switch action {
	case "start", "stop", "restart":
		return exec.Command("docker", action, name).Run()
	}
	return fmt.Errorf("unknown action: %s", action)
}

// ─── ZFS ────────────────────────────────────────────────────────────────────

type ZFSPool struct {
    Name   string  `json:"name"`
    State  string  `json:"health"`
    Used   float64 `json:"used"`    // w GB
    Avail  float64 `json:"avail"`   // w GB
    Total  float64 `json:"total"`   // w GB
    Type   string  `json:"type"`
    UsedTB  float64 `json:"used_tb"`  // w TB dla wygody
    AvailTB float64 `json:"avail_tb"`
    TotalTB float64 `json:"total_tb"`
}

type ZFSIOStats struct {
    Pool    string
    Reads   float64 // operacje odczytu na sekundę
    Writes  float64 // operacje zapisu na sekundę
    ReadMB  float64 // MB/s odczytu
    WriteMB float64 // MB/s zapisu
}

func ZFSPools() ([]ZFSPool, error) {
    zpoolPath := findZpoolPath()
    if zpoolPath == "" {
        return nil, fmt.Errorf("zpool not found")
    }
    
    out, err := exec.Command(zpoolPath, "list", "-H", "-o", "name,health,alloc,free,size").Output()
    if err != nil {
        return nil, fmt.Errorf("zpool list failed: %w", err)
    }
    
    var pools []ZFSPool
    for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
        if line == "" {
            continue
        }
        fields := strings.Fields(line)
        if len(fields) < 5 {
            continue
        }
        
        health := "ok"
        if fields[1] != "ONLINE" {
            health = strings.ToLower(fields[1])
        }
        
        // Zachowaj oryginalne wartości w GB
        allocGB := parseZFSSizeToGB(fields[2])  // ALLOC
        freeGB := parseZFSSizeToGB(fields[3])   // FREE  
        sizeGB := parseZFSSizeToGB(fields[4])   // SIZE
        
        pools = append(pools, ZFSPool{
            Name:    fields[0],
            State:   health,
            Used:    allocGB,
            Avail:   freeGB,
            Total:   sizeGB,
            UsedTB:  allocGB / 1024,
            AvailTB: freeGB / 1024,
            TotalTB: sizeGB / 1024,
            Type:    "ZFS",
        })
    }
    
    return pools, nil
}

func ZFSPoolIOStats() (map[string]ZFSIOStats, error) {
    zpoolPath := "/usr/sbin/zpool"
    if _, err := os.Stat(zpoolPath); os.IsNotExist(err) {
        zpoolPath = "/sbin/zpool"
    }
    
    out, err := exec.Command(zpoolPath, "iostat", "-Hp", "1", "1").Output()
    if err != nil {
        out, err = exec.Command(zpoolPath, "iostat", "-H", "1", "1").Output()
        if err != nil {
            return nil, err
        }
    }
    
    stats := make(map[string]ZFSIOStats)
    lines := strings.Split(strings.TrimSpace(string(out)), "\n")
    
    for _, line := range lines {
        if line == "" || strings.HasPrefix(line, "pool") {
            continue
        }
        
        fields := strings.Fields(line)
        if len(fields) < 7 {
            continue
        }
        
        poolName := fields[0]

        var reads, writes, readBW, writeBW float64
        
        if len(fields) >= 11 {
            // Nowy format z większą ilością kolumn
            reads, _ = strconv.ParseFloat(fields[5], 64)
            writes, _ = strconv.ParseFloat(fields[6], 64)
            readBW, _ = strconv.ParseFloat(fields[7], 64)
            writeBW, _ = strconv.ParseFloat(fields[8], 64)
        } else if len(fields) >= 9 {
            reads, _ = strconv.ParseFloat(fields[3], 64)
            writes, _ = strconv.ParseFloat(fields[4], 64)
            readBW, _ = strconv.ParseFloat(fields[5], 64)
            writeBW, _ = strconv.ParseFloat(fields[6], 64)
        }
        
        stats[poolName] = ZFSIOStats{
            Pool:    poolName,
            Reads:   reads,
            Writes:  writes,
            ReadMB:  readBW / (1024 * 1024),
            WriteMB: writeBW / (1024 * 1024),
        }
    }
    
    return stats, nil
}

// Nowa funkcja - zwraca wartość w GB
func parseZFSSizeToGB(s string) float64 {
    if len(s) == 0 {
        return 0
    }
    
    s = strings.TrimSpace(s)
    if s == "0" || s == "-" {
        return 0
    }
    
    suffix := s[len(s)-1]
    numStr := s[:len(s)-1]
    v, _ := strconv.ParseFloat(numStr, 64)
    
    switch suffix {
    case 'T':
        return v * 1024  // TB -> GB
    case 'G':
        return v          // już GB
    case 'M':
        return v / 1024  // MB -> GB
    case 'K':
        return v / 1024 / 1024  // KB -> GB
    }
    return v
}

func findZpoolPath() string {
    paths := []string{"/usr/sbin/zpool", "/sbin/zpool", "/usr/bin/zpool", "/bin/zpool"}
    for _, path := range paths {
        if _, err := os.Stat(path); err == nil {
            return path
        }
    }
    if p, err := exec.LookPath("zpool"); err == nil {
        return p
    }
    return ""
}

func parseZFSSize(s string) float64 {
	if len(s) == 0 {
		return 0
	}
	suffix := s[len(s)-1]
	numStr := s[:len(s)-1]
	v, _ := strconv.ParseFloat(numStr, 64)
	switch suffix {
	case 'T':
		return v
	case 'G':
		return v / 1024
	case 'M':
		return v / 1024 / 1024
	case 'K':
		return v / 1024 / 1024 / 1024
	}
	return v
}

// ─── Users ──────────────────────────────────────────────────────────────────

type LocalUser struct {
	Name   string   `json:"name"`
	Login  string   `json:"login"`
	UID    int      `json:"uid"`
	Groups []string `json:"groups"`
	Shell  string   `json:"shell"`
}

func LocalUsers() []LocalUser {
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return nil
	}
	var users []LocalUser
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) < 7 {
			continue
		}
		uid, _ := strconv.Atoi(parts[2])
		if uid < 1000 && uid != 0 {
			continue // skip system users (except root)
		}
		login := parts[0]
		shell := parts[6]
		if strings.Contains(shell, "nologin") || strings.Contains(shell, "false") {
			continue
		}
		groups := userGroups(login)
		users = append(users, LocalUser{
			Name:   parts[4],
			Login:  login,
			UID:    uid,
			Groups: groups,
			Shell:  shell,
		})
	}
	return users
}

func userGroups(user string) []string {
	out, err := exec.Command("groups", user).Output()
	if err != nil {
		return nil
	}
	// Output: "user : group1 group2 ..."
	parts := strings.SplitN(string(out), ":", 2)
	if len(parts) < 2 {
		return nil
	}
	var groups []string
	for _, g := range strings.Fields(parts[1]) {
		groups = append(groups, g)
	}
	return groups
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
