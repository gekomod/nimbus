package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

const notifConfigPath = "/etc/nas-panel/notifications.json"

// ─── Typy ────────────────────────────────────────────────────────────────────

type NotifChannel struct {
	ID       string `json:"id"`
	Type     string `json:"type"`     // email | telegram | discord | slack | pushover | gotify | webhook
	Name     string `json:"name"`
	Target   string `json:"target"`   // główny adres / URL (dla typów single-field)

	// Telegram
	BotToken string `json:"bot_token,omitempty"`
	ChatID   string `json:"chat_id,omitempty"`

	// Pushover
	UserKey  string `json:"user_key,omitempty"`
	APIToken string `json:"api_token,omitempty"`

	// Gotify
	// Target = URL serwera, APIToken = token aplikacji

	Enabled  bool   `json:"enabled"`
	LastTest string `json:"lastTest"`
}

// displayTarget zwraca czytelny opis dla UI
func (ch NotifChannel) displayTarget() string {
	switch ch.Type {
	case "telegram":
		if ch.ChatID != "" {
			return "chat: " + ch.ChatID
		}
		return ch.Target
	case "pushover":
		return "user: " + ch.UserKey
	case "gotify":
		return ch.Target
	default:
		return ch.Target
	}
}

type NotifRule struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Condition string   `json:"condition"`
	Severity  string   `json:"severity"` // info | warn | crit
	Channels  []string `json:"channels"`
	Enabled   bool     `json:"enabled"`
	Triggered string   `json:"triggered"`
}

type NotifHistoryEntry struct {
	T         string `json:"t"`
	Sev       string `json:"sev"`
	Rule      string `json:"rule"`
	Ch        string `json:"ch"`
	Msg       string `json:"msg"`
	Delivered bool   `json:"delivered"`
}

type NotifConfig struct {
	Channels []NotifChannel      `json:"channels"`
	Rules    []NotifRule         `json:"rules"`
	History  []NotifHistoryEntry `json:"history"`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func loadNotifConfig() NotifConfig {
	cfg := NotifConfig{
		Channels: []NotifChannel{},
		Rules:    []NotifRule{},
		History:  []NotifHistoryEntry{},
	}
	b, err := os.ReadFile(notifConfigPath)
	if err != nil {
		return cfg
	}
	json.Unmarshal(b, &cfg)
	if cfg.Channels == nil {
		cfg.Channels = []NotifChannel{}
	}
	if cfg.Rules == nil {
		cfg.Rules = []NotifRule{}
	}
	if cfg.History == nil {
		cfg.History = []NotifHistoryEntry{}
	}
	return cfg
}

func saveNotifConfig(cfg NotifConfig) error {
	if err := os.MkdirAll("/etc/nas-panel", 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(notifConfigPath, b, 0644)
}

// ─── Channels ────────────────────────────────────────────────────────────────


// sendEmail wysyła e-mail przez dostępne narzędzie:
// 1. sendmail (Postfix), 2. mail/mailx (mailutils), 3. SMTP przez curl
func sendEmail(to, subject, body string) error {
	// Buduj wiadomość RFC 2822 z poprawnym From
	from := resolvePostfixFrom()
	msg := fmt.Sprintf(
		"From: NimbusNAS <%s>\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n",
		from, to, subject, body,
	)

	// Metoda 1: sendmail (Postfix) - -v żeby dostać verbose output
	for _, bin := range []string{"/usr/sbin/sendmail", "/usr/lib/sendmail", "/usr/bin/sendmail"} {
		if _, err := os.Stat(bin); err == nil {
			cmd := exec.Command(bin, "-t", "-oi", "-v")
			cmd.Stdin = strings.NewReader(msg)
			out, err := cmd.CombinedOutput()
			outStr := strings.TrimSpace(string(out))
			// sendmail zwraca 0 nawet gdy wiadomość trafia do kolejki
			// Sprawdź czy nie ma błędu konfiguracji
			if err != nil {
				return fmt.Errorf("sendmail: %s", outStr)
			}
			// Sprawdź znane błędy w output
			if strings.Contains(outStr, "relay access denied") ||
				strings.Contains(outStr, "Connection refused") ||
				strings.Contains(outStr, "not a valid RFC") {
				return fmt.Errorf("postfix error: %s", outStr)
			}
			return nil
		}
	}

	// Metoda 2: mail / mailx
	for _, bin := range []string{"/usr/bin/mail", "/usr/bin/mailx", "/bin/mail"} {
		if _, err := os.Stat(bin); err == nil {
			cmd := exec.Command(bin, "-s", subject, "-r", from, to)
			cmd.Stdin = strings.NewReader(body)
			if out, err := cmd.CombinedOutput(); err == nil {
				return nil
			} else {
				return fmt.Errorf("mail: %s", strings.TrimSpace(string(out)))
			}
		}
	}

	return fmt.Errorf("brak sendmail/mailutils — sprawdź czy Postfix jest zainstalowany")
}

// resolvePostfixFrom — pobiera prawidłowy adres nadawcy z konfiguracji Postfix
func resolvePostfixFrom() string {
	// Spróbuj pobrać myorigin z postconf
	if out, err := exec.Command("postconf", "-h", "myorigin").Output(); err == nil {
		origin := strings.TrimSpace(string(out))
		// Ignoruj zmienne niezastąpione ($myhostname itp.)
		if origin != "" && !strings.HasPrefix(origin, "$") && strings.Contains(origin, ".") {
			return "nimbus@" + origin
		}
	}
	// Fallback: hostname systemu
	if out, err := exec.Command("hostname", "-f").Output(); err == nil {
		h := strings.TrimSpace(string(out))
		if strings.Contains(h, ".") {
			return "nimbus@" + h
		}
	}
	return "nimbus@localhost"
}

func (s *Server) handleNotifChannels(w http.ResponseWriter, r *http.Request) {
	cfg := loadNotifConfig()
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, cfg.Channels)

	case http.MethodPost:
		var ch NotifChannel
		if err := json.NewDecoder(r.Body).Decode(&ch); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest)
			return
		}
		if ch.ID == "" {
			ch.ID = "ch-" + strings.ReplaceAll(time.Now().Format("20060102150405.000"), ".", "")
		}
		if ch.LastTest == "" {
			ch.LastTest = "—"
		}
		cfg.Channels = append(cfg.Channels, ch)
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, ch)

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNotifChannelItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/notifications/channels/")

	if strings.HasSuffix(suffix, "/test") {
		s.handleNotifChannelTest(w, r)
		return
	}

	id := strings.TrimSuffix(suffix, "/")
	if id == "" {
		jsonErr(w, "id required", http.StatusBadRequest)
		return
	}
	cfg := loadNotifConfig()

	switch r.Method {
	case http.MethodGet:
		for _, ch := range cfg.Channels {
			if ch.ID == id {
				jsonOK(w, ch)
				return
			}
		}
		jsonErr(w, "not found", http.StatusNotFound)

	case http.MethodPut:
		var upd NotifChannel
		if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest)
			return
		}
		upd.ID = id
		found := false
		for i, ch := range cfg.Channels {
			if ch.ID == id {
				cfg.Channels[i] = upd
				found = true
				break
			}
		}
		if !found {
			jsonErr(w, "not found", http.StatusNotFound)
			return
		}
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, upd)

	case http.MethodDelete:
		newList := cfg.Channels[:0]
		for _, ch := range cfg.Channels {
			if ch.ID != id {
				newList = append(newList, ch)
			}
		}
		cfg.Channels = newList
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ─── Test channel ─────────────────────────────────────────────────────────────

func (s *Server) handleNotifChannelTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	suffix := pathSuffix(r, "/api/notifications/channels/")
	id := strings.TrimSuffix(suffix, "/test")

	cfg := loadNotifConfig()
	now := time.Now().Format("15:04")

	for i, ch := range cfg.Channels {
		if ch.ID != id {
			continue
		}

		ok, errMsg := testNotifChannel(ch)

		if ok {
			cfg.Channels[i].LastTest = "OK · " + now
		} else {
			cfg.Channels[i].LastTest = "FAIL · " + now
		}
		saveNotifConfig(cfg)
		jsonOK(w, map[string]any{
			"ok":       ok,
			"lastTest": cfg.Channels[i].LastTest,
			"error":    errMsg,
		})
		return
	}
	jsonErr(w, "channel not found", http.StatusNotFound)
}

// min helper (Go < 1.21 compatibility)
func min(a, b int) int {
	if a < b { return a }
	return b
}

// testNotifChannel wysyła wiadomość testową dla danego kanału
func testNotifChannel(ch NotifChannel) (bool, string) {
	msg := fmt.Sprintf("[NimbusNAS] Test powiadomienia — kanał: %s", ch.Name)

	switch ch.Type {

	case "email":
		if err := sendEmail(ch.Target, "[NimbusNAS] Test powiadomienia", msg); err != nil {
			return false, err.Error()
		}
		return true, ""

	case "telegram":
		token := strings.TrimSpace(ch.BotToken)
		chatID := strings.TrimSpace(ch.ChatID)
		if token == "" {
			return false, "Brakuje tokenu bota. Utwórz bota przez @BotFather i skopiuj token."
		}
		if chatID == "" {
			return false, "Brakuje Chat ID. Wyślij /start do bota, potem sprawdź: api.telegram.org/bot" + token[:min(len(token), 20)] + ".../getUpdates"
		}
		// Najpierw sprawdź czy token jest prawidłowy (getMe)
		checkURL := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", token)
		checkOut, checkErr := runCmd("curl", "-sf", "--max-time", "8", checkURL)
		if checkErr != nil || !strings.Contains(checkOut, `"ok":true`) {
			return false, "Nieprawidłowy token bota. Odpowiedź Telegrama: " + checkOut
		}
		// Wyślij wiadomość testową
		sendURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)
		// Użyj json.Marshal dla bezpiecznego escapowania
		type tgPayload struct {
			ChatID    string `json:"chat_id"`
			Text      string `json:"text"`
			ParseMode string `json:"parse_mode"`
		}
		payloadBytes, _ := json.Marshal(tgPayload{
			ChatID:    chatID,
			Text:      "✅ <b>NimbusNAS</b> — test powiadomień dla kanału: " + ch.Name,
			ParseMode: "HTML",
		})
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", string(payloadBytes),
			"--max-time", "8",
			sendURL)
		if err != nil {
			return false, "Błąd curl: " + out
		}
		if !strings.Contains(out, `"ok":true`) {
			// Wyciągnij czytelny opis błędu z JSON Telegrama
			desc := out
			if strings.Contains(out, `"description"`) {
				var errResp struct { Description string `json:"description"` }
				if json.Unmarshal([]byte(out), &errResp) == nil && errResp.Description != "" {
					desc = errResp.Description
				}
			}
			return false, "Telegram API: " + desc
		}
		return true, ""

	case "discord":
		if ch.Target == "" {
			return false, "Brakuje Webhook URL"
		}
		body := fmt.Sprintf(`{"content":"%s"}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body,
			"--max-time", "8",
			ch.Target)
		if err != nil {
			return false, "curl error: " + out
		}
		return true, ""

	case "slack":
		if ch.Target == "" {
			return false, "Brakuje Webhook URL"
		}
		body := fmt.Sprintf(`{"text":"%s"}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body,
			"--max-time", "8",
			ch.Target)
		if err != nil {
			return false, "curl error: " + out
		}
		return true, ""

	case "pushover":
		if ch.UserKey == "" || ch.APIToken == "" {
			return false, "Brakuje UserKey lub API Token"
		}
		body := fmt.Sprintf(
			`token=%s&user=%s&message=%s&title=NimbusNAS+Test`,
			ch.APIToken, ch.UserKey, strings.ReplaceAll(msg, " ", "+"),
		)
		out, err := runCmd("curl", "-sf",
			"-d", body,
			"--max-time", "8",
			"https://api.pushover.net/1/messages.json")
		if err != nil {
			return false, "curl error: " + out
		}
		if !strings.Contains(out, `"status":1`) {
			return false, "Pushover error: " + out
		}
		return true, ""

	case "gotify":
		if ch.Target == "" || ch.APIToken == "" {
			return false, "Brakuje URL serwera lub API Token"
		}
		url := strings.TrimRight(ch.Target, "/") + "/message?token=" + ch.APIToken
		body := fmt.Sprintf(`{"title":"NimbusNAS Test","message":"%s","priority":5}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body,
			"--max-time", "8",
			url)
		if err != nil {
			return false, "curl error: " + out
		}
		return true, ""

	case "webhook":
		if ch.Target == "" {
			return false, "Brakuje URL webhooka"
		}
		body := fmt.Sprintf(
			`{"event":"test","source":"NimbusNAS","channel":"%s","message":"%s","ts":"%s"}`,
			ch.Name, msg, time.Now().Format(time.RFC3339),
		)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body,
			"--max-time", "8",
			ch.Target)
		if err != nil {
			return false, "curl error: " + out
		}
		return true, ""

	default:
		return false, "Nieznany typ kanału: " + ch.Type
	}
}

// ─── Rules ───────────────────────────────────────────────────────────────────

func (s *Server) handleNotifRules(w http.ResponseWriter, r *http.Request) {
	cfg := loadNotifConfig()
	switch r.Method {
	case http.MethodGet:
		jsonOK(w, cfg.Rules)

	case http.MethodPost:
		var ru NotifRule
		if err := json.NewDecoder(r.Body).Decode(&ru); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest)
			return
		}
		if ru.ID == "" {
			ru.ID = "r-" + strings.ReplaceAll(time.Now().Format("20060102150405.000"), ".", "")
		}
		if ru.Triggered == "" {
			ru.Triggered = "nigdy"
		}
		if ru.Channels == nil {
			ru.Channels = []string{}
		}
		cfg.Rules = append(cfg.Rules, ru)
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, ru)

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNotifRuleItem(w http.ResponseWriter, r *http.Request) {
	id := pathSuffix(r, "/api/notifications/rules/")
	if id == "" {
		jsonErr(w, "id required", http.StatusBadRequest)
		return
	}
	cfg := loadNotifConfig()

	switch r.Method {
	case http.MethodPut:
		var upd NotifRule
		if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
			jsonErr(w, "bad request", http.StatusBadRequest)
			return
		}
		upd.ID = id
		if upd.Channels == nil {
			upd.Channels = []string{}
		}
		found := false
		for i, ru := range cfg.Rules {
			if ru.ID == id {
				cfg.Rules[i] = upd
				found = true
				break
			}
		}
		if !found {
			jsonErr(w, "not found", http.StatusNotFound)
			return
		}
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, upd)

	case http.MethodDelete:
		newList := cfg.Rules[:0]
		for _, ru := range cfg.Rules {
			if ru.ID != id {
				newList = append(newList, ru)
			}
		}
		cfg.Rules = newList
		if err := saveNotifConfig(cfg); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ─── History ─────────────────────────────────────────────────────────────────

func (s *Server) handleNotifHistory(w http.ResponseWriter, r *http.Request) {
	cfg := loadNotifConfig()
	jsonOK(w, cfg.History)
}

// ── Funkcje dla alert engine ──────────────────────────────────────────────────

// notifGetConfig zwraca aktualną konfigurację (używane przez alert engine).
func notifGetConfig() NotifConfig {
	return loadNotifConfig()
}

// notifSendToChannel wysyła powiadomienie do konkretnego kanału po ID.
func notifSendToChannel(channelID, title, msg, severity string) bool {
	cfg := loadNotifConfig()
	for _, ch := range cfg.Channels {
		if ch.ID != channelID { continue }
		if !ch.Enabled { return false }

		// Zbuduj wiadomość z severity prefix
		icon := "ℹ️"
		switch severity {
		case "warn": icon = "⚠️"
		case "crit": icon = "🔴"
		}
		fullMsg := fmt.Sprintf("%s %s\n%s", icon, title, msg)

		// Użyj istniejącego mechanizmu testowania — wyślij prawdziwą wiadomość
		chCopy := ch
		chCopy.Name = title // Nadpisz nazwę tytułem alertu
		ok, _ := sendNotifChannel(chCopy, fullMsg)
		return ok
	}
	return false
}

// sendNotifChannel — prawdziwe wysyłanie (wyodrębnione z testNotifChannel).
func sendNotifChannel(ch NotifChannel, msg string) (bool, string) {
	switch ch.Type {
	case "telegram":
		token  := strings.TrimSpace(ch.BotToken)
		chatID := strings.TrimSpace(ch.ChatID)
		if token == "" || chatID == "" { return false, "brak tokenu lub chat_id" }
		sendURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)
		type tgPayload struct {
			ChatID    string `json:"chat_id"`
			Text      string `json:"text"`
			ParseMode string `json:"parse_mode"`
		}
		payloadBytes, _ := json.Marshal(tgPayload{ChatID: chatID, Text: msg, ParseMode: "HTML"})
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", string(payloadBytes), "--max-time", "10", sendURL)
		if err != nil || !strings.Contains(out, `"ok":true`) { return false, out }
		return true, ""

	case "discord":
		if ch.Target == "" { return false, "brak webhook URL" }
		body := fmt.Sprintf(`{"content":%q}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body, "--max-time", "10", ch.Target)
		return err == nil, out

	case "slack":
		if ch.Target == "" { return false, "brak webhook URL" }
		body := fmt.Sprintf(`{"text":%q}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body, "--max-time", "10", ch.Target)
		return err == nil, out

	case "email":
		err := sendEmail(ch.Target, "[NimbusNAS] "+ch.Name, msg)
		if err != nil {
			return false, err.Error()
		}
		return true, ""

	case "pushover":
		if ch.UserKey == "" || ch.APIToken == "" { return false, "brak kluczy" }
		body := fmt.Sprintf(`token=%s&user=%s&message=%s&title=NimbusNAS`,
			ch.APIToken, ch.UserKey, strings.ReplaceAll(msg, " ", "+"))
		out, err := runCmd("curl", "-sf", "-d", body, "--max-time", "10",
			"https://api.pushover.net/1/messages.json")
		return err == nil && strings.Contains(out, `"status":1`), out

	case "gotify":
		if ch.Target == "" || ch.APIToken == "" { return false, "brak konfiguracji" }
		url  := strings.TrimRight(ch.Target, "/") + "/message?token=" + ch.APIToken
		body := fmt.Sprintf(`{"title":"NimbusNAS Alert","message":%q,"priority":8}`, msg)
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body, "--max-time", "10", url)
		return err == nil, out

	case "webhook":
		if ch.Target == "" { return false, "brak URL" }
		body := fmt.Sprintf(`{"source":"NimbusNAS","message":%q,"ts":%q}`,
			msg, time.Now().Format(time.RFC3339))
		out, err := runCmd("curl", "-sf", "-X", "POST",
			"-H", "Content-Type: application/json",
			"-d", body, "--max-time", "10", ch.Target)
		return err == nil, out
	}
	return false, "nieznany typ"
}

// notifAddHistory dodaje wpis do historii powiadomień.
func notifAddHistory(rule, sev, msg, ch string, delivered bool) {
	cfg := loadNotifConfig()
	entry := NotifHistoryEntry{
		T:         time.Now().Format(time.RFC3339),
		Sev:       sev,
		Rule:      rule,
		Ch:        ch,
		Msg:       msg,
		Delivered: delivered,
	}
	cfg.History = append([]NotifHistoryEntry{entry}, cfg.History...)
	// Ogranicz historię do 200 wpisów
	if len(cfg.History) > 200 { cfg.History = cfg.History[:200] }
	saveNotifConfig(cfg)
}

// handleNotifFire — endpoint POST /api/notifications/fire (dla startup.go)
func (s *Server) handleNotifFire(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct {
		Title    string `json:"title"`
		Message  string `json:"message"`
		Severity string `json:"severity"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Title == "" { jsonErr(w, "title required", http.StatusBadRequest); return }
	if req.Severity == "" { req.Severity = "info" }

	cfg := loadNotifConfig()
	sent := 0
	for _, ch := range cfg.Channels {
		if !ch.Enabled { continue }
		if ok, _ := sendNotifChannel(ch, req.Title+"\n"+req.Message); ok { sent++ }
	}
	notifAddHistory(req.Title, req.Severity, req.Message, "api", sent > 0)
	jsonOK(w, map[string]any{"status": "ok", "sent": sent})
}

// handleNotifDefaultRules — POST /api/notifications/default-rules
func (s *Server) handleNotifDefaultRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	cfg := loadNotifConfig()
	// Dodaj tylko te których jeszcze nie ma
	existing := map[string]bool{}
	for _, ru := range cfg.Rules { existing[ru.ID] = true }
	added := 0
	for _, ru := range DefaultAlertRules() {
		if !existing[ru.ID] {
			cfg.Rules = append(cfg.Rules, ru)
			added++
		}
	}
	saveNotifConfig(cfg)
	jsonOK(w, map[string]any{"status": "ok", "added": added})
}

// notifUpdateRuleTriggered aktualizuje pole Triggered dla reguły po wysłaniu alertu.
func notifUpdateRuleTriggered(ruleID, timestamp string) {
	cfg := loadNotifConfig()
	changed := false
	for i, ru := range cfg.Rules {
		if ru.ID == ruleID {
			cfg.Rules[i].Triggered = timestamp
			changed = true
			break
		}
	}
	if changed {
		saveNotifConfig(cfg)
	}
}
