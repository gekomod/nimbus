package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDashboardIOKernelCounters(t *testing.T) {
	r := httptest.NewRecorder()
	(&Server{}).handleDashboardIO(r, httptest.NewRequest("GET", "/api/dashboard/io", nil))
	if r.Code != 200 {
		t.Fatalf("HTTP %d", r.Code)
	}
	var got struct {
		T       int64                       `json:"t"`
		Disks   map[string]dashboardCounter `json:"disks"`
		Network map[string]dashboardCounter `json:"network"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.T <= 0 || got.Disks == nil || got.Network == nil {
		t.Fatal("missing timestamp or counter maps")
	}
	for name := range got.Disks {
		if _, err := os.Stat(filepath.Join("/sys/block", name, "device")); err != nil {
			t.Fatalf("non-device disk included: %s", name)
		}
	}
	for name := range got.Network {
		if _, err := os.Stat(filepath.Join("/sys/class/net", name, "device")); err != nil {
			t.Fatalf("virtual interface included: %s", name)
		}
	}
}

func TestDashboardUintRejectsMissingOrMalformedCounters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "counter")
	if _, err := dashboardUint(path); err == nil {
		t.Fatal("missing counter accepted")
	}
	for _, value := range []string{"", "not-a-counter", "-5"} {
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := dashboardUint(path); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	if err := os.WriteFile(path, []byte("0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if v, err := dashboardUint(path); err != nil || v != 0 {
		t.Fatalf("real zero rejected: %v %v", v, err)
	}
}
