// ===== System Updates screen — prawdziwe API =====

// ─── Stałe endpointów ────────────────────────────────────────────────────────
const Icon = window.Icon;
const Modal = window.Modal;

const UPD = {
  packages:    '/system/updates/packages',
  check:       '/system/updates/check',
  install:     '/system/updates/install',
  installLog:  '/system/updates/install-log',
  changelog:   '/system/updates/changelog',
  details:     '/system/updates/details',
  history:     '/system/updates/history',
  autoConfig:  '/system/updates/auto-config',
  reboot:      '/system/updates/reboot-required',
};

// ─── ChangelogDialog ─────────────────────────────────────────────────────────
const ChangelogDialog = ({ pkg, onClose }) => {
  const [text, setText] = React.useState('Ładowanie…');
  React.useEffect(() => {
    fetch(`${UPD.changelog}?package=${encodeURIComponent(pkg.name)}`, {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(d => setText(d?.changelog || 'Brak changelog'))
      .catch(() => setText('Błąd ładowania'));
  }, [pkg.name]);
  return (
    <Modal title={`Changelog · ${pkg.name}`} sub={`${pkg.cur} → ${pkg.next}`} onClose={onClose} width={720}
      footer={<button className="btn sm primary" onClick={onClose}>Zamknij</button>}
    >
      <div style={{
        background:'var(--bg)', borderRadius:6, padding:'12px 14px',
        fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', lineHeight:1.8,
        maxHeight:440, overflowY:'auto', color:'var(--fg-muted)', whiteSpace:'pre-wrap',
      }}>{text}</div>
    </Modal>
  );
};

// ─── Główny komponent ─────────────────────────────────────────────────────────
const SystemUpdates = () => {
  const [packages,     setPackages]     = React.useState([]);
  const [checking,     setChecking]     = React.useState(false);
  const [checkProgress,setCheckProgress]= React.useState(0);
  const [installing,   setInstalling]   = React.useState(false);
  const [installLog,   setInstallLog]   = React.useState([]);
  const [installDone,  setInstallDone]  = React.useState(false);
  const [installStatus,setInstallStatus]= React.useState('');   // 'ok' | 'error' | ''
  const [filter,       setFilter]       = React.useState('all');
  const [lastCheck,    setLastCheck]    = React.useState('—');
  const [rebootReq,    setRebootReq]    = React.useState(false);
  const [rebootPkgs,   setRebootPkgs]   = React.useState('');
  const [tab,          setTab]          = React.useState('updates');
  const [changelogFor, setChangelogFor] = React.useState(null);
  const [loading,      setLoading]      = React.useState(true);
  const [error,        setError]        = React.useState('');

  // Auto-config state
  const [autoUpdate,   setAutoUpdate]   = React.useState(false);
  const [autoSecurity, setAutoSecurity] = React.useState(false);
  const [autoReboot,   setAutoReboot]   = React.useState(false);
  const [sourcesList,  setSourcesList]  = React.useState('');
  const [autoSaving,   setAutoSaving]   = React.useState(false);

  // Historia
  const [history, setHistory] = React.useState([]);

  const logRef = React.useRef(null);

  // ── Ładuj dane przy montowaniu ────────────────────────────────────────────
  React.useEffect(() => {
    loadPackages();
    loadRebootRequired();
  }, []);

  // Auto-scroll loga
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [installLog]);

  // Ładuj zakładkę przy przełączeniu
  React.useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory();
    if (tab === 'auto'    && sourcesList === '')   loadAutoConfig();
  }, [tab]);

  // ── API calls ─────────────────────────────────────────────────────────────

  async function loadPackages() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(UPD.packages, {credentials:'include'});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      applyPackagesResponse(d);
    } catch(e) {
      setError('Nie można pobrać listy pakietów: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function applyPackagesResponse(d) {
    const pkgs = (d.packages || []).map(p => ({...p, selected: p.type === 'security'}));
    setPackages(pkgs);
    if (d.checked_at) setLastCheck(d.checked_at);
    if (d.reboot_required !== undefined) setRebootReq(d.reboot_required);
  }

  async function loadRebootRequired() {
    try {
      const r = await fetch(UPD.reboot, {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      setRebootReq(d.required || false);
      setRebootPkgs(d.packages || '');
    } catch {}
  }

  async function loadHistory() {
    try {
      const r = await fetch(UPD.history, {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      setHistory(d.history || []);
    } catch {}
  }

  async function loadAutoConfig() {
    try {
      const r = await fetch(UPD.autoConfig, {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (d.config) {
        setAutoUpdate(d.config.auto_update   || false);
        setAutoSecurity(d.config.auto_security || false);
        setAutoReboot(d.config.auto_reboot   || false);
      }
      if (d.sources) setSourcesList(d.sources);
    } catch {}
  }

  async function saveAutoConfig() {
    setAutoSaving(true);
    try {
      await fetch(UPD.autoConfig, {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({auto_update:autoUpdate, auto_security:autoSecurity, auto_reboot:autoReboot}),
      });
    } catch {}
    setAutoSaving(false);
  }

  // ── apt update ────────────────────────────────────────────────────────────
  const runCheck = async () => {
    setChecking(true);
    setCheckProgress(0);
    setError('');
    // Animacja progressu podczas oczekiwania
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 12 + 2;
      if (p > 90) p = 90;
      setCheckProgress(Math.round(p));
    }, 200);

    try {
      const r = await fetch(UPD.check, {credentials:'include'});
      clearInterval(iv);
      setCheckProgress(100);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      applyPackagesResponse(d);
    } catch(e) {
      clearInterval(iv);
      setError('apt update nieudany: ' + e.message);
    } finally {
      setTimeout(() => { setChecking(false); setCheckProgress(0); }, 600);
    }
  };

  // ── Instalacja przez SSE ──────────────────────────────────────────────────
  const runInstall = (pkgs) => {
    if (!pkgs.length || installing) return;
    setInstalling(true);
    setInstallDone(false);
    setInstallStatus('');
    setInstallLog([]);
    setTab('log');

    const names = pkgs.map(p => p.name);

    // Użyj EventSource (SSE) — serwer streamuje logi
    const es = new EventSource(
      UPD.install + '?packages=' + encodeURIComponent(names.join(',')) +
      '&_auth=1', // credentials przez query string (SSE nie wspiera headers)
    );

    // Alternatywnie POST z fetch + ReadableStream
    // SSE przez GET nie obsługuje body — użyjemy fetch stream
    es.close(); // zamknij EventSource

    // Fetch z ReadableStream (POST z body)
    fetch(UPD.install, {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json', 'Accept': 'text/event-stream'},
      body: JSON.stringify({packages: names}),
    }).then(async r => {
      if (!r.ok) {
        const err = await r.text().catch(() => `HTTP ${r.status}`);
        setInstallLog(l => [...l, `BŁĄD HTTP ${r.status}: ${err}`]);
        setInstalling(false);
        setInstallDone(true);
        setInstallStatus('error');
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});

        // Parsuj SSE chunks: "data: ...\n\n" lub "event: done\ndata: ...\n\n"
        const events = buf.split('\n\n');
        buf = events.pop(); // ostatni może być niekompletny

        for (const evt of events) {
          const lines = evt.split('\n');
          let eventType = 'message';
          let data = '';
          for (const l of lines) {
            if (l.startsWith('event: ')) eventType = l.slice(7).trim();
            if (l.startsWith('data: '))  data = l.slice(6);
          }

          if (eventType === 'done') {
            setInstallStatus(data === 'ok' ? 'ok' : 'error');
            setInstalling(false);
            setInstallDone(true);
            // Odśwież listę pakietów po udanej instalacji
            if (data === 'ok') {
              setTimeout(loadPackages, 1500);
              loadRebootRequired();
            }
          } else if (data !== '') {
            setInstallLog(l => [...l, data]);
          }
        }
      }
    }).catch(e => {
      setInstallLog(l => [...l, '', `BŁĄD połączenia: ${e.message}`]);
      setInstalling(false);
      setInstallDone(true);
      setInstallStatus('error');
    });
  };

  // ── Selekcja ──────────────────────────────────────────────────────────────
  const selected  = packages.filter(p => p.selected);
  const security  = packages.filter(p => p.type === 'security');
  const total     = packages.length;
  const totalSize = packages.filter(p=>p.selected).reduce((s,p)=>s+parseFloat(p.size)||0, 0).toFixed(1);

  const filtered = filter === 'all'      ? packages
                 : filter === 'security' ? packages.filter(p => p.type==='security')
                 :                         packages.filter(p => p.type==='update');

  const toggleAll = () => {
    const allSel = filtered.every(p => p.selected);
    const names  = new Set(filtered.map(p=>p.name));
    setPackages(ps => ps.map(p => names.has(p.name) ? {...p, selected:!allSel} : p));
  };
  const togglePkg = name => setPackages(ps => ps.map(p => p.name===name ? {...p,selected:!p.selected} : p));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {changelogFor && <ChangelogDialog pkg={changelogFor} onClose={()=>setChangelogFor(null)}/>}

      {/* KPI row */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">DOSTĘPNE</div>
          <div className="kpi-value" style={{color: loading?'var(--fg-dim)':total>0?'var(--warn)':'var(--ok)'}}>
            {loading ? '…' : total}
          </div>
          <div className="kpi-foot"><span>pakietów do aktualizacji</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">BEZPIECZEŃSTWO</div>
          <div className="kpi-value" style={{color:security.length>0?'var(--err)':'var(--ok)'}}>
            {loading ? '…' : security.length}
          </div>
          <div className="kpi-foot"><span>krytyczne poprawki</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">OSTATNIE SPRAWDZ.</div>
          <div className="kpi-value" style={{fontSize:16}}>
            {lastCheck !== '—' ? lastCheck.split(' ')[1] || lastCheck : '—'}
          </div>
          <div className="kpi-foot"><span>{lastCheck !== '—' ? lastCheck.split(' ')[0] : 'nigdy'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">RESTART</div>
          <div className="kpi-value" style={{fontSize:16, color:rebootReq?'var(--warn)':'var(--ok)'}}>
            {rebootReq ? 'WYMAGANY' : 'ZBĘDNY'}
          </div>
          <div className="kpi-foot">
            <span title={rebootPkgs||undefined}>
              {rebootReq ? (rebootPkgs ? 'hover = pakiety' : 'nowe jądro czeka') : 'system aktualny'}
            </span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{padding:'10px 14px',background:'oklch(0.5 0.18 25 / 0.12)',
          border:'1px solid var(--err)',borderRadius:8,fontSize:'var(--fs-sm)',color:'var(--err)',
          display:'flex',alignItems:'center',gap:10}}>
          <Icon name="close" size={14}/>
          {error}
          <button className="btn sm" style={{marginLeft:'auto'}} onClick={()=>setError('')}>✕</button>
        </div>
      )}

      {/* Tabs + akcje */}
      <div className="row" style={{justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div className="segmented">
          <button className={tab==='updates'?'active':''} onClick={()=>setTab('updates')}>
            Pakiety {total>0&&<span className="nav-badge" style={{marginLeft:4}}>{total}</span>}
          </button>
          <button className={tab==='log'?'active':''} onClick={()=>setTab('log')}>
            Dziennik {installLog.length>0&&<span className="nav-badge" style={{marginLeft:4}}>{installLog.length}</span>}
          </button>
          <button className={tab==='auto'?'active':''} onClick={()=>setTab('auto')}>Auto-aktualizacje</button>
          <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Historia</button>
        </div>
        <div className="row gap-sm">
          <button className="btn" onClick={runCheck} disabled={checking||installing}>
            <Icon name="refresh" size={12}/>
            {checking ? `apt update… ${checkProgress}%` : 'apt update'}
          </button>
          <button className="btn" disabled={!security.filter(p=>p.selected).length||installing}
            onClick={()=>runInstall(packages.filter(p=>p.selected&&p.type==='security'))}>
            <Icon name="shield" size={12}/>
            Tylko security ({security.filter(p=>p.selected).length})
          </button>
          <button className="btn primary" disabled={!selected.length||installing}
            onClick={()=>runInstall(selected)}>
            <Icon name="download" size={12}/>
            {installing ? 'Instaluję…' : `Instaluj zaznaczone (${selected.length})`}
          </button>
        </div>
      </div>

      {/* ── TAB: Pakiety ── */}
      {tab==='updates' && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Dostępne aktualizacje</div>
              <div className="card-sub">
                apt list --upgradable · {total} pakietów
                {totalSize !== '0.0' && ` · ${totalSize} MB do pobrania`}
              </div>
            </div>
            <div className="card-actions">
              <div className="segmented">
                {[
                  {k:'all',      label:'Wszystkie',  cnt:total},
                  {k:'security', label:'Security',   cnt:security.length},
                  {k:'update',   label:'Regularne',  cnt:packages.filter(p=>p.type==='update').length},
                ].map(({k,label,cnt})=>(
                  <button key={k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>
                    {label} ({cnt})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
              <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
              Ładowanie listy pakietów…
            </div>
          ) : packages.length === 0 ? (
            <div style={{padding:40,textAlign:'center'}}>
              <div style={{fontSize:32,marginBottom:12}}>✓</div>
              <div style={{fontWeight:600,marginBottom:4}}>System jest aktualny</div>
              <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
                Sprawdzono: {lastCheck}
              </div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{width:32}}>
                    <input type="checkbox"
                      checked={filtered.length>0 && filtered.every(p=>p.selected)}
                      onChange={toggleAll}
                      style={{cursor:'pointer'}}
                    />
                  </th>
                  <th>Pakiet</th>
                  <th>Aktualna wersja</th>
                  <th>Nowa wersja</th>
                  <th>Typ</th>
                  <th>Rozmiar</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.name} style={{opacity: installing&&p.selected ? 0.5 : 1}}>
                    <td>
                      <input type="checkbox" checked={p.selected} onChange={()=>togglePkg(p.name)} style={{cursor:'pointer'}}/>
                    </td>
                    <td>
                      <span className="mono" style={{fontWeight:500}}>{p.name}</span>
                    </td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{p.cur||'—'}</td>
                    <td className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--ok)'}}>{p.next||'—'}</td>
                    <td>
                      {p.type==='security'
                        ? <span className="badge err"><Icon name="shield" size={10}/> security</span>
                        : <span className="badge">update</span>}
                    </td>
                    <td className="mono dim">{p.size||'—'}</td>
                    <td>
                      <div className="row gap-sm">
                        <button className="btn sm ghost" onClick={()=>setChangelogFor(p)}>
                          Changelog
                        </button>
                        <button className="btn sm" disabled={installing}
                          onClick={()=>runInstall([p])}>
                          <Icon name="download" size={11}/> Instaluj
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── TAB: Dziennik ── */}
      {tab==='log' && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Dziennik instalacji</div>
              <div className="card-sub">apt-get install · wyjście terminala</div>
            </div>
            <div className="card-actions">
              {installDone && installStatus==='ok'  && <span className="badge ok"><Icon name="check" size={10}/> Zakończono</span>}
              {installDone && installStatus==='error'&&<span className="badge err"><Icon name="close" size={10}/> Błąd</span>}
              {installing  && <span className="badge warn"><span className="dot pulse"/>Trwa instalacja…</span>}
              <button className="btn sm" onClick={()=>setInstallLog([])} disabled={installing}>Wyczyść</button>
            </div>
          </div>
          <div ref={logRef} style={{
            padding:'14px 18px',
            fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', lineHeight:1.8,
            background:'var(--bg)', minHeight:320, maxHeight:520, overflowY:'auto',
            color:'var(--fg-muted)',
          }}>
            {installLog.length === 0 ? (
              <span style={{color:'var(--fg-dim)'}}>
                Brak wpisów. Uruchom instalację, aby zobaczyć dziennik.
              </span>
            ) : installLog.map((line, i) => {
              let color = 'var(--fg-muted)';
              if (line.startsWith('✓'))   color = 'var(--ok)';
              else if (line.startsWith('⚠'))   color = 'var(--warn)';
              else if (line.startsWith('BŁĄD')||line.startsWith('✗')) color = 'var(--err)';
              else if (line.startsWith('Pobieranie')||line.startsWith('Get:')) color = 'var(--accent)';
              else if (line.startsWith('Rozpakowywanie')||line.startsWith('Unpacking'))color='var(--fg)';
              else if (line.startsWith('Konfigurowanie')||line.startsWith('Setting up'))color='var(--ok)';
              return <div key={i} style={{color}}>{line || '\u00A0'}</div>;
            })}
            {installing && <div style={{color:'var(--accent)'}}>█</div>}
          </div>
        </div>
      )}

      {/* ── TAB: Auto-aktualizacje ── */}
      {tab==='auto' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Automatyczne aktualizacje</div>
              <div className="card-sub">unattended-upgrades</div>
            </div>
            <div className="card-body col" style={{gap:14}}>
              {[
                {label:'Włącz automatyczne aktualizacje', sub:'APT::Periodic::Unattended-Upgrade', val:autoUpdate, set:setAutoUpdate},
                {label:'Tylko poprawki bezpieczeństwa',   sub:'security.ubuntu.com',               val:autoSecurity,set:setAutoSecurity},
                {label:'Automatyczny restart',            sub:'Automatic-Reboot · godz. 03:00',    val:autoReboot,  set:setAutoReboot},
              ].map(({label,sub,val,set}) => (
                <div key={label} className="row" style={{justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontWeight:500}}>{label}</div>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{sub}</div>
                  </div>
                  <div className={'toggle '+(val?'on':'')} onClick={()=>set(v=>!v)}/>
                </div>
              ))}
              <hr className="div"/>
              <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px',
                fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.8}}>
                <div>Sprawdzanie: <span style={{color:'var(--fg)'}}>codziennie 03:00</span></div>
                <div>Instalacja: <span style={{color:autoUpdate?'var(--ok)':'var(--fg-dim)'}}>{autoUpdate?'włączona':'wyłączona'}</span></div>
                <div>Restart: <span style={{color:autoReboot?'var(--warn)':'var(--fg-dim)'}}>{autoReboot?'automatyczny':'ręczny'}</span></div>
              </div>
              <button className="btn sm primary" style={{alignSelf:'flex-end'}} onClick={saveAutoConfig} disabled={autoSaving}>
                {autoSaving ? 'Zapisywanie…' : 'Zapisz konfigurację'}
              </button>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Źródła (sources.list)</div>
              <div className="card-sub">/etc/apt/sources.list</div>
            </div>
            <div style={{padding:'var(--pad-card)'}}>
              {sourcesList ? (
                <div style={{background:'var(--bg)',borderRadius:6,padding:'12px 14px',
                  fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',
                  lineHeight:2, maxHeight:300, overflowY:'auto'}}>
                  {sourcesList.split('\n').map((l,i)=>(
                    <div key={i} style={{
                      color: l.startsWith('#')           ? 'var(--fg-dim)'
                           : l.includes('security')      ? 'var(--ok)'
                           : l.trim()===''               ? 'transparent'
                           : 'var(--fg-muted)'
                    }}>{l||'\u00A0'}</div>
                  ))}
                </div>
              ) : (
                <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)',padding:'20px 0'}}>
                  Ładowanie sources.list…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Historia ── */}
      {tab==='history' && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Historia aktualizacji</div>
              <div className="card-sub">/var/log/apt/history.log</div>
            </div>
            <div className="card-actions">
              <button className="btn sm" onClick={loadHistory}><Icon name="refresh" size={12}/> Odśwież</button>
            </div>
          </div>
          {history.length === 0 ? (
            <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
              Ładowanie historii… lub brak wpisów w /var/log/apt/history.log
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th><th>Polecenie</th><th>Pakiety</th><th>Status</th><th>Uwagi</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="mono" style={{whiteSpace:'nowrap'}}>{h.date}</td>
                    <td className="mono dim">{h.action}</td>
                    <td className="mono">{h.count}</td>
                    <td>
                      {h.status==='ok'
                        ? <span className="badge ok"><Icon name="check" size={10}/> OK</span>
                        : <span className="badge err"><Icon name="close" size={10}/> BŁĄD</span>}
                    </td>
                    <td className="dim">{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  );
};

window.SystemUpdates = SystemUpdates;
