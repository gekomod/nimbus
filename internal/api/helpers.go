package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
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
	select {
	case cmdSem <- struct{}{}:
	case <-time.After(5 * time.Second): return "", fmt.Errorf("serwer jest zajęty operacjami systemowymi")
	}
	defer func() { <-cmdSem }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded { return strings.TrimSpace(string(out)), fmt.Errorf("polecenie %s przekroczyło limit 30 minut", name) }
	return strings.TrimSpace(string(out)), err
}

func runCmdInput(input, name string, args ...string) (string, error) {
	select {
	case cmdSem <- struct{}{}:
	case <-time.After(5 * time.Second): return "", fmt.Errorf("serwer jest zajęty operacjami systemowymi")
	}
	defer func() { <-cmdSem }()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = strings.NewReader(input)
	out, err := cmd.CombinedOutput()
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
