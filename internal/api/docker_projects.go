package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

var dockerProjectWriteMu sync.Mutex

type dockerProject struct {
	Name string `json:"name"`
	File string `json:"file"`
	Status string `json:"status"`
	Services []string `json:"services"`
	Error string `json:"error,omitempty"`
}

func (s *Server) listDockerProjects(w http.ResponseWriter, r *http.Request) {
	out, err := runCmd("docker", "compose", "ls", "--all", "--format", "json")
	if err != nil { jsonErr(w, dockerCommandError(out, err), 503); return }
	var discovered []struct { Name, ConfigFiles string }
	if json.Unmarshal([]byte(out), &discovered) != nil { jsonErr(w, "invalid Compose response", 502); return }
	projects := map[string]dockerProject{}
	for _, p := range discovered {
		// Multiple files must remain ordered: Compose overrides depend on it.
		projects[p.ConfigFiles] = dockerProject{Name:p.Name, File:p.ConfigFiles}
	}
	for _, root := range []string{"/opt/stacks", "/srv", "/home", "/root"} {
		filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil { return nil }
			rel, _ := filepath.Rel(root, path)
			if d.IsDir() { if strings.Count(rel, string(os.PathSeparator)) >= 3 || strings.HasPrefix(d.Name(), ".") { return filepath.SkipDir }; return nil }
			if d.Type().IsRegular() && (d.Name()=="docker-compose.yml" || d.Name()=="docker-compose.yaml" || d.Name()=="compose.yml" || d.Name()=="compose.yaml") {
				known := false
				for files := range projects { for _, file := range strings.Split(files, ",") { if file == path { known = true } } }
				if !known { projects[path] = dockerProject{Name:filepath.Base(filepath.Dir(path)), File:path} }
			}
			return nil
		})
	}
	result := []dockerProject{}
	for _, p := range projects {
		args := []string{"compose"}
		for _, file := range strings.Split(p.File, ",") { args = append(args, "-f", file) }
		args = append(args, "-p", p.Name)
		services, serviceErr := runCmd("docker", append(args, "config", "--services")...)
		p.Services = strings.Fields(services)
		p.Status = "stopped"
		if serviceErr != nil { p.Status = "unknown"; p.Services = []string{}; p.Error = dockerCommandError(services, serviceErr) } else {
			ps, psErr := runCmd("docker", append(args, "ps", "--all", "--format", "json")...)
			if psErr != nil { p.Status="unknown"; p.Error=dockerCommandError(ps, psErr) } else { p.Status=composeProjectState(ps, p.Services...) }
		}
		result=append(result,p)
	}
	sort.Slice(result,func(i,j int) bool { return result[i].Name < result[j].Name })
	jsonOK(w,map[string]any{"stacks":result})
}

func composeProjectState(out string, expected ...string) string {
	type row struct { State, Health, Service string }
	rows := []row{}
	if strings.HasPrefix(strings.TrimSpace(out), "[") { if json.Unmarshal([]byte(out), &rows) != nil { return "unknown" } } else {
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") { if line=="" { continue }; var r row; if json.Unmarshal([]byte(line), &r)!=nil { return "unknown" }; rows=append(rows,r) }
	}
	running:=0
	for _, r := range rows { if r.State=="restarting" || r.State=="dead" || r.Health=="unhealthy" { return "problem" }; if r.State=="running" { running++ } }
	if running==0 { return "stopped" }
	for _, service := range expected {
		found := false
		for _, r := range rows { if r.Service == service && r.State == "running" { found = true } }
		if !found { return "partial" }
	}
	if running==len(rows) { return "running" }; return "partial"
}

func validateComposeContent(file, content, name string) (string, error) {
	dir:=filepath.Dir(file)
	tmp,err:=os.CreateTemp(dir,".nimbus-compose-*.yaml")
	if err!=nil { return "",err }; defer os.Remove(tmp.Name())
	if _,err=tmp.WriteString(content);err!=nil { tmp.Close();return "",err }; if err=tmp.Close();err!=nil{return "",err}
	out,err:=runCmd("docker","compose","--project-directory",dir,"-p",name,"-f",tmp.Name(),"config","--quiet")
	if err!=nil { return out,fmt.Errorf("%s",dockerCommandError(out,err)) }; return out,nil
}

func (s *Server) handleDockerProjectWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method!=http.MethodPost { jsonErr(w,"method not allowed",405);return }
	if !dockerProjectWriteMu.TryLock() {jsonErr(w,"Inna operacja Compose jest w toku.",409);return};defer dockerProjectWriteMu.Unlock()
	var req struct { Name, File, Content, Action string }
	if json.NewDecoder(http.MaxBytesReader(w,r.Body,2<<20)).Decode(&req)!=nil {jsonErr(w,"invalid request",400);return}
	if !validDockerID(req.Name) || strings.ToLower(req.Name)!=req.Name {jsonErr(w,"Nazwa projektu: małe litery, cyfry, kropka, myślnik lub podkreślenie.",400);return}
	fresh:=req.File==""
	if fresh {req.File=filepath.Join("/opt/stacks",req.Name,"docker-compose.yml")}
	files:=strings.Split(req.File,",")
	for _,file:=range files {if !filepath.IsAbs(file) || (filepath.Ext(file)!=".yml" && filepath.Ext(file)!=".yaml") {jsonErr(w,"invalid Compose file",400);return}}
	switch req.Action {
	case "validate","save","deploy":
		if len(files)!=1 {jsonErr(w,"Projekt używa kilku plików. Edytuj je osobno na hoście.",409);return}
		if strings.TrimSpace(req.Content)=="" {jsonErr(w,"YAML jest pusty",400);return}
		if fresh {
			if _,err:=os.Stat(req.File);err==nil {jsonErr(w,"Projekt już istnieje. Otwórz jego edycję.",409);return}
			if err:=os.MkdirAll(filepath.Dir(req.File),0755);err!=nil {jsonErr(w,err.Error(),500);return}
		}
		out,err:=validateComposeContent(req.File,req.Content,req.Name)
		if err!=nil {jsonErr(w,err.Error(),422);return}
		if req.Action=="validate" {jsonOK(w,map[string]string{"status":"valid","output":out});return}
		// Atomically replace only the selected file, keeping its access mode.
		mode:=fs.FileMode(0600)
		if st,err:=os.Stat(req.File);err==nil {mode=st.Mode().Perm()}
		tmp,err:=os.CreateTemp(filepath.Dir(req.File),".nimbus-save-*.yaml")
		if err!=nil {jsonErr(w,err.Error(),500);return}; defer os.Remove(tmp.Name())
		if _,err=tmp.WriteString(req.Content);err==nil {err=tmp.Chmod(mode)}
		closeErr:=tmp.Close();if err==nil {err=closeErr}
		if err==nil {err=os.Rename(tmp.Name(),req.File)}
		if err!=nil {jsonErr(w,err.Error(),500);return}
		if req.Action=="save" {jsonOK(w,map[string]string{"status":"saved","file":req.File});return}
	case "up","stop":
	default:jsonErr(w,"unknown action",400);return
	}
	args:=[]string{"compose","-p",req.Name}
	for _,file:=range files {args=append(args,"-f",file)}
	if req.Action=="stop" {args=append(args,"stop")} else {args=append(args,"up","-d")}
	out,err:=runCmd("docker",args...)
	if err!=nil {
		w.Header().Set("Content-Type","application/json")
		w.WriteHeader(500)
		jsonOK(w,map[string]any{"error":dockerCommandError(out,err),"file":req.File,"saved":req.Action=="deploy"})
		return
	}
	jsonOK(w,map[string]string{"status":"ok","file":req.File,"output":out})
}
