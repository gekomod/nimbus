package api

import (
	"encoding/json"
	"net/http"
	"nimbus/internal/sys"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var dockerIdentifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)
var _dockerStatsAt time.Time // guarded by _dockerStatsCacheMu

func validDockerID(id string) bool { return dockerIdentifier.MatchString(id) }

func dockerCommandError(out string, err error) string {
	if strings.TrimSpace(out) != "" { return strings.TrimSpace(out) }
	return err.Error()
}

func dockerMemoryMiB(value string) float64 {
	fields := strings.Fields(strings.Split(value, "/")[0])
	if len(fields) == 0 { return 0 }
	v := fields[0]
	for _, unit := range []struct { suffix string; factor float64 }{
		{"GiB", 1024}, {"MiB", 1}, {"KiB", 1.0/1024}, {"GB", 1e9/1048576}, {"MB", 1e6/1048576}, {"kB", 1e3/1048576}, {"B", 1.0/1048576},
	} {
		if strings.HasSuffix(v, unit.suffix) { n, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(v, unit.suffix)), 64); return n*unit.factor }
	}
	return 0
}

func applyDockerStats(containers []sys.Container) {
	startDockerStatsPoller()
	_dockerStatsCacheMu.RLock()
	defer _dockerStatsCacheMu.RUnlock()
	if time.Since(_dockerStatsAt) > 20*time.Second { return }
	for _, raw := range _dockerStatsCache {
		var stat struct { ID, Name, CPU, Mem string }
		if json.Unmarshal(raw, &stat) != nil { continue }
		for i := range containers {
			c := &containers[i]
			if c.State == "running" && (c.ID == stat.ID || c.Name == stat.Name) {
				c.CPU, _ = strconv.ParseFloat(strings.TrimSuffix(stat.CPU, "%"), 64)
				c.Mem = dockerMemoryMiB(stat.Mem)
				c.StatsAvailable = true
			}
		}
	}
}

func (s *Server) updateDockerResources(w http.ResponseWriter, r *http.Request, id string) {
	var req struct {
		Restart string `json:"restart"`
		MemoryMiB int64 `json:"memory_mib"`
		CPUs float64 `json:"cpus"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil { jsonErr(w, "invalid configuration", 400); return }
	switch req.Restart { case "no", "always", "unless-stopped", "on-failure": default: jsonErr(w, "invalid restart policy", 400); return }
	if req.MemoryMiB < 0 || (req.MemoryMiB > 0 && req.MemoryMiB < 6) || req.MemoryMiB > 10485760 || req.CPUs < 0 || req.CPUs > 4096 { jsonErr(w, "invalid resource limits", 400); return }
	// Changing memory must also account for an existing swap limit.
	memory, swap := "0", "-1"
	if req.MemoryMiB > 0 { memory = strconv.FormatInt(req.MemoryMiB, 10)+"m"; swap = strconv.FormatInt(req.MemoryMiB*2, 10)+"m" }
	out, err := runCmd("docker", "update", "--restart", req.Restart, "--memory", memory, "--memory-swap", swap, "--cpus", strconv.FormatFloat(req.CPUs, 'f', -1, 64), id)
	if err != nil { jsonErr(w, dockerCommandError(out, err), 500); return }
	jsonOK(w, map[string]string{"status":"ok", "output":out})
}
