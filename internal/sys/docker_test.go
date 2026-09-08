package sys

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDockerContainersPreservesHealthAndComposeLabels(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\nif [ \"$1\" != ps ]; then exit 1; fi\nprintf 'abc123\\tmedia-app\\tjellyfin/jellyfin\\trunning\\tUp 2 hours (unhealthy)\\t0.0.0.0:8096->8096/tcp\\tmedia\\tjellyfin\\nxyz789\\tstandalone\\talpine\\texited\\tExited (0)\\t\\t\\t\\n'\n"
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0755); err != nil { t.Fatal(err) }
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	containers, err := DockerContainers()
	if err != nil { t.Fatal(err) }
	if len(containers) != 2 { t.Fatalf("got %d containers", len(containers)) }
	if c := containers[0]; c.Health != "unhealthy" || c.Project != "media" || c.Service != "jellyfin" { t.Fatalf("lost metadata: %+v", c) }
	if c := containers[1]; c.Project != "" || c.State != "exited" || c.StatsAvailable { t.Fatalf("invalid standalone container: %+v", c) }
}
