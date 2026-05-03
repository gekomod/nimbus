package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"nimbus/internal/sys"
	"os"
	"strings"
)

func (s *Server) handleNetworkOverview(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"hostname": sys.Hostname(), "interfaces": sys.NetInterfaces()})
}

func (s *Server) handleNetworkInterfaces(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"interfaces": sys.NetInterfaces()})
}

func (s *Server) handleNetworkInterfaceDetail(w http.ResponseWriter, r *http.Request) {
	// /network/interfaces/details/:interface  or  /network/interfaces/details/:interface/speedtest
	suffix := pathSuffix(r, "/network/interfaces/details/")
	parts  := strings.SplitN(suffix, "/", 2)
	iface  := parts[0]
	sub    := ""
	if len(parts) > 1 { sub = parts[1] }

	if sub == "speedtest" {
		if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
		out, err := runCmd("speedtest", "--interface="+iface, "--format=json")
		if err != nil { jsonErr(w, "speedtest failed: "+err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, json.RawMessage(safeJSON(out)))
		return
	}

	switch r.Method {
	case http.MethodGet:
		addr, _ := runCmd("ip", "addr", "show", "dev", iface)
		stats, _ := runCmd("ip", "-s", "link", "show", "dev", iface)
		jsonOK(w, map[string]any{"interface": iface, "addr": addr, "stats": stats})
	case http.MethodPost:
		var req struct { Action, IP, Prefix string }
		json.NewDecoder(r.Body).Decode(&req)
		switch req.Action {
		case "up":   runCmd("ip", "link", "set", iface, "up")
		case "down": runCmd("ip", "link", "set", iface, "down")
		case "set-ip":
			runCmd("ip", "addr", "flush", "dev", iface)
			if req.Prefix != "" { runCmd("ip", "addr", "add", req.IP+"/"+req.Prefix, "dev", iface) } else { runCmd("ip", "addr", "add", req.IP, "dev", iface) }
		}
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNetworkInterfaceAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Name, Type string }
	json.NewDecoder(r.Body).Decode(&req)
	if req.Type == "" { req.Type = "dummy" }
	if _, err := runCmd("ip", "link", "add", req.Name, "type", req.Type); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleNetworkInterfaceRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	iface := pathSuffix(r, "/network/interfaces/remove/")
	runCmd("ip", "link", "delete", iface)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleFirewallStatus(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("ufw", "status", "verbose")
	jsonOK(w, map[string]any{"active": strings.Contains(out, "Status: active"), "output": out})
}

func (s *Server) handleFirewallStatusAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	action := pathSuffix(r, "/network/firewall/status/")
	switch action {
	case "enable":  runCmd("ufw", "--force", "enable")
	case "disable": runCmd("ufw", "disable")
	case "reload":  runCmd("ufw", "reload")
	default: jsonErr(w, "unknown action: "+action, http.StatusBadRequest); return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleFirewallRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("ufw", "status", "numbered")
		var rules []string
		for _, l := range strings.Split(out, "\n") { if strings.HasPrefix(l, "[") { rules = append(rules, strings.TrimSpace(l)) } }
		jsonOK(w, map[string]any{"rules": rules, "raw": out})
	case http.MethodPost:
		var req struct { Action, Port, Proto, From, Comment string }
		json.NewDecoder(r.Body).Decode(&req)
		args := []string{req.Action}
		if req.From != "" { args = append(args, "from", req.From) }
		if req.Port != "" { args = append(args, "to", "any", "port", req.Port) }
		if req.Proto != "" { args = append(args, "proto", req.Proto) }
		if req.Comment != "" { args = append(args, "comment", req.Comment) }
		if _, err := runCmd("ufw", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleFirewallRuleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	id := pathSuffix(r, "/network/firewall/rules/")
	runCmd("ufw", "--force", "delete", id)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleFirewallStats(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("ufw", "status", "verbose")
	jsonOK(w, map[string]string{"raw": out})
}

func (s *Server) handleIPTablesRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, _ := runCmd("iptables", "-L", "-n", "-v", "--line-numbers")
		jsonOK(w, map[string]string{"raw": out})
	case http.MethodPost:
		var req struct { Chain, Rule, Action string }
		json.NewDecoder(r.Body).Decode(&req)
		act := req.Action; if act == "" { act = "-A" }
		args := append([]string{act, req.Chain}, strings.Fields(req.Rule)...)
		if _, err := runCmd("iptables", args...); err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleIPTablesRuleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	suffix := pathSuffix(r, "/network/iptables/rules/")
	parts := strings.SplitN(suffix, "/", 2)
	if len(parts) < 2 { jsonErr(w, "chain and number required", http.StatusBadRequest); return }
	runCmd("iptables", "-D", parts[0], parts[1])
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleNetDockerDebugRules(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("iptables", "-L", "DOCKER-USER", "-n", "-v")
	jsonOK(w, map[string]string{"raw": out})
}

func (s *Server) handleNetDockerStatus(w http.ResponseWriter, r *http.Request) {
	after, _ := runCmd("cat", "/etc/ufw/after.rules")
	jsonOK(w, map[string]any{"docker_installed": isInstalled("docker"), "ufw_docker_installed": strings.Contains(after, "DOCKER")})
}

func (s *Server) handleNetDockerInstallUFW(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	jsonOK(w, map[string]string{"status": "ok", "message": "UFW-Docker rule applied"})
}

func (s *Server) handleNetDockerContainers(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("docker", "ps", "--format", "{{json .}}")
	var conts []json.RawMessage
	for _, l := range strings.Split(out, "\n") { if l = strings.TrimSpace(l); l != "" { conts = append(conts, json.RawMessage(l)) } }
	jsonOK(w, map[string]any{"containers": conts})
}

func (s *Server) handleNetDockerUFWRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct { Action, Port, IP string }
	json.NewDecoder(r.Body).Decode(&req)
	args := []string{req.Action}
	if req.IP != "" { args = append(args, "from", req.IP) }
	if req.Port != "" { args = append(args, "to", "any", "port", req.Port) }
	runCmd("ufw", args...)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleNetDockerUFWRules(w http.ResponseWriter, r *http.Request) {
	out, _ := runCmd("ufw", "status", "numbered")
	var rules []string
	for _, l := range strings.Split(out, "\n") { if strings.Contains(strings.ToLower(l), "docker") { rules = append(rules, l) } }
	jsonOK(w, map[string]any{"rules": rules})
}

func (s *Server) handleSpeedtestStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"installed": isInstalled("speedtest")})
}

func (s *Server) handleSpeedtestInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	go runCmd("bash", "-c", "curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash && apt-get install -y speedtest")
	jsonOK(w, map[string]string{"status": "ok", "message": "Installing speedtest..."})
}

func (s *Server) handleSpeedtestServers(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("speedtest", "--servers", "--format=json")
	if err != nil { jsonOK(w, map[string]any{"servers": []any{}}); return }
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

func (s *Server) handleSpeedtestQuick(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("speedtest", "--format=json")
	if err != nil { jsonErr(w, "speedtest failed: "+err.Error(), http.StatusInternalServerError); return }
	jsonOK(w, json.RawMessage(safeJSON(out)))
}

// ── DHCP (dnsmasq) ────────────────────────────────────────────────────────────

func (s *Server) handleDHCPLeases(w http.ResponseWriter, r *http.Request) {
	// Dzierżawy z /var/lib/misc/dnsmasq.leases
	data, err := os.ReadFile("/var/lib/misc/dnsmasq.leases")
	if err != nil {
		// Spróbuj alternatywnej lokalizacji
		data, err = os.ReadFile("/var/lib/dnsmasq/dnsmasq.leases")
	}

	var leases []map[string]any
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 4 { continue }
			leases = append(leases, map[string]any{
				"expires":  fields[0],
				"mac":      fields[1],
				"ip":       fields[2],
				"hostname": fields[3],
				"static":   false,
			})
		}
	}

	// Sprawdź czy dnsmasq jest zainstalowany
	_, errDns := runCmd("which", "dnsmasq")
	installed := errDns == nil

	if leases == nil { leases = []map[string]any{} }
	jsonOK(w, map[string]any{
		"leases":    leases,
		"installed": installed,
		"running":   serviceActive("dnsmasq"),
	})
}

func (s *Server) handleDHCPConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		conf, _ := os.ReadFile("/etc/dnsmasq.conf")
		jsonOK(w, map[string]any{"config": string(conf)})
	case http.MethodPost:
		var req struct {
			RangeStart string `json:"range_start"`
			RangeEnd   string `json:"range_end"`
			LeaseTime  string `json:"lease_time"`
			Gateway    string `json:"gateway"`
			DNS        string `json:"dns"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.RangeStart == "" || req.RangeEnd == "" {
			jsonErr(w, "range_start i range_end są wymagane", http.StatusBadRequest); return
		}
		entry := fmt.Sprintf("dhcp-range=%s,%s,%s\n", req.RangeStart, req.RangeEnd, req.LeaseTime)
		if req.Gateway != "" { entry += fmt.Sprintf("dhcp-option=3,%s\n", req.Gateway) }
		if req.DNS != ""     { entry += fmt.Sprintf("dhcp-option=6,%s\n", req.DNS) }

		// Dopisz do dnsmasq.conf lub zastąp blok DHCP
		runCmd("bash", "-c", fmt.Sprintf(`grep -v '^dhcp-' /etc/dnsmasq.conf > /tmp/dnsmasq.tmp 2>/dev/null; printf '%s' >> /tmp/dnsmasq.tmp; mv /tmp/dnsmasq.tmp /etc/dnsmasq.conf`, entry))
		runCmd("systemctl", "restart", "dnsmasq")
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDHCPInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	out, err := runCmd("apt-get", "install", "-y", "dnsmasq")
	if err != nil { jsonErr(w, "instalacja nieudana: "+out, http.StatusInternalServerError); return }
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── DNS ───────────────────────────────────────────────────────────────────────

func (s *Server) handleDNSStatus(w http.ResponseWriter, r *http.Request) {
	_, errDns := runCmd("which", "dnsmasq")
	dnsmasqOk := errDns == nil

	// Odczytaj aktualny resolv.conf
	resolvData, _ := os.ReadFile("/etc/resolv.conf")
	var upstream []string
	for _, line := range strings.Split(string(resolvData), "\n") {
		if strings.HasPrefix(line, "nameserver ") {
			upstream = append(upstream, strings.TrimPrefix(line, "nameserver "))
		}
	}

	// Odczytaj /etc/hosts
	hostsData, _ := os.ReadFile("/etc/hosts")
	var hosts []map[string]string
	for _, line := range strings.Split(string(hostsData), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") { continue }
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			hosts = append(hosts, map[string]string{
				"ip": fields[0], "name": strings.Join(fields[1:], " "),
			})
		}
	}

	if upstream == nil { upstream = []string{} }
	if hosts == nil    { hosts = []map[string]string{} }

	jsonOK(w, map[string]any{
		"dnsmasq_installed": dnsmasqOk,
		"dnsmasq_running":   serviceActive("dnsmasq"),
		"upstream":          upstream,
		"hosts":             hosts,
		"resolv_conf":       string(resolvData),
	})
}

func (s *Server) handleDNSHosts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			IP   string `json:"ip"`
			Name string `json:"name"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.IP == "" || req.Name == "" {
			jsonErr(w, "ip i name są wymagane", http.StatusBadRequest); return
		}
		entry := fmt.Sprintf("\n%s\t%s", req.IP, req.Name)
		f, err := os.OpenFile("/etc/hosts", os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		f.WriteString(entry)
		f.Close()
		jsonOK(w, map[string]string{"status": "ok"})
	case http.MethodDelete:
		var req struct{ Name string `json:"name"` }
		json.NewDecoder(r.Body).Decode(&req)
		runCmd("bash", "-c", fmt.Sprintf(`grep -v '\s%s$' /etc/hosts > /tmp/hosts.tmp && mv /tmp/hosts.tmp /etc/hosts`, req.Name))
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDNSUpstream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Servers []string `json:"servers"` }
	json.NewDecoder(r.Body).Decode(&req)
	if len(req.Servers) == 0 { jsonErr(w, "servers wymagane", http.StatusBadRequest); return }

	// Zapisz do /etc/resolv.conf
	content := "# Wygenerowane przez Nimbus\n"
	for _, srv := range req.Servers {
		if strings.TrimSpace(srv) != "" {
			content += fmt.Sprintf("nameserver %s\n", strings.TrimSpace(srv))
		}
	}
	if err := os.WriteFile("/etc/resolv.conf", []byte(content), 0644); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError); return
	}

	// Jeśli dnsmasq działa — też zaktualizuj
	if serviceActive("dnsmasq") {
		runCmd("systemctl", "restart", "dnsmasq")
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── Fail2Ban ──────────────────────────────────────────────────────────────────

func (s *Server) handleFail2BanStatus(w http.ResponseWriter, r *http.Request) {
	// Sprawdź czy fail2ban jest zainstalowany
	_, err := runCmd("which", "fail2ban-client")
	if err != nil {
		jsonOK(w, map[string]any{"installed": false, "jails": []any{}})
		return
	}

	running := serviceActive("fail2ban")

	if !running {
		jsonOK(w, map[string]any{"installed": true, "running": false, "jails": []any{}})
		return
	}

	// Pobierz listę jails
	out, err := runCmd("fail2ban-client", "status")
	if err != nil {
		jsonOK(w, map[string]any{"installed": true, "running": true, "jails": []any{}, "error": err.Error()})
		return
	}

	// Parsuj: "Jail list: sshd, nginx-http-auth"
	var jailNames []string
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "Jail list:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				for _, j := range strings.Split(parts[1], ",") {
					j = strings.TrimSpace(j)
					if j != "" {
						jailNames = append(jailNames, j)
					}
				}
			}
		}
	}

	// Pobierz szczegóły każdego jail
	var jails []map[string]any
	for _, name := range jailNames {
		jailOut, err := runCmd("fail2ban-client", "status", name)
		banned  := 0
		failed  := 0
		active  := err == nil

		if err == nil {
			for _, line := range strings.Split(jailOut, "\n") {
				line = strings.TrimSpace(line)
				if strings.Contains(line, "Currently banned:") {
					fmt.Sscanf(strings.SplitN(line, ":", 2)[1], "%d", &banned)
				}
				if strings.Contains(line, "Total failed:") {
					fmt.Sscanf(strings.SplitN(line, ":", 2)[1], "%d", &failed)
				}
			}
		}

		jails = append(jails, map[string]any{
			"name":   name,
			"active": active,
			"banned": banned,
			"failed": failed,
		})
	}

	if jails == nil {
		jails = []map[string]any{}
	}

	jsonOK(w, map[string]any{
		"installed": true,
		"running":   running,
		"jails":     jails,
	})
}
