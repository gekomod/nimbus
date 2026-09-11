package api
import("net";"reflect";"testing";"fmt";"encoding/json";"os";"time";"net/http/httptest";"strings")
func TestNetworkPlanRestoresAdministrativeState(t *testing.T){
 ni:=&net.Interface{Name:"eth0",Flags:net.FlagUp,MTU:9000}
 forward,undo,err:=networkPlan(networkChangeRequest{Interface:"eth0",Action:"down"},ni)
 if err!=nil||forward[0][4]!="down"||undo[0][4]!="up" {t.Fatalf("wrong plan: %v %v %v",forward,undo,err)}
 _,undo,err=networkPlan(networkChangeRequest{Interface:"eth0",Action:"mtu",MTU:1500},ni)
 if err!=nil||undo[0][5]!="9000"{t.Fatalf("lost MTU: %v %v",undo,err)}
}
func TestNetworkPlanRejectsInvalidRequests(t *testing.T){
 ni:=&net.Interface{Name:"eth0"}
 for _,r:=range []networkChangeRequest{{Interface:"lo",Action:"down"},{Interface:"eth0",Action:"mtu",MTU:0},{Interface:"eth0",Action:"address",Address:"1.2.3.4"},{Interface:"eth0",Action:"address",Address:"::1/128"},{Interface:"eth0",Action:"shell"}}{if _,_,e:=networkPlan(r,ni);e==nil{t.Fatalf("accepted invalid request: %+v",r)}}
}
func TestNetworkPlanPreservesCIDRAndRecoveryOrder(t *testing.T){
 _,undo,e:=networkPlan(networkChangeRequest{Interface:"eth0",Action:"address",Address:"10.1.0.2/20",OldAddress:"10.0.0.2/22"},&net.Interface{Name:"eth0"})
 want:=[][]string{{"addr","replace","10.0.0.2/22","dev","eth0"},{"addr","del","10.1.0.2/20","dev","eth0"}}
 if e!=nil||!reflect.DeepEqual(undo,want){t.Fatalf("recovery order: %v %v",undo,e)}
}
func TestNetworkCounterReset(t *testing.T){if counterRate(1,100,3)!=0||counterRate(100,1,0)!=0||counterRate(4000000,1000000,3)!=1{t.Fatal("invalid counter delta")}}

func TestNetworkRecoveryRetainsFailedJournal(t *testing.T) {
 oldPath,oldRun:=networkJournal,networkRun
 networkJournal=t.TempDir()+"/pending.json"
 oldPending:=networkChanges.Pending
 defer func(){networkJournal=oldPath;networkRun=oldRun;networkChanges.Pending=oldPending}()
 networkRun=func(...string)error{return fmt.Errorf("permission denied")}
 pending:=&networkChange{ID:"test",Undo:[][]string{{"link","set","dev","eth0","up"}}}
 data,_:=json.Marshal(pending);if e:=os.WriteFile(networkJournal,data,0600);e!=nil{t.Fatal(e)}
 recoverNetworkChange()
 if networkChanges.Pending==nil||networkChanges.Pending.Error==""{t.Fatal("failed recovery was cleared")}
 if _,e:=os.Stat(networkJournal);e!=nil{t.Fatal("journal removed after failure")}
 networkRun=func(...string)error{return nil}
 if e:=rollbackNetworkLocked();e!=nil{t.Fatal(e)}
 if networkChanges.Pending!=nil{t.Fatal("successful recovery not cleared")}
}
func TestExpiredNetworkConfirmationRejected(t *testing.T){
 old:=networkChanges.Pending;defer func(){networkChanges.Pending=old}()
 networkChanges.Pending=&networkChange{ID:"expired",Deadline:time.Now().Add(-time.Second)}
 w:=httptest.NewRecorder();r:=httptest.NewRequest("POST","/network/changes",strings.NewReader(`{"action":"confirm","id":"expired"}`))
 (&Server{}).handleNetworkChanges(w,r)
 if w.Code!=409||networkChanges.Pending==nil{t.Fatal("expired change confirmed")}
}
