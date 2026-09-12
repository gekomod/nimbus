package api

// Read kernel counters only: no smartctl, disk probing or controller commands.
import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type dashboardCounter struct {
	Read  uint64 `json:"read"`
	Write uint64 `json:"write"`
}

func dashboardUint(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
}

func (s *Server) handleDashboardIO(w http.ResponseWriter, r *http.Request) {
	disks := map[string]dashboardCounter{}
	network := map[string]dashboardCounter{}
	issues := map[string]string{}
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		issues["disks"] = err.Error()
	}
	for _, entry := range entries {
		base := filepath.Join("/sys/block", entry.Name())
		// Excludes partitions, dm/md stacks, loop and RAM devices; avoids double counting.
		if _, err := os.Stat(filepath.Join(base, "device")); err != nil {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(base, "stat"))
		if err != nil {
			issues["disks"] = "Niepełny odczyt liczników dysków"
			continue
		}
		fields := strings.Fields(string(raw))
		if len(fields) < 7 {
			issues["disks"] = "Niepełny licznik dysku"
			continue
		}
		rd, e1 := strconv.ParseUint(fields[2], 10, 64)
		wr, e2 := strconv.ParseUint(fields[6], 10, 64)
		if e1 != nil || e2 != nil {
			issues["disks"] = "Nieprawidłowy licznik dysku"
			continue
		}
		disks[entry.Name()] = dashboardCounter{Read: rd * 512, Write: wr * 512}
	}
	entries, err = os.ReadDir("/sys/class/net")
	if err != nil {
		issues["network"] = err.Error()
	}
	for _, entry := range entries {
		base := filepath.Join("/sys/class/net", entry.Name())
		if _, err := os.Stat(filepath.Join(base, "device")); err != nil {
			continue
		}
		rx, e1 := dashboardUint(filepath.Join(base, "statistics/rx_bytes"))
		tx, e2 := dashboardUint(filepath.Join(base, "statistics/tx_bytes"))
		if e1 != nil || e2 != nil {
			issues["network"] = "Niepełny odczyt liczników sieci"
			continue
		}
		network[entry.Name()] = dashboardCounter{Read: rx, Write: tx}
	}
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	jsonOK(w, map[string]any{"t": time.Now().UnixMilli(), "boot": strings.TrimSpace(string(boot)), "disks": disks, "network": network, "errors": issues})
}
