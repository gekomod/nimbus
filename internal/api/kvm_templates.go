package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type VMTemplate struct {
	ID string `json:"id"`; Name string `json:"name"`; Version string `json:"version"`; Family string `json:"family"`
	Icon string `json:"icon"`; Description string `json:"description"`; URL string `json:"url"`; Format string `json:"format"`
	MinCPU int `json:"min_cpu"`; MinRAM int `json:"min_ram"`; MinDisk int `json:"min_disk"`
	Custom bool `json:"custom,omitempty"`
}

const vmTemplatesPath = "/etc/nimbus/kvm-templates.json"
var vmTemplatesMu sync.Mutex

var vmTemplates = []VMTemplate{
	{ID:"ubuntu-2404", Name:"Ubuntu Server", Version:"24.04 LTS", Family:"ubuntu", Icon:"🟠", Description:"Cloud image · cloud-init · QEMU Guest Agent", URL:"https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img", Format:"qcow2", MinCPU:2, MinRAM:2048, MinDisk:20},
	{ID:"debian-12", Name:"Debian", Version:"12 Bookworm", Family:"debian", Icon:"🔴", Description:"Oficjalny generic cloud image", URL:"https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2", Format:"qcow2", MinCPU:1, MinRAM:1024, MinDisk:10},
	{ID:"rocky-9", Name:"Rocky Linux", Version:"9", Family:"rocky", Icon:"🟢", Description:"Generic cloud image dla serwerów", URL:"https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2", Format:"qcow2", MinCPU:2, MinRAM:2048, MinDisk:20},
	{ID:"alpine-320", Name:"Alpine Linux", Version:"3.20", Family:"alpine", Icon:"🔷", Description:"Lekki system do małych usług", URL:"https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/cloud/nocloud_alpine-3.20.3-x86_64-bios-cloudinit-r0.qcow2", Format:"qcow2", MinCPU:1, MinRAM:512, MinDisk:2},
}

func loadCustomVMTemplates() []VMTemplate { vmTemplatesMu.Lock();defer vmTemplatesMu.Unlock();var v []VMTemplate;b,e:=os.ReadFile(vmTemplatesPath);if e==nil{json.Unmarshal(b,&v)};for i:=range v{v[i].Custom=true};return v }
func saveCustomVMTemplates(v []VMTemplate) error { vmTemplatesMu.Lock();defer vmTemplatesMu.Unlock();if err:=os.MkdirAll(filepath.Dir(vmTemplatesPath),0755);err!=nil{return err};b,err:=json.MarshalIndent(v,"","  ");if err!=nil{return err};return os.WriteFile(vmTemplatesPath,b,0644) }
func allVMTemplates() []VMTemplate { out:=append([]VMTemplate{},vmTemplates...);return append(out,loadCustomVMTemplates()...) }
func validateVMTemplate(t *VMTemplate) error { t.ID=safeVMName(strings.ToLower(t.ID));if t.ID==""||t.Name==""{return fmt.Errorf("ID i nazwa są wymagane")};u,e:=url.ParseRequestURI(t.URL);if e!=nil||u.Scheme!="https"&&u.Scheme!="http"{return fmt.Errorf("wymagany poprawny adres HTTP/HTTPS obrazu")};if t.Format==""{t.Format="qcow2"};if t.Format!="qcow2"{return fmt.Errorf("obsługiwany format obrazu: qcow2")};if t.MinCPU<1{t.MinCPU=1};if t.MinRAM<256{t.MinRAM=256};if t.MinDisk<1{t.MinDisk=1};if t.Icon==""{t.Icon="💿"};t.Custom=true;return nil }

type templateJob struct {
	ID string `json:"id"`; Template string `json:"template"`; Name string `json:"name"`
	Status string `json:"status"`; Step string `json:"step"`; Error string `json:"error,omitempty"`
	Progress int `json:"progress"`; Started time.Time `json:"started"`
}
var templateJobs = struct{ sync.RWMutex; M map[string]*templateJob }{M: map[string]*templateJob{}}

func safeVMName(v string) string {
	v = strings.Map(func(r rune) rune { if r>='a'&&r<='z'||r>='A'&&r<='Z'||r>='0'&&r<='9'||r=='-'||r=='_'||r=='.' { return r }; return '-' }, v)
	return strings.Trim(v, "-")
}

func (s *Server) handleKVMTemplates(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet: jsonOK(w,map[string]any{"templates":allVMTemplates(),"custom_path":vmTemplatesPath})
	case http.MethodPost:
		var t VMTemplate;if json.NewDecoder(r.Body).Decode(&t)!=nil{jsonErr(w,"nieprawidłowe dane",400);return};if err:=validateVMTemplate(&t);err!=nil{jsonErr(w,err.Error(),400);return}
		all:=allVMTemplates();for _,x:=range all{if x.ID==t.ID{jsonErr(w,"szablon o tym ID już istnieje",409);return}}
		custom:=loadCustomVMTemplates();custom=append(custom,t);if err:=saveCustomVMTemplates(custom);err!=nil{jsonErr(w,err.Error(),500);return};jsonOK(w,t)
	case http.MethodPut:
		var t VMTemplate;if json.NewDecoder(r.Body).Decode(&t)!=nil{jsonErr(w,"nieprawidłowe dane",400);return};if err:=validateVMTemplate(&t);err!=nil{jsonErr(w,err.Error(),400);return}
		custom:=loadCustomVMTemplates();found:=false;for i:=range custom{if custom[i].ID==t.ID{custom[i]=t;found=true;break}};if !found{jsonErr(w,"można edytować tylko własny szablon",404);return};if err:=saveCustomVMTemplates(custom);err!=nil{jsonErr(w,err.Error(),500);return};jsonOK(w,t)
	case http.MethodDelete:
		id:=safeVMName(strings.ToLower(r.URL.Query().Get("id")));if id==""{jsonErr(w,"ID jest wymagane",400);return};custom:=loadCustomVMTemplates();next:=custom[:0];found:=false;for _,t:=range custom{if t.ID==id{found=true;continue};next=append(next,t)};if !found{jsonErr(w,"można usunąć tylko własny szablon",404);return};if err:=saveCustomVMTemplates(next);err!=nil{jsonErr(w,err.Error(),500);return};jsonOK(w,map[string]string{"status":"ok"})
	default: jsonErr(w,"method not allowed",405)
	}
}

func (s *Server) handleKVMTemplateJobs(w http.ResponseWriter, r *http.Request) {
	templateJobs.RLock(); defer templateJobs.RUnlock()
	jobs := make([]*templateJob,0,len(templateJobs.M)); for _, j := range templateJobs.M { jobs=append(jobs,j) }
	jsonOK(w,map[string]any{"jobs":jobs})
}

func (s *Server) handleKVMTemplateDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w,"method not allowed",405); return }
	var q struct { Template, Name, Network, SSHKey string; CPU, RAM, Disk int }
	if json.NewDecoder(r.Body).Decode(&q)!=nil { jsonErr(w,"nieprawidłowe dane",400); return }
	q.Name=safeVMName(q.Name); if q.Name=="" { jsonErr(w,"nazwa VM jest wymagana",400); return }
	templates:=allVMTemplates();var tpl *VMTemplate; for i:=range templates { if templates[i].ID==q.Template { tpl=&templates[i]; break } }
	if tpl==nil { jsonErr(w,"nieznany szablon",400); return }
	if q.CPU<tpl.MinCPU { q.CPU=tpl.MinCPU }; if q.RAM<tpl.MinRAM { q.RAM=tpl.MinRAM }; if q.Disk<tpl.MinDisk { q.Disk=tpl.MinDisk }; if q.Network=="" { q.Network="default" }
	if out,err:=runCmd("virsh","dominfo",q.Name); err==nil && out!="" { jsonErr(w,"VM o tej nazwie już istnieje",409); return }
	job:=&templateJob{ID:strconv.FormatInt(time.Now().UnixNano(),36),Template:tpl.ID,Name:q.Name,Status:"queued",Step:"Oczekiwanie",Started:time.Now()}
	templateJobs.Lock(); templateJobs.M[job.ID]=job; templateJobs.Unlock()
	go deployTemplate(job,*tpl,q.Name,q.Network,q.SSHKey,q.CPU,q.RAM,q.Disk)
	jsonOK(w,map[string]any{"status":"accepted","job_id":job.ID})
}

func setTemplateJob(j *templateJob, status, step string, progress int, err error) { templateJobs.Lock(); defer templateJobs.Unlock(); j.Status=status;j.Step=step;j.Progress=progress;if err!=nil{j.Error=err.Error()} }

func deployTemplate(j *templateJob,t VMTemplate,name,network,sshKey string,cpu,ram,disk int) {
	cfg:=loadKVMConfig(); if err:=os.MkdirAll(cfg.ImagePath,0755);err!=nil { setTemplateJob(j,"error","Tworzenie katalogu",0,err);return }
	baseDir:=filepath.Join(cfg.ImagePath,"templates"); if err:=os.MkdirAll(baseDir,0755);err!=nil { setTemplateJob(j,"error","Tworzenie katalogu",0,err);return }
	base:=filepath.Join(baseDir,t.ID+".qcow2"); target:=filepath.Join(cfg.ImagePath,name+".qcow2")
	setTemplateJob(j,"running","Pobieranie obrazu systemu",15,nil)
	if _,err:=os.Stat(base);os.IsNotExist(err){ if out,e:=runCmd("curl","-fL","--retry","3","-o",base+".part",t.URL);e!=nil{setTemplateJob(j,"error","Pobieranie obrazu",15,fmt.Errorf("%s",out));return};if e:=os.Rename(base+".part",base);e!=nil{setTemplateJob(j,"error","Zapisywanie obrazu",25,e);return} }
	setTemplateJob(j,"running","Rozpakowywanie dysku",45,nil)
	if out,e:=runCmd("qemu-img","create","-f","qcow2","-F","qcow2","-b",base,target);e!=nil{setTemplateJob(j,"error","Tworzenie dysku",45,fmt.Errorf("%s",out));return}
	if out,e:=runCmd("qemu-img","resize",target,fmt.Sprintf("%dG",disk));e!=nil{os.Remove(target);setTemplateJob(j,"error","Powiększanie dysku",55,fmt.Errorf("%s",out));return}
	setTemplateJob(j,"running","Konfiguracja cloud-init",65,nil)
	seed:=filepath.Join(cfg.ImagePath,name+"-seed.iso"); userData:="#cloud-config\npackage_update: true\npackages: [qemu-guest-agent]\nruncmd:\n  - systemctl enable --now qemu-guest-agent\n"
	if strings.TrimSpace(sshKey)!="" { userData+="ssh_authorized_keys:\n  - "+strings.TrimSpace(sshKey)+"\n" }
	tmp,err:=os.MkdirTemp("","nimbus-cloudinit-");if err!=nil{setTemplateJob(j,"error","Cloud-init",65,err);return};defer os.RemoveAll(tmp)
	os.WriteFile(filepath.Join(tmp,"user-data"),[]byte(userData),0600);os.WriteFile(filepath.Join(tmp,"meta-data"),[]byte("instance-id: "+name+"\nlocal-hostname: "+name+"\n"),0644)
	if out,e:=runCmd("genisoimage","-output",seed,"-volid","cidata","-joliet","-rock",filepath.Join(tmp,"user-data"),filepath.Join(tmp,"meta-data"));e!=nil{os.Remove(target);setTemplateJob(j,"error","Cloud-init ISO",70,fmt.Errorf("%s",out));return}
	setTemplateJob(j,"running","Rejestrowanie maszyny",82,nil)
	args:=[]string{"--name",name,"--memory",strconv.Itoa(ram),"--vcpus",strconv.Itoa(cpu),"--import","--disk","path="+target+",format=qcow2,bus=virtio","--disk","path="+seed+",device=cdrom","--network","network="+network+",model=virtio","--graphics","vnc,listen=127.0.0.1","--noautoconsole","--os-variant","generic"}
	if out,e:=runCmd("virt-install",args...);e!=nil{setTemplateJob(j,"error","Rejestrowanie VM",82,fmt.Errorf("%s",out));return}
	setTemplateJob(j,"done","System gotowy",100,nil)
}
