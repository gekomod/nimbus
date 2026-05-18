package api

// ups.go — UPS ViewPower/Megatec Q1 przez USB HID (Cypress 0665:5161 → /dev/hidraw0)
// Każda komenda: otwórz hidraw → wyślij → czekaj → czytaj → zamknij
// Eliminuje problem zalegających danych w buforze

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type UPSStatus struct {
	InputVoltage   float64 `json:"input_voltage"`
	InputFaultVolt float64 `json:"input_fault_voltage"`
	OutputVoltage  float64 `json:"output_voltage"`
	OutputCurrent  float64 `json:"output_current_pct"`
	InputFreq      float64 `json:"input_freq"`
	BatteryVoltage float64 `json:"battery_voltage"`
	Temperature    float64 `json:"temperature"`
	UtilityFail    bool    `json:"utility_fail"`
	BatteryLow     bool    `json:"battery_low"`
	BypassActive   bool    `json:"bypass_active"`
	UPSFailed      bool    `json:"ups_failed"`
	TestInProgress bool    `json:"test_in_progress"`
	ShutdownActive bool    `json:"shutdown_active"`
	BeeperOn       bool    `json:"beeper_on"`
	OnBattery      bool    `json:"on_battery"`
	LoadWatts      float64 `json:"load_watts"`
	BatteryPct     float64 `json:"battery_pct"`
	RuntimeMin     int     `json:"runtime_min"`
	Status         string  `json:"status"`
	Port           string  `json:"port"`
	LastUpdate     string  `json:"last_update"`
	Raw            string  `json:"raw,omitempty"`
}

type UPSInfo struct {
	Model        string `json:"model"`
	RatedVoltage string `json:"rated_voltage"`
	RatedCurrent string `json:"rated_current"`
	RatedFreq    string `json:"rated_freq"`
	BattVoltage  string `json:"batt_voltage"`
	Port         string `json:"port"`
}

type UPSConfig struct {
	Port     string `json:"port"`
	BaudRate int    `json:"baud_rate"`
	RatedVA  int    `json:"rated_va"`
}

const upsConfigPath = "/var/lib/nimbus/ups_config.json"

func loadUPSConfig() UPSConfig {
	data, err := os.ReadFile(upsConfigPath)
	if err != nil {
		return UPSConfig{Port: "/dev/hidraw0", BaudRate: 2400, RatedVA: 600}
	}
	var cfg UPSConfig
	json.Unmarshal(data, &cfg)
	if cfg.Port == "" { cfg.Port = "/dev/hidraw0" }
	if cfg.BaudRate == 0 { cfg.BaudRate = 2400 }
	if cfg.RatedVA == 0 { cfg.RatedVA = 600 }
	return cfg
}

func saveUPSConfig(cfg UPSConfig) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	data, _ := json.Marshal(cfg)
	os.WriteFile(upsConfigPath, data, 0644)
}

// sendHIDCmd — otwiera urządzenie, wysyła komendę, zbiera odpowiedź, zamyka
// Otwarcie/zamknięcie za każdym razem eliminuje zalegające dane w buforze
func sendHIDCmd(portPath, cmd string) (string, error) {
	f, err := os.OpenFile(portPath, os.O_RDWR, 0666)
	if err != nil {
		return "", fmt.Errorf("nie można otworzyć %s: %v", portPath, err)
	}
	defer f.Close()

	// Wyślij komendę
	if _, err := f.Write([]byte(cmd + "\r")); err != nil {
		return "", fmt.Errorf("błąd zapisu: %v", err)
	}

	// Czekaj 500ms potem zbieraj przez 20×100ms = 2s
	time.Sleep(500 * time.Millisecond)

	var all []byte
	buf := make([]byte, 64)
	for i := 0; i < 20; i++ {
		n, _ := f.Read(buf)
		if n > 0 {
			all = append(all, buf[:n]...)
			if strings.ContainsRune(string(all), '\r') {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	str := string(all)
	// Szukaj odpowiedzi od '(' (Q1) lub '#' (F/I)
	for _, marker := range []byte{'(', '#'} {
		if idx := strings.IndexByte(str, marker); idx >= 0 {
			sub := str[idx:]
			if end := strings.IndexByte(sub, '\r'); end > 0 {
				return strings.TrimSpace(sub[:end]), nil
			}
			return strings.TrimRight(strings.ReplaceAll(sub, "\x00", ""), "\r\n "), nil
		}
	}
	return strings.TrimRight(strings.ReplaceAll(str, "\x00", ""), "\r\n "), nil
}

// sendSerialCmd — dla portów /dev/ttyUSB*
func sendSerialCmd(portPath string, baud int, cmd string) (string, error) {
	f, err := os.OpenFile(portPath, os.O_RDWR|syscall.O_NOCTTY, 0666)
	if err != nil {
		return "", fmt.Errorf("nie można otworzyć %s: %v", portPath, err)
	}
	defer f.Close()

	fd := f.Fd()
	var termios syscall.Termios
	syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCGETS, uintptr(unsafe.Pointer(&termios)))
	var baudConst uint32
	switch baud {
	case 2400: baudConst = syscall.B2400
	case 4800: baudConst = syscall.B4800
	case 9600: baudConst = syscall.B9600
	default:   baudConst = syscall.B2400
	}
	termios.Cflag = baudConst | syscall.CS8 | syscall.CREAD | syscall.CLOCAL
	termios.Iflag, termios.Oflag, termios.Lflag = 0, 0, 0
	termios.Cc[syscall.VMIN] = 0
	termios.Cc[syscall.VTIME] = 30
	syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCSETS, uintptr(unsafe.Pointer(&termios)))

	f.Write([]byte(cmd + "\r"))

	var buf strings.Builder
	b := make([]byte, 1)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		n, _ := f.Read(b)
		if n > 0 {
			if b[0] == '\r' || b[0] == '\n' {
				if buf.Len() > 0 { break }
				continue
			}
			buf.WriteByte(b[0])
		}
	}
	return strings.TrimSpace(buf.String()), nil
}

func sendUPSCmd(portPath string, baud int, cmd string) (string, error) {
	if strings.Contains(portPath, "hidraw") {
		return sendHIDCmd(portPath, cmd)
	}
	return sendSerialCmd(portPath, baud, cmd)
}

// parseQ1 — format: (MMM.M NNN.N PPP.P QQQ RR.R SS.SS TT.T b7b6b5b4b3b2b1b0
func parseQ1(resp string) (*UPSStatus, error) {
	resp = strings.TrimPrefix(resp, "(")
	fields := strings.Fields(strings.TrimSpace(resp))
	if len(fields) < 5 {
		return nil, fmt.Errorf("nieprawidłowa odpowiedź Q1: %q (%d pól)", resp, len(fields))
	}
	for len(fields) < 8 {
		fields = append(fields, "0")
	}

	parseF := func(v string) float64 {
		v = strings.ReplaceAll(v, "-", "")
		if v == "" || v == "." { return 0 }
		f, _ := strconv.ParseFloat(v, 64)
		return f
	}

	s := &UPSStatus{Raw: resp}
	s.InputVoltage   = parseF(fields[0])
	s.InputFaultVolt = parseF(fields[1])
	s.OutputVoltage  = parseF(fields[2])
	s.OutputCurrent  = parseF(fields[3])
	s.InputFreq      = parseF(fields[4])
	s.BatteryVoltage = parseF(fields[5])
	s.Temperature    = parseF(fields[6])

	bits := fields[7]
	if len(bits) >= 8 {
		s.UtilityFail    = bits[0] == '1'
		s.BatteryLow     = bits[1] == '1'
		s.BypassActive   = bits[2] == '1'
		s.UPSFailed      = bits[3] == '1'
		s.TestInProgress = bits[5] == '1'
		s.ShutdownActive = bits[6] == '1'
		s.BeeperOn       = bits[7] == '1'
	}

	s.OnBattery = s.UtilityFail
	switch {
	case s.UPSFailed:                    s.Status = "fault"
	case s.BatteryLow && s.OnBattery:    s.Status = "low_battery"
	case s.OnBattery:                    s.Status = "on_battery"
	default:                             s.Status = "online"
	}
	s.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
	return s, nil
}

func enrichUPS(s *UPSStatus, cfg UPSConfig) {
	s.LoadWatts = float64(cfg.RatedVA) * 0.8 * s.OutputCurrent / 100.0
	bv := s.BatteryVoltage
	var bMin, bMax float64
	switch {
	case bv >= 40: bMin, bMax = 42.0, 54.0
	case bv >= 20: bMin, bMax = 21.0, 27.4
	default:       bMin, bMax = 10.5, 12.7
	}
	if bMax > bMin {
		s.BatteryPct = (bv - bMin) / (bMax - bMin) * 100
		if s.BatteryPct > 100 { s.BatteryPct = 100 }
		if s.BatteryPct < 0  { s.BatteryPct = 0 }
	}
	if s.OnBattery && s.LoadWatts > 0 {
		s.RuntimeMin = int(67.0 * (s.BatteryPct / 100.0) / s.LoadWatts * 60)
	}
}

// ── Funkcje delegowane z power.go ────────────────────────────────────────────

func upsStatusHandler(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()
	resp, err := sendUPSCmd(cfg.Port, cfg.BaudRate, "Q1")
	if err != nil {
		jsonOK(w, map[string]any{"connected": false, "error": err.Error(), "port": cfg.Port, "config": cfg})
		return
	}
	status, err := parseQ1(resp)
	if err != nil {
		jsonOK(w, map[string]any{"connected": false, "error": err.Error(), "raw": resp, "port": cfg.Port})
		return
	}
	status.Port = cfg.Port
	enrichUPS(status, cfg)
	jsonOK(w, map[string]any{"connected": true, "status": status, "config": cfg})
}

func upsInfoHandler(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()
	info := UPSInfo{Port: cfg.Port}

	if resp, err := sendUPSCmd(cfg.Port, cfg.BaudRate, "I"); err == nil {
		resp = strings.TrimPrefix(resp, "#")
		parts := strings.Fields(resp)
		if len(parts) >= 2 { info.Model = parts[0] + " " + parts[1] }
	}

	if resp, err := sendUPSCmd(cfg.Port, cfg.BaudRate, "F"); err == nil {
		resp = strings.TrimPrefix(resp, "#")
		parts := strings.Fields(resp)
		if len(parts) >= 4 {
			info.RatedVoltage = parts[0] + "V"
			info.RatedCurrent = parts[1] + "A"
			info.RatedFreq    = parts[2] + "Hz"
			info.BattVoltage  = parts[3] + "V"
		}
	}

	jsonOK(w, info)
}

func upsCommandHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct{ Command string `json:"command"` }
	json.NewDecoder(r.Body).Decode(&req)

	cfg := loadUPSConfig()
	cmdMap := map[string]string{
		"test":"T", "test_long":"TL", "test_cancel":"CT",
		"beeper_toggle":"Q", "shutdown_cancel":"C",
		"shutdown_1min":"S01", "shutdown_2min":"S02", "shutdown_5min":"S05",
	}
	cmd, ok := cmdMap[req.Command]
	if !ok { jsonErr(w, "nieznana komenda: "+req.Command, 400); return }

	resp, _ := sendUPSCmd(cfg.Port, cfg.BaudRate, cmd)
	jsonOK(w, map[string]any{"status": "ok", "command": req.Command, "raw": cmd, "response": resp})
}

func upsConfigHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, loadUPSConfig())
	case http.MethodPost:
		var cfg UPSConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonErr(w, "invalid JSON", 400); return
		}
		if cfg.Port == "" { cfg.Port = "/dev/hidraw0" }
		if cfg.BaudRate == 0 { cfg.BaudRate = 2400 }
		if cfg.RatedVA == 0 { cfg.RatedVA = 600 }
		saveUPSConfig(cfg)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func (s *Server) handleUPSCommand(w http.ResponseWriter, r *http.Request) {
	upsCommandHandler(w, r)
}

func (s *Server) handleUPSPorts(w http.ResponseWriter, r *http.Request) {
	entries, _ := os.ReadDir("/dev")
	var ports []map[string]string
	for _, e := range entries {
		name := e.Name()
		info := map[string]string{"port": "/dev/" + name}
		if strings.HasPrefix(name, "hidraw") {
			if data, err := os.ReadFile("/sys/class/hidraw/" + name + "/device/../idVendor"); err == nil {
				if strings.TrimSpace(string(data)) == "0665" {
					info["vendor"] = "Cypress USB HID (ViewPower UPS)"
					info["recommended"] = "true"
				}
			}
			ports = append(ports, info)
		} else if strings.HasPrefix(name, "ttyUSB") || strings.HasPrefix(name, "ttyACM") {
			ports = append(ports, info)
		}
	}
	jsonOK(w, map[string]any{"ports": ports})
}
