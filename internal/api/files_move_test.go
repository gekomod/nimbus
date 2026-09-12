package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMoveFile(t *testing.T) {
	root := t.TempDir()
	dest := filepath.Join(root, "dest")
	os.Mkdir(dest, 0700)
	src := filepath.Join(root, "file with spaces")
	os.WriteFile(src, []byte("payload"), 0600)
	r := moveFile(src, dest)
	if !r.Moved {
		t.Fatal(r.Error)
	}
	data, _ := os.ReadFile(r.Target)
	if string(data) != "payload" {
		t.Fatal("content changed")
	}
	os.WriteFile(src, []byte("new"), 0600)
	r = moveFile(src, dest)
	if r.Moved || r.Error == "" {
		t.Fatal("conflict allowed")
	}
	data, _ = os.ReadFile(filepath.Join(dest, "file with spaces"))
	if string(data) != "payload" {
		t.Fatal("overwritten")
	}
}
func TestMoveRejectsDescendantAndRelative(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "child")
	os.Mkdir(child, 0700)
	for _, r := range []fileMoveResult{moveFile(root, child), moveFile("relative", child), moveFile("/", child)} {
		if r.Moved || r.Error == "" {
			t.Fatal("invalid move allowed")
		}
	}
}
func TestMoveSymlinkMovesLinkNotReferent(t *testing.T) {
	root := t.TempDir()
	dest := filepath.Join(root, "dest")
	os.Mkdir(dest, 0700)
	target := filepath.Join(root, "target")
	os.WriteFile(target, []byte("safe"), 0600)
	link := filepath.Join(root, "link")
	os.Symlink(target, link)
	r := moveFile(link, dest)
	if !r.Moved {
		t.Fatal(r.Error)
	}
	if got, err := os.Readlink(r.Target); err != nil || got != target {
		t.Fatal("link changed", err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal("referent moved")
	}
}
