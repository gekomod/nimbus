package api

// mail.go — serwer poczty: Postfix + Dovecot

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type MailDomain struct {
	Name     string `json:"name"`
	Accounts int    `json:"accounts"`
	Aliases  int    `json:"aliases"`
	Active   bool   `json:"active"`
}

type MailAccount struct {
	Addr    string  `json:"addr"`
	QuotaGB float64 `json:"quota"`
	MaxGB   float64 `json:"max"`
	Last    string  `json:"last"`
	Boxes   int     `json:"boxes"`
}

type MailQueueItem struct {
	ID     string `json:"id"`
	From   string `json:"from"`
	To     string `json:"to"`
	Size   string `json:"size"`
	Time   string `json:"time"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type MailStats struct {
	Received     int     `json:"received"`
	Sent         int     `json:"sent"`
	Rejected     int     `json:"rejected"`
	Spam         int     `json:"spam"`
	Clean        int     `json:"clean"`
	Virus        int     `json:"virus"`
	Bounce       int     `json:"bounce"`
	Deferred     int     `json:"deferred"`
	DeliveryRate float64 `json:"delivery_rate"`
}

func postfixInstalled() bool { return isInstalled("postfix") || isInstalled("postqueue") }
func dovecotInstalled() bool { return isInstalled("dovecot") || isInstalled("doveadm") }

func virtualMailboxBase() string {
	for _, p := range []string{"/var/mail/vhosts", "/var/vmail", "/home/vmail", "/var/mail"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return "/var/mail"
}

// parseMailQueueJSON parsuje postqueue -j (Postfix 3.1+)
func parseMailQueueJSON(out string) []MailQueueItem {
	var items []MailQueueItem
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		id, _ := m["queue_id"].(string)
		size := int64(0)
		if v, ok := m["message_size"].(float64); ok {
			size = int64(v)
		}
		sizeStr := fmt.Sprintf("%dB", size)
		if size >= 1048576 {
			sizeStr = fmt.Sprintf("%.1fM", float64(size)/1048576)
		} else if size >= 1024 {
			sizeStr = fmt.Sprintf("%dK", size/1024)
		}
		from := ""
		if s, ok := m["sender"].(string); ok {
			from = s
		}
		if from == "" {
			from = "<bounce>"
		}
		to, reason := "", ""
		if recips, ok := m["recipients"].([]interface{}); ok && len(recips) > 0 {
			if r, ok := recips[0].(map[string]interface{}); ok {
				to, _ = r["address"].(string)
				reason, _ = r["delay_reason"].(string)
			}
		}
		qname, _ := m["queue_name"].(string)
		status := "deferred"
		if qname == "active" {
			status = "active"
		}
		if qname == "hold" {
			status = "hold"
		}
		arrTime := ""
		if v, ok := m["arrival_time"].(float64); ok {
			arrTime = time.Unix(int64(v), 0).Format("Jan 02 15:04")
		}
		items = append(items, MailQueueItem{
			ID: id, From: from, To: to, Size: sizeStr,
			Time: arrTime, Status: status, Reason: reason,
		})
	}
	return items
}

func parseMailQueue() []MailQueueItem {
	if out, err := runCmd("postqueue", "-j"); err == nil && out != "" && strings.HasPrefix(strings.TrimSpace(out), "{") {
		return parseMailQueueJSON(out)
	}
	out, err := runCmd("postqueue", "-p")
	if err != nil || strings.Contains(out, "Mail queue is empty") {
		return []MailQueueItem{}
	}
	var items []MailQueueItem
	reHeader := regexp.MustCompile(`^([A-F0-9a-f]+)([\*!])?\s+(\d+)\s+(\w+\s+\w+\s+[\d:]+)\s+(.*)$`)
	reTo := regexp.MustCompile(`^\s+(\S+)`)
	reReason := regexp.MustCompile(`^\s+\((.+)\)`)
	var cur *MailQueueItem
	for _, line := range strings.Split(out, "\n") {
		if m := reHeader.FindStringSubmatch(line); m != nil {
			if cur != nil {
				items = append(items, *cur)
			}
			sizeBytes, _ := strconv.Atoi(m[3])
			sizeStr := fmt.Sprintf("%dB", sizeBytes)
			if sizeBytes >= 1048576 {
				sizeStr = fmt.Sprintf("%.1fM", float64(sizeBytes)/1048576)
			} else if sizeBytes >= 1024 {
				sizeStr = fmt.Sprintf("%dK", sizeBytes/1024)
			}
			flag, status := m[2], "deferred"
			if flag == "*" {
				status = "active"
			}
			if flag == "!" {
				status = "hold"
			}
			from := strings.TrimSpace(m[5])
			if from == "" {
				from = "<bounce>"
			}
			cur = &MailQueueItem{
				ID: m[1], From: from,
				Size: sizeStr, Time: strings.TrimSpace(m[4]), Status: status,
			}
			continue
		}
		if cur == nil {
			continue
		}
		if m := reReason.FindStringSubmatch(line); m != nil {
			cur.Reason = m[1]
			if cur.Status == "active" {
				cur.Status = "deferred"
			}
			continue
		}
		if m := reTo.FindStringSubmatch(line); m != nil && cur.To == "" {
			to := strings.TrimSpace(m[1])
			if to != "" && !strings.HasPrefix(to, "(") {
				cur.To = to
			}
		}
	}
	if cur != nil {
		items = append(items, *cur)
	}
	return items
}

func parseMailStats() MailStats {
	stats := MailStats{}
	if isInstalled("pflogsumm") {
		out, err := runCmd("pflogsumm", "--no-bounce-detail", "--no-deferral-detail",
			"--no-reject-detail", "--no-smtpd-warnings", "-d", "today", "/var/log/mail.log")
		if err == nil {
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				fields := strings.Fields(line)
				if len(fields) < 2 {
					continue
				}
				n, _ := strconv.Atoi(strings.ReplaceAll(fields[0], ",", ""))
				switch {
				case strings.Contains(line, "received"):
					stats.Received = n
				case strings.Contains(line, "delivered"):
					stats.Sent = n
				case strings.Contains(line, "rejected"):
					stats.Rejected = n
				case strings.Contains(line, "bounced"):
					stats.Bounce = n
				case strings.Contains(line, "deferred"):
					stats.Deferred = n
				}
			}
			if stats.Sent > 0 {
				total := stats.Sent + stats.Bounce + stats.Deferred
				if total > 0 {
					stats.DeliveryRate = float64(int(float64(stats.Sent)/float64(total)*1000)) / 10
				}
			}
			return stats
		}
	}
	logFiles := []string{"/var/log/mail.log", "/var/log/maillog"}
	var logFile string
	for _, f := range logFiles {
		if _, err := os.Stat(f); err == nil {
			logFile = f
			break
		}
	}
	if logFile == "" {
		return stats
	}
	f, err := os.Open(logFile)
	if err != nil {
		return stats
	}
	defer f.Close()
	buf := make([]byte, 1024*1024)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(buf, len(buf))
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.Contains(line, "postfix/smtp") && strings.Contains(line, "status=sent"):
			stats.Sent++
		case strings.Contains(line, "postfix/qmgr") && strings.Contains(line, "from="):
			stats.Received++
		case strings.Contains(line, "status=bounced"):
			stats.Bounce++
		case strings.Contains(line, "status=deferred"):
			stats.Deferred++
		case strings.Contains(line, "NOQUEUE: reject"):
			stats.Rejected++
		case strings.Contains(line, "spam") || strings.Contains(line, "SPAM"):
			stats.Spam++
		case strings.Contains(line, "VIRUS") || strings.Contains(line, "virus"):
			stats.Virus++
		}
	}
	stats.Clean = stats.Received - stats.Spam - stats.Virus
	if stats.Clean < 0 {
		stats.Clean = 0
	}
	total := stats.Sent + stats.Bounce + stats.Deferred
	if total > 0 {
		stats.DeliveryRate = float64(int(float64(stats.Sent)/float64(total)*1000)) / 10
	}
	return stats
}

const nimbusDomainFile = "/var/lib/nimbus/mail_domains.json"
const postfixVirtualDomains = "/etc/postfix/nimbus_virtual_domains"

func readMailDomains() []MailDomain {
	// Czytaj z własnego pliku nimbus (nie z postconf który może mieć zmienne)
	data, err := os.ReadFile(nimbusDomainFile)
	if err != nil {
		return []MailDomain{}
	}
	var domains []MailDomain
	if err := json.Unmarshal(data, &domains); err != nil {
		return []MailDomain{}
	}
	// Uzupełnij liczbę kont z filesystem
	base := virtualMailboxBase()
	for i := range domains {
		if entries, err := os.ReadDir(filepath.Join(base, domains[i].Name)); err == nil {
			domains[i].Accounts = len(entries)
		}
	}
	return domains
}

func saveMailDomains(domains []MailDomain) error {
	os.MkdirAll("/var/lib/nimbus", 0755)
	data, err := json.MarshalIndent(domains, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(nimbusDomainFile, data, 0644); err != nil {
		return err
	}
	// Zaktualizuj plik Postfix virtual_mailbox_domains
	var lines []string
	for _, d := range domains {
		if d.Active {
			lines = append(lines, d.Name+"\tOK")
		}
	}
	os.WriteFile(postfixVirtualDomains, []byte(strings.Join(lines, "\n")+"\n"), 0644)
	runCmd("postmap", postfixVirtualDomains)
	// Ustaw virtual_mailbox_domains w postfix jeśli jeszcze nie wskazuje na nasz plik
	runCmd("postconf", "-e", "virtual_mailbox_domains=hash:"+postfixVirtualDomains)
	runCmd("postfix", "reload")
	return nil
}

func readMailAccounts() []MailAccount {
	// Czytaj wyłącznie z /etc/dovecot/users — naszego pliku z kontami pocztowymi
	// NIE używaj doveadm user * bo zwraca użytkowników systemu
	data, err := os.ReadFile("/etc/dovecot/users")
	if err != nil {
		return []MailAccount{}
	}
	var accounts []MailAccount
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		addr := strings.TrimSpace(parts[0])
		// Tylko konta z @ — pomijamy systemowe wpisy bez domeny
		if !strings.Contains(addr, "@") {
			continue
		}
		accounts = append(accounts, MailAccount{Addr: addr, MaxGB: 10, Last: "—"})
	}
	return accounts
}

func readPostfixConfig() map[string]string {
	cfg := map[string]string{}
	keys := []string{"myhostname", "myorigin", "mydomain", "inet_interfaces", "mynetworks",
		"relayhost", "message_size_limit", "smtp_tls_security_level",
		"smtp_sasl_auth_enable", "sender_canonical_maps"}
	for _, k := range keys {
		if out, err := runCmd("postconf", "-h", k); err == nil {
			cfg[k] = strings.TrimSpace(out)
		}
	}
	return cfg
}

func readDovecotConfig() map[string]string {
	cfg := map[string]string{}
	if isInstalled("doveconf") {
		for _, k := range []string{"protocols", "mail_location", "ssl", "auth_mechanisms"} {
			if out, err := runCmd("doveconf", "-h", k); err == nil {
				cfg[k] = strings.TrimSpace(out)
			}
		}
	}
	return cfg
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────

func (s *Server) handleMailStatus(w http.ResponseWriter, r *http.Request) {
	queue := parseMailQueue()
	deferred := 0
	for _, q := range queue {
		if q.Status == "deferred" {
			deferred++
		}
	}
	jsonOK(w, map[string]any{
		"postfix":           serviceActive("postfix"),
		"dovecot":           serviceActive("dovecot"),
		"spamassassin":      serviceActive("spamassassin") || serviceActive("spamd"),
		"clamav":            serviceActive("clamav-daemon") || serviceActive("clamd"),
		"postfix_installed": postfixInstalled(),
		"dovecot_installed": dovecotInstalled(),
		"queue_total":       len(queue),
		"queue_deferred":    deferred,
		"stats":             parseMailStats(),
		"queue":             queue,
	})
}

func (s *Server) handleMailQueue(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"queue": parseMailQueue()})
}

func (s *Server) handleMailQueueFlush(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("postfix", "flush")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}

func (s *Server) handleMailQueueAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID     string `json:"id"`
		Action string `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" || req.Action == "" {
		jsonErr(w, "id and action required", http.StatusBadRequest)
		return
	}
	var out string
	var err error
	switch req.Action {
	case "hold":
		out, err = runCmd("postsuper", "-h", req.ID)
	case "release":
		out, err = runCmd("postsuper", "-H", req.ID)
	case "delete":
		out, err = runCmd("postsuper", "-d", req.ID)
	default:
		jsonErr(w, "unknown action", http.StatusBadRequest)
		return
	}
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMailQueueDetail(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/mail/queue/detail/")
	if id == "" {
		jsonErr(w, "id required", 400)
		return
	}
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')) {
			jsonErr(w, "invalid id", 400)
			return
		}
	}
	out, err := runCmd("postcat", "-q", id)
	if err != nil {
		out, _ = runCmd("postcat", "-e", "-q", id)
	}
	jsonOK(w, map[string]string{"id": id, "content": out})
}

func (s *Server) handleMailDomains(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"domains": readMailDomains()})
	case http.MethodPost:
		var req struct {
			Name string `json:"name"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		req.Name = strings.ToLower(strings.TrimSpace(req.Name))
		if req.Name == "" || !strings.Contains(req.Name, ".") {
			jsonErr(w, "invalid domain name", http.StatusBadRequest)
			return
		}
		domains := readMailDomains()
		// Sprawdź duplikaty
		for _, d := range domains {
			if d.Name == req.Name {
				jsonErr(w, "domain already exists", http.StatusConflict)
				return
			}
		}
		domains = append(domains, MailDomain{Name: req.Name, Active: true})
		if err := saveMailDomains(domains); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMailDomainDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	domain := strings.TrimPrefix(r.URL.Path, "/api/mail/domains/")
	if domain == "" {
		jsonErr(w, "domain required", http.StatusBadRequest)
		return
	}
	domains := readMailDomains()
	newDomains := []MailDomain{}
	for _, d := range domains {
		if d.Name != domain {
			newDomains = append(newDomains, d)
		}
	}
	if err := saveMailDomains(newDomains); err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}


// hashDovecotPassword — hashuje hasło do formatu Dovecot {SHA512-CRYPT}$6$...
func hashDovecotPassword(password string) (string, error) {
	// doveadm pw -s SHA512-CRYPT -p <hasło>
	// Flaga -p działa gdy nie ma TTY (w procesie serwera)
	if isInstalled("doveadm") {
		out, err := exec.Command("doveadm", "pw", "-s", "SHA512-CRYPT", "-p", password).CombinedOutput()
		result := strings.TrimSpace(string(out))
		if err == nil && strings.HasPrefix(result, "{SHA512-CRYPT}") {
			return result, nil
		}
		// doveadm może wypisać prompt na stderr - wyfiltruj sam hash
		for _, line := range strings.Split(result, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "{") {
				return line, nil
			}
		}
	}
	// openssl passwd -6 (SHA-512 crypt)
	out2, err2 := exec.Command("openssl", "passwd", "-6", password).Output()
	if err2 == nil {
		hash := strings.TrimSpace(string(out2))
		if strings.HasPrefix(hash, "$6$") {
			return "{SHA512-CRYPT}" + hash, nil
		}
	}
	// python3 fallback
	out3, err3 := exec.Command("python3", "-c",
		"import crypt,sys; print(crypt.crypt(sys.argv[1], crypt.mksalt(crypt.METHOD_SHA512)))",
		password).Output()
	if err3 == nil {
		hash := strings.TrimSpace(string(out3))
		if strings.HasPrefix(hash, "$6$") {
			return "{SHA512-CRYPT}" + hash, nil
		}
	}
	return "", fmt.Errorf("nie można zahashować hasła — sprawdź czy doveadm/openssl jest zainstalowany")
}

// handleMailAccountPassword — zmienia hasło istniejącego konta
func (s *Server) handleMailAccountPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Addr     string `json:"addr"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	req.Addr = strings.ToLower(strings.TrimSpace(req.Addr))
	if req.Addr == "" || req.Password == "" {
		jsonErr(w, "addr and password required", 400)
		return
	}
	hash, err := hashDovecotPassword(req.Password)
	if err != nil {
		jsonErr(w, err.Error(), 500)
		return
	}
	// Zastąp linię z tym adresem
	usersFile := "/etc/dovecot/users"
	data, err := os.ReadFile(usersFile)
	if err != nil {
		jsonErr(w, err.Error(), 500)
		return
	}
	found := false
	var newLines []string
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(parts) >= 1 && strings.EqualFold(parts[0], req.Addr) {
			newLines = append(newLines, req.Addr+":"+hash)
			found = true
		} else if line != "" {
			newLines = append(newLines, line)
		}
	}
	if !found {
		jsonErr(w, "account not found", 404)
		return
	}
	os.WriteFile(usersFile, []byte(strings.Join(newLines, "\n")+"\n"), 0640)
	jsonOK(w, map[string]string{"status": "ok", "hash_prefix": hash[:14]})
}

func (s *Server) handleMailAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, map[string]any{"accounts": readMailAccounts()})
	case http.MethodPost:
		var req struct {
			Addr     string `json:"addr"`
			Password string `json:"password"`
			MaxGB    int    `json:"max_gb"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		req.Addr = strings.ToLower(strings.TrimSpace(req.Addr))
		if req.Addr == "" || req.Password == "" {
			jsonErr(w, "addr and password required", http.StatusBadRequest)
			return
		}
		if !strings.Contains(req.Addr, "@") {
			jsonErr(w, "invalid email address", http.StatusBadRequest)
			return
		}

		// Hashuj hasło — próbuj doveadm, fallback openssl, fallback python3
		hash, err := hashDovecotPassword(req.Password)
		if err != nil {
			jsonErr(w, "cannot hash password: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Sprawdź czy konto już istnieje
		usersFile := "/etc/dovecot/users"
		existing, _ := os.ReadFile(usersFile)
		for _, line := range strings.Split(string(existing), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if strings.EqualFold(strings.TrimSpace(parts[0]), req.Addr) {
				jsonErr(w, "account already exists", http.StatusConflict)
				return
			}
		}

		f, err := os.OpenFile(usersFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0640)
		if err != nil {
			jsonErr(w, "cannot open users file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(f, "%s:%s\n", req.Addr, hash)
		f.Close()

		// Utwórz katalog skrzynki
		parts := strings.Split(req.Addr, "@")
		if len(parts) == 2 {
			maildir := fmt.Sprintf("%s/%s/%s", virtualMailboxBase(), parts[1], parts[0])
			os.MkdirAll(maildir+"/cur", 0700)
			os.MkdirAll(maildir+"/new", 0700)
			os.MkdirAll(maildir+"/tmp", 0700)
		}

		jsonOK(w, map[string]string{"status": "ok", "addr": req.Addr})
	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMailAccountDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	addr := strings.TrimPrefix(r.URL.Path, "/api/mail/accounts/")
	if addr == "" {
		jsonErr(w, "addr required", http.StatusBadRequest)
		return
	}
	usersFile := "/etc/dovecot/users"
	data, err := os.ReadFile(usersFile)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var newLines []string
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), addr+":") {
			newLines = append(newLines, line)
		}
	}
	os.WriteFile(usersFile, []byte(strings.Join(newLines, "\n")), 0640)
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMailService(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Service string `json:"service"`
		Action  string `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	allowed := map[string]bool{"postfix": true, "dovecot": true, "spamassassin": true, "clamav-daemon": true}
	allowedActions := map[string]bool{"start": true, "stop": true, "restart": true, "reload": true}
	if !allowed[req.Service] || !allowedActions[req.Action] {
		jsonErr(w, "invalid service or action", http.StatusBadRequest)
		return
	}
	out, err := runCmd("systemctl", req.Action, req.Service)
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMailConfig(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{
		"postfix": readPostfixConfig(),
		"dovecot": readDovecotConfig(),
	})
}

func (s *Server) handleMailInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := runCmd("apt-get", "install", "-y",
		"postfix", "dovecot-core", "dovecot-imapd", "dovecot-pop3d",
		"spamassassin", "clamav", "clamav-daemon")
	if err != nil {
		jsonErr(w, out, http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok", "output": out})
}

// ── Konfiguracja Postfix przez UI ──────────────────────────────────────────────

var postfixEditableKeys = map[string]bool{
	"myhostname": true, "myorigin": true, "mydomain": true,
	"mynetworks": true, "inet_interfaces": true,
	"relayhost": true, "smtp_sasl_auth_enable": true,
	"smtp_sasl_password_maps": true, "smtp_sasl_security_options": true,
	"smtp_tls_security_level": true, "smtp_tls_CAfile": true,
	"message_size_limit": true, "mailbox_size_limit": true,
	"sender_canonical_maps": true, "masquerade_domains": true,
}

// sanitizePostfixValue — usuwa znaki które mogą powodować problemy w main.cf
// i sprawdza czy wartość nie jest niezastaąpioną zmienną ($xxx)
func sanitizePostfixValue(v string) (string, error) {
	v = strings.TrimSpace(v)
	if strings.HasPrefix(v, "$") {
		return "", fmt.Errorf("wartość '%s' wygląda jak niezastąpiona zmienna — wpisz prawdziwą wartość", v)
	}
	// Usuń znaki specjalne które mogłyby wstrzyknąć dodatkowe dyrektywy
	for _, bad := range []string{"\n", "\r", "\x00"} {
		v = strings.ReplaceAll(v, bad, "")
	}
	return v, nil
}

func (s *Server) handlePostfixConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg := map[string]string{}
		for key := range postfixEditableKeys {
			if out, err := runCmd("postconf", "-h", key); err == nil {
				cfg[key] = strings.TrimSpace(out)
			}
		}
		saslExists := false
		if _, err := os.Stat("/etc/postfix/sasl_passwd"); err == nil {
			saslExists = true
		}
		jsonOK(w, map[string]any{"config": cfg, "sasl_passwd_exists": saslExists})
	case http.MethodPost:
		var req struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, "invalid JSON", 400)
			return
		}
		if !postfixEditableKeys[req.Key] {
			jsonErr(w, "key not allowed: "+req.Key, 403)
			return
		}
		clean, err := sanitizePostfixValue(req.Value)
		if err != nil {
			jsonErr(w, err.Error(), 400)
			return
		}
		req.Value = clean
		out, err := runCmd("postconf", "-e", req.Key+"="+req.Value)
		if err != nil {
			jsonErr(w, out, 500)
			return
		}
		runCmd("postfix", "reload")
		jsonOK(w, map[string]string{"status": "ok", "key": req.Key, "value": req.Value})
	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func (s *Server) handlePostfixSASL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Relay    string `json:"relay"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid JSON", 400)
		return
	}
	if req.Relay == "" || req.User == "" || req.Password == "" {
		jsonErr(w, "relay, user and password required", 400)
		return
	}
	line := req.Relay + " " + req.User + ":" + req.Password + "\n"
	if err := os.WriteFile("/etc/postfix/sasl_passwd", []byte(line), 0600); err != nil {
		jsonErr(w, err.Error(), 500)
		return
	}
	if out, err := runCmd("postmap", "/etc/postfix/sasl_passwd"); err != nil {
		jsonErr(w, out, 500)
		return
	}
	runCmd("postconf", "-e", "relayhost="+req.Relay)
	runCmd("postconf", "-e", "smtp_sasl_auth_enable=yes")
	runCmd("postconf", "-e", "smtp_sasl_password_maps=hash:/etc/postfix/sasl_passwd")
	runCmd("postconf", "-e", "smtp_sasl_security_options=noanonymous")
	runCmd("postconf", "-e", "smtp_tls_security_level=encrypt")
	runCmd("postconf", "-e", "smtp_tls_CAfile=/etc/ssl/certs/ca-certificates.crt")
	runCmd("postfix", "reload")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handlePostfixApplyProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Profile  string `json:"profile"`
		Hostname string `json:"hostname"`
		Domain   string `json:"domain"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid JSON", 400)
		return
	}
	relays := map[string]string{
		"gmail":    "[smtp.gmail.com]:587",
		"o2":       "[smtp.o2.pl]:587",
		"wp":       "[smtp.wp.pl]:587",
		"onet":     "[smtp.onet.pl]:587",
		"interia":  "[smtp.interia.pl]:587",
		"sendgrid": "[smtp.sendgrid.net]:587",
		"mailgun":  "[smtp.mailgun.org]:587",
	}
	if req.Hostname != "" {
		if h, err := sanitizePostfixValue(req.Hostname); err == nil && h != "" {
			runCmd("postconf", "-e", "myhostname="+h)
			req.Hostname = h
		}
	}
	if req.Domain != "" {
		if d, err := sanitizePostfixValue(req.Domain); err == nil && d != "" {
			runCmd("postconf", "-e", "myorigin="+d)
			runCmd("postconf", "-e", "mydomain="+d)
			req.Domain = d
		}
		canonical := "/etc/postfix/sender_canonical"
		os.WriteFile(canonical, []byte("root\t root@"+req.Domain+"\n"), 0644)
		runCmd("postmap", canonical)
		runCmd("postconf", "-e", "sender_canonical_maps=hash:"+canonical)
	}
	relay, ok := relays[req.Profile]
	if ok && req.User != "" && req.Password != "" {
		line := relay + " " + req.User + ":" + req.Password + "\n"
		os.WriteFile("/etc/postfix/sasl_passwd", []byte(line), 0600)
		runCmd("postmap", "/etc/postfix/sasl_passwd")
		runCmd("postconf", "-e", "relayhost="+relay)
		runCmd("postconf", "-e", "smtp_sasl_auth_enable=yes")
		runCmd("postconf", "-e", "smtp_sasl_password_maps=hash:/etc/postfix/sasl_passwd")
		runCmd("postconf", "-e", "smtp_sasl_security_options=noanonymous")
		runCmd("postconf", "-e", "smtp_tls_security_level=encrypt")
		runCmd("postconf", "-e", "smtp_tls_CAfile=/etc/ssl/certs/ca-certificates.crt")
	} else if req.Profile == "local" {
		runCmd("postconf", "-e", "relayhost=")
		runCmd("postconf", "-e", "smtp_sasl_auth_enable=no")
	}
	runCmd("postfix", "reload")
	runCmd("postfix", "flush")
	jsonOK(w, map[string]string{"status": "ok", "profile": req.Profile})
}

// handlePostfixDiag — diagnostyka konfiguracji Postfix
func (s *Server) handlePostfixDiag(w http.ResponseWriter, r *http.Request) {
	issues := []string{}

	// Sprawdź myhostname
	hostname, _ := runCmd("postconf", "-h", "myhostname")
	hostname = strings.TrimSpace(hostname)
	if hostname == "" || hostname == "$myhostname" || !strings.Contains(hostname, ".") {
		issues = append(issues, "myhostname jest nieprawidłowy: "+hostname)
	}

	// Sprawdź myorigin
	origin, _ := runCmd("postconf", "-h", "myorigin")
	origin = strings.TrimSpace(origin)
	if origin == "" || origin == "$myhostname" || origin == "debian" || !strings.Contains(origin, ".") {
		issues = append(issues, "myorigin jest nieprawidłowy: "+origin)
	}

	// Sprawdź relayhost
	relay, _ := runCmd("postconf", "-h", "relayhost")
	relay = strings.TrimSpace(relay)

	// Sprawdź sender_canonical
	canonical, _ := runCmd("postconf", "-h", "sender_canonical_maps")
	canonical = strings.TrimSpace(canonical)

	// Sprawdź sasl
	sasl, _ := runCmd("postconf", "-h", "smtp_sasl_auth_enable")
	sasl = strings.TrimSpace(sasl)

	jsonOK(w, map[string]any{
		"hostname":         hostname,
		"origin":           origin,
		"relay":            relay,
		"sender_canonical": canonical,
		"sasl_enabled":     sasl == "yes",
		"issues":           issues,
		"has_issues":       len(issues) > 0,
	})
}

// handlePostfixFix — naprawia typowe błędy konfiguracji Postfix
func (s *Server) handlePostfixFix(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Hostname string `json:"hostname"` // np. mail.example.com
		Domain   string `json:"domain"`   // np. example.com
	}
	json.NewDecoder(r.Body).Decode(&req)

	fixed := []string{}

	// Napraw myhostname jeśli jest $myhostname lub bez domeny
	if req.Hostname != "" {
		runCmd("postconf", "-e", "myhostname="+req.Hostname)
		fixed = append(fixed, "myhostname="+req.Hostname)
	} else {
		// Spróbuj pobrać hostname systemu
		if h, err := runCmd("hostname", "-f"); err == nil {
			h = strings.TrimSpace(h)
			if h != "" && strings.Contains(h, ".") {
				runCmd("postconf", "-e", "myhostname="+h)
				fixed = append(fixed, "myhostname="+h)
				req.Hostname = h
			}
		}
	}

	// Napraw myorigin
	if req.Domain != "" {
		runCmd("postconf", "-e", "myorigin="+req.Domain)
		runCmd("postconf", "-e", "mydomain="+req.Domain)
		fixed = append(fixed, "myorigin="+req.Domain)
	} else if req.Hostname != "" {
		// Wyciągnij domenę z hostname
		parts := strings.SplitN(req.Hostname, ".", 2)
		if len(parts) == 2 {
			req.Domain = parts[1]
			runCmd("postconf", "-e", "myorigin="+req.Domain)
			runCmd("postconf", "-e", "mydomain="+req.Domain)
			fixed = append(fixed, "myorigin="+req.Domain)
		}
	}

	// Napraw sender_canonical — root@debian → root@domain
	if req.Domain != "" {
		canonical := "/etc/postfix/sender_canonical"
		content := "root\t root@" + req.Domain + "\n"
		content += "@debian\t @" + req.Domain + "\n"
		os.WriteFile(canonical, []byte(content), 0644)
		runCmd("postmap", canonical)
		runCmd("postconf", "-e", "sender_canonical_maps=hash:"+canonical)
		fixed = append(fixed, "sender_canonical: root@debian → root@"+req.Domain)
	}

	// Wyczyść bounced wiadomości z błędem $myhostname
	runCmd("postsuper", "-d", "ALL", "bounce")

	runCmd("postfix", "reload")

	jsonOK(w, map[string]any{
		"status": "ok",
		"fixed":  fixed,
	})
}

// handleMailDNSDiag — sprawdza rekordy DNS dla domeny (SPF, MX, PTR)
func (s *Server) handleMailDNSDiag(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		if out, err := runCmd("postconf", "-h", "mydomain"); err == nil {
			domain = strings.TrimSpace(out)
		}
	}
	if domain == "" || strings.HasPrefix(domain, "$") {
		jsonErr(w, "no domain configured", 400)
		return
	}

	result := map[string]any{"domain": domain}

	// Sprawdź rekord MX
	if out, err := runCmd("dig", "+short", "MX", domain); err == nil {
		result["mx"] = strings.TrimSpace(out)
	} else {
		result["mx"] = ""
	}

	// Sprawdź rekord SPF (TXT)
	if out, err := runCmd("dig", "+short", "TXT", domain); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, "v=spf1") {
				result["spf"] = strings.Trim(strings.TrimSpace(line), "\"")
				break
			}
		}
	}
	if result["spf"] == nil {
		result["spf"] = ""
	}

	// Sprawdź rekord DKIM (domyślny selektor "mail" lub "default")
	for _, sel := range []string{"mail", "default", "dkim", "selector1"} {
		dkimHost := sel + "._domainkey." + domain
		if out, err := runCmd("dig", "+short", "TXT", dkimHost); err == nil && strings.TrimSpace(out) != "" {
			result["dkim"] = strings.TrimSpace(out)
			result["dkim_selector"] = sel
			break
		}
	}
	if result["dkim"] == nil {
		result["dkim"] = ""
	}

	// Pobierz zewnętrzne IP serwera
	if out, err := runCmd("dig", "+short", "myip.opendns.com", "@resolver1.opendns.com"); err == nil {
		result["server_ip"] = strings.TrimSpace(out)
	} else {
		// Fallback
		result["server_ip"] = ""
	}

	// Sprawdź PTR (reverse DNS)
	ip, _ := result["server_ip"].(string)
	if ip != "" {
		if out, err := runCmd("dig", "+short", "-x", ip); err == nil {
			result["ptr"] = strings.TrimSpace(out)
		}
	}
	if result["ptr"] == nil {
		result["ptr"] = ""
	}

	// Sprawdź czy IP jest w SPF
	spf, _ := result["spf"].(string)
	ip, _ = result["server_ip"].(string)
	result["spf_includes_ip"] = ip != "" && spf != "" && (strings.Contains(spf, ip) || strings.Contains(spf, "+all"))

	jsonOK(w, result)
}

// handleMailAlias — zarządza aliasami /etc/aliases
func (s *Server) handleMailAlias(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile("/etc/aliases")
		if err != nil {
			jsonOK(w, map[string]any{"aliases": []any{}})
			return
		}
		var aliases []map[string]string
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				aliases = append(aliases, map[string]string{
					"from": strings.TrimSpace(parts[0]),
					"to":   strings.TrimSpace(parts[1]),
				})
			}
		}
		jsonOK(w, map[string]any{"aliases": aliases})

	case http.MethodPost:
		var req struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		req.From = strings.TrimSpace(req.From)
		req.To = strings.TrimSpace(req.To)
		if req.From == "" || req.To == "" {
			jsonErr(w, "from and to required", 400)
			return
		}
		// Dodaj lub zastąp istniejący alias
		data, _ := os.ReadFile("/etc/aliases")
		var lines []string
		for _, line := range strings.Split(string(data), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), req.From+":") {
				lines = append(lines, line)
			}
		}
		lines = append(lines, req.From+": "+req.To)
		os.WriteFile("/etc/aliases", []byte(strings.Join(lines, "\n")+"\n"), 0644)
		runCmd("newaliases")
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", 405)
	}
}

func (s *Server) handleMailAccountsDebug(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile("/etc/dovecot/users")
	fileExists := err == nil
	var lines []string
	if fileExists {
		for _, l := range strings.Split(string(data), "\n") {
			if l != "" {
				// Maskuj hash hasła
				parts := strings.SplitN(l, ":", 2)
				if len(parts) == 2 {
					lines = append(lines, parts[0]+":***")
				} else {
					lines = append(lines, l)
				}
			}
		}
	}
	jsonOK(w, map[string]any{
		"file":        "/etc/dovecot/users",
		"exists":      fileExists,
		"lines":       lines,
		"line_count":  len(lines),
		"accounts":    readMailAccounts(),
	})
}

// handleDovecotSetupPassdb — konfiguruje Dovecot 2.4 dla /etc/dovecot/users
func (s *Server) handleDovecotSetupPassdb(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}

	usersFile := "/etc/dovecot/users"
	fixed := []string{}

	// 1. Odkomentuj auth-passwdfile w 10-auth.conf
	authConf := "/etc/dovecot/conf.d/10-auth.conf"
	data, _ := os.ReadFile(authConf)
	updated := strings.ReplaceAll(string(data),
		"#!include auth-passwdfile.conf.ext",
		"!include auth-passwdfile.conf.ext")
	if updated != string(data) {
		os.WriteFile(authConf, []byte(updated), 0644)
		fixed = append(fixed, "odkomentowano auth-passwdfile w 10-auth.conf")
	}

	// 2. Zakomentuj userdb passwd w auth-system.conf.ext (przeszkadza)
	systemConf := "/etc/dovecot/conf.d/auth-system.conf.ext"
	sysData, _ := os.ReadFile(systemConf)
	sysUpdated := strings.ReplaceAll(string(sysData),
		"userdb passwd {",
		"#userdb passwd {")
	if sysUpdated != string(sysData) {
		os.WriteFile(systemConf, []byte(sysUpdated), 0644)
		fixed = append(fixed, "zakomentowano userdb passwd w auth-system.conf.ext")
	}

	// 3. Zapisz auth-passwdfile.conf.ext — składnia Dovecot 2.4
	// Używamy uid/gid użytkownika dovecot
	dovecotUID := "111"
	dovecotGID := "115"
	if out, err := runCmd("id", "-u", "dovecot"); err == nil {
		dovecotUID = strings.TrimSpace(out)
	}
	if out, err := runCmd("id", "-g", "dovecot"); err == nil {
		dovecotGID = strings.TrimSpace(out)
	}

	passwdFileConf := "/etc/dovecot/conf.d/auth-passwdfile.conf.ext"
	passwdContent := "passdb passwd-file {\n" +
		"  default_password_scheme = SHA512-CRYPT\n" +
		"  auth_username_format = %{user}\n" +
		"  passwd_file_path = " + usersFile + "\n" +
		"}\n\n" +
		"userdb static {\n" +
		"  fields {\n" +
		"    uid = " + dovecotUID + "\n" +
		"    gid = " + dovecotGID + "\n" +
		"  }\n" +
		"}\n"
	os.WriteFile(passwdFileConf, []byte(passwdContent), 0644)
	fixed = append(fixed, "zapisano auth-passwdfile.conf.ext (uid="+dovecotUID+" gid="+dovecotGID+")")

	// 4. Ustaw mail_path i mail_inbox_path w 10-mail.conf
	mailConf := "/etc/dovecot/conf.d/10-mail.conf"
	mailData, _ := os.ReadFile(mailConf)
	mailStr := string(mailData)
	nimbusMarker := "# Nimbus NAS mail_path"
	if !strings.Contains(mailStr, nimbusMarker) {
		mailStr += "\n" + nimbusMarker + "\n" +
			"mail_driver = maildir\n" +
			"mail_path = /var/mail/vhosts/%{user | domain}/%{user | username}/Maildir\n" +
			"mail_inbox_path = /var/mail/vhosts/%{user | domain}/%{user | username}/Maildir\n" +
			"first_valid_uid = 100\n"
		os.WriteFile(mailConf, []byte(mailStr), 0644)
		fixed = append(fixed, "dodano mail_path do 10-mail.conf")
	}

	// 5. Usuń stary plik 99-nimbus jeśli istnieje
	os.Remove("/etc/dovecot/conf.d/99-nimbus-auth.conf")

	// 6. Uprawnienia
	runCmd("chmod", "0640", usersFile)
	runCmd("chown", "root:dovecot", usersFile)

	// 7. Utwórz katalogi maildir
	mailBase := "/var/mail/vhosts"
	os.MkdirAll(mailBase, 0755)
	usersData, _ := os.ReadFile(usersFile)
	for _, line := range strings.Split(string(usersData), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(parts) > 0 && strings.Contains(parts[0], "@") {
			ep := strings.SplitN(parts[0], "@", 2)
			if len(ep) == 2 {
				maildir := mailBase + "/" + ep[1] + "/" + ep[0] + "/Maildir"
				os.MkdirAll(maildir+"/cur", 0700)
				os.MkdirAll(maildir+"/new", 0700)
				os.MkdirAll(maildir+"/tmp", 0700)
				runCmd("chown", "-R", dovecotUID+":"+dovecotGID, mailBase)
			}
		}
	}
	fixed = append(fixed, "katalogi maildir utworzone")

	// 8. Walidacja i restart
	if out, err := runCmd("doveconf", "-n"); err != nil || strings.Contains(out, "Fatal") {
		jsonErr(w, "błąd konfiguracji: "+out, 500)
		return
	}
	runCmd("systemctl", "restart", "dovecot")
	fixed = append(fixed, "dovecot zrestartowany")

	jsonOK(w, map[string]any{"status": "ok", "fixed": fixed})
}


