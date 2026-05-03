package api

// alerts.go — silnik alertów który sprawdza reguły co 30s
// i wysyła powiadomienia przez skonfigurowane kanały

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"nimbus/internal/sys"
)

// ── Alert engine ──────────────────────────────────────────────────────────────

var alertEngine = &alertsEngine{}

type alertsEngine struct {
	once    sync.Once
	// cooldown: reguła → czas ostatniego wysłania
	cooldown   map[string]time.Time
	cooldownMu sync.Mutex
}

// StartAlertEngine uruchamia pętlę sprawdzania alertów — wywoływane raz przy starcie.
func StartAlertEngine() {
	alertEngine.once.Do(func() {
		alertEngine.cooldown = map[string]time.Time{}
		go alertEngine.run()
	})
}

func (e *alertsEngine) run() {
	// Poczekaj na rozruch systemu
	time.Sleep(30 * time.Second)
	log.Println("[alerts] Engine uruchomiony")

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		e.check()
	}
}

func (e *alertsEngine) check() {
	cfg := notifGetConfig()
	if len(cfg.Rules) == 0 { return }

	// Zbierz aktualne metryki (z cache — zero blokowania)
	cpuPct := sys.CPUPercent()
	mem    := sys.Memory()
	mounts := cachedMounts()

	memPct := 0.0
	if mem.TotalKB > 0 {
		memPct = float64(mem.TotalKB-mem.AvailableKB) / float64(mem.TotalKB) * 100
	}

	for _, rule := range cfg.Rules {
		if !rule.Enabled { continue }

		// Cooldown — nie wysyłaj częściej niż raz na 30 minut dla tej samej reguły
		e.cooldownMu.Lock()
		lastSent, hasCooldown := e.cooldown[rule.ID]
		e.cooldownMu.Unlock()
		if hasCooldown && time.Since(lastSent) < 30*time.Minute {
			continue
		}

		triggered, msg := e.evaluate(rule.Condition, cpuPct, memPct, mounts)
		if !triggered { continue }

		// Wyślij przez wszystkie skonfigurowane kanały reguły
		sev := rule.Severity
		if sev == "" { sev = "warn" }

		title := fmt.Sprintf("🚨 Nimbus Alert: %s", rule.Name)
		sent := false
		for _, chID := range rule.Channels {
			if notifSendToChannel(chID, title, msg, sev) {
				sent = true
			}
		}
		// Jeśli brak kanałów — wyślij do wszystkich aktywnych
		if len(rule.Channels) == 0 {
			for _, ch := range cfg.Channels {
				if ch.Enabled {
					notifSendToChannel(ch.ID, title, msg, sev)
					sent = true
				}
			}
		}

		if sent {
			e.cooldownMu.Lock()
			e.cooldown[rule.ID] = time.Now()
			e.cooldownMu.Unlock()

			// Zapisz do historii
			notifAddHistory(rule.Name, sev, msg, "alert-engine", true)
			log.Printf("[alerts] %s: %s", rule.Name, msg)
		}
	}
}

// evaluate sprawdza warunek reguły i zwraca czy alert ma być wysłany + wiadomość.
// Składnia warunków:
//   cpu > 90
//   mem > 85
//   disk:/ < 10         (wolne miejsce % na punkcie montowania)
//   disk:/srv < 5
//   service:samba = down
//   service:ssh = down
//   load > 8.0
func (e *alertsEngine) evaluate(condition string, cpuPct, memPct float64, mounts []sys.MountPoint) (bool, string) {
	condition = strings.TrimSpace(condition)
	if condition == "" { return false, "" }

	parts := strings.Fields(condition)
	if len(parts) < 3 { return false, "" }

	metric := parts[0]
	op     := parts[1]
	valStr := parts[2]

	// Metryki liczbowe
	switch metric {
	case "cpu":
		threshold, err := strconv.ParseFloat(valStr, 64)
		if err != nil { return false, "" }
		if compareFloat(cpuPct, op, threshold) {
			return true, fmt.Sprintf("CPU: %.1f%% (próg: %s %s%%)", cpuPct, op, valStr)
		}

	case "mem", "ram":
		threshold, err := strconv.ParseFloat(valStr, 64)
		if err != nil { return false, "" }
		if compareFloat(memPct, op, threshold) {
			return true, fmt.Sprintf("RAM: %.1f%% (próg: %s %s%%)", memPct, op, valStr)
		}

	case "load":
		load := sys.LoadAvg()
		threshold, err := strconv.ParseFloat(valStr, 64)
		if err != nil { return false, "" }
		if compareFloat(load[0], op, threshold) {
			return true, fmt.Sprintf("Load average: %.2f (próg: %s %s)", load[0], op, valStr)
		}
	}

	// Dysk: disk:/ścieżka
	if strings.HasPrefix(metric, "disk:") {
		mountPath := strings.TrimPrefix(metric, "disk:")
		threshold, err := strconv.ParseFloat(valStr, 64)
		if err != nil { return false, "" }

		for _, m := range mounts {
			if m.MountAt != mountPath { continue }
			if m.TotalB == 0 { continue }

			freePct := float64(m.FreeB) / float64(m.TotalB) * 100
			freeGB   := float64(m.FreeB) / 1024 / 1024 / 1024

			if op == "<" && freePct < threshold {
				return true, fmt.Sprintf("Dysk %s: tylko %.1f%% wolne (%.1f GB) — próg: < %s%%",
					mountPath, freePct, freeGB, valStr)
			}
			if op == ">" && freePct > threshold {
				return true, fmt.Sprintf("Dysk %s: %.1f%% wolne — próg: > %s%%",
					mountPath, freePct, valStr)
			}
		}
	}

	// Usługa: service:nazwa
	if strings.HasPrefix(metric, "service:") {
		svcName := strings.TrimPrefix(metric, "service:")
		active   := serviceActive(svcName)
		if op == "=" || op == "==" {
			wantDown := valStr == "down" || valStr == "stopped" || valStr == "false"
			wantUp   := valStr == "up"   || valStr == "running"  || valStr == "true"
			if wantDown && !active {
				return true, fmt.Sprintf("Usługa %s jest ZATRZYMANA", svcName)
			}
			if wantUp && active {
				return true, fmt.Sprintf("Usługa %s jest URUCHOMIONA", svcName)
			}
		}
	}

	return false, ""
}

func compareFloat(val float64, op string, threshold float64) bool {
	switch op {
	case ">":  return val > threshold
	case ">=": return val >= threshold
	case "<":  return val < threshold
	case "<=": return val <= threshold
	case "=", "==": return val == threshold
	}
	return false
}

// ── Domyślne reguły ───────────────────────────────────────────────────────────

// DefaultAlertRules zwraca sensowne domyślne reguły dla nowej instalacji.
func DefaultAlertRules() []NotifRule {
	return []NotifRule{
		{
			ID: "cpu-critical", Name: "CPU krytyczne",
			Condition: "cpu > 95", Severity: "crit",
			Enabled: true,
		},
		{
			ID: "mem-high", Name: "RAM wysoki",
			Condition: "mem > 90", Severity: "warn",
			Enabled: true,
		},
		{
			ID: "disk-root-low", Name: "Dysk / — mało miejsca",
			Condition: "disk:/ < 10", Severity: "warn",
			Enabled: true,
		},
		{
			ID: "disk-root-critical", Name: "Dysk / — krytycznie mało",
			Condition: "disk:/ < 3", Severity: "crit",
			Enabled: true,
		},
		{
			ID: "load-high", Name: "Load average wysoki",
			Condition: "load > 10", Severity: "warn",
			Enabled: false,
		},
		{
			ID: "samba-down", Name: "Samba zatrzymana",
			Condition: "service:smbd = down", Severity: "warn",
			Enabled: false,
		},
		{
			ID: "ssh-down", Name: "SSH zatrzymany",
			Condition: "service:ssh = down", Severity: "crit",
			Enabled: false,
		},
	}
}
