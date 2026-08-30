// ===== screens-setup.jsx — Wizard pierwszego uruchomienia Nimbus =====

const { useState, useEffect, useCallback, useRef } = React;

// ─── Definicje komponentów do zainstalowania ──────────────────────────────────

const SETUP_COMPONENTS = [
  // ── Essentials
  {
    id: 'docker',     group: 'Essentials',
    name: 'Docker',   icon: '🐳',
    desc: 'Silnik kontenerów — wymagany do uruchamiania aplikacji w izolowanych środowiskach.',
    packages: ['docker.io', 'docker-compose-plugin'],
    component: 'docker',
    recommended: true,
    tags: ['kontener', 'aplikacje'],
  },
  {
    id: 'zfs',        group: 'Essentials',
    name: 'ZFS',      icon: '💾',
    desc: 'Zaawansowany system plików z obsługą RAID, snapshotów i kompresji.',
    packages: ['zfsutils-linux'],
    component: 'zfs',
    recommended: true,
    tags: ['storage', 'raid'],
  },
  {
    id: 'wireguard',  group: 'Essentials',
    name: 'WireGuard VPN', icon: '🔐',
    desc: 'Nowoczesny, szybki VPN zintegrowany z jądrem Linux. Bezpieczny zdalny dostęp.',
    packages: ['wireguard', 'wireguard-tools', 'qrencode'],
    component: 'wireguard',
    recommended: true,
    tags: ['vpn', 'bezpieczeństwo'],
  },

  // ── Bezpieczeństwo
  {
    id: 'clamav',     group: 'Bezpieczeństwo',
    name: 'ClamAV',   icon: '🛡',
    desc: 'Antywirus open-source. Skanuje pliki i zasoby Samba w poszukiwaniu złośliwego oprogramowania.',
    packages: ['clamav', 'clamav-daemon'],
    component: 'clamav',
    recommended: false,
    tags: ['antywirus', 'bezpieczeństwo'],
  },
  {
    id: 'fail2ban',   group: 'Bezpieczeństwo',
    name: 'Fail2ban',  icon: '🚫',
    desc: 'Blokuje adresy IP po wielokrotnych nieudanych próbach logowania (SSH, FTP, HTTP).',
    packages: ['fail2ban'],
    component: 'fail2ban',
    recommended: true,
    tags: ['bezpieczeństwo', 'ssh'],
  },
  {
    id: 'ufw',        group: 'Bezpieczeństwo',
    name: 'UFW Firewall', icon: '🔥',
    desc: 'Prosty firewall — automatycznie zezwoli na SSH (22) i Nimbus (8585).',
    packages: ['ufw'],
    component: 'ufw',
    recommended: false,
    tags: ['firewall', 'bezpieczeństwo'],
  },

  // ── Monitoring
  {
    id: 'smartmon',   group: 'Monitoring',
    name: 'S.M.A.R.T.', icon: '🌡',
    desc: 'Monitoring zdrowia dysków twardych i SSD przez S.M.A.R.T.',
    packages: ['smartmontools'],
    component: 'smartmon',
    recommended: true,
    tags: ['dyski', 'monitoring'],
  },
  {
    id: 'sensors',    group: 'Monitoring',
    name: 'lm-sensors', icon: '🌡',
    desc: 'Temperatury CPU, MB i wentylatory. Wymagane przez zakładkę Temperatury w Nimbus.',
    packages: ['lm-sensors'],
    component: 'sensors',
    recommended: true,
    tags: ['temperatura', 'monitoring'],
  },
  {
    id: 'htop',       group: 'Monitoring',
    name: 'htop + iotop', icon: '📊',
    desc: 'Interaktywny monitor procesów i I/O dysków w terminalu.',
    packages: ['htop', 'iotop'],
    component: 'htop',
    recommended: false,
    tags: ['monitoring', 'narzędzia'],
  },

  // ── Narzędzia
  {
    id: 'rsync',      group: 'Narzędzia',
    name: 'rsync',    icon: '🔄',
    desc: 'Synchronizacja i backup plików. Używany przez moduł backupów Nimbus.',
    packages: ['rsync'],
    component: 'rsync',
    recommended: true,
    tags: ['backup', 'sync'],
  },
  {
    id: 'aria2',      group: 'Narzędzia',
    name: 'aria2',    icon: '⬇',
    desc: 'Downloader obsługujący torrenty, HTTP, FTP. Wymagany przez nimbus-dl.',
    packages: ['aria2'],
    component: 'aria2',
    recommended: false,
    tags: ['download', 'torrent'],
  },
  {
    id: 'ncdu',       group: 'Narzędzia',
    name: 'ncdu + nmap', icon: '🔍',
    desc: 'Analiza zajętości dysku (ncdu) i skaner sieci (nmap).',
    packages: ['ncdu', 'nmap'],
    component: 'ncdu',
    recommended: false,
    tags: ['narzędzia', 'sieć'],
  },
  {
    id: 'python3',    group: 'Narzędzia',
    name: 'Python 3 + pip', icon: '🐍',
    desc: 'Środowisko Python — wymagane przez niektóre skrypty i integracje.',
    packages: ['python3', 'python3-pip'],
    component: 'python3',
    recommended: false,
    tags: ['python', 'scripting'],
  },
];

const GROUPS = ['Essentials', 'Bezpieczeństwo', 'Monitoring', 'Narzędzia'];

// ─── Hook instalacji ─────────────────────────────────────────────────────────

const useInstaller = () => {
  const [queue,    setQueue]    = useState([]);   // { id, packages, component }
  const [current,  setCurrent]  = useState(null); // aktualnie instalowany id
  const [logs,     setLogs]     = useState({});   // id → string
  const [statuses, setStatuses] = useState({});   // id → 'pending'|'installing'|'ok'|'error'
  const running = useRef(false);

  const addLog = (id, line) =>
    setLogs(l => ({ ...l, [id]: (l[id] || '') + line + '\n' }));

  const runQueue = useCallback(async (q) => {
    if (running.current || q.length === 0) return;
    running.current = true;
    for (const item of q) {
      setCurrent(item.id);
      setStatuses(s => ({ ...s, [item.id]: 'installing' }));
      addLog(item.id, `apt install ${item.packages.join(' ')}…`);
      try {
        const r = await fetch('/api/setup/install', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages: item.packages, component: item.component }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          addLog(item.id, d.output ? d.output.slice(-400) : '✓ OK');
          setStatuses(s => ({ ...s, [item.id]: 'ok' }));
        } else {
          addLog(item.id, '✗ ' + (d.error || r.status));
          setStatuses(s => ({ ...s, [item.id]: 'error' }));
        }
      } catch (e) {
        addLog(item.id, '✗ ' + e.message);
        setStatuses(s => ({ ...s, [item.id]: 'error' }));
      }
    }
    setCurrent(null);
    running.current = false;
  }, []);

  const install = useCallback((items) => {
    const newQ = items.filter(i => !statuses[i.id] || statuses[i.id] === 'error');
    setQueue(newQ);
    newQ.forEach(i => setStatuses(s => ({ ...s, [i.id]: 'pending' })));
    runQueue(newQ);
  }, [statuses, runQueue]);

  return { install, current, logs, statuses };
};

// ─── Karta komponentu ────────────────────────────────────────────────────────

const CompCard = ({ comp, selected, installed, onToggle, status, log }) => {
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current && showLog) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, showLog]);

  const statusIcon = installed ? '✓'
    : status === 'ok' ? '✓'
    : status === 'error' ? '✗'
    : status === 'installing' ? '⏳'
    : status === 'pending' ? '⌛'
    : null;

  const statusColor = installed || status === 'ok' ? 'var(--ok)'
    : status === 'error' ? 'var(--err)'
    : status === 'installing' ? 'var(--accent)'
    : status === 'pending' ? 'var(--fg-dim)'
    : null;

  const done = installed || status === 'ok';
  const busy = status === 'installing' || status === 'pending';

  return (
    <div
      onClick={() => !done && !busy && onToggle(comp.id)}
      style={{
        padding: '13px 14px',
        borderRadius: 8,
        border: `1.5px solid ${done ? 'color-mix(in oklch,var(--ok) 35%,var(--line))' : selected ? 'var(--accent)' : 'var(--line)'}`,
        background: done
          ? 'color-mix(in oklch,var(--ok) 5%,var(--bg-2))'
          : selected
          ? 'color-mix(in oklch,var(--accent) 7%,var(--bg-2))'
          : 'var(--bg-2)',
        cursor: done || busy ? 'default' : 'pointer',
        transition: 'all .15s',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: busy ? 0.85 : 1,
      }}
      onMouseEnter={e => { if (!done && !busy) e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { if (!done && !busy) e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--line)'; }}
    >
      {/* Checkbox + ikona + nazwa */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: done ? 'var(--ok)' : selected ? 'var(--accent)' : 'var(--bg-3)',
          border: `1.5px solid ${done ? 'var(--ok)' : selected ? 'var(--accent)' : 'var(--line)'}`,
          color: '#fff', fontSize: 11, fontWeight: 700,
        }}>
          {statusIcon || (selected ? '✓' : '')}
        </div>
        <span style={{ fontSize: 18 }}>{comp.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: done ? 'var(--ok)' : selected ? 'var(--accent)' : 'var(--fg)' }}>
            {comp.name}
            {comp.recommended && !done && (
              <span className="chip" style={{ fontSize: 9, marginLeft: 6, color: 'var(--accent)', borderColor: 'color-mix(in oklch,var(--accent) 30%,var(--line))' }}>zalecane</span>
            )}
            {done && <span className="chip" style={{ fontSize: 9, marginLeft: 6, color: 'var(--ok)', borderColor: 'color-mix(in oklch,var(--ok) 30%,var(--line))' }}>zainstalowany</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {comp.packages.map(p => <code key={p} style={{ fontSize: 9, padding: '0 4px', background: 'var(--bg-3)', borderRadius: 3 }}>{p}</code>)}
          </div>
        </div>
        {statusColor && (
          <span style={{ color: statusColor, fontSize: 14, fontWeight: 700 }}>{statusIcon}</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.5 }}>
        {comp.desc}
      </div>

      {/* Log instalacji */}
      {(log || status === 'installing') && (
        <div>
          <button
            onClick={e => { e.stopPropagation(); setShowLog(v => !v); }}
            className="mono"
            style={{ fontSize: 9.5, color: 'var(--fg-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showLog ? '▲ ukryj logi' : '▼ pokaż logi'}
          </button>
          {showLog && (
            <pre ref={logRef} style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 5, fontSize: 9.5,
              fontFamily: 'var(--font-mono)', background: 'var(--bg-1)',
              border: '1px solid var(--line)', color: status === 'error' ? 'var(--err)' : 'var(--fg-dim)',
              maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{log}</pre>
          )}
        </div>
      )}

      {/* Animacja instalacji */}
      {status === 'installing' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: '0 0 8px 8px',
          background: 'var(--bg-3)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: '40%', background: 'var(--accent)',
            animation: 'setup-progress 1.4s ease-in-out infinite',
          }}/>
        </div>
      )}
    </div>
  );
};

// ─── Wizard ──────────────────────────────────────────────────────────────────

const SetupWizard = ({ onComplete }) => {
  const [step,      setStep]      = useState(1);  // 1=witaj 2=wybór 3=instalacja 4=gotowe
  const [selected,  setSelected]  = useState(() =>
    SETUP_COMPONENTS.filter(c => c.recommended).map(c => c.id)
  );
  const [installed, setInstalled] = useState({});
  const [filter,    setFilter]    = useState('Wszystkie');
  const [search,    setSearch]    = useState('');
  const { install, current, logs, statuses } = useInstaller();

  // Załaduj stan zainstalowania z API
  useEffect(() => {
    fetch('/api/setup/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.components) return;
        const inst = {};
        for (const [id, state] of Object.entries(d.components)) {
          if (state.installed) inst[id] = state;
        }
        setInstalled(inst);
      })
      .catch(() => {});
  }, [statuses]); // Odśwież po każdej zmianie statusów

  const toggle = id => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const toggleAll = (group) => {
    const groupIds = SETUP_COMPONENTS.filter(c => c.group === group).map(c => c.id);
    const allSelected = groupIds.every(id => selected.includes(id));
    if (allSelected) setSelected(s => s.filter(id => !groupIds.includes(id)));
    else setSelected(s => [...new Set([...s, ...groupIds])]);
  };

  const startInstall = () => {
    const toInstall = SETUP_COMPONENTS
      .filter(c => selected.includes(c.id) && !installed[c.id]);
    if (toInstall.length === 0) { setStep(4); return; }
    setStep(3);
    install(toInstall);
  };

  const allDone = SETUP_COMPONENTS
    .filter(c => selected.includes(c.id))
    .every(c => installed[c.id] || statuses[c.id] === 'ok');

  const filtered = SETUP_COMPONENTS.filter(c => {
    if (filter !== 'Wszystkie' && c.group !== filter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.desc.toLowerCase().includes(search.toLowerCase()) &&
        !c.tags.some(t => t.includes(search.toLowerCase()))) return false;
    return true;
  });

  const selectedCount  = selected.filter(id => !installed[id]).length;
  const installedCount = Object.keys(installed).length +
    Object.values(statuses).filter(s => s === 'ok').length;

  const STEPS = ['Witaj', 'Wybierz pakiety', 'Instalacja', 'Gotowe'];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column', zIndex: 9999,
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes setup-progress {
          0% { transform: translateX(-200%); }
          100% { transform: translateX(400%); }
        }
        @keyframes setup-fadein {
          from { opacity:0; transform:translateY(12px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '18px 28px', borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: 'var(--accent)',
            display: 'grid', placeItems: 'center', color: '#fff', fontSize: 18,
          }}>⚡</div>
          <div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Nimbus<span style={{ color: 'var(--accent)' }}>.</span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--fg-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Konfigurator pierwszego uruchomienia
            </div>
          </div>
        </div>

        {/* Stepper */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <div style={{ width: 40, height: 1, background: i < step ? 'var(--accent)' : 'var(--line)' }}/>}
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    background: i + 1 < step ? 'var(--accent)' : i + 1 === step ? 'color-mix(in oklch,var(--accent) 18%,transparent)' : 'var(--bg-2)',
                    border: `1.5px solid ${i + 1 <= step ? 'var(--accent)' : 'var(--line)'}`,
                    color: i + 1 < step ? '#fff' : i + 1 === step ? 'var(--accent)' : 'var(--fg-dim)',
                  }}>
                    {i + 1 < step ? '✓' : i + 1}
                  </div>
                  <div style={{ fontSize: 9, color: i + 1 === step ? 'var(--accent)' : 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                    {s}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Skip */}
        {step < 4 && (
          <button onClick={() => {
            fetch('/api/setup/complete', { method: 'POST', credentials: 'include' }).catch(()=>{});
            onComplete();
          }} className="mono dim" style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 5 }}>
            Pomiń konfigurator →
          </button>
        )}
      </div>

      {/* Treść */}
      <div style={{ flex: 1, overflow: 'auto', animation: 'setup-fadein .3s ease' }}>

        {/* Step 1 — Witaj */}
        {step === 1 && (
          <div style={{ maxWidth: 680, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 12px', letterSpacing: '-0.03em' }}>
              Witaj w Nimbus!
            </h1>
            <p style={{ fontSize: 14, color: 'var(--fg-dim)', lineHeight: 1.7, marginBottom: 32 }}>
              Konfigurator pomoże Ci zainstalować i skonfigurować podstawowe pakiety
              na Twoim serwerze NAS. Możesz wybrać tylko te które potrzebujesz,
              lub zainstalować wszystkie zalecane jednym kliknięciem.
            </p>

            {/* Statystyki systemu */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 36,
              textAlign: 'left',
            }}>
              {[
                { label: 'Pakiety zalecane', value: SETUP_COMPONENTS.filter(c => c.recommended).length, icon: '⭐' },
                { label: 'Pakiety dostępne', value: SETUP_COMPONENTS.length, icon: '📦' },
                { label: 'Grupy',             value: GROUPS.length,           icon: '📂' },
              ].map(({ label, value, icon }) => (
                <div key={label} style={{
                  padding: '14px 16px', borderRadius: 8, background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn primary" style={{ padding: '11px 32px', fontSize: 14 }}
                onClick={() => setStep(2)}>
                Rozpocznij konfigurację →
              </button>
              <button className="btn ghost" style={{ padding: '11px 20px', fontSize: 13 }}
                onClick={() => { setStep(2); setSelected(SETUP_COMPONENTS.filter(c=>c.recommended).map(c=>c.id)); }}>
                ⭐ Tylko zalecane
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Wybór pakietów */}
        {step === 2 && (
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: 1 }}>
                Wybierz komponenty do zainstalowania
              </h2>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Szukaj…"
                style={{
                  padding: '6px 10px', borderRadius: 5, fontSize: 12, width: 160,
                  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--fg)',
                }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                {['Wszystkie', ...GROUPS].map(g => (
                  <button key={g}
                    className={'btn sm ' + (filter === g ? 'primary' : 'ghost')}
                    onClick={() => setFilter(g)}
                    style={{ padding: '3px 10px', fontSize: 10.5 }}
                  >{g}</button>
                ))}
              </div>
            </div>

            {/* Selekcja zbiorcza */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button className="btn sm ghost" onClick={() => setSelected(SETUP_COMPONENTS.map(c=>c.id))}>
                Zaznacz wszystko
              </button>
              <button className="btn sm ghost" onClick={() => setSelected([])}>
                Odznacz wszystko
              </button>
              <button className="btn sm ghost" onClick={() => setSelected(SETUP_COMPONENTS.filter(c=>c.recommended).map(c=>c.id))}>
                ⭐ Tylko zalecane
              </button>
            </div>

            {/* Grupy i karty */}
            {GROUPS.filter(g => filter === 'Wszystkie' || filter === g).map(group => {
              const groupComps = filtered.filter(c => c.group === group);
              if (groupComps.length === 0) return null;
              const allGrpSel = groupComps.every(c => selected.includes(c.id) || installed[c.id]);
              return (
                <div key={group} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-dim)' }}>
                      {group}
                    </div>
                    <button
                      onClick={() => toggleAll(group)}
                      className="mono"
                      style={{ fontSize: 9.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 6px', borderRadius: 3, background: 'color-mix(in oklch,var(--accent) 10%,transparent)' }}
                    >
                      {allGrpSel ? 'Odznacz grupę' : 'Zaznacz grupę'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                    {groupComps.map(comp => (
                      <CompCard
                        key={comp.id}
                        comp={comp}
                        selected={selected.includes(comp.id)}
                        installed={!!installed[comp.id]}
                        onToggle={toggle}
                        status={statuses[comp.id]}
                        log={logs[comp.id]}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3 — Instalacja */}
        {step === 3 && (
          <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {allDone ? '✅ Instalacja zakończona!' : `⏳ Instalowanie… ${current ? '— ' + (SETUP_COMPONENTS.find(c=>c.id===current)?.name || current) : ''}`}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--fg-dim)', marginBottom: 24 }}>
              {allDone
                ? 'Wszystkie wybrane pakiety zostały zainstalowane.'
                : 'Proszę czekać — nie zamykaj przeglądarki podczas instalacji.'}
            </div>

            {/* Postęp ogólny */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-dim)', marginBottom: 5 }}>
                <span>{installedCount} / {selected.length} zainstalowanych</span>
                <span>{Math.round(installedCount / Math.max(selected.length, 1) * 100)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-3)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, transition: 'width .6s ease',
                  width: `${Math.round(installedCount / Math.max(selected.length, 1) * 100)}%`,
                  background: 'linear-gradient(90deg, var(--accent), color-mix(in oklch,var(--ok) 70%,var(--accent)))',
                }}/>
              </div>
            </div>

            {/* Lista komponentów z postępem */}
            <div className="col" style={{ gap: 8 }}>
              {SETUP_COMPONENTS.filter(c => selected.includes(c.id)).map(comp => {
                const stat = installed[comp.id] ? 'ok' : (statuses[comp.id] || 'pending');
                const statusLabel = { pending: 'W kolejce', installing: 'Instalowanie…', ok: 'Zainstalowany', error: 'Błąd' };
                const statusColor = { pending: 'var(--fg-dim)', installing: 'var(--accent)', ok: 'var(--ok)', error: 'var(--err)' };
                return (
                  <CompCard
                    key={comp.id}
                    comp={comp}
                    selected={true}
                    installed={!!installed[comp.id]}
                    onToggle={() => {}}
                    status={installed[comp.id] ? 'ok' : statuses[comp.id]}
                    log={logs[comp.id]}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Step 4 — Gotowe */}
        {step === 4 && (
          <div style={{ maxWidth: 620, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 72, marginBottom: 20 }}>🚀</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
              Nimbus jest gotowy!
            </h1>
            <p style={{ fontSize: 13, color: 'var(--fg-dim)', lineHeight: 1.7, marginBottom: 32 }}>
              Konfiguracja zakończona. Możesz teraz korzystać z pełnych możliwości panelu.
              Zainstalowane moduły są już aktywne.
            </p>

            {/* Podsumowanie */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 32, textAlign: 'left' }}>
              {SETUP_COMPONENTS.filter(c => installed[c.id] || statuses[c.id] === 'ok').map(c => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  background: 'color-mix(in oklch,var(--ok) 6%,var(--bg-2))',
                  border: '1px solid color-mix(in oklch,var(--ok) 20%,var(--line))',
                  borderRadius: 6,
                }}>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--ok)', fontWeight: 700 }}>✓</span>
                </div>
              ))}
            </div>

            <button className="btn primary" style={{ padding: '12px 40px', fontSize: 14 }}
              onClick={() => {
                fetch('/api/setup/complete', { method: 'POST', credentials: 'include' }).catch(()=>{});
                onComplete();
              }}>
              Przejdź do panelu →
            </button>
          </div>
        )}
      </div>

      {/* Footer z akcjami */}
      {step >= 2 && step < 4 && (
        <div style={{
          padding: '14px 28px', borderTop: '1px solid var(--line)',
          background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          {step === 2 && (
            <>
              <button className="btn ghost" onClick={() => setStep(1)}>← Wstecz</button>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--fg-dim)' }}>
                Wybrano <strong style={{ color: 'var(--fg)' }}>{selectedCount}</strong> pakietów do instalacji
                {installedCount > 0 && <span> · {installedCount} już zainstalowanych</span>}
              </div>
              <button className="btn primary" style={{ padding: '9px 24px' }}
                onClick={startInstall}
                disabled={selectedCount === 0 && installedCount === 0}>
                {selectedCount === 0 ? 'Zakończ →' : `Zainstaluj ${selectedCount} pakietów →`}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--fg-dim)' }}>
                {allDone ? '✓ Instalacja zakończona' : `Instalowanie: ${current ? (SETUP_COMPONENTS.find(c=>c.id===current)?.name || current) : '…'}`}
              </div>
              <button className="btn primary" disabled={!allDone}
                onClick={() => setStep(4)}
                style={{ padding: '9px 24px' }}>
                {allDone ? 'Dalej →' : '⏳ Trwa instalacja…'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

window.SetupWizard = SetupWizard;
