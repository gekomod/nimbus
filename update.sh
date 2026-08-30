#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Nimbus — Szybka aktualizacja (gotowe pliki z ZIP)          ║
# ║  Użycie: sudo bash update.sh                                ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC}  $*"; }
info() { echo -e "${CYAN}  →${NC}  $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC}  $*"; }
die()  { echo -e "${RED}  ✗${NC}  $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/nimbus"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ${BOLD}Nimbus NAS Panel — Szybka aktualizacja${NC}${CYAN}                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

[ "$(id -u)" = "0" ] || die "Uruchom jako root: sudo bash update.sh"
[ -d "$INSTALL_DIR" ] || die "Nimbus nie jest zainstalowany w $INSTALL_DIR. Użyj: sudo bash install.sh"

step "Weryfikacja plików"
info "Katalog źródłowy: $SCRIPT_DIR"

# Sprawdź bundle.js
[ -f "$SCRIPT_DIR/web/static/bundle.js" ] || die "Brak bundle.js w $SCRIPT_DIR/web/static/"
BUNDLE_SIZE=$(wc -c < "$SCRIPT_DIR/web/static/bundle.js")
info "bundle.js: ${BUNDLE_SIZE} bajtów"

# Sprawdź czy nowy bundle zawiera moduł Routery
ROUTERS_OK=$(grep -c "RouterManager\|BE6500\|Cudy LT" "$SCRIPT_DIR/web/static/bundle.js" 2>/dev/null || echo 0)
if [ "$ROUTERS_OK" -gt 0 ]; then
    ok "bundle.js zawiera moduł Routery (Xiaomi/Cudy/MikroTik)"
else
    warn "bundle.js może nie zawierać modułu Routery — wersja niekompletna?"
fi

# Sprawdź binarę
[ -f "$SCRIPT_DIR/nimbus" ] || die "Brak binarki 'nimbus' w $SCRIPT_DIR. Użyj: sudo bash install.sh"
ok "Binarka nimbus obecna"

step "Zatrzymywanie usługi"
systemctl stop nimbus 2>/dev/null && ok "Nimbus zatrzymany" || warn "Nimbus nie był uruchomiony"

step "Usuwanie starych plików cache"
# Usuń stare skompresowane pliki - serwer mógł cachować stary bundle
rm -f "$INSTALL_DIR/web/static/bundle.js" \
       "$INSTALL_DIR/web/static/bundle.js.gz" \
       "$INSTALL_DIR/web/static/styles.css.gz" 2>/dev/null
ok "Stary cache usunięty"

step "Aktualizacja plików"

# Skopiuj binarę
info "Aktualizacja binarki..."
cp "$SCRIPT_DIR/nimbus" "$INSTALL_DIR/nimbus"
chmod 755 "$INSTALL_DIR/nimbus"
ok "nimbus → $INSTALL_DIR/nimbus"

# Skopiuj web/static
info "Aktualizacja interfejsu web..."
rm -rf "$INSTALL_DIR/web"
cp -r "$SCRIPT_DIR/web" "$INSTALL_DIR/"
ok "web/static → $INSTALL_DIR/web/static"

# Pokaż co jest w /opt/nimbus/web/static/
info "Zainstalowane pliki statyczne:"
ls -lh "$INSTALL_DIR/web/static/bundle.js" "$INSTALL_DIR/web/static/bundle.js.gz" 2>/dev/null || true

step "Uruchamianie usługi"
systemctl start nimbus
sleep 2

if systemctl is-active --quiet nimbus; then
    ok "Nimbus działa"
else
    warn "Problem z uruchomieniem:"
    journalctl -u nimbus -n 10 --no-pager || true
    die "Aktualizacja nieudana"
fi

IP=$(ip -4 route get 1 2>/dev/null | awk '{print $7; exit}' 2>/dev/null || echo "localhost")
PORT=$(grep "ExecStart=" /etc/systemd/system/nimbus.service 2>/dev/null | grep -o '\-port [0-9]*' | awk '{print $2}' || echo "80")
[ "$PORT" = "80" ] && URL="http://${IP}" || URL="http://${IP}:${PORT}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ${BOLD}Aktualizacja zakończona!${NC}${GREEN}                                  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
printf  "${GREEN}║  Panel: %-53s║${NC}\n" " $URL"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  Jeśli nie widzisz zmian — wyczyść cache przeglądarki:      ║${NC}"
echo -e "${GREEN}║  Ctrl+Shift+R  (Windows/Linux)                               ║${NC}"
echo -e "${GREEN}║  Cmd+Shift+R   (Mac)                                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
