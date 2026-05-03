// internal/api/ftp.go
package api

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "os/exec"
    "strings"
    "strconv"
)

// handleFTPStatus - GET /api/services/ftp-sftp/status
func (s *Server) handleFTPStatus(w http.ResponseWriter, r *http.Request) {
    // Sprawdź różne serwery FTP
    active := serviceActive("vsftpd") || serviceActive("proftpd") || serviceActive("pure-ftpd")
    
    // Sprawdź która usługa jest zainstalowana
    installed := false
    serviceName := ""
    
    for _, svc := range []string{"vsftpd", "proftpd", "pure-ftpd"} {
        if _, err := exec.LookPath(svc); err == nil {
            installed = true
            serviceName = svc
            break
        }
    }
    
    // Pobierz konfigurację
    config := readFTPConfig(serviceName)
    
    jsonOK(w, map[string]any{
        "active":      active,
        "installed":   installed,
        "service":     serviceName,
        "ftps_enabled": config.ftps,
        "anon_ok":     config.anonOk,
        "passive_min": config.passMin,
        "passive_max": config.passMax,
        "port":        config.port,
    })
}

// handleFTPToggle - POST /api/services/ftp-sftp/toggle
func (s *Server) handleFTPToggle(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Enable bool `json:"enable"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    // Znajdź zainstalowaną usługę
    for _, svc := range []string{"vsftpd", "proftpd", "pure-ftpd"} {
        if _, err := exec.LookPath(svc); err == nil {
            if req.Enable {
                runCmd("systemctl", "enable", "--now", svc)
            } else {
                runCmd("systemctl", "disable", "--now", svc)
            }
            break
        }
    }
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleFTPInstall - POST /api/services/ftp-sftp/install
func (s *Server) handleFTPInstall(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Service string `json:"service"` // vsftpd, proftpd
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    if req.Service == "" {
        req.Service = "vsftpd"
    }
    
    // Zainstaluj
    runCmd("apt-get", "update")
    runCmd("apt-get", "install", "-y", req.Service)
    
    // Podstawowa konfiguracja
    setupBasicFTP(req.Service)
    
    jsonOK(w, map[string]string{"status": "ok", "service": req.Service})
}

// handleFTPConfig - GET/POST /api/services/ftp-sftp/config
func (s *Server) handleFTPConfig(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        config := readFTPConfig("vsftpd")
        jsonOK(w, map[string]any{
            "ftps_enabled": config.ftps,
            "anon_ok":      config.anonOk,
            "passive_min":  config.passMin,
            "passive_max":  config.passMax,
            "port":         config.port,
        })
        
    case http.MethodPost:
        var req struct {
            FtpsEnabled *bool  `json:"ftps_enabled"`
            AnonOk      *bool  `json:"anon_ok"`
            PassiveMin  string `json:"passive_min"`
            PassiveMax  string `json:"passive_max"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.PassiveMin != "" {
            ftpConfigSet("pasv_min_port", req.PassiveMin)
        }
        if req.PassiveMax != "" {
            ftpConfigSet("pasv_max_port", req.PassiveMax)
        }
        if req.FtpsEnabled != nil {
            if *req.FtpsEnabled {
                ftpConfigSet("ssl_enable", "YES")
                ftpConfigSet("require_ssl_reuse", "NO")
                ftpConfigSet("ssl_ciphers", "HIGH")
            } else {
                ftpConfigSet("ssl_enable", "NO")
            }
        }
        if req.AnonOk != nil {
            if *req.AnonOk {
                ftpConfigSet("anonymous_enable", "YES")
            } else {
                ftpConfigSet("anonymous_enable", "NO")
            }
        }
        
        runCmd("systemctl", "restart", "vsftpd")
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleFTPUsers - GET /api/services/ftp-sftp/users
func (s *Server) handleFTPUsers(w http.ResponseWriter, r *http.Request) {
    // Pobierz użytkowników z /etc/vsftpd.userlist lub /etc/ftpusers
    var users []map[string]any
    
    // Sprawdź vsftpd userlist
    data, err := os.ReadFile("/etc/vsftpd.userlist")
    if err == nil {
        for _, line := range strings.Split(string(data), "\n") {
            line = strings.TrimSpace(line)
            if line != "" && !strings.HasPrefix(line, "#") {
                users = append(users, map[string]any{
                    "name": line,
                    "root": "/mnt/",
                    "perm": "upload,download",
                    "last": "nigdy",
                })
            }
        }
    }
    
    // Jeśli brak, zwróć użytkowników systemowych
    if len(users) == 0 {
        out, _ := runCmd("getent", "passwd")
        for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
            if line == "" {
                continue
            }
            fields := strings.Split(line, ":")
            if len(fields) >= 7 {
                uid, _ := strconv.Atoi(fields[2])
                if uid >= 1000 {
                    users = append(users, map[string]any{
                        "name": fields[0],
                        "root": "/mnt/",
                        "perm": "upload,download",
                        "last": "—",
                    })
                }
            }
        }
    }
    
    jsonOK(w, map[string]any{"users": users})
}

// handleFTPConnections - GET /api/services/ftp-sftp/connections
func (s *Server) handleFTPConnections(w http.ResponseWriter, r *http.Request) {
    var connections []map[string]any
    
    // Sprawdź połączenia na porcie 21
    out, _ := runCmd("bash", "-c", "ss -tnp | grep ':21\\|:20' | grep ESTAB")
    
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        if line == "" {
            continue
        }
        
        fields := strings.Fields(line)
        if len(fields) >= 5 {
            // Znajdź IP klienta
            var ip string
            for _, f := range fields {
                if strings.Contains(f, ":") && !strings.HasPrefix(f, "*") && !strings.Contains(f, "pid=") {
                    ip = strings.Split(f, ":")[0]
                    break
                }
            }
            
            var pid string
            for _, f := range fields {
                if strings.HasPrefix(f, "pid=") {
                    pidPart := strings.Split(f, "=")[1]
                    pid = strings.Split(pidPart, ",")[0]
                }
            }
            
            user := "unknown"
            if pid != "" {
                userOut, _ := runCmd("ps", "-o", "user=", "-p", pid)
                user = strings.TrimSpace(userOut)
            }
            
            connections = append(connections, map[string]any{
                "user": user,
                "ip":   ip,
                "pid":  pid,
            })
        }
    }
    
    jsonOK(w, map[string]any{"connections": connections})
}

// handleFTPCreateUser - POST /api/services/ftp-sftp/create-user
func (s *Server) handleFTPCreateUser(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Name     string `json:"name"`
        Password string `json:"password"`
        Root     string `json:"root"`
        Upload   bool   `json:"upload"`
        Download bool   `json:"download"`
        Del      bool   `json:"del"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    if req.Name == "" || req.Password == "" {
        jsonErr(w, "username and password required", http.StatusBadRequest)
        return
    }
    
    // Sprawdź czy użytkownik już istnieje
    out, _ := runCmd("id", req.Name)
    if strings.TrimSpace(out) != "" && !strings.Contains(out, "no such user") {
        // Użytkownik istnieje - dodaj tylko do FTP
    } else {
        // Utwórz użytkownika systemowego
        homeDir := req.Root
        if homeDir == "" {
            homeDir = "/mnt/tank"
        }
        runCmd("useradd", "-m", "-d", homeDir, "-s", "/bin/false", req.Name)
        runCmd("bash", "-c", fmt.Sprintf("echo '%s:%s' | chpasswd", req.Name, req.Password))
    }
    
    // Dodaj do listy użytkowników vsftpd
    f, err := os.OpenFile("/etc/vsftpd.userlist", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err == nil {
        f.WriteString(req.Name + "\n")
        f.Close()
    }
    
    // Utwórz katalog domowy jeśli nie istnieje
    if _, err := os.Stat(req.Root); os.IsNotExist(err) {
        os.MkdirAll(req.Root, 0755)
        runCmd("chown", req.Name+":"+req.Name, req.Root)
    }
    
    jsonOK(w, map[string]any{
        "status": "ok",
        "user": map[string]any{
            "name": req.Name,
            "root": req.Root,
            "perm": fmt.Sprintf("%s,%s,%s", 
                map[bool]string{true: "upload", false: ""}[req.Upload],
                map[bool]string{true: "download", false: ""}[req.Download],
                map[bool]string{true: "delete", false: ""}[req.Del],
            ),
            "last": "nigdy",
        },
    })
}

// handleFTPUserDelete - DELETE
func (s *Server) handleFTPUserItem(w http.ResponseWriter, r *http.Request) {
    username := strings.TrimPrefix(r.URL.Path, "/api/services/ftp-sftp/users/")
    if username == "" {
        jsonErr(w, "username required", http.StatusBadRequest)
        return
    }
    
    if r.Method == http.MethodDelete {
        // Usuń z userlist
        data, _ := os.ReadFile("/etc/vsftpd.userlist")
        var lines []string
        for _, line := range strings.Split(string(data), "\n") {
            if strings.TrimSpace(line) != username {
                lines = append(lines, line)
            }
        }
        os.WriteFile("/etc/vsftpd.userlist", []byte(strings.Join(lines, "\n")), 0644)
        
        jsonOK(w, map[string]string{"status": "ok"})
    } else {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleFTPShares - GET /api/services/ftp-sftp/shares
func (s *Server) handleFTPShares(w http.ResponseWriter, r *http.Request) {
    // FTP nie ma udziałów jak Samba - zwróć listę katalogów dostępnych dla FTP
    var shares []map[string]any
    
    // Sprawdź katalogi z konfiguracji vsftpd
    data, err := os.ReadFile("/etc/vsftpd.conf")
    if err == nil {
        for _, line := range strings.Split(string(data), "\n") {
            line = strings.TrimSpace(line)
            if strings.HasPrefix(line, "local_root=") {
                path := strings.TrimPrefix(line, "local_root=")
                shares = append(shares, map[string]any{
                    "name":       "ftp-root",
                    "path":       path,
                    "browseable": true,
                    "read_only":  false,
                })
            }
        }
    }
    
    // Domyślne udziały
    if len(shares) == 0 {
        shares = append(shares, map[string]any{
            "name":       "ftp",
            "path":       "/srv/ftp",
            "browseable": true,
            "read_only":  false,
        })
    }
    
    jsonOK(w, map[string]any{"shares": shares})
}

// handleFTPKillConn - POST
func (s *Server) handleFTPKillConn(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        PID string `json:"pid"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    if req.PID != "" {
        runCmd("kill", req.PID)
    }
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleFTPRepairConfig - POST
func (s *Server) handleFTPRepairConfig(w http.ResponseWriter, r *http.Request) {
    setupBasicFTP("vsftpd")
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleFTPTestConfig - POST
func (s *Server) handleFTPTestConfig(w http.ResponseWriter, r *http.Request) {
    out, err := runCmd("vsftpd", "-t")
    jsonOK(w, map[string]any{"output": out, "ok": err == nil})
}

// Funkcje pomocnicze

type ftpConfig struct {
    ftps    bool
    anonOk  bool
    passMin string
    passMax string
    port    string
}

func readFTPConfig(service string) ftpConfig {
    config := ftpConfig{
        ftps:    false,
        anonOk:  false,
        passMin: "40000",
        passMax: "40100",
        port:    "21",
    }
    
    var configFile string
    switch service {
    case "vsftpd":
        configFile = "/etc/vsftpd.conf"
    case "proftpd":
        configFile = "/etc/proftpd/proftpd.conf"
    default:
        return config
    }
    
    data, err := os.ReadFile(configFile)
    if err != nil {
        return config
    }
    
    for _, line := range strings.Split(string(data), "\n") {
        line = strings.TrimSpace(line)
        if line == "" || strings.HasPrefix(line, "#") {
            continue
        }
        
        parts := strings.SplitN(line, "=", 2)
        if len(parts) == 2 {
            key := strings.TrimSpace(parts[0])
            val := strings.TrimSpace(parts[1])
            
            switch key {
            case "ssl_enable":
                config.ftps = (val == "YES")
            case "anonymous_enable":
                config.anonOk = (val == "YES")
            case "pasv_min_port":
                config.passMin = val
            case "pasv_max_port":
                config.passMax = val
            case "listen_port":
                config.port = val
            }
        }
    }
    
    return config
}

func ftpConfigSet(key, value string) {
    runCmd("bash", "-c", fmt.Sprintf(
        "sed -i 's/^%s=.*/%s=%s/' /etc/vsftpd.conf", key, key, value))
}

func setupBasicFTP(service string) {
    if service == "vsftpd" {
        config := `listen=YES
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
xferlog_enable=YES
connect_from_port_20=YES
xferlog_std_format=YES
chroot_local_user=YES
allow_writeable_chroot=YES
pasv_min_port=40000
pasv_max_port=40100
pasv_address=0.0.0.0
ssl_enable=YES
allow_anon_ssl=NO
force_local_data_ssl=YES
force_local_logins_ssl=YES
ssl_tlsv1=YES
ssl_sslv2=NO
ssl_sslv3=NO
require_ssl_reuse=NO
ssl_ciphers=HIGH
rsa_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem
rsa_private_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
seccomp_sandbox=NO
`
        os.WriteFile("/etc/vsftpd.conf", []byte(config), 0644)
        runCmd("systemctl", "enable", "vsftpd")
        runCmd("systemctl", "start", "vsftpd")
    }
}
