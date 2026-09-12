package api

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeTemplateFormat(t *testing.T) {
	tests := []struct {
		format string
		url    string
		want   string
	}{
		{format: "qcow2", url: "https://example.test/system.qcow2", want: "qcow2"},
		{format: "qcow2", url: "https://example.test/system.qcow2.zip", want: "qcow2.zip"},
		{format: "ZIP", url: "https://example.test/system", want: "qcow2.zip"},
		{format: "", url: "https://example.test/system.qcow2.zip?mirror=1", want: "qcow2.zip"},
		{format: "", url: "https://example.test/system.img", want: "qcow2"},
	}
	for _, test := range tests {
		if got := normalizeTemplateFormat(test.format, test.url); got != test.want {
			t.Errorf("normalizeTemplateFormat(%q, %q) = %q; want %q", test.format, test.url, got, test.want)
		}
	}
}

func TestExtractQCOW2FromZIP(t *testing.T) {
	tempDir := t.TempDir()
	archivePath := filepath.Join(tempDir, "image.zip")
	archiveFile, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(archiveFile)
	entries := map[string]string{
		"README.txt":          "not an image",
		"small.qcow2":         "small",
		"nested/system.QCOW2": "the selected qcow2 image",
	}
	for name, content := range entries {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archiveFile.Close(); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(tempDir, "system.qcow2")
	var finalDone, finalTotal uint64
	if err := extractQCOW2FromZIP(archivePath, destination, func(done, total uint64) {
		finalDone, finalTotal = done, total
	}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if want := entries["nested/system.QCOW2"]; string(got) != want {
		t.Fatalf("extracted %q; want %q", got, want)
	}
	if finalDone == 0 || finalDone != finalTotal {
		t.Fatalf("final progress = %d/%d; want a completed extraction", finalDone, finalTotal)
	}
}

func TestExtractQCOW2FromZIPRejectsArchiveWithoutImage(t *testing.T) {
	tempDir := t.TempDir()
	archivePath := filepath.Join(tempDir, "invalid.zip")
	archiveFile, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(archiveFile)
	entry, err := archive.Create("README.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(entry, "no image here"); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archiveFile.Close(); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(tempDir, "system.qcow2")
	if err := extractQCOW2FromZIP(archivePath, destination, nil); err == nil {
		t.Fatal("extractQCOW2FromZIP succeeded for an archive without a QCOW2 image")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("destination should not exist after failure; stat error: %v", err)
	}
}

func TestDownloadTemplateFileResumesPartialDownload(t *testing.T) {
	content := []byte("complete qcow2 download")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.Header.Get("Range"), "bytes=9-"; got != want {
			t.Errorf("Range header = %q; want %q", got, want)
		}
		w.Header().Set("Content-Range", "bytes 9-22/23")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(content[9:])
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "image.part")
	if err := os.WriteFile(destination, content[:9], 0644); err != nil {
		t.Fatal(err)
	}
	if err := downloadTemplateFile(context.Background(), server.URL, destination, nil); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(content) {
		t.Fatalf("downloaded %q; want %q", got, content)
	}
}

func fakeQemuInfo(t *testing.T, success bool) {
	t.Helper()
	dir := t.TempDir()
	body := "#!/bin/sh\nexit 1\n"
	if success {
		body = "#!/bin/sh\nprintf '%s' '{\"format\":\"qcow2\",\"virtual-size\":1073741824}'\n"
	}
	if err := os.WriteFile(filepath.Join(dir, "qemu-img"), []byte(body), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

func TestTemplateErrorRetainsCommandFailure(t *testing.T) {
	err := templateCommandError("genisoimage", "", fmt.Errorf("executable not found"))
	if !strings.Contains(err.Error(), "executable not found") {
		t.Fatal(err)
	}
}

func TestFailedValidationPreservesDownloadedImage(t *testing.T) {
	fakeQemuInfo(t, false)
	dir := t.TempDir()
	source := filepath.Join(dir, "source.qcow2")
	base := filepath.Join(dir, "base.qcow2")
	content := []byte("QFI\xfbsource payload")
	if err := os.WriteFile(source, content, 0644); err != nil {
		t.Fatal(err)
	}
	err := ensureTemplateBase(&templateJob{}, VMTemplate{ID: "preserve-test", Format: "qcow2", LocalPath: source}, base)
	if err == nil || !strings.Contains(err.Error(), "zachowano") {
		t.Fatalf("expected preserved-path error, got %v", err)
	}
	for _, path := range []string{source, base + ".part"} {
		got, e := os.ReadFile(path)
		if e != nil || string(got) != string(content) {
			t.Fatalf("lost image %s: %v", path, e)
		}
	}
}

func TestSavedPartCanFinishWithoutDownloadingAgain(t *testing.T) {
	fakeQemuInfo(t, true)
	base := filepath.Join(t.TempDir(), "base.qcow2")
	if err := os.WriteFile(base+".part", []byte("complete image"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ensureTemplateBase(&templateJob{}, VMTemplate{ID: "reuse-test", URL: "invalid-no-network"}, base); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(base); err != nil || string(got) != "complete image" {
		t.Fatalf("base: %s %v", got, err)
	}
}

func TestZIPContentDetectedWithoutURLSuffix(t *testing.T) {
	fakeQemuInfo(t, true)
	dir := t.TempDir()
	source := filepath.Join(dir, "no-extension")
	base := filepath.Join(dir, "base.qcow2")
	f, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	entry, err := z.Create("disk.qcow2")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("qcow2 content")); err != nil {
		t.Fatal(err)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := ensureTemplateBase(&templateJob{}, VMTemplate{ID: "zip-magic", Format: "qcow2", LocalPath: source}, base); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(base)
	if err != nil || string(got) != "qcow2 content" {
		t.Fatalf("base %q %v", got, err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("source archive removed", err)
	}
}

func TestCopyTemplateRejectsEmptySource(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "empty")
	os.WriteFile(source, nil, 0600)
	if err := copyTemplateImage(source, filepath.Join(dir, "copy"), nil); err == nil {
		t.Fatal("empty source accepted")
	}
}

func TestExistingBaseIsNeverMovedOnInspectionFailure(t *testing.T) {
	fakeQemuInfo(t, false)
	base := filepath.Join(t.TempDir(), "in-use.qcow2")
	if err := os.WriteFile(base, []byte("VM backing image"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ensureTemplateBase(&templateJob{}, VMTemplate{ID: "in-use-test"}, base); err == nil {
		t.Fatal("expected inspection error")
	}
	content, err := os.ReadFile(base)
	if err != nil || string(content) != "VM backing image" {
		t.Fatalf("moved a live backing image: %v", err)
	}
}
