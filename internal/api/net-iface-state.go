package api

// ─── Rzeczywisty stan interfejsów z ip link show ───────────────────────────────
//
// Backend sieciowy (handleNetworkOverview) pobiera stan interfejsów przez
// netlink/procfs, ale interfejsy takie jak wg0 uruchomione ręcznie (bez systemd)
// mogą mieć błędnie zwrócony state="down". Ten plik dodaje middleware który
// po obsłużeniu /api/network koryguje pole State przez "ip link show".

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// ifaceLinkState zwraca "up" lub "down" — używa /sys/class/net (nie wymaga zewnętrznych komend)
func ifaceLinkState(name string) string {
	flagsData, err := os.ReadFile("/sys/class/net/" + name + "/flags")
	if err != nil { return "down" }
	flags, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(string(flagsData), "0x")), 16, 32)
	if err != nil || flags&0x1 == 0 { return "down" }
	oper, _ := os.ReadFile("/sys/class/net/" + name + "/operstate")
	if strings.TrimSpace(string(oper)) == "down" { return "no-carrier" }
	return "up"
}

// networkOverviewWithRealStates opakowuje handleNetworkOverview i koryguje
// stan interfejsów przez ip link show przed wysłaniem odpowiedzi do klienta.
func (s *Server) networkOverviewWithRealStates(inner http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Przechwyć odpowiedź wewnętrznego handlera
		rec := &responseRecorder{header: w.Header().Clone(), code: 200}
		inner(rec, r)

		// Jeśli nie JSON — przepuść bez zmian
		ct := rec.header.Get("Content-Type")
		if !strings.Contains(ct, "application/json") && !strings.Contains(string(rec.body), "interfaces") {
			w.WriteHeader(rec.code)
			w.Write(rec.body)
			return
		}

		// Parsuj JSON
		var data map[string]any
		if err := json.Unmarshal(rec.body, &data); err != nil {
			w.WriteHeader(rec.code)
			w.Write(rec.body)
			return
		}

		// Koryguj stany interfejsów
		if ifaces, ok := data["interfaces"].([]any); ok {
			for _, raw := range ifaces {
				iface, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				name, _ := iface["Name"].(string)
				if name == "" {
					name, _ = iface["name"].(string)
				}
				if name == "" {
					continue
				}
				real := ifaceLinkState(name)
				if real != "" {
					iface["state"] = real
				}
			}
		}

		// Zapisz z powrotem
		fixed, err := json.Marshal(data)
		if err != nil {
			w.WriteHeader(rec.code)
			w.Write(rec.body)
			return
		}

		for k, vs := range rec.header {
			for _, v := range vs {
				w.Header().Set(k, v)
			}
		}
		w.WriteHeader(rec.code)
		w.Write(fixed)
	}
}

// responseRecorder przechwytuje odpowiedź handlera
type responseRecorder struct {
	header http.Header
	body   []byte
	code   int
}

func (r *responseRecorder) Header() http.Header        { return r.header }
func (r *responseRecorder) WriteHeader(code int)       { r.code = code }
func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body = append(r.body, b...)
	return len(b), nil
}
