// ===== NFS Server + Client screen =====

const Icon = window.Icon;

const KV = ({k, v}) => (
  <div className="row" style={{justifyContent:'space-between',gap:16}}>
    <span className="dim" style={{fontSize:'var(--fs-sm)'}}>{k}</span>
    <span style={{fontSize:'var(--fs-sm)'}}>{v}</span>
  </div>
);

const inputStyle = {
  background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
  padding:'5px 10px', color:'var(--fg)', fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)',
  outline:'none', width:'100%',
};

// ─── Root ─────────────────────────────────────────────────────────────────────
const NfsServer = () => {
  const [tab, setTab] = React.useState('server');
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="segmented">
        <button className={tab==='server'?'active':''} onClick={()=>setTab('server')}>Serwer NFS</button>
        <button className={tab==='client'?'active':''} onClick={()=>setTab('client')}>Klient · montowanie</button>
      </div>
      {tab==='server' ? <NfsServerTab/> : <NfsClientTab/>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// SERWER NFS
// ═══════════════════════════════════════════════════════════════════════════

const NfsServerTab = () => {
  const [status,     setStatus]     = React.useState(null);
  const [exports_,   setExports]    = React.useState([]);
  const [clients,    setClients]    = React.useState([]);
  const [config,     setConfig]     = React.useState(null);
  const [loading,    setLoading]    = React.useState(true);
  const [showAdd,    setShowAdd]    = React.useState(false);
  const [installed,  setInstalled]  = React.useState(true);
  const [installing, setInstalling] = React.useState(false);
  const [form,       setForm]       = React.useState({path:'/mnt/', clients:'192.168.1.0/24', opts:'rw,sync,no_subtree_check'});

  React.useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 15000);
    return () => clearInterval(id);
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStatus(),
        loadExports(),
        loadClients(),
        loadConfig()
      ]);
    } catch(e) {
      console.error('NFS server load error:', e);
    }
    setLoading(false);
  };

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/nfs-server/status', {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (d) {
        setStatus(d);
        if (d.installed !== undefined) {
          setInstalled(d.installed);
        }
      }
    } catch(e) {}
  };

  const loadExports = async () => {
    try {
      const r = await fetch('/api/nfs-server/exports', {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (!d) return;
      
      const list = d.exports || d || [];
      const parsed = Array.isArray(list) ? list.map(e => ({
        path:      e.path || e.Path || '—',
        clients:   e.clients || e.Clients || [],
        active:    e.active || 0,
        raw:       e.raw || '',
        clientStr: (e.clients || e.Clients || []).map(c => c.host || c.Host).join(', ') || '*',
        optsStr:   (e.clients || e.Clients || []).map(c => c.opts || c.Opts).join(' / ') || 'ro',
      })) : [];
      
      setExports(parsed);
    } catch(e) {}
  };

  const loadClients = async () => {
    try {
      const r = await fetch('/api/nfs-server/clients', {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.clients) setClients(d.clients);
    } catch(e) {}
  };

  const loadConfig = async () => {
    try {
      const r = await fetch('/api/nfs-server/config', {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (d) setConfig(d.config || d);
    } catch(e) {}
  };

  const toggleService = async () => {
    const enable = !status?.active;
    await fetch('/api/nfs-server/toggle', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({enable}),
    }).catch(()=>{});
    await loadStatus();
  };

  const addExport = async () => {
    if (!form.path) return;
    const clientEntry = [{host: form.clients, opts: form.opts}];
    await fetch('/api/nfs-server/exports', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path: form.path, clients: clientEntry}),
    }).catch(()=>{});
    setShowAdd(false);
    setForm({path:'/mnt/', clients:'192.168.1.0/24', opts:'rw,sync,no_subtree_check'});
    await loadExports();
  };

  const deleteExport = async (path) => {
    if (!confirm(`Usunąć eksport ${path}?`)) return;
    const encoded = encodeURIComponent(path.replace(/^\//, ''));
    await fetch(`/api/nfs-server/exports/${encoded}`, {
      method:'DELETE', credentials:'include',
    }).catch(()=>{});
    await loadExports();
  };

  const saveConfig = async (patch) => {
    setConfig(prev => ({...prev, ...patch}));
    await fetch('/api/nfs-server/config', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(patch),
    }).catch(()=>{});
  };

  const installNFS = async () => {
    setInstalling(true);
    try {
      const r = await fetch('/api/nfs-server/install', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      });
      if (r.ok) {
        setInstalled(true);
        setTimeout(() => loadAll(), 2000);
      } else {
        alert('Błąd instalacji NFS Server');
      }
    } catch(e) {
      alert('Błąd: ' + e.message);
    }
    setInstalling(false);
  };

  const running = status?.active || false;

  // ── Ekran instalacji ──────────────────────────────────────────────────────
  if (!installed && !loading) {
    return (
      <div className="col" style={{gap:'var(--gutter)'}}>
        <div className="card" style={{padding:40, textAlign:'center'}}>
          <div style={{fontSize:48, marginBottom:16, opacity:0.3}}>🖴</div>
          <div className="card-title" style={{marginBottom:8, fontSize:'var(--fs-lg)'}}>
            Serwer NFS nie jest zainstalowany
          </div>
          <div className="card-sub" style={{marginBottom:24, maxWidth:500, margin:'0 auto 20px'}}>
            NFS (Network File System) umożliwia udostępnianie katalogów przez sieć dla systemów Linux/Unix.
            Po instalacji będziesz mógł eksportować udziały NFS i montować je na innych serwerach.
          </div>
          
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, maxWidth:700, margin:'0 auto 24px', textAlign:'left'}}>
            <div style={{padding:14, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:8}}>
              <div style={{fontWeight:600, marginBottom:4, fontSize:'var(--fs-sm)'}}>📦 Pakiety</div>
              <div className="mono dim" style={{fontSize:'var(--fs-xs)', lineHeight:1.6}}>
                nfs-kernel-server<br/>
                nfs-common<br/>
                rpcbind
              </div>
            </div>
            <div style={{padding:14, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:8}}>
              <div style={{fontWeight:600, marginBottom:4, fontSize:'var(--fs-sm)'}}>⚙️ Konfiguracja</div>
              <div className="mono dim" style={{fontSize:'var(--fs-xs)', lineHeight:1.6}}>
                /etc/exports<br/>
                /etc/nfs.conf<br/>
                /etc/idmapd.conf
              </div>
            </div>
            <div style={{padding:14, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:8}}>
              <div style={{fontWeight:600, marginBottom:4, fontSize:'var(--fs-sm)'}}>🔌 Porty</div>
              <div className="mono dim" style={{fontSize:'var(--fs-xs)', lineHeight:1.6}}>
                2049 (nfsd)<br/>
                111 (rpcbind)<br/>
                mountd, statd
              </div>
            </div>
          </div>

          <button className="btn primary" onClick={installNFS} disabled={installing}
            style={{padding:'10px 24px', fontSize:'var(--fs-base)'}}>
            {installing ? (
              <><span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Instalowanie NFS Server...</>
            ) : (
              <><Icon name="download" size={16}/> Zainstaluj NFS Server</>
            )}
          </button>
          
          <div style={{marginTop:12, fontSize:'var(--fs-xs)', color:'var(--fg-dim)'}}>
            Wymaga uprawnień root • Instalacja zajmuje ~30 sekund
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Instalacja ręczna</div>
          </div>
          <div className="card-body">
            <div style={{fontSize:'var(--fs-sm)', marginBottom:12, color:'var(--fg-dim)'}}>
              Możesz również zainstalować NFS Server ręcznie przez terminal:
            </div>
            <pre style={{
              background:'var(--bg-1)', border:'1px solid var(--line)', borderRadius:6,
              padding:'12px 16px', fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)',
              color:'var(--fg-muted)', lineHeight:1.8, margin:0
            }}>
{`# Zainstaluj pakiety NFS
sudo apt-get update
sudo apt-get install -y nfs-kernel-server nfs-common rpcbind

# Włącz i uruchom usługi
sudo systemctl enable nfs-server rpcbind
sudo systemctl start nfs-server rpcbind

# Sprawdź status
sudo systemctl status nfs-server`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // ── Normalny widok ────────────────────────────────────────────────────────
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20, color:running?'var(--ok)':'var(--fg-dim)'}}>
            {loading ? '…' : running ? 'ONLINE' : 'STOPPED'}
          </div>
          <div className="kpi-foot"><span>NFS v4 · port {status?.port||2049}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">EKSPORTY</div>
          <div className="kpi-value">{exports_.length}</div>
          <div className="kpi-foot"><span>aktywne ścieżki</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">KLIENCI</div>
          <div className="kpi-value" style={{color:'var(--accent)'}}>
            {status?.client_count ?? exports_.reduce((s,e)=>s+e.active,0)}
          </div>
          <div className="kpi-foot"><span>podłączeni teraz</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">WERSJA</div>
          <div className="kpi-value" style={{fontSize:20}}>v4.2</div>
          <div className="kpi-foot"><span>{status?.version || 'NFSv4'}</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Eksporty NFS</div>
            <div className="card-sub">/etc/exports · {exports_.length} wpisów</div>
          </div>
          <div className="card-actions">
            <span className="dim" style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>usługa</span>
            <div className={'toggle '+(running?'on':'')} onClick={toggleService}/>
            <button className="btn sm primary" onClick={()=>setShowAdd(s=>!s)}>
              <Icon name="plus" size={12}/> Dodaj eksport
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{padding:'12px var(--pad-card)',borderBottom:'1px solid var(--line)',
            background:'var(--bg-2)',display:'grid',gridTemplateColumns:'2fr 1.5fr 2fr auto',gap:10,alignItems:'end'}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Ścieżka lokalna</div>
              <input style={inputStyle} value={form.path}
                onChange={e=>setForm(f=>({...f,path:e.target.value}))} placeholder="/mnt/tank/media"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Klienci / sieć</div>
              <input style={inputStyle} value={form.clients}
                onChange={e=>setForm(f=>({...f,clients:e.target.value}))} placeholder="192.168.1.0/24"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Opcje</div>
              <input style={inputStyle} value={form.opts}
                onChange={e=>setForm(f=>({...f,opts:e.target.value}))} placeholder="rw,sync,no_subtree_check"/>
            </div>
            <div className="row gap-sm">
              <button className="btn sm primary" onClick={addExport}>Dodaj</button>
              <button className="btn sm" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
            <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie…
          </div>
        ) : exports_.length === 0 ? (
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
            Brak eksportów · kliknij „Dodaj eksport" aby dodać pierwszy wpis do /etc/exports
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Ścieżka</th><th>Klienci</th><th>Opcje</th><th>Aktywni</th><th></th></tr>
            </thead>
            <tbody>
              {exports_.map((e, i) => (
                <tr key={i}>
                  <td><span className="mono" style={{fontWeight:500}}>{e.path}</span></td>
                  <td className="mono">{e.clientStr}</td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{e.optsStr}</td>
                  <td>
                    {e.active > 0
                      ? <span className="badge ok"><span className="dot pulse"/>{e.active} klientów</span>
                      : <span className="badge">0</span>}
                  </td>
                  <td>
                    <div className="row gap-sm">
                      <button className="icon-btn"><Icon name="edit" size={14}/></button>
                      <button className="icon-btn" onClick={()=>deleteExport(e.path)}>
                        <Icon name="trash" size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Konfiguracja serwera</div>
            <div className="card-sub">/etc/nfs.conf · /etc/idmapd.conf</div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <KV k="Domena NFSv4" v={<span className="mono">{config?.domain || '—'}</span>}/>
            <KV k="Protokół"    v={<span className="chip accent">NFSv4.2</span>}/>
            <KV k="Port NFS"    v={<span className="mono">2049</span>}/>
            <KV k="rpcbind"     v={<span className="mono">111</span>}/>
            <KV k="Wątki nfsd" v={<span className="mono">{config?.threads || status?.threads || 8}</span>}/>
            <hr className="div"/>
            {[
              {label:'NFSv3 (legacy)',  key:'v3',   def:false},
              {label:'Kerberos (krb5)', key:'krb',  def:false},
              {label:'Transport UDP',   key:'udp',  def:false},
              {label:'RDMA (NFS-oRDMA)',key:'rdma', def:false},
            ].map(({label, key, def}) => (
              <div key={key} className="row" style={{justifyContent:'space-between'}}>
                <span>{label}</span>
                <div className={'toggle '+((config?.[key] ?? def)?'on':'')}
                  onClick={() => saveConfig({[key]: !(config?.[key] ?? def)})}/>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Aktywni klienci</div>
            <div className="card-sub">showmount -a</div>
          </div>
          {clients.length === 0 ? (
            <div style={{padding:24,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
              {loading ? 'Ładowanie…' : 'Brak aktywnych klientów'}
            </div>
          ) : (
            <table className="table">
              <thead><tr><th>Adres IP</th><th>Eksport</th><th>I/O</th><th>Czas</th></tr></thead>
              <tbody>
                {clients.map((c, i) => (
                  <tr key={i}>
                    <td className="mono">{c.ip || c.IP}</td>
                    <td className="mono dim">{c.export || c.Export}</td>
                    <td className="mono">{c.read ? `↓ ${c.read}` : '—'}</td>
                    <td className="mono dim">{c.since || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// KLIENT NFS
// ═══════════════════════════════════════════════════════════════════════════

const NfsClientTab = () => {
  const [loading,     setLoading]    = React.useState(false);
  const [range,       setRange]      = React.useState('192.168.1.0/24');
  const [scanning,    setScanning]   = React.useState(false);
  const [progress,    setProgress]   = React.useState(0);
  const [found,       setFound]      = React.useState([]);
  const [scanDone,    setScanDone]   = React.useState(false);
  const [scanned,     setScanned]    = React.useState(0);
  const [total,       setTotal]      = React.useState(0);
  const [expanded,    setExpanded]   = React.useState(null);
  const [mounts,      setMounts]     = React.useState([]);
  const [mountTarget, setMountTarget]= React.useState(null);
  const [mountPoint,  setMountPoint] = React.useState('/mnt/remote/');
  const [mountOpts,   setMountOpts]  = React.useState('rw,soft,timeo=30');
  const [mounting,    setMounting]   = React.useState(false);
  const [mountError,  setMountError] = React.useState('');
  const pollRef = React.useRef(null);

  React.useEffect(() => {
    loadMounts();
    fetch('/api/nfs/networks', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(d => {
        if (d?.networks?.length) setRange(d.networks[0]);
      }).catch(()=>{});
  }, []);

  const loadMounts = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/nfs/mounts', {credentials:'include'});
      if (!r.ok) {
        console.error('NFS mounts API error:', r.status);
        setLoading(false);
        return;
      }
      const d = await r.json();
      
      let list = [];
      if (d.mounts && Array.isArray(d.mounts)) {
        list = d.mounts;
      } else if (Array.isArray(d)) {
        list = d;
      }
      
      const mapped = list.map((m, i) => ({
        id:         i + 1,
        ip:         m.server || m.ip || '—',
        hostname:   m.server || m.ip || '—',
        export:     m.export || m.path || '—',
        mountPoint: m.mountpoint || m.mount_point || m.target || '—',
        opts:       m.opts || m.options || '—',
        fstype:     m.fstype || m.fs_type || 'nfs4',
        since:      m.since || '—',
      }));
      
      setMounts(mapped);
    } catch(e) {
      console.error('loadMounts error:', e);
    }
    setLoading(false);
  };

  const startScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScanDone(false);
    setProgress(0);
    setScanned(0);
    setFound([]);
    setTotal(0);

    try {
      const r = await fetch('/api/nfs/scan-network-start', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({network: range}),
      });

      if (!r || !r.ok) {
        setScanning(false);
        return;
      }
      const d = await r.json().catch(()=>null);
      setTotal(d?.total || 254);

      pollRef.current = setInterval(async () => {
        try {
          const s = await fetch('/api/nfs/scan-network-status', {credentials:'include'});
          if (!s || !s.ok) return;
          const data = await s.json();
          setProgress(data.progress || 0);
          setScanned(Math.round((data.progress||0) * (data.total||254) / 100));
          if (data.results) setFound(data.results);
          if (data.done) {
            clearInterval(pollRef.current);
            setScanning(false);
            setScanDone(true);
            setProgress(100);
            setScanned(data.total || 254);
          }
        } catch(e) {}
      }, 600);
    } catch(e) {
      setScanning(false);
    }
  };

  const stopScan = async () => {
    clearInterval(pollRef.current);
    setScanning(false);
    setScanDone(true);
    try {
      const s = await fetch('/api/nfs/scan-network-status', {credentials:'include'});
      if (s && s.ok) {
        const data = await s.json();
        if (data.results) setFound(data.results);
      }
    } catch(e) {}
  };

  const openMount = (srv, exp) => {
    setMountTarget({ip: srv.ip, hostname: srv.hostname, export: exp});
    const safePath = exp.replace(/\/+$/, '');
    setMountPoint('/mnt/remote' + safePath);
    setMountError('');
  };

  const doMount = async () => {
    if (!mountTarget || !mountPoint) return;
    setMounting(true);
    setMountError('');
    try {
      const r = await fetch('/api/nfs/mount', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          server:  mountTarget.ip,
          export:  mountTarget.export,
          target:  mountPoint,
          options: mountOpts,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(()=>({error:'Nieznany błąd'}));
        setMountError(err.error || `HTTP ${r.status}`);
        setMounting(false);
        return;
      }
      setMountTarget(null);
      await loadMounts();
    } catch(e) {
      setMountError(e.message);
    }
    setMounting(false);
  };

  const doUmount = async (mount) => {
    if (!confirm(`Odmontować ${mount.mountPoint}?`)) return;
    try {
      await fetch('/api/nfs/umount', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({target: mount.mountPoint}),
      });
      await loadMounts();
    } catch(e) {
      console.error('umount error:', e);
    }
  };

  const OPTS_PRESETS = [
    'rw,soft,timeo=30',
    'ro,soft',
    'rw,hard,intr',
    'rw,async,noatime',
  ];

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Skaner sieci · NFS</div>
            <div className="card-sub">Wykryj serwery NFS w sieci lokalnej (port 2049 + showmount)</div>
          </div>
          <div className="card-actions">
            <input
              style={{...inputStyle, width:180}}
              value={range}
              onChange={e=>setRange(e.target.value)}
              placeholder="192.168.1.0/24"
            />
            {!scanning
              ? <button className="btn primary" onClick={startScan}>
                  <Icon name="search" size={12}/> Skanuj
                </button>
              : <button className="btn danger" onClick={stopScan}>
                  <Icon name="close" size={12}/> Zatrzymaj
                </button>
            }
          </div>
        </div>

        {(scanning || scanDone) && (
          <div style={{padding:'12px var(--pad-card)', borderBottom: found.length?'1px solid var(--line)':'none'}}>
            <div className="row" style={{justifyContent:'space-between',marginBottom:6,
              fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
              <span>
                {scanning
                  ? <><span className="dot pulse" style={{display:'inline-block',marginRight:6}}/>
                      Skanowanie {range} — sprawdzono {scanned}/{total} hostów · znaleziono {found.length} serwerów</>
                  : <>Zakończono · {scanned} hostów · <strong style={{color:'var(--fg)'}}>{found.length} serwery NFS</strong></>
                }
              </span>
              <span>{progress}%</span>
            </div>
            <div className="bar" style={{height:5,borderRadius:3}}>
              <i style={{
                width:progress+'%',
                background: scanning ? 'var(--accent)' : 'var(--ok)',
                transition:'width 200ms linear',
                borderRadius:3,
              }}/>
            </div>
          </div>
        )}

        {found.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Adres IP</th><th>Hostname</th><th>Eksporty</th><th>Ping</th><th></th></tr>
            </thead>
            <tbody>
              {found.map(srv => (
                <React.Fragment key={srv.ip}>
                  <tr style={{cursor:'pointer'}} onClick={()=>setExpanded(expanded===srv.ip?null:srv.ip)}>
                    <td><span className="mono" style={{fontWeight:500}}>{srv.ip}</span></td>
                    <td className="mono">{srv.hostname !== srv.ip ? srv.hostname : '—'}</td>
                    <td>
                      <span className="badge accent">
                        {srv.exports?.length || 0} {srv.exports?.length===1?'eksport':'eksporty'}
                      </span>
                    </td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>
                      {srv.latency_ms ? `${srv.latency_ms}ms` : '—'}
                    </td>
                    <td style={{width:32}}>
                      <Icon name="chevron" size={14} style={{
                        color:'var(--fg-dim)',
                        transform: expanded===srv.ip ? 'rotate(90deg)' : 'none',
                        transition:'transform 0.15s',
                        display:'block',
                      }}/>
                    </td>
                  </tr>
                  {expanded===srv.ip && (srv.exports||[]).map(exp => (
                    <tr key={exp} style={{background:'var(--bg-2)'}}>
                      <td style={{paddingLeft:32}} colSpan={2}>
                        <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{srv.ip}:</span>
                        <span className="mono" style={{marginLeft:2}}>{exp}</span>
                      </td>
                      <td colSpan={2}></td>
                      <td>
                        <button className="btn sm primary" onClick={()=>openMount(srv, exp)}>
                          <Icon name="link" size={11}/> Zamontuj
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}

        {!scanning && !scanDone && (
          <div style={{padding:'36px var(--pad-card)',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            <Icon name="search" size={28} style={{opacity:0.25,display:'block',margin:'0 auto 10px'}}/>
            Wprowadź zakres sieci i naciśnij <strong style={{color:'var(--fg)'}}>Skanuj</strong>
          </div>
        )}
      </div>

      {mountTarget && (
        <div className="card" style={{borderColor:'var(--accent)'}}>
          <div className="card-head">
            <div>
              <div className="card-title">Zamontuj eksport NFS</div>
              <div className="card-sub">
                {mountTarget.ip}:{mountTarget.export}
              </div>
            </div>
            <div className="card-actions">
              <button className="icon-btn" onClick={()=>setMountTarget(null)}>
                <Icon name="close"/>
              </button>
            </div>
          </div>
          <div className="card-body">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Punkt montowania</div>
                <input style={inputStyle} value={mountPoint} onChange={e=>setMountPoint(e.target.value)}/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Opcje (mount -o …)</div>
                <input style={inputStyle} value={mountOpts} onChange={e=>setMountOpts(e.target.value)}/>
              </div>
            </div>
            <div className="row gap-sm" style={{marginBottom:12,flexWrap:'wrap'}}>
              {OPTS_PRESETS.map(o => (
                <button key={o}
                  className={'btn sm '+(mountOpts===o?'primary':'')}
                  style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)'}}
                  onClick={()=>setMountOpts(o)}
                >{o}</button>
              ))}
            </div>
            {mountError && (
              <div style={{padding:'8px 12px',marginBottom:10,background:'oklch(0.5 0.18 25 / 0.12)',
                border:'1px solid var(--err)',borderRadius:6,color:'var(--err)',fontSize:'var(--fs-sm)'}}>
                {mountError}
              </div>
            )}
            <div className="row gap-sm">
              <button className="btn primary" onClick={doMount} disabled={mounting}>
                {mounting
                  ? <><span className="dot pulse" style={{display:'inline-block',marginRight:6}}/>Montowanie…</>
                  : <><Icon name="link" size={12}/> Zamontuj</>}
              </button>
              <button className="btn" onClick={()=>setMountTarget(null)}>Anuluj</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Zamontowane udziały NFS</div>
            <div className="card-sub">
              {mounts.length} aktywnych · mount -t nfs,nfs4
            </div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={loadMounts}>
              <Icon name="refresh" size={12}/>
            </button>
            <button className="btn sm" onClick={()=>setMountTarget({ip:'',hostname:'',export:''})}>
              <Icon name="plus" size={12}/> Ręczne montowanie
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'28px var(--pad-card)',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie…
          </div>
        ) : mounts.length === 0 ? (
          <div style={{padding:'28px var(--pad-card)',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            Brak zamontowanych udziałów NFS
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Serwer</th><th>Eksport</th><th>Punkt montowania</th>
                <th>Typ</th><th>Opcje</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {mounts.map(m => (
                <tr key={m.id}>
                  <td className="mono">{m.ip}</td>
                  <td className="mono dim">{m.export}</td>
                  <td className="mono">{m.mountPoint}</td>
                  <td><span className="chip">{m.fstype||'nfs4'}</span></td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)',maxWidth:160,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                    title={m.opts}>{m.opts.length > 30 ? m.opts.substring(0,30)+'…' : m.opts}</td>
                  <td>
                    <span className="badge ok"><span className="dot pulse"/>zamontowany</span>
                  </td>
                  <td>
                    <button className="btn sm danger" onClick={()=>doUmount(m)}>
                      <Icon name="close" size={11}/> Odmontuj
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

window.NfsServer = NfsServer;