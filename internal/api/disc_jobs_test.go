package api

import (
    "context"
    "io"
    "net"
    "net/http"
    "net/http/httptest"
    "path/filepath"
    "strings"
    "testing"
)

func TestDiscOperationUsesUnixSocketAndPreservesJobIdentity(t *testing.T) {
    path:=filepath.Join(t.TempDir(),"worker.sock")
    listener,err:=net.Listen("unix",path)
    if err!=nil {t.Fatal(err)}
    t.Setenv("NIMBUS_DISC_JOBS_SOCKET",path)
    service:=&http.Server{Handler:http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
        if r.URL.Path!="/jobs" || r.Header.Get("Idempotency-Key")!=strings.Repeat("a",32) {t.Errorf("incorrect worker request: %s",r.URL.Path)}
        body,_:=io.ReadAll(r.Body)
        if !strings.Contains(string(body),`"operation":"format"`) {t.Errorf("missing named operation: %s",body)}
        w.WriteHeader(202)
        _,_=w.Write([]byte(`{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"queued"}`))
    })}
    go service.Serve(listener)
    defer service.Close()
    defer discClient.CloseIdleConnections()
    request:=httptest.NewRequest("POST","/api/storage/format",strings.NewReader(`{"device":"/dev/sdb","fs":"ext4"}`))
    request.Header.Set("Content-Type","application/json")
    request.Header.Set("Idempotency-Key",strings.Repeat("a",32))
    response:=httptest.NewRecorder()
    (&Server{}).discOperation("format")(response,request)
    if response.Code!=202 || response.Header().Get("Location")!="/api/storage/jobs/"+strings.Repeat("a",32) {t.Fatalf("unexpected response: %d %s",response.Code,response.Body.String())}
}

func TestDiscUnavailableDoesNotFallBackToLocalCommands(t *testing.T) {
    t.Setenv("NIMBUS_DISC_JOBS_SOCKET",filepath.Join(t.TempDir(),"missing.sock"))
    discClient.CloseIdleConnections()
    _,status,err:=discCall(context.Background(),"GET","/health",nil,"")
    if status!=503 || err==nil {t.Fatalf("expected unavailable service, got %d %v",status,err)}
}

func TestDiscOperationRejectsCrossOriginBeforeSubmitting(t *testing.T) {
    request:=httptest.NewRequest("POST","http://nimbus/api/storage/format",strings.NewReader(`{"device":"/dev/sdb"}`))
    request.Header.Set("Content-Type","application/json")
    request.Header.Set("Origin","https://other.example")
    response:=httptest.NewRecorder()
    (&Server{}).discOperation("format")(response,request)
    if response.Code!=403 {t.Fatalf("expected origin rejection, got %d",response.Code)}
}
