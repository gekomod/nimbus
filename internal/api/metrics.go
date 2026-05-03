package api

// metrics.go — historia metryk CPU/RAM/dyski zapisywana co minutę
// Przechowuje ostatnie 24h danych (1440 próbek)
// GET /api/metrics?range=1h|6h|24h

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"nimbus/internal/sys"
)

const metricsFile = "/var/lib/nimbus/metrics.json"
const maxSamples  = 1440 // 24h przy próbce co 1min

type MetricSample struct {
	T      int64   `json:"t"`    // unix timestamp
	CPU    float64 `json:"cpu"`
	Mem    float64 `json:"mem"`
	Load1  float64 `json:"load1"`
	DiskPcts map[string]float64 `json:"disk,omitempty"` // mount → used%
}

var (
	metricsData   []MetricSample
	metricsMu     sync.RWMutex
	metricsOnce   sync.Once
)

func StartMetricsCollector() {
	metricsOnce.Do(func() {
		// Wczytaj istniejące dane z dysku
		loadMetricsFromDisk()

		go func() {
			// Pierwsza próbka od razu
			collectMetricSample()

			ticker := time.NewTicker(1 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				collectMetricSample()
			}
		}()
	})
}

func collectMetricSample() {
	cpuPct := sys.CPUPercent()
	mem    := sys.Memory()
	load   := sys.LoadAvg()
	mounts := cachedMounts()

	memPct := 0.0
	if mem.TotalKB > 0 {
		memPct = float64(mem.TotalKB-mem.AvailableKB) / float64(mem.TotalKB) * 100
	}

	diskPcts := map[string]float64{}
	for _, m := range mounts {
		if m.TotalB == 0 { continue }
		usedPct := float64(m.TotalB-m.FreeB) / float64(m.TotalB) * 100
		diskPcts[m.MountAt] = usedPct
	}

	sample := MetricSample{
		T:        time.Now().Unix(),
		CPU:      cpuPct,
		Mem:      memPct,
		Load1:    load[0],
		DiskPcts: diskPcts,
	}

	metricsMu.Lock()
	metricsData = append(metricsData, sample)
	// Ogranicz do maxSamples
	if len(metricsData) > maxSamples {
		metricsData = metricsData[len(metricsData)-maxSamples:]
	}
	metricsMu.Unlock()

	// Zapisz na dysk co 10 próbek (co ~10min)
	metricsMu.RLock()
	n := len(metricsData)
	metricsMu.RUnlock()
	if n % 10 == 0 {
		saveMetricsToDisk()
	}
}

func loadMetricsFromDisk() {
	data, err := os.ReadFile(metricsFile)
	if err != nil { return }
	var samples []MetricSample
	if err := json.Unmarshal(data, &samples); err != nil { return }
	metricsMu.Lock()
	metricsData = samples
	metricsMu.Unlock()
}

func saveMetricsToDisk() {
	metricsMu.RLock()
	data, err := json.Marshal(metricsData)
	metricsMu.RUnlock()
	if err != nil { return }
	os.MkdirAll("/var/lib/nimbus", 0755)
	os.WriteFile(metricsFile, data, 0644)
}

// handleMetrics zwraca historię metryk dla wybranego zakresu.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	rangeStr := r.URL.Query().Get("range")
	var since time.Time
	switch rangeStr {
	case "1h":  since = time.Now().Add(-1  * time.Hour)
	case "6h":  since = time.Now().Add(-6  * time.Hour)
	case "12h": since = time.Now().Add(-12 * time.Hour)
	default:    since = time.Now().Add(-24 * time.Hour) // domyślnie 24h
	}

	metricsMu.RLock()
	all := make([]MetricSample, len(metricsData))
	copy(all, metricsData)
	metricsMu.RUnlock()

	// Filtruj po czasie
	sinceUnix := since.Unix()
	var filtered []MetricSample
	for _, s := range all {
		if s.T >= sinceUnix {
			filtered = append(filtered, s)
		}
	}

	if filtered == nil { filtered = []MetricSample{} }

	// Zwróć też aktualny stan
	cpuNow := sys.CPUPercent()
	mem    := sys.Memory()
	memPct := 0.0
	if mem.TotalKB > 0 {
		memPct = float64(mem.TotalKB-mem.AvailableKB) / float64(mem.TotalKB) * 100
	}

	jsonOK(w, map[string]any{
		"samples":   filtered,
		"range":     rangeStr,
		"cpu_now":   cpuNow,
		"mem_now":   memPct,
		"count":     len(filtered),
	})
}
