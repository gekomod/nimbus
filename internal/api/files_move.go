package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

var filesMoveLock sync.Mutex

type fileMoveResult struct {
	Source string `json:"source"`
	Target string `json:"target,omitempty"`
	Moved  bool   `json:"moved"`
	Error  string `json:"error,omitempty"`
}

// Resolve parents, but never follow a source symlink: move the link itself.
func moveSource(path string) (string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) == "/" {
		return "", fmt.Errorf("wymagana bezwzględna ścieżka elementu innego niż /")
	}
	path = filepath.Clean(path)
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	return filepath.Join(parent, filepath.Base(path)), nil
}

func moveFile(source, destination string) fileMoveResult {
	result := fileMoveResult{Source: source}
	fail := func(err error) fileMoveResult { result.Error = err.Error(); return result }
	src, err := moveSource(source)
	if err != nil {
		return fail(err)
	}
	info, err := os.Lstat(src)
	if err != nil {
		return fail(err)
	}
	if !filepath.IsAbs(destination) {
		return fail(fmt.Errorf("katalog docelowy musi mieć ścieżkę bezwzględną"))
	}
	dest, err := filepath.EvalSymlinks(destination)
	if err != nil {
		return fail(err)
	}
	dir, err := os.Stat(dest)
	if err != nil {
		return fail(err)
	}
	if !dir.IsDir() {
		return fail(fmt.Errorf("cel nie jest katalogiem"))
	}
	target := filepath.Join(dest, filepath.Base(src))
	result.Target = target
	if src == target {
		return fail(fmt.Errorf("element znajduje się już w katalogu docelowym"))
	}
	if info.IsDir() && (dest == src || strings.HasPrefix(dest, src+string(os.PathSeparator))) {
		return fail(fmt.Errorf("nie można przenieść folderu do jego wnętrza"))
	}
	if _, err = os.Lstat(target); err == nil {
		return fail(fmt.Errorf("element docelowy już istnieje; niczego nie nadpisano"))
	} else if !os.IsNotExist(err) {
		return fail(err)
	}
	// GNU mv handles cross-filesystem copies, metadata and symlinks. -n forbids
	// clobbering even if a target appears after our check; -T fixes target semantics.
	output, err := exec.Command("mv", "-n", "-T", "--", src, target).CombinedOutput()
	if err != nil {
		return fail(fmt.Errorf("przenoszenie: %v: %s", err, strings.TrimSpace(string(output))))
	}
	if _, err = os.Lstat(src); !os.IsNotExist(err) {
		return fail(fmt.Errorf("źródło nadal istnieje; sprawdź cel przed ponowieniem (możliwy konflikt nazwy)"))
	}
	if _, err = os.Lstat(target); err != nil {
		return fail(fmt.Errorf("nie można potwierdzić celu: %w", err))
	}
	result.Moved = true
	return result
}

// POST /api/files/move {"paths":["/data/file"],"destination":"/archive"}
// Every source has its own outcome: a batch may succeed only partially.
func (s *Server) handleFilesMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Paths       []string `json:"paths"`
		Destination string   `json:"destination"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		jsonErr(w, "nieprawidłowe żądanie: "+err.Error(), 400)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		jsonErr(w, "nieprawidłowe zakończenie JSON", 400)
		return
	}
	if len(req.Paths) == 0 || len(req.Paths) > 500 || !filepath.IsAbs(req.Destination) {
		jsonErr(w, "podaj 1–500 elementów i bezwzględny katalog docelowy", 400)
		return
	}
	if !filesMoveLock.TryLock() {
		jsonErr(w, "inna operacja przenoszenia trwa; poczekaj na jej zakończenie", 409)
		return
	}
	defer filesMoveLock.Unlock()
	results := make([]fileMoveResult, 0, len(req.Paths))
	moved := 0
	for _, path := range req.Paths {
		result := moveFile(path, req.Destination)
		results = append(results, result)
		if result.Moved {
			moved++
		}
	}
	jsonOK(w, map[string]any{"ok": moved == len(req.Paths), "moved": moved, "results": results})
}
