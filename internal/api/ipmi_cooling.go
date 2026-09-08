package api

import (
	"net/http"
	"os"
	"strings"
	"time"
)

// Explicit diagnostics only. No reset, OEM raw command or fan override is issued.
func (s *Server) handleIPMICoolingDiagnostics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet { jsonErr(w, "method not allowed", 405); return }
	if !ipmiRefreshMu.TryLock() { jsonErr(w, "Trwa odczyt czujników. Spróbuj ponownie po jego zakończeniu.", 409); return }
	defer ipmiRefreshMu.Unlock()
	type result struct {
		Command string `json:"command"`
		Output string `json:"output"`
		Error string `json:"error,omitempty"`
		DurationMS int64 `json:"duration_ms"`
	}
	results := []result{}
	for _, args := range [][]string{{"mc","info"},{"sdr","type","Fan"},{"sdr","type","Temperature"},{"sel","elist","last","20"}} {
		if r.Context().Err() != nil { return }
		start := time.Now()
		out, err := ipmiRun(args...)
		row := result{Command:"ipmitool "+strings.Join(args," "), Output:out, DurationMS:time.Since(start).Milliseconds()}
		if err != nil { row.Error=err.Error() }
		results=append(results,row)
		// Stop on a timeout; do not repeatedly hammer an unresponsive BMC.
		if err != nil && strings.Contains(err.Error(),"brak odpowiedzi BMC") { break }
	}
	vendor,_ := os.ReadFile("/sys/class/dmi/id/sys_vendor")
	model,_ := os.ReadFile("/sys/class/dmi/id/product_name")
	jsonOK(w,map[string]any{"vendor":strings.TrimSpace(string(vendor)),"model":strings.TrimSpace(string(model)),"collected_at":time.Now().UTC().Format(time.RFC3339),"results":results,"fan_control":"unverified","message":"Nie potwierdzono interfejsu ręcznego sterowania wentylatorami tego BMC. Raport zawiera wyłącznie odczyty."})
}
