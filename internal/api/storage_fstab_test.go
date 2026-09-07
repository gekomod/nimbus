package api

import (
	"strings"
	"testing"
)

func TestFstabHasMountMatchesDeviceUUIDAndTarget(t *testing.T) {
	entries := parseFstab(`# system
UUID=root-uuid / ext4 defaults 0 1
UUID=data-uuid /mnt/data ext4 rw,nofail 0 2
`)

	for _, test := range []struct {
		name   string
		device string
		target string
		uuid   string
	}{
		{name: "uuid", device: "/dev/sdb1", uuid: "data-uuid"},
		{name: "target", device: "/dev/disk/by-label/data", target: "/mnt/data"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if !fstabHasMount(entries, test.device, test.target, test.uuid) {
				t.Fatalf("expected mount to match: %+v", test)
			}
		})
	}
	if fstabHasMount(entries, "/dev/sdc1", "/mnt/other", "other-uuid") {
		t.Fatal("unrelated mount unexpectedly matched")
	}
}

func TestUpdateFstabEntryEnableReplacesOldEntryAndPreservesComments(t *testing.T) {
	before := `# Nimbus storage
UUID=root-uuid / ext4 defaults 0 1
/dev/sdb1 /mnt/old ext4 defaults 0 2
`
	after := updateFstabEntry(before, "/dev/sdb1", "/mnt/data", "data-uuid", "xfs", "rw,nofail", true)

	if !strings.Contains(after, "# Nimbus storage") || !strings.Contains(after, "UUID=root-uuid / ext4 defaults 0 1") {
		t.Fatalf("unrelated fstab content was lost:\n%s", after)
	}
	if strings.Contains(after, "/mnt/old") {
		t.Fatalf("old device entry was not replaced:\n%s", after)
	}
	if !strings.Contains(after, "UUID=data-uuid\t/mnt/data\txfs\trw,nofail\t0\t2") {
		t.Fatalf("new stable UUID entry missing:\n%s", after)
	}
}

func TestUpdateFstabEntryDisableRemovesOnlySelectedMount(t *testing.T) {
	before := `UUID=root-uuid / ext4 defaults 0 1
UUID=data-uuid /mnt/data ext4 defaults 0 2
UUID=other-uuid /mnt/other xfs defaults 0 2
`
	after := updateFstabEntry(before, "/dev/sdb1", "/mnt/data", "data-uuid", "", "", false)

	if strings.Contains(after, "data-uuid") || strings.Contains(after, "/mnt/data") {
		t.Fatalf("selected entry still exists:\n%s", after)
	}
	if !strings.Contains(after, "root-uuid") || !strings.Contains(after, "other-uuid") {
		t.Fatalf("unrelated entries were removed:\n%s", after)
	}
}

func TestIsSystemMountPath(t *testing.T) {
	for _, path := range []string{"/", "/boot", "/boot/efi", "/var", "/home", "/snap/core"} {
		if !isSystemMountPath(path) {
			t.Errorf("expected %q to be a system path", path)
		}
	}
	for _, path := range []string{"/mnt/data", "/media/archive", "/srv/storage", "/data", "/var/lib/nimbus"} {
		if isSystemMountPath(path) {
			t.Errorf("expected %q to be a data path", path)
		}
	}
}
