package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func remoteService(bin, service string) map[string]any {
	r:=map[string]any{"installed":isInstalled(bin),"running":serviceActive(service),"enabled":serviceEnabled(service)}
	if bin=="tailscale" && isInstalled(bin) { if out,e:=runCmd("tailscale","status","--json");e==nil { var v any;if json.Unmarshal([]byte(out),&v)==nil{r["details"]=v} } }
	if bin=="cloudflared" && isInstalled(bin) { if out,e:=runCmd("cloudflared","tunnel","info");e==nil { r["details_text"]=out } }
	return r
}

func (s *Server) handleRemoteAccessStatus(w http.ResponseWriter,r *http.Request){
	if r.Method!=http.MethodGet{jsonErr(w,"method not allowed",405);return}
	jsonOK(w,map[string]any{"tailscale":remoteService("tailscale","tailscaled"),"cloudflare":remoteService("cloudflared","cloudflared")})
}

func (s *Server) handleRemoteAccessAction(w http.ResponseWriter,r *http.Request){
	if r.Method!=http.MethodPost{jsonErr(w,"method not allowed",405);return}
	var q struct{Provider,Action,Token string};if json.NewDecoder(r.Body).Decode(&q)!=nil{jsonErr(w,"nieprawidłowe dane",400);return}
	var out string;var err error
	switch q.Provider+":"+q.Action{
	case "tailscale:install": out,err=runCmd("bash","-c","curl -fsSL https://tailscale.com/install.sh | sh")
	case "tailscale:start": out,err=runCmd("systemctl","enable","--now","tailscaled")
	case "tailscale:connect": out,err=runCmd("tailscale","up")
	case "tailscale:logout": out,err=runCmd("tailscale","logout")
	case "cloudflare:install": out,err=runCmd("bash","-c","apt-get update && apt-get install -y cloudflared")
	case "cloudflare:connect": if strings.TrimSpace(q.Token)==""{jsonErr(w,"token tunelu jest wymagany",400);return};out,err=runCmd("cloudflared","service","install",strings.TrimSpace(q.Token))
	case "cloudflare:start": out,err=runCmd("systemctl","enable","--now","cloudflared")
	case "cloudflare:stop": out,err=runCmd("systemctl","disable","--now","cloudflared")
	default: jsonErr(w,"nieobsługiwana akcja",400);return
	}
	if err!=nil{jsonErr(w,strings.TrimSpace(out),500);return};jsonOK(w,map[string]any{"status":"ok","output":out})
}
