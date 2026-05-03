# Nimbus NAS Panel

> Panel administracyjny dla domowego serwera NAS / home lab.  
> Backend w **Go 1.22** (zero zewnętrznych zależności*), frontend w **React 18 + JSX**.

```
╔══════════════════════════════════════════════════════════════╗
║  Nimbus NAS — Panel administracyjny                          ║
║  Go 1.22 · React 18 · ~300 endpointów · Built-in proxy      ║
╚══════════════════════════════════════════════════════════════╝
```

\* jedyna zależność: `golang.org/x/crypto` dla SSH (serwery zdalne)

---

## Funkcje

| Moduł | Opis |
|---|---|
| **Dashboard** | CPU/RAM live, pule ZFS, kontenery, usługi sieciowe z toggle |
| **Dyski i pule** | ZFS pools, S.M.A.R.T. z PASSED/WARN, I/O stats |
| **Docker** | Kontenery, obrazy, sieci, wolumeny, live CPU/RAM każdego kontenera |
| **NFS** | Serwer (eksporty, klienci) + klient (skan sieci, mount) |
| **Usługi plików** | Samba, SSH, FTP/SFTP, WebDAV — toggle + konfiguracja |
| **Sieć** | Interfejsy, WireGuard VPN, DHCP, DNS, Firewall (UFW), Reverse Proxy |
| **Serwery** | Zarządzanie zdalnymi hostami SSH — CPU/RAM/dyski/procesy na żywo |
| **Reverse Proxy** | Wbudowany proxy — domena → IP:port, bez nginx |
| **Serwery mediów** | Jellyfin, Plex, Emby, Navidrome — status + restart |
| **Procesy** | Live lista wg CPU, kill z potwierdzeniem |
| **Logi** | journald stream, filtrowanie, eksport |
| **Terminal** | Web terminal (bash) |
| **Użytkownicy** | useradd/userdel/usermod, grupy |
| **Aktualizacje** | apt stream SSE, historia, unattended-upgrades |
| **Harmonogram** | Zadania cron — dodaj/edytuj/uruchom |
| **Powiadomienia** | Email, Telegram, Discord, Slack — reguły i alerty |
| **Uruchamianie** | Auto-start Docker i ZFS po restarcie, konfigurowalny |
| **Diagnostyka** | `/debug/goroutines` — live dump gdy coś się zawiesi |

---

## Szybki start

### Instalacja jedną komendą

```bash
git clone https://github.com/gekomod/nimbus && cd nimbus
sudo bash install.sh
```

Instalator automatycznie:
- instaluje Go i esbuild jeśli brak
- kompiluje backend + frontend
- tworzy i włącza `nimbus.service`
- uruchamia panel

### Opcje instalatora

```bash
sudo bash install.sh                # świeża instalacja (port 80)
sudo bash install.sh --port 8585    # inny port
sudo bash install.sh --update       # aktualizacja (backup config)
sudo bash install.sh --skip-build   # użyj gotowych plików
```

### Ręczna kompilacja

```bash
make install-tools  # zainstaluj esbuild (jednorazowo)
make all            # JS (minified + gzip) + Go binary
./nimbus -port 80 -web ./web/static
```

---

## Wymagania

**System:** Linux (Ubuntu 22.04+ / Debian 12+) — x86\_64 lub arm64

**Build:** Go 1.22+, esbuild (`make install-tools`)

**Opcjonalne:**
```bash
apt install zfsutils-linux nfs-kernel-server samba openssh-server
apt install docker.io ufw wireguard smartmontools
```

Panel działa bez nich — pokazuje komunikat z możliwością instalacji z poziomu panelu.

---

## Architektura

### Backend — kluczowe decyzje

- **`statfs()` z timeout 2s** — zawieszone NFS (`hard` w fstab) nie blokuje serwera
- **`CPUPercent()` z cache** — background goroutine co 2s, HTTP zwraca natychmiast
- **`docker stats` poller** — zbiera dane w tle co 2s, zero blokowania HTTP
- **`/api/dashboard`** — jeden endpoint zbiera dane z 14 handlerów równolegle (`sync.WaitGroup`)
- **Reverse proxy** — `httputil.ReverseProxy` jako middleware przed mux, trasy w pamięci

```
internal/api/
├── server.go        # routing, auth middleware, proxy handler
├── dashboard.go     # /api/dashboard — 14 handlerów równolegle
├── system.go        # CPU, RAM, procesy, logi
├── storage.go       # ZFS, dyski, SMART, montowania (statfs z timeout)
├── docker.go        # Docker API + background stats poller
├── proxy_routes.go  # wbudowany reverse proxy
├── servers.go       # SSH do zdalnych hostów
├── startup.go       # auto-start Docker + ZFS
└── sysmon.go        # background CPU/RAM cache
```

### Frontend

React 18 (UMD, bez node\_modules) + JSX kompilowany przez esbuild.

- `bundle.js.gz` — gzip serwowany automatycznie (~180KB vs 800KB)
- `Cache-Control: max-age=3600` na statyce
- `/api/dashboard` co 5s zamiast 14 osobnych żądań

### Reverse Proxy (wbudowany)

```
Internet :80
    ├── radarr.nasserver.pl  → 192.168.1.23:7878
    ├── sonarr.nasserver.pl  → 192.168.1.10:8989
    └── *                   → panel Nimbus
```

Trasy konfigurowane przez panel → zapisywane w `/etc/nas-panel/proxy-routes.json` → aktywne natychmiast.

---

## Konfiguracja

```
/etc/nas-panel/
├── proxy-routes.json    # trasy reverse proxy
├── servers.json         # zdalne serwery SSH
├── startup-config.json  # co robić po starcie (ZFS, Docker)
├── notifications.json   # kanały powiadomień
└── startup-state.json   # stan Docker przed restartem
```

---

## Diagnostyka

```bash
# Goroutine dump — gdy panel wisi (bez auth)
curl http://localhost:80/debug/goroutines | head -100

# Logi
journalctl -fu nimbus

# Najczęstszy problem: zawieszone NFS
# Zmień 'hard' na 'soft,timeo=30' w /etc/fstab
cat /proc/mounts | grep nfs
```

---

## Aktualizacja

```bash
cd nimbus && git pull
sudo bash install.sh --update
# Backup w /var/backups/nimbus-TIMESTAMP/
```

---

## Make targets

```bash
make all           # produkcja: JS (gzip) + Go binary
make js            # tylko bundle.js + bundle.js.gz
make go            # tylko Go binary
make dev           # JSX z source mapami + uruchom
make watch         # watch mode
make clean         # usuń artefakty
make install-tools # zainstaluj esbuild
make help          # lista targetów
```

---

## Licencja

MIT
