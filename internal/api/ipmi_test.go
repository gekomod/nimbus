package api

import "testing"

func TestParseIPMISensorList(t *testing.T) {
	input := `01-Inlet Ambient | 24,000 | degrees C | ok | na | na | na | 42,000 | 47,000 | 52,000
02-CPU 1 | 61.000 | degrees C | ok | na | na | na | 75.000 | 85.000 | 95.000
Fan 1 | 2400.000 | RPM | ok | na | na | 800.000 | na | na | 5000.000
Fan 2 | 0.000 | RPM | cr | na | na | 800.000 | na | na | 5000.000
Unused | na | degrees C | ns | na | na | na | na | na | na`

	sensors := parseIPMISensorList(input)
	if len(sensors) != 5 {
		t.Fatalf("expected 5 sensors, got %d: %+v", len(sensors), sensors)
	}
	if sensors[0].Val != 24 || sensors[0].Warn != 47 || sensors[0].Crit != 52 {
		t.Fatalf("locale or temperature thresholds parsed incorrectly: %+v", sensors[0])
	}
	if sensors[2].Unit != "RPM" || sensors[2].Warn != 800 {
		t.Fatalf("fan threshold parsed incorrectly: %+v", sensors[2])
	}
	if sensors[3].Val != 0 {
		t.Fatalf("stopped fan must remain visible: %+v", sensors[3])
	}
}

func TestChassisFromOutput(t *testing.T) {
	chassis, power := chassisFromOutput(`System Power : on
Chassis Intrusion : inactive
Front-Panel Lockout : inactive`)
	if power != "ON" {
		t.Fatalf("expected power ON, got %q", power)
	}
	if chassis.Intrusion != "OK — obudowa zamknięta" || chassis.FrontPanel != "OK" {
		t.Fatalf("unexpected chassis state: %+v", chassis)
	}
}

func TestParsePSUStatusKeepsFailures(t *testing.T) {
	statuses := parsePSUStatus("Power Supply 1 | 01h | ok\nPower Supply 2 | 02h | failure")
	if len(statuses) != 2 || statuses[0] != "OK" || statuses[1] != "FAILURE" {
		t.Fatalf("unexpected PSU statuses: %#v", statuses)
	}
}

func TestIPMIFansKeepPercentDiscreteAndMissingReadings(t *testing.T) {
	input := `Fan 1 | 47.000 | percent | ok | na | na | na | na | na | na
Fan 2 | 0x01 | discrete | 0x0100 | na | na | na | na | na | na
Fan 3 | na | RPM | ns | na | na | na | na | na | na
CPU Temp | na | degrees C | ns | na | na | na | na | na | na`
	sensors := parseIPMISensorList(input)
	if len(sensors) != 4 { t.Fatalf("lost readings: %+v", sensors) }
	if sensors[0].Kind != "fan" || sensors[0].Unit != "%" || sensors[0].Val != 47 || sensors[0].Warn != 0 { t.Fatalf("wrong percentage reading: %+v", sensors[0]) }
	if !sensors[1].Discrete || sensors[1].RawValue != "0x01" || sensors[1].Kind != "fan" { t.Fatalf("lost discrete fan: %+v", sensors[1]) }
	if !sensors[2].Unavailable || sensors[2].Kind != "fan" { t.Fatalf("missing fan hidden: %+v", sensors[2]) }
	if !sensors[3].Unavailable || sensors[3].Unit != "°C" { t.Fatalf("missing temperature hidden: %+v", sensors[3]) }
}
