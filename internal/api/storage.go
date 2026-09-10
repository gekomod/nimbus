package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"nimbus/internal/sys"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

func (s *Server) handleStorageDevices(w http.ResponseWriter, r *http.Request) {
	out, listErr := storageReadCommand("lsblk", "-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,VENDOR,TRAN,ROTA,RM,RO")
	if listErr != nil { jsonErr(w, "lsblk: "+out+listErr.Error(), 503); return }

	if out == "" {
		jsonErr(w, "lsblk nie zwrócił poprawnej listy urządzeń", 502)
		return
	}

	// Parsuj JSON z lsblk
	var lsblkData struct {
		Blockdevices []map[string]interface{} `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(out), &lsblkData); err != nil {
		jsonErr(w, "lsblk nie zwrócił poprawnej listy urządzeń", 502)
		return
	}

	mountedBases := map[string]bool{}
	for _, dev := range lsblkData.Blockdevices {
		if blockTreeMounted(dev) { mountedBases[getString(dev,"name")] = true }
	}

	poolMap := getZFSPoolDiskMapping()
	zfsPoolMountpoints := getZFSPoolMountpoints()
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
		// Dysk może mieć system plików na całym urządzeniu albo na partycji.
		// Zwróć frontendowi dokładne urządzenie do montowania zamiast zgadywać "sdX1".
		mountDevice := "/dev/" + name
		mountFS := getString(dev, "fstype")
		mountPoint := getString(dev, "mountpoint")
		if children, ok := dev["children"].([]interface{}); ok {
			for _, rawChild := range children {
				child, ok := rawChild.(map[string]interface{})
				if !ok {
					continue
				}
				childFS := getString(child, "fstype")
				if childFS == "" {
					continue
				}
				mountDevice = "/dev/" + getString(child, "name")
				mountFS = childFS
				mountPoint = getString(child, "mountpoint")
				break
			}
		}
		device["mount_device"] = mountDevice
		if device["fs"] == "" {
			device["fs"] = mountFS
		}
		if device["mount"] == "" {
			device["mount"] = mountPoint
		}

		// ZFS pool mapping
		if poolName, exists := poolMap[name]; exists {
			device["pool"] = poolName
		} else {
			device["pool"] = nil
		}

		// Ma zamontowane partycje (dysk systemowy, dane itp.) — front użyje tego do klasyfikacji
		// Dyski będące członkami puli ZFS nie mają własnego MOUNTPOINT w lsblk
		// (ZFS montuje na poziomie puli/datasetu, nie surowego dysku/partycji),
		// więc trzeba je oznaczyć jako zamontowane osobno.
		hasMounted := mountedBases[name]
		if poolName, exists := poolMap[name]; exists {
			hasMounted = true
			if mp, ok := zfsPoolMountpoints[poolName]; ok && mp != "" {
				if device["mount"] == "" {
					device["mount"] = mp
				}
			}
		}
		device["has_mounted_parts"] = hasMounted

		// SMART data - tylko dla dysków fizycznych
		if devType == "disk" {
			smartData := cachedStorageSMART(name)
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
					devName := resolveBlockDiskName(devPath)
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

// resolveBlockDiskName zwraca nazwę dysku bazowego (np. "sdb") dla dowolnej
// ścieżki urządzenia zwróconej przez "zpool status -P" — w tym symlinków
// /dev/disk/by-id/...-part1, które NIE dają się poprawnie rozbić samym
// obcięciem cyfr z końca (np. "...-part1" → "...-part" to nie jest nazwa dysku).
// Korzysta z lsblk, które poprawnie rozwiązuje symlinki i zna hierarchię
// dysk → partycja niezależnie od formatu ścieżki wejściowej.
func resolveBlockDiskName(devPath string) string {
	// Jeśli to partycja, PKNAME zwróci nazwę dysku nadrzędnego (np. "sdb")
	if pk, _ := runCmd("lsblk", "-no", "PKNAME", devPath); pk != "" {
		return strings.TrimSpace(pk)
	}
	// Nie partycja (cały dysk bez tablicy partycji) — weź nazwę samego urządzenia
	if nm, _ := runCmd("lsblk", "-no", "NAME", devPath); nm != "" {
		return strings.TrimSpace(nm)
	}
	return ""
}

// Funkcja pomocnicza - mountpointy pul ZFS (zpool sam w sobie nie ma
// "MOUNTPOINT" w lsblk, bo montowanie odbywa się na poziomie datasetu ZFS,
// nie surowego dysku — więc trzeba to pobrać osobno przez "zfs list").
func getZFSPoolMountpoints() map[string]string {
	result := make(map[string]string)

	out, _ := runCmd("zfs", "list", "-H", "-o", "name,mountpoint")
	if out == "" {
		return result
	}

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		mp := fields[1]
		if mp == "none" || mp == "-" {
			continue
		}
		// Interesuje nas tylko dataset najwyższego poziomu (name == nazwa puli,
		// bez "/" w nazwie) — to on odpowiada bezpośrednio zpoolowi.
		if !strings.Contains(name, "/") {
			result[name] = mp
		}
	}

	return result
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

// ─── SMART: auto-detekcja trybu (bezpośrednio vs kontroler HP cciss/hpsa) ──
//
// Na serwerach HP ProLiant za kontrolerem Smart Array (P4xx itp.) smartctl
// wymaga jawnego "-d cciss,N", inaczej zwraca błąd "requires option '-d cciss,N'"
// i dane SMART w panelu są puste. Poniższy mechanizm:
//  1. Próbuje odpytać dysk bezpośrednio (zwykłe SATA/SAS/NVMe bez RAID).
//  2. Jeśli się nie uda, iteruje "-d cciss,0..15" PRZEZ WŁASNĄ ścieżkę /dev/sdX
//     tego urządzenia, aż znajdzie działający indeks. Przy typowej konfiguracji
//     "RAID 0 na pojedynczym dysku per bay" indeks jest liczony względem
//     danego woluminu, więc np. -d cciss,0 przez /dev/sda i to samo -d cciss,0
//     przez /dev/sdb poprawnie zwracają DWA RÓŻNE fizyczne dyski — nie wolno
//     tego "optymalizować" przez wspólne wyliczanie listy dysków przez jedno
//     urządzenie, bo to psuje wynik dla pozostałych.
//  3. Jeśli smartctl w żadnym trybie nie odpowie, ostatnia deska ratunku to
//     ssacli (oficjalne narzędzie HP) dopasowane po numerze seryjnym — nie
//     ma pełnej tabeli atrybutów SMART, ale przynajmniej temperaturę/status.
//  4. Zapamiętuje wynik w cache (per nazwa urządzenia), żeby kolejne odpytania
//     panelu (co kilka sekund) nie skanowały tego za każdym razem od nowa.

var (
	_smartModeCache   = map[string]string{} // "sda" -> "" (bezpośrednio) albo "cciss,0" albo "ssacli"
	_smartModeCacheMu sync.RWMutex
)

// ── ssacli — oficjalne narzędzie HP (Smart Storage Administrator CLI) ──────
//
// Używane WYŁĄCZNIE jako fallback, gdy smartctl (bezpośrednio ani przez
// żaden indeks cciss) w ogóle nie odpowiada dla danego urządzenia — ssacli
// nie udostępnia pełnej tabeli atrybutów SMART (tylko temperaturę/status/
// numer seryjny wprost z kontrolera RAID), więc nie powinien przesłaniać
// działającego smartctl.

// ── ssacli — oficjalne narzędzie HP (Smart Storage Administrator CLI) ──────
//
// Używane jako uzupełnienie/weryfikacja smartctl — patrz getCachedSSACLIDiskMap
// poniżej, które łączy "pd all show detail" (dane fizycznego dysku) z
// "ld all show detail" (mapowanie /dev/sdX -> fizyczny dysk).

const ssacliDrivesCacheTTL = 5 * time.Minute

// findSSACLIControllerSlots wykrywa numer(y) slotu kontrolera HP Smart Array
// (np. "Smart Array P410i in Slot 0 (Embedded)" -> 0). Jeśli detekcja się nie
// powiedzie, zwraca [0] — najczęstszy przypadek (jeden wbudowany kontroler).
func findSSACLIControllerSlots() []int {
	toolPath := findSSACLITool()
	if toolPath == "" {
		return nil
	}
	out, err := ssacliRun(toolPath, "ctrl", "all", "show", "status")
	if err != nil || out == "" {
		return nil
	}
	re := regexp.MustCompile(`(?i)in Slot (\d+)`)
	var slots []int
	seen := map[int]bool{}
	for _, m := range re.FindAllStringSubmatch(out, -1) {
		n, err := strconv.Atoi(m[1])
		if err == nil && !seen[n] {
			seen[n] = true
			slots = append(slots, n)
		}
	}
	return slots
}

// parseSSACLIPhysicalDrives parsuje tekstowy output
// "ssacli ctrl slot=N pd all show detail" na listę fizycznych dysków.
// Format (przykład):
//
//	physicaldrive 1I:1:1
//	   Bay: 1
//	   Status: OK
//	   Serial Number: XXXXXXXXXXXX
//	   Model: HP EG0300FBVFQ
//	   Current Temperature (C): 34
func parseSSACLIPhysicalDrives(out string) []map[string]interface{} {
	var drives []map[string]interface{}
	var current map[string]interface{}

	flush := func() {
		if current == nil {
			return
		}
		if _, ok := current["temp"]; !ok {
			current["temp"] = 0.0
		}
		if _, ok := current["hours"]; !ok {
			// ssacli nie udostępnia liczby godzin pracy (to atrybut SMART,
			// nie metadana kontrolera RAID) — jawnie zaznaczamy brak.
			current["hours"] = 0.0
			current["hours_available"] = false
		}
		if _, ok := current["status"]; !ok {
			current["status"] = "unknown"
		}
		current["source"] = "ssacli"
		drives = append(drives, current)
	}

	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "physicaldrive ") {
			flush()
			current = map[string]interface{}{
				"id": strings.TrimSpace(strings.TrimPrefix(line, "physicaldrive")),
			}
			continue
		}
		if current == nil {
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
			if n, err := strconv.Atoi(val); err == nil {
				current["bay"] = n
			}
		case "Box":
			if n, err := strconv.Atoi(val); err == nil {
				current["box"] = n
			}
		case "Port":
			current["port"] = val
		case "Status":
			current["raid_status"] = val
			if strings.EqualFold(val, "OK") {
				current["status"] = "passed"
			} else {
				current["status"] = "warn"
			}
		case "Serial Number":
			current["serial_number"] = val
		case "Model":
			current["model"] = val
		case "Size":
			current["size"] = val
		case "Interface Type":
			current["interface"] = val
		case "Rotational Speed":
			current["rotational_speed"] = val
		case "Current Temperature (C)":
			if f, err := strconv.ParseFloat(val, 64); err == nil {
				current["temp"] = f
			}
		}
	}
	flush()
	return drives
}

// ── ssacli: mapowanie /dev/sdX -> fizyczny dysk (Disk Name) ────────────────
//
// To jest KLUCZOWY element całej układanki. Adresowanie "-d cciss,N" okazuje
// się być globalne na cały kontroler (nie per-wolumin, jak wcześniej
// zakładałem) — więc /dev/sdg może potrzebować np. "-d cciss,5", a inne
// urządzenie zupełnie innego indeksu, bez żadnego prostego wzoru
// (alfabetyczna kolejność liter NIE musi odpowiadać kolejności indeksów).
// Jedynym pewnym źródłem prawdy "które /dev/sdX to który fizyczny dysk" jest
// sam ssacli: "ssacli ctrl slot=N ld all show detail" dla każdego woluminu
// logicznego podaje wprost "Disk Name: /dev/sdX" ORAZ powiązany
// "physicaldrive X:X:X (port ...:box ...:bay N, ...)". Łącząc to z numerem
// seryjnym z "pd all show detail" (patrz parseSSACLIPhysicalDrives), można
// zweryfikować, KTÓRY indeks cciss,N naprawdę odpowiada temu urządzeniu —
// zamiast zgadywać.
//
// Uwaga: to działa w pełni niezawodnie dla woluminów z JEDNYM dyskiem
// fizycznym (typowe "RAID 0 per bay") — czyli dokładnie ten przypadek, o
// którym mowa. Dla woluminów z wieloma dyskami (RAID1/5/6) SMART pojedynczego
// dysku i tak nie ma jednoznacznego sensu (dane są rozproszone/mirrorowane),
// więc taki przypadek pomijamy.

// parseSSACLILogicalDriveDiskNames parsuje "ssacli ctrl slot=N ld all show
// detail" i zwraca mapę "/dev/sdX" -> ID fizycznego dysku (np. "1I:1:5").
// Przykładowy fragment output:
//
//	Logical Drive: 1
//	   ...
//	   Disk Name: /dev/sda
//	   ...
//	   physicaldrive 1I:1:1 (port 1I:box 1:bay 1, SAS, 300 GB, OK)
func parseSSACLILogicalDriveDiskNames(out string) map[string]string {
	result := map[string]string{}
	var diskName, pdID string

	flush := func() {
		if diskName != "" && pdID != "" {
			result[diskName] = pdID
		}
		diskName, pdID = "", ""
	}

	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "Logical Drive:") {
			flush() // nowy wolumin logiczny — zapisz poprzedni i zacznij od nowa
			continue
		}
		if strings.HasPrefix(line, "Disk Name:") {
			diskName = strings.TrimSpace(strings.TrimPrefix(line, "Disk Name:"))
			continue
		}
		if strings.HasPrefix(line, "physicaldrive ") {
			fields := strings.Fields(strings.TrimPrefix(line, "physicaldrive "))
			if len(fields) > 0 && pdID == "" {
				// Bierzemy pierwszy — dla wolumenów wielodyskowych (RAID1/5/6)
				// i tak nie ma jednoznacznego "tego jednego" dysku, ale nie
				// chcemy nadpisywać już znalezionego ID kolejnymi wpisami.
				pdID = fields[0]
			}
			continue
		}
	}
	flush()
	return result
}

var (
	_ssacliDiskMapCache       map[string]map[string]interface{}
	_ssacliDiskMapCacheAt     time.Time
	_ssacliDiskMapCacheMu     sync.Mutex
	_ssacliPhysicalDriveCount int // liczba fizycznych dysków wg ssacli (0 = nieznana)
	_ssacliPhysicalCache      []map[string]interface{}
)

func getCachedSSACLIPhysicalDrives() []map[string]interface{} {
	_ssacliDiskMapCacheMu.Lock()
	defer _ssacliDiskMapCacheMu.Unlock()
	if _ssacliPhysicalCache != nil && time.Since(_ssacliDiskMapCacheAt) < ssacliDrivesCacheTTL {
		return _ssacliPhysicalCache
	}
	toolPath := findSSACLITool()
	if toolPath == "" {
		return nil
	}
	var drives []map[string]interface{}
	slots := findSSACLIControllerSlots()
	if len(slots) == 0 {
		slots = []int{0}
	}
	for _, slot := range slots {
		out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", slot), "pd", "all", "show", "detail")
		if err == nil {
			drives = append(drives, parseSSACLIPhysicalDrives(out)...)
		}
	}
	_ssacliPhysicalCache = drives
	_ssacliPhysicalDriveCount = len(drives)
	_ssacliDiskMapCacheAt = time.Now()
	return drives
}

func ssacliSMARTJSON(d map[string]interface{}, name string) map[string]interface{} {
	status, _ := d["status"].(string)
	result := map[string]interface{}{
		"device":map[string]interface{}{"name":name,"type":"cciss","protocol":"HP Smart Array"},
		"model_name":d["model"],"serial_number":d["serial_number"],
		"temperature":map[string]interface{}{"current":d["temp"]},
		"power_on_time":map[string]interface{}{"hours":d["hours"]},
		"nimbus_source":"ssacli",
	}
	if status=="passed" || status=="ok" {result["smart_status"]=map[string]bool{"passed":true}}
	if status=="warn" || status=="failed" {result["smart_status"]=map[string]bool{"passed":false}}
	return result
}

// getCachedSSACLIDiskMap zwraca mapę "/dev/sdX" -> dane fizycznego dysku
// (bay/serial/temp/status), łącząc "ld all show detail" (Disk Name -> ID
// dysku) z "pd all show detail" (ID dysku -> reszta danych). Przy okazji
// zapisuje też CAŁKOWITĄ liczbę fizycznych dysków (patrz getSSACLIDriveCount)
// — dzięki temu skanowanie indeksów cciss nie musi zgadywać "do ilu",
// tylko wie dokładnie ile dysków szuka.
func getCachedSSACLIDiskMap() map[string]map[string]interface{} {
	_ssacliDiskMapCacheMu.Lock()
	defer _ssacliDiskMapCacheMu.Unlock()

	if _ssacliDiskMapCache != nil && time.Since(_ssacliDiskMapCacheAt) < ssacliDrivesCacheTTL {
		return _ssacliDiskMapCache
	}

	result := map[string]map[string]interface{}{}
	pdByID := map[string]map[string]interface{}{}

	if toolPath := findSSACLITool(); toolPath != "" {
		slots := findSSACLIControllerSlots()
		if len(slots) == 0 {
			slots = []int{0}
		}

		for _, slot := range slots {
			out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", slot), "pd", "all", "show", "detail")
			if err != nil || strings.TrimSpace(out) == "" {
				continue
			}
			for _, d := range parseSSACLIPhysicalDrives(out) {
				if id, ok := d["id"].(string); ok && id != "" {
					pdByID[id] = d
				}
			}
		}

		for _, slot := range slots {
			out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", slot), "ld", "all", "show", "detail")
			if err != nil || strings.TrimSpace(out) == "" {
				continue
			}
			for diskName, pdID := range parseSSACLILogicalDriveDiskNames(out) {
				if d, ok := pdByID[pdID]; ok {
					result[diskName] = d
				}
			}
		}
	}

	_ssacliDiskMapCache = result
	_ssacliDiskMapCacheAt = time.Now()
	_ssacliPhysicalDriveCount = len(pdByID)
	return result
}

// getSSACLIDriveCount zwraca ile fizycznych dysków faktycznie zgłasza ssacli
// (np. 25 przy układzie 5×5) — wywołuje getCachedSSACLIDiskMap, jeśli jeszcze
// nie wiadomo. Zwraca 0, gdy ssacli jest niedostępny/nic nie zgłosił.
func getSSACLIDriveCount() int {
	_ssacliDiskMapCacheMu.Lock()
	known := _ssacliDiskMapCache != nil && time.Since(_ssacliDiskMapCacheAt) < ssacliDrivesCacheTTL
	_ssacliDiskMapCacheMu.Unlock()
	if !known {
		getCachedSSACLIDiskMap()
	}
	_ssacliDiskMapCacheMu.Lock()
	defer _ssacliDiskMapCacheMu.Unlock()
	return _ssacliPhysicalDriveCount
}

var (
	_ccissSerialIndexCache   map[string]string // "SERIALNUMBER" -> "cciss,5"
	_ccissSerialIndexCacheAt time.Time
	_ccissSerialIndexCacheMu sync.Mutex
)

const ccissSerialIndexCacheTTL = 10 * time.Minute

type smartCacheEntry struct {
	data map[string]interface{}
	at   time.Time
}

var (
	_smartDataCache   = map[string]smartCacheEntry{}
	_smartDataCacheMu sync.RWMutex
	_smartProbeMu     sync.Mutex
)

const smartDataCacheTTL = 10 * time.Minute

// buildCcissSerialIndex skanuje indeksy cciss,0..N-1 RAZ dla całego
// kontrolera (adresowanie jest globalne — wynik jest identyczny niezależnie
// od tego, przez które /dev/sdX pytamy), budując tabelę "numer seryjny -> tryb".
// N to rzeczywista liczba fizycznych dysków wg ssacli (np. 25 przy układzie
// 5×5) — NIE ma sensu skanować więcej indeksów, niż dysków faktycznie jest.
// Jeśli ssacli nie podał liczby dysków, używamy bezpiecznego, małego
// domyślnego zakresu (16) zamiast zgadywania w ciemno do 32+.
//
// To jest kluczowe dla wydajności: bez tej tabeli trzeba by dla KAŻDEGO
// dysku z osobna próbować kolejne indeksy smartctl (a każde wywołanie
// smartctl na kontrolerze HP trwa ~1-2s) — przy 20-30 dyskach dawało to
// minuty ładowania. Z tabelą wystarczy przeskanować kontroler raz (i to
// pojedynczo i wyłącznie po świadomym włączeniu NIMBUS_HP_SMART_PROBE=1), a
// dopasowanie konkretnego dysku to już tylko odczyt z mapy.
func buildCcissSerialIndex(anyDevPath string) map[string]string {
	// Sondowanie wszystkich indeksów cciss obciąża firmware Smart Array.
	// Jest wyłączone domyślnie; panel korzysta wtedy z bezpiecznych danych ssacli.
	if os.Getenv("NIMBUS_HP_SMART_PROBE") != "1" {
		return map[string]string{}
	}
	maxIndex := getSSACLIDriveCount()
	if maxIndex <= 0 {
		maxIndex = 16 // ssacli niedostępny/nic nie zgłosił — bezpieczny, mały domyślny zakres
	}

	type probeResult struct {
		mode   string
		serial string
		found  bool
	}
	results := make([]probeResult, maxIndex)

	const maxConcurrent = 1
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup

	for i := 0; i < maxIndex; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			time.Sleep(250 * time.Millisecond)

			mode := fmt.Sprintf("cciss,%d", i)
			data := trySmartctl(anyDevPath, mode)
			if data == nil {
				return
			}
			sn, _ := data["serial_number"].(string)
			if sn == "" {
				return
			}
			results[i] = probeResult{mode: mode, serial: sn, found: true}
		}(i)
	}
	wg.Wait()

	index := map[string]string{}
	for _, r := range results {
		if r.found {
			index[strings.ToUpper(strings.TrimSpace(r.serial))] = r.mode
		}
	}
	return index
}

// getCachedCcissSerialIndex — jak wyżej, z cache (ccissSerialIndexCacheTTL),
// żeby kolejne odpytania panelu (co kilka sekund) nie skanowały kontrolera
// od nowa za każdym razem.
func getCachedCcissSerialIndex(anyDevPath string) map[string]string {
	_ccissSerialIndexCacheMu.Lock()
	defer _ccissSerialIndexCacheMu.Unlock()

	if _ccissSerialIndexCache != nil && time.Since(_ccissSerialIndexCacheAt) < ccissSerialIndexCacheTTL {
		return _ccissSerialIndexCache
	}
	_ccissSerialIndexCache = buildCcissSerialIndex(anyDevPath)
	_ccissSerialIndexCacheAt = time.Now()
	return _ccissSerialIndexCache
}

// Funkcja pomocnicza - pobieranie danych S.M.A.R.T.
// lsblkSerial to numer seryjny, jaki dla TEGO konkretnego /dev/sdX zwraca
// samo lsblk — używane tylko jako pomoc przy dopasowaniu do ssacli w
// ostatniej instancji (patrz niżej).
func getSMARTData(device string, lsblkSerial string) map[string]interface{} {
	_smartDataCacheMu.RLock()
	if e, ok := _smartDataCache[device]; ok && time.Since(e.at) < smartDataCacheTTL {
		_smartDataCacheMu.RUnlock()
		return e.data
	}
	_smartDataCacheMu.RUnlock()
	_smartProbeMu.Lock()
	defer _smartProbeMu.Unlock()
	// Drugi request mógł uzupełnić cache podczas oczekiwania na pojedynczą kolejkę.
	_smartDataCacheMu.RLock()
	if e, ok := _smartDataCache[device]; ok && time.Since(e.at) < smartDataCacheTTL {
		_smartDataCacheMu.RUnlock()
		return e.data
	}
	_smartDataCacheMu.RUnlock()
	data := getSMARTDataUncached(device, lsblkSerial)
	_smartDataCacheMu.Lock()
	_smartDataCache[device] = smartCacheEntry{data: data, at: time.Now()}
	_smartDataCacheMu.Unlock()
	return data
}

func getSMARTDataUncached(device string, lsblkSerial string) map[string]interface{} {
	devPath := "/dev/" + device

	if _, err := os.Stat(devPath); os.IsNotExist(err) {
		return nil
	}

	if _, err := exec.LookPath("smartctl"); err != nil {
		if pd, ok := getCachedSSACLIDiskMap()[devPath]; ok {
			return pd
		}
		return nil
	}

	// Na HP Smart Array zwykły odczyt listy dysków nie może automatycznie
	// brute-force'ować cciss,N. Dane temperatury/stanu z ssacli są wystarczające
	// dla widoku Storage i nie wybudzają/nie blokują każdego dysku osobno.
	if pd, ok := getCachedSSACLIDiskMap()[devPath]; ok && os.Getenv("NIMBUS_HP_SMART_PROBE") != "1" {
		_smartModeCacheMu.Lock()
		_smartModeCache[device] = "ssacli"
		_smartModeCacheMu.Unlock()
		return pd
	}

	// Sprawdź czy już znamy działający tryb dla tego urządzenia
	_smartModeCacheMu.RLock()
	knownMode, known := _smartModeCache[device]
	_smartModeCacheMu.RUnlock()

	if known && knownMode != "ssacli" {
		if data := trySmartctl(devPath, knownMode); data != nil {
			return data
		}
		// Cache się zdezaktualizował (np. dysk usunięty/zmieniony) — spróbuj od nowa
		_smartModeCacheMu.Lock()
		delete(_smartModeCache, device)
		_smartModeCacheMu.Unlock()
	}

	// 1. Spróbuj bezpośrednio (zwykłe dyski SATA/SAS/NVMe bez RAID)
	if data := trySmartctl(devPath, ""); data != nil {
		_smartModeCacheMu.Lock()
		_smartModeCache[device] = ""
		_smartModeCacheMu.Unlock()
		return data
	}

	// 2. Kontroler HP (cciss/hpsa) — adresowanie "-d cciss,N" jest globalne
	// na cały kontroler (potwierdzone: dla /dev/sdg właściwy indeks to np. 5,
	// nie 0 i nie coś wynikającego z alfabetycznej kolejności /dev/sdX).
	// Dlatego NIE zgadujemy przez "pierwszy indeks, który odpowie" — zamiast
	// tego pytamy ssacli, który fizyczny dysk (Bay/Serial Number) faktycznie
	// kryje się pod tym konkretnym /dev/sdX ("Disk Name" w "ld all show
	// detail"), a potem sprawdzamy oczekiwany numer seryjny w RAZ zbudowanej
	// tabeli "serial -> cciss,N" (buildCcissSerialIndex) — bez tej tabeli
	// trzeba by próbować do 32 indeksów smartctl PER DYSK, co przy 20-30
	// dyskach dawało minuty ładowania.
	if pd, ok := getCachedSSACLIDiskMap()[devPath]; ok {
		expectedSerial, _ := pd["serial_number"].(string)
		if expectedSerial != "" {
			serialIndex := getCachedCcissSerialIndex(devPath)
			if mode, ok := serialIndex[strings.ToUpper(strings.TrimSpace(expectedSerial))]; ok {
				if data := trySmartctl(devPath, mode); data != nil {
					_smartModeCacheMu.Lock()
					_smartModeCache[device] = mode
					_smartModeCacheMu.Unlock()
					return data
				}
			}
		}
		// smartctl nie potwierdził żadnego indeksu (np. nie zainstalowany albo
		// nieobsługiwana wersja sterownika) — zwróć dane wprost z ssacli.
		// Brak pełnej tabeli atrybutów, ale bay/serial/temperatura/status są
		// pewne (pochodzą wprost z kontrolera, nie ze zgadywania).
		_smartModeCacheMu.Lock()
		_smartModeCache[device] = "ssacli"
		_smartModeCacheMu.Unlock()
		return pd
	}

	// 3. ssacli nie dał mapowania Disk Name -> /dev/sdX dla tego urządzenia
	// (starsza wersja ssacli bez pola "Disk Name", albo wolumin złożony z
	// więcej niż jednego fizycznego dysku, gdzie SMART pojedynczego dysku
	// i tak nie ma jednoznacznego sensu). Ostatnia deska ratunku — sprawdź
	// numer seryjny z lsblk w tej samej, już zbudowanej tabeli.
	if lsblkSerial != "" {
		serialIndex := getCachedCcissSerialIndex(devPath)
		if mode, ok := serialIndex[strings.ToUpper(strings.TrimSpace(lsblkSerial))]; ok {
			if data := trySmartctl(devPath, mode); data != nil {
				_smartModeCacheMu.Lock()
				_smartModeCache[device] = mode
				_smartModeCacheMu.Unlock()
				return data
			}
		}
	}

	// 4. Nic się nie dopasowało po numerze seryjnym — ostatnia deska ratunku:
	// weź pierwszy dostępny wpis z tabeli i WYRAŹNIE oznacz jako niepewny,
	// żeby UI mogło to zasygnalizować zamiast po cichu pokazywać błędne dane.
	for _, mode := range getCachedCcissSerialIndex(devPath) {
		data := trySmartctl(devPath, mode)
		if data == nil {
			continue
		}
		data["match_confidence"] = "unconfirmed"
		_smartModeCacheMu.Lock()
		_smartModeCache[device] = mode
		_smartModeCacheMu.Unlock()
		return data
	}

	return nil
}

// resolveSmartArgs zwraca gotowe argumenty smartctl (z ewentualnym -d) dla
// danego urządzenia, korzystając z tego samego cache co getSMARTData.
// Używane przez handlery details/diag/test-status/run-test/sector-details,
// żeby też działały poprawnie za kontrolerem HP.
func resolveSmartArgs(device string, baseArgs []string) []string {
	devPath := "/dev/" + device

	_smartModeCacheMu.RLock()
	mode, known := _smartModeCache[device]
	_smartModeCacheMu.RUnlock()

	if !known {
		// Nie znamy jeszcze trybu — wymuś detekcję (wywoła też cache'owanie).
		// Potrzebny jest numer seryjny z lsblk, żeby dopasować właściwy
		// fizyczny dysk za kontrolerem cciss (patrz komentarz w getSMARTData).
		serial, _ := runCmd("lsblk", "-no", "SERIAL", devPath)
		getSMARTData(device, strings.TrimSpace(serial))
		_smartModeCacheMu.RLock()
		mode, known = _smartModeCache[device]
		_smartModeCacheMu.RUnlock()
	}

	args := append([]string{}, baseArgs...)
	// "ssacli" nie jest prawidłowym trybem "-d" dla smartctl — to tylko
	// wewnętrzny znacznik cache oznaczający "dane pochodzą z ssacli, a nie
	// z bezpośredniego smartctl". W tym wypadku smartctl i tak nie potrafi
	// odpytać dysku (stąd trzeba było sięgnąć po ssacli), więc głębsze
	// operacje smartctl (self-test, sector details) nie zadziałają — nie
	// dokładamy -d, żeby polecenie zawiodło jawnie zamiast po cichu użyć
	// błędnego trybu.
	if known && mode != "" && mode != "ssacli" {
		args = append(args, "-d", mode)
	}
	args = append(args, devPath)
	return args
}

// trySmartctl wykonuje smartctl -a [-d mode] -j <devPath> i parsuje wynik.
// Zwraca nil jeśli urządzenie niedostępne w tym trybie (zły indeks cciss,
// brak dysku, kontroler nie obsługuje itd.).
func trySmartctl(devPath, mode string) map[string]interface{} {
	args := []string{"-a", "-j"}
	if mode != "" {
		args = append(args, "-d", mode)
	}
	args = append(args, devPath)

	out, _ := storageReadCommand("smartctl", args...)
	if out == "" {
		return nil
	}

	return parseStorageSMARTSummary(out)
}

func parseStorageSMARTSummary(out string) map[string]interface{} {
	var smartData map[string]interface{}
	if err := json.Unmarshal([]byte(out), &smartData); err != nil {
		return nil
	}

	// smartctl w trybie -j wypisuje błędy jako "smartctl.messages" —
	// sprawdź czy to nie jest błąd typu "requires option '-d cciss,N'".
	if smartctlInfo, ok := smartData["smartctl"].(map[string]interface{}); ok {
		if messages, ok := smartctlInfo["messages"].([]interface{}); ok {
			for _, m := range messages {
				if msg, ok := m.(map[string]interface{}); ok {
					if str, ok := msg["string"].(string); ok {
						if strings.Contains(str, "requires option") ||
							strings.Contains(str, "Unable to detect device type") ||
							strings.Contains(str, "No such device") {
							return nil
						}
					}
				}
			}
		}
	}

	// Musi mieć realne dane atrybutów (ATA) albo log zdrowia (NVMe),
	// inaczej to nie jest prawidłowa odpowiedź z fizycznego dysku.
	_, hasAta := smartData["ata_smart_attributes"]
	_, hasNvme := smartData["nvme_smart_health_information_log"]
	_, hasSCSIHealth := smartData["smart_status"]
	_, hasSCSIDefects := smartData["scsi_grown_defect_list"]
	if !hasAta && !hasNvme && !hasSCSIHealth && !hasSCSIDefects {
		return nil
	}

	result := map[string]interface{}{
		"temp":   0,
		"hours":  0,
		"status": "unknown",
	}

	// Numer seryjny — potrzebny do dopasowania fizycznego dysku po drugiej
	// stronie kontrolera cciss/hpsa (patrz getSMARTData / ssacli fallback)
	if sn, ok := smartData["serial_number"].(string); ok {
		result["serial_number"] = sn
	}

	// Ogólny stan zdrowia
	if smartStatus, ok := smartData["smart_status"].(map[string]interface{}); ok {
		if passed, ok := smartStatus["passed"].(bool); ok {
			if passed {
				result["status"] = "passed"
			} else {
				result["status"] = "warn"
			}
		}
	}

	// Atrybuty ATA
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

	// Fallback dla NVMe (nie dotyczy P410, ale przyda się na innym sprzęcie)
	if nvmeData, ok := smartData["nvme_smart_health_information_log"].(map[string]interface{}); ok {
		if temp, ok := nvmeData["temperature"].(float64); ok {
			result["temp"] = temp
		}
		if hours, ok := nvmeData["power_on_hours"].(float64); ok {
			result["hours"] = hours
		}
	}

	if temperature, ok := smartData["temperature"].(map[string]interface{}); ok {
		if value, ok := temperature["current"].(float64); ok { result["temp"] = value }
	}
	if power, ok := smartData["power_on_time"].(map[string]interface{}); ok {
		if value, ok := power["hours"].(float64); ok { result["hours"] = value }
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
	if dev == "" {
		jsonErr(w, "device required", http.StatusBadRequest)
		return
	}
	out, err := runCmd("blockdev", "--getsize64", dev)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"size": out, "device": dev})
}

func (s *Server) handleStorageCheckDevice(w http.ResponseWriter, r *http.Request) {
	dev := r.URL.Query().Get("device")
	if dev == "" {
		jsonErr(w, "device required", http.StatusBadRequest)
		return
	}
	_, err := os.Stat(dev)
	jsonOK(w, map[string]any{"device": dev, "exists": err == nil, "error": errStr(err)})
}

func (s *Server) handleStorageRescan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
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

type fstabEntry struct {
	Source  string
	Target  string
	FS      string
	Options string
	Dump    string
	Pass    string
}

func parseFstab(content string) []fstabEntry {
	entries := make([]fstabEntry, 0)
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		entry := fstabEntry{Source: fields[0], Target: fields[1], FS: fields[2], Options: fields[3]}
		if len(fields) > 4 {
			entry.Dump = fields[4]
		}
		if len(fields) > 5 {
			entry.Pass = fields[5]
		}
		entries = append(entries, entry)
	}
	return entries
}

func fstabEntryMatches(entry fstabEntry, device, target, uuid string) bool {
	if target != "" && filepath.Clean(decodeFstabField(entry.Target)) == filepath.Clean(target) {
		return true
	}
	if device != "" && decodeFstabField(entry.Source) == device {
		return true
	}
	return uuid != "" && entry.Source == "UUID="+uuid
}

func fstabHasMount(entries []fstabEntry, device, target, uuid string) bool {
	for _, entry := range entries {
		if fstabEntryMatches(entry, device, target, uuid) {
			return true
		}
	}
	return false
}

// updateFstabEntry zachowuje komentarze i niepowiązane wpisy, a wpis dla
// danego urządzenia/punktu zastępuje w całości. Dzięki temu zmiana UUID albo
// punktu montowania nie tworzy duplikatów.
func updateFstabEntry(content, device, target, uuid, fs, options string, enable bool) string {
	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")
	kept := make([]string, 0, len(lines)+1)
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		fields := strings.Fields(line)
		if line != "" && !strings.HasPrefix(line, "#") && len(fields) >= 4 {
			entry := fstabEntry{Source: fields[0], Target: fields[1], FS: fields[2], Options: fields[3]}
			if (enable && fstabEntryMatches(entry, device, target, uuid)) || (!enable && filepath.Clean(decodeFstabField(entry.Target))==filepath.Clean(target)) {
				continue
			}
		}
		if raw != "" || len(kept) > 0 {
			kept = append(kept, raw)
		}
	}
	if enable {
		source := device
		if uuid != "" {
			source = "UUID=" + uuid
		}
		if fs == "" {
			fs = "auto"
		}
		if options == "" {
			options = "defaults,nofail"
		}
		kept = append(kept, fmt.Sprintf("%s\t%s\t%s\t%s\t0\t2", encodeFstabField(source), encodeFstabField(target), fs, options))
	}
	return strings.TrimRight(strings.Join(kept, "\n"), "\n") + "\n"
}

type fstabValidationError struct{ output string }

func (e fstabValidationError) Error() string {
	return "nieprawidłowy fstab: " + strings.TrimSpace(e.output)
}

func validateFstabContent(content string) (string, error) {
	tmp, err := os.CreateTemp("", "fstab.nimbus-check-*")
	if err != nil {
		return "", err
	}
	path := tmp.Name()
	defer os.Remove(path)
	if _, err = tmp.WriteString(content); err != nil {
		tmp.Close()
		return "", err
	}
	if err = tmp.Close(); err != nil {
		return "", err
	}
	out, err := runCmd("findmnt", "--verify", "--verbose", "--tab-file", path)
	if err != nil {
		return out, fstabValidationError{output: out}
	}
	return out, nil
}

func saveFstabContent(content string) (string, error) {
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	out, err := validateFstabContent(content)
	if err != nil {
		return out, err
	}
	tmp, err := os.CreateTemp("/etc", "fstab.nimbus-*")
	if err != nil {
		return out, err
	}
	path := tmp.Name()
	defer os.Remove(path)
	if _, err = tmp.WriteString(content); err != nil {
		tmp.Close()
		return out, err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return out, err
	}
	if err = tmp.Close(); err != nil {
		return out, err
	}
	if err = os.Chmod(path, 0644); err != nil {
		return out, err
	}
	current := readFileStr("/etc/fstab")
	if err = os.WriteFile("/etc/fstab.nimbus-backup", []byte(current), 0644); err != nil {
		return out, fmt.Errorf("nie można utworzyć kopii fstab: %w", err)
	}
	if err = os.Rename(path, "/etc/fstab"); err != nil {
		return out, err
	}
	return out, nil
}

func invalidateMountsCache() {
	_mountsCacheMu.Lock()
	_mountsCacheTime = time.Time{}
	_mountsCacheMu.Unlock()
}

func (s *Server) handleMounts(w http.ResponseWriter, r *http.Request) {
	mounts := cachedMounts()
	entries := parseFstab(readFileStr("/etc/fstab"))
	var result []map[string]any
	for _, m := range mounts {
		percent := 0.0
		if m.TotalB > 0 {
			percent = round2(float64(m.UsedB) / float64(m.TotalB) * 100)
		}
		uuid := ""
		if strings.HasPrefix(m.Device, "/dev/") {
			uuid, _ = runCmd("blkid", "-s", "UUID", "-o", "value", m.Device)
		}
		inFstab := fstabHasMount(entries, m.Device, m.MountAt, strings.TrimSpace(uuid))
		result = append(result, map[string]any{
			"device": m.Device, "mount": m.MountAt, "fs": m.FS, "options": m.Options,
			"total_gb": round2(float64(m.TotalB) / 1073741824), "used_gb": round2(float64(m.UsedB) / 1073741824),
			"free_gb": round2(float64(m.FreeB) / 1073741824),
			"percent": percent, "in_fstab": inFstab,
		})
	}
	jsonOK(w, result)
}

func (s *Server) handleStorageMount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Device  string `json:"device"`
		Target  string `json:"target"`
		FS      string `json:"fs"`
		Options string `json:"options"`
		Persist bool   `json:"persist"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Device == "" || req.Target == "" {
		jsonErr(w, "device and target required", http.StatusBadRequest)
		return
	}
	req.Device = strings.TrimSpace(req.Device)
	req.Target = filepath.Clean(strings.TrimSpace(req.Target))
	if !strings.HasPrefix(req.Device, "/dev/") || strings.Contains(req.Device, "..") {
		jsonErr(w, "dozwolone są wyłącznie lokalne urządzenia /dev/...", http.StatusBadRequest)
		return
	}
	if req.Target == "/" || !strings.HasPrefix(req.Target, "/mnt/") {
		jsonErr(w, "punkt montowania musi znajdować się w /mnt/", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat(req.Device); err != nil {
		jsonErr(w, "urządzenie nie istnieje: "+req.Device, http.StatusBadRequest)
		return
	}
	if out, _ := runCmd("findmnt", "-rn", "-S", req.Device); out != "" {
		jsonErr(w, "urządzenie jest już zamontowane: "+out, http.StatusConflict)
		return
	}
	if err := os.MkdirAll(req.Target, 0755); err != nil {
		jsonErr(w, "nie można utworzyć punktu montowania: "+err.Error(), http.StatusInternalServerError)
		return
	}
	args := []string{}
	if req.FS != "" {
		args = append(args, "-t", req.FS)
	}
	if req.Options != "" {
		args = append(args, "-o", req.Options)
	}
	args = append(args, req.Device, req.Target)
	if out, err := runCmd("mount", args...); err != nil {
		_ = os.Remove(req.Target)
		jsonErr(w, "mount: "+strings.TrimSpace(out), http.StatusInternalServerError)
		return
	}
	uuid, _ := runCmd("blkid", "-s", "UUID", "-o", "value", req.Device)
	if req.Persist {
		fstabWriteMu.Lock(); defer fstabWriteMu.Unlock()
		current := readFileStr("/etc/fstab")
		updated := updateFstabEntry(current, req.Device, req.Target, strings.TrimSpace(uuid), req.FS, req.Options, true)
		if _, err := saveFstabContent(updated); err != nil {
			runCmd("umount", req.Target)
			jsonErr(w, "zamontowano, ale zapis fstab nie powiódł się: "+err.Error(), 500)
			return
		}
	}
	invalidateMountsCache()
	jsonOK(w, map[string]string{"status": "ok", "device": req.Device, "target": req.Target, "uuid": strings.TrimSpace(uuid)})
}

func (s *Server) handleStorageUnmount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Target string
		Force  bool
		Lazy bool
	}
	if json.NewDecoder(r.Body).Decode(&req)!=nil || !filepath.IsAbs(req.Target) || isSystemMountPath(req.Target) {jsonErr(w,"nieprawidłowy lub systemowy punkt montowania",400);return}
	args := []string{}
	if req.Lazy {args=append(args,"-l")}
	if req.Force {
		args = append(args, "-f")
	}
	args = append(args, req.Target)
	if out, err := runCmd("umount", args...); err != nil {
		jsonErr(w, storageCommandError(out,err), http.StatusInternalServerError)
		return
	}
	invalidateMountsCache()
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageFormat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Device, FS, Label string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Device == "" {
		jsonErr(w, "device required", http.StatusBadRequest)
		return
	}
	if req.FS == "" {
		req.FS = "ext4"
	}
	req.Device = strings.TrimSpace(req.Device)
	if !strings.HasPrefix(req.Device, "/dev/") || strings.Contains(req.Device, "..") {
		jsonErr(w, "nieprawidłowe urządzenie", http.StatusBadRequest)
		return
	}
	if out, err := runCmd("lsblk", "-dn", "-o", "TYPE", req.Device); err != nil || strings.TrimSpace(out) == "" {
		jsonErr(w, "urządzenie blokowe nie istnieje: "+req.Device, http.StatusBadRequest)
		return
	}
	if out, _ := runCmd("lsblk", "-nr", "-o", "MOUNTPOINT", req.Device); strings.TrimSpace(out) != "" {
		jsonErr(w, "nie można formatować urządzenia ani dysku z zamontowaną partycją: "+strings.TrimSpace(out), http.StatusConflict)
		return
	}

	// ZFS to zupełnie inna operacja niż mkfs.* — tworzy pulę (zpool create),
	// która montuje się automatycznie, więc obsługujemy to osobno i wracamy
	// od razu (bez późniejszego kroku "mount", o który poprosi front dla
	// klasycznych systemów plików).
	if req.FS == "zfs" {
		label := req.Label
		if label == "" {
			label = strings.TrimPrefix(req.Device, "/dev/")
		}
		out, err := runCmd("zpool", "create", "-f", "-o", "ashift=12", label, req.Device)
		if err != nil {
			jsonErr(w, "zpool create failed: "+out+" "+err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok", "pool": label})
		return
	}

	var args []string
	switch req.FS {
	case "ext4", "ext3", "ext2":
		args = []string{"mkfs." + req.FS, "-F"}
		if req.Label != "" {
			args = append(args, "-L", req.Label)
		}
		args = append(args, req.Device)
	case "xfs":
		args = []string{"mkfs.xfs", "-f"}
		if req.Label != "" {
			args = append(args, "-L", req.Label)
		}
		args = append(args, req.Device)
	case "btrfs":
		args = []string{"mkfs.btrfs", "-f"}
		if req.Label != "" {
			args = append(args, "-L", req.Label)
		}
		args = append(args, req.Device)
	case "fat32", "vfat":
		args = []string{"mkfs.fat", "-F", "32", req.Device}
	case "exfat":
		args = []string{"mkfs.exfat"}
		if req.Label != "" {
			args = append(args, "-n", req.Label)
		}
		args = append(args, req.Device)
	case "ntfs":
		args = []string{"mkfs.ntfs", "-f", req.Device}
	default:
		jsonErr(w, "unsupported fs: "+req.FS, http.StatusBadRequest)
		return
	}
	if out, err := runCmd(args[0], args[1:]...); err != nil {
		jsonErr(w, strings.TrimSpace(out), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageFstab(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		parsed := parseFstab(readFileStr("/etc/fstab"))
		entries := make([]map[string]string, 0, len(parsed))
		for _, entry := range parsed {
			entries = append(entries, map[string]string{
				"device": entry.Source, "mount": entry.Target, "fs": entry.FS,
				"options": entry.Options, "dump": entry.Dump, "pass": entry.Pass,
			})
		}
		jsonOK(w, map[string]any{"entries": entries})
	case http.MethodPost:
		fstabWriteMu.Lock(); defer fstabWriteMu.Unlock()
		var req struct {
			Device string `json:"device"`
			Target string `json:"target"`
			Enable bool   `json:"enable"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
			return
		}
		req.Device = strings.TrimSpace(req.Device)
		req.Target = filepath.Clean(strings.TrimSpace(req.Target))
		if req.Device == "" || req.Target == "." || isSystemMountPath(req.Target) {
			jsonErr(w, "wymagane urządzenie i niesystemowy punkt montowania", http.StatusBadRequest)
			return
		}
		var mounted *sys.MountPoint
		for _, mount := range cachedMounts() {
			if mount.Device == req.Device && filepath.Clean(mount.MountAt) == req.Target {
				copy := mount
				mounted = &copy
				break
			}
		}
		if mounted == nil {
			jsonErr(w, "punkt montowania nie jest aktywny", http.StatusNotFound)
			return
		}
		if strings.EqualFold(mounted.FS, "zfs") {
			jsonErr(w, "montowania ZFS są zarządzane przez właściwość mountpoint puli", http.StatusBadRequest)
			return
		}
		uuid := ""
		if strings.HasPrefix(mounted.Device, "/dev/") {
			uuid, _ = runCmd("blkid", "-s", "UUID", "-o", "value", mounted.Device)
		}
		updated := updateFstabMount(readFileStr("/etc/fstab"), mounted.Device, mounted.MountAt,
			strings.TrimSpace(uuid), mounted.FS, mounted.Options, req.Enable)
		if _, err := saveFstabContent(updated); err != nil {
			code := http.StatusInternalServerError
			if _, ok := err.(fstabValidationError); ok {
				code = http.StatusBadRequest
			}
			jsonErr(w, err.Error(), code)
			return
		}
		invalidateMountsCache()
		jsonOK(w, map[string]any{"status": "ok", "in_fstab": req.Enable})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleStorageFstabContent(w http.ResponseWriter, r *http.Request) {
	content,err := os.ReadFile("/etc/fstab")
	if err!=nil {jsonErr(w,err.Error(),500);return}
	jsonOK(w, map[string]string{"content": string(content)})
}

func (s *Server) handleStorageSaveFstab(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Content string `json:"content"`
		Original *string `json:"original"`
		Apply   bool   `json:"apply"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
		return
	}
	fstabWriteMu.Lock(); defer fstabWriteMu.Unlock()
	current, readErr := os.ReadFile("/etc/fstab")
	if readErr!=nil { jsonErr(w,readErr.Error(),500);return }
	if req.Original!=nil && *req.Original!=string(current) { jsonErr(w,"FSTAB zmienił się od otwarcia edytora. Otwórz go ponownie przed zapisem.",409);return }
	verifyOutput, err := saveFstabContent(req.Content)
	if err != nil {
		code := http.StatusInternalServerError
		if _, ok := err.(fstabValidationError); ok {
			code = http.StatusBadRequest
		}
		jsonErr(w, err.Error(), code)
		return
	}
	invalidateMountsCache()
	result := map[string]any{"status": "ok", "saved": true, "applied": false, "verify_output": verifyOutput}
	if req.Apply {
		out, applyErr := runCmd("mount", "-a")
		result["output"] = out
		if applyErr != nil {
			result["error"] = "fstab zapisano, ale mount -a nie powiodło się: " + strings.TrimSpace(out)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(result)
			return
		}
		result["applied"] = true
		invalidateMountsCache()
	}
	jsonOK(w, result)
}

func (s *Server) handleStorageFstabCheck(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, err := runCmd("findmnt", "--verify", "--verbose")
		jsonOK(w, map[string]any{"output": out, "ok": err == nil})
	case http.MethodPost:
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "nieprawidłowe dane", http.StatusBadRequest)
			return
		}
		out, err := validateFstabContent(req.Content)
		jsonOK(w, map[string]any{"output": out, "ok": err == nil})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleStorageExecCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Command string `json:"command"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Command == "" {
		jsonErr(w, "command required", http.StatusBadRequest)
		return
	}
	out, err := runCmd("bash", "-c", req.Command)
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleListDirectories(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}
	out, err := runCmd("ls", "-1a", path)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var dirs []string
	for _, n := range strings.Split(out, "\n") {
		if n != "" {
			dirs = append(dirs, n)
		}
	}
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
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("vgscan")
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleStorageRAID(w http.ResponseWriter, r *http.Request) {
	mdstat, _ := runCmd("cat", "/proc/mdstat")
	detail, _ := runCmd("mdadm", "--detail", "--scan")
	jsonOK(w, map[string]any{"mdstat": mdstat, "details": detail})
}

func (s *Server) handleStorageRAIDStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleStorageScanRAID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("mdadm", "--examine", "--scan")
	jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

func (s *Server) handleStorageCreateRAID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name    string   `json:"name"`
		Level   string   `json:"level"`
		Devices []string `json:"devices"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Devices) == 0 {
		jsonErr(w, "devices required", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		req.Name = "/dev/md0"
	}
	if req.Level == "" {
		req.Level = "5"
	}
	ndev := len(req.Devices)
	args := append([]string{"--create", req.Name, "--level", req.Level, "--raid-devices", strings.TrimSpace(strings.Repeat("x", ndev)[:1])}, req.Devices...)
	// Prostsze: użyj strconv
	args = []string{"--create", req.Name, "--level", req.Level, "--raid-devices", string(rune('0' + ndev))}
	args = append(args, req.Devices...)
	out, err := runCmd("mdadm", args...)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"status": "ok", "output": out})
}

// handleStorageSMART zwraca listę dysków dla zakładki S.M.A.R.T. we frontendzie.
// Nie polegamy na "smartctl --scan" — na kontrolerach HP (cciss/hpsa) bywa
// zawodne (zdarza się, że nie wykrywa poprawnie dysków wymagających -d cciss,N,
// mimo że te same dyski są w pełni dostępne przy jawnym podaniu trybu).
// Zamiast tego budujemy listę z lsblk (już sprawdzone w handleStorageDevices)
// i filtrujemy tylko te dyski, dla których faktycznie udaje się odczytać SMART
// (bezpośrednio albo przez auto-wykryty tryb cciss,N — patrz getSMARTData/resolveSmartArgs).
func (s *Server) handleStorageSMART(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("lsblk", "-J", "-o", "NAME,TYPE,SERIAL,MODEL,TRAN,ROTA,SIZE")

	var lsblkData struct {
		Blockdevices []map[string]interface{} `json:"blockdevices"`
	}
	if out != "" {
		_ = json.Unmarshal([]byte(out), &lsblkData)
	}

	var devices []map[string]any
	// Smart Array udostępnia fizyczne dyski przez ssacli nawet wtedy, gdy
	// smartctl --scan nie widzi żadnego urządzenia za woluminami logicznymi.
	for _, pd := range getCachedSSACLIPhysicalDrives() {
		bay, _ := pd["bay"].(int)
		if bay == 0 {
			if f, ok := pd["bay"].(float64); ok {
				bay = int(f)
			}
		}
		name := fmt.Sprintf("/dev/hp-bay-%d", bay)
		diskType := getString(pd, "interface")
		if diskType == "" {
			diskType = "HP Smart Array"
		}
		devices = append(devices, map[string]any{
			"name": name, "bay": strings.TrimPrefix(name, "/dev/"), "type": diskType,
			"protocol": "HP Smart Array", "model": getString(pd, "model"),
			"serial": getString(pd, "serial_number"), "size": getString(pd, "size"),
			"temp": pd["temp"], "hours": pd["hours"], "smart": getString(pd, "status"),
			"source": "ssacli",
		})
	}
	hpDisks := getCachedSSACLIDiskMap()
	for _, dev := range lsblkData.Blockdevices {
		name := getString(dev, "name")
		devType := getString(dev, "type")
		if devType != "disk" {
			continue
		}
		if len(devices) > 0 && hpDisks["/dev/"+name] != nil {
			continue
		}
		// Sprawdź czy w ogóle da się odpytać SMART (bezpośrednio albo przez cciss,N)
		smartData := getSMARTData(name, getString(dev, "serial"))
		if smartData == nil { smartData = map[string]interface{}{"status":"unknown"} }
		protocol := strings.ToUpper(getString(dev, "tran"))
		if protocol == "" {
			protocol = "SCSI"
		}
		diskType := protocol
		if getBool(dev, "rota") {
			diskType = "HDD"
		} else if protocol == "NVME" {
			diskType = "NVMe"
		} else {
			diskType = "SSD"
		}
		devices = append(devices, map[string]any{
			"name": "/dev/" + name, "bay": name, "type": diskType, "protocol": protocol,
			"model": getString(dev, "model"), "serial": getString(dev, "serial"),
			"size": getString(dev, "size"), "temp": smartData["temp"],
			"hours": smartData["hours"], "smart": getString(smartData, "status"),
			"source": "smartctl",
		})
	}

	if devices == nil {
		devices = []map[string]any{}
	}

	jsonOK(w, map[string]any{"devices": devices})
}

func (s *Server) handleStorageSMARTMonitoring(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"active": serviceActive("smartd")})
	case http.MethodPost:
		var req struct {
			Enable bool `json:"enable"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Enable {
			runCmd("systemctl", "enable", "--now", "smartd")
		} else {
			runCmd("systemctl", "disable", "--now", "smartd")
		}
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleStorageSMARTDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method!=http.MethodGet {jsonErr(w,"method not allowed",405);return}
	dev := pathSuffix(r, "/api/storage/smart/details/")
	if strings.HasPrefix(dev, "hp-bay-") {
		bay, err := strconv.Atoi(strings.TrimPrefix(dev, "hp-bay-"))
		if err != nil {
			jsonErr(w, "nieprawidłowa zatoka HP", 400)
			return
		}
		for _, pd := range getCachedSSACLIPhysicalDrives() {
			n, _ := pd["bay"].(int)
			if n == 0 {
				if f, ok := pd["bay"].(float64); ok {
					n = int(f)
				}
			}
			if n == bay {
				jsonOK(w, ssacliSMARTJSON(pd, "/dev/"+dev))
				return
			}
		}
		jsonErr(w, "dysk nie istnieje w Smart Array", 404)
		return
	}
	if !storageDeviceName.MatchString(dev) { jsonErr(w,"nieprawidłowe urządzenie",400);return }
	args := resolveSmartArgs(dev, []string{"-a", "-j"})
	out, err := storageReadCommand("smartctl", args...)
	summary:=parseStorageSMARTSummary(out)
	if summary==nil { jsonErr(w,storageCommandError(out,err),502);return }
	_smartDataCacheMu.Lock();_smartDataCache[dev]=smartCacheEntry{data:summary,at:time.Now()};_smartDataCacheMu.Unlock()
	jsonOK(w, json.RawMessage(out))
}

func (s *Server) handleStorageSMARTDiag(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/diagnostics/")
	args := resolveSmartArgs(dev, []string{"-H", "-j"})
	out, _ := storageReadCommand("smartctl", args...)
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
	args := resolveSmartArgs(dev, []string{"-a", "-j"})
	out, _ := storageReadCommand("smartctl", args...)

	var data struct {
		ATASelfTest struct {
			Status struct {
				Value     int    `json:"value"`
				String    string `json:"string"`
				Remaining int    `json:"remaining_percent"`
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

	if !storageDeviceName.MatchString(dev) || strings.HasPrefix(dev,"hp-bay-") { jsonErr(w,"To urządzenie nie udostępnia testów smartctl; wybierz obsługiwany dysk fizyczny.",400);return }
	args := resolveSmartArgs(dev, []string{"-j", "-t", testType})
	out, err := storageReadCommand("smartctl", args...)
	var result struct { Smartctl struct { ExitStatus int `json:"exit_status"` } `json:"smartctl"` }
	if json.Unmarshal([]byte(out),&result)!=nil || result.Smartctl.ExitStatus&7!=0 || (err!=nil && result.Smartctl.ExitStatus==0) {
		jsonErr(w,storageCommandError(out,err),502);return
	}

	jsonOK(w, map[string]any{"status": "started", "type": testType, "device": dev, "output": out})
}

func (s *Server) handleStorageSMARTSectorDetails(w http.ResponseWriter, r *http.Request) {
	dev := pathSuffix(r, "/api/storage/smart/sector-details/")
	args := resolveSmartArgs(dev, []string{"-A", "-j"})
	out, _ := storageReadCommand("smartctl", args...)
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleStorageSMARTAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func blockDeviceAncestors(device string) map[string]bool {
	result := map[string]bool{}
	if !strings.HasPrefix(device, "/dev/") {
		return result
	}
	if resolved, err := filepath.EvalSymlinks(device); err == nil {
		device = resolved
	}
	out, err := runCmd("lsblk", "-snro", "PATH", device)
	if err != nil {
		result[device] = true
		return result
	}
	for _, line := range strings.Split(out, "\n") {
		if path := strings.TrimSpace(line); strings.HasPrefix(path, "/dev/") {
			result[path] = true
		}
	}
	return result
}

func systemStorageDevices() map[string]bool {
	source, err := runCmd("findmnt", "-nro", "SOURCE", "/")
	if err != nil {
		return map[string]bool{}
	}
	// Btrfs może zwrócić /dev/sda2[/@]. Do lsblk przekazujemy samo urządzenie.
	if idx := strings.Index(source, "["); idx >= 0 {
		source = source[:idx]
	}
	return blockDeviceAncestors(strings.TrimSpace(source))
}

func isSystemMountPath(target string) bool {
	target = filepath.Clean(target)
	for _, base := range []string{"/", "/boot", "/boot/efi", "/efi", "/usr", "/var", "/home", "/tmp", "/opt"} {
		if target == base {
			return true
		}
	}
	return target == "/snap" || strings.HasPrefix(target, "/snap/")
}

func mountIsDataPool(m sys.MountPoint, systemDevices map[string]bool) bool {
	if !strings.HasPrefix(m.Device, "/dev/") || strings.HasPrefix(m.Device, "/dev/loop") ||
		strings.HasPrefix(m.Device, "/dev/ram") || strings.EqualFold(m.FS, "zfs") || isSystemMountPath(m.MountAt) {
		return false
	}
	device := m.Device
	if resolved, err := filepath.EvalSymlinks(device); err==nil { device=resolved }
	if systemDevices[device] { return false }

	return true
}

func systemZFSPool() string {
	out, err := runCmd("findmnt", "-nro", "SOURCE,FSTYPE", "/")
	if err != nil {
		return ""
	}
	fields := strings.Fields(out)
	if len(fields) < 2 || !strings.EqualFold(fields[len(fields)-1], "zfs") {
		return ""
	}
	return strings.Split(fields[0], "/")[0]
}

func mountedPoolName(m sys.MountPoint) string {
	if label, err := runCmd("lsblk", "-dnro", "LABEL", m.Device); err == nil && strings.TrimSpace(label) != "" {
		return strings.TrimSpace(label)
	}
	if name := filepath.Base(filepath.Clean(m.MountAt)); name != "." && name != "/" && name != "" {
		return name
	}
	return filepath.Base(m.Device)
}

// handleStoragePools zwraca wspólną listę pul ZFS i zwykłych lokalnych
// systemów plików zamontowanych przez mount. Montowania należące do dysku
// systemowego są celowo pomijane.
func (s *Server) handleStoragePools(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	result := make([]map[string]any, 0)
	if pools, err := sys.ZFSPools(); err == nil {
		ioStats := getZFSPoolIOStats()
		rootPool := systemZFSPool()
		for _, pool := range pools {
			if rootPool != "" && pool.Name == rootPool {
				continue
			}
			poolData := map[string]any{
				"id": pool.Name, "name": pool.Name, "kind": "zfs", "health": pool.State,
				"used": pool.Used, "avail": pool.Avail, "total": pool.Total, "type": pool.Type,
				"iops": 0, "read_mbps": 0, "write_mbps": 0,
			}
			if stats, ok := ioStats[pool.Name]; ok {
				poolData["iops"] = stats["iops"]
				poolData["read_mbps"] = stats["read_mbps"]
				poolData["write_mbps"] = stats["write_mbps"]
			}
			result = append(result, poolData)
		}
	}

	systemDevices := systemStorageDevices()
	for _, mount := range cachedMounts() {
		if !mountIsDataPool(mount, systemDevices) {
			continue
		}
		result = append(result, map[string]any{
			"id": "mount:" + mount.MountAt, "name": mountedPoolName(mount), "kind": "mount",
			"health": "ONLINE", "type": strings.ToUpper(mount.FS), "mount": mount.MountAt,
			"device": mount.Device, "used": round2(float64(mount.UsedB) / 1073741824),
			"avail": round2(float64(mount.FreeB) / 1073741824),
			"total": round2(float64(mount.TotalB) / 1073741824),
			"iops":  0, "read_mbps": 0, "write_mbps": 0, "drives": 1, "parity": 0,
		})
	}
	jsonOK(w, map[string]any{"pools": result, "available": true})
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
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name, mp := fields[0], fields[1]
		if mp == "none" || mp == "-" {
			mp = ""
		}
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
		reads, _ := strconv.ParseFloat(fields[3], 64)
		writes, _ := strconv.ParseFloat(fields[4], 64)
		readBW := parseHumanSize(fields[5])
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
		for kk, vv := range v {
			cp[kk] = vv
		}
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
		return v / 1024 // KB -> MB
	case 'M', 'm':
		return v // już MB
	case 'G', 'g':
		return v * 1024 // GB -> MB
	case 'T', 't':
		return v * 1024 * 1024 // TB -> MB
	default:
		return v / (1024 * 1024) // bajty -> MB
	}
}

// ─── SMART: endpoint diagnostyczny ───────────────────────────────────────────
// GET /api/storage/smart-debug — surowe wyjścia komend, żeby móc zdiagnozować
// dlaczego SMART nie pokazuje danych (np. brak ssacli, zły slot kontrolera,
// smartctl nie widzi dysku w żadnym trybie itd.) bez logowania się po SSH.
func (s *Server) handleStorageSMARTDebug(w http.ResponseWriter, r *http.Request) {
	info := map[string]interface{}{}

	_, smartctlErr := exec.LookPath("smartctl")
	info["smartctl_installed"] = smartctlErr == nil

	toolPath := findSSACLITool()
	ssacliErr := toolPath == ""
	info["ssacli_installed"] = !ssacliErr

	if !ssacliErr {
		statusOut, _ := ssacliRun(toolPath, "ctrl", "all", "show", "status")
		info["ssacli_ctrl_status_raw"] = statusOut
		slots := findSSACLIControllerSlots()
		info["ssacli_detected_slots"] = slots
		if len(slots) == 0 {
			slots = []int{0}
		}
		details := map[string]string{}
		var parsed []map[string]interface{}
		for _, slot := range slots {
			out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", slot), "pd", "all", "show", "detail")
			key := fmt.Sprintf("slot_%d", slot)
			if err != nil {
				details[key] = "BŁĄD: " + err.Error() + " | wyjście: " + out
				continue
			}
			details[key] = out
			parsed = append(parsed, parseSSACLIPhysicalDrives(out)...)
		}
		info["ssacli_pd_detail_raw"] = details
		info["ssacli_parsed_drives"] = parsed

		// "ld all show detail" — to jest kluczowe do zdiagnozowania mapowania
		// /dev/sdX -> fizyczny dysk (Disk Name + physicaldrive w każdym LD).
		ldDetails := map[string]string{}
		diskNameMap := map[string]string{}
		for _, slot := range slots {
			out, err := ssacliRun(toolPath, "ctrl", fmt.Sprintf("slot=%d", slot), "ld", "all", "show", "detail")
			key := fmt.Sprintf("slot_%d", slot)
			if err != nil {
				ldDetails[key] = "BŁĄD: " + err.Error() + " | wyjście: " + out
				continue
			}
			ldDetails[key] = out
			for diskName, pdID := range parseSSACLILogicalDriveDiskNames(out) {
				diskNameMap[diskName] = pdID
			}
		}
		info["ssacli_ld_detail_raw"] = ldDetails
		info["ssacli_disk_name_to_physicaldrive"] = diskNameMap
		info["ssacli_final_disk_map"] = getCachedSSACLIDiskMap()
	}

	// lsblk — jak widzi dyski system
	lsblkOut, _ := runCmd("lsblk", "-J", "-o", "NAME,TYPE,SERIAL,MODEL")
	info["lsblk_raw"] = json.RawMessage(safeJSON(lsblkOut))

	// Spróbuj smartctl na pierwszym znalezionym dysku fizycznym — bezpośrednio
	// i przez kilka pierwszych indeksów cciss, żeby było widać co dokładnie
	// odpowiada kontroler.
	var lsblkData struct {
		Blockdevices []map[string]interface{} `json:"blockdevices"`
	}
	json.Unmarshal([]byte(lsblkOut), &lsblkData)
	var firstDisk string
	for _, d := range lsblkData.Blockdevices {
		if getString(d, "type") == "disk" {
			firstDisk = getString(d, "name")
			break
		}
	}
	if firstDisk != "" {
		devPath := "/dev/" + firstDisk
		info["tested_device"] = devPath
		if smartctlErr == nil {
			directOut, _ := runCmd("smartctl", "-a", "-j", devPath)
			info["smartctl_direct_raw"] = directOut
			info["smartctl_cciss_probe"] = "wyłączone dla ochrony HP Smart Array; świadomie ustaw NIMBUS_HP_SMART_PROBE=1"
		}
	}

	jsonOK(w, info)
}
