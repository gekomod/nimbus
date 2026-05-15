package api

// temps.go — temperatury lm-sensors + sterowanie wentylatorami przez hwmon PWM
// OptiPlex/Inspiron: /sys/class/hwmon/hwmonX/pwmN (0-255, płynne)
// Fallback: i8kctl (poziomy 0-3)

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Struktury ──────────────────────────────────────────────────────────────────

type SensorReading struct {
	Label string  `json:"label"`
	Temp  float64 `json:"temp"`
	Max   float64 `json:"max"`
	Crit  float64 `json:"crit"`
	Warn  float64 `json:"warn"`
	Unit  string  `json:"unit"`
}

type SensorGroup struct {
	Name    string          `json:"name"`
	Adapter string          `json:"adapter"`
	Sensors []SensorReading `json:"sensors"`
}

type FanInfo struct {
	Index    int    `json:"index"`     // indeks wentylatora (1-based)
	Name     string `json:"name"`
	Label    string `json:"label"`
	Loc      string `json:"loc"`
	RPM      int    `json:"rpm"`
	PWM      int    `json:"pwm"`       // 0-255 (rzeczywiste)
	PWMPct   int    `json:"pwm_pct"`   // 0-100 %
	PWMMin   int    `json:"pwm_min"`   // min PWM (z pwmN_min)
	PWMMax   int    `json:"pwm_max"`   // max PWM (z pwmN_max, zwykle 255)
	RPMMax   int    `json:"rpm_max"`
	Mode     int    `json:"mode"`      // pwmN_enable: 0=off,1=manual,2=auto
	HwmonPath string `json:"hwmon_path"` // /sys/class/hwmon/hwmonX
	PWMFile  string `json:"pwm_file"`  // pełna ścieżka do pwmN
	I8kIdx   int    `json:"i8k_idx"`   // -1 jeśli brak
}

// ── Konfiguracja termostatu ───────────────────────────────────────────────────

type FanConfig struct {
	Preset    string `json:"preset"`     // silent|balanced|turbo
	ZeroRPM   bool   `json:"zero_rpm"`
	Hyst      int    `json:"hyst"`
	NightMode bool   `json:"night_mode"`
	NightFrom int    `json:"night_from"`
	NightTo   int    `json:"night_to"`
	AlertTach bool   `json:"alert_tach"`
	LogPWM    bool   `json:"log_pwm"`
}

var defaultFanConfig = FanConfig{
	Preset: "balanced", ZeroRPM: true, Hyst: 5,
	NightFrom: 22, NightTo: 6, AlertTach: true,
}

// Krzywa PWM dla presetu: temp → PWM 0-255
func presetPWM(temp float64, preset string, zeroRPM bool) int {
	type point struct{ t float64; p int }
	var curve []point
	switch preset {
	case "silent":
		curve = []point{{0,0},{40,0},{50,60},{60,100},{70,160},{80,210},{85,255}}
	case "turbo":
		curve = []point{{0,80},{35,80},{45,140},{55,190},{65,230},{70,255}}
	default: // balanced
		curve = []point{{0,0},{40,0},{50,80},{60,130},{70,190},{80,240},{85,255}}
	}
	if !zeroRPM && curve[0].p == 0 {
		curve[0].p = 40
		if len(curve) > 1 { curve[1].p = 40 }
	}
	// Interpolacja liniowa
	for i := 1; i < len(curve); i++ {
		if temp <= curve[i].t {
			prev, next := curve[i-1], curve[i]
			ratio := (temp - prev.t) / (next.t - prev.t)
			pwm := int(float64(prev.p) + ratio*float64(next.p-prev.p))
			if pwm < 0 { pwm = 0 }
			if pwm > 255 { pwm = 255 }
			return pwm
		}
	}
	return 255
}

// ── Wykrywanie hwmon ──────────────────────────────────────────────────────────

type hwmonFan struct {
	hwmonPath string
	pwmFile   string
	rpmFile   string
	pwmMin    int
	pwmMax    int
	label     string
	idx       int // numer pwmN
}

func discoverHwmonFans() []hwmonFan {
	var fans []hwmonFan

	hwmons, _ := filepath.Glob("/sys/class/hwmon/hwmon*")
	for _, hw := range hwmons {
		// Sprawdź czy to Dell/lm75/coretemp z pwm
		nameBytes, _ := os.ReadFile(filepath.Join(hw, "name"))
		chipName := strings.TrimSpace(string(nameBytes))

		// Szukaj pwm1, pwm2, ...
		for idx := 1; idx <= 6; idx++ {
			pwmFile := filepath.Join(hw, fmt.Sprintf("pwm%d", idx))
			if _, err := os.Stat(pwmFile); err != nil {
				continue
			}
			// Sprawdź czy jest plik fan*_input (RPM)
			rpmFile := filepath.Join(hw, fmt.Sprintf("fan%d_input", idx))
			if _, err := os.Stat(rpmFile); err != nil {
				// Próbuj też bez numeru lub z innym
				rpmFile = ""
			}

			// Odczytaj min/max PWM
			pwmMin := 0
			if d, err := os.ReadFile(filepath.Join(hw, fmt.Sprintf("pwm%d_min", idx))); err == nil {
				pwmMin, _ = strconv.Atoi(strings.TrimSpace(string(d)))
			}
			pwmMax := 255
			if d, err := os.ReadFile(filepath.Join(hw, fmt.Sprintf("pwm%d_max", idx))); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(string(d))); err == nil && v > 0 {
					pwmMax = v
				}
			}

			// Etykieta z fan*_label
			label := fmt.Sprintf("%s fan%d", chipName, idx)
			if d, err := os.ReadFile(filepath.Join(hw, fmt.Sprintf("fan%d_label", idx))); err == nil {
				label = strings.TrimSpace(string(d))
			}

			fans = append(fans, hwmonFan{
				hwmonPath: hw,
				pwmFile:   pwmFile,
				rpmFile:   rpmFile,
				pwmMin:    pwmMin,
				pwmMax:    pwmMax,
				label:     label,
				idx:       idx,
			})
		}
	}
	return fans
}

// readPWM odczytuje aktualną wartość PWM (0-255)
func readPWM(pwmFile string) int {
	d, err := os.ReadFile(pwmFile)
	if err != nil { return -1 }
	v, _ := strconv.Atoi(strings.TrimSpace(string(d)))
	return v
}

// readRPM odczytuje RPM z pliku fan*_input
func readRPM(rpmFile string) int {
	if rpmFile == "" { return 0 }
	d, err := os.ReadFile(rpmFile)
	if err != nil { return 0 }
	v, _ := strconv.Atoi(strings.TrimSpace(string(d)))
	return v
}

// readPWMMode odczytuje tryb: 0=off,1=manual,2=auto
func readPWMMode(pwmFile string) int {
	d, err := os.ReadFile(pwmFile + "_enable")
	if err != nil { return -1 }
	v, _ := strconv.Atoi(strings.TrimSpace(string(d)))
	return v
}

// setPWMManual — przełącza na manual i ustawia wartość
func setPWMManual(pwmFile string, val int) error {
	// Włącz tryb manual (1)
	os.WriteFile(pwmFile+"_enable", []byte("1"), 0644)
	// Ustaw wartość
	return os.WriteFile(pwmFile, []byte(strconv.Itoa(val)), 0644)
}

// setPWMAuto — przywraca sterowanie automatyczne BIOS/EC
func setPWMAuto(pwmFile string) error {
	return os.WriteFile(pwmFile+"_enable", []byte("2"), 0644)
}

// buildFanList — pobiera listę wentylatorów z hwmon + RPM
func buildFanList() []FanInfo {
	hwFans := discoverHwmonFans()
	var fans []FanInfo

	for i, hf := range hwFans {
		pwm := readPWM(hf.pwmFile)
		rpm := readRPM(hf.rpmFile)
		mode := readPWMMode(hf.pwmFile)
		pwmPct := 0
		if hf.pwmMax > 0 && pwm >= 0 {
			pwmPct = int(float64(pwm) / float64(hf.pwmMax) * 100)
		}

		// Ładne etykiety dla Dell
		label := hf.label
		loc := ""
		switch {
		case strings.Contains(strings.ToLower(label), "cpu") || hf.idx == 1:
			label = "Wentylator CPU"
			loc = "Procesor"
		case strings.Contains(strings.ToLower(label), "case") || hf.idx == 2:
			label = "Wentylator obudowy"
			loc = "Obudowa"
		case strings.Contains(strings.ToLower(label), "gpu"):
			label = "Wentylator GPU"
			loc = "Karta graficzna"
		}

		fans = append(fans, FanInfo{
			Index:    i + 1,
			Name:     fmt.Sprintf("fan%d", hf.idx),
			Label:    label,
			Loc:      loc,
			RPM:      rpm,
			PWM:      pwm,
			PWMPct:   pwmPct,
			PWMMin:   hf.pwmMin,
			PWMMax:   hf.pwmMax,
			RPMMax:   4500,
			Mode:     mode,
			HwmonPath: hf.hwmonPath,
			PWMFile:  hf.pwmFile,
			I8kIdx:   -1,
		})
	}

	// Fallback: i8k jeśli brak hwmon fans
	if len(fans) == 0 && i8kInstalled() {
		f1s, f2s, f1r, f2r := i8kFanStatus()
		idx := 1
		// Dodaj tylko wentylatory które i8k wykrył (speed != -1)
		if f1s >= 0 {
			fans = append(fans, FanInfo{
				Index:1, Name:"fan0", Label:"Wentylator CPU", Loc:"Procesor",
				RPM:f1r, PWM:f1s*85, PWMPct:f1s*33, PWMMin:0, PWMMax:255, RPMMax:4500, Mode:1, I8kIdx:0,
			})
			idx++
		}
		if f2s >= 0 {
			fans = append(fans, FanInfo{
				Index:idx, Name:"fan1", Label:"Wentylator MB", Loc:"Płyta główna",
				RPM:f2r, PWM:f2s*85, PWMPct:f2s*33, PWMMin:0, PWMMax:255, RPMMax:4500, Mode:1, I8kIdx:1,
			})
		}
	}
	return fans
}

// ── i8k fallback ──────────────────────────────────────────────────────────────

func i8kInstalled() bool {
	_, err := runCmd("which", "i8kctl")
	return err == nil
}

func i8kFanStatus() (f1Speed, f2Speed, f1RPM, f2RPM int) {
	// Domyślnie -1 = nieznany/nieobsługiwany
	f1Speed, f2Speed = -1, -1

	if out, err := runCmd("i8kctl", "fan"); err == nil {
		f := strings.Fields(out)
		if len(f) >= 1 { f1Speed, _ = strconv.Atoi(f[0]) }
		if len(f) >= 2 { f2Speed, _ = strconv.Atoi(f[1]) }
	}
	if out, err := runCmd("i8kctl", "rpm"); err == nil {
		f := strings.Fields(out)
		if len(f) >= 1 { f1RPM, _ = strconv.Atoi(f[0]) }
		if len(f) >= 2 { f2RPM, _ = strconv.Atoi(f[1]) }
	}
	return
}

// ── Stan globalny ─────────────────────────────────────────────────────────────

var (
	fanAutoEnabled bool
	fanAutoStop    chan struct{}
	fanAutoMu      sync.Mutex
	fanCfg         FanConfig
	fanCfgMu       sync.RWMutex
	lastPWM        int = -1
)

const (
	fanAutoStatePath = "/var/lib/nimbus/fan_auto.state"
	fanCfgPath       = "/var/lib/nimbus/fan_config.json"
)

func saveFanAutoState(v bool) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	s := "0"; if v { s = "1" }
	os.WriteFile(fanAutoStatePath, []byte(s), 0644)
}
func loadFanAutoState() bool {
	d, err := os.ReadFile(fanAutoStatePath)
	return err == nil && strings.TrimSpace(string(d)) == "1"
}
func saveFanConfig(cfg FanConfig) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	if d, err := json.Marshal(cfg); err == nil {
		os.WriteFile(fanCfgPath, d, 0644)
	}
}
func loadFanConfig() FanConfig {
	d, err := os.ReadFile(fanCfgPath)
	if err != nil { return defaultFanConfig }
	var cfg FanConfig
	if err := json.Unmarshal(d, &cfg); err != nil { return defaultFanConfig }
	if cfg.Preset == "" { cfg.Preset = "balanced" }
	if cfg.Hyst <= 0 { cfg.Hyst = 5 }
	return cfg
}

func isNightMode(cfg FanConfig) bool {
	if !cfg.NightMode { return false }
	h := time.Now().Hour()
	if cfg.NightFrom > cfg.NightTo { return h >= cfg.NightFrom || h < cfg.NightTo }
	return h >= cfg.NightFrom && h < cfg.NightTo
}

// setAllFansPWM — ustawia wszystkie hwmon PWM na wartość 0-255
func setAllFansPWM(pwmVal int) {
	hwFans := discoverHwmonFans()
	if len(hwFans) > 0 {
		for _, hf := range hwFans {
			setPWMManual(hf.pwmFile, pwmVal)
		}
		return
	}
	// Fallback i8k — przelicz PWM 0-255 na poziom 0-3
	level := 0
	switch {
	case pwmVal >= 200: level = 3
	case pwmVal >= 130: level = 2
	case pwmVal >= 60:  level = 1
	}
	lvl := strconv.Itoa(level)
	f1s, f2s, _, _ := i8kFanStatus()
	// Steruj tylko wentylatorami które i8k wykrył (speed != -1)
	if f1s >= 0 { runCmd("i8kctl", "fan", "0", lvl) }
	if f2s >= 0 { runCmd("i8kctl", "fan", "1", lvl) }
}

func cpuTempNow() float64 {
	groups, _, err := parseSensorsOutput()
	if err != nil { return 0 }
	max := 0.0
	for _, g := range groups {
		if !regexp.MustCompile(`(?i)core|k10temp|coretemp|cpu`).MatchString(g.Name) { continue }
		for _, s := range g.Sensors {
			if s.Temp > max { max = s.Temp }
		}
	}
	return max
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
				fanCfgMu.RLock()
				cfg := fanCfg
				fanCfgMu.RUnlock()

				preset := cfg.Preset
				if isNightMode(cfg) { preset = "silent" }

				temp := cpuTempNow()
				newPWM := presetPWM(temp, preset, cfg.ZeroRPM)

				// Hystereza — zmień tylko gdy różnica > 10 PWM jednostek
				if lastPWM < 0 || abs(newPWM-lastPWM) >= 10 {
					setAllFansPWM(newPWM)
					if cfg.LogPWM {
						runCmd("logger", "-t", "nimbus-fan",
							fmt.Sprintf("PWM=%d (%.1f°C preset=%s)", newPWM, temp, preset))
					}
					lastPWM = newPWM
				}
			}
		}
	}()
}

func abs(x int) int { if x < 0 { return -x }; return x }

// ── Historia temperatur ───────────────────────────────────────────────────────

var tempHistory struct {
	CPU []float64
	MB  []float64
	mu  sync.Mutex
}

func init() {
	tempHistory.CPU = make([]float64, 0, 60)
	tempHistory.MB  = make([]float64, 0, 60)
	fanCfg      = loadFanConfig()
	fanAutoStop  = make(chan struct{})

	go func() {
		for {
			groups, _, err := parseSensorsOutput()
			if err == nil {
				cpuMax, mbMax := 0.0, 0.0
				for _, g := range groups {
					isCPU := regexp.MustCompile(`(?i)core|k10temp|coretemp`).MatchString(g.Name)
					for _, s := range g.Sensors {
						if isCPU && s.Temp > cpuMax { cpuMax = s.Temp }
						if !isCPU && s.Temp > mbMax  { mbMax = s.Temp }
					}
				}
				tempHistory.mu.Lock()
				push := func(h *[]float64, v float64) {
					if len(*h) >= 60 { *h = (*h)[1:] }
					*h = append(*h, v)
				}
				push(&tempHistory.CPU, cpuMax)
				push(&tempHistory.MB, mbMax)
				tempHistory.mu.Unlock()
			}
			time.Sleep(30 * time.Second)
		}
	}()

	if loadFanAutoState() {
		fanAutoEnabled = true
		startFanAutoLoop()
	}
}

// ── Parsowanie lm-sensors ─────────────────────────────────────────────────────

func parseSensorsOutput() ([]SensorGroup, []interface{}, error) {
	if _, err := runCmd("which", "sensors"); err != nil {
		return nil, nil, fmt.Errorf("lm-sensors not installed")
	}
	out, err := runCmd("sensors", "-j")
	if err != nil || out == "" {
		return parseSensorsText()
	}
	var raw map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return parseSensorsText()
	}
	var groups []SensorGroup
	for chipName, chipData := range raw {
		adapter := ""
		var sensors []SensorReading
		for key, val := range chipData {
			if key == "Adapter" {
				if s, ok := val.(string); ok { adapter = s }
				continue
			}
			subMap, ok := val.(map[string]interface{})
			if !ok { continue }
			s := SensorReading{Label: key}
			for sk, sv := range subMap {
				f, ok := toFloat(sv)
				if !ok { continue }
				lk := strings.ToLower(sk)
				if strings.Contains(lk, "temp") && strings.Contains(lk, "input") { s.Temp = f; s.Unit = "°C" }
				if strings.Contains(lk, "temp") && strings.Contains(lk, "max")   { s.Max = f }
				if strings.Contains(lk, "temp") && strings.Contains(lk, "crit")  { s.Crit = f }
			}
			if s.Temp > 0 {
				if s.Warn == 0 { s.Warn = func() float64 { if s.Max > 0 { return s.Max*0.85 }; return 75 }() }
				if s.Crit == 0 { s.Crit = 100 }
				if s.Max  == 0 { s.Max = s.Crit }
				sensors = append(sensors, s)
			}
		}
		if len(sensors) > 0 {
			groups = append(groups, SensorGroup{Name: chipName, Adapter: adapter, Sensors: sensors})
		}
	}
	return groups, nil, nil
}

func parseSensorsText() ([]SensorGroup, []interface{}, error) {
	out, err := runCmd("sensors")
	if err != nil { return nil, nil, err }
	var groups []SensorGroup
	var cur *SensorGroup
	reTemp := regexp.MustCompile(`(?i)([\w\s\(\)]+):\s+\+?(-?\d+\.?\d*)°?C`)
	reMax  := regexp.MustCompile(`high\s*=\s*\+?(\d+\.?\d*)`)
	reCrit := regexp.MustCompile(`crit\s*=\s*\+?(\d+\.?\d*)`)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" { cur = nil; continue }
		if strings.HasPrefix(line, "Adapter:") {
			if cur != nil { cur.Adapter = strings.TrimPrefix(line, "Adapter: ") }
			continue
		}
		if !strings.Contains(line, ":") && !strings.HasPrefix(line, " ") {
			groups = append(groups, SensorGroup{Name: line})
			cur = &groups[len(groups)-1]
			continue
		}
		if cur == nil { continue }
		if m := reTemp.FindStringSubmatch(line); m != nil {
			temp, _ := strconv.ParseFloat(m[2], 64)
			if temp == 0 { continue }
			s := SensorReading{Label: strings.TrimSpace(m[1]), Temp: temp, Unit: "°C", Warn: 75, Crit: 100, Max: 100}
			if mm := reMax.FindStringSubmatch(line);  mm != nil { s.Max, _ = strconv.ParseFloat(mm[1], 64); s.Warn = s.Max * 0.85 }
			if mm := reCrit.FindStringSubmatch(line); mm != nil { s.Crit, _ = strconv.ParseFloat(mm[1], 64) }
			cur.Sensors = append(cur.Sensors, s)
		}
	}
	return groups, nil, nil
}

func toFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64: return x, true
	case string:  f, e := strconv.ParseFloat(x, 64); return f, e == nil
	}
	return 0, false
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleTemps(w http.ResponseWriter, r *http.Request) {
	_, sensorsErr := runCmd("which", "sensors")
	installed := sensorsErr == nil

	fans := buildFanList()
	groups, _, _ := parseSensorsOutput()

	fanAutoMu.Lock(); autoOn := fanAutoEnabled; fanAutoMu.Unlock()
	fanCfgMu.RLock(); cfg := fanCfg; fanCfgMu.RUnlock()

	tempHistory.mu.Lock()
	cpuH := append([]float64{}, tempHistory.CPU...)
	mbH  := append([]float64{}, tempHistory.MB...)
	tempHistory.mu.Unlock()

	jsonOK(w, map[string]any{
		"installed":     installed,
		"i8k_installed": i8kInstalled(),
		"hwmon_fans":    len(discoverHwmonFans()) > 0,
		"auto_mode":     autoOn,
		"preset":        cfg.Preset,
		"fan_config":    cfg,
		"groups":        groups,
		"fans":          fans,
		"history":       map[string]any{"cpu": cpuH, "mb": mbH},
	})
}

func (s *Server) handleTempsInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	out, err := runCmd("apt-get", "install", "-y", "lm-sensors", "fancontrol")
	if err != nil { jsonErr(w, out, 500); return }
	runCmd("sensors-detect", "--auto")
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}

func (s *Server) handleFanControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }

	var req struct {
		Fan     int    `json:"fan"`      // 0=wszystkie, 1,2...=konkretny (1-based)
		PWM     int    `json:"pwm"`      // 0-255
		PWMFile string `json:"pwm_file"` // opcjonalnie: bezpośrednia ścieżka /sys/.../pwmN
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.PWM < 0 || req.PWM > 255 {
		jsonErr(w, "pwm must be 0-255", 400); return
	}

	hwFans := discoverHwmonFans()

	if len(hwFans) == 0 {
		// Fallback i8k
		level := 0
		switch { case req.PWM >= 200: level=3; case req.PWM >= 130: level=2; case req.PWM >= 60: level=1 }
		runCmd("i8kctl", "fan", strconv.Itoa(level), strconv.Itoa(level))
		jsonOK(w, map[string]any{"status":"ok","pwm":req.PWM,"method":"i8k"})
		return
	}

	// Jeśli podano bezpośrednią ścieżkę — użyj jej
	if req.PWMFile != "" {
		// Walidacja bezpieczeństwa — tylko /sys/class/hwmon/
		if !strings.HasPrefix(req.PWMFile, "/sys/class/hwmon/") {
			jsonErr(w, "invalid pwm_file path", 400); return
		}
		setPWMManual(req.PWMFile, req.PWM)
	} else if req.Fan == 0 {
		// Ustaw wszystkie
		for _, hf := range hwFans {
			setPWMManual(hf.pwmFile, req.PWM)
		}
	} else if req.Fan >= 1 && req.Fan <= len(hwFans) {
		setPWMManual(hwFans[req.Fan-1].pwmFile, req.PWM)
	}

	time.Sleep(300 * time.Millisecond)
	result := buildFanList()
	jsonOK(w, map[string]any{"status":"ok","pwm":req.PWM,"fans":result,"method":"hwmon"})
}

func (s *Server) handleFanAuto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }

	var req struct {
		Enable bool   `json:"enable"`
		Preset string `json:"preset"`
	}
	req.Enable = true
	json.NewDecoder(r.Body).Decode(&req)

	if req.Preset != "" {
		fanCfgMu.Lock()
		fanCfg.Preset = req.Preset
		saveFanConfig(fanCfg)
		fanCfgMu.Unlock()
	}

	fanAutoMu.Lock()
	defer fanAutoMu.Unlock()

	if req.Enable && !fanAutoEnabled {
		fanAutoStop = make(chan struct{})
		fanAutoEnabled = true
		lastPWM = -1
		saveFanAutoState(true)
		startFanAutoLoop()
		fanCfgMu.RLock(); preset := fanCfg.Preset; fanCfgMu.RUnlock()
		jsonOK(w, map[string]any{"status":"ok","auto":true,"preset":preset})
	} else if !req.Enable && fanAutoEnabled {
		close(fanAutoStop)
		fanAutoEnabled = false
		saveFanAutoState(false)
		// Przywróć sterowanie automatyczne BIOS
		for _, hf := range discoverHwmonFans() {
			setPWMAuto(hf.pwmFile)
		}
		jsonOK(w, map[string]any{"status":"ok","auto":false})
	} else {
		fanCfgMu.RLock(); preset := fanCfg.Preset; fanCfgMu.RUnlock()
		jsonOK(w, map[string]any{"status":"ok","auto":fanAutoEnabled,"preset":preset})
	}
}

func (s *Server) handleFanAutoStatus(w http.ResponseWriter, r *http.Request) {
	fanAutoMu.Lock(); autoOn := fanAutoEnabled; fanAutoMu.Unlock()
	fanCfgMu.RLock(); cfg := fanCfg; fanCfgMu.RUnlock()
	jsonOK(w, map[string]any{"auto":autoOn,"preset":cfg.Preset,"config":cfg})
}

func (s *Server) handleFanConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		fanCfgMu.RLock(); cfg := fanCfg; fanCfgMu.RUnlock()
		jsonOK(w, cfg)
	case http.MethodPost:
		var req FanConfig
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "invalid JSON", 400); return
		}
		if req.Preset != "silent" && req.Preset != "balanced" && req.Preset != "turbo" { req.Preset = "balanced" }
		if req.Hyst <= 0 || req.Hyst > 20 { req.Hyst = 5 }
		if req.NightFrom < 0 || req.NightFrom > 23 { req.NightFrom = 22 }
		if req.NightTo   < 0 || req.NightTo   > 23 { req.NightTo = 6 }
		fanCfgMu.Lock(); fanCfg = req; saveFanConfig(req); fanCfgMu.Unlock()
		lastPWM = -1
		jsonOK(w, map[string]any{"status":"ok","config":req})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func (s *Server) handleFanDebug(w http.ResponseWriter, r *http.Request) {
	hwFans := discoverHwmonFans()
	var info []map[string]any
	for i, hf := range hwFans {
		pwmVal := readPWM(hf.pwmFile)
		pwmMode := readPWMMode(hf.pwmFile)
		rpm := readRPM(hf.rpmFile)
		pwmEnable, _ := os.ReadFile(hf.pwmFile + "_enable")
		info = append(info, map[string]any{
			"index":      i + 1,
			"hwmon":      hf.hwmonPath,
			"pwm_file":   hf.pwmFile,
			"rpm_file":   hf.rpmFile,
			"label":      hf.label,
			"pwm":        pwmVal,
			"pwm_mode":   pwmMode,
			"pwm_enable": strings.TrimSpace(string(pwmEnable)),
			"rpm":        rpm,
			"pwm_min":    hf.pwmMin,
			"pwm_max":    hf.pwmMax,
		})
	}
	// Też sprawdź raw /sys
	rawPaths, _ := filepath.Glob("/sys/class/hwmon/hwmon*/pwm*")
	jsonOK(w, map[string]any{
		"hwmon_fans":  info,
		"raw_pwm_paths": rawPaths,
		"i8k": i8kInstalled(),
	})
}
