package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeDockerWorkspace(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestDockerWorkspaceActionFailuresAndMethodGuards(t *testing.T) {
	fakeDockerWorkspace(t, "echo 'daemon refused operation'; exit 1\n")
	for _, tc := range []struct{ method, path, body string; code int }{
		{"POST", "/services/docker/container/abc123/start", "", 500},
		{"POST", "/services/docker/container/abc123/restart", "", 500},
		{"DELETE", "/services/docker/container/abc123", "", 500},
		{"GET", "/services/docker/container/abc123/stop", "", 405},
		{"POST", "/services/docker/container/--help/start", "", 400},
		{"POST", "/services/docker/container/abc123/typo", "", 404},
		{"PUT", "/services/docker/container/abc123/config", `{"restart":"always","memory_mib":-1}`, 400},
		{"PUT", "/services/docker/container/abc123/config", `{"restart":"always","memory_mib":128,"cpus":1}`, 500},
		{"POST", "/services/docker/container/abc123/mount-volume", "{}", 409},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			(&Server{}).handleDockerContainerAction(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
			if w.Code != tc.code { t.Fatalf("status %d: %s", w.Code, w.Body.String()) }
			if tc.code == 500 && !strings.Contains(w.Body.String(), "daemon refused operation") { t.Fatal("Docker diagnostic was lost") }
		})
	}
}

func TestDockerWorkspaceLogsKeepErrorsAndBoundTail(t *testing.T) {
	fakeDockerWorkspace(t, "echo 'logging driver unavailable'; exit 1\n")
	for _, tc := range []struct{ tail string; code int }{{"500", 500}, {"all", 400}, {"5001", 400}, {"0", 400}} {
		w := httptest.NewRecorder()
		(&Server{}).handleDockerContainerLogs(w, httptest.NewRequest("GET", "/services/docker/container/logs/abc123?tail="+tc.tail, nil))
		if w.Code != tc.code { t.Fatalf("tail %s: got %d", tc.tail, w.Code) }
	}
}

func TestComposeWorkspaceStates(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{`[]`, "stopped"},
		{`[{"State":"running","Health":"healthy"}]`, "running"},
		{"{\"State\":\"running\"}\n{\"State\":\"exited\"}", "partial"},
		{`[{"State":"running","Health":"unhealthy"}]`, "problem"},
		{`[{"State":"restarting"}]`, "problem"},
		{`[{"State":"exited"}]`, "stopped"},
		{`not json`, "unknown"},
	} {
		if got := composeProjectState(tc.input); got != tc.want { t.Errorf("%s: got %s, want %s", tc.input, got, tc.want) }
	}
}

func TestComposeWorkspaceValidationDoesNotOverwriteOriginal(t *testing.T) {
	fakeDockerWorkspace(t, "echo 'invalid YAML'; exit 1\n")
	file := filepath.Join(t.TempDir(), "compose.yaml")
	if err := os.WriteFile(file, []byte("original"), 0600); err != nil { t.Fatal(err) }
	_, err := validateComposeContent(file, "broken: [", "test")
	if err == nil { t.Fatal("invalid YAML accepted") }
	content, _ := os.ReadFile(file)
	if string(content) != "original" { t.Fatal("validation overwrote original") }
	files, _ := os.ReadDir(filepath.Dir(file))
	if len(files) != 1 { t.Fatal("validation left temporary files") }
}

func TestComposeWorkspaceDeployFailureReportsSavedFile(t *testing.T) {
	fakeDockerWorkspace(t, "case \"$*\" in *'config --quiet') exit 0;; *) echo 'port already allocated'; exit 1;; esac\n")
	file := filepath.Join(t.TempDir(), "compose.yaml")
	if err := os.WriteFile(file, []byte("original"), 0600); err != nil { t.Fatal(err) }
	body, _ := json.Marshal(map[string]string{"name":"test", "file":file, "content":"services: {}", "action":"deploy"})
	w := httptest.NewRecorder()
	(&Server{}).handleDockerProjectWrite(w, httptest.NewRequest("POST", "/api/docker/workspace/compose", strings.NewReader(string(body))))
	var response struct { Saved bool; File, Error string }
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil { t.Fatal(err) }
	if w.Code != 500 || !response.Saved || response.File != file || !strings.Contains(response.Error, "port already allocated") { t.Fatalf("unexpected response: %s", w.Body.String()) }
	content, _ := os.ReadFile(file)
	if string(content) != "services: {}" { t.Fatal("saved content missing") }
}

func TestDockerWorkspaceMemoryUnits(t *testing.T) {
	for input, want := range map[string]float64{"1.5GiB / 4GiB":1536, "64MiB / 2GiB":64, "512KiB / 1GiB":0.5, "0B / 0B":0} {
		if got := dockerMemoryMiB(input); got != want { t.Errorf("%s: got %f, want %f", input, got, want) }
	}
}
