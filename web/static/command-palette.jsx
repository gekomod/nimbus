// ===== Command Palette =====

const { useState: useSCP, useEffect: useECP, useRef: useRCP, useMemo: useMCP } = React;

// Wszystkie możliwe akcje / ekrany
const CP_ITEMS = [
  // Nawigacja
  { id: 'nav-dashboard',    type: 'nav',    icon: 'dashboard', label: 'Pulpit',              sub: 'Przegląd całego systemu',         screen: 'dashboard' },
  { id: 'nav-disks',        type: 'nav',    icon: 'disk',      label: 'Dyski i pule',         sub: 'ZFS · RAID · dyski fizyczne',     screen: 'disks' },
  { id: 'nav-files',        type: 'nav',    icon: 'folder',    label: 'Menedżer plików',      sub: 'Przeglądarka · upload',           screen: 'files' },
  { id: 'nav-backup',       type: 'nav',    icon: 'download',  label: 'Kopie zapasowe',       sub: 'rsync · Borg · Restic',           screen: 'backup' },
  { id: 'nav-docker',       type: 'nav',    icon: 'docker',    label: 'Kontenery Docker',     sub: '12 kontenerów · 34 obrazy',       screen: 'docker' },
  { id: 'nav-network',      type: 'nav',    icon: 'network',   label: 'Sieć',                 sub: '2× 10GbE · WireGuard · firewall', screen: 'network' },
  { id: 'nav-shares',       type: 'nav',    icon: 'share',     label: 'Usługi plików',        sub: 'SMB · NFS · FTP · SSH',           screen: 'shares' },
  { id: 'nav-users',        type: 'nav',    icon: 'users',     label: 'Użytkownicy',          sub: 'Konta · grupy · 2FA',             screen: 'users' },
  { id: 'nav-updates',      type: 'nav',    icon: 'download',  label: 'Aktualizacje',         sub: '12 pakietów dostępnych',          screen: 'updates' },
  { id: 'nav-logs',         type: 'nav',    icon: 'log',       label: 'Logi systemowe',       sub: 'journal · syslog · live',         screen: 'logs' },
  { id: 'nav-processes',    type: 'nav',    icon: 'process',   label: 'Procesy',              sub: 'Lista procesów systemowych',       screen: 'processes' },
  { id: 'nav-terminal',     type: 'nav',    icon: 'terminal',  label: 'Terminal',             sub: 'Sesja powłoki przez przeglądarkę',screen: 'terminal' },
  { id: 'nav-kvm',          type: 'nav',    icon: 'process',   label: 'Wirtualizacja KVM',    sub: 'KVM/QEMU · libvirt · VNC',        screen: 'kvm' },
  { id: 'nav-temps',        type: 'nav',    icon: 'thermometer',label: 'Temperatury',         sub: 'CPU · dyski · HBA',               screen: 'temps' },
  { id: 'nav-smart',        type: 'nav',    icon: 'thermometer',label: 'S.M.A.R.T.',          sub: 'Pełny raport dysków',             screen: 'smart' },
  { id: 'nav-settings',     type: 'nav',    icon: 'settings',  label: 'Ustawienia',           sub: 'System · backup · alerty · UPS',  screen: 'settings' },
  { id: 'nav-media',        type: 'nav',    icon: 'media',     label: 'Serwery mediów',       sub: 'Plex · Jellyfin · Navidrome',     screen: 'media' },
  { id: 'nav-cron',         type: 'nav',    icon: 'clock',     label: 'Harmonogram zadań',    sub: 'cron · systemd timers',           screen: 'cron' },
  { id: 'nav-packages',     type: 'nav',    icon: 'package',   label: 'Menedżer pakietów',    sub: 'apt · dpkg · zależności',         screen: 'packages' },
  { id: 'nav-nfs',          type: 'nav',    icon: 'share',     label: 'NFS Server',           sub: 'Serwer NFS v4 · montowanie',      screen: 'nfs' },
  { id: 'nav-samba',        type: 'nav',    icon: 'network',   label: 'Samba / SMB',          sub: 'SMB3 · udziały · połączenia',     screen: 'samba' },
  { id: 'nav-ssh',          type: 'nav',    icon: 'terminal',  label: 'SSH / SFTP',           sub: 'OpenSSH · klucze · sesje',        screen: 'ssh_svc' },
  { id: 'nav-notif',        type: 'nav',    icon: 'bell',      label: 'Powiadomienia',        sub: 'e-mail · Telegram · webhook',     screen: 'notif' },
  { id: 'nav-zfs',          type: 'nav',    icon: 'disk',      label: 'Dedup / Przestrzeń',   sub: 'ZFS deduplikacja · kompresja',    screen: 'zfs_dedup' },
  { id: 'nav-network-det',  type: 'nav',    icon: 'globe',     label: 'Sieć szczegółowo',     sub: 'Per-interfejs · firewall nftables',screen:'network_detail'},
  // Szybkie akcje
  { id: 'act-scrub',        type: 'action', icon: 'refresh',   label: 'Uruchom scrub ZFS',    sub: 'zpool scrub tank',                cmd: 'zpool scrub tank' },
  { id: 'act-snapshot',     type: 'action', icon: 'download',  label: 'Utwórz snapshot',      sub: 'zfs snapshot tank/media@manual',  cmd: 'zfs snapshot' },
  { id: 'act-updates',      type: 'action', icon: 'shield',    label: 'Sprawdź aktualizacje', sub: 'apt update && apt list --upgradable', cmd: 'apt update' },
  { id: 'act-restart-smb',  type: 'action', icon: 'restart',   label: 'Restart Samba',        sub: 'systemctl restart smbd',          cmd: 'systemctl restart smbd' },
  { id: 'act-smart',        type: 'action', icon: 'hdd',       label: 'Sprawdź SMART',        sub: 'smartctl -a /dev/sda',            cmd: 'smartctl -a' },
  { id: 'act-docker-prune', type: 'action', icon: 'trash',     label: 'Docker prune',         sub: 'docker system prune -f',          cmd: 'docker system prune' },
  { id: 'act-report',       type: 'action', icon: 'bell',      label: 'Wyślij raport e-mail', sub: 'nimbus-report --send',            cmd: 'nimbus-report' },
  // Kontenery (szybki dostęp)
  ...window.CONTAINERS.slice(0, 6).map(c => ({
    id: `cnt-${c.id}`, type: 'container', icon: 'docker',
    label: c.name, sub: `${c.image.split('/').pop()} · ${c.state} · ${c.ports}`,
    screen: 'docker',
  })),
];

const TYPE_LABELS = { nav: 'Nawigacja', action: 'Akcje', container: 'Kontenery' };
const TYPE_COLORS = {
  nav:       'var(--accent)',
  action:    'oklch(0.78 0.15 75)',
  container: 'oklch(0.72 0.14 150)',
};

const CommandPalette = ({ onNav, onClose }) => {
  const [query, setQuery] = useSCP('');
  const [cursor, setCursor] = useSCP(0);
  const inputRef = useRCP(null);
  const listRef = useRCP(null);

  useECP(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Filtruj + grupuj
  const filtered = useMCP(() => {
    const q = query.toLowerCase().trim();
    if (!q) return CP_ITEMS.slice(0, 18); // domyślnie pierwsze 18
    return CP_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.sub.toLowerCase().includes(q) ||
      item.type.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [query]);

  // Grupowanie
  const groups = useMCP(() => {
    const g = {};
    filtered.forEach(item => {
      if (!g[item.type]) g[item.type] = [];
      g[item.type].push(item);
    });
    return g;
  }, [filtered]);

  // Płaska lista do nawigacji kursorem
  const flat = useMCP(() => filtered, [filtered]);

  const select = (item) => {
    if (item.screen) onNav(item.screen);
    else if (item.cmd) alert(`Uruchamianie: ${item.cmd}`);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[cursor]) select(flat[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Przewijanie aktywnego elementu
  useECP(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [cursor]);

  // Reset kursora przy zmianie query
  useECP(() => setCursor(0), [query]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 620, maxWidth: '94vw',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          animation: 'cpIn 0.18s cubic-bezier(.22,.68,0,1.2)',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-dim)" strokeWidth="2">
            <circle cx="10" cy="10" r="7"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Szukaj sekcji, akcji, kontenera…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--fg)', fontFamily: 'var(--font-ui)', fontSize: 15,
              caretColor: 'var(--accent)',
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd style={{
            padding: '2px 7px', background: 'var(--bg-3)', border: '1px solid var(--line)',
            borderRadius: 5, fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }} onClick={onClose}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', padding: '8px 0' }}>
          {flat.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--fg-dim)', fontSize: 'var(--fs-sm)' }}>
              Brak wyników dla „{query}"
            </div>
          ) : (
            Object.entries(groups).map(([type, items]) => (
              <div key={type}>
                {/* Group header */}
                <div style={{
                  padding: '6px 18px 4px',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: TYPE_COLORS[type] || 'var(--fg-dim)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {TYPE_LABELS[type] || type}
                </div>
                {items.map(item => {
                  const idx = flat.indexOf(item);
                  const isActive = idx === cursor;
                  return (
                    <div
                      key={item.id}
                      data-active={isActive ? 'true' : 'false'}
                      onClick={() => select(item)}
                      onMouseEnter={() => setCursor(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '9px 18px',
                        background: isActive ? 'var(--bg-3)' : 'transparent',
                        cursor: 'pointer',
                        borderLeft: `3px solid ${isActive ? TYPE_COLORS[item.type] : 'transparent'}`,
                        transition: 'background 0.08s',
                      }}
                    >
                      {/* Ikona */}
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: isActive
                          ? `color-mix(in oklch, ${TYPE_COLORS[item.type]} 20%, var(--bg-2))`
                          : 'var(--bg-2)',
                        border: `1px solid ${isActive ? TYPE_COLORS[item.type] : 'var(--line)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isActive ? TYPE_COLORS[item.type] : 'var(--fg-dim)',
                        transition: 'all 0.08s',
                      }}>
                        <Icon name={item.icon} size={14} />
                      </div>

                      {/* Tekst */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: isActive ? 600 : 400,
                          fontSize: 'var(--fs-sm)',
                          color: isActive ? 'var(--fg)' : 'var(--fg)',
                          marginBottom: 1,
                        }}>
                          {item.label}
                        </div>
                        <div style={{
                          fontSize: 11, color: 'var(--fg-dim)',
                          fontFamily: 'var(--font-mono)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {item.sub}
                        </div>
                      </div>

                      {/* Typ badge */}
                      <div style={{
                        fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: TYPE_COLORS[item.type], letterSpacing: '.06em',
                        opacity: isActive ? 1 : 0.5,
                        textTransform: 'uppercase',
                      }}>
                        {item.type === 'nav' ? '→' : item.type === 'action' ? '⚡' : '◉'}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div style={{
          display: 'flex', gap: 16, padding: '8px 18px',
          borderTop: '1px solid var(--line)',
          fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)',
        }}>
          {[['↑↓', 'nawiguj'], ['↵', 'otwórz'], ['Esc', 'zamknij']].map(([k, v]) => (
            <span key={k}>
              <kbd style={{
                padding: '1px 5px', background: 'var(--bg-3)', border: '1px solid var(--line)',
                borderRadius: 4, fontSize: 10, marginRight: 5,
              }}>{k}</kbd>
              {v}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{flat.length} wyników</span>
        </div>
      </div>

      <style>{`
        @keyframes cpIn {
          from { opacity: 0; transform: translateY(-16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
};

window.CommandPalette = CommandPalette;
