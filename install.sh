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
        --port)     PORT="$2"; shift 2 ;;
        --update)   UPDATE=1; shift ;;
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
echo -e "${CYAN}║  ${BOLD}Nimbus NAS Panel${NC}${CYAN}                                          ║${NC}"
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
step "Instalacja zależności"

if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -q \
        libpam0g \
        smartmontools \
        hdparm \
        lsblk \
        curl \
        gzip \
        2>/dev/null || true
    ok "Pakiety zainstalowane"
else
    warn "apt-get niedostępny — sprawdź ręcznie: libpam0g, smartmontools"
fi

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
        GO_MIN="1.22"
        GO_CUR=$(go version | awk '{print $3}' | sed 's/go//')
        info "Go: $GO_CUR"
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
    ESBUILD_URL="https://registry.npmjs.org/@esbuild/${ESBUILD_ARCH}/-/${ESBUILD_ARCH}-$(curl -fsSL https://registry.npmjs.org/esbuild/latest | grep '"version"' | head -1 | grep -o '[0-9.]*').tgz"
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

    # Sprawdź czy mamy źródła
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
    # Tryb skip-build — sprawdź czy binarka i bundle istnieją
    [ -f "$SCRIPT_DIR/nimbus" ]           || die "Brak binarki 'nimbus' — uruchom make all"
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
    ok "Backup: $BACKUP_DIR"
fi

# ── Katalogi ──────────────────────────────────────────────────────────────────
step "Tworzenie katalogów"
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"
chmod 750 "$CONFIG_DIR"  # hasła, klucze SSH itd.
ok "Katalogi gotowe"

# ── Kopiowanie plików ─────────────────────────────────────────────────────────
step "Instalacja plików"
cp "$SCRIPT_DIR/nimbus" "$NIMBUS_BIN"
chmod 755 "$NIMBUS_BIN"

# Statyka — usuń stare pliki, skopiuj nowe
rm -rf "$INSTALL_DIR/web"
cp -r "$SCRIPT_DIR/web" "$INSTALL_DIR/"

# Usuń pozostałości po poprzednich wersjach
rm -f "$INSTALL_DIR/web/static/live.jsx"
rm -f "$INSTALL_DIR/web/static/live.go"

ok "Pliki zainstalowane w $INSTALL_DIR"

# ── Systemd service ───────────────────────────────────────────────────────────
step "Konfiguracja systemd"

# Odczytaj istniejący port jeśli aktualizacja
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
Description=Nimbus NAS Panel
Documentation=https://github.com/gekomod/nimbus
After=network-online.target zfs-mount.service
Wants=network-online.target
# Uruchom po NFS jeśli używasz
# After=network-online.target nfs-client.target

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

# Zmienne środowiskowe (odkomentuj i ustaw jeśli potrzebne)
# Environment=NAS_WEB_ADMIN_USER=admin
# Environment=NAS_WEB_ADMIN_PASS=haslo
# Environment=NAS_WEB_ADMIN_URL=http://127.0.0.1:80

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nimbus
ok "Systemd skonfigurowany (port: $PORT)"

# ── Uprawnienia ───────────────────────────────────────────────────────────────
step "Ustawienia uprawnień"

# Plik haseł CUPS / PAM
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
echo -e "${GREEN}║  Goroutiny: ${URL}/debug/goroutines                         ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Konfiguracja: $CONFIG_DIR/                        ║${NC}"
echo -e "${GREEN}║  Dane:         $DATA_DIR/                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Pokaż hasło jeśli świeża instalacja
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
