package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json encode: %v", err)
	}
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, `{"error":%q}`, msg)
}

func round2(f float64) float64 { return float64(int(f*100)) / 100 }

// cmdSem limituje równoczesne wywołania exec.Command do 8
// Bez limitu każdy request może tworzyć nowy proces OS
var cmdSem = make(chan struct{}, 8)

func runCmd(name string, args ...string) (string, error) {
	cmdSem <- struct{}{}
	defer func() { <-cmdSem }()
	out, err := exec.Command(name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func serviceActive(name string) bool {
	return exec.Command("systemctl", "is-active", "--quiet", name).Run() == nil
}

func serviceEnabled(name string) bool {
	return exec.Command("systemctl", "is-enabled", "--quiet", name).Run() == nil
}

func isInstalled(bin string) bool {
	_, err := exec.LookPath(bin)
	return err == nil
}

func pathSuffix(r *http.Request, prefix string) string {
	return strings.TrimPrefix(r.URL.Path, prefix)
}

func safeJSON(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 0 || (s[0] != '{' && s[0] != '[') {
		return `{}`
	}
	return s
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

func readFileStr(path string) string {
	b, _ := os.ReadFile(path)
	return string(b)
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
