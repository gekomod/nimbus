# Nimbus NAS Panel

> Panel administracyjny dla domowego serwera NAS / home lab.  
> Backend w **Go 1.22** (zero zewnętrznych zależności*), frontend w **React 18 + JSX**.

```
╔══════════════════════════════════════════════════════════════╗
║  Nimbus NAS — Panel administracyjny  v3.5                    ║
║  Go 1.22 · React 18 · ~400 endpointów · Built-in proxy      ║
╚══════════════════════════════════════════════════════════════╝
```

\* jedyna zależność: `golang.org/x/crypto` dla SSH (serwery zdalne)

---

## Funkcje

| Moduł | Opis |
|---|---|
| **Dashboard** | CPU/RAM live, pule ZFS, kontenery, usługi sieciowe z toggle |
| **Dyski i pule** | ZFS pools, S.M.A.R.T. z PASSED/WARN, I/O stats |
| **Docker** | Kontenery, obrazy, sieci, wolumeny, live CPU/RAM, stosy Compose |
| **KVM / Wirtualizacja** | Maszyny wirtualne libvirt, noVNC console, zdalny VNC, snapshoty |
| **NFS** | Serwer (eksporty, klienci) + klient (skan sieci, mount, auto-start) |
| **Usługi plików** | Samba, SSH, FTP/SFTP, WebDAV — toggle + konfiguracja |
| **Sieć** | Interfejsy, WireGuard VPN, DHCP, DNS, Firewall (UFW), Reverse Proxy |
| **Serwery** | Zarządzanie zdalnymi hostami SSH — CPU/RAM/dyski/procesy na żywo |
| **Reverse Proxy** | Wbudowany proxy — domena → IP:port, bez nginx |
| **Serwery mediów** | Jellyfin, Plex, Emby, Navidrome — status, biblioteki, strumienie |
| **Antywirus ClamAV** | Skanowanie on-demand, kwarantanna, harmonogram, ochrona real-time |
| **UPS (NUT)** | Monitoring UPS przez NUT/blazer\_usb, historia napięcia, shutdown kaskadowy |
| **Serwer poczty** | Postfix + Dovecot — konfiguracja, kolejka, logi |
| **Webmail** | Wbudowany klient IMAP — odczyt, wysyłka, zarządzanie folderami |
| **Procesy** | Live lista wg CPU, kill z potwierdzeniem |
| **Logi** | journald stream, filtrowanie, eksport |
| **Terminal** | Web terminal (bash) |
| **Użytkownicy** | useradd/userdel/usermod, grupy, udziały |
| **Aktualizacje** | apt stream SSE, historia, unattended-upgrades |
| **Harmonogram** | Zadania cron — dodaj/edytuj/uruchom |
| **Powiadomienia** | Email, Telegram, Discord, Slack — reguły i alerty |
| **Uruchamianie** | Auto-start Docker, ZFS, NFS po restarcie |
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
- konfiguruje udev dla UPS (Cypress 0665)
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

### Opcjonalne komponenty

Panel działa bez nich — pokazuje komunikat z możliwością instalacji z poziomu panelu.

```bash
# Magazyn
apt install zfsutils-linux

# Kontenery
apt install docker.io

# Wirtualizacja
apt install qemu-kvm libvirt-daemon-system libvirt-clients virtinst
apt install novnc websockify        # noVNC console

# UPS
apt install nut nut-server nut-client

# Antywirus
apt install clamav clamav-daemon

# Sieć
apt install nfs-kernel-server samba openssh-server
apt install wireguard-tools ufw

# Poczta
apt install postfix dovecot-core dovecot-imapd dovecot-lmtpd

# Monitoring
apt install smartmontools hdparm
```

---

## Konfiguracja modułów

### UPS (NUT)

```bash
# Minimalna konfiguracja dla UPS ViewPower/Megatec przez USB:
echo "MODE=standalone" > /etc/nut/nut.conf

cat > /etc/nut/ups.conf << 'EOF'
[moj_ups]
  driver = blazer_usb
  port = auto
  vendorid = 0665
  productid = 5161
  desc = "PowerWalker UPS"
EOF

cat > /etc/nut/upsd.users << 'EOF'
[nimbus]
  password = nimbus123
  upsmon master
  actions = SET
  instcmds = ALL
EOF

systemctl enable --now nut-server nut-monitor
upsc moj_ups   # test połączenia
```

### ClamAV

```bash
apt install clamav clamav-daemon
systemctl enable --now clamav-daemon clamav-freshclam
freshclam       # pobierz bazy sygnatur
```

### KVM + noVNC

```bash
apt install qemu-kvm libvirt-daemon-system novnc websockify
systemctl enable --now libvirtd

# Test
virsh list --all
```

### Poczta (Postfix + Dovecot)

```bash
apt install postfix dovecot-core dovecot-imapd dovecot-lmtpd

# Konfiguracja przez panel Nimbus → Serwer poczty → Konfiguracja
# lub ręcznie:
postconf -e "virtual_transport=lmtp:unix:private/dovecot-lmtp"
```

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
├── dashboard.go     # /api/dashboard — równoległe zbieranie danych
├── system.go        # CPU, RAM, procesy, logi
├── storage.go       # ZFS, dyski, SMART, montowania (statfs z timeout)
├── docker.go        # Docker API + background stats poller
├── kvm.go           # KVM/libvirt — maszyny, snapshoty, VNC
├── ups.go           # UPS przez NUT (upsc/upscmd)
├── clamav.go        # ClamAV — skanowanie, kwarantanna, harmonogram
├── mail.go          # Postfix + Dovecot konfiguracja
├── webmail.go       # Klient IMAP (wbudowany webmail)
├── proxy_routes.go  # wbudowany reverse proxy
├── servers.go       # SSH do zdalnych hostów
├── startup.go       # auto-start Docker + ZFS + NFS
└── sysmon.go        # background CPU/RAM cache
```

### Frontend

React 18 (UMD, bez node\_modules) + JSX kompilowany przez esbuild.

- `bundle.js.gz` — gzip serwowany automatycznie (~220KB vs 900KB)
- `Cache-Control: max-age=3600` na statyce
- `/api/dashboard` co 5s zamiast wielu osobnych żądań
- Toast system (`ui-modern.jsx`) — powiadomienia w stylu systemu
- Modal dialogi zamiast `window.confirm()` / `window.alert()`

---

## Konfiguracja

```
/etc/nas-panel/
├── proxy-routes.json      # trasy reverse proxy
├── servers.json           # zdalne serwery SSH
├── startup-config.json    # co robić po starcie (ZFS, Docker, NFS)
├── notifications.json     # kanały powiadomień
└── startup-state.json     # stan Docker przed restartem

/var/lib/nimbus/
├── ups_config.json        # konfiguracja UPS (nazwa, host)
├── ups_rules.json         # reguły reakcji UPS
├── clamav_schedules.json  # harmonogram skanowania
├── nfs_mounts.json        # zapisane montowania NFS (auto-start)
└── quarantine/            # ClamAV kwarantanna
```

---

## Diagnostyka

```bash
# Goroutine dump — gdy panel wisi (bez auth)
curl http://localhost:80/debug/goroutines | head -100

# Logi
journalctl -fu nimbus

# Test UPS
upsc moj_ups
upscmd -u nimbus -p nimbus123 moj_ups test.battery.start.quick

# Test ClamAV
clamscan -r /tmp --no-summary

# Test KVM
virsh list --all

# Najczęstszy problem: zawieszone NFS
# Zmień 'hard' na 'soft,timeo=30' w /etc/fstab
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
