#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Uruchom jako root' >&2; exit 1; }
DISC_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo 'Zainstaluj python3 przed uruchomieniem instalatora' >&2; exit 1; }
# Refuse to kill an active mkfs during an ordinary upgrade.
if systemctl is-active --quiet nimbus-disc-jobs; then
    python3 - <<'PY'
import http.client, json, socket
class Local(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect('/run/nimbus/disc-jobs.sock')
c=Local('localhost');c.request('POST','/drain');r=c.getresponse()
if r.status != 200:
    raise SystemExit('Nie można sprawdzić zadań; aktualizacja usługi wstrzymana')
if not json.load(r).get('drained'):
    raise SystemExit('Nie udało się przygotować usługi do aktualizacji')
PY
fi
install -d -m 0755 /etc/nimbus
install -m 0755 "$DISC_SOURCE/nimbus-disc-jobs" /usr/sbin/nimbus-disc-jobs
install -m 0644 "$DISC_SOURCE/nimbus-disc-jobs.service" /etc/systemd/system/nimbus-disc-jobs.service
systemctl daemon-reload
systemctl enable nimbus-disc-jobs
systemctl restart nimbus-disc-jobs
