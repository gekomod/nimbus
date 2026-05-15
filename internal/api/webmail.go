package api

// webmail.go — klient IMAP/SMTP dla webmaila
// Endpointy:
//   POST /api/webmail/login    — sprawdź dane IMAP
//   GET  /api/webmail/messages — lista wiadomości z folderu
//   GET  /api/webmail/message  — pełna treść wiadomości
//   GET  /api/webmail/counts   — liczba nieprzeczytanych per folder
//   POST /api/webmail/send     — wyślij przez SMTP
//   POST /api/webmail/delete   — usuń wiadomość
//   POST /api/webmail/move     — przenieś do folderu

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"
)

// ── IMAP client (minimalna implementacja bez zewnętrznych zależności) ──────────

type imapConn struct {
	conn   net.Conn
	reader *bufio.Reader
	seq    int
}

func dialIMAP(host, port string, useTLS bool) (*imapConn, error) {
	addr := host + ":" + port
	var conn net.Conn
	var err error

	if useTLS {
		tlsCfg := &tls.Config{InsecureSkipVerify: true, ServerName: host}
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", addr, tlsCfg)
	} else {
		conn, err = net.DialTimeout("tcp", addr, 10*time.Second)
	}
	if err != nil {
		return nil, err
	}
	conn.SetDeadline(time.Now().Add(30 * time.Second))

	c := &imapConn{conn: conn, reader: bufio.NewReader(conn)}
	// Czytaj powitanie
	if _, err := c.readLine(); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *imapConn) readLine() (string, error) {
	line, err := c.reader.ReadString('\n')
	return strings.TrimRight(line, "\r\n"), err
}

func (c *imapConn) readUntilTag(tag string) ([]string, error) {
	var lines []string
	for {
		line, err := c.readLine()
		if err != nil {
			return lines, err
		}
		lines = append(lines, line)
		if strings.HasPrefix(line, tag) {
			return lines, nil
		}
	}
}

func (c *imapConn) cmd(format string, args ...interface{}) ([]string, error) {
	c.seq++
	tag := fmt.Sprintf("A%04d", c.seq)
	cmd := fmt.Sprintf(tag+" "+format+"\r\n", args...)
	if _, err := fmt.Fprint(c.conn, cmd); err != nil {
		return nil, err
	}
	return c.readUntilTag(tag)
}

func (c *imapConn) ok(lines []string) bool {
	if len(lines) == 0 {
		return false
	}
	last := lines[len(lines)-1]
	return strings.Contains(last, " OK")
}

func (c *imapConn) close() {
	c.cmd("LOGOUT")
	c.conn.Close()
}

// ── Konfiguracja IMAP ─────────────────────────────────────────────────────────

func imapConfig() (host, port string, useTLS bool) {
	// Spróbuj wczytać z konfiguracji Dovecot
	if out, err := runCmd("doveconf", "-h", "ssl"); err == nil {
		ssl := strings.TrimSpace(out)
		if ssl == "yes" || ssl == "required" {
			useTLS = true
		}
	}
	host = "127.0.0.1"
	if useTLS {
		port = "993"
	} else {
		port = "143"
	}
	return
}

func smtpConfig() (host, port string) {
	return "127.0.0.1", "25"
}

// ── Ekstrakcja nagłówków ───────────────────────────────────────────────────────

func decodeHeader(s string) string {
	dec := new(mime.WordDecoder)
	if out, err := dec.DecodeHeader(s); err == nil {
		return out
	}
	return s
}

// ── Parsowanie FETCH ──────────────────────────────────────────────────────────

type WebmailMessage struct {
	UID      int    `json:"uid"`
	Subject  string `json:"subject"`
	From     string `json:"from"`
	FromName string `json:"from_name"`
	To       string `json:"to"`
	Date     string `json:"date"`
	Read     bool   `json:"read"`
	Preview  string `json:"preview"`
	Body     string `json:"body,omitempty"`
}

// ── Pobierz pełną treść wiadomości ───────────────────────────────────────────

func fetchMessageBody(c *imapConn, uid int) string {
	lines, err := c.cmd("UID FETCH %d (BODY[])", uid)
	if err != nil || !c.ok(lines) {
		return ""
	}

	// Zbierz surowe bajty wiadomości
	var rawLines []string
	inMsg := false
	for _, line := range lines {
		if strings.Contains(line, "BODY[]") {
			inMsg = true
			continue
		}
		if inMsg {
			if line == ")" || strings.HasPrefix(line, "A") {
				break
			}
			rawLines = append(rawLines, line)
		}
	}

	raw := strings.Join(rawLines, "\r\n")
	msg, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		return raw
	}

	return extractTextBody(msg)
}

func extractTextBody(msg *mail.Message) string {
	ct := msg.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(ct)
	if err != nil {
		body, _ := io.ReadAll(msg.Body)
		return decodeBodyEncoding(msg.Header.Get("Content-Transfer-Encoding"), string(body))
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		mr := multipart.NewReader(msg.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			partCT := part.Header.Get("Content-Type")
			if strings.HasPrefix(partCT, "text/plain") {
				body, _ := io.ReadAll(part)
				return decodeBodyEncoding(part.Header.Get("Content-Transfer-Encoding"), string(body))
			}
		}
	}

	body, _ := io.ReadAll(msg.Body)
	return decodeBodyEncoding(msg.Header.Get("Content-Transfer-Encoding"), string(body))
}

func decodeBodyEncoding(enc, body string) string {
	switch strings.ToLower(strings.TrimSpace(enc)) {
	case "quoted-printable":
		r := quotedprintable.NewReader(strings.NewReader(body))
		if decoded, err := io.ReadAll(r); err == nil {
			return string(decoded)
		}
	case "base64":
		// Prosta obsługa base64
		body = strings.ReplaceAll(body, "\n", "")
		body = strings.ReplaceAll(body, "\r", "")
	}
	return body
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func getIMAPCreds(r *http.Request) (email, password string) {
	email = r.Header.Get("X-Webmail-Email")
	password = r.Header.Get("X-Webmail-Password")
	return
}

func connectIMAP(email, password string) (*imapConn, error) {
	// Próbuj różne porty i konfiguracje
	attempts := []struct{ port string; tls bool }{
		{"143", false},
		{"993", true},
	}

	var lastErr error
	for _, a := range attempts {
		c, err := dialIMAP("127.0.0.1", a.port, a.tls)
		if err != nil {
			lastErr = err
			continue
		}

		// LOGIN z cudzysłowami IMAP (nie Go %q który escape'uje inaczej)
		loginCmd := fmt.Sprintf("LOGIN %s %s", imapQuote(email), imapQuote(password))
		c.seq++
		tag := fmt.Sprintf("A%04d", c.seq)
		fmt.Fprintf(c.conn, "%s %s\r\n", tag, loginCmd)
		lines, err := c.readUntilTag(tag)
		if err != nil {
			c.conn.Close()
			lastErr = err
			continue
		}
		if !c.ok(lines) {
			// Zwróć błąd z serwera IMAP
			errMsg := "nieprawidłowy email lub hasło"
			for _, l := range lines {
				if strings.Contains(strings.ToUpper(l), "NO ") || strings.Contains(strings.ToUpper(l), "BAD ") {
					errMsg = strings.TrimSpace(l)
					break
				}
			}
			c.conn.Close()
			return nil, fmt.Errorf("IMAP login failed: %s", errMsg)
		}
		return c, nil
	}
	return nil, fmt.Errorf("nie można połączyć z Dovecot IMAP (porty 143/993): %v", lastErr)
}

// imapQuote tworzy quoted string zgodny z RFC 3501
func imapQuote(s string) string {
	needsQuote := false
	for _, ch := range s {
		if ch == 32 || ch == 34 || ch == 92 || ch == 13 || ch == 10 || ch > 126 {
			needsQuote = true
			break
		}
	}
	if !needsQuote {
		return s
	}
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return "\"" + s + "\""
}

func (s *Server) handleWebmailLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Email == "" || req.Password == "" {
		jsonErr(w, "email and password required", 400)
		return
	}

	c, err := connectIMAP(req.Email, req.Password)
	if err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer c.close()

	// Pobierz quota jeśli dostępne
	var quotaUsed, quotaMax int64
	if lines, err := c.cmd("GETQUOTAROOT INBOX"); err == nil && c.ok(lines) {
		for _, line := range lines {
			if strings.HasPrefix(line, "* QUOTA") {
				fmt.Sscanf(line[strings.Index(line, "STORAGE"):], "STORAGE %d %d", &quotaUsed, &quotaMax)
			}
		}
	}

	name := strings.Split(req.Email, "@")[0]
	result := map[string]any{
		"ok":   true,
		"name": name,
	}
	if quotaMax > 0 {
		result["quota"] = map[string]int64{
			"used": quotaUsed * 1024,
			"max":  quotaMax * 1024,
		}
	}
	jsonOK(w, result)
}

func (s *Server) handleWebmailMessages(w http.ResponseWriter, r *http.Request) {
	email, password := getIMAPCreds(r)
	if email == "" {
		jsonErr(w, "missing credentials", 401)
		return
	}

	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "INBOX"
	}

	c, err := connectIMAP(email, password)
	if err != nil {
		jsonErr(w, err.Error(), 503)
		return
	}
	defer c.close()

	// SELECT folder — pobierz liczbę wiadomości
	selectLines, err := c.cmd("SELECT %q", folder)
	if err != nil || !c.ok(selectLines) {
		jsonOK(w, map[string]any{"messages": []any{}, "folder": folder})
		return
	}

	// Pobierz liczbę wiadomości z EXISTS
	totalMsgs := 0
	for _, line := range selectLines {
		if strings.Contains(line, " EXISTS") {
			fmt.Sscanf(line, "* %d EXISTS", &totalMsgs)
		}
	}

	if totalMsgs == 0 {
		jsonOK(w, map[string]any{"messages": []any{}, "folder": folder, "total": 0})
		return
	}

	// Pobierz ostatnie max 50 wiadomości
	start := 1
	if totalMsgs > 50 {
		start = totalMsgs - 49
	}
	seqRange := fmt.Sprintf("%d:%d", start, totalMsgs)

	// FETCH nagłówki
	fetchLines, err := c.cmd("FETCH %s (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])", seqRange)
	if err != nil {
		jsonOK(w, map[string]any{"messages": []any{}, "folder": folder})
		return
	}

	var msgs []WebmailMessage
	var cur *WebmailMessage

	for _, line := range fetchLines {
		// Nowa wiadomość: "* N FETCH (...)"
		if strings.HasPrefix(line, "* ") && strings.Contains(line, " FETCH ") {
			if cur != nil && cur.UID > 0 {
				msgs = append(msgs, *cur)
			}
			cur = &WebmailMessage{}
			// UID jest w nawiasach: (UID 12 FLAGS ...)
			if idx := strings.Index(line, "UID "); idx >= 0 {
				fmt.Sscanf(line[idx+4:], "%d", &cur.UID)
			}
			if strings.Contains(line, "\\Seen") {
				cur.Read = true
			}
			continue
		}
		if cur == nil {
			continue
		}

		// UID może być w osobnej linii odpowiedzi
		if cur.UID == 0 && strings.Contains(line, "UID ") {
			fmt.Sscanf(line[strings.Index(line, "UID ")+4:], "%d", &cur.UID)
		}

		lower := strings.ToLower(line)
		switch {
		case strings.HasPrefix(lower, "subject:"):
			cur.Subject = decodeHeader(strings.TrimSpace(line[8:]))
		case strings.HasPrefix(lower, "from:"):
			raw := strings.TrimSpace(line[5:])
			if addr, err := mail.ParseAddress(raw); err == nil {
				cur.From = addr.Address
				cur.FromName = addr.Name
			} else {
				cur.From = raw
			}
		case strings.HasPrefix(lower, "to:"):
			raw := strings.TrimSpace(line[3:])
			if addr, err := mail.ParseAddress(raw); err == nil {
				cur.To = addr.Address
			} else {
				cur.To = raw
			}
		case strings.HasPrefix(lower, "date:"):
			raw := strings.TrimSpace(line[5:])
			if t, err := mail.ParseDate(raw); err == nil {
				cur.Date = t.Format("2006-01-02 15:04")
			} else {
				cur.Date = raw
			}
		}
	}
	if cur != nil && cur.UID > 0 {
		msgs = append(msgs, *cur)
	}

	// Jeśli UID nie został sparsowany z nagłówka FETCH,
	// pobierz UID osobno przez FETCH seqRange (UID)
	if len(msgs) > 0 && msgs[0].UID == 0 {
		uidLines, err := c.cmd("FETCH %s (UID)", seqRange)
		if err == nil {
			uidMap := map[int]int{} // seq -> uid
			for _, line := range uidLines {
				var seq, uid int
				if strings.HasPrefix(line, "* ") && strings.Contains(line, "UID ") {
					fmt.Sscanf(line, "* %d FETCH (UID %d", &seq, &uid)
					if seq > 0 && uid > 0 {
						uidMap[seq-start] = uid
					}
				}
			}
			for i := range msgs {
				if uid, ok := uidMap[i]; ok {
					msgs[i].UID = uid
				} else {
					msgs[i].UID = start + i
				}
			}
		}
	}

	// Odwróć — najnowsze pierwsze
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	jsonOK(w, map[string]any{"messages": msgs, "folder": folder, "total": totalMsgs})
}

func (s *Server) handleWebmailMessage(w http.ResponseWriter, r *http.Request) {
	email, password := getIMAPCreds(r)
	if email == "" { jsonErr(w, "missing credentials", 401); return }

	folder := r.URL.Query().Get("folder")
	uidStr := r.URL.Query().Get("uid")
	var uid int
	fmt.Sscanf(uidStr, "%d", &uid)
	if uid == 0 { jsonErr(w, "uid required", 400); return }

	c, err := connectIMAP(email, password)
	if err != nil { jsonErr(w, err.Error(), 503); return }
	defer c.close()

	if _, err := c.cmd("SELECT %q", folder); err != nil {
		jsonErr(w, "cannot select folder", 500); return
	}

	// Oznacz jako przeczytane
	c.cmd("UID STORE %d +FLAGS (\\Seen)", uid)

	// Wyślij komendę FETCH bezpośrednio
	c.seq++
	tag := fmt.Sprintf("A%04d", c.seq)
	fmt.Fprintf(c.conn, "%s UID FETCH %d (RFC822)\r\n", tag, uid)

	// Czytaj odpowiedź szukając literału {N}
	var raw string
	for {
		line, err := c.readLine()
		if err != nil { break }

		// Sprawdź czy linia zawiera literał {N}
		if strings.Contains(line, "FETCH") && strings.Contains(line, "{") {
			// Wyciągnij rozmiar z {N}
			idx := strings.LastIndex(line, "{")
			if idx >= 0 {
				rest := line[idx+1:]
				closeIdx := strings.Index(rest, "}")
				if closeIdx > 0 {
					var size int
					if _, serr := fmt.Sscanf(rest[:closeIdx], "%d", &size); serr == nil && size > 0 {
						// Czytaj dokładnie size bajtów
						buf := make([]byte, size)
						if _, rerr := io.ReadFull(c.reader, buf); rerr == nil {
							raw = string(buf)
						}
						// Czytaj do tagu OK
						for {
							endLine, err := c.readLine()
							if err != nil || strings.HasPrefix(endLine, tag) { break }
						}
						break
					}
				}
			}
		}
		if strings.HasPrefix(line, tag) { break }
	}

	if raw == "" {
		jsonOK(w, map[string]any{"body": "(nie można pobrać treści)", "uid": uid})
		return
	}

	// Parsuj wiadomość RFC822
	msg, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		// Zwróć surowe dane
		jsonOK(w, map[string]any{"body": raw, "uid": uid})
		return
	}

	body := extractTextBody(msg)
	if body == "" { body = raw }
	jsonOK(w, map[string]any{"body": body, "uid": uid})
}


// readIMAPLiteral czyta odpowiedź IMAP z literałem {N}

func (s *Server) handleWebmailCounts(w http.ResponseWriter, r *http.Request) {
	email, password := getIMAPCreds(r)
	if email == "" {
		jsonErr(w, "missing credentials", 401)
		return
	}

	c, err := connectIMAP(email, password)
	if err != nil {
		jsonErr(w, err.Error(), 503)
		return
	}
	defer c.close()

	counts := map[string]int{}
	folders := []string{"INBOX", "Sent", "Drafts", "Junk", "Trash"}

	for _, f := range folders {
		lines, err := c.cmd("STATUS %q (UNSEEN)", f)
		if err != nil || !c.ok(lines) {
			continue
		}
		for _, line := range lines {
			if strings.HasPrefix(line, "* STATUS") {
				var unseen int
				if idx := strings.Index(line, "UNSEEN "); idx >= 0 {
					fmt.Sscanf(line[idx+7:], "%d", &unseen)
					counts[f] = unseen
				}
			}
		}
	}

	jsonOK(w, map[string]any{"counts": counts})
}

func (s *Server) handleWebmailSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		To       string `json:"to"`
		Subject  string `json:"subject"`
		Body     string `json:"body"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.To == "" || req.Subject == "" {
		jsonErr(w, "to and subject required", 400)
		return
	}

	// Wyślij przez sendmail (funkcja z notifications.go)
	if err := sendEmail(req.To, req.Subject, req.Body); err != nil {
		jsonOK(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOK(w, map[string]any{"ok": true})
}

func (s *Server) handleWebmailDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	email, password := getIMAPCreds(r)
	var req struct {
		Folder string `json:"folder"`
		UID    int    `json:"uid"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := connectIMAP(email, password)
	if err != nil {
		jsonErr(w, err.Error(), 503)
		return
	}
	defer c.close()

	c.cmd("SELECT %q", req.Folder)
	if req.Folder == "Trash" {
		// Trwałe usunięcie
		c.cmd("UID STORE %d +FLAGS (\\Deleted)", req.UID)
		c.cmd("EXPUNGE")
	} else {
		// Przenieś do Kosza
		c.cmd("UID COPY %d Trash", req.UID)
		c.cmd("UID STORE %d +FLAGS (\\Deleted)", req.UID)
		c.cmd("EXPUNGE")
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleWebmailMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", 405)
		return
	}
	email, password := getIMAPCreds(r)
	var req struct {
		Folder string `json:"folder"`
		UID    int    `json:"uid"`
		Dest   string `json:"dest"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := connectIMAP(email, password)
	if err != nil {
		jsonErr(w, err.Error(), 503)
		return
	}
	defer c.close()

	c.cmd("SELECT %q", req.Folder)
	c.cmd("UID COPY %d %q", req.UID, req.Dest)
	c.cmd("UID STORE %d +FLAGS (\\Deleted)", req.UID)
	c.cmd("EXPUNGE")
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleWebmailDiag(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{}

	// Sprawdź czy Dovecot działa
	result["dovecot_active"] = serviceActive("dovecot")

	// Sprawdź konfigurację auth
	authMech, _ := runCmd("doveconf", "-h", "auth_mechanisms")
	result["auth_mechanisms"] = strings.TrimSpace(authMech)

	passFile, _ := runCmd("doveconf", "-h", "passdb")
	result["passdb"] = strings.TrimSpace(passFile)

	ssl, _ := runCmd("doveconf", "-h", "ssl")
	result["ssl"] = strings.TrimSpace(ssl)

	protocols, _ := runCmd("doveconf", "-h", "protocols")
	result["protocols"] = strings.TrimSpace(protocols)

	// Sprawdź czy port 143 jest otwarty
	conn143, err := net.DialTimeout("tcp", "127.0.0.1:143", 3*time.Second)
	if err == nil {
		conn143.Close()
		result["port_143"] = true
	} else {
		result["port_143"] = false
		result["port_143_err"] = err.Error()
	}

	conn993, err := net.DialTimeout("tcp", "127.0.0.1:993", 3*time.Second)
	if err == nil {
		conn993.Close()
		result["port_993"] = true
	} else {
		result["port_993"] = false
	}

	// Sprawdź plik users
	usersData, err := os.ReadFile("/etc/dovecot/users")
	if err == nil {
		var addrs []string
		for _, line := range strings.Split(string(usersData), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") { continue }
			parts := strings.SplitN(line, ":", 2)
			if len(parts) > 0 { addrs = append(addrs, parts[0]) }
		}
		result["users_file_accounts"] = addrs
	} else {
		result["users_file_err"] = err.Error()
	}

	// Sprawdź mail_location
	mailLoc, _ := runCmd("doveconf", "-h", "mail_location")
	result["mail_location"] = strings.TrimSpace(mailLoc)

	jsonOK(w, result)
}

func (s *Server) handleWebmailDebug(w http.ResponseWriter, r *http.Request) {
	email, password := getIMAPCreds(r)
	if email == "" { jsonErr(w, "missing credentials", 401); return }

	c, err := connectIMAP(email, password)
	if err != nil { jsonErr(w, err.Error(), 503); return }
	defer c.close()

	c.cmd("SELECT INBOX")

	// Pobierz raw odpowiedź dla wiadomości 1
	c.seq++
	tag := fmt.Sprintf("A%04d", c.seq)
	fmt.Fprintf(c.conn, "%s UID FETCH 1 RFC822\r\n", tag)

	var allLines []string
	for i := 0; i < 50; i++ {
		line, err := c.readLine()
		if err != nil { break }
		allLines = append(allLines, line)
		if strings.HasPrefix(line, tag) { break }
	}

	jsonOK(w, map[string]any{"lines": allLines, "count": len(allLines)})
}
