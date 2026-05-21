package api

// ups.go — UPS przez NUT (Network UPS Tools) / blazer_usb
// Odpytuje upsc przez exec zamiast walczyć z hidraw

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

type UPSStatus struct {
	// Bateria
	BatteryCharge  float64 `json:"battery_charge"`
	BatteryVoltage float64 `json:"battery_voltage"`
	BatteryVoltageHigh float64 `json:"battery_voltage_high"`
	BatteryVoltageLow  float64 `json:"battery_voltage_low"`
	// Wejście
	InputVoltage   float64 `json:"input_voltage"`
	InputFaultVolt float64 `json:"input_fault_voltage"`
	InputFreq      float64 `json:"input_freq"`
	// Wyjście
	OutputVoltage  float64 `json:"output_voltage"`
	OutputCurrent  float64 `json:"output_current_pct"`
	// UPS
	UPSLoad        float64 `json:"ups_load"`
	UPSStatus      string  `json:"ups_status_raw"`
	UPSType        string  `json:"ups_type"`
	BeeperStatus   string  `json:"beeper_status"`
	Temperature    float64 `json:"temperature"`
	// Obliczone
	Status         string  `json:"status"`
	OnBattery      bool    `json:"on_battery"`
	BatteryLow     bool    `json:"battery_low"`
	LoadWatts      float64 `json:"load_watts"`
	BatteryPct     float64 `json:"battery_pct"`
	RuntimeMin     int     `json:"runtime_min"`
	// Meta
	Port           string  `json:"port"`
	UPSName        string  `json:"ups_name"`
	LastUpdate     string  `json:"last_update"`
}

type UPSInfo struct {
	Model        string `json:"model"`
	RatedVoltage string `json:"rated_voltage"`
	RatedCurrent string `json:"rated_current"`
	RatedFreq    string `json:"rated_freq"`
	BattVoltage  string `json:"batt_voltage"`
	DriverName   string `json:"driver_name"`
	DriverVer    string `json:"driver_version"`
	Port         string `json:"port"`
}

type UPSConfig struct {
	UPSName  string `json:"ups_name"`  // np. "moj_ups"
	Host     string `json:"host"`      // np. "localhost"
	Port     string `json:"port"`      // zachowane dla kompatybilności UI
	BaudRate int    `json:"baud_rate"`
	RatedVA  int    `json:"rated_va"`
}

const upsConfigPath = "/var/lib/nimbus/ups_config.json"

func loadUPSConfig() UPSConfig {
	data, err := os.ReadFile(upsConfigPath)
	if err != nil {
		return UPSConfig{UPSName: "moj_ups", Host: "localhost", Port: "/dev/hidraw0", BaudRate: 2400, RatedVA: 600}
	}
	var cfg UPSConfig
	json.Unmarshal(data, &cfg)
	if cfg.UPSName == "" { cfg.UPSName = "moj_ups" }
	if cfg.Host == "" { cfg.Host = "localhost" }
	if cfg.RatedVA == 0 { cfg.RatedVA = 600 }
	return cfg
}

func saveUPSConfig(cfg UPSConfig) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	data, _ := json.Marshal(cfg)
	os.WriteFile(upsConfigPath, data, 0644)
}

// upscQuery — odpytuje upsc i zwraca mapę klucz→wartość
func upscQuery(upsName, host string) (map[string]string, error) {
	target := upsName + "@" + host
	out, err := exec.Command("upsc", target).Output()
	if err != nil {
		return nil, fmt.Errorf("upsc %s: %v", target, err)
	}

	result := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		// Pomiń linie init/ssl
		if strings.HasPrefix(line, "Init SSL") || line == "" {
			continue
		}
		parts := strings.SplitN(line, ": ", 2)
		if len(parts) == 2 {
			result[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return result, nil
}

func parseFloat(m map[string]string, key string) float64 {
	v, ok := m[key]
	if !ok { return 0 }
	f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return f
}

func nutStatusToStatus(upsStatus string) (string, bool, bool) {
	// NUT status: OL=online, OB=on battery, LB=low battery, CHRG=charging itd.
	onBattery := strings.Contains(upsStatus, "OB")
	lowBattery := strings.Contains(upsStatus, "LB")
	var status string
	switch {
	case strings.Contains(upsStatus, "ALARM") || strings.Contains(upsStatus, "FSD"):
		status = "fault"
	case lowBattery && onBattery:
		status = "low_battery"
	case onBattery:
		status = "on_battery"
	default:
		status = "online"
	}
	return status, onBattery, lowBattery
}

func upsStatusHandler(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()

	data, err := upscQuery(cfg.UPSName, cfg.Host)
	if err != nil {
		jsonOK(w, map[string]any{
			"connected": false,
			"error":     err.Error(),
			"port":      cfg.Port,
			"config":    cfg,
		})
		return
	}

	s := &UPSStatus{}
	s.BatteryCharge      = parseFloat(data, "battery.charge")
	s.BatteryVoltage     = parseFloat(data, "battery.voltage")
	s.BatteryVoltageHigh = parseFloat(data, "battery.voltage.high")
	s.BatteryVoltageLow  = parseFloat(data, "battery.voltage.low")
	s.InputVoltage       = parseFloat(data, "input.voltage")
	s.InputFaultVolt     = parseFloat(data, "input.voltage.fault")
	s.InputFreq          = parseFloat(data, "input.frequency")
	s.OutputVoltage      = parseFloat(data, "output.voltage")
	s.UPSLoad            = parseFloat(data, "ups.load")
	s.OutputCurrent      = s.UPSLoad
	s.Temperature        = parseFloat(data, "ups.temperature")
	s.UPSStatus          = data["ups.status"]
	s.UPSType            = data["ups.type"]
	s.BeeperStatus       = data["ups.beeper.status"]
	s.UPSName            = cfg.UPSName
	s.Port               = cfg.Port

	// Status
	s.Status, s.OnBattery, s.BatteryLow = nutStatusToStatus(s.UPSStatus)
	s.BatteryPct = s.BatteryCharge

	// Moc w watach
	s.LoadWatts = float64(cfg.RatedVA) * 0.8 * s.UPSLoad / 100.0

	// Runtime z NUT lub obliczony
	if rt := parseFloat(data, "battery.runtime"); rt > 0 {
		s.RuntimeMin = int(rt / 60)
	} else if s.OnBattery && s.LoadWatts > 0 {
		battCapWh := 67.0 * (s.BatteryPct / 100.0)
		s.RuntimeMin = int(battCapWh / s.LoadWatts * 60)
	}

	// Czas odczytu
	if out, err := exec.Command("date", "+%Y-%m-%d %H:%M:%S").Output(); err == nil {
		s.LastUpdate = strings.TrimSpace(string(out))
	}

	// Zapisz próbkę napięcia do historii
	if s.InputVoltage > 0 {
		recordUPSVoltage(s.InputVoltage)
	}

	jsonOK(w, map[string]any{
		"connected": true,
		"status":    s,
		"config":    cfg,
		"nut_raw":   data,
	})
}

func upsInfoHandler(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()

	data, err := upscQuery(cfg.UPSName, cfg.Host)
	if err != nil {
		jsonErr(w, err.Error(), 503)
		return
	}

	info := UPSInfo{
		Port:         cfg.Port,
		RatedVoltage: fmt.Sprintf("%.0fV", parseFloat(data, "input.voltage.nominal")),
		RatedCurrent: fmt.Sprintf("%.1fA", parseFloat(data, "input.current.nominal")),
		RatedFreq:    fmt.Sprintf("%.0fHz", parseFloat(data, "input.frequency.nominal")),
		BattVoltage:  fmt.Sprintf("%.1fV", parseFloat(data, "battery.voltage.nominal")),
		DriverName:   data["driver.name"],
		DriverVer:    data["driver.version"],
	}

	// Model z device.mfr + device.model lub ups.vendorid
	mfr := data["device.mfr"]
	model := data["device.model"]
	if mfr != "" && model != "" {
		info.Model = mfr + " " + model
	} else if model != "" {
		info.Model = model
	} else {
		info.Model = "PowerWalker UPS (" + data["driver.name"] + ")"
	}

	jsonOK(w, info)
}

func upsCommandHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct{ Command string `json:"command"` }
	json.NewDecoder(r.Body).Decode(&req)

	cfg := loadUPSConfig()
	target := cfg.UPSName + "@" + cfg.Host

	// Mapowanie komend NUT
	type nutCmd struct {
		cmdType string // "instcmd" lub "set"
		name    string
		value   string
	}
	cmdMap := map[string]nutCmd{
		"test":            {"instcmd", "test.battery.start.quick", ""},
		"test_long":       {"instcmd", "test.battery.start.deep", ""},
		"test_cancel":     {"instcmd", "test.battery.stop", ""},
		"beeper_toggle":   {"instcmd", "beeper.toggle", ""},
		"beeper_off":      {"instcmd", "beeper.toggle", ""},
		"beeper_on":       {"instcmd", "beeper.toggle", ""},
		"shutdown_return": {"instcmd", "shutdown.return", ""},
		"shutdown_stayoff":{"instcmd", "shutdown.stayoff", ""},
		"shutdown_1min":   {"instcmd", "shutdown.return", ""},
		"shutdown_cancel": {"instcmd", "shutdown.stop", ""},
		"load_off":        {"instcmd", "load.off", ""},
		"load_on":         {"instcmd", "load.on", ""},
	}

	cmd, ok := cmdMap[req.Command]
	if !ok { jsonErr(w, "nieznana komenda: "+req.Command, 400); return }

	var out []byte
	var err error
	if cmd.cmdType == "instcmd" {
		c := exec.Command("upscmd", "-u", "nimbus", "-p", "nimbus123", target, cmd.name)
		out, err = c.CombinedOutput()
	} else {
		c := exec.Command("upsrw", "-s", cmd.name+"="+cmd.value, "-u", "nimbus", "-p", "nimbus123", target)
		out, err = c.CombinedOutput()
	}

	outStr := strings.TrimSpace(string(out))
	if err != nil {
		// upscmd zwraca błąd ale komenda mogła zostać wysłana
		if strings.Contains(outStr, "OK") {
			jsonOK(w, map[string]any{"status": "ok", "command": req.Command, "response": outStr})
			return
		}
		jsonOK(w, map[string]any{"status": "error", "error": outStr, "command": req.Command})
		return
	}
	jsonOK(w, map[string]any{"status": "ok", "command": req.Command, "response": outStr})
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
		if cfg.UPSName == "" { cfg.UPSName = "moj_ups" }
		if cfg.Host == "" { cfg.Host = "localhost" }
		if cfg.RatedVA == 0 { cfg.RatedVA = 600 }
		saveUPSConfig(cfg)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func (s *Server) handleUPSCommand(w http.ResponseWriter, r *http.Request) { upsCommandHandler(w, r) }

func (s *Server) handleUPSPorts(w http.ResponseWriter, r *http.Request) {
	// Zwróć listę UPS-ów z NUT
	out, err := exec.Command("upsc", "-l").Output()
	if err != nil {
		jsonOK(w, map[string]any{"ports": []any{}, "error": err.Error()})
		return
	}
	var upsList []map[string]string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "Init") {
			upsList = append(upsList, map[string]string{
				"port":   line,
				"vendor": "NUT UPS",
				"type":   "NUT",
			})
		}
	}
	jsonOK(w, map[string]any{"ports": upsList})
}

// handleUPSEvents — czyta prawdziwe logi NUT z journalctl
func upsEventsHandler(w http.ResponseWriter, r *http.Request) {
	out, err := exec.Command("journalctl", "-u", "nut-server", "-u", "nut-driver",
		"--no-pager", "-n", "50", "--output=short-iso").Output()
	if err != nil {
		jsonOK(w, map[string]any{"events": []any{}})
		return
	}

	type Event struct {
		T   string `json:"t"`
		Lvl string `json:"lvl"`
		Msg string `json:"msg"`
	}

	var events []Event
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" { continue }
		// Format: 2026-05-19T11:40:21+0200 hostname service[pid]: message
		parts := strings.SplitN(line, " ", 4)
		if len(parts) < 4 { continue }
		t := strings.Replace(parts[0], "T", " ", 1)
		if len(t) > 19 { t = t[:19] }
		msg := parts[3]
		// Wytnij prefix serwisu
		if idx := strings.Index(msg, "]: "); idx >= 0 {
			msg = msg[idx+3:]
		}
		// Pomiń techniczne
		if strings.Contains(msg, "upsnotify") || strings.Contains(msg, "will not spam") {
			continue
		}

		lvl := "INFO"
		switch {
		case strings.Contains(msg, "on battery") || strings.Contains(msg, "ONBATT"):
			lvl = "WARN"
		case strings.Contains(msg, "error") || strings.Contains(msg, "Error") ||
			strings.Contains(msg, "fail") || strings.Contains(msg, "lost"):
			lvl = "ERR"
		case strings.Contains(msg, "online") || strings.Contains(msg, "ONLINE") ||
			strings.Contains(msg, "OK") || strings.Contains(msg, "connected"):
			lvl = "OK"
		}

		events = append(events, Event{T: t, Lvl: lvl, Msg: msg})
	}

	// Odwróć — najnowsze pierwsze
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}

	jsonOK(w, map[string]any{"events": events})
}

// handleUPSUpsmonConf — czyta /etc/nut/upsmon.conf i zwraca parametry
func (s *Server) handleUPSUpsmonConf(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile("/etc/nut/upsmon.conf")
	if err != nil {
		jsonErr(w, err.Error(), 500)
		return
	}

	params := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") { continue }
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			params[parts[0]] = strings.Join(parts[1:], " ")
		}
	}
	jsonOK(w, params)
}

// handleUPSNotifChannels — zwraca kanały powiadomień z systemu Nimbus
func (s *Server) handleUPSNotifChannels(w http.ResponseWriter, r *http.Request) {
	// Przekaż do istniejącego handlera powiadomień
	s.handleNotifChannels(w, r)
}

// handleUPSVoltageHistory — zbiera historię napięcia wejściowego
// Przechowuje ostatnie 60 próbek (co ~10s = ostatnia godzina)
var (
	upsVoltageHistory []float64
	upsVoltageHistMu  sync.Mutex
)

func recordUPSVoltage(v float64) {
	upsVoltageHistMu.Lock()
	defer upsVoltageHistMu.Unlock()
	upsVoltageHistory = append(upsVoltageHistory, v)
	if len(upsVoltageHistory) > 360 { // max 360 próbek
		upsVoltageHistory = upsVoltageHistory[len(upsVoltageHistory)-360:]
	}
}

func (s *Server) handleUPSVoltageHistory(w http.ResponseWriter, r *http.Request) {
	upsVoltageHistMu.Lock()
	h := make([]float64, len(upsVoltageHistory))
	copy(h, upsVoltageHistory)
	upsVoltageHistMu.Unlock()
	jsonOK(w, map[string]any{"history": h, "interval_s": 10})
}

// ── Pełna obsługa UPS ────────────────────────────────────────────────────────

// handleUPSNutConfig — GET/POST konfiguracji NUT (/etc/nut/ups.conf, upsd.conf)
func (s *Server) handleUPSNutConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		upsConf, _ := os.ReadFile("/etc/nut/ups.conf")
		upsdConf, _ := os.ReadFile("/etc/nut/upsd.conf")
		upsdUsers, _ := os.ReadFile("/etc/nut/upsd.users")
		jsonOK(w, map[string]string{
			"ups_conf":   string(upsConf),
			"upsd_conf":  string(upsdConf),
			"upsd_users": string(upsdUsers),
		})
	case http.MethodPost:
		var req map[string]string
		json.NewDecoder(r.Body).Decode(&req)
		if v, ok := req["ups_conf"]; ok {
			os.WriteFile("/etc/nut/ups.conf", []byte(v), 0640)
		}
		if v, ok := req["upsd_conf"]; ok {
			os.WriteFile("/etc/nut/upsd.conf", []byte(v), 0640)
		}
		if v, ok := req["upsd_users"]; ok {
			os.WriteFile("/etc/nut/upsd.users", []byte(v), 0640)
		}
		// Przeładuj upsd
		runCmd("systemctl", "reload", "nut-server")
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// handleUPSUpsmonConfig — GET/POST /etc/nut/upsmon.conf
func (s *Server) handleUPSUpsmonConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		data, _ := os.ReadFile("/etc/nut/upsmon.conf")
		jsonOK(w, map[string]string{"content": string(data)})
	case http.MethodPost:
		var req struct {
			Content string `json:"content"`
			// Lub pola strukturalne
			MinSupplies string `json:"min_supplies"`
			DeadTime    string `json:"dead_time"`
			FinalDelay  string `json:"final_delay"`
			RbWarnTime  string `json:"rb_warn_time"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Content != "" {
			os.WriteFile("/etc/nut/upsmon.conf", []byte(req.Content), 0640)
		} else {
			// Zaktualizuj konkretne pola
			data, _ := os.ReadFile("/etc/nut/upsmon.conf")
			content := string(data)
			fields := map[string]string{
				"MINSUPPLIES": req.MinSupplies,
				"DEADTIME":    req.DeadTime,
				"FINALDELAY":  req.FinalDelay,
				"RBWARNTIME":  req.RbWarnTime,
			}
			for k, v := range fields {
				if v == "" { continue }
				// Zamień lub dodaj
				if strings.Contains(content, k+" ") {
					lines := strings.Split(content, "\n")
					for i, line := range lines {
						if strings.HasPrefix(strings.TrimSpace(line), k+" ") {
							lines[i] = k + " " + v
						}
					}
					content = strings.Join(lines, "\n")
				} else {
					content += "\n" + k + " " + v
				}
			}
			os.WriteFile("/etc/nut/upsmon.conf", []byte(content), 0640)
		}
		runCmd("systemctl", "restart", "nut-monitor")
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// handleUPSSlaves — lista podłączonych klientów upsd
func (s *Server) handleUPSSlaves(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()
	target := cfg.UPSName + "@" + cfg.Host
	// upsc -c list zwraca klientów
	out, _ := runCmd("upsc", "-c", "list", target)
	var slaves []map[string]string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Init SSL") { continue }
		slaves = append(slaves, map[string]string{"host": line, "role": "secondary", "state": "ok"})
	}
	if slaves == nil { slaves = []map[string]string{} }
	jsonOK(w, map[string]any{"slaves": slaves})
}

// handleUPSSelftests — historia testów baterii z logów
func (s *Server) handleUPSSelftests(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("journalctl", "-u", "nut-server", "-u", "nut-driver",
		"--no-pager", "-n", "200", "--output=short-iso",
		"--grep", "test")

	type SelfTest struct {
		Date     string `json:"date"`
		Mode     string `json:"mode"`
		Duration string `json:"duration"`
		Result   string `json:"result"`
	}

	var tests []SelfTest
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "test") { continue }
		t := "—"
		parts := strings.Fields(line)
		if len(parts) > 0 {
			ts := parts[0]
			if len(ts) > 19 { ts = ts[:19] }
			t = strings.Replace(ts, "T", " ", 1)
		}
		mode := "Quick"
		if strings.Contains(line, "deep") { mode = "Deep" }
		result := "ok"
		if strings.Contains(line, "fail") || strings.Contains(line, "error") { result = "err" }
		tests = append(tests, SelfTest{Date: t, Mode: mode, Duration: "12s", Result: result})
	}
	if tests == nil { tests = []SelfTest{} }
	jsonOK(w, map[string]any{"tests": tests})
}

const upsRulesFile = "/var/lib/nimbus/ups_rules.json"

type UPSRule struct {
	ID      string `json:"id"`
	On      bool   `json:"on"`
	Trigger string `json:"trigger"`
	After   string `json:"after"`
	Action  string `json:"action"`
	Target  string `json:"target"`
}

func loadUPSRules() []UPSRule {
	data, err := os.ReadFile(upsRulesFile)
	if err != nil {
		// Domyślne reguły
		return []UPSRule{
			{ID:"1",On:true, Trigger:"on-battery",   After:"natychmiast",Action:"Powiadomienie",    Target:"admin"},
			{ID:"2",On:true, Trigger:"battery < 25%",After:"60s",        Action:"Shutdown slave",   Target:""},
			{ID:"3",On:true, Trigger:"battery < 15%",After:"30s",        Action:"Shutdown host",    Target:"localhost"},
			{ID:"4",On:false,Trigger:"load > 80%",   After:"300s",       Action:"Powiadomienie",    Target:"admin"},
		}
	}
	var rules []UPSRule
	json.Unmarshal(data, &rules)
	return rules
}

func saveUPSRules(rules []UPSRule) {
	os.MkdirAll("/var/lib/nimbus", 0755)
	data, _ := json.MarshalIndent(rules, "", "  ")
	os.WriteFile(upsRulesFile, data, 0644)
}

// handleUPSRules — GET/POST/DELETE reguł reakcji
func (s *Server) handleUPSRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"rules": loadUPSRules()})
	case http.MethodPost:
		var rule UPSRule
		json.NewDecoder(r.Body).Decode(&rule)
		rules := loadUPSRules()
		if rule.ID == "" {
			rule.ID = fmt.Sprintf("%d", len(rules)+1)
			rules = append(rules, rule)
		} else {
			for i, r2 := range rules {
				if r2.ID == rule.ID { rules[i] = rule; goto done }
			}
			rules = append(rules, rule)
		}
		done:
		saveUPSRules(rules)
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete:
		var req struct{ ID string `json:"id"` }
		json.NewDecoder(r.Body).Decode(&req)
		rules := loadUPSRules()
		new2 := rules[:0]
		for _, r2 := range rules {
			if r2.ID != req.ID { new2 = append(new2, r2) }
		}
		saveUPSRules(new2)
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

// handleUPSSimulate — symuluje awarię zasilania przez upsmon
func (s *Server) handleUPSSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct {
		Type     string `json:"type"`     // "onbattery"|"lowbattery"|"fsd"
		Duration int    `json:"duration"` // sekundy
	}
	json.NewDecoder(r.Body).Decode(&req)

	cfg := loadUPSConfig()
	target := cfg.UPSName + "@" + cfg.Host

	switch req.Type {
	case "onbattery":
		// Wyślij komendę testu przez upscmd
		out, err := exec.Command("upscmd", "-u", "nimbus", "-p", "nimbus123", target, "test.battery.start.quick").CombinedOutput()
		if err != nil {
			jsonOK(w, map[string]any{"status": "error", "output": string(out)})
			return
		}
		jsonOK(w, map[string]any{"status": "ok", "message": "Test baterii uruchomiony (10s)", "output": strings.TrimSpace(string(out))})
	case "fsd":
		// Forced Shutdown — tylko w dry-run
		jsonOK(w, map[string]any{"status": "dry-run", "message": "FSD nie wykonany — włącz dry-run mode aby testować"})
	default:
		jsonOK(w, map[string]any{"status": "ok", "message": "Symulacja: " + req.Type})
	}
}

// handleUPSVoltageExport — eksport historii napięcia jako CSV
func (s *Server) handleUPSVoltageExport(w http.ResponseWriter, r *http.Request) {
	upsVoltageHistMu.Lock()
	h := make([]float64, len(upsVoltageHistory))
	copy(h, upsVoltageHistory)
	upsVoltageHistMu.Unlock()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=ups_voltage.csv")
	fmt.Fprintln(w, "sample,voltage_v")
	for i, v := range h {
		fmt.Fprintf(w, "%d,%.2f\n", i+1, v)
	}
}

// handleUPSClientConfig — generuje upsmon.conf dla klienta zdalnego
func (s *Server) handleUPSClientConfig(w http.ResponseWriter, r *http.Request) {
	cfg := loadUPSConfig()
	// Pobierz IP serwera
	hostname, _ := os.Hostname()

	config := fmt.Sprintf(`# upsmon.conf dla klienta zdalnego NUT
# Wygenerowano przez Nimbus NAS Panel
# Skopiuj do /etc/nut/upsmon.conf na kliencie

MONITOR %s@%s 1 monitor nimbus123 secondary

MINSUPPLIES 1
SHUTDOWNCMD "/sbin/shutdown -h +0"
POLLFREQ 5
POLLFREQALERT 5
HOSTSYNC 15
DEADTIME 15
FINALDELAY 5
`, cfg.UPSName, hostname)

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", "attachment; filename=upsmon-client.conf")
	fmt.Fprint(w, config)
}

// handleUPSServiceAction — restart/reload usług NUT
func (s *Server) handleUPSServiceAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", 405); return }
	var req struct {
		Service string `json:"service"` // "nut-server"|"nut-driver"|"nut-monitor"|"all"
		Action  string `json:"action"`  // "restart"|"reload"|"stop"|"start"
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.Action == "" { req.Action = "restart" }

	services := []string{req.Service}
	if req.Service == "all" {
		services = []string{"nut-driver", "nut-server", "nut-monitor"}
	}

	var results []string
	for _, svc := range services {
		out, err := runCmd("systemctl", req.Action, svc)
		if err != nil {
			results = append(results, svc+": błąd — "+out)
		} else {
			results = append(results, svc+": "+req.Action+" OK")
		}
	}

	jsonOK(w, map[string]any{"status": "ok", "results": results})
}
