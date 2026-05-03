package sys

// sysmon.go — background monitor który zbiera dane co N sekund
// CPUPercent() i Processes() zwracają z cache — ZERO blokowania HTTP

import (
	"sync"
	"time"
)

var mon = &sysMonitor{}

type sysMonitor struct {
	once sync.Once

	mu      sync.RWMutex
	cpuPct  float64
	procs   []Process
}

// Start uruchamia background goroutine — wywoływane raz przy starcie serwera.
func StartMonitor() {
	mon.once.Do(func() {
		// Pierwsze zbieranie w tle — nie blokuj startu
		go mon.run()
	})
}

func (m *sysMonitor) run() {
	// Pierwsze CPU sample — musimy poczekać na deltę, robimy to w tle
	s1 := readCPUSample()
	time.Sleep(500 * time.Millisecond)
	s2 := readCPUSample()
	m.mu.Lock()
	m.cpuPct = calcCPU(s1, s2)
	m.mu.Unlock()

	// Pierwsze procesy
	m.mu.Lock()
	m.procs = collectProcs(s1, s2)
	m.mu.Unlock()

	cpuTick  := time.NewTicker(2 * time.Second)
	procTick := time.NewTicker(8 * time.Second)
	defer cpuTick.Stop()
	defer procTick.Stop()

	for {
		select {
		case <-cpuTick.C:
			s1 := readCPUSample()
			time.Sleep(200 * time.Millisecond)
			s2 := readCPUSample()
			m.mu.Lock()
			m.cpuPct = calcCPU(s1, s2)
			m.mu.Unlock()

		case <-procTick.C:
			s1 := readCPUSample()
			time.Sleep(200 * time.Millisecond)
			s2 := readCPUSample()
			p := collectProcs(s1, s2)
			m.mu.Lock()
			m.procs = p
			m.mu.Unlock()
		}
	}
}

func calcCPU(s1, s2 CPUSample) float64 {
	dt := s2.Total - s1.Total
	if dt == 0 { return 0 }
	return float64(dt-(s2.Idle-s1.Idle)) / float64(dt) * 100
}

// CPUPercent zwraca ostatnią zmierzoną wartość z cache — natychmiastowe, zero sleep.
func CPUPercent() float64 {
	StartMonitor()
	mon.mu.RLock()
	defer mon.mu.RUnlock()
	return mon.cpuPct
}

// Processes zwraca ostatnią listę procesów z cache — natychmiastowe, zero sleep.
func Processes() []Process {
	StartMonitor()
	mon.mu.RLock()
	defer mon.mu.RUnlock()
	out := make([]Process, len(mon.procs))
	copy(out, mon.procs)
	return out
}
