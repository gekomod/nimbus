// internal/api/samba.go
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

// handleSambaStatus - GET /services/samba/status
func (s *Server) handleSambaStatus(w http.ResponseWriter, r *http.Request) {
    active := serviceActive("smbd") || serviceActive("samba")
    
    // Pobierz workgroup - bezpośrednio z smb.conf
    workgroup := "WORKGROUP"
    out, _ := runCmd("bash", "-c", "grep -Po '^\\s*workgroup\\s*=\\s*\\K.*' /etc/samba/smb.conf | head -1")
    if out = strings.TrimSpace(out); out != "" {
        workgroup = out
    }
    
    // Pobierz netbios name
    netbios := ""
    out, _ = runCmd("bash", "-c", "grep -Po '^\\s*netbios name\\s*=\\s*\\K.*' /etc/samba/smb.conf | head -1")
    if out = strings.TrimSpace(out); out != "" {
        netbios = out
    }
    
    // Sprawdź guest ok
    guestOk := false
    out, _ = runCmd("bash", "-c", "grep -Po '^\\s*map to guest\\s*=\\s*\\K.*' /etc/samba/smb.conf | head -1")
    if out = strings.TrimSpace(out); out != "" && out != "never" && out != "bad user" {
        guestOk = true
    }
    
    jsonOK(w, map[string]any{
        "active":        active,
        "workgroup":     workgroup,
        "netbios_name":  netbios,
        "guest_ok":      guestOk,
    })
}

// handleSambaToggle - POST /services/samba/toggle
func (s *Server) handleSambaToggle(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Enable bool `json:"enable"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    if req.Enable {
        runCmd("systemctl", "enable", "--now", "smbd")
        runCmd("systemctl", "enable", "--now", "nmbd")
    } else {
        runCmd("systemctl", "disable", "--now", "smbd")
        runCmd("systemctl", "disable", "--now", "nmbd")
    }
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleSambaRestart - POST /services/samba/restart
func (s *Server) handleSambaRestart(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    runCmd("systemctl", "restart", "smbd")
    runCmd("systemctl", "restart", "nmbd")
    
    jsonOK(w, map[string]string{"status": "ok"})
}

// handleSambaSettings - GET/POST /services/samba/settings
func (s *Server) handleSambaSettings(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        config := readFileStr("/etc/samba/smb.conf")
        jsonOK(w, map[string]any{
            "config":    config,
            "workgroup": sambaGetConfig("workgroup"),
            "netbios":   sambaGetConfig("netbios name"),
            "guest_ok":  sambaConfigBool("map to guest", "never"),
        })
        
    case http.MethodPost:
        var req struct {
            Workgroup string `json:"workgroup"`
            Netbios   string `json:"netbios"`
            GuestOk   *bool  `json:"guest_ok"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.Workgroup != "" {
            sambaSetConfig("workgroup", req.Workgroup)
        }
        if req.Netbios != "" {
            sambaSetConfig("netbios name", req.Netbios)
        }
        if req.GuestOk != nil {
            val := "never"
            if *req.GuestOk {
                val = "Bad User"
            }
            sambaSetConfig("map to guest", val)
        }
        
        runCmd("systemctl", "reload", "smbd")
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleSambaShares - GET /services/samba/shares
func (s *Server) handleSambaShares(w http.ResponseWriter, r *http.Request) {
    shares := getSambaShares()
    if shares == nil {
        shares = []map[string]any{}
    }
    jsonOK(w, map[string]any{"shares": shares})
}

// handleSambaShareItem - GET/POST/DELETE /services/samba/shares/{name}
func (s *Server) handleSambaShareItem(w http.ResponseWriter, r *http.Request) {
    shareName := strings.TrimPrefix(r.URL.Path, "/services/samba/shares/")
    if shareName == "" {
        jsonErr(w, "share name required", http.StatusBadRequest)
        return
    }
    
    switch r.Method {
    case http.MethodGet:
        shares := getSambaShares()
        for _, share := range shares {
            if share["name"] == shareName {
                jsonOK(w, share)
                return
            }
        }
        jsonErr(w, "share not found", http.StatusNotFound)
        
    case http.MethodPost, http.MethodPut:
        var req struct {
            Path       string `json:"path"`
            Comment    string `json:"comment"`
            Browseable bool   `json:"browseable"`
            ReadOnly   bool   `json:"read_only"`
            GuestOk    bool   `json:"guest_ok"`
            ValidUsers string `json:"valid_users"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.Path == "" {
            jsonErr(w, "path required", http.StatusBadRequest)
            return
        }
        
        // Dodaj/aktualizuj udział
        addSambaShare(shareName, req.Path, req.Comment, req.Browseable, req.ReadOnly, req.GuestOk, req.ValidUsers)
        
        jsonOK(w, map[string]string{"status": "ok"})
        
    case http.MethodDelete:
        deleteSambaShare(shareName)
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

// handleSambaUsers - GET /services/samba/users
func (s *Server) handleSambaUsers(w http.ResponseWriter, r *http.Request) {
    out, _ := runCmd("pdbedit", "-L")
    
    var users []map[string]any
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        if line == "" {
            continue
        }
        
        fields := strings.Split(line, ":")
        if len(fields) >= 3 {
            users = append(users, map[string]any{
                "username":    fields[0],
                "uid":         fields[1],
                "full_name":   fields[2],
                "machine":     strings.Contains(line, "$"),
            })
        }
    }
    
    jsonOK(w, map[string]any{"users": users})
}

// handleSambaConnections - GET /services/samba/connections
func (s *Server) handleSambaConnections(w http.ResponseWriter, r *http.Request) {
    // smbstatus pokazuje aktywne połączenia
    out, _ := runCmd("smbstatus", "-b")
    
    var connections []map[string]any
    inConnections := false
    
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        
        if strings.Contains(line, "PID") && strings.Contains(line, "Client") {
            inConnections = true
            continue
        }
        
        if inConnections && !strings.HasPrefix(line, "-") {
            fields := strings.Fields(line)
            if len(fields) >= 5 {
                connections = append(connections, map[string]any{
                    "pid":    fields[0],
                    "client": fields[1],
                    "user":   fields[2],
                    "share":  fields[3],
                    "since":  fields[4],
                })
            }
        }
    }
    
    jsonOK(w, map[string]any{"connections": connections})
}

// Funkcje pomocnicze dla Samby

func sambaConfigBool(key, defaultValue string) bool {
    out, _ := runCmd("testparm", "-s", "--parameter-name", key, "/dev/null", "2>/dev/null")
    val := strings.TrimSpace(out)
    if val == "" {
        return false
    }
    return val != "never" && val != "no" && val != "false"
}

func sambaGetConfig(key string) string {
    // Czytaj bezpośrednio z smb.conf
    data, err := os.ReadFile("/etc/samba/smb.conf")
    if err != nil {
        return ""
    }
    
    inGlobal := false
    for _, line := range strings.Split(string(data), "\n") {
        line = strings.TrimSpace(line)
        
        if line == "[global]" {
            inGlobal = true
            continue
        }
        if inGlobal && strings.HasPrefix(line, "[") {
            break
        }
        
        if inGlobal && strings.Contains(line, "=") {
            parts := strings.SplitN(line, "=", 2)
            if len(parts) == 2 && strings.TrimSpace(parts[0]) == key {
                return strings.TrimSpace(parts[1])
            }
        }
    }
    
    return ""
}

func sambaSetConfig(key, value string) {
    // Użyj sed do zmiany konfiguracji
    runCmd("bash", "-c", fmt.Sprintf(
        "sed -i '/^\\[global\\]/,/^\\[/{s/^\\s*%s\\s*=.*/%s = %s/}' /etc/samba/smb.conf",
        key, key, value))
    
    // Jeśli nie znaleziono, dodaj do sekcji [global]
    out, _ := runCmd("grep", "-l", key, "/etc/samba/smb.conf")
    if strings.TrimSpace(out) != "/etc/samba/smb.conf" {
        runCmd("bash", "-c", fmt.Sprintf(
            "sed -i '/^\\[global\\]/a\\\t%s = %s' /etc/samba/smb.conf",
            key, value))
    }
}

func getSambaShares() []map[string]any {
    // Czytaj bezpośrednio smb.conf zamiast testparm
    data, err := os.ReadFile("/etc/samba/smb.conf")
    if err != nil {
        return nil
    }
    
    var shares []map[string]any
    var currentShare map[string]any
    inGlobal := false
    
    lines := strings.Split(string(data), "\n")
    
    for _, line := range lines {
        line = strings.TrimSpace(line)
        
        // Pomijaj puste linie i komentarze
        if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
            continue
        }
        
        // Nowa sekcja [nazwa]
        if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
            // Zapisz poprzedni udział
            if currentShare != nil && !inGlobal {
                shares = append(shares, currentShare)
            }
            
            name := line[1 : len(line)-1]
            inGlobal = (name == "global")
            
            if !inGlobal {
                currentShare = map[string]any{
                    "name":       name,
                    "path":       "/mnt/",
                    "browseable": true,
                    "read_only":  false,
                    "guest_ok":   false,
                    "valid_users": "",
                }
            } else {
                currentShare = nil
            }
            continue
        }
        
        // Parsuj parametry udziału
        if currentShare != nil && !inGlobal && strings.Contains(line, "=") {
            parts := strings.SplitN(line, "=", 2)
            if len(parts) == 2 {
                key := strings.TrimSpace(parts[0])
                val := strings.TrimSpace(parts[1])
                
                switch key {
                case "path":
                    currentShare["path"] = val
                case "valid users", "valid user":
                    currentShare["valid_users"] = val
                case "browseable", "browsable":
                    currentShare["browseable"] = val == "yes" || val == "true"
                case "read only":
                    currentShare["read_only"] = val == "yes" || val == "true"
                case "guest ok", "guest only":
                    currentShare["guest_ok"] = val == "yes" || val == "true"
                case "writable", "writeable":
                    if val == "yes" || val == "true" {
                        currentShare["read_only"] = false
                    }
                }
            }
        }
    }
    
    // Dodaj ostatni udział
    if currentShare != nil && !inGlobal {
        shares = append(shares, currentShare)
    }
    
    return shares
}

func addSambaShare(name, path, comment string, browseable, readOnly, guestOk bool, validUsers string) error {
    // Sprawdź czy ścieżka istnieje
    if _, err := os.Stat(path); os.IsNotExist(err) {
        // Utwórz katalog
        os.MkdirAll(path, 0755)
    }
    
    // Czytaj istniejącą konfigurację
    existingConfig, _ := os.ReadFile("/etc/samba/smb.conf")
    
    // Przygotuj nową sekcję udziału
    shareSection := fmt.Sprintf(`
[%s]
   path = %s
   browseable = %s
   read only = %s
   guest ok = %s
   create mask = 0664
   directory mask = 0775
`, name, path, 
   boolToYesNo(browseable), 
   boolToYesNo(readOnly),
   boolToYesNo(guestOk))
    
    if validUsers != "" {
        shareSection += fmt.Sprintf("   valid users = %s\n", validUsers)
    }
    if comment != "" {
        shareSection += fmt.Sprintf("   comment = %s\n", comment)
    }
    
    // Dodaj do pliku konfiguracyjnego
    newConfig := string(existingConfig) + shareSection
    err := os.WriteFile("/etc/samba/smb.conf", []byte(newConfig), 0644)
    if err != nil {
        return err
    }
    
    // Przeładuj Sambę
    runCmd("systemctl", "reload", "smbd")
    
    return nil
}

func (s *Server) handleSambaUsersList(w http.ResponseWriter, r *http.Request) {
    // Pobierz użytkowników systemowych
    out, _ := runCmd("getent", "passwd")
    
    var users []map[string]any
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        if line == "" {
            continue
        }
        fields := strings.Split(line, ":")
        if len(fields) >= 7 {
            uid, _ := strconv.Atoi(fields[2])
            if uid >= 1000 || uid == 0 {
                users = append(users, map[string]any{
                    "username": fields[0],
                    "uid":      uid,
                    "fullname": fields[4],
                })
            }
        }
    }
    
    // Pobierz grupy
    out, _ = runCmd("getent", "group")
    var groups []map[string]any
    for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
        if line == "" {
            continue
        }
        fields := strings.Split(line, ":")
        if len(fields) >= 4 {
            gid, _ := strconv.Atoi(fields[2])
            if gid >= 1000 || fields[0] == "users" || fields[0] == "sudo" {
                groups = append(groups, map[string]any{
                    "groupname": fields[0],
                    "gid":       gid,
                })
            }
        }
    }
    
    jsonOK(w, map[string]any{
        "users":   users,
        "groups":  groups,
        "presets": []string{"wszyscy", "@users", "@sudo"},
    })
}

func boolToYesNo(b bool) string {
    if b {
        return "yes"
    }
    return "no"
}

func deleteSambaShare(name string) {
    // Usuń sekcję udziału z smb.conf
    runCmd("bash", "-c", fmt.Sprintf(
        "sed -i '/^\\[%s\\]/,/^\\[/{/^\\[%s\\]/d;/^\\[/!d}' /etc/samba/smb.conf",
        name, name))
}

func (s *Server) handleSambaHomedirs(w http.ResponseWriter, r *http.Request) {
    // GET/POST dla ustawień katalogów domowych
    switch r.Method {
    case http.MethodGet:
        out, _ := runCmd("testparm", "-s", "--parameter-name", "valid users", "[homes]", "2>/dev/null")
        jsonOK(w, map[string]any{"homedirs_enabled": strings.TrimSpace(out) != ""})
        
    case http.MethodPost:
        var req struct {
            Enabled bool `json:"enabled"`
        }
        json.NewDecoder(r.Body).Decode(&req)
        
        if req.Enabled {
            runCmd("bash", "-c", "sed -i '/^\\[homes\\]/,/^\\[/{s/^\\s*;*\\s*browseable.*/browseable = no/; s/^\\s*;*\\s*read only.*/read only = no/}' /etc/samba/smb.conf")
        }
        
        jsonOK(w, map[string]string{"status": "ok"})
        
    default:
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

func (s *Server) handleSambaInstall(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    // Sprawdź czy samba jest zainstalowana
    if _, err := exec.LookPath("smbd"); err != nil {
        // Zainstaluj
        runCmd("apt-get", "update")
        runCmd("apt-get", "install", "-y", "samba", "samba-common-bin")
    }
    
    jsonOK(w, map[string]string{"status": "ok"})
}
