package api

import (
    "bytes"
    "context"
    "crypto/rand"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net"
    "net/http"
    "net/url"
    "nimbus/internal/sys"
    "os"
    "path/filepath"
    "strings"
    "time"
)

func init() { sys.StorageCommand = discReadCommand }

func discSocket() string {
    if path := os.Getenv("NIMBUS_DISC_JOBS_SOCKET"); path != "" { return path }
    return "/run/nimbus/disc-jobs.sock"
}

var discClient = &http.Client{
    Timeout: 25*time.Second,
    Transport: &http.Transport{
        DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
            return (&net.Dialer{Timeout: 2*time.Second}).DialContext(ctx, "unix", discSocket())
        },
        MaxIdleConnsPerHost: 4,
        ResponseHeaderTimeout: 24*time.Second,
    },
}

func discCall(ctx context.Context, method, path string, body []byte, key string) ([]byte, int, error) {
    req, err := http.NewRequestWithContext(ctx, method, "http://disc-jobs"+path, bytes.NewReader(body))
    if err != nil { return nil, 500, err }
    req.Header.Set("Content-Type", "application/json")
    if key != "" { req.Header.Set("Idempotency-Key", key) }
    resp, err := discClient.Do(req)
    if err != nil { return nil, 503, fmt.Errorf("Usługa operacji dyskowych jest niedostępna. Sprawdź nimbus-disc-jobs.service. Nie ponawiaj operacji przed sprawdzeniem historii zadań") }
    defer resp.Body.Close()
    data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
    if err != nil { return nil, 502, err }
    if len(data)>2*1024*1024 || !json.Valid(data) { return nil, 502, fmt.Errorf("nieprawidłowa odpowiedź usługi dyskowej") }
    return data, resp.StatusCode, nil
}

func discReply(w http.ResponseWriter, r *http.Request, method, path string, body []byte, key string) {
    data, code, err := discCall(r.Context(), method, path, body, key)
    if err != nil { jsonErr(w, err.Error(), code); return }
    if code==200 && strings.HasPrefix(path,"/jobs/") {
        var job struct {State string `json:"state"`}
        if json.Unmarshal(data,&job)==nil && (job.State=="succeeded" || job.State=="failed" || job.State=="interrupted") { invalidateMountsCache() }
    }
    if code == 202 && key != "" { w.Header().Set("Location", "/api/storage/jobs/"+key) }
    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Cache-Control", "no-store")
    w.WriteHeader(code)
    _, _ = w.Write(data)
}

func discBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
    r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
    var values map[string]any
    dec := json.NewDecoder(r.Body)
    if err := dec.Decode(&values); err != nil && err != io.EOF { jsonErr(w, "nieprawidłowe dane JSON", 400); return nil,false }
    if values == nil { values=map[string]any{} }
    // Legacy Go request structs accepted case-insensitive field names.
    normalized:=map[string]any{}
    for k,v:=range values { normalized[strings.ToLower(k)]=v }
    return normalized,true
}

func (s *Server) submitDiscJob(w http.ResponseWriter, r *http.Request, values map[string]any) {
    // State changes require the same-origin JSON API, in addition to auth_.
    if !strings.HasPrefix(r.Header.Get("Content-Type"),"application/json") && r.ContentLength>0 { jsonErr(w,"wymagany Content-Type application/json",415);return }
    if origin:=r.Header.Get("Origin"); origin!="" {
        u,err:=url.Parse(origin)
        if err!=nil || u.Host!=r.Host { jsonErr(w,"niedozwolone źródło żądania",403);return }
    }
    key:=r.Header.Get("Idempotency-Key")
    if key=="" {
        var id [16]byte
        if _,err:=rand.Read(id[:]);err!=nil {jsonErr(w,err.Error(),500);return}
        key=hex.EncodeToString(id[:])
    }
    data,err:=json.Marshal(values)
    if err!=nil {jsonErr(w,err.Error(),400);return}
    // Return the key even when an HTTP timeout makes acceptance uncertain.
    w.Header().Set("X-Nimbus-Job-ID",key)
    discReply(w,r,http.MethodPost,"/jobs",data,key)
}

func (s *Server) discOperation(operation string) http.HandlerFunc {
    return func(w http.ResponseWriter,r *http.Request) {
        if r.Method!=http.MethodPost {jsonErr(w,"method not allowed",405);return}
        values,ok:=discBody(w,r);if !ok{return}
        values["operation"]=operation
        s.submitDiscJob(w,r,values)
    }
}

func (s *Server) handleDiscJobs(w http.ResponseWriter,r *http.Request) {
    if r.Method==http.MethodPost && r.URL.Path=="/api/storage/jobs" {
        values,ok:=discBody(w,r);if !ok{return};s.submitDiscJob(w,r,values);return
    }
    if r.Method!=http.MethodGet {jsonErr(w,"method not allowed",405);return}
    suffix:=strings.TrimPrefix(r.URL.Path,"/api/storage/jobs")
    if suffix!="" && (strings.Count(suffix,"/")!=1 || len(suffix)<33 || len(suffix)>37) {jsonErr(w,"nieprawidłowy identyfikator zadania",400);return}
    discReply(w,r,http.MethodGet,"/jobs"+suffix,nil,"")
}

func (s *Server) handleDiscHealth(w http.ResponseWriter,r *http.Request) {
    if r.Method!=http.MethodGet {jsonErr(w,"method not allowed",405);return}
    discReply(w,r,http.MethodGet,"/health",nil,"")
}

func discRead(w http.ResponseWriter,r *http.Request,operation string) {
    values:=map[string]any{}
    if r.Method==http.MethodPost {var ok bool;values,ok=discBody(w,r);if !ok{return}} else if r.Method!=http.MethodGet {jsonErr(w,"method not allowed",405);return}
    values["operation"]=operation
    body,_:=json.Marshal(values)
    discReply(w,r,http.MethodPost,"/read",body,"")
}

func discReadCommand(name string,args ...string) (string,error) {
    body,_:=json.Marshal(map[string]any{"operation":"read.command","argv":append([]string{filepath.Base(name)},args...)})
    data,code,err:=discCall(context.Background(),http.MethodPost,"/read",body,"")
    if err!=nil{return "",err}
    var result struct {Output string `json:"output"`; Error string `json:"error"`}
    if err=json.Unmarshal(data,&result);err!=nil{return "",err}
    if code!=200 || result.Error!="" {return result.Output,fmt.Errorf("%s",result.Error)}
    return result.Output,nil
}

func (s *Server) handleDiscSnapshot(w http.ResponseWriter,r *http.Request) {
    snapshot:=strings.TrimPrefix(r.URL.Path,"/api/zfs/snapshots/")
    values:=map[string]any{"snapshot":snapshot,"operation":"zfs.snapshot.delete"}
    if r.Method==http.MethodPost {
        var ok bool;values,ok=discBody(w,r);if !ok{return}
        action,_:=values["action"].(string)
        if action!="clone"&&action!="rollback" {jsonErr(w,"nieznana operacja",400);return}
        values["operation"]="zfs."+action;values["snapshot"]=snapshot
    } else if r.Method!=http.MethodDelete {jsonErr(w,"method not allowed",405);return}
    s.submitDiscJob(w,r,values)
}
