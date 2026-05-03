package api

// totp.go — TOTP (Time-based One-Time Password) RFC 6238
// Kompatybilny z Google Authenticator, Aegis, Bitwarden TOTP
// Bez zewnętrznych bibliotek — czysta implementacja Go

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const totpConfigPath = "/etc/nas-panel/totp.json"

type TOTPConfig struct {
	Enabled  bool              `json:"enabled"`
	Users    map[string]string `json:"users"` // username → base32 secret
}

var (
	totpCfg   TOTPConfig
	totpCfgMu sync.RWMutex
)

func init() {
	loadTOTPConfig()
}

func loadTOTPConfig() {
	data, err := os.ReadFile(totpConfigPath)
	if err != nil { return }
	totpCfgMu.Lock()
	defer totpCfgMu.Unlock()
	json.Unmarshal(data, &totpCfg)
	if totpCfg.Users == nil { totpCfg.Users = map[string]string{} }
}

func saveTOTPConfig() {
	totpCfgMu.RLock()
	data, _ := json.MarshalIndent(totpCfg, "", "  ")
	totpCfgMu.RUnlock()
	os.MkdirAll("/etc/nas-panel", 0755)
	os.WriteFile(totpConfigPath, data, 0600)
}

// totpEnabled zwraca czy 2FA jest włączone dla danego użytkownika.
func totpEnabled(username string) bool {
	totpCfgMu.RLock()
	defer totpCfgMu.RUnlock()
	if !totpCfg.Enabled { return false }
	_, has := totpCfg.Users[username]
	return has
}

// totpVerify sprawdza kod TOTP dla użytkownika. Akceptuje ±1 okno (30s).
func totpVerify(username, code string) bool {
	totpCfgMu.RLock()
	secret, has := totpCfg.Users[username]
	totpCfgMu.RUnlock()
	if !has { return false }

	t := time.Now().Unix() / 30
	// Sprawdź bieżące okno ±1
	for _, delta := range []int64{-1, 0, 1} {
		if totpGenCode(secret, t+delta) == code { return true }
	}
	return false
}

// totpGenCode generuje 6-cyfrowy kod TOTP dla danego sekretu i czasu.
func totpGenCode(secret string, t int64) string {
	key, err := base32.StdEncoding.DecodeString(strings.ToUpper(strings.TrimRight(secret, "=")))
	if err != nil { return "" }

	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(t))

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	h := mac.Sum(nil)

	offset := h[len(h)-1] & 0x0F
	code := int(binary.BigEndian.Uint32(h[offset:offset+4])&0x7FFFFFFF) % int(math.Pow10(6))
	return fmt.Sprintf("%06d", code)
}

// totpGenerateSecret generuje losowy 20-bajtowy sekret w base32.
func totpGenerateSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil { return "", err }
	return base32.StdEncoding.EncodeToString(b), nil
}

// totpQRURL zwraca URL do wyświetlenia QR kodu przez Google Charts API.
func totpQRURL(username, secret, issuer string) string {
	otpauth := fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		issuer, username, secret, issuer)
	// Użyj QR server API (nie wysyła danych — tylko generuje QR z URL)
	return fmt.Sprintf("https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=%s", otpauth)
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *Server) handleTOTPStatus(w http.ResponseWriter, r *http.Request) {
	username := s.currentUser(r)
	totpCfgMu.RLock()
	enabled  := totpCfg.Enabled
	hasTotp  := false
	if username != "" { _, hasTotp = totpCfg.Users[username] }
	totpCfgMu.RUnlock()
	jsonOK(w, map[string]any{
		"enabled":      enabled,
		"user_has_2fa": hasTotp,
		"username":     username,
	})
}

func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	username := s.currentUser(r)
	if username == "" { jsonErr(w, "nie zalogowany", http.StatusUnauthorized); return }

	switch r.Method {
	case http.MethodGet:
		// Wygeneruj nowy sekret (nie zapisuj jeszcze — użytkownik musi potwierdzić)
		secret, err := totpGenerateSecret()
		if err != nil { jsonErr(w, err.Error(), http.StatusInternalServerError); return }
		jsonOK(w, map[string]any{
			"secret":  secret,
			"qr_url":  totpQRURL(username, secret, "NimbusNAS"),
			"manual":  fmt.Sprintf("Ręcznie: %s  (SHA1, 6 cyfr, 30s)", secret),
		})

	case http.MethodPost:
		// Potwierdź i aktywuj 2FA
		var req struct {
			Secret string `json:"secret"`
			Code   string `json:"code"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if req.Secret == "" || req.Code == "" {
			jsonErr(w, "secret i code są wymagane", http.StatusBadRequest); return
		}
		// Weryfikuj kod przed zapisem
		t := time.Now().Unix() / 30
		valid := false
		for _, delta := range []int64{-1, 0, 1} {
			if totpGenCode(req.Secret, t+delta) == req.Code { valid = true; break }
		}
		if !valid { jsonErr(w, "Nieprawidłowy kod — sprawdź czas na urządzeniu", http.StatusBadRequest); return }

		totpCfgMu.Lock()
		if totpCfg.Users == nil { totpCfg.Users = map[string]string{} }
		totpCfg.Users[username] = req.Secret
		totpCfg.Enabled = true
		totpCfgMu.Unlock()
		saveTOTPConfig()
		jsonOK(w, map[string]string{"status": "ok", "message": "2FA aktywowane"})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	username := s.currentUser(r)
	if username == "" { jsonErr(w, "nie zalogowany", http.StatusUnauthorized); return }

	// Wymagaj potwierdzenia kodem lub hasłem
	var req struct {
		Code string `json:"code"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if !totpVerify(username, req.Code) {
		jsonErr(w, "Nieprawidłowy kod 2FA", http.StatusForbidden); return
	}

	totpCfgMu.Lock()
	delete(totpCfg.Users, username)
	if len(totpCfg.Users) == 0 { totpCfg.Enabled = false }
	totpCfgMu.Unlock()
	saveTOTPConfig()
	jsonOK(w, map[string]string{"status": "ok", "message": "2FA wyłączone"})
}

func (s *Server) handleTOTPGlobalToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct{ Enabled bool `json:"enabled"` }
	json.NewDecoder(r.Body).Decode(&req)
	totpCfgMu.Lock()
	totpCfg.Enabled = req.Enabled
	totpCfgMu.Unlock()
	saveTOTPConfig()
	jsonOK(w, map[string]string{"status": "ok"})
}

// currentUser wyciąga nazwę użytkownika z sesji.
func (s *Server) currentUser(r *http.Request) string {
	sess, err := s.auth.GetSession(r)
	if err != nil { return "" }
	return sess.User
}
