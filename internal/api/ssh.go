package api

import (
    "encoding/json"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "fmt"
)

// handleSSHStatus - GET /services/ssh/status
func (s *Server) handleSSHStatus(w http.ResponseWriter, r *http.Request) {
    active := serviceActive("sshd")
    
    // Pobierz port SSH
    port := "22"
    out, _ := runCmd("grep", "-Po", "^Port\\s+\\K\\d+", "/etc/ssh/sshd_config")
    if out = strings.TrimSpace(out); out != "" {
        port = out
    }
    
    // Sprawdź konfigurację
    passAuth := sshConfigBool("PasswordAuthentication", "yes")
    rootLogin := sshConfigBool("PermitRootLogin", "prohibit-password")
    sftpEnabled := !sshConfigBool("Subsystem", "sftp")
    x11Forward := sshConfigBool("X11Forwarding", "yes")
    
    jsonOK(w, map[string]any{
        "active":         active,
        "port":           port,
        "password_auth":  passAuth,
        "root_login":     rootLogin,
        "sftp_enabled":   sftpEnabled,
        "x11_forwarding": x11Forward,
    })
}

// handleSSHToggle - POST /services/ssh/toggle
func (s *Server) handleSSHToggle(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Enable bool `json:"enable"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    if req.Enable {
        runCmd("systemctl", "enable", "--now", "sshd")
    } else {
        runCmd("systemctl", "disable", "--now", "sshd")
    }
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleSSHConfig - GET/POST /services/ssh/config
func (s *Server) handleSSHConfig(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        config := readFileStr("/etc/ssh/sshd_config")
        jsonOK(w, map[string]string{"config": config})
        
    case http.MethodPost:
        var req struct {
            Port          string `json:"port"`
            PasswordAuth  *bool  `json:"password_auth"`
            RootLogin     *bool  `json:"root_login"`
            SFTPEnabled   *bool  `json:"sftp_enabled"`
            X11Forwarding *bool  `json:"x11_forwarding"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.Port != "" {
            sshConfigSet("Port", req.Port)
        }
        if req.PasswordAuth != nil {
            val := "no"
            if *req.PasswordAuth { val = "yes" }
            sshConfigSet("PasswordAuthentication", val)
        }
        if req.RootLogin != nil {
            val := "no"
            if *req.RootLogin { val = "prohibit-password" }
            sshConfigSet("PermitRootLogin", val)
        }
        if req.X11Forwarding != nil {
            val := "no"
            if *req.X11Forwarding { val = "yes" }
            sshConfigSet("X11Forwarding", val)
        }
        
        runCmd("systemctl", "reload", "sshd")
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleSSHKeys - GET/POST /services/ssh/keys
func (s *Server) handleSSHKeys(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        keys := getSSHAuthorizedKeys()
        jsonOK(w, map[string]any{"keys": keys})
        
    case http.MethodPost:
        var req struct {
            User string `json:"user"`
            Key  string `json:"key"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.User == "" || req.Key == "" {
            jsonErr(w, "user and key required", http.StatusBadRequest)
            return
        }
        
        userHome := "/home/" + req.User
        if req.User == "root" {
            userHome = "/root"
        }
        
        sshDir := userHome + "/.ssh"
        authFile := sshDir + "/authorized_keys"
        
        os.MkdirAll(sshDir, 0700)
        
        f, err := os.OpenFile(authFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
        if err != nil {
            jsonErr(w, err.Error(), http.StatusInternalServerError)
            return
        }
        defer f.Close()
        
        f.WriteString(req.Key + "\n")
        
        if req.User != "root" {
            runCmd("chown", "-R", req.User+":"+req.User, sshDir)
        }
        
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleSSHKeyDelete - DELETE /services/ssh/keys/delete
func (s *Server) handleSSHKeyDelete(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodDelete {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        User      string `json:"user"`
        KeyPrefix string `json:"key_prefix"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    userHome := "/home/" + req.User
    if req.User == "root" {
        userHome = "/root"
    }
    
    authFile := userHome + "/.ssh/authorized_keys"
    if _, err := os.Stat(authFile); os.IsNotExist(err) {
        jsonOK(w, map[string]string{"status": "ok"})
        return
    }
    
    data, err := os.ReadFile(authFile)
    if err != nil {
        jsonErr(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    lines := strings.Split(string(data), "\n")
    var filtered []string
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        if !strings.HasPrefix(line, req.KeyPrefix) {
            filtered = append(filtered, line)
        }
    }
    
    os.WriteFile(authFile, []byte(strings.Join(filtered, "\n")+"\n"), 0600)
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleSSHConnections - GET /services/ssh/connections
func (s *Server) handleSSHConnections(w http.ResponseWriter, r *http.Request) {
    var connections []map[string]any
    
    // Znajdź port SSH z konfiguracji
    sshPort := getSSHPort()
    
    // Szukaj połączeń na porcie SSH
    out, _ := runCmd("bash", "-c", fmt.Sprintf("ss -tnp | grep ':%s ' | grep -v LISTEN", sshPort))
    
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        if line == "" {
            continue
        }
        
        fields := strings.Fields(line)
        if len(fields) < 5 {
            continue
        }
        
        // Parsuj linię formatu:
        // ESTAB  0  0  192.168.1.23:2428  192.168.1.54:41472  users:(("sshd-session",pid=2290444,fd=7))
        
        // Peer address (IP klienta) - 5 kolumna
        peerAddr := fields[4]
        clientIP := strings.Split(peerAddr, ":")[0]
        
        // Znajdź PID z users:((...))
        pid := ""
        for _, field := range fields {
            if strings.Contains(field, "pid=") {
                // Format: pid=2290444,fd=7))
                pidPart := strings.Split(field, "pid=")[1]
                pid = strings.Split(pidPart, ",")[0]
                break
            }
        }
        
        // Pobierz użytkownika
        user := "unknown"
        if pid != "" {
            out, _ := runCmd("ps", "-o", "user=", "-p", pid)
            user = strings.TrimSpace(out)
        }
        
        // Pobierz czas sesji
        since := "—"
        if pid != "" {
            out, _ := runCmd("ps", "-o", "etime=", "-p", pid)
            since = strings.TrimSpace(out)
        }
        
        // Dodaj tylko jeśli znaleziono IP i nie jest to localhost
        if clientIP != "" && clientIP != "127.0.0.1" && clientIP != "::1" {
            connections = append(connections, map[string]any{
                "user":  user,
                "ip":    clientIP,
                "pid":   pid,
                "since": since,
                "port":  sshPort,
            })
        }
    }
    
    jsonOK(w, map[string]any{"connections": connections})
}

func getSSHPort() string {
    // Domyślny port
    port := "22"
    
    // Sprawdź konfigurację SSH
    out, _ := runCmd("grep", "-Po", "^Port\\s+\\K\\d+", "/etc/ssh/sshd_config")
    if out = strings.TrimSpace(out); out != "" {
        port = out
        return port
    }
    
    // Fallback: sprawdź nasłuchujący port
    out, _ = runCmd("bash", "-c", "ss -tlnp | grep sshd | head -1 | awk '{print $4}' | rev | cut -d: -f1 | rev")
    if out = strings.TrimSpace(out); out != "" {
        port = out
    }
    
    return port
}

// Funkcje pomocnicze dla SSH

func sshConfigBool(key, defaultValue string) bool {
    data, err := os.ReadFile("/etc/ssh/sshd_config")
    if err != nil {
        return false
    }
    
    for _, line := range strings.Split(string(data), "\n") {
        line = strings.TrimSpace(line)
        if strings.HasPrefix(line, "#") {
            continue
        }
        if strings.HasPrefix(line, key+" ") || strings.HasPrefix(line, key+"\t") {
            parts := strings.Fields(line)
            if len(parts) >= 2 {
                val := parts[1]
                if key == "PasswordAuthentication" || key == "X11Forwarding" {
                    return val == "yes"
                }
                if key == "PermitRootLogin" {
                    return val != "no"
                }
                if key == "Subsystem" {
                    return strings.Contains(line, "sftp")
                }
                return val == defaultValue
            }
        }
    }
    
    return false
}

func sshConfigSet(key, value string) {
    config, err := os.ReadFile("/etc/ssh/sshd_config")
    if err != nil {
        return
    }
    
    lines := strings.Split(string(config), "\n")
    found := false
    
    for i, line := range lines {
        trimmed := strings.TrimSpace(line)
        if strings.HasPrefix(trimmed, "#") {
            continue
        }
        if strings.HasPrefix(trimmed, key+" ") || strings.HasPrefix(trimmed, key+"\t") {
            lines[i] = key + " " + value
            found = true
            break
        }
    }
    
    if !found {
        lines = append(lines, key+" "+value)
    }
    
    os.WriteFile("/etc/ssh/sshd_config", []byte(strings.Join(lines, "\n")), 0644)
}

func getSSHAuthorizedKeys() []map[string]any {
    var keys []map[string]any
    
    homePatterns := []string{"/home/*", "/root"}
    
    for _, pattern := range homePatterns {
        dirs, _ := filepath.Glob(pattern)
        for _, dir := range dirs {
            authFile := dir + "/.ssh/authorized_keys"
            data, err := os.ReadFile(authFile)
            if err != nil {
                continue
            }
            
            user := filepath.Base(dir)
            
            for _, line := range strings.Split(string(data), "\n") {
                line = strings.TrimSpace(line)
                if line == "" || strings.HasPrefix(line, "#") {
                    continue
                }
                
                fields := strings.Fields(line)
                if len(fields) < 2 {
                    continue
                }
                
                keyType := fields[0]
                comment := ""
                if len(fields) >= 3 {
                    comment = fields[len(fields)-1]
                }
                
                keys = append(keys, map[string]any{
                    "user":        user,
                    "type":        keyType,
                    "fingerprint": comment,
                    "raw":         line,
                })
            }
        }
    }
    
    return keys
}

func getProcessUser(pid string) string {
    out, _ := runCmd("ps", "-o", "user=", "-p", pid)
    return strings.TrimSpace(out)
}
