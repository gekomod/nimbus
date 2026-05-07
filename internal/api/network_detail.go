package api

// network_detail.go — szczegółowy monitoring sieci
// Bandwidth per interfejs, ruch kontenerów, reguły firewall

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Bandwidth ringbuffer ──────────────────────────────────────────────────────

type ifaceSample struct {
	RxBytes uint64
	TxBytes uint64
	T       time.Time
}

type IfaceBandwidth struct {
	Name string    `json:"name"`
	Rx   []float64 `json:"rx"` // MB/s (ostatnie 60 próbek)
	Tx   []float64 `json:"tx"`
}

var (
	bwMu      sync.RWMutex
	bwHistory = map[string][]IfaceSample{} // name → próbki
	bwCurrent = map[string]IfaceBandwidth{}
	bwOnce    sync.Once
)

type IfaceSample struct {
	RxBytes uint64
	TxBytes uint64
	T       time.Time
}

func startBandwidthPoller() {
	bwOnce.Do(func() {
		go func() {
			for {
				updateBandwidth()
				time.Sleep(3 * time.Second)
			}
		}()
	})
}

func readIfaceStats() map[string][2]uint64 {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil { return nil }
	result := map[string][2]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, ":") { continue }
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		if name == "lo" { continue }
		fields := strings.Fields(parts[1])
		if len(fields) < 9 { continue }
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		result[name] = [2]uint64{rx, tx}
	}
	return result
}

func updateBandwidth() {
	stats := readIfaceStats()
	if stats == nil { return }

	now := time.Now()
	bwMu.Lock()
	defer bwMu.Unlock()

	for name, cur := range stats {
		// Pomiń interfejsy wirtualne Docker, veth, bridges, tunele
		if strings.HasPrefix(name, "veth")   ||
		   strings.HasPrefix(name, "br-")    ||
		   strings.HasPrefix(name, "docker") ||
		   strings.HasPrefix(name, "virbr")  ||
		   strings.HasPrefix(name, "tun")    ||
		   strings.HasPrefix(name, "tap")    ||
		   name == "lo" {
			continue
		}
		prev := bwHistory[name]
		newSample := IfaceSample{RxBytes: cur[0], TxBytes: cur[1], T: now}

		if len(prev) > 0 {
			last := prev[len(prev)-1]
			dt := now.Sub(last.T).Seconds()
			if dt > 0 {
				rxMBs := float64(cur[0]-last.RxBytes) / dt / 1024 / 1024
				txMBs := float64(cur[1]-last.TxBytes) / dt / 1024 / 1024
				if rxMBs < 0 { rxMBs = 0 }
				if txMBs < 0 { txMBs = 0 }

				bw := bwCurrent[name]
				bw.Name = name
				if len(bw.Rx) >= 60 { bw.Rx = bw.Rx[1:] }
				if len(bw.Tx) >= 60 { bw.Tx = bw.Tx[1:] }
				bw.Rx = append(bw.Rx, roundF(rxMBs, 2))
				bw.Tx = append(bw.Tx, roundF(txMBs, 2))
				bwCurrent[name] = bw
			}
		}

		// Zachowaj tylko ostatni sample per iface
		bwHistory[name] = []IfaceSample{newSample}
	}
}

func roundF(f float64, prec int) float64 {
	p := 1.0
	for i := 0; i < prec; i++ { p *= 10 }
	return float64(int(f*p+0.5)) / p
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleNetworkBandwidth(w http.ResponseWriter, r *http.Request) {
	startBandwidthPoller()
	bwMu.RLock()
	result := make([]IfaceBandwidth, 0, len(bwCurrent))
	for _, bw := range bwCurrent {
		result = append(result, bw)
	}
	bwMu.RUnlock()
	jsonOK(w, map[string]any{"interfaces": result})
}

func (s *Server) handleContainerNetwork(w http.ResponseWriter, r *http.Request) {
	// docker stats --no-stream z polami sieci
	out, err := runCmd("docker", "stats", "--no-stream", "--format",
		`{"name":"{{.Name}}","net_io":"{{.NetIO}}"}`)
	if err != nil {
		jsonOK(w, map[string]any{"containers": []any{}})
		return
	}

	type ContNet struct {
		Name  string  `json:"name"`
		RxMBs float64 `json:"rx"`
		TxMBs float64 `json:"tx"`
		NetIO string  `json:"net_io"`
	}

	var result []ContNet
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" { continue }
		var raw struct {
			Name  string `json:"name"`
			NetIO string `json:"net_io"`
		}
		if err := json.Unmarshal([]byte(line), &raw); err != nil { continue }

		// Parsuj "X.XX MB / Y.YY MB"
		parts := strings.Split(raw.NetIO, "/")
		rx, tx := parseNetIO(strings.TrimSpace(parts[0])), 0.0
		if len(parts) >= 2 { tx = parseNetIO(strings.TrimSpace(parts[1])) }

		result = append(result, ContNet{
			Name: raw.Name, RxMBs: rx, TxMBs: tx, NetIO: raw.NetIO,
		})
	}

	jsonOK(w, map[string]any{"containers": result})
}

func parseNetIO(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "0B" { return 0 }
	units := map[string]float64{
		"B":   1.0 / 1024 / 1024,
		"KB":  1.0 / 1024,
		"kB":  1.0 / 1024,
		"MB":  1.0,
		"GB":  1024.0,
		"TB":  1024.0 * 1024,
	}
	for suffix, mult := range units {
		if strings.HasSuffix(s, suffix) {
			val, err := strconv.ParseFloat(strings.TrimSuffix(s, suffix), 64)
			if err == nil { return roundF(val*mult, 3) }
		}
	}
	return 0
}

func (s *Server) handleFirewallRulesDirect(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Pobierz reguły z iptables lub nftables
		rules := getFirewallRules()
		jsonOK(w, map[string]any{"rules": rules})

	case http.MethodPost:
		var req struct {
			Chain   string `json:"chain"`
			Action  string `json:"action"`
			Proto   string `json:"proto"`
			Src     string `json:"src"`
			Dport   string `json:"dport"`
			Comment string `json:"comment"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		// Validacja
		allowed := map[string]bool{"INPUT":true,"OUTPUT":true,"FORWARD":true}
		actions  := map[string]bool{"ACCEPT":true,"DROP":true,"REJECT":true}
		if !allowed[req.Chain] || !actions[req.Action] {
			jsonErr(w, "invalid chain or action", http.StatusBadRequest)
			return
		}

		cmd := buildIptablesCmd(req.Chain, req.Action, req.Proto, req.Src, req.Dport, req.Comment)
		out, err := runCmd("bash", "-c", cmd)
		if err != nil {
			jsonErr(w, "iptables error: "+out, http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]any{"status": "ok", "output": out})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}



type FirewallRule struct {
	ID      int    `json:"id"`
	Chain   string `json:"chain"`
	Action  string `json:"action"`
	Proto   string `json:"proto"`
	Src     string `json:"src"`
	Dst     string `json:"dst"`
	Dport   string `json:"dport"`
	Comment string `json:"comment"`
	Hits    int64  `json:"hits"`
	Enabled bool   `json:"enabled"`
}

func getFirewallRules() []FirewallRule {
	// Spróbuj iptables -L z numerowaniem i zliczaniem pakietów
	out, err := runCmd("iptables", "-L", "-n", "-v", "--line-numbers")
	if err != nil {
		return []FirewallRule{}
	}

	var rules []FirewallRule
	var currentChain string
	id := 1

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Chain ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 { currentChain = parts[1] }
			continue
		}
		// Pomijaj nagłówki
		if strings.HasPrefix(line, "num") || strings.HasPrefix(line, "pkts") { continue }
		if line == "" { continue }

		fields := strings.Fields(line)
		if len(fields) < 9 { continue }

		ruleNo, err := strconv.Atoi(fields[0])
		if err != nil { continue }
		_ = ruleNo

		pkts, _ := strconv.ParseInt(fields[1], 10, 64)
		action := fields[3]
		proto  := fields[4]
		if proto == "all" { proto = "any" }
		src  := fields[7]
		dst  := fields[8]
		if src  == "anywhere" { src  = "0.0.0.0/0" }
		if dst  == "anywhere" { dst  = "0.0.0.0/0" }

		// Znajdź dport w pozostałych polach
		dport := "any"
		for i := 9; i < len(fields); i++ {
			if strings.Contains(fields[i], "dpt:") {
				dport = strings.TrimPrefix(fields[i], "dpt:")
			} else if strings.Contains(fields[i], "dpts:") {
				dport = strings.TrimPrefix(fields[i], "dpts:")
			}
		}

		// Komentarz
		comment := ""
		if strings.Contains(out, "/* ") {
			// Wyodrębnij komentarz z reguły
		}

		rules = append(rules, FirewallRule{
			ID:      id,
			Chain:   currentChain,
			Action:  action,
			Proto:   proto,
			Src:     src,
			Dst:     dst,
			Dport:   dport,
			Comment: comment,
			Hits:    pkts,
			Enabled: true,
		})
		id++
	}

	return rules
}

func buildIptablesCmd(chain, action, proto, src, dport, comment string) string {
	cmd := fmt.Sprintf("iptables -A %s", chain)
	if proto != "" && proto != "any" { cmd += fmt.Sprintf(" -p %s", proto) }
	if src != "" && src != "0.0.0.0/0" { cmd += fmt.Sprintf(" -s %s", src) }
	if dport != "" && dport != "any" { cmd += fmt.Sprintf(" --dport %s", dport) }
	if comment != "" { cmd += fmt.Sprintf(` -m comment --comment "%s"`, comment) }
	cmd += fmt.Sprintf(" -j %s", action)
	return cmd
}
