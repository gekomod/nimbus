package api

// routers.go — Zarządzanie routerami zewnętrznymi (Xiaomi BE6500, Cudy LT400, MikroTik, OpenWrt…)
//
// Sterowniki:
//   xiaomi   — MiWiFi API (luci/api): Xiaomi BE6500, BE7000, AX9000, AX6000, AX3000, AX1800, Redmi AX5400 i inne
//   openwrt  — ubus JSON-RPC: Cudy LT400/LT500/LT1200/X6, GL.iNet, TP-Link OpenWrt, ASUS OpenWrt, wszystko na OpenWrt
//   mikrotik — RouterOS REST API v7+: hAP ax3, Chateau, RB5009, CCR serie

import (
	"bytes"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// ── Katalog modeli ──────────────────────────────────────────────────────────

type RouterModelDef struct {
	ID     string `json:"id"`
	Brand  string `json:"brand"`
	Name   string `json:"name"`
	Driver string `json:"driver"` // "xiaomi" | "openwrt" | "mikrotik"
	Notes  string `json:"notes"`
}

var RouterModels = []RouterModelDef{
	// Xiaomi / Redmi (MiWiFi API)
	{ID: "xiaomi_be6500",     Brand: "Xiaomi", Name: "Xiaomi BE6500 (Wi-Fi 7)",              Driver: "xiaomi",     Notes: "MiWiFi API HTTP · hasło panelu 192.168.31.1"},
	{ID: "xiaomi_be6500_ssh", Brand: "Xiaomi", Name: "Xiaomi BE6500 (Wi-Fi 7) — SSH",        Driver: "xiaomi_ssh", Notes: "SSH port 22 · login: root · hasło: jak do panelu WWW"},
	{ID: "xiaomi_be7000",     Brand: "Xiaomi", Name: "Xiaomi BE7000 Pro (Wi-Fi 7)",           Driver: "xiaomi",     Notes: "MiWiFi API · te same endpointy co BE6500"},
	{ID: "xiaomi_ax9000",    Brand: "Xiaomi",       Name: "Xiaomi AX9000 (Wi-Fi 6E)",          Driver: "xiaomi",   Notes: "MiWiFi API · tri-band"},
	{ID: "xiaomi_ax6000",    Brand: "Xiaomi",       Name: "Xiaomi AX6000 (Wi-Fi 6E)",          Driver: "xiaomi",   Notes: "MiWiFi API"},
	{ID: "xiaomi_ax3000",    Brand: "Xiaomi",       Name: "Xiaomi AX3000 (Wi-Fi 6)",           Driver: "xiaomi",   Notes: "MiWiFi API"},
	{ID: "xiaomi_ax1800",    Brand: "Xiaomi",       Name: "Xiaomi AX1800 (Wi-Fi 6)",           Driver: "xiaomi",   Notes: "MiWiFi API"},
	{ID: "redmi_ax5400",     Brand: "Redmi",        Name: "Redmi AX5400 (Wi-Fi 6)",            Driver: "xiaomi",   Notes: "MiWiFi API — ten sam protokół co Xiaomi"},
	{ID: "xiaomi_4a_gig",   Brand: "Xiaomi",       Name: "Xiaomi 4A Gigabit",                  Driver: "xiaomi",   Notes: "MiWiFi API · starszy model"},
	{ID: "xiaomi_generic",  Brand: "Xiaomi/Redmi", Name: "Inny Xiaomi / Redmi (MiWiFi)",       Driver: "xiaomi",   Notes: "Działa z każdym routerem MiWiFi"},
	// Cudy
	{ID: "cudy_lt400",      Brand: "Cudy", Name: "Cudy LT400 (5G CPE)",                        Driver: "openwrt",  Notes: "ubus JSON-RPC · obsługa modemu 5G/LTE"},
	{ID: "cudy_lt500",      Brand: "Cudy", Name: "Cudy LT500 (5G CPE)",                        Driver: "openwrt",  Notes: "ubus JSON-RPC"},
	{ID: "cudy_lt1200",     Brand: "Cudy", Name: "Cudy LT1200 (5G CPE)",                       Driver: "openwrt",  Notes: "ubus JSON-RPC · wyższy zasięg"},
	{ID: "cudy_x6",         Brand: "Cudy", Name: "Cudy X6 (Wi-Fi 6 AX1800)",                  Driver: "openwrt",  Notes: "ubus JSON-RPC"},
	{ID: "cudy_wr3000",     Brand: "Cudy", Name: "Cudy WR3000 (Wi-Fi 6 AX3000)",              Driver: "openwrt",  Notes: "ubus JSON-RPC"},
	{ID: "cudy_generic",    Brand: "Cudy", Name: "Inny router Cudy",                           Driver: "openwrt",  Notes: "Firmware Cudy oparty o OpenWrt"},
	// OpenWrt / inne marki po flashu
	{ID: "openwrt_generic", Brand: "OpenWrt", Name: "Dowolny router OpenWrt / LuCI",           Driver: "openwrt",  Notes: "Wymaga rpcd + uhttpd (domyślnie włączone)"},
	{ID: "glinet_generic",  Brand: "GL.iNet",  Name: "GL.iNet (wszystkie modele)",              Driver: "openwrt",  Notes: "GL.iNet używa OpenWrt — działa bez konfiguracji"},
	{ID: "tplink_openwrt",  Brand: "TP-Link",  Name: "TP-Link (po instalacji OpenWrt)",        Driver: "openwrt",  Notes: "Oryginalny firmware TP-Link nie ma ubus API"},
	{ID: "asus_openwrt",    Brand: "ASUS",     Name: "ASUS (Asuswrt-Merlin / OpenWrt)",        Driver: "openwrt",  Notes: "Merlin z ubus lub router po flashu OpenWrt"},
	{ID: "netgear_openwrt", Brand: "Netgear",  Name: "Netgear (po instalacji OpenWrt)",        Driver: "openwrt",  Notes: "Oryginalny firmware Netgear nie ma ubus API"},
	// MikroTik
	{ID: "mikrotik_hap_ax3",  Brand: "MikroTik", Name: "MikroTik hAP ax3",                    Driver: "mikrotik", Notes: "RouterOS REST API · www-ssl port 443"},
	{ID: "mikrotik_chateau",  Brand: "MikroTik", Name: "MikroTik Chateau",                     Driver: "mikrotik", Notes: "RouterOS REST API"},
	{ID: "mikrotik_rb5009",   Brand: "MikroTik", Name: "MikroTik RB5009",                      Driver: "mikrotik", Notes: "RouterOS REST API"},
	{ID: "mikrotik_rb750gr3", Brand: "MikroTik", Name: "MikroTik RB750Gr3 (hEX)",              Driver: "mikrotik", Notes: "RouterOS REST API · wymaga RouterOS ≥ 7.1"},
	{ID: "mikrotik_ccr2004",  Brand: "MikroTik", Name: "MikroTik CCR2004",                     Driver: "mikrotik", Notes: "RouterOS REST API · router przemysłowy"},
	{ID: "mikrotik_generic",  Brand: "MikroTik", Name: "Inny MikroTik (RouterOS 7+)",          Driver: "mikrotik", Notes: "Wymaga www/www-ssl + REST API w RouterOS ≥ 7.1"},
}

func routerModelDef(id string) RouterModelDef {
	for _, m := range RouterModels {
		if m.ID == id {
			return m
		}
	}
	return RouterModelDef{ID: id, Brand: "?", Name: id, Driver: "openwrt"}
}

// ── Urządzenie / magazyn ────────────────────────────────────────────────────

const routersConfigPath = "/etc/nas-panel/routers.json"

type RouterDevice struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Model     string `json:"model"`    // klucz z RouterModels
	Host      string `json:"host"`
	Port      int    `json:"port"`
	UseHTTPS  bool   `json:"use_https"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
	Notes     string `json:"notes,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

// Cache tokenów sesji — osobno od RouterDevice (struct pozostaje kopiowalna)
type routerToken struct {
	value string
	at    time.Time
}

var (
	rtrTokens   = map[string]routerToken{}
	rtrTokensMu sync.Mutex
)

func getRtrToken(id string) (string, bool) {
	rtrTokensMu.Lock()
	defer rtrTokensMu.Unlock()
	e, ok := rtrTokens[id]
	if !ok || time.Since(e.at) >= 8*time.Minute {
		return "", false
	}
	return e.value, true
}

func setRtrToken(id, val string) {
	rtrTokensMu.Lock()
	defer rtrTokensMu.Unlock()
	rtrTokens[id] = routerToken{value: val, at: time.Now()}
}

func invalidateRtrToken(id string) {
	rtrTokensMu.Lock()
	defer rtrTokensMu.Unlock()
	delete(rtrTokens, id)
}

var (
	rtrDevices   = map[string]*RouterDevice{}
	rtrDevicesMu sync.Mutex
)

func init() { loadRtrFromDisk() }

func loadRtrFromDisk() {
	data, err := os.ReadFile(routersConfigPath)
	if err != nil {
		return
	}
	var list []*RouterDevice
	if err := json.Unmarshal(data, &list); err != nil {
		return
	}
	rtrDevicesMu.Lock()
	defer rtrDevicesMu.Unlock()
	for _, d := range list {
		rtrDevices[d.ID] = d
	}
}

func saveRtrToDisk() error {
	rtrDevicesMu.Lock()
	list := make([]*RouterDevice, 0, len(rtrDevices))
	for _, v := range rtrDevices {
		list = append(list, v)
	}
	rtrDevicesMu.Unlock()
	if err := os.MkdirAll("/etc/nas-panel", 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(routersConfigPath, data, 0600)
}

func sanitizeRtr(d *RouterDevice) RouterDevice {
	cp := *d
	cp.Password = ""
	return cp
}

func (d *RouterDevice) baseURL() string {
	scheme := "http"
	if d.UseHTTPS {
		scheme = "https"
	}
	port := d.Port
	if port == 0 {
		if d.UseHTTPS {
			port = 443
		} else {
			port = 80
		}
	}
	return fmt.Sprintf("%s://%s:%d", scheme, d.Host, port)
}

// ── Typy danych statusu ──────────────────────────────────────────────────────

type RouterWifiRadio struct {
	ID          string `json:"id"`
	Band        string `json:"band"`    // "2.4GHz" | "5GHz" | "6GHz"
	SSID        string `json:"ssid"`
	Enabled     bool   `json:"enabled"`
	Channel     int    `json:"channel,omitempty"`
	ClientCount int    `json:"client_count"`
}

type RouterClient struct {
	MAC      string `json:"mac"`
	IP       string `json:"ip"`
	Hostname string `json:"hostname"`
	Online   bool   `json:"online"`
	SignalDBM int   `json:"signal_dbm,omitempty"`
	RxBytes  int64  `json:"rx_bytes,omitempty"`
	TxBytes  int64  `json:"tx_bytes,omitempty"`
}

type RouterStatus struct {
	Online       bool              `json:"online"`
	Model        string            `json:"model"`
	Firmware     string            `json:"firmware,omitempty"`
	UptimeSec    int64             `json:"uptime_sec"`
	CPULoadPct   float64           `json:"cpu_load_pct"`
	MemUsedPct   float64           `json:"mem_used_pct"`
	WANIP        string            `json:"wan_ip,omitempty"`
	WANType      string            `json:"wan_type,omitempty"`
	WANConnected bool              `json:"wan_connected"`
	NetworkType  string            `json:"network_type,omitempty"` // 5G / LTE / 4G dla CPE
	SignalPct    int               `json:"signal_pct,omitempty"`
	SignalDBM    int               `json:"signal_dbm,omitempty"`
	Wifi         []RouterWifiRadio `json:"wifi"`
	ClientCount  int               `json:"client_count"`
	Error        string            `json:"error,omitempty"`
}

// ── Interfejs sterownika ─────────────────────────────────────────────────────

type routerDriver interface {
	Status(d *RouterDevice) (*RouterStatus, error)
	Reboot(d *RouterDevice) error
	SetWifiEnabled(d *RouterDevice, radioID string, enabled bool) error
	Clients(d *RouterDevice) ([]RouterClient, error)
}

func driverFor(model string) routerDriver {
	switch routerModelDef(model).Driver {
	case "xiaomi":
		return xiaomiDriver{}
	case "xiaomi_ssh":
		return xiaomiSSHDriver{}
	case "mikrotik":
		return mikrotikDriver{}
	default:
		return openwrtDriver{}
	}
}

// ── Wspólny HTTP klient (ignoruje self-signed certs routerów) ────────────────

var rtrHTTPClient = &http.Client{
	Timeout: 12 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		DisableKeepAlives:   false,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
	},
}


// ══════════════════════════════════════════════════════════════════════════════
// STEROWNIK XIAOMI / MIWIFI
//
// Dwa warianty API — auto-wykrywane przy pierwszym logowaniu:
//
// STARE (AX3000, AX1800, 4A Gigabit, AX6000, AX9000):
//   Login: POST /cgi-bin/luci/api/xqsystem/login  →  {token:"stok_xxx"}
//   API:   GET  /cgi-bin/luci/;stok=TOKEN/api/ENDPOINT
//
// NOWE (BE6500, BE7000 Pro, AX9000 nowe FW):
//   Panel: /cgi-bin/luci/web  (to co widzi user)
//   Login: POST /cgi-bin/luci/web  z form  →  JSON z "token" lub "stok"
//          lub  POST /api/xqsystem/login
//   API:   GET  /api/ENDPOINT?token=TOKEN
//          lub  GET  /cgi-bin/luci/;stok=TOKEN/api/ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════

// xiaomiAPIVersion przechowuje wykrytą wersję API per router ID
// "new" = BE6500 styl, "old" = AX/starszy styl
var (
	xiaomiAPIVer   = map[string]string{}
	xiaomiAPIVerMu sync.Mutex
)

func getXiaomiAPIVer(id string) string {
	xiaomiAPIVerMu.Lock()
	defer xiaomiAPIVerMu.Unlock()
	return xiaomiAPIVer[id]
}
func setXiaomiAPIVer(id, ver string) {
	xiaomiAPIVerMu.Lock()
	defer xiaomiAPIVerMu.Unlock()
	xiaomiAPIVer[id] = ver
}

type xiaomiDriver struct{}

func sha1hex(s string) string {
	h := sha1.Sum([]byte(s))
	return fmt.Sprintf("%x", h)
}

// nonce = "0_00:00:00:00:00:00_{unix}_{rand4}"
func xiaomiNonce() string {
	return fmt.Sprintf("0_00:00:00:00:00:00_%d_%04d", time.Now().Unix(), rand.Intn(9000)+1000)
}

// hash = sha1( nonce + sha1(password) )
func xiaomiHash(nonce, password string) string {
	return sha1hex(nonce + sha1hex(password))
}

func xiaomiReq(method, url, body, contentType string, extraHeaders map[string]string) (*http.Response, error) {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	return rtrHTTPClient.Do(req)
}

// tryLoginNew próbuje nowego API (BE6500): POST /api/xqsystem/login
func (x xiaomiDriver) tryLoginNew(d *RouterDevice) (string, error) {
	base := d.baseURL()
	nonce := xiaomiNonce()
	hash := xiaomiHash(nonce, d.Password)
	form := fmt.Sprintf("username=admin&password=%s&logtype=2&nonce=%s", hash, nonce)

	// Endpoint nowego API
	for _, loginURL := range []string{
		base + "/api/xqsystem/login",
		base + "/cgi-bin/luci/api/xqsystem/login",
	} {
		resp, err := xiaomiReq(http.MethodPost, loginURL, form,
			"application/x-www-form-urlencoded",
			map[string]string{
				"Referer": base + "/cgi-bin/luci/web",
				"Origin":  base,
			})
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var out struct {
			Code  int    `json:"code"`
			Token string `json:"token"`
			URL   string `json:"url"`
		}
		if json.Unmarshal(body, &out) != nil {
			continue
		}
		if out.Token != "" {
			return out.Token, nil
		}
	}
	return "", fmt.Errorf("nowe API nieudane")
}

// login — loguje do routera Xiaomi/MiWiFi, zwraca stok
// BE6500 zwraca JSON: {"code":0,"stok":"22d75642b78ab3d3e6de613faab32e73","url":"/cgi-bin/luci/web"}
// Starsze modele zwracają: {"code":0,"token":"stok_xxx"}
// Endpoint logowania: POST /cgi-bin/luci/api/xqsystem/login (działa na BE6500 i starszych)
func (x xiaomiDriver) login(d *RouterDevice) (string, error) {
	if tok, ok := getRtrToken(d.ID); ok {
		return tok, nil
	}

	base := d.baseURL()
	nonce := xiaomiNonce()
	hash := xiaomiHash(nonce, d.Password)
	form := fmt.Sprintf("username=admin&password=%s&logtype=2&nonce=%s", hash, nonce)
	headers := map[string]string{
		"Referer": base + "/cgi-bin/luci/web",
		"Origin":  base,
	}

	// Kolejność prób — BE6500 odpowiada na /cgi-bin/luci/api/xqsystem/login
	// (to ten sam endpoint co starsze, ale zwraca "stok" zamiast "token")
	loginURLs := []string{
		base + "/cgi-bin/luci/api/xqsystem/login",
		base + "/api/xqsystem/login",
	}

	var lastErr error
	var lastBody []byte

	for _, loginURL := range loginURLs {
		resp, err := xiaomiReq(http.MethodPost, loginURL, form,
			"application/x-www-form-urlencoded", headers)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		lastBody = body

		// BE6500 i nowsze: {"code":0,"stok":"22d75642...","url":"/cgi-bin/luci/web"}
		// Starsze (AX3000 itp): {"code":0,"token":"stok_xxx"}
		var out struct {
			Code  int    `json:"code"`
			Stok  string `json:"stok"`  // BE6500, BE7000, nowszy firmware
			Token string `json:"token"` // starsze modele
		}
		if json.Unmarshal(body, &out) != nil {
			continue
		}

		// Wyciągnij token z któregokolwiek pola
		tok := out.Stok
		if tok == "" {
			tok = out.Token
		}

		if tok != "" {
			// Zapamiętaj wersję API na podstawie URL który zadziałał
			if strings.Contains(loginURL, "cgi-bin/luci") {
				setXiaomiAPIVer(d.ID, "old") // stok w URL: /cgi-bin/luci/;stok=TOKEN/
			} else {
				setXiaomiAPIVer(d.ID, "new") // nowy styl: /api/ENDPOINT?token=TOKEN
			}
			setRtrToken(d.ID, tok)
			return tok, nil
		}

		if out.Code != 0 {
			// Router odpowiedział — błąd autentykacji (złe hasło)
			return "", fmt.Errorf("błędne hasło (kod %d) — użyj hasła do panelu %s/cgi-bin/luci/web, nie hasła Wi-Fi", out.Code, base)
		}
	}

	if lastErr != nil {
		errStr := lastErr.Error()
		if strings.Contains(errStr, "deadline exceeded") || strings.Contains(errStr, "timeout") {
			return "", fmt.Errorf("timeout — router nie odpowiada na %s\n• NAS musi być w tej samej sieci (192.168.31.x)\n• Sprawdź IP routera i port 80", d.Host)
		}
		if strings.Contains(errStr, "connection refused") {
			return "", fmt.Errorf("port %d zamknięty — użyj przycisku 'Wykryj port' w edycji routera", d.Port)
		}
		return "", fmt.Errorf("błąd połączenia z %s: %v", d.Host, lastErr)
	}

	// Debug: pokaż co router zwrócił
	bodyStr := ""
	if len(lastBody) > 0 {
		if len(lastBody) > 200 {
			bodyStr = string(lastBody[:200])
		} else {
			bodyStr = string(lastBody)
		}
	}
	return "", fmt.Errorf("router nie zwrócił tokenu. Odpowiedź: %s\nSprawdź hasło w panelu: %s/cgi-bin/luci/web", bodyStr, base)
}

// get wykonuje żądanie do API Xiaomi
// URL format (z przykładu BE6500): /cgi-bin/luci/;stok=TOKEN/api/ENDPOINT
// lub nowy styl: /api/ENDPOINT?token=TOKEN
func (x xiaomiDriver) get(d *RouterDevice, api string) (map[string]any, error) {
	token, err := x.login(d)
	if err != nil {
		return nil, err
	}

	base := d.baseURL()
	ver := getXiaomiAPIVer(d.ID)

	var url string
	if ver == "new" {
		// Nowy styl (niektóre BE7000 Pro z nowym firmware)
		url = fmt.Sprintf("%s/api/%s?token=%s", base, api, token)
	} else {
		// Styl BE6500 i wszystkich starszych: /cgi-bin/luci/;stok=TOKEN/api/ENDPOINT
		url = fmt.Sprintf("%s/cgi-bin/luci/;stok=%s/api/%s", base, token, api)
	}

	resp, err := xiaomiReq(http.MethodGet, url, "", "",
		map[string]string{"Referer": base + "/cgi-bin/luci/web"})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		invalidateRtrToken(d.ID)
		return nil, fmt.Errorf("sesja wygasła — token odrzucony")
	}
	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	json.Unmarshal(body, &out)
	return out, nil
}

func (x xiaomiDriver) Status(d *RouterDevice) (*RouterStatus, error) {
	st := &RouterStatus{Model: d.Model}

	sysInfo, err := x.get(d, "misystem/status")
	if err != nil {
		st.Error = err.Error()
		return st, err
	}
	st.Online = true

	if up, ok := sysInfo["upTime"].(float64); ok {
		st.UptimeSec = int64(up)
	}
	if mem, ok := sysInfo["mem"].(map[string]any); ok {
		if usage, ok := mem["usage"].(float64); ok {
			st.MemUsedPct = round2(usage * 100)
		}
	}
	if cpu, ok := sysInfo["cpu"].(map[string]any); ok {
		if load, ok := cpu["load"].(float64); ok {
			st.CPULoadPct = round2(load)
		}
	}
	if hw, ok := sysInfo["hardware"].(map[string]any); ok {
		if ver, ok := hw["version"].(string); ok {
			st.Firmware = ver
		}
	}

	if wanInfo, err := x.get(d, "xqnetwork/wan_info"); err == nil {
		if info, ok := wanInfo["info"].(map[string]any); ok {
			st.WANConnected = true
			if v4list, ok := info["ipv4"].([]any); ok && len(v4list) > 0 {
				if v4, ok := v4list[0].(map[string]any); ok {
					if ip, ok := v4["ip"].(string); ok {
						st.WANIP = ip
					}
				}
			}
			if proto, ok := info["wanType"].(string); ok {
				st.WANType = proto
			}
		}
	}

	if devList, err := x.get(d, "misystem/devicelist"); err == nil {
		if list, ok := devList["list"].([]any); ok {
			st.ClientCount = len(list)
		}
	}

	if wifiInfo, err := x.get(d, "xqnetwork/wifi_detail_all"); err == nil {
		if wifis, ok := wifiInfo["info"].([]any); ok {
			bands := []string{"2.4GHz", "5GHz", "6GHz"}
			for i, raw := range wifis {
				w, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				radio := RouterWifiRadio{ID: fmt.Sprintf("wifi%d", i)}
				if ssid, ok := w["ssid"].(string); ok {
					radio.SSID = ssid
				}
				if on, ok := w["on"].(float64); ok {
					radio.Enabled = on == 1
				}
				if ch, ok := w["channel"].(float64); ok {
					radio.Channel = int(ch)
				}
				if i < len(bands) {
					radio.Band = bands[i]
				} else {
					radio.Band = fmt.Sprintf("radio%d", i)
				}
				st.Wifi = append(st.Wifi, radio)
			}
		}
	}

	return st, nil
}

func (x xiaomiDriver) Reboot(d *RouterDevice) error {
	_, err := x.get(d, "xqsystem/reboot")
	invalidateRtrToken(d.ID)
	return err
}

func (x xiaomiDriver) SetWifiEnabled(d *RouterDevice, radioID string, enabled bool) error {
	idx := strings.TrimPrefix(radioID, "wifi")
	val := "0"
	if enabled {
		val = "1"
	}
	_, err := x.get(d, fmt.Sprintf("xqnetwork/set_wifi_on_off?wifi_on=%s&wifiIndex=%s", val, idx))
	return err
}

func (x xiaomiDriver) Clients(d *RouterDevice) ([]RouterClient, error) {
	devList, err := x.get(d, "misystem/devicelist")
	if err != nil {
		return nil, err
	}
	list, _ := devList["list"].([]any)
	var out []RouterClient
	for _, raw := range list {
		w, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := RouterClient{Online: true}
		if v, ok := w["mac"].(string); ok {
			c.MAC = v
		}
		if v, ok := w["name"].(string); ok {
			c.Hostname = v
		}
		if ip, ok := w["ip"].(map[string]any); ok {
			if v, ok := ip["ip"].(string); ok {
				c.IP = v
			}
			if dl, ok := ip["downspeed"].(string); ok {
				if n, err := strconv.ParseInt(dl, 10, 64); err == nil {
					c.RxBytes = n
				}
			}
			if ul, ok := ip["upspeed"].(string); ok {
				if n, err := strconv.ParseInt(ul, 10, 64); err == nil {
					c.TxBytes = n
				}
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// ══════════════════════════════════════════════════════════════════════════════
// STEROWNIK XIAOMI SSH
// Przez SSH (port 22, root + hasło panelu) uruchamiamy polecenia ubus/uci
// bezpośrednio na routerze. Omija problemy z HTTP API i CSRF.
// BE6500 domyślnie ma SSH włączone.
// ══════════════════════════════════════════════════════════════════════════════

type xiaomiSSHDriver struct{}

// sshPort — port SSH routera (domyślnie 22, ale w RouterDevice.Port może być inny)
func (x xiaomiSSHDriver) sshPort(d *RouterDevice) int {
	// Jeśli port ustawiony przez użytkownika to inny niż 80, użyj go
	// W przeciwnym razie SSH jest na 22
	if d.Port != 80 && d.Port != 443 && d.Port != 8080 {
		return d.Port
	}
	return 22
}

func (x xiaomiSSHDriver) run(d *RouterDevice, cmd string) (string, error) {
	cfg := &gossh.ClientConfig{
		User: func() string {
			if d.Username != "" {
				return d.Username
			}
			return "root"
		}(),
		Auth: []gossh.AuthMethod{
			gossh.Password(d.Password),
			gossh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = d.Password
				}
				return answers, nil
			}),
		},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", d.Host, x.sshPort(d))
	client, err := gossh.Dial("tcp", addr, cfg)
	if err != nil {
		if strings.Contains(err.Error(), "unable to authenticate") {
			return "", fmt.Errorf("błędny login/hasło SSH — BE6500: login=root, hasło=to samo co panel WWW")
		}
		if strings.Contains(err.Error(), "connection refused") {
			return "", fmt.Errorf("port SSH %d zamknięty — sprawdź czy SSH jest włączone w panelu routera", x.sshPort(d))
		}
		return "", fmt.Errorf("SSH %s: %v", addr, err)
	}
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	out, err := sess.CombinedOutput(cmd)
	return strings.TrimSpace(string(out)), err
}

// ubusCall przez SSH: ubus call OBJECT METHOD '{JSON}'
func (x xiaomiSSHDriver) ubus(d *RouterDevice, object, method string, args string) (map[string]any, error) {
	if args == "" {
		args = "{}"
	}
	cmd := fmt.Sprintf("ubus call %s %s '%s' 2>/dev/null", object, method, args)
	out, err := x.run(d, cmd)
	if err != nil || out == "" {
		return nil, fmt.Errorf("ubus %s %s: %v (out=%q)", object, method, err, out)
	}
	var result map[string]any
	if jerr := json.Unmarshal([]byte(out), &result); jerr != nil {
		return nil, fmt.Errorf("ubus %s %s: niepoprawny JSON: %s", object, method, out[:minInt(len(out), 200)])
	}
	return result, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (x xiaomiSSHDriver) Status(d *RouterDevice) (*RouterStatus, error) {
	st := &RouterStatus{Model: d.Model}

	// Test połączenia SSH
	out, err := x.run(d, "echo ok")
	if err != nil || strings.TrimSpace(out) != "ok" {
		st.Error = err.Error()
		return st, err
	}
	st.Online = true

	// Uptime
	if upOut, err := x.run(d, "cat /proc/uptime"); err == nil {
		parts := strings.Fields(upOut)
		if len(parts) > 0 {
			if f, err := strconv.ParseFloat(parts[0], 64); err == nil {
				st.UptimeSec = int64(f)
			}
		}
	}

	// CPU load
	if loadOut, err := x.run(d, "cat /proc/loadavg"); err == nil {
		parts := strings.Fields(loadOut)
		if len(parts) > 0 {
			if f, err := strconv.ParseFloat(parts[0], 64); err == nil {
				st.CPULoadPct = round2(f * 100)
			}
		}
	}

	// RAM
	if memOut, err := x.run(d, "grep -E 'MemTotal|MemAvailable' /proc/meminfo"); err == nil {
		lines := strings.Split(memOut, "\n")
		memMap := map[string]int64{}
		for _, l := range lines {
			parts := strings.Fields(l)
			if len(parts) >= 2 {
				key := strings.TrimSuffix(parts[0], ":")
				if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
					memMap[key] = v
				}
			}
		}
		if total, ok := memMap["MemTotal"]; ok && total > 0 {
			avail := memMap["MemAvailable"]
			st.MemUsedPct = round2(float64(total-avail) / float64(total) * 100)
		}
	}

	// Firmware version
	if fwOut, err := x.run(d, "cat /etc/openwrt_release 2>/dev/null | grep DISTRIB_DESCRIPTION | cut -d= -f2 | tr -d '\"'"); err == nil && fwOut != "" {
		st.Firmware = fwOut
	} else if fwOut, err := x.run(d, "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'"); err == nil {
		st.Firmware = fwOut
	}

	// WAN IP — sprawdź interfejs wan/eth1/pppoe
	if wanOut, err := x.run(d, "ip -4 addr show $(ip route | grep default | awk '{print $5}' | head -1) 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1 | head -1"); err == nil && wanOut != "" {
		st.WANIP = wanOut
		st.WANConnected = true
	}

	// Liczba klientów Wi-Fi
	if cliOut, err := x.run(d, "iw dev 2>/dev/null | grep -c 'station' || echo 0"); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(cliOut)); err == nil {
			st.ClientCount = n
		}
	}

	// Wi-Fi radios przez UCI
	if wifiOut, err := x.run(d, "for iface in $(uci show wireless 2>/dev/null | grep 'wireless\\.@wifi-iface\\[' | grep -o '\\[.*\\]' | sort -u); do ssid=$(uci get wireless.@wifi-iface${iface}.ssid 2>/dev/null); dis=$(uci get wireless.@wifi-iface${iface}.disabled 2>/dev/null); echo \"$iface|$ssid|$dis\"; done"); err == nil {
		for i, line := range strings.Split(wifiOut, "\n") {
			parts := strings.SplitN(line, "|", 3)
			if len(parts) < 2 || parts[1] == "" {
				continue
			}
			bands := []string{"2.4GHz", "5GHz", "6GHz"}
			radio := RouterWifiRadio{
				ID:      fmt.Sprintf("wifi%d", i),
				SSID:    parts[1],
				Enabled: len(parts) < 3 || parts[2] != "1",
			}
			if i < len(bands) {
				radio.Band = bands[i]
			} else {
				radio.Band = fmt.Sprintf("radio%d", i)
			}
			st.Wifi = append(st.Wifi, radio)
		}
	}

	return st, nil
}

func (x xiaomiSSHDriver) Reboot(d *RouterDevice) error {
	_, err := x.run(d, "reboot &")
	return err
}

func (x xiaomiSSHDriver) SetWifiEnabled(d *RouterDevice, radioID string, enabled bool) error {
	// radioID np. "wifi0", "[0]"
	idx := strings.TrimPrefix(radioID, "wifi")
	val := "1" // disabled=1 = wyłączone
	if enabled {
		val = "0" // disabled=0 = włączone
	}
	cmd := fmt.Sprintf("uci set wireless.@wifi-iface[%s].disabled=%s && uci commit wireless && wifi reload", idx, val)
	_, err := x.run(d, cmd)
	return err
}

func (x xiaomiSSHDriver) Clients(d *RouterDevice) ([]RouterClient, error) {
	// Pobierz listę klientów DHCP z /tmp/dhcp.leases
	out, err := x.run(d, "cat /tmp/dhcp.leases 2>/dev/null")
	if err != nil {
		return nil, err
	}
	var clients []RouterClient
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		// Format: timestamp mac ip hostname *
		clients = append(clients, RouterClient{
			MAC:      parts[1],
			IP:       parts[2],
			Hostname: parts[3],
			Online:   true,
		})
	}
	// Dodaj klientów Wi-Fi (iw station dump)
	if stOut, err := x.run(d, "iw dev 2>/dev/null | grep Interface | awk '{print $2}' | while read iface; do iw $iface station dump 2>/dev/null | grep Station | awk '{print $2}'; done"); err == nil {
		wifiMACs := map[string]bool{}
		for _, mac := range strings.Split(stOut, "\n") {
			if mac != "" {
				wifiMACs[strings.ToLower(mac)] = true
			}
		}
		// Oznacz klientów Wi-Fi
		for i := range clients {
			if wifiMACs[strings.ToLower(clients[i].MAC)] {
				clients[i].Online = true
			}
		}
	}
	return clients, nil
}

// ══════════════════════════════════════════════════════════════════════════════
// Działa z: Cudy LT400/LT500/LT1200/X6, GL.iNet, każdy OpenWrt z rpcd
// Protokół: POST /ubus  → JSON-RPC 2.0
// ══════════════════════════════════════════════════════════════════════════════

type openwrtDriver struct{}

func (o openwrtDriver) rpc(d *RouterDevice, sid, object, method string, args map[string]any) (map[string]any, error) {
	if args == nil {
		args = map[string]any{}
	}
	payload := map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "call",
		"params": []any{sid, object, method, args},
	}
	buf, _ := json.Marshal(payload)
	resp, err := rtrHTTPClient.Post(d.baseURL()+"/ubus", "application/json", bytes.NewReader(buf))
	if err != nil {
		return nil, fmt.Errorf("brak połączenia z routerem: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var out struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("nieprawidłowa odpowiedź ubus")
	}

	// result może być: [code, {data}] lub {data}
	var arr []json.RawMessage
	if err := json.Unmarshal(out.Result, &arr); err == nil && len(arr) >= 2 {
		var m map[string]any
		json.Unmarshal(arr[1], &m)
		return m, nil
	}
	var m map[string]any
	json.Unmarshal(out.Result, &m)
	return m, nil
}

func (o openwrtDriver) login(d *RouterDevice) (string, error) {
	if tok, ok := getRtrToken(d.ID); ok {
		return tok, nil
	}
	res, err := o.rpc(d, "00000000000000000000000000000000", "session", "login",
		map[string]any{"username": d.Username, "password": d.Password})
	if err != nil {
		return "", err
	}
	sid, _ := res["ubus_rpc_session"].(string)
	if sid == "" {
		return "", fmt.Errorf("logowanie ubus nieudane — sprawdź login i hasło (użytkownik: root lub admin)")
	}
	setRtrToken(d.ID, sid)
	return sid, nil
}

func (o openwrtDriver) Status(d *RouterDevice) (*RouterStatus, error) {
	st := &RouterStatus{Model: d.Model}

	sid, err := o.login(d)
	if err != nil {
		st.Error = err.Error()
		return st, err
	}
	st.Online = true

	// system info (uptime, load, memory)
	if info, err := o.rpc(d, sid, "system", "info", nil); err == nil {
		if up, ok := info["uptime"].(float64); ok {
			st.UptimeSec = int64(up)
		}
		if load, ok := info["load"].([]any); ok && len(load) > 0 {
			if l0, ok := load[0].(float64); ok {
				st.CPULoadPct = round2(l0 / 65536.0 * 100)
			}
		}
		if mem, ok := info["memory"].(map[string]any); ok {
			total, _ := mem["total"].(float64)
			free, _ := mem["free"].(float64)
			if total > 0 {
				st.MemUsedPct = round2((1 - free/total) * 100)
			}
		}
	}

	// firmware / board
	if board, err := o.rpc(d, sid, "system", "board", nil); err == nil {
		if rel, ok := board["release"].(map[string]any); ok {
			if desc, ok := rel["description"].(string); ok {
				st.Firmware = desc
			}
		}
	}

	// WAN
	if netDump, err := o.rpc(d, sid, "network.interface", "dump", nil); err == nil {
		if ifaces, ok := netDump["interface"].([]any); ok {
			for _, iv := range ifaces {
				im, ok := iv.(map[string]any)
				if !ok {
					continue
				}
				name, _ := im["interface"].(string)
				if !strings.Contains(strings.ToLower(name), "wan") {
					continue
				}
				up, _ := im["up"].(bool)
				st.WANConnected = up
				if proto, ok := im["proto"].(string); ok {
					st.WANType = proto
				}
				if addrs, ok := im["ipv4-address"].([]any); ok && len(addrs) > 0 {
					if am, ok := addrs[0].(map[string]any); ok {
						if ip, ok := am["address"].(string); ok {
							st.WANIP = ip
						}
					}
				}
				break
			}
		}
	}

	// Modem 5G/LTE — Cudy LT400 i podobne eksponują mobiled lub network.mobile
	for _, mObj := range []string{"mobiled", "network.mobile"} {
		if mInfo, err := o.rpc(d, sid, mObj, "status", nil); err == nil {
			if sig, ok := mInfo["signal"].(map[string]any); ok {
				if pct, ok := sig["signal_strength_pct"].(float64); ok {
					st.SignalPct = int(pct)
				}
				if dbm, ok := sig["rsrp"].(float64); ok {
					st.SignalDBM = int(dbm)
				}
			}
			if net, ok := mInfo["network"].(map[string]any); ok {
				if typ, ok := net["network_type"].(string); ok {
					st.NetworkType = typ
				}
			}
			break
		}
	}

	// Liczba klientów (DHCP leases)
	if leases, err := o.rpc(d, sid, "luci-rpc", "getDHCPLeases", nil); err == nil {
		if v4, ok := leases["dhcp_leases"].([]any); ok {
			st.ClientCount = len(v4)
		}
	}

	// Wi-Fi radios
	if wState, err := o.rpc(d, sid, "network.wireless", "status", nil); err == nil {
		radioIdx := 0
		for phyName, rawPhy := range wState {
			phy, ok := rawPhy.(map[string]any)
			if !ok {
				continue
			}
			ifaces, _ := phy["interfaces"].([]any)
			for _, rawIface := range ifaces {
				iface, ok := rawIface.(map[string]any)
				if !ok {
					continue
				}
				radio := RouterWifiRadio{ID: fmt.Sprintf("%s", phyName)}
				config, _ := iface["config"].(map[string]any)
				if ssid, ok := config["ssid"].(string); ok {
					radio.SSID = ssid
				}
				if ch, ok := config["channel"].(float64); ok {
					radio.Channel = int(ch)
				}
				disabled, _ := config["disabled"].(bool)
				radio.Enabled = !disabled
				// band z name: radio0 = 2.4GHz, radio1 = 5GHz, radio2 = 6GHz
				switch radioIdx {
				case 0:
					radio.Band = "2.4GHz"
				case 1:
					radio.Band = "5GHz"
				case 2:
					radio.Band = "6GHz"
				default:
					radio.Band = fmt.Sprintf("radio%d", radioIdx)
				}
				st.Wifi = append(st.Wifi, radio)
				radioIdx++
				break // tylko pierwszy interfejs per phy
			}
		}
	}

	return st, nil
}

func (o openwrtDriver) Reboot(d *RouterDevice) error {
	sid, err := o.login(d)
	if err != nil {
		return err
	}
	o.rpc(d, sid, "system", "reboot", nil)
	invalidateRtrToken(d.ID)
	return nil
}

func (o openwrtDriver) SetWifiEnabled(d *RouterDevice, radioID string, enabled bool) error {
	sid, err := o.login(d)
	if err != nil {
		return err
	}
	val := "0"
	if enabled {
		val = "1"
	}
	_, err = o.rpc(d, sid, "uci", "set", map[string]any{
		"config": "wireless", "section": radioID,
		"values": map[string]any{"disabled": val},
	})
	if err != nil {
		return err
	}
	o.rpc(d, sid, "uci", "commit", map[string]any{"config": "wireless"})
	o.rpc(d, sid, "network", "reload", nil)
	return nil
}

func (o openwrtDriver) Clients(d *RouterDevice) ([]RouterClient, error) {
	sid, err := o.login(d)
	if err != nil {
		return nil, err
	}
	leases, err := o.rpc(d, sid, "luci-rpc", "getDHCPLeases", nil)
	if err != nil {
		return nil, err
	}
	v4, _ := leases["dhcp_leases"].([]any)
	var out []RouterClient
	for _, raw := range v4 {
		l, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := RouterClient{Online: true}
		if v, ok := l["macaddr"].(string); ok {
			c.MAC = v
		}
		if v, ok := l["ipaddr"].(string); ok {
			c.IP = v
		}
		if v, ok := l["hostname"].(string); ok {
			c.Hostname = v
		}
		out = append(out, c)
	}
	return out, nil
}

// ══════════════════════════════════════════════════════════════════════════════
// STEROWNIK MIKROTIK
// Protokół: REST API /rest/...  (RouterOS ≥ 7.1, Basic Auth)
// ══════════════════════════════════════════════════════════════════════════════

type mikrotikDriver struct{}

func (m mikrotikDriver) req(d *RouterDevice, method, path string, body map[string]any) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, d.baseURL()+path, bodyReader)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(d.Username, d.Password)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := rtrHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("brak połączenia z routerem: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("błędny login/hasło REST API")
	}
	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("REST API niedostępne — włącz usługę www/www-ssl w RouterOS i upewnij się że wersja ≥ 7.1")
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("kod HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (m mikrotikDriver) Status(d *RouterDevice) (*RouterStatus, error) {
	st := &RouterStatus{Model: d.Model}

	data, err := m.req(d, http.MethodGet, "/rest/system/resource", nil)
	if err != nil {
		st.Error = err.Error()
		return st, err
	}
	st.Online = true

	var res map[string]any
	json.Unmarshal(data, &res)

	if v, ok := res["board-name"].(string); ok {
		st.Model = v
	}
	if v, ok := res["version"].(string); ok {
		st.Firmware = v
	}
	if v, ok := res["uptime"].(string); ok {
		st.UptimeSec = parseMikrotikUptime(v)
	}
	if v, ok := res["cpu-load"].(string); ok {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			st.CPULoadPct = f
		}
	}
	total, _ := strconv.ParseFloat(fmt.Sprint(res["total-memory"]), 64)
	free, _ := strconv.ParseFloat(fmt.Sprint(res["free-memory"]), 64)
	if total > 0 {
		st.MemUsedPct = round2((total - free) / total * 100)
	}

	// WAN IP z pierwszego interfejsu z adresem globalnym
	if ifData, err := m.req(d, http.MethodGet, "/rest/ip/address", nil); err == nil {
		var ifaces []map[string]any
		if json.Unmarshal(ifData, &ifaces) == nil {
			for _, iface := range ifaces {
				if disabled, _ := iface["disabled"].(string); disabled == "true" {
					continue
				}
				if addr, ok := iface["address"].(string); ok {
					// Weź pierwsze nieprivate lub pierwszy dostępny
					st.WANIP = strings.Split(addr, "/")[0]
					st.WANConnected = true
					break
				}
			}
		}
	}

	// DHCP clients count
	if leaseData, err := m.req(d, http.MethodGet, "/rest/ip/dhcp-server/lease", nil); err == nil {
		var leases []any
		if json.Unmarshal(leaseData, &leases) == nil {
			st.ClientCount = len(leases)
		}
	}

	// Wi-Fi interfaces
	if wifiData, err := m.req(d, http.MethodGet, "/rest/interface/wifi", nil); err == nil {
		var wifis []map[string]any
		if json.Unmarshal(wifiData, &wifis) == nil {
			for i, w := range wifis {
				radio := RouterWifiRadio{
					ID:      fmt.Sprintf("wifi%d", i),
					Enabled: w["disabled"] != "true",
				}
				if v, ok := w["name"].(string); ok {
					radio.ID = v
				}
				if v, ok := w["ssid"].(string); ok {
					radio.SSID = v
				}
				if v, ok := w["band"].(string); ok {
					switch {
					case strings.Contains(v, "2ghz"):
						radio.Band = "2.4GHz"
					case strings.Contains(v, "5ghz"):
						radio.Band = "5GHz"
					case strings.Contains(v, "6ghz"):
						radio.Band = "6GHz"
					default:
						radio.Band = v
					}
				}
				st.Wifi = append(st.Wifi, radio)
			}
		}
	}

	return st, nil
}

func parseMikrotikUptime(s string) int64 {
	// Format: "3d2h15m10s"
	var total int64
	num := ""
	for _, c := range s {
		if c >= '0' && c <= '9' {
			num += string(c)
		} else {
			n, _ := strconv.ParseInt(num, 10, 64)
			switch c {
			case 'd':
				total += n * 86400
			case 'h':
				total += n * 3600
			case 'm':
				total += n * 60
			case 's':
				total += n
			}
			num = ""
		}
	}
	return total
}

func (m mikrotikDriver) Reboot(d *RouterDevice) error {
	_, err := m.req(d, http.MethodPost, "/rest/system/reboot", map[string]any{})
	return err
}

func (m mikrotikDriver) SetWifiEnabled(d *RouterDevice, radioID string, enabled bool) error {
	disabled := "true"
	if enabled {
		disabled = "false"
	}
	_, err := m.req(d, http.MethodPatch,
		"/rest/interface/wifi/"+radioID,
		map[string]any{"disabled": disabled})
	return err
}

func (m mikrotikDriver) Clients(d *RouterDevice) ([]RouterClient, error) {
	data, err := m.req(d, http.MethodGet, "/rest/ip/dhcp-server/lease", nil)
	if err != nil {
		return nil, err
	}
	var leases []map[string]any
	if err := json.Unmarshal(data, &leases); err != nil {
		return nil, fmt.Errorf("nieprawidłowa odpowiedź REST API")
	}
	var out []RouterClient
	for _, l := range leases {
		c := RouterClient{}
		if v, ok := l["mac-address"].(string); ok {
			c.MAC = v
		}
		if v, ok := l["address"].(string); ok {
			c.IP = v
		}
		if v, ok := l["host-name"].(string); ok {
			c.Hostname = v
		}
		status, _ := l["status"].(string)
		c.Online = status == "bound"
		out = append(out, c)
	}
	return out, nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func rtrReachable(host string, port int) bool {
	if port == 0 {
		port = 80
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func b64rtr(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

// GET /api/routers/models
func (s *Server) handleRouterModels(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{"models": RouterModels})
}

// POST /api/routers/dedup — usuwa istniejące duplikaty (ten sam host:port)
func (s *Server) handleRouterDedup(w http.ResponseWriter, r *http.Request) {
	rtrDevicesMu.Lock()
	seen := map[string]bool{}
	toDelete := []string{}
	for id, dev := range rtrDevices {
		key := fmt.Sprintf("%s:%d", dev.Host, dev.Port)
		if seen[key] {
			toDelete = append(toDelete, id)
		} else {
			seen[key] = true
		}
	}
	for _, id := range toDelete {
		delete(rtrDevices, id)
	}
	rtrDevicesMu.Unlock()
	saveRtrToDisk()
	jsonOK(w, map[string]any{"removed": len(toDelete), "status": "ok"})
}
// Body: {"host":"192.168.31.1","driver":"xiaomi"}
func (s *Server) handleRouterProbe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host   string `json:"host"`
		Driver string `json:"driver"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Host == "" {
		jsonErr(w, "wymagane pole: host", http.StatusBadRequest)
		return
	}

	type probeResult struct {
		Port      int    `json:"port"`
		Reachable bool   `json:"reachable"`
		HTTPS     bool   `json:"https"`
		Note      string `json:"note"`
	}

	// Porty do sprawdzenia w kolejności
	candidates := []struct {
		port  int
		https bool
	}{
		{80, false}, {8080, false}, {443, true}, {1234, false}, {8088, false},
	}

	var results []probeResult
	bestPort := 0
	bestHTTPS := false

	for _, c := range candidates {
		reachable := rtrReachable(req.Host, c.port)
		note := ""
		if reachable {
			if bestPort == 0 {
				bestPort = c.port
				bestHTTPS = c.https
			}
			note = "✓ odpowiada"
		}
		results = append(results, probeResult{
			Port: c.port, Reachable: reachable,
			HTTPS: c.https, Note: note,
		})
	}

	jsonOK(w, map[string]any{
		"results":      results,
		"best_port":    bestPort,
		"best_https":   bestHTTPS,
		"host":         req.Host,
		"reachable_any": bestPort > 0,
	})
}

// GET/POST /api/routers
func (s *Server) handleRouters(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rtrDevicesMu.Lock()
		list := make([]RouterDevice, 0, len(rtrDevices))
		for _, v := range rtrDevices {
			list = append(list, sanitizeRtr(v))
		}
		rtrDevicesMu.Unlock()
		jsonOK(w, map[string]any{"routers": list})

	case http.MethodPost:
		var dev RouterDevice
		if err := json.NewDecoder(r.Body).Decode(&dev); err != nil || dev.Host == "" || dev.Model == "" {
			jsonErr(w, "wymagane pola: host, model", http.StatusBadRequest)
			return
		}

		// Sprawdź czy router o tym samym host:port już istnieje — zapobiegaj duplikatom
		rtrDevicesMu.Lock()
		for _, existing := range rtrDevices {
			if existing.Host == dev.Host && existing.Port == dev.Port {
				existingID := existing.ID
				rtrDevicesMu.Unlock()
				jsonOK(w, map[string]string{"status": "exists", "id": existingID})
				return
			}
		}
		rtrDevicesMu.Unlock()

		if dev.ID == "" {
			dev.ID = fmt.Sprintf("rt-%d", time.Now().UnixNano())
		}
		if dev.Username == "" {
			dev.Username = "admin"
		}
		if dev.Name == "" {
			dev.Name = routerModelDef(dev.Model).Name
		}
		dev.CreatedAt = time.Now().Format(time.RFC3339)

		rtrDevicesMu.Lock()
		rtrDevices[dev.ID] = &dev
		rtrDevicesMu.Unlock()

		if err := saveRtrToDisk(); err != nil {
			jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]string{"status": "ok", "id": dev.ID})

	default:
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// /api/routers/{id}[/action]
func (s *Server) handleRouterItem(w http.ResponseWriter, r *http.Request) {
	suffix := pathSuffix(r, "/api/routers/")
	parts := strings.SplitN(suffix, "/", 2)
	id := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	rtrDevicesMu.Lock()
	dev, ok := rtrDevices[id]
	rtrDevicesMu.Unlock()

	if !ok {
		jsonErr(w, "router nie znaleziony", http.StatusNotFound)
		return
	}
	drv := driverFor(dev.Model)

	switch action {
	case "":
		switch r.Method {
		case http.MethodGet:
			jsonOK(w, sanitizeRtr(dev))

		case http.MethodPut, http.MethodPatch:
			var updated RouterDevice
			json.NewDecoder(r.Body).Decode(&updated)
			updated.ID = id
			if updated.Password == "" {
				updated.Password = dev.Password
			}
			if updated.Username == "" {
				updated.Username = dev.Username
			}
			updated.CreatedAt = dev.CreatedAt
			rtrDevicesMu.Lock()
			rtrDevices[id] = &updated
			rtrDevicesMu.Unlock()
			invalidateRtrToken(id)
			if err := saveRtrToDisk(); err != nil {
				jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError)
				return
			}
			jsonOK(w, map[string]string{"status": "ok"})

		case http.MethodDelete:
			rtrDevicesMu.Lock()
			delete(rtrDevices, id)
			rtrDevicesMu.Unlock()
			invalidateRtrToken(id)
			if err := saveRtrToDisk(); err != nil {
				jsonErr(w, "zapis nieudany: "+err.Error(), http.StatusInternalServerError)
				return
			}
			jsonOK(w, map[string]string{"status": "ok"})

		default:
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	case "debug":
		// GET /api/routers/{id}/debug — pokazuje surową odpowiedź logowania (diagnostyka)
		base := dev.baseURL()
		nonce := xiaomiNonce()
		hash := xiaomiHash(nonce, dev.Password)
		form := fmt.Sprintf("username=admin&password=%s&logtype=2&nonce=%s", hash, nonce)
		headers := map[string]string{
			"Referer": base + "/cgi-bin/luci/web",
			"Origin":  base,
		}

		results := []map[string]any{}
		for _, loginURL := range []string{
			base + "/cgi-bin/luci/api/xqsystem/login",
			base + "/api/xqsystem/login",
		} {
			entry := map[string]any{"url": loginURL}
			resp, err := xiaomiReq(http.MethodPost, loginURL, form,
				"application/x-www-form-urlencoded", headers)
			if err != nil {
				entry["error"] = err.Error()
			} else {
				body, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				entry["status"] = resp.StatusCode
				entry["body"] = string(body)
				var parsed map[string]any
				if json.Unmarshal(body, &parsed) == nil {
					entry["parsed"] = parsed
				}
			}
			results = append(results, entry)
		}
		jsonOK(w, map[string]any{"debug": results, "host": dev.Host, "port": dev.Port})

	case "test":
		reachable := rtrReachable(dev.Host, dev.Port)
		jsonOK(w, map[string]any{"reachable": reachable, "host": dev.Host, "port": dev.Port})

	case "status":
		st, err := drv.Status(dev)
		if err != nil && st == nil {
			jsonErr(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonOK(w, st)

	case "clients":
		clients, err := drv.Clients(dev)
		if err != nil {
			jsonErr(w, "pobranie klientów nieudane: "+err.Error(), http.StatusBadGateway)
			return
		}
		jsonOK(w, map[string]any{"clients": clients, "count": len(clients)})

	case "reboot":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := drv.Reboot(dev); err != nil {
			jsonErr(w, "restart nieudany: "+err.Error(), http.StatusBadGateway)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})

	case "wifi":
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Radio   string `json:"radio"`
			Enabled bool   `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Radio == "" {
			jsonErr(w, "wymagane pole: radio", http.StatusBadRequest)
			return
		}
		if err := drv.SetWifiEnabled(dev, body.Radio, body.Enabled); err != nil {
			jsonErr(w, "zmiana Wi-Fi nieudana: "+err.Error(), http.StatusBadGateway)
			return
		}
		jsonOK(w, map[string]string{"status": "ok"})

	default:
		jsonErr(w, "nieznana akcja", http.StatusNotFound)
	}
}
