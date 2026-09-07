package api

import (
	"archive/zip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
