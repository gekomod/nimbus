package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

var fstabWriteMu sync.Mutex
var storageDeviceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

func storageReadCommand(name string, args ...string) (string,error) {
 return discReadCommand(name,args...)
}

func storageCommandError(out string,err error) string {
	if out!="" {return out};if err!=nil {return err.Error()};return "Urządzenie nie zwróciło danych SMART. Sprawdź obsługę kontrolera."
}

func cachedStorageSMART(name string) map[string]interface{} {
	_smartDataCacheMu.RLock();defer _smartDataCacheMu.RUnlock()
	entry,ok:=_smartDataCache[name]
	if !ok || time.Since(entry.at)>smartDataCacheTTL {return nil}
	return entry.data
}

func blockTreeMounted(device map[string]interface{}) bool {
	if getString(device,"mountpoint")!="" {return true}
	if children,ok:=device["children"].([]interface{});ok {
		for _,raw:=range children {if child,ok:=raw.(map[string]interface{});ok&&blockTreeMounted(child){return true}}
	}
	return false
}

func decodeFstabField(value string) string {
	return strings.NewReplacer(`\040`," ",`\011`,"\t",`\012`,"\n",`\134`,`\`).Replace(value)
}

func encodeFstabField(value string) string {
	return strings.NewReplacer(`\`,`\134`," ",`\040`,"\t",`\011`,"\n",`\012`).Replace(value)
}

func (s *Server) handleStorageDeviceLayout(w http.ResponseWriter,r *http.Request) {
	if r.Method!=http.MethodGet {jsonErr(w,"method not allowed",405);return}
	device:=strings.TrimPrefix(r.URL.Query().Get("device"),"/dev/")
	if !storageDeviceName.MatchString(device) {jsonErr(w,"nieprawidłowa nazwa urządzenia",400);return}
	out,err:=storageReadCommand("lsblk","-b","-J","-o","NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID,MODEL,SERIAL,RO","/dev/"+device)
	if err!=nil {jsonErr(w,storageCommandError(out,err),502);return}
	if !json.Valid([]byte(out)) {jsonErr(w,"nieprawidłowa odpowiedź lsblk",502);return}
	jsonOK(w,json.RawMessage(out))
}

// The FSTAB toggle addresses one mountpoint, even when one filesystem is mounted twice.
func updateFstabMount(content,device,target,uuid,fs,options string,enable bool) string {
 kept:=updateFstabEntry(content,"",target,"","","",false)
 if !enable {return kept}
 entry:=updateFstabEntry("",device,target,uuid,fs,options,true)
 return strings.TrimRight(kept,"\n")+"\n"+entry
}
