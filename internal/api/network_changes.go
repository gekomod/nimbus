package api

// Runtime link/address changes are journaled before execution. A timer reverts
// unconfirmed changes; startup recovers a journal left by a process crash.
import (
 "context"
 "bytes"
 "crypto/rand"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "net"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "strconv"
 "strings"
 "sync"
 "time"
)

var networkJournal = "/etc/nimbus/network-pending.json"
type networkChange struct {
 ID string `json:"id"`
 Interface string `json:"interface"`
 Deadline time.Time `json:"deadline"`
 Undo [][]string `json:"undo"`
 Error string `json:"error,omitempty"`
 Routes []byte `json:"routes,omitempty"`
 MAC string `json:"mac"`
}
var networkChanges struct { sync.Mutex; Pending *networkChange }
var networkRun = func(args ...string) error {
 ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second); defer cancel()
 out, err := exec.CommandContext(ctx, "ip", args...).CombinedOutput()
 if err != nil { return fmt.Errorf("%s: %w", strings.TrimSpace(string(out)), err) }; return nil
}

func rollbackNetworkLocked() error {
 p := networkChanges.Pending
 if p == nil { return nil }
 if p.MAC!="" {
  ni,err:=net.InterfaceByName(p.Interface)
  if err!=nil || ni.HardwareAddr.String()!=p.MAC {p.Error="tożsamość interfejsu zmieniła się — cofanie wstrzymane";return fmt.Errorf("%s",p.Error)}
 }
 var failures []string
 for _, args := range p.Undo {
  if len(args)==5 && args[0]=="addr" && args[1]=="del" {
   ni,err:=net.InterfaceByName(p.Interface)
   if err==nil { addrs,e:=ni.Addrs();if e==nil { found:=false;for _,a:=range addrs {if a.String()==args[2] {found=true}};if !found {continue} } }
  }
  if err := networkRun(args...); err != nil { failures = append(failures, err.Error()) }
 }
 if err:=restoreNetworkRoutes(p.Routes);err!=nil {failures=append(failures,err.Error())}

 if len(failures)>0 { p.Error = strings.Join(failures, "; "); return fmt.Errorf("%s", p.Error) }
 if err := os.Remove(networkJournal); err != nil && !os.IsNotExist(err) { p.Error=err.Error(); return err }
 networkChanges.Pending = nil
 return nil
}

func restoreNetworkRoutes(routes []byte) error {
 if len(routes)==0 {return nil}
 ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
 cmd:=exec.CommandContext(ctx,"ip","-4","route","restore");cmd.Stdin=bytes.NewReader(routes)
 out,err:=cmd.CombinedOutput();if err!=nil {return fmt.Errorf("%s: %w",string(out),err)};return nil
}

func recoverNetworkChange() {
 networkChanges.Lock(); defer networkChanges.Unlock()
 data, err := os.ReadFile(networkJournal); if err != nil { return }
 var p networkChange
 if json.Unmarshal(data, &p) != nil {networkChanges.Pending=&networkChange{Error:"uszkodzony dziennik zmian sieci: "+networkJournal};return}
 networkChanges.Pending = &p
 _ = rollbackNetworkLocked()
}

type networkChangeRequest struct {
 Interface string `json:"interface"`
 Action string `json:"action"`
 Address string `json:"address"`
 OldAddress string `json:"old_address"`
 MTU int `json:"mtu"`
 ID string `json:"id"`
}

func networkPlan(req networkChangeRequest, ni *net.Interface) ([][]string, [][]string, error) {
 if !validIface(req.Interface) || ni == nil || ni.Name != req.Interface { return nil,nil,fmt.Errorf("interfejs nie istnieje") }
 dev:=req.Interface
 switch req.Action {
 case "up", "down":
  old:="down"; if ni.Flags&net.FlagUp!=0 { old="up" }
  return [][]string{{"link","set","dev",dev,req.Action}}, [][]string{{"link","set","dev",dev,old}},nil
 case "mtu":
  if req.MTU < 576 || req.MTU > 9216 { return nil,nil,fmt.Errorf("MTU musi wynosić 576–9216") }
  return [][]string{{"link","set","dev",dev,"mtu",strconv.Itoa(req.MTU)}}, [][]string{{"link","set","dev",dev,"mtu",strconv.Itoa(ni.MTU)}}, nil
 case "address":
  ip, _, err:=net.ParseCIDR(req.Address); if err!=nil || ip.To4()==nil { return nil,nil,fmt.Errorf("podaj adres IPv4 z maską, np. 192.168.1.10/24") }
  if req.Address==req.OldAddress { return nil,nil,fmt.Errorf("adres nie został zmieniony") }
  forward:=[][]string{{"addr","add",req.Address,"dev",dev}}
  undo:=[][]string{}
  if req.OldAddress!="" {
   old,_,err:=net.ParseCIDR(req.OldAddress); if err!=nil || old.To4()==nil { return nil,nil,fmt.Errorf("nieprawidłowy poprzedni adres") }
   forward=append(forward,[]string{"addr","del",req.OldAddress,"dev",dev})
   undo=append(undo,[]string{"addr","replace",req.OldAddress,"dev",dev})
  }
  undo=append(undo,[]string{"addr","del",req.Address,"dev",dev})
  return forward,undo,nil
 }
 return nil,nil,fmt.Errorf("nieobsługiwana operacja")
}

func (s *Server) handleNetworkChanges(w http.ResponseWriter,r *http.Request) {
 networkChanges.Lock(); defer networkChanges.Unlock()
 if r.Method==http.MethodGet { jsonOK(w,map[string]any{"pending":networkChanges.Pending}); return }
 if r.Method!=http.MethodPost { jsonErr(w,"method not allowed",405); return }
 var req networkChangeRequest
 if json.NewDecoder(http.MaxBytesReader(w,r.Body,4096)).Decode(&req)!=nil { jsonErr(w,"nieprawidłowe dane",400); return }
 if req.Action=="confirm" || req.Action=="revert" {
  p:=networkChanges.Pending
  if p==nil || p.ID!=req.ID { jsonErr(w,"zmiana już wygasła lub została cofnięta",409); return }
  if req.Action=="revert" { if err:=rollbackNetworkLocked();err!=nil { jsonErr(w,err.Error(),500);return } } else {
   if time.Now().After(p.Deadline) || p.Error!="" { jsonErr(w,"zmiana wygasła lub wymaga naprawy",409);return }
   if err:=os.Remove(networkJournal);err!=nil { jsonErr(w,err.Error(),500);return }
   networkChanges.Pending=nil
  }
  jsonOK(w,map[string]string{"status":"ok"});return
 }
 if networkChanges.Pending!=nil { jsonErr(w,"najpierw potwierdź lub cofnij poprzednią zmianę",409);return }
 ni,err:=net.InterfaceByName(req.Interface); if err!=nil { jsonErr(w,err.Error(),404);return }
 forward,undo,err:=networkPlan(req,ni);if err!=nil { jsonErr(w,err.Error(),400);return }
 if req.Action=="address" {
  addrs,e:=ni.Addrs();if e!=nil { jsonErr(w,e.Error(),500);return }
  found:=req.OldAddress==""
  for _,a:=range addrs { if a.String()==req.OldAddress { found=true }; if a.String()==req.Address { jsonErr(w,"adres już istnieje",409);return } }
  if !found { jsonErr(w,"poprzedni adres zmienił się — odśwież widok",409);return }
 }
 token:=make([]byte,16);if _,err=rand.Read(token);err!=nil { jsonErr(w,err.Error(),500);return }
 p:=&networkChange{ID:hex.EncodeToString(token),Interface:req.Interface,MAC:ni.HardwareAddr.String(),Deadline:time.Now().Add(90*time.Second),Undo:undo}
 if req.Action=="address" {
  ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second)
  p.Routes,err=exec.CommandContext(ctx,"ip","-4","route","save","dev",req.Interface).Output();cancel()
  if err!=nil { jsonErr(w,"nie można zabezpieczyć tras: "+err.Error(),500);return }
 }
 data,_:=json.Marshal(p)
 if err=os.MkdirAll(filepath.Dir(networkJournal),0700);err==nil { err=os.WriteFile(networkJournal+".tmp",data,0600) }
 if err==nil { err=os.Rename(networkJournal+".tmp",networkJournal) }
 if err!=nil { jsonErr(w,err.Error(),500);return }
 networkChanges.Pending=p
 time.AfterFunc(90*time.Second,func(){networkChanges.Lock();defer networkChanges.Unlock();if networkChanges.Pending!=nil && networkChanges.Pending.ID==p.ID { _=rollbackNetworkLocked() }})
 for _,args:=range forward { if err=networkRun(args...);err!=nil {
  // Undo may report a missing new address after a failed add. Retain the
  // journal and error rather than claim a successful recovery.
  p.Error=err.Error(); rollbackErr:=rollbackNetworkLocked();msg:=err.Error();if rollbackErr!=nil {msg+="; cofanie: "+rollbackErr.Error()}
  jsonErr(w,msg,500);return
 } }
 if err=restoreNetworkRoutes(p.Routes);err!=nil {
  msg:=err.Error();if e:=rollbackNetworkLocked();e!=nil {msg+="; cofanie: "+e.Error()};jsonErr(w,msg,500);return
 }
 jsonOK(w,map[string]any{"status":"pending","pending":p})
}
