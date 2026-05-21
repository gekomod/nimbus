#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Nimbus NAS Panel — Instalator / Aktualizator               ║
# ║  Użycie: sudo bash install.sh [--port PORT] [--update]      ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Kolory ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}  →${NC}  $*"; }
ok()    { echo -e "${GREEN}  ✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC}  $*"; }
die()   { echo -e "${RED}  ✗${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ── Argumenty ──────────────────────────────────────────────────────────────────
PORT=80
UPDATE=0
SKIP_BUILD=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
    case $1 in
        --port)       PORT="$2"; shift 2 ;;
        --update)     UPDATE=1; shift ;;
        --skip-build) SKIP_BUILD=1; shift ;;
        -h|--help)
            echo "Użycie: sudo bash install.sh [opcje]"
            echo "  --port PORT      Port HTTP (domyślnie: 80)"
            echo "  --update         Aktualizuj istniejącą instalację"
            echo "  --skip-build     Pomiń kompilację (użyj gotowych binaries)"
            exit 0 ;;
        *) die "Nieznana opcja: $1" ;;
    esac
done

INSTALL_DIR="/opt/nimbus"
NIMBUS_BIN="$INSTALL_DIR/nimbus"
CONFIG_DIR="/etc/nas-panel"
DATA_DIR="/var/lib/nimbus"

# ── Nagłówek ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ${BOLD}Nimbus NAS Panel${NC}${CYAN}  v3.5                                    ║${NC}"
if [ "$UPDATE" = "1" ]; then
echo -e "${CYAN}║  Tryb: Aktualizacja                                          ║${NC}"
else
echo -e "${CYAN}║  Tryb: Świeża instalacja                                     ║${NC}"
fi
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Sprawdź root ───────────────────────────────────────────────────────────────
[ "$(id -u)" = "0" ] || die "Uruchom jako root: sudo bash install.sh"

# ── Sprawdź OS ─────────────────────────────────────────────────────────────────
step "Sprawdzanie systemu"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "System: $PRETTY_NAME"
else
    warn "Nie można wykryć systemu operacyjnego"
fi

ARCH=$(uname -m)
info "Architektura: $ARCH"
[ "$ARCH" = "x86_64" ] || [ "$ARCH" = "aarch64" ] || \
    warn "Architektura $ARCH może nie być obsługiwana"

# ── Zależności systemowe ───────────────────────────────────────────────────────
step "Instalacja zależności systemowych"

if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -q \
        libpam0g \
        smartmontools \
        hdparm \
        util-linux \
        curl \
        gzip \
        2>/dev/null || true
    ok "Pakiety podstawowe zainstalowane"
else
    warn "apt-get niedostępny — sprawdź ręcznie zależności"
fi

# ── Opcjonalne komponenty ──────────────────────────────────────────────────────
step "Sprawdzanie opcjonalnych komponentów"

check_optional() {
    local pkg="$1" cmd="$2" desc="$3"
    if command -v "$cmd" &>/dev/null; then
        ok "$desc — dostępny"
    else
        warn "$desc — niedostępny (apt install $pkg)"
    fi
}

check_optional "zfsutils-linux"     "zfs"          "ZFS"
check_optional "docker.io"          "docker"       "Docker"
check_optional "libvirt-daemon"     "virsh"        "KVM/libvirt"
check_optional "nut"                "upsc"         "NUT (UPS)"
check_optional "clamav-daemon"      "clamd"        "ClamAV"
check_optional "nfs-kernel-server"  "exportfs"     "NFS Server"
check_optional "samba"              "smbd"         "Samba"
check_optional "postfix"            "postfix"      "Postfix (SMTP)"
check_optional "dovecot-core"       "dovecot"      "Dovecot (IMAP)"
check_optional "wireguard-tools"    "wg"           "WireGuard"
check_optional "ufw"                "ufw"          "UFW Firewall"
check_optional "novnc"              "websockify"   "noVNC (KVM console)"

# ── Go — instalacja jeśli brak ────────────────────────────────────────────────
install_go() {
    step "Instalacja Go"
    GO_VER="1.22.4"
    if [ "$ARCH" = "aarch64" ]; then
        GO_ARCH="arm64"
    else
        GO_ARCH="amd64"
    fi
    GO_URL="https://go.dev/dl/go${GO_VER}.linux-${GO_ARCH}.tar.gz"
    info "Pobieranie Go ${GO_VER}…"
    curl -fsSL "$GO_URL" -o /tmp/go.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz
    export PATH=$PATH:/usr/local/go/bin
    ok "Go $(go version | awk '{print $3}') zainstalowane"
}

if [ "$SKIP_BUILD" = "0" ]; then
    if ! command -v go &>/dev/null; then
        install_go
    else
        info "Go: $(go version | awk '{print $3}')"
        ok "Go dostępne"
    fi
fi

# ── esbuild — instalacja jeśli brak ───────────────────────────────────────────
install_esbuild() {
    step "Instalacja esbuild"
    if command -v go &>/dev/null; then
        info "Instalacja przez go install…"
        GOPATH=$(go env GOPATH)
        go install github.com/evanw/esbuild/cmd/esbuild@latest
        if [ -f "$GOPATH/bin/esbuild" ]; then
            ln -sf "$GOPATH/bin/esbuild" /usr/local/bin/esbuild
            ok "esbuild $(esbuild --version) zainstalowany"
            return
        fi
    fi
    # Fallback — pobierz binarny
    info "Pobieranie binarnego esbuild…"
    if [ "$ARCH" = "aarch64" ]; then
        ESBUILD_ARCH="linux-arm64"
    else
        ESBUILD_ARCH="linux-x64"
    fi
    curl -fsSL "https://github.com/evanw/esbuild/releases/latest/download/esbuild-${ESBUILD_ARCH}.zip" \
        -o /tmp/esbuild.zip
    unzip -q /tmp/esbuild.zip -d /tmp/esbuild-bin
    mv /tmp/esbuild-bin/esbuild /usr/local/bin/esbuild
    chmod +x /usr/local/bin/esbuild
    rm -rf /tmp/esbuild.zip /tmp/esbuild-bin
    ok "esbuild $(esbuild --version) zainstalowany"
}

if [ "$SKIP_BUILD" = "0" ]; then
    if ! command -v esbuild &>/dev/null; then
        install_esbuild
    else
        ok "esbuild $(esbuild --version) dostępny"
    fi
fi

# ── Budowanie ─────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = "0" ]; then
    step "Budowanie Nimbus"

    if [ ! -f "$SCRIPT_DIR/go.mod" ]; then
        die "Nie znaleziono go.mod — uruchom install.sh z katalogu źródłowego"
    fi

    cd "$SCRIPT_DIR"

    info "Kompilacja JS (esbuild)…"
    make js
    ok "bundle.js gotowy"

    info "Kompilacja Go…"
    make go
    ok "Binarka nimbus gotowa"
else
    [ -f "$SCRIPT_DIR/nimbus" ]               || die "Brak binarki 'nimbus' — uruchom make all"
    [ -f "$SCRIPT_DIR/web/static/bundle.js" ] || die "Brak bundle.js — uruchom make js"
    ok "Używam gotowych plików (--skip-build)"
fi

# ── Zatrzymaj usługę jeśli działa ─────────────────────────────────────────────
if systemctl is-active --quiet nimbus 2>/dev/null; then
    step "Zatrzymywanie usługi"
    systemctl stop nimbus
    ok "Nimbus zatrzymany"
fi

# ── Backup konfiguracji przy aktualizacji ─────────────────────────────────────
if [ "$UPDATE" = "1" ] && [ -d "$CONFIG_DIR" ]; then
    step "Backup konfiguracji"
    BACKUP_DIR="/var/backups/nimbus-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r "$CONFIG_DIR" "$BACKUP_DIR/" 2>/dev/null || true
    # Zachowaj też dane
    [ -d "$DATA_DIR" ] && cp -r "$DATA_DIR" "$BACKUP_DIR/" 2>/dev/null || true
    ok "Backup: $BACKUP_DIR"
fi

# ── Katalogi ──────────────────────────────────────────────────────────────────
step "Tworzenie katalogów"
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/quarantine"   # ClamAV kwarantanna
mkdir -p "/var/lib/clamav/quarantine" 2>/dev/null || true
chmod 750 "$CONFIG_DIR"
chmod 700 "$DATA_DIR/quarantine" 2>/dev/null || true
ok "Katalogi gotowe"

# ── Kopiowanie plików ─────────────────────────────────────────────────────────
step "Instalacja plików"
cp "$SCRIPT_DIR/nimbus" "$NIMBUS_BIN"
chmod 755 "$NIMBUS_BIN"

rm -rf "$INSTALL_DIR/web"
cp -r "$SCRIPT_DIR/web" "$INSTALL_DIR/"

# Usuń pozostałości po poprzednich wersjach
rm -f "$INSTALL_DIR/web/static/live.jsx"
rm -f "$INSTALL_DIR/web/static/live.go"

ok "Pliki zainstalowane w $INSTALL_DIR"

# ── NUT — uprawnienia ─────────────────────────────────────────────────────────
if command -v upsc &>/dev/null; then
    step "Konfiguracja NUT (UPS)"
    # Utwórz regułę udev dla UPS ViewPower (Cypress 0665)
    cat > /etc/udev/rules.d/90-nimbus-ups.rules << 'UDEV'
SUBSYSTEM=="usb", ATTR{idVendor}=="0665", MODE="0666", GROUP="nut"
KERNEL=="hidraw*", ATTRS{idVendor}=="0665", MODE="0666", GROUP="nut"
UDEV
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger 2>/dev/null || true
    ok "NUT udev rules skonfigurowane"
fi

# ── ClamAV — uprawnienia ──────────────────────────────────────────────────────
if command -v clamd &>/dev/null || command -v clamscan &>/dev/null; then
    step "Konfiguracja ClamAV"
    mkdir -p /var/lib/clamav/quarantine
    chown -R clamav:clamav /var/lib/clamav/quarantine 2>/dev/null || true
    chmod 755 /var/lib/clamav/quarantine
    ok "ClamAV katalogi skonfigurowane"
fi

# ── KVM/libvirt — uprawnienia ─────────────────────────────────────────────────
if command -v virsh &>/dev/null; then
    step "Konfiguracja KVM"
    # Sprawdź czy libvirtd działa
    if ! systemctl is-active --quiet libvirtd 2>/dev/null; then
        systemctl enable --now libvirtd 2>/dev/null || warn "Nie można uruchomić libvirtd"
    else
        ok "libvirtd aktywny"
    fi
fi

# ── Systemd service ───────────────────────────────────────────────────────────
step "Konfiguracja systemd"

if [ "$UPDATE" = "1" ] && [ -f /etc/systemd/system/nimbus.service ]; then
    EXISTING_PORT=$(grep "ExecStart=" /etc/systemd/system/nimbus.service \
        | grep -o '\-port [0-9]*' | awk '{print $2}')
    if [ -n "$EXISTING_PORT" ]; then
        PORT="$EXISTING_PORT"
        info "Zachowuję istniejący port: $PORT"
    fi
fi

cat > /etc/systemd/system/nimbus.service << EOF
[Unit]
Description=Nimbus NAS Panel v3.5
Documentation=https://github.com/gekomod/nimbus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$NIMBUS_BIN -port $PORT -web $INSTALL_DIR/web/static
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nimbus

# Limity
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nimbus
ok "Systemd skonfigurowany (port: $PORT)"

# ── Uprawnienia ───────────────────────────────────────────────────────────────
step "Ustawienia uprawnień"
chmod 750 "$NIMBUS_BIN"
chown root:root "$NIMBUS_BIN"
chown -R root:root "$INSTALL_DIR/web"
ok "Uprawnienia ustawione"

# ── Uruchomienie ──────────────────────────────────────────────────────────────
step "Uruchamianie Nimbus"
systemctl start nimbus
sleep 3

if systemctl is-active --quiet nimbus; then
    ok "Nimbus działa"
else
    warn "Problem z uruchomieniem — sprawdź logi:"
    journalctl -u nimbus -n 20 --no-pager || true
    die "Instalacja nieudana"
fi

# ── Podsumowanie ──────────────────────────────────────────────────────────────
IP=$(ip -4 route get 1 2>/dev/null | awk '{print $7; exit}' 2>/dev/null || echo "localhost")
if [ "$PORT" = "80" ]; then
    URL="http://${IP}"
else
    URL="http://${IP}:${PORT}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ${BOLD}Instalacja zakończona pomyślnie!${NC}${GREEN}                          ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
printf  "${GREEN}║  Panel:%-54s║${NC}\n" "  $URL"
echo -e "${GREEN}║  Logi:     journalctl -fu nimbus                             ║${NC}"
echo -e "${GREEN}║  Restart:  systemctl restart nimbus                          ║${NC}"
echo -e "${GREEN}║  Status:   systemctl status nimbus                           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Konfiguracja: $CONFIG_DIR/                        ║${NC}"
echo -e "${GREEN}║  Dane:         $DATA_DIR/                         ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Moduły opcjonalne (zainstaluj jeśli potrzebne):             ║${NC}"
echo -e "${GREEN}║   apt install nut clamav-daemon libvirt-daemon-system qemu   ║${NC}"
echo -e "${GREEN}║   apt install postfix dovecot-core novnc websockify           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$UPDATE" = "0" ]; then
    ADMIN_PASS=$(journalctl -u nimbus -n 50 --no-pager 2>/dev/null \
        | grep -i "hasło\|password\|admin" | tail -1 || true)
    if [ -n "$ADMIN_PASS" ]; then
        echo -e "${YELLOW}  Hasło admina:${NC} $ADMIN_PASS"
    else
        warn "Sprawdź hasło admina: journalctl -u nimbus -n 30 | grep -i hasło"
    fi
fi

echo ""
