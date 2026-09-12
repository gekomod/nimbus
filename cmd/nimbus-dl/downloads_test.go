package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestClearDonePreservesFailuresAndActiveTasks(t *testing.T) {
	oldTasks, oldOrder, oldPath := dlTasks, dlOrder, statePath
	t.Cleanup(func() { dlTasks = oldTasks; dlOrder = oldOrder; statePath = oldPath })
	statePath = filepath.Join(t.TempDir(), "downloads.json")
	dlTasks = map[string]*DownloadTask{"done": {ID: "done", Status: "done"}, "error": {ID: "error", Status: "error", Error: "checksum"}, "cancelled": {ID: "cancelled", Status: "cancelled"}, "active": {ID: "active", Status: "downloading"}}
	dlOrder = []string{"done", "error", "cancelled", "active"}
	rec := httptest.NewRecorder()
	handleDownloadsClearDone(rec, httptest.NewRequest("POST", "/api/downloads/clear-done", nil))
	if rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	if _, ok := dlTasks["done"]; ok {
		t.Fatal("done task retained")
	}
	if len(dlTasks) != 3 || dlTasks["error"].Error != "checksum" {
		t.Fatal("lost unfinished task history")
	}
}
func TestDownloadsListProvidesSnapshotsAndUnknownFreeSpace(t *testing.T) {
	oldTasks, oldOrder, oldConfig := dlTasks, dlOrder, configPath
	t.Cleanup(func() { dlTasks = oldTasks; dlOrder = oldOrder; configPath = oldConfig })
	configPath = filepath.Join(t.TempDir(), "absent.json")
	dlTasks = map[string]*DownloadTask{"one": {ID: "one", Status: "downloading", Progress: 15}}
	dlOrder = []string{"one"}
	rec := httptest.NewRecorder()
	handleDownloadsList(rec, httptest.NewRequest("GET", "/api/downloads", nil))
	var data map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if _, ok := data["free_bytes"]; !ok {
		t.Fatal("free space field missing")
	}
	var tasks []DownloadTask
	if err := json.Unmarshal(data["tasks"], &tasks); err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].Progress != 15 {
		t.Fatal(tasks)
	}
}
