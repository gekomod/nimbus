package api

// temps.go — temperatury z lm-sensors + sterowanie wentylatorami przez i8kutils

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Struktury ─────────────────────────────────────────────────────────────────

type SensorReading struct {
	Label  string  `json:"label"`
	Temp   float64 `json:"temp"`
	Max    float64 `json:"max"`
	Crit   float64 `json:"crit"`
	Warn   float64 `json:"warn"`
	Unit   string  `json:"unit"` // "°C" lub "RPM"
	RPM    int     `json:"rpm,omitempty"`
	FanMin int     `json:"fan_min,omitempty"`
	FanMax int     `json:"fan_max,omitempty"`
}

type SensorGroup struct {
	Name    string          `json:"name"`
	Adapter string          `json:"adapter"`
	Sensors []SensorReading `json:"sensors"`
}

type FanInfo struct {
	Name  string `json:"name"`
	RPM   int    `json:"rpm"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
	Speed int    `json:"speed"` // 0-3 (i8k: 0=off,1=low,2=high,3=max)
}

// ── Parsowanie sensors -j (JSON output) ──────────────────────────────────────

func parseSensorsOutput() ([]SensorGroup, []FanInfo, error) {
	// Sprawdź czy lm-sensors jest zainstalowany
	if _, err := runCmd("which", "sensors"); err != nil {
		return nil, nil, fmt.Errorf("lm-sensors not installed")
	}

	out, err := runCmd("sensors", "-j")
	if err != nil || out == "" {
		// Fallback na sensors bez -j
		out, err = runCmd("sensors")
		if err != nil {
			return nil, nil, err
		}
		return parseSensorsText(out)
	}

	// Parse JSON output
	var raw map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		// Fallback na text
		outText, _ := runCmd("sensors")
		return parseSensorsText(outText)
	}

	var groups []SensorGroup
	var fans   []FanInfo

	for chipName, chipData := range raw {
		adapter := ""
		var sensors []SensorReading

		for key, val := range chipData {
			if key == "Adapter" {
				if s, ok := val.(string); ok {
					adapter = s
				}
				continue
			}

			// Każdy klucz to czujnik z podkluczami
			subMap, ok := val.(map[string]interface{})
			if !ok { continue }

			sensor := SensorReading{Label: key}

			for subKey, subVal := range subMap {
				fval, ok := toFloat(subVal)
				if !ok { continue }

				lk := strings.ToLower(subKey)
				if strings.Contains(lk, "temp") && strings.Contains(lk, "input") {
					sensor.Temp = fval
					sensor.Unit = "°C"
				} else if strings.Contains(lk, "temp") && strings.Contains(lk, "max") {
					sensor.Max = fval
				} else if strings.Contains(lk, "temp") && strings.Contains(lk, "crit") {
					sensor.Crit = fval
				} else if strings.Contains(lk, "fan") && strings.Contains(lk, "input") {
					sensor.RPM = int(fval)
					sensor.Unit = "RPM"
				} else if strings.Contains(lk, "fan") && strings.Contains(lk, "min") {
					sensor.FanMin = int(fval)
				} else if strings.Contains(lk, "fan") && strings.Contains(lk, "max") {
					sensor.FanMax = int(fval)
				}
			}

			if sensor.Temp > 0 {
				if sensor.Warn == 0 && sensor.Max > 0 { sensor.Warn = sensor.Max * 0.85 }
				if sensor.Warn == 0 { sensor.Warn = 75 }
				if sensor.Crit == 0 { sensor.Crit = 100 }
				if sensor.Max  == 0 { sensor.Max  = sensor.Crit }
				sensors = append(sensors, sensor)
			} else if sensor.RPM > 0 || strings.Contains(strings.ToLower(key), "fan") {
				fans = append(fans, FanInfo{
					Name: key,
					RPM:  sensor.RPM,
					Min:  sensor.FanMin,
					Max:  sensor.FanMax,
				})
			}
		}

		if len(sensors) > 0 || len(fans) > 0 {
			groups = append(groups, SensorGroup{
				Name:    chipName,
				Adapter: adapter,
				Sensors: sensors,
			})
		}
	}

	return groups, fans, nil
}

// parseSensorsText parsuje wyjście `sensors` (text mode) — fallback gdy brak -j
func parseSensorsText(out string) ([]SensorGroup, []FanInfo, error) {
	var groups []SensorGroup
	var fans   []FanInfo

	reTemp := regexp.MustCompile(`(?i)([\w\s]+):\s+\+?(-?\d+\.?\d*)[°]?C`)
	reFan  := regexp.MustCompile(`(?i)([\w\s]+Fan[\w\s]*):\s+(\d+)\s+RPM.*?(?:min\s*=\s*(\d+).*?max\s*=\s*(\d+))?`)
	reMax  := regexp.MustCompile(`high\s*=\s*\+?(\d+\.?\d*)`)
	reCrit := regexp.MustCompile(`crit\s*=\s*\+?(\d+\.?\d*)`)

	var currentGroup *SensorGroup

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" { continue }

		// Nowy chip
		if !strings.HasPrefix(line, " ") && strings.Contains(line, "-") && !strings.Contains(line, ":") {
			groups = append(groups, SensorGroup{Name: line})
			currentGroup = &groups[len(groups)-1]
			continue
		}
		if strings.HasPrefix(line, "Adapter:") {
			if currentGroup != nil {
				currentGroup.Adapter = strings.TrimPrefix(line, "Adapter: ")
			}
			continue
		}

		// Fan
		if m := reFan.FindStringSubmatch(line); m != nil {
			rpm, _ := strconv.Atoi(m[2])
			minRpm, _ := strconv.Atoi(m[3])
			maxRpm, _ := strconv.Atoi(m[4])
			fans = append(fans, FanInfo{
				Name: strings.TrimSpace(m[1]),
				RPM:  rpm, Min: minRpm, Max: maxRpm,
			})
			continue
		}

		// Temperatura
		if m := reTemp.FindStringSubmatch(line); m != nil && currentGroup != nil {
			temp, _ := strconv.ParseFloat(m[2], 64)
			s := SensorReading{
				Label: strings.TrimSpace(m[1]),
				Temp:  temp,
				Unit:  "°C",
				Warn:  75, Crit: 100, Max: 100,
			}
			if mm := reMax.FindStringSubmatch(line); mm != nil {
				s.Max, _ = strconv.ParseFloat(mm[1], 64)
				s.Warn = s.Max * 0.85
			}
			if mm := reCrit.FindStringSubmatch(line); mm != nil {
				s.Crit, _ = strconv.ParseFloat(mm[1], 64)
			}
			currentGroup.Sensors = append(currentGroup.Sensors, s)
		}
	}

	return groups, fans, nil
}

func toFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64: return x, true
	case int:     return float64(x), true
	case string:
		f, err := strconv.ParseFloat(x, 64)
		return f, err == nil
	}
	return 0, false
}

// ── i8k wentylatory ──────────────────────────────────────────────────────────

func i8kInstalled() bool {
	_, err := runCmd("which", "i8kctl")
	return err == nil
}

func i8kFanStatus() (fan1Speed, fan2Speed int, fan1RPM, fan2RPM int) {
	out, err := runCmd("i8kctl", "fan")
	if err != nil { return }
	fields := strings.Fields(out)
	if len(fields) >= 2 {
		fan1Speed, _ = strconv.Atoi(fields[0])
		fan2Speed, _ = strconv.Atoi(fields[1])
	}
	// RPM z sensors
	outS, _ := runCmd("i8kctl", "rpm")
	fields2 := strings.Fields(outS)
	if len(fields2) >= 2 {
		fan1RPM, _ = strconv.Atoi(fields2[0])
		fan2RPM, _ = strconv.Atoi(fields2[1])
	}
	return
}

// ── Historia temperatur (ringbuffer 60 próbek) ────────────────────────────────

var tempHistory struct {
	CPU  []float64
	MB   []float64
	Disk []float64
	mu   interface{} // sync.Mutex — nie używamy tu
}

func init() {
	tempHistory.CPU  = make([]float64, 0, 60)
	tempHistory.MB   = make([]float64, 0, 60)
	tempHistory.Disk = make([]float64, 0, 60)

	go func() {
		for {
			groups, _, err := parseSensorsOutput()
			if err == nil {
				cpuMax, mbMax := 0.0, 0.0
				for _, g := range groups {
					isCPU := strings.Contains(strings.ToLower(g.Name), "core") ||
						strings.Contains(strings.ToLower(g.Name), "k10temp") ||
						strings.Contains(strings.ToLower(g.Name), "cpu")
					for _, s := range g.Sensors {
						if isCPU && s.Temp > cpuMax { cpuMax = s.Temp }
						if !isCPU && s.Temp > mbMax { mbMax = s.Temp }
					}
				}
				appendHist := func(h *[]float64, v float64) {
					if len(*h) >= 60 { *h = (*h)[1:] }
					*h = append(*h, v)
				}
				appendHist(&tempHistory.CPU, cpuMax)
				appendHist(&tempHistory.MB,  mbMax)
			}
			time.Sleep(30 * time.Second)
		}
	}()
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleTemps(w http.ResponseWriter, r *http.Request) {
	// Sprawdź instalację
	_, sensorsErr := runCmd("which", "sensors")
	sensorsInstalled := sensorsErr == nil
	i8kInst := i8kInstalled()

	if !sensorsInstalled {
		jsonOK(w, map[string]any{
			"installed":      false,
			"i8k_installed":  i8kInst,
			"groups":         []any{},
			"fans":           []any{},
		})
		return
	}

	groups, fans, err := parseSensorsOutput()
	if err != nil {
		jsonErr(w, "sensors error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Dodaj dane i8k do wentylatorów
	if i8kInst {
		f1s, f2s, f1r, f2r := i8kFanStatus()
		i8kFans := []FanInfo{
			{Name: "Processor Fan", RPM: f1r, Speed: f1s, Min: 0, Max: 4500},
			{Name: "Motherboard Fan", RPM: f2r, Speed: f2s, Min: 0, Max: 4500},
		}
		// Połącz z danymi z sensors (unikaj duplikatów)
		existingNames := map[string]bool{}
		for _, f := range fans { existingNames[f.Name] = true }
		for _, f := range i8kFans {
			if !existingNames[f.Name] { fans = append(fans, f) }
		}
	}

	fanAutoMu.Lock()
	autoOn := fanAutoEnabled
	fanAutoMu.Unlock()

	jsonOK(w, map[string]any{
		"installed":     true,
		"i8k_installed": i8kInst,
		"auto_mode":     autoOn,
		"groups":        groups,
		"fans":          fans,
		"history": map[string]any{
			"cpu":  tempHistory.CPU,
			"mb":   tempHistory.MB,
		},
	})
}

func (s *Server) handleTempsInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("apt-get", "install", "-y", "lm-sensors", "i8kutils")
	if err != nil { jsonErr(w, out, http.StatusInternalServerError); return }
	// Wykryj chipy
	runCmd("sensors-detect", "--auto")
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}

func (s *Server) handleFanControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }

	var req struct {
		Fan   int `json:"fan"`   // 1 lub 2
		Speed int `json:"speed"` // 0=off,1=low,2=high,3=max
	}
	json.NewDecoder(r.Body).Decode(&req)

	if !i8kInstalled() {
		jsonErr(w, "i8kutils nie zainstalowany", http.StatusServiceUnavailable)
		return
	}

	out, err := runCmd("i8kctl", "fan", strconv.Itoa(req.Fan-1), strconv.Itoa(req.Speed))
	if err != nil {
		// Spróbuj przez /proc/i8k
		entry := fmt.Sprintf("%d %d", req.Fan-1, req.Speed)
		err2 := os.WriteFile("/proc/i8k", []byte(entry), 0644)
		if err2 != nil {
			jsonErr(w, "Błąd sterowania: "+out, http.StatusInternalServerError)
			return
		}
	}

	jsonOK(w, map[string]any{"status": "ok", "output": out, "fan": req.Fan, "speed": req.Speed})
}

// ── Termostat automatyczny ────────────────────────────────────────────────────

var (
	fanAutoEnabled bool
	fanAutoStop    chan struct{}
	fanAutoMu      sync.Mutex
)

func init() { fanAutoStop = make(chan struct{}) }

// cpuTempNow zwraca aktualną temperaturę CPU (max ze wszystkich rdzeni)
func cpuTempNow() float64 {
	groups, _, err := parseSensorsOutput()
	if err != nil { return 0 }
	max := 0.0
	for _, g := range groups {
		isCPU := strings.Contains(strings.ToLower(g.Name), "core") ||
			strings.Contains(strings.ToLower(g.Name), "k10temp") ||
			strings.Contains(strings.ToLower(g.Name), "coretemp") ||
			strings.Contains(strings.ToLower(g.Name), "cpu")
		if !isCPU { continue }
		for _, s := range g.Sensors {
			if s.Temp > max { max = s.Temp }
		}
	}
	return max
}

// setAllFans ustawia oba wentylatory i8k na podaną prędkość (0=off,1=low,2=high,3=max)
func setAllFans(speed int) {
	runCmd("i8kctl", "fan", "0", strconv.Itoa(speed))
	runCmd("i8kctl", "fan", "1", strconv.Itoa(speed))
}

func startFanAutoLoop() {
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-fanAutoStop:
				return
			case <-ticker.C:
				temp := cpuTempNow()
				switch {
				case temp >= 70:
					setAllFans(3) // Maksymalny
				case temp >= 50:
					setAllFans(2) // Szybki (połowa mocy)
				default:
					setAllFans(1) // Wolny
				}
			}
		}
	}()
}

func (s *Server) handleFanAuto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }

	if !i8kInstalled() {
		jsonErr(w, "i8kutils nie zainstalowany", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Enable bool `json:"enable"`
	}
	// Domyślnie enable=true gdy brak body
	req.Enable = true
	json.NewDecoder(r.Body).Decode(&req)

	fanAutoMu.Lock()
	defer fanAutoMu.Unlock()

	if req.Enable && !fanAutoEnabled {
		fanAutoStop = make(chan struct{})
		fanAutoEnabled = true
		startFanAutoLoop()
		jsonOK(w, map[string]any{"status": "ok", "auto": true, "message": "Termostat aktywny: <50°C→wolny, ≥50°C→szybki, ≥70°C→max"})
	} else if !req.Enable && fanAutoEnabled {
		close(fanAutoStop)
		fanAutoEnabled = false
		jsonOK(w, map[string]any{"status": "ok", "auto": false, "message": "Termostat wyłączony"})
	} else {
		jsonOK(w, map[string]any{"status": "ok", "auto": fanAutoEnabled, "message": "Bez zmian"})
	}
}

func (s *Server) handleFanAutoStatus(w http.ResponseWriter, r *http.Request) {
	fanAutoMu.Lock()
	defer fanAutoMu.Unlock()
	jsonOK(w, map[string]any{"auto": fanAutoEnabled})
}
