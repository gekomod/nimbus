package api

import (
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "reflect"
 "testing"
 "time"
)

func TestSSACLIMappingRejectsMultiDiskLogicalVolumes(t *testing.T) {
 out := "Logical Drive: 1\n Disk Name: /dev/sdj\n physicaldrive 1I:1:10 (SAS)\nLogical Drive: 2\n Disk Name: /dev/sdk\n physicaldrive 1I:1:11 (SAS)\n physicaldrive 1I:1:12 (SAS)\n"
 got := parseSSACLILogicalDriveDiskNames(out)
 if !reflect.DeepEqual(got,map[string]string{"/dev/sdj":"1I:1:10"}) { t.Fatalf("ambiguous mapping: %#v",got) }
}

func TestSMARTDetailsUsesMappedControllerWithoutSmartctl(t *testing.T) {
 t.Setenv("NIMBUS_HP_SMART_PROBE", "")
 _ssacliDiskMapCacheMu.Lock()
 old, oldAt := _ssacliDiskMapCache, _ssacliDiskMapCacheAt
 _ssacliDiskMapCache = map[string]map[string]interface{}{"/dev/sdj":{"serial_number":"EXPECTED","model":"SAS","temp":38,"status":"passed"}}
 _ssacliDiskMapCacheAt = time.Now()
 _ssacliDiskMapCacheMu.Unlock()
 defer func(){_ssacliDiskMapCacheMu.Lock();_ssacliDiskMapCache=old;_ssacliDiskMapCacheAt=oldAt;_ssacliDiskMapCacheMu.Unlock()}()
 _smartDataCacheMu.Lock()
 oldSmart, hadSmart := _smartDataCache["sdj"]
 _smartDataCacheMu.Unlock()
 defer func(){_smartDataCacheMu.Lock();if hadSmart {_smartDataCache["sdj"]=oldSmart} else {delete(_smartDataCache,"sdj")};_smartDataCacheMu.Unlock()}()
 r:=httptest.NewRequest(http.MethodGet,"/api/storage/smart/details/sdj",nil)
 w:=httptest.NewRecorder()
 (&Server{}).handleStorageSMARTDetails(w,r)
 var data map[string]interface{}
 if w.Code!=http.StatusOK || json.Unmarshal(w.Body.Bytes(),&data)!=nil {t.Fatalf("bad response: %d %s",w.Code,w.Body.String())}
 if data["nimbus_source"]!="ssacli" || data["serial_number"]!="EXPECTED" {t.Fatalf("wrong source/disk: %#v",data)}
}

func TestSMARTControllerModeCannotBecomeBareSelfTest(t *testing.T) {
 _smartModeCacheMu.Lock()
 old, existed := _smartModeCache["sdj"]
 _smartModeCache["sdj"]="ssacli"
 _smartModeCacheMu.Unlock()
 defer func(){_smartModeCacheMu.Lock();if existed {_smartModeCache["sdj"]=old} else {delete(_smartModeCache,"sdj")};_smartModeCacheMu.Unlock()}()
 args,err:=resolveSmartArgs("sdj",[]string{"-j","-t","short"})
 if err==nil || args!=nil {t.Fatalf("controller mode became smartctl command: %#v %v",args,err)}
}

func TestCachedCCISSIndexMustMatchTheRequestedSerial(t *testing.T) {
 if smartSerialMatches(map[string]interface{}{"serial_number":"OTHER"},"EXPECTED") {t.Fatal("another controller's disk accepted")}
 if smartSerialMatches(nil, "EXPECTED") || smartSerialMatches(nil, "") {t.Fatal("missing identity accepted")}
 if !smartSerialMatches(map[string]interface{}{"serial_number":" expected "},"EXPECTED") {t.Fatal("matching serial rejected")}
}
