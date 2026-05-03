package auth

/*
#cgo LDFLAGS: -lpam
#include <security/pam_appl.h>
#include <stdlib.h>
#include <string.h>

// Konwersacja PAM: przekazuje hasło jako odpowiedź na każde pytanie powłoki.
static int pam_conv_func(int num_msg, const struct pam_message **msg,
                          struct pam_response **resp, void *appdata_ptr) {
	const char *password = (const char *)appdata_ptr;
	*resp = (struct pam_response *)calloc(num_msg, sizeof(struct pam_response));
	if (!*resp) return PAM_BUF_ERR;
	for (int i = 0; i < num_msg; i++) {
		if (msg[i]->msg_style == PAM_PROMPT_ECHO_OFF ||
		    msg[i]->msg_style == PAM_PROMPT_ECHO_ON) {
			(*resp)[i].resp = strdup(password);
		}
	}
	return PAM_SUCCESS;
}

// authenticate_pam: zwraca 0 (PAM_SUCCESS) przy sukcesie.
static int authenticate_pam(const char *service, const char *username, const char *password) {
	struct pam_conv conv = { pam_conv_func, (void *)password };
	pam_handle_t *pamh = NULL;
	int ret;

	ret = pam_start(service, username, &conv, &pamh);
	if (ret != PAM_SUCCESS) return ret;

	ret = pam_authenticate(pamh, PAM_SILENT);
	if (ret == PAM_SUCCESS) {
		// Sprawdź czy konto nie wygasło / nie jest zablokowane
		ret = pam_acct_mgmt(pamh, PAM_SILENT);
	}

	pam_end(pamh, ret);
	return ret;
}
*/
import "C"

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"
)

const (
	sessionTTL = 24 * time.Hour
	pamService  = "login" // /etc/pam.d/login — lub "sshd", "su"
)

// ─── PAM ─────────────────────────────────────────────────────────────────────

// pamAuthenticate wywołuje pam_authenticate() przez cgo.
// Zwraca nil jeśli autentykacja powiodła się.
func pamAuthenticate(username, password string) error {
	cSvc  := C.CString(pamService)
	cUser := C.CString(username)
	cPass := C.CString(password)
	defer func() {
		C.free(unsafe.Pointer(cSvc))
		C.free(unsafe.Pointer(cUser))
		C.free(unsafe.Pointer(cPass))
	}()

	if ret := C.authenticate_pam(cSvc, cUser, cPass); ret != 0 {
		return errors.New("pam: authentication failed")
	}
	return nil
}

// ─── Typy ─────────────────────────────────────────────────────────────────────

// UserInfo — identycznie jak stary Node.js /api/login response
type UserInfo struct {
	Username string   `json:"username"`
	UID      int      `json:"uid"`
	Groups   []string `json:"groups"`
}

type session struct {
	token    string
	username string
	expires  time.Time
}

// ─── Manager ─────────────────────────────────────────────────────────────────

// Manager obsługuje dwa tryby logowania:
//  1. PAM (domyślny) — każdy użytkownik systemu Linux może się zalogować
//     przez /etc/shadow, LDAP, AD lub cokolwiek co PAM obsługuje.
//  2. Fallback — jeśli PAM zawiedzie i username == fallbackUser,
//     sprawdza sha256 hasła podanego przez --pass flag.
//     Przydatne gdy serwer startuje bez dostępu do /etc/shadow (np. w kontenerze)
//     lub do testów lokalnych.
type Manager struct {
	mu           sync.Mutex
	fallbackUser string
	fallbackHash string // sha256(fallbackPassword)
	sessions     map[string]session
	sessionFile  string // ścieżka do pliku persystencji
}

// NewManager tworzy Manager z persystencją sesji w /var/lib/nimbus/sessions.json
// lub ~/.nimbus/sessions.json jeśli /var/lib/nimbus nie jest dostępny.
func NewManager(fallbackUser, fallbackPassword string) *Manager {
	m := &Manager{
		fallbackUser: fallbackUser,
		fallbackHash: sha256hex(fallbackPassword),
		sessions:     make(map[string]session),
		sessionFile:  findSessionFile(),
	}
	m.loadSessions()
	go m.cleaner()
	return m
}

func findSessionFile() string {
	// Preferuj /var/lib/nimbus (produkcja)
	dir := "/var/lib/nimbus"
	if err := os.MkdirAll(dir, 0700); err == nil {
		return filepath.Join(dir, "sessions.json")
	}
	// Fallback: katalog domowy
	home, _ := os.UserHomeDir()
	if home == "" { home = "/root" }
	dir = filepath.Join(home, ".nimbus")
	os.MkdirAll(dir, 0700)
	return filepath.Join(dir, "sessions.json")
}

// sessionDisk — format persystencji (nie trzymamy hasła, tylko token + expiry)
type sessionDisk struct {
	Token    string    `json:"token"`
	Username string    `json:"username"`
	Expires  time.Time `json:"expires"`
}

func (m *Manager) loadSessions() {
	data, err := os.ReadFile(m.sessionFile)
	if err != nil {
		return // plik nie istnieje — OK przy pierwszym uruchomieniu
	}
	var list []sessionDisk
	if err := json.Unmarshal(data, &list); err != nil {
		return
	}
	now := time.Now()
	for _, s := range list {
		if now.Before(s.Expires) { // pomiń wygasłe
			m.sessions[s.Token] = session{
				token:    s.Token,
				username: s.Username,
				expires:  s.Expires,
			}
		}
	}
}

func (m *Manager) saveSessions() {
	list := make([]sessionDisk, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, sessionDisk{Token: s.token, Username: s.username, Expires: s.expires})
	}
	data, err := json.Marshal(list)
	if err != nil { return }
	os.WriteFile(m.sessionFile, data, 0600)
}

// Login próbuje PAM. Jeśli PAM zawiedzie i podane dane pasują do
// lokalnego konta fallback (--user/--pass), loguje przez fallback.
// Zwraca: token sesji, UserInfo, error.
func (m *Manager) Login(username, password string) (string, UserInfo, error) {
	pamErr := pamAuthenticate(username, password)

	if pamErr != nil {
		// Fallback: lokalny admin skonfigurowany przez --user/--pass
		if username == m.fallbackUser && sha256hex(password) == m.fallbackHash {
			pamErr = nil
		} else {
			return "", UserInfo{}, errors.New("invalid credentials")
		}
	}

	// Pobierz uid i grupy z systemu operacyjnego
	info := UserInfo{
		Username: username,
		UID:      resolveUID(username),
		Groups:   resolveGroups(username),
	}

	token, err := genToken()
	if err != nil {
		return "", UserInfo{}, err
	}

	m.mu.Lock()
	m.sessions[token] = session{
		token:    token,
		username: username,
		expires:  time.Now().Add(sessionTTL),
	}
	m.saveSessions()
	m.mu.Unlock()

	return token, info, nil
}

func (m *Manager) Valid(token string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(s.expires) {
		delete(m.sessions, token)
		return false
	}
	return true
}

// SessionUser zwraca nazwę użytkownika powiązaną z tokenem (lub "").
func (m *Manager) SessionUser(token string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[token].username
}

func (m *Manager) Logout(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.saveSessions()
	m.mu.Unlock()
}

func (m *Manager) cleaner() {
	for range time.Tick(30 * time.Minute) {
		m.mu.Lock()
		now := time.Now()
		changed := false
		for k, s := range m.sessions {
			if now.After(s.expires) {
				delete(m.sessions, k)
				changed = true
			}
		}
		if changed { m.saveSessions() }
		m.mu.Unlock()
	}
}

// ─── Helpery systemowe ────────────────────────────────────────────────────────

// resolveUID odpowiada `id -u <username>`
func resolveUID(username string) int {
	out, err := exec.Command("id", "-u", username).Output()
	if err != nil {
		return -1
	}
	n := 0
	for _, c := range strings.TrimSpace(string(out)) {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

// resolveGroups odpowiada `groups <username>`, parsuje "user : g1 g2 g3"
func resolveGroups(username string) []string {
	out, err := exec.Command("groups", username).Output()
	if err != nil {
		return []string{}
	}
	line := strings.TrimSpace(string(out))
	// format: "username : group1 group2 ..." lub samo "group1 group2 ..."
	if idx := strings.Index(line, ":"); idx >= 0 {
		line = line[idx+1:]
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return []string{}
	}
	return fields
}

// ─── Kryptografia ─────────────────────────────────────────────────────────────

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func genToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// GenPassword generuje losowe hasło (używane przez main.go gdy --pass puste)
func GenPassword(n int) string {
	chars := []rune("abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$")
	b := make([]rune, n)
	for i := range b {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[idx.Int64()]
	}
	return string(b)
}
