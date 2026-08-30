package api

// ipmi.go — IPMI / BMC: czujniki (sensor list), zasilanie, obudowa, SEL (System Event Log)
// Źródło danych: ipmitool (sensor list, chassis status, mc info, lan print, sel elist, dcmi power reading, sdr type)
// Wymaga zainstalowanego pakietu ipmitool oraz obecności kontrolera BMC (/dev/ipmi0).
// Na sprzęcie bez BMC (typowe desktopy/NUC) sekcja zwraca installed=true, bmc_present=false.

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// ── Struktury ─────────────────────────────────────────────────────────────────

type IPMISensor struct {
	Name string  `json:"name"`
	Val  float64 `json:"val"`
	Unit string  `json:"unit"`
	Warn float64 `json:"warn"`
	Crit float64 `json:"crit"`
	Max  float64 `json:"max"`
}

type IPMIPSU struct {
	Status string `json:"status"`
	In     string `json:"in"`
	Out    string `json:"out"`
}

type IPMIPower struct {
	State  string  `json:"state"`
	TotalW int     `json:"totalW"`
	PSU1   IPMIPSU `json:"psu1"`
	PSU2   IPMIPSU `json:"psu2"`
}

type IPMIBMC struct {
	Model  string `json:"model"`
	IP     string `json:"ip"`
	MAC    string `json:"mac"`
	FW     string `json:"fw"`
	Uptime string `json:"uptime"`
}

type IPMIChassis struct {
	Intrusion    string `json:"intrusion"`
	LastOpen     string `json:"lastOpen"`
	FrontPanel   string `json:"frontPanel"`
	PostCode     string `json:"postCode"`
	PowerCycles  string `json:"powerCycles"`
}

type IPMIPowerMeta struct {
	Volts          string  `json:"volts"`
	Freq           string  `json:"freq"`
	PF             float64 `json:"pf"`
	Redundancy     string  `json:"redundancy"`
	TotalCapacityW int     `json:"totalCapacityW"`
}

type IPMIEvent struct {
	T   string `json:"t"`
	Sev string `json:"sev"`
	Msg string `json:"msg"`
	Src string `json:"src"`
}

// ── Wykrywanie ipmitool / BMC ──────────────────────────────────────────────────

// ipmitoolAvailable() w temps.go sprawdza obecność przez `which ipmitool` —
// wymaga to obecności binarki `which` w PATH usługi systemd. Tutaj używamy
// isInstalled() (exec.LookPath, bez zewnętrznego procesu) jako dodatkowego,
// bardziej niezawodnego sprawdzenia — jeśli oba się rozjadą, ufamy temu.
func ipmiBinaryPresent() bool {
	return isInstalled("ipmitool") || ipmitoolAvailable()
}

// ipmiRun uruchamia ipmitool z krótkim timeoutem logicznym (przez cmdSem);
// zwraca pusty string i błąd gdy BMC nie odpowiada.
func ipmiRun(args ...string) (string, error) {
	return runCmd("ipmitool", args...)
}

func ipmiBMCPresent() bool {
	_, err := ipmiRun("mc", "info")
	return err == nil
}

// ── Parsowanie `ipmitool sensor list` ─────────────────────────────────────────
// Format kolumn: Name | Value | Unit | Status | lnr | lcr | lnc | unc | ucr | unr

func parseIPMISensorList(out string) []IPMISensor {
	var sensors []IPMISensor

	// ipmitool formatuje liczby zgodnie z locale procesu (LC_NUMERIC) — na
	// systemach z polskim locale wypisuje przecinek zamiast kropki jako
	// separator dziesiętny (np. "47,040" zamiast "47.040"). Bez normalizacji
	// strconv.ParseFloat odrzuca prawie każdą wartość, przez co większość
	// czujników znika z listy (patrz identyczny problem opisany w temps.go).
	parseF := func(s string) (float64, bool) {
		s = strings.TrimSpace(s)
		if s == "" || s == "na" {
			return 0, false
		}
		v, err := strconv.ParseFloat(strings.Replace(s, ",", ".", 1), 64)
		if err != nil {
			return 0, false
		}
		return v, true
	}
	nth := func(f []string, i int) string {
		if i >= len(f) {
			return ""
		}
		return f[i]
	}
	// Wiele BMC (HP iLO, część kontrolerów ASRock Rack/Supermicro) zostawia
	// niesparametryzowane progi jako 0 albo jako wartość-placeholder w
	// okolicy 99 — traktujemy je jako "brak progu", żeby nie generować
	// fałszywych alarmów z niewłaściwie odczytanych "progów" równych 0.
	isPlaceholder := func(v float64, ok bool) bool {
		return !ok || v == 0 || (v > 98.9 && v < 99.1)
	}

	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "|") {
			continue
		}
		f := strings.Split(line, "|")
		if len(f) < 4 {
			continue
		}
		for i := range f {
			f[i] = strings.TrimSpace(f[i])
		}
		name := f[0]
		unitRaw := f[2]
		if name == "" {
			continue
		}
		val, valOK := parseF(f[1])
		if !valOK {
			continue
		}

		var unit string
		switch {
		case strings.Contains(unitRaw, "degrees"):
			unit = "°C"
		case strings.Contains(unitRaw, "RPM"):
			unit = "RPM"
		case strings.Contains(unitRaw, "Volts"):
			unit = "V"
		case strings.Contains(unitRaw, "Watts"):
			unit = "W"
		case strings.Contains(unitRaw, "Amps"):
			unit = "A"
		default:
			continue // pomiń sensory dyskretne (np. "discrete") — nieprzydatne do paska
		}

		// Pomiń najwyraźniej nieobsadzone/nieaktywne sloty (dokładnie 0.0) —
		// dotyczy temperatur/napięć/mocy. Dla RPM wartość 0 jest sensownym
		// odczytem (zatrzymany wentylator) i jest obsługiwana osobno przez
		// frontend (sensorStatus), więc jej tu nie odrzucamy.
		if unit != "RPM" && val == 0 {
			continue
		}

		lnc, lncOK := parseF(nth(f, 6)) // lower non-critical — dolny próg (wentylatory)
		ucr, ucrOK := parseF(nth(f, 8)) // upper critical     — realnie to "ostrzeżenie" (Caution)
		unr, unrOK := parseF(nth(f, 9)) // upper non-recoverable — realnie to próg krytyczny

		var warn, crit, max float64
		switch unit {
		case "RPM":
			// Dla wentylatorów liczy się dolny próg (spadek obrotów)
			if !isPlaceholder(lnc, lncOK) {
				warn = lnc
			} else {
				warn = val * 0.4 // brak progu od producenta — 40% aktualnych obrotów
			}
			crit = 0
			max = unr
			if isPlaceholder(unr, unrOK) {
				max = val*1.4 + 500
			}
		case "°C":
			// Zweryfikowane na realnym sprzęcie (HP iLO): kolumna "unc" bywa
			// zaniżona i nie odpowiada niczemu widocznemu w WebUI BMC —
			// realne progi "Caution"/"Critical" to kolumny ucr/unr.
			if !isPlaceholder(ucr, ucrOK) {
				warn = ucr
			} else {
				warn = 70
			}
			if !isPlaceholder(unr, unrOK) {
				crit = unr
			} else {
				crit = 85
			}
			if crit <= warn {
				crit = warn + 10
			}
			max = crit
		default: // V, W, A — margines liczony z wartości bezwzględnej (obsługuje szyny ujemne, np. -12V)
			av := val
			if av < 0 {
				av = -av
			}
			if !isPlaceholder(ucr, ucrOK) {
				warn = ucr
			} else {
				warn = val + copysignFloat(av*0.10, val)
			}
			if !isPlaceholder(unr, unrOK) {
				crit = unr
			} else {
				crit = val + copysignFloat(av*0.20, val)
			}
			max = crit
		}

		sensors = append(sensors, IPMISensor{
			Name: name, Val: round2(val), Unit: unit,
			Warn: round2(warn), Crit: round2(crit), Max: round2(max),
		})
	}
	return sensors
}

func copysignFloat(mag, sign float64) float64 {
	if sign < 0 {
		return -mag
	}
	return mag
}

// ── mc info → model + firmware ────────────────────────────────────────────────

var reMCField = regexp.MustCompile(`(?m)^([^:]+?)\s*:\s*(.*)$`)

func parseMCInfo(out string) (product, mfr, fw string) {
	for _, m := range reMCField.FindAllStringSubmatch(out, -1) {
		key := strings.TrimSpace(m[1])
		val := strings.TrimSpace(m[2])
		switch key {
		case "Product Name":
			product = val
		case "Manufacturer Name":
			mfr = val
		case "Firmware Revision":
			fw = val
		}
	}
	return
}

// ── lan print → IP + MAC ──────────────────────────────────────────────────────

func parseLanPrint(out string) (ip, mac string) {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "IP Address") && !strings.Contains(line, "Source") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				v := strings.TrimSpace(parts[1])
				if v != "" && v != "0.0.0.0" {
					ip = v
				}
			}
		}
		if strings.HasPrefix(line, "MAC Address") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				v := strings.TrimSpace(parts[1])
				if v != "" {
					mac = v
				}
			}
		}
	}
	return
}

// ── chassis status → stan zasilania, intruzja ────────────────────────────────

func parseChassisStatus(out string) map[string]string {
	res := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		res[key] = val
	}
	return res
}

// ── dcmi power reading → moc chwilowa ─────────────────────────────────────────

var reWatts = regexp.MustCompile(`(-?\d+)\s*Watts`)

func parseDCMIPower(out string) int {
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "Instantaneous power reading") {
			m := reWatts.FindStringSubmatch(line)
			if len(m) == 2 {
				v, _ := strconv.Atoi(m[1])
				return v
			}
		}
	}
	return 0
}

// ── sdr type "Power Supply" → status PSU ──────────────────────────────────────

func parsePSUStatus(out string) []string {
	var statuses []string
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "|") {
			continue
		}
		f := strings.Split(line, "|")
		if len(f) < 3 {
			continue
		}
		st := strings.ToLower(strings.TrimSpace(f[2]))
		if st == "ok" {
			statuses = append(statuses, "OK")
		} else if st != "" {
			statuses = append(statuses, strings.ToUpper(st))
		}
	}
	return statuses
}

// ── sel info → liczba wpisów (diagnostyka) ────────────────────────────────────

var reSELEntries = regexp.MustCompile(`(?m)^Entries\s*:\s*(\d+)`)

func parseSELEntryCount(out string) int {
	m := reSELEntries.FindStringSubmatch(out)
	if len(m) == 2 {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return -1 // nieznane — "sel info" nie zwróciło oczekiwanego formatu
}

// ── sel elist → zdarzenia ─────────────────────────────────────────────────────

func parseSEL(out string) []IPMIEvent {
	var events []IPMIEvent
	lines := strings.Split(out, "\n")
	// Odwróć kolejność — najnowsze na górze
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || !strings.Contains(line, "|") {
			continue
		}
		f := strings.Split(line, "|")
		for j := range f {
			f[j] = strings.TrimSpace(f[j])
		}
		// Różne wersje ipmitool/firmware BMC (elist vs list, różne locale daty)
		// dają różną liczbę kolumn — dopasuj się zamiast sztywno wymagać 5+,
		// żeby nie gubić realnych zdarzeń tylko dlatego, że format się nie zgadza.
		var date, timeStr, src, rest string
		switch {
		case len(f) >= 6:
			date, timeStr, src, rest = f[1], f[2], f[3], strings.Join(f[4:], " · ")
		case len(f) == 5:
			date, timeStr, src, rest = f[1], f[2], f[3], f[4]
		case len(f) == 4:
			date, timeStr, src, rest = "", f[1], f[2], f[3]
		default:
			continue
		}
		if strings.TrimSpace(rest) == "" {
			rest = line // ostateczny fallback — pokaż całą linię zamiast nic nie zwrócić
		}

		sev := "info"
		lower := strings.ToLower(rest)
		if strings.Contains(lower, "asserted") {
			if strings.Contains(lower, "non-critical") {
				sev = "warn"
			} else if strings.Contains(lower, "critical") || strings.Contains(lower, "non-recoverable") || strings.Contains(lower, "failure") || strings.Contains(lower, "fault") {
				sev = "crit"
			} else {
				sev = "warn"
			}
		}

		t := timeStr
		if date != "" {
			t = date + " " + timeStr
		}

		events = append(events, IPMIEvent{T: t, Sev: sev, Msg: rest, Src: src})
		if len(events) >= 40 {
			break
		}
	}
	return events
}

// ── Handler główny ─────────────────────────────────────────────────────────────

func (s *Server) handleIPMI(w http.ResponseWriter, r *http.Request) {
	if !ipmiBinaryPresent() {
		jsonOK(w, map[string]any{"installed": false})
		return
	}
	if !ipmiBMCPresent() {
		jsonOK(w, map[string]any{"installed": true, "bmc_present": false})
		return
	}

	sensorOut, _ := ipmiRun("sensor", "list")
	sensors := parseIPMISensorList(sensorOut)

	mcOut, _ := ipmiRun("mc", "info")
	product, mfr, fw := parseMCInfo(mcOut)
	model := strings.TrimSpace(mfr + " " + product)
	if model == "" {
		model = "Kontroler BMC (IPMI 2.0)"
	}

	ip, mac := "", ""
	for _, ch := range []string{"1", "8", "0"} {
		lanOut, err := ipmiRun("lan", "print", ch)
		if err == nil {
			ip2, mac2 := parseLanPrint(lanOut)
			if ip2 != "" || mac2 != "" {
				ip, mac = ip2, mac2
				break
			}
		}
	}
	if ip == "" {
		ip = "—"
	}
	if mac == "" {
		mac = "—"
	}
	if fw == "" {
		fw = "—"
	}

	chassisOut, _ := ipmiRun("chassis", "status")
	chassisMap := parseChassisStatus(chassisOut)
	powerState := "OFF"
	if strings.EqualFold(chassisMap["System Power"], "on") {
		powerState = "ON"
	}
	intrusion := "OK — obudowa zamknięta"
	if v, ok := chassisMap["Chassis Intrusion"]; ok {
		if strings.EqualFold(v, "active") || strings.Contains(strings.ToLower(v), "detect") {
			intrusion = "WYKRYTO — obudowa otwierana"
		} else {
			intrusion = "OK — obudowa zamknięta"
		}
	}
	frontPanel := "OK"
	if v, ok := chassisMap["Front-Panel Lockout"]; ok && !strings.EqualFold(v, "inactive") {
		frontPanel = v
	}

	totalW := parseDCMIPower(func() string { o, _ := ipmiRun("dcmi", "power", "reading"); return o }())

	psuOut, _ := ipmiRun("sdr", "type", "Power Supply")
	psuStatuses := parsePSUStatus(psuOut)
	psu1 := IPMIPSU{Status: "—", In: "—", Out: "—"}
	psu2 := IPMIPSU{Status: "—", In: "—", Out: "—"}
	if len(psuStatuses) > 0 {
		psu1.Status = psuStatuses[0]
	}
	if len(psuStatuses) > 1 {
		psu2.Status = psuStatuses[1]
	}
	if totalW > 0 {
		half := totalW / 2
		if psu1.Status != "—" {
			psu1.Out = strconv.Itoa(half) + "W"
		}
		if psu2.Status != "—" {
			psu2.Out = strconv.Itoa(totalW-half) + "W"
		}
	}

	selInfoOut, _ := ipmiRun("sel", "info")
	selEntries := parseSELEntryCount(selInfoOut)

	selOut, _ := ipmiRun("sel", "elist")
	if strings.TrimSpace(selOut) == "" || strings.Contains(selOut, "no entries") {
		selOut, _ = ipmiRun("sel", "list")
	}
	events := parseSEL(selOut)

	// Jeśli BMC zgłasza wpisy w SEL (sel info: Entries > 0), ale parser nie
	// wyciągnął z nich ani jednego zdarzenia — format tej konkretnej wersji
	// firmware najwyraźniej różni się od zakładanego. Zamiast pokazywać puste
	// "brak zdarzeń", zwróć surowe linie, żeby dane nie znikały bez śladu.
	var selRaw []string
	if len(events) == 0 && selEntries > 0 {
		for _, l := range strings.Split(selOut, "\n") {
			l = strings.TrimSpace(l)
			if l != "" {
				selRaw = append(selRaw, l)
			}
		}
	}

	jsonOK(w, map[string]any{
		"installed":   true,
		"bmc_present": true,
		"sensors":     sensors,
		"sel_entries": selEntries,
		"sel_raw":     selRaw,
		"power": IPMIPower{
			State: powerState, TotalW: totalW, PSU1: psu1, PSU2: psu2,
		},
		"bmc": IPMIBMC{
			Model: model, IP: ip, MAC: mac, FW: fw, Uptime: "—",
		},
		"chassis": IPMIChassis{
			Intrusion: intrusion, LastOpen: "—", FrontPanel: frontPanel,
			PostCode: "—", PowerCycles: "—",
		},
		"power_meta": IPMIPowerMeta{
			Volts: "—", Freq: "—", PF: 0, Redundancy: "—", TotalCapacityW: 0,
		},
		"events": events,
	})
}

func (s *Server) handleIPMIInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("apt-get", "install", "-y", "ipmitool", "freeipmi-tools")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}

func (s *Server) handleIPMISELClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !ipmiBinaryPresent() {
		jsonErr(w, "ipmitool nie jest zainstalowany", http.StatusServiceUnavailable)
		return
	}
	out, err := ipmiRun("sel", "clear")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}
