// ===== Menedżer pakietów APT — API-driven =====

const Modal = window.Modal;
const Icon  = window.Icon;

const SECTION_COLORS = {
  admin:  'oklch(0.65 0.18 245)',
  net:    'oklch(0.65 0.18 200)',
  web:    'oklch(0.65 0.18 130)',
  utils:  'oklch(0.65 0.15 75)',
  python: 'oklch(0.65 0.15 300)',
  libs:   'oklch(0.65 0.12 220)',
  misc:   'oklch(0.65 0.08 260)',
  editors:'oklch(0.65 0.15 165)',
  devel:  'oklch(0.65 0.18 290)',
};

const sectionColor = (s) => SECTION_COLORS[s] || 'var(--fg-dim)';

const PkgBadge = ({ section }) => (
  <span style={{
    padding:'2px 7px', borderRadius:4, fontSize:'var(--fs-xs)',
    background: (sectionColor(section)) + '22',
    color: sectionColor(section),
    fontFamily:'var(--font-mono)', fontWeight:500,
  }}>{section}</span>
);

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiGet(path) {
  try {
    const r = await fetch(path, { credentials: 'include' });
    if (!r.ok) return { error: await r.text() };
    return r.json();
  } catch (e) { return { error: String(e) }; }
}

async function apiPost(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok ? r.json() : { error: await r.text() };
  } catch (e) { return { error: String(e) }; }
}

// Stream text from a POST endpoint, calling onLine for each line
async function streamPost(path, body, onLine, onDone) {
  try {
    const r = await fetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(l => onLine(l));
    }
    if (buf) onLine(buf);
    onDone(true);
  } catch (e) {
    onLine('[BŁĄD] ' + e.message);
    onDone(false);
  }
}

// ── Install modal ─────────────────────────────────────────────────────────────

const InstallModal = ({ pkg, onClose, onInstalled }) => {
  const [log, setLog]     = React.useState([]);
  const [done, setDone]   = React.useState(false);
  const [ok, setOk]       = React.useState(false);
  const logRef            = React.useRef(null);

  React.useEffect(() => {
    streamPost(
      '/api/packages/install',
      { name: pkg.name },
      (line) => {
        setLog(l => [...l, line]);
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      },
      (success) => { setDone(true); setOk(success); }
    );
  }, []);

  return (
    <Modal title={`apt install ${pkg.name}`} sub={`${pkg.version || ''}`} onClose={onClose} width={580}
      footer={<div className="row gap-sm" style={{ marginLeft:'auto' }}>
        {done && ok  && <button className="btn sm primary" onClick={()=>{ onInstalled(); onClose(); }}><Icon name="check" size={11}/> Gotowe</button>}
        {done && !ok && <button className="btn sm" onClick={onClose}>Zamknij</button>}
        {!done && <span className="badge warn"><span className="dot pulse"/>Instalowanie…</span>}
      </div>}
    >
      <div ref={logRef} style={{
        background:'var(--bg)', borderRadius:6, padding:'12px 14px',
        fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', lineHeight:1.8,
        color:'var(--fg-muted)', maxHeight:320, overflowY:'auto',
      }}>
        {log.map((line, i) => {
          let color = 'var(--fg-muted)';
          if (line.includes('[OK]')) color = 'var(--ok)';
          else if (line.includes('[ERROR]')) color = 'var(--err)';
          else if (line.startsWith('Konfigurowanie') || line.startsWith('Setting up')) color = 'var(--fg)';
          else if (line.startsWith('Rozpakowywanie') || line.startsWith('Unpacking')) color = 'var(--accent)';
          return <div key={i} style={{ color }}>{line || '\u00A0'}</div>;
        })}
        {!done && <span style={{ color:'var(--accent)' }}>█</span>}
      </div>
    </Modal>
  );
};

// ── Remove modal ──────────────────────────────────────────────────────────────

const RemoveModal = ({ pkg, onClose, onRemoved }) => {
  const [purge, setPurge] = React.useState(false);
  const [log,   setLog]   = React.useState([]);
  const [phase, setPhase] = React.useState('confirm'); // confirm | running | done
  const [ok, setOk]       = React.useState(false);
  const logRef            = React.useRef(null);

  const doRemove = () => {
    setPhase('running');
    streamPost(
      '/api/packages/remove',
      { name: pkg.name, purge },
      (line) => {
        setLog(l => [...l, line]);
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      },
      (success) => { setPhase('done'); setOk(success); }
    );
  };

  const rdeps = pkg.rdeps || [];

  return (
    <Modal title={`apt ${purge?'purge':'remove'} ${pkg.name}`} sub={pkg.version} onClose={onClose} width={480}
      footer={<div className="row gap-sm" style={{ marginLeft:'auto' }}>
        {phase === 'confirm' && <>
          <button className="btn sm" onClick={onClose}>Anuluj</button>
          <button className="btn sm danger" onClick={doRemove}>
            <Icon name="trash" size={11}/> {purge ? 'Usuń + purge' : 'Usuń pakiet'}
          </button>
        </>}
        {phase === 'running' && <span className="badge warn"><span className="dot pulse"/>Usuwanie…</span>}
        {phase === 'done' && ok  && <button className="btn sm primary" onClick={()=>{ onRemoved(); onClose(); }}><Icon name="check" size={11}/> Gotowe</button>}
        {phase === 'done' && !ok && <button className="btn sm" onClick={onClose}>Zamknij</button>}
      </div>}
    >
      {phase === 'confirm' ? (
        <div className="col" style={{ gap:14 }}>
          {rdeps.length > 0 && (
            <div style={{ padding:'10px 13px', background:'oklch(0.66 0.2 25 / 0.08)',
              border:'1px solid oklch(0.66 0.2 25 / 0.25)', borderRadius:7, fontSize:'var(--fs-sm)' }}>
              <div style={{ fontWeight:600, color:'var(--err)', marginBottom:4 }}>⚠ Zależności odwrotne</div>
              <div style={{ color:'var(--fg-muted)' }}>Usunięcie spowoduje również usunięcie:</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', color:'var(--warn)', marginTop:4 }}>
                {rdeps.join(', ')}
              </div>
            </div>
          )}
          <div style={{ fontSize:'var(--fs-sm)', color:'var(--fg-muted)' }}>
            Pakiet <span className="mono" style={{ color:'var(--fg)' }}>{pkg.name}</span> zostanie usunięty z systemu.
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', fontSize:'var(--fs-sm)' }}>
            <input type="checkbox" checked={purge} onChange={e=>setPurge(e.target.checked)} style={{ accentColor:'var(--err)', width:14, height:14 }}/>
            <div>
              <div style={{ fontWeight:500 }}>Purge (usuń pliki konfiguracyjne)</div>
              <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>apt purge — całkowite usunięcie wraz z konfiguracją</div>
            </div>
          </label>
        </div>
      ) : (
        <div ref={logRef} style={{
          background:'var(--bg)', borderRadius:6, padding:'12px 14px',
          fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', lineHeight:1.8,
          color:'var(--fg-muted)', maxHeight:280, overflowY:'auto',
        }}>
          {log.map((line, i) => {
            let color = 'var(--fg-muted)';
            if (line.includes('[OK]')) color = 'var(--ok)';
            else if (line.includes('[ERROR]')) color = 'var(--err)';
            return <div key={i} style={{ color }}>{line || '\u00A0'}</div>;
          })}
          {phase === 'running' && <span style={{ color:'var(--accent)' }}>█</span>}
        </div>
      )}
    </Modal>
  );
};

// ── Dep tree ─────────────────────────────────────────────────────────────────

const DepTree = ({ pkg, all, depth=0, visited=new Set() }) => {
  if (visited.has(pkg.name)) return null;
  visited.add(pkg.name);
  const color = depth===0 ? 'var(--fg)' : depth===1 ? 'var(--accent)' : 'var(--fg-muted)';
  return (
    <div style={{ paddingLeft: depth * 18 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 0', fontSize:'var(--fs-xs)', fontFamily:'var(--font-mono)' }}>
        {depth > 0 && <span style={{ color:'var(--fg-dim)', userSelect:'none' }}>└─</span>}
        <span style={{ color }}>{pkg.name}</span>
        <span style={{ color:'var(--fg-dim)' }}>{pkg.version}</span>
        {pkg.auto && <span style={{ fontSize:10, color:'var(--fg-dim)' }}>(auto)</span>}
      </div>
      {(pkg.deps || []).map(depName => {
        const dep = all.find(p => p.name === depName);
        if (!dep) return (
          <div key={depName} style={{ paddingLeft:(depth+1)*18 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 0', fontSize:'var(--fs-xs)', fontFamily:'var(--font-mono)' }}>
              <span style={{ color:'var(--fg-dim)', userSelect:'none' }}>└─</span>
              <span style={{ color:'var(--fg-dim)' }}>{depName}</span>
              <span style={{ color:'var(--fg-dim)', fontSize:10 }}>(zewnętrzny)</span>
            </div>
          </div>
        );
        return <DepTree key={depName} pkg={dep} all={all} depth={depth+1} visited={new Set(visited)}/>;
      })}
    </div>
  );
};

// ── Streaming output modal (for apt update / autoremove) ──────────────────────

const StreamModal = ({ title, endpoint, body, onClose, onDone }) => {
  const [log, setLog]   = React.useState([]);
  const [done, setDone] = React.useState(false);
  const logRef          = React.useRef(null);

  React.useEffect(() => {
    streamPost(endpoint, body,
      (line) => {
        setLog(l => [...l, line]);
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      },
      (ok) => { setDone(true); if (onDone) onDone(ok); }
    );
  }, []);

  return (
    <Modal title={title} onClose={onClose} width={560}
      footer={<div className="row gap-sm" style={{ marginLeft:'auto' }}>
        {done ? <button className="btn sm primary" onClick={onClose}><Icon name="check" size={11}/> Zamknij</button>
               : <span className="badge warn"><span className="dot pulse"/>Pracuję…</span>}
      </div>}
    >
      <div ref={logRef} style={{
        background:'var(--bg)', borderRadius:6, padding:'12px 14px',
        fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', lineHeight:1.8,
        color:'var(--fg-muted)', maxHeight:300, overflowY:'auto',
      }}>
        {log.map((l, i) => (
          <div key={i} style={{ color: l.includes('[OK]')?'var(--ok)':l.includes('[ERROR]')?'var(--err)':'var(--fg-muted)' }}>{l||'\u00A0'}</div>
        ))}
        {!done && <span style={{ color:'var(--accent)' }}>█</span>}
      </div>
    </Modal>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const PackageManager = () => {
  const [tab, setTab]               = React.useState('installed');
  const [installed, setInstalled]   = React.useState([]);
  const [stats, setStats]           = React.useState(null);
  const [loadingInst, setLoadingInst] = React.useState(true);

  const [searchQuery, setSearchQuery]   = React.useState('');
  const [searchResults, setSearchResults] = React.useState([]);
  const [searched, setSearched]         = React.useState(false);
  const [searching, setSearching]       = React.useState(false);

  const [filterSection, setFilterSection] = React.useState('all');
  const [filterAuto,    setFilterAuto]    = React.useState('all');
  const [sortBy,        setSortBy]        = React.useState('name');
  const [pkgSearch,     setPkgSearch]     = React.useState('');

  const [detailPkg,    setDetailPkg]    = React.useState(null);
  const [detailInfo,   setDetailInfo]   = React.useState(null);
  const [installTarget,setInstallTarget]= React.useState(null);
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [streamModal,  setStreamModal]  = React.useState(null);

  // ── Load installed ────────────────────────────────────────────────────
  const loadInstalled = async () => {
    setLoadingInst(true);
    const [pkgs, st] = await Promise.all([
      apiGet('/api/packages/installed'),
      apiGet('/api/packages/stats'),
    ]);
    setInstalled(Array.isArray(pkgs) ? pkgs : []);
    setStats(st.error ? null : st);
    setLoadingInst(false);
  };

  React.useEffect(() => { loadInstalled(); }, []);

  // ── Load detail info ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (!detailPkg) { setDetailInfo(null); return; }
    setDetailInfo(null);
    apiGet(`/api/packages/show?name=${encodeURIComponent(detailPkg.name)}`).then(d => {
      if (!d.error) setDetailInfo(d);
    });
  }, [detailPkg]);

  // ── Search ────────────────────────────────────────────────────────────
  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true); setSearched(false);
    const res = await apiGet(`/api/packages/search?q=${encodeURIComponent(searchQuery)}`);
    setSearchResults(Array.isArray(res) ? res : []);
    setSearching(false); setSearched(true);
  };

  // ── Filtered installed ────────────────────────────────────────────────
  const sections = [...new Set(installed.map(p => p.section))].sort();

  const filteredInstalled = installed
    .filter(p => filterSection === 'all' || p.section === filterSection)
    .filter(p => filterAuto === 'all' || (filterAuto === 'manual' ? !p.auto : p.auto))
    .filter(p => !pkgSearch || p.name.includes(pkgSearch.toLowerCase()) || (p.desc||'').toLowerCase().includes(pkgSearch.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name')    return a.name.localeCompare(b.name);
      if (sortBy === 'size')    return (b.size_kb || 0) - (a.size_kb || 0);
      if (sortBy === 'section') return a.section.localeCompare(b.section);
      return 0;
    });

  const autoCount   = installed.filter(p => p.auto).length;
  const totalMB     = stats ? stats.total_mb?.toFixed(1) : (installed.reduce((s,p) => s+(p.size_kb||0), 0)/1024).toFixed(1);

  // ── Handlers ──────────────────────────────────────────────────────────
  const onInstalled = () => {
    loadInstalled();
    setSearchResults(rs => rs.map(r => r.name === installTarget?.name ? { ...r, installed:true } : r));
  };

  const onRemoved = () => {
    loadInstalled();
    if (detailPkg?.name === removeTarget?.name) setDetailPkg(null);
    setSearchResults(rs => rs.map(r => r.name === removeTarget?.name ? { ...r, installed:false } : r));
  };

  const markManual = async (pkg) => {
    await apiPost('/api/packages/mark-manual', { name: pkg.name });
    loadInstalled();
  };

  const selectForRemove = (name) => {
    const p = installed.find(x => x.name === name);
    if (p) setRemoveTarget(p);
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="col" style={{ gap:'var(--gutter)' }}>

      {/* Modals */}
      {installTarget && (
        <InstallModal pkg={installTarget} onClose={()=>setInstallTarget(null)} onInstalled={onInstalled}/>
      )}
      {removeTarget && (
        <RemoveModal pkg={removeTarget} onClose={()=>setRemoveTarget(null)} onRemoved={onRemoved}/>
      )}
      {streamModal && (
        <StreamModal {...streamModal} onClose={()=>setStreamModal(null)} onDone={()=>loadInstalled()}/>
      )}

      {/* KPIs */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">ZAINSTALOWANE</div>
          <div className="kpi-value">{loadingInst ? '…' : installed.length}</div>
          <div className="kpi-foot"><span>pakietów w systemie</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">RĘCZNE</div>
          <div className="kpi-value" style={{ color:'var(--accent)' }}>{loadingInst ? '…' : installed.length - autoCount}</div>
          <div className="kpi-foot"><span>zainstalowane ręcznie</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">AUTOMATYCZNE</div>
          <div className="kpi-value" style={{ color:'var(--fg-dim)' }}>{loadingInst ? '…' : autoCount}</div>
          <div className="kpi-foot"><span>zainstalowane jako zależność</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ŁĄCZNY ROZMIAR</div>
          <div className="kpi-value" style={{ fontSize:18 }}>{loadingInst ? '…' : totalMB}</div>
          <div className="kpi-foot"><span>MB zainstalowanych pakietów</span></div>
        </div>
      </div>

      {/* Tabs + actions */}
      <div className="row" style={{ justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
        <div className="segmented">
          <button className={tab==='installed'?'active':''} onClick={()=>setTab('installed')}>Zainstalowane</button>
          <button className={tab==='search'?'active':''} onClick={()=>setTab('search')}>Wyszukaj / Zainstaluj</button>
          <button className={tab==='auto'?'active':''} onClick={()=>setTab('auto')}>Automatyczne</button>
        </div>
        <div className="row gap-sm">
          <button className="btn" onClick={()=>setStreamModal({ title:'apt-get update', endpoint:'/api/packages/update', body:{} })}>
            <Icon name="refresh" size={12}/> apt update
          </button>
          <button className="btn" onClick={()=>setStreamModal({ title:'apt-get autoremove', endpoint:'/api/packages/autoremove', body:{} })}>
            <Icon name="trash" size={12}/> autoremove
          </button>
        </div>
      </div>

      {/* ── ZAINSTALOWANE ── */}
      {tab === 'installed' && (
        <div style={{ display:'grid', gridTemplateColumns: detailPkg ? '1fr 340px' : '1fr', gap:'var(--gutter)' }}>
          <div className="card" style={{ overflow:'hidden' }}>
            <div className="card-head" style={{ flexWrap:'wrap', gap:10 }}>
              <div>
                <div className="card-title">Zainstalowane pakiety</div>
                <div className="card-sub">dpkg --list · {filteredInstalled.length} z {installed.length} pakietów</div>
              </div>
              <div className="card-actions" style={{ flexWrap:'wrap', gap:6 }}>
                {/* inline search */}
                <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5, padding:'4px 8px' }}>
                  <Icon name="search" size={12} style={{ color:'var(--fg-dim)' }}/>
                  <input value={pkgSearch} onChange={e=>setPkgSearch(e.target.value)} placeholder="Szukaj…"
                    style={{ background:'none', border:'none', outline:'none', color:'var(--fg)', fontSize:'var(--fs-xs)', width:110 }}/>
                </div>
                <select value={filterSection} onChange={e=>setFilterSection(e.target.value)}
                  style={{ background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
                    padding:'5px 8px', color:'var(--fg)', fontSize:'var(--fs-xs)', cursor:'pointer', outline:'none' }}>
                  <option value="all">Wszystkie sekcje</option>
                  {sections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={filterAuto} onChange={e=>setFilterAuto(e.target.value)}
                  style={{ background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
                    padding:'5px 8px', color:'var(--fg)', fontSize:'var(--fs-xs)', cursor:'pointer', outline:'none' }}>
                  <option value="all">Ręczne i auto</option>
                  <option value="manual">Tylko ręczne</option>
                  <option value="auto">Tylko automatyczne</option>
                </select>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                  style={{ background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
                    padding:'5px 8px', color:'var(--fg)', fontSize:'var(--fs-xs)', cursor:'pointer', outline:'none' }}>
                  <option value="name">Sortuj: nazwa</option>
                  <option value="size">Sortuj: rozmiar</option>
                  <option value="section">Sortuj: sekcja</option>
                </select>
              </div>
            </div>

            {loadingInst ? (
              <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)' }}>
                <span className="dot pulse" style={{ display:'inline-block', marginRight:8 }}/>Ładowanie pakietów…
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Pakiet</th><th>Wersja</th><th>Sekcja</th><th>Rozmiar</th><th>Typ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInstalled.map(p => (
                    <tr key={p.name}
                      style={{ cursor:'pointer', background: detailPkg?.name===p.name ? 'var(--accent-soft)' : '' }}
                      onClick={()=>setDetailPkg(p)}>
                      <td>
                        <div className="mono" style={{ fontWeight:600, fontSize:'var(--fs-sm)' }}>{p.name}</div>
                        <div style={{ fontSize:10, color:'var(--fg-dim)', marginTop:1, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.desc}</div>
                      </td>
                      <td className="mono dim" style={{ fontSize:'var(--fs-xs)' }}>{p.version}</td>
                      <td><PkgBadge section={p.section}/></td>
                      <td className="mono dim">{p.size_kb ? (p.size_kb/1024).toFixed(1)+' MB' : '—'}</td>
                      <td>
                        {p.auto ? <span className="badge dim">auto</span> : <span className="badge">ręczny</span>}
                      </td>
                      <td onClick={e=>e.stopPropagation()}>
                        <div className="row gap-sm">
                          <button className="btn sm" onClick={()=>setDetailPkg(p)}>Info</button>
                          <button className="icon-btn" onClick={()=>setRemoveTarget(p)} title="Usuń">
                            <Icon name="trash" size={13}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredInstalled.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'var(--fg-dim)' }}>Brak wyników</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail panel */}
          {detailPkg && (
            <div className="card" style={{ alignSelf:'start', position:'sticky', top:0 }}>
              <div className="card-head" style={{ gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="card-title mono" style={{ fontSize:'var(--fs-sm)', wordBreak:'break-all' }}>{detailPkg.name}</div>
                  <div className="card-sub">{detailPkg.version}</div>
                </div>
                <button className="icon-btn" onClick={()=>setDetailPkg(null)}><Icon name="close" size={14}/></button>
              </div>
              <div className="card-body col" style={{ gap:12 }}>
                <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-muted)', lineHeight:1.6 }}>{detailPkg.desc}</div>
                <div className="row" style={{ gap:8, flexWrap:'wrap' }}>
                  <PkgBadge section={detailPkg.section}/>
                  {detailPkg.auto ? <span className="badge dim">auto-installed</span> : <span className="badge">manually installed</span>}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 12px' }}>
                  {[
                    ['Rozmiar', detailPkg.size_kb ? (detailPkg.size_kb/1024).toFixed(1)+' MB' : '—'],
                    ['Sekcja',  detailPkg.section],
                  ].map(([k,v]) => (
                    <div key={k}>
                      <div style={{ fontSize:10, color:'var(--fg-dim)', textTransform:'uppercase', letterSpacing:'.06em' }}>{k}</div>
                      <div className="mono" style={{ fontSize:'var(--fs-xs)', marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <hr className="div"/>

                {/* Deps from API */}
                <div>
                  <div style={{ fontSize:'var(--fs-xs)', fontWeight:600, color:'var(--fg-dim)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>
                    Zależności
                  </div>
                  {!detailInfo ? (
                    <div style={{ color:'var(--fg-dim)', fontSize:'var(--fs-xs)' }}>Ładowanie…</div>
                  ) : detailInfo.deps?.length > 0 ? (
                    <div style={{ background:'var(--bg)', borderRadius:6, padding:'8px 10px', maxHeight:180, overflowY:'auto' }}>
                      {detailInfo.deps.map(d => (
                        <div key={d} style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', color:'var(--fg-dim)', paddingLeft:8 }}>└─ {d}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>Brak zależności</div>
                  )}
                </div>

                {detailInfo?.rdeps?.length > 0 && (
                  <div>
                    <div style={{ fontSize:'var(--fs-xs)', fontWeight:600, color:'var(--fg-dim)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>
                      Wymagane przez
                    </div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                      {detailInfo.rdeps.map(r => (
                        <span key={r} className="chip mono" style={{ fontSize:'var(--fs-xs)' }}>{r}</span>
                      ))}
                    </div>
                  </div>
                )}

                <hr className="div"/>
                <button className="btn sm danger" style={{ width:'100%' }} onClick={()=>setRemoveTarget(detailPkg)}>
                  <Icon name="trash" size={11}/> Usuń pakiet
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WYSZUKAJ ── */}
      {tab === 'search' && (
        <div className="col" style={{ gap:'var(--gutter)' }}>
          <div className="card">
            <div className="card-body">
              <div style={{ display:'flex', gap:8 }}>
                <input
                  value={searchQuery}
                  onChange={e=>setSearchQuery(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&doSearch()}
                  placeholder="np. ncdu, wireguard, prometheus…"
                  style={{ flex:1, background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:6,
                    padding:'8px 12px', color:'var(--fg)', fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)', outline:'none' }}
                />
                <button className="btn primary" onClick={doSearch} disabled={searching}>
                  {searching
                    ? <><span className="dot pulse" style={{ marginRight:6 }}/>Szukam…</>
                    : <><Icon name="search" size={12}/> apt search</>}
                </button>
              </div>
              {!searched && !searching && (
                <div style={{ marginTop:12, display:'flex', gap:8, flexWrap:'wrap' }}>
                  {['ncdu','iotop','wireguard','tmux','prometheus','lm-sensors'].map(s => (
                    <button key={s} onClick={()=>{ setSearchQuery(s); }}
                      style={{ padding:'4px 10px', borderRadius:5, border:'1px solid var(--line-strong)',
                        background:'var(--bg-2)', color:'var(--fg-dim)', fontSize:'var(--fs-xs)',
                        fontFamily:'var(--font-mono)', cursor:'pointer' }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {searched && (
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Wyniki wyszukiwania</div>
                  <div className="card-sub">apt search "{searchQuery}" · {searchResults.length} wyników</div>
                </div>
              </div>
              {searchResults.length === 0 ? (
                <div style={{ padding:'var(--pad-card)', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>Brak wyników dla „{searchQuery}"</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Pakiet</th><th>Wersja</th><th>Sekcja</th><th>Rozmiar</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {searchResults.map(p => (
                      <tr key={p.name}>
                        <td>
                          <div className="mono" style={{ fontWeight:600, fontSize:'var(--fs-sm)' }}>{p.name}</div>
                          <div style={{ fontSize:10, color:'var(--fg-dim)', marginTop:1 }}>{p.desc}</div>
                        </td>
                        <td className="mono dim" style={{ fontSize:'var(--fs-xs)' }}>{p.version}</td>
                        <td><PkgBadge section={p.section || 'misc'}/></td>
                        <td className="mono dim">{p.size_kb ? (p.size_kb/1024).toFixed(1)+' MB' : '—'}</td>
                        <td>
                          {p.installed
                            ? <span className="badge ok"><Icon name="check" size={10}/> zainstalowany</span>
                            : <span className="badge dim">dostępny</span>}
                        </td>
                        <td>
                          {p.installed
                            ? <button className="btn sm danger" onClick={()=>selectForRemove(p.name)}>
                                <Icon name="trash" size={11}/> Usuń
                              </button>
                            : <button className="btn sm primary" onClick={()=>setInstallTarget(p)}>
                                <Icon name="download" size={11}/> Instaluj
                              </button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AUTOMATYCZNE ── */}
      {tab === 'auto' && (
        <div className="col" style={{ gap:'var(--gutter)' }}>
          <div style={{ padding:'12px 16px', background:'oklch(0.65 0.18 245 / 0.07)', border:'1px solid oklch(0.65 0.18 245 / 0.2)', borderRadius:8, fontSize:'var(--fs-sm)', color:'var(--fg-muted)' }}>
            <b style={{ color:'var(--fg)' }}>apt autoremove</b> — pakiety zainstalowane automatycznie jako zależności, które nie są już potrzebne żadnemu ręcznie zainstalowanemu pakietowi, można bezpiecznie usunąć.
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Pakiety automatyczne</div>
                <div className="card-sub">zainstalowane jako zależności · {autoCount} pakietów</div>
              </div>
              <div className="card-actions">
                <button className="btn sm danger"
                  onClick={()=>setStreamModal({ title:'apt-get autoremove', endpoint:'/api/packages/autoremove', body:{} })}>
                  <Icon name="trash" size={11}/> autoremove
                </button>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Pakiet</th><th>Wersja</th><th>Sekcja</th><th>Rozmiar</th><th></th></tr></thead>
              <tbody>
                {installed.filter(p => p.auto).map(p => (
                  <tr key={p.name}>
                    <td>
                      <div className="mono" style={{ fontWeight:500, fontSize:'var(--fs-sm)' }}>{p.name}</div>
                      <div style={{ fontSize:10, color:'var(--fg-dim)', marginTop:1 }}>{p.desc}</div>
                    </td>
                    <td className="mono dim" style={{ fontSize:'var(--fs-xs)' }}>{p.version}</td>
                    <td><PkgBadge section={p.section}/></td>
                    <td className="mono dim">{p.size_kb ? (p.size_kb/1024).toFixed(1)+' MB' : '—'}</td>
                    <td>
                      <div className="row gap-sm">
                        <button className="btn sm" onClick={()=>markManual(p)}>Oznacz ręczny</button>
                        <button className="icon-btn" onClick={()=>setRemoveTarget(p)}><Icon name="trash" size={13}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {installed.filter(p=>p.auto).length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign:'center', padding:24, color:'var(--fg-dim)' }}>
                    {loadingInst ? 'Ładowanie…' : 'Brak pakietów automatycznych'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

window.PackageManager = PackageManager;
