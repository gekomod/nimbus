// screens-routers.jsx — Routery: Xiaomi BE6500, Cudy LT400, MikroTik, OpenWrt i inne
// API: GET/POST /api/routers · GET|PUT|DELETE /api/routers/{id}
//      GET /api/routers/{id}/status · GET /api/routers/{id}/clients
//      POST /api/routers/{id}/reboot · POST /api/routers/{id}/wifi
//      GET /api/routers/models

const Icon = window.Icon;

// ─── Katalog modeli (fallback jeśli API niedostępne) ────────────────────────
const RTR_MODELS_FALLBACK = [
  { id:'xiaomi_be6500',    brand:'Xiaomi',        name:'Xiaomi BE6500 (Wi-Fi 7)',          driver:'xiaomi',   notes:'MiWiFi API · hasło panelu 192.168.31.1' },
  { id:'xiaomi_be7000',    brand:'Xiaomi',        name:'Xiaomi BE7000 Pro (Wi-Fi 7)',       driver:'xiaomi',   notes:'MiWiFi API · te same endpointy co BE6500' },
  { id:'xiaomi_ax9000',    brand:'Xiaomi',        name:'Xiaomi AX9000 (Wi-Fi 6E)',          driver:'xiaomi',   notes:'MiWiFi API · tri-band' },
  { id:'xiaomi_ax6000',    brand:'Xiaomi',        name:'Xiaomi AX6000 (Wi-Fi 6E)',          driver:'xiaomi',   notes:'MiWiFi API' },
  { id:'xiaomi_ax3000',    brand:'Xiaomi',        name:'Xiaomi AX3000 (Wi-Fi 6)',           driver:'xiaomi',   notes:'MiWiFi API' },
  { id:'xiaomi_ax1800',    brand:'Xiaomi',        name:'Xiaomi AX1800 (Wi-Fi 6)',           driver:'xiaomi',   notes:'MiWiFi API' },
  { id:'redmi_ax5400',     brand:'Redmi',         name:'Redmi AX5400 (Wi-Fi 6)',            driver:'xiaomi',   notes:'MiWiFi API — ten sam protokół co Xiaomi' },
  { id:'xiaomi_4a_gig',    brand:'Xiaomi',        name:'Xiaomi 4A Gigabit',                 driver:'xiaomi',   notes:'MiWiFi API · starszy model' },
  { id:'xiaomi_generic',   brand:'Xiaomi/Redmi',  name:'Inny Xiaomi / Redmi (MiWiFi)',      driver:'xiaomi',   notes:'Działa z każdym routerem MiWiFi' },
  { id:'cudy_lt400',       brand:'Cudy',          name:'Cudy LT400 (5G CPE)',               driver:'openwrt',  notes:'ubus JSON-RPC · obsługa modemu 5G/LTE' },
  { id:'cudy_lt500',       brand:'Cudy',          name:'Cudy LT500 (5G CPE)',               driver:'openwrt',  notes:'ubus JSON-RPC' },
  { id:'cudy_lt1200',      brand:'Cudy',          name:'Cudy LT1200 (5G CPE)',              driver:'openwrt',  notes:'ubus JSON-RPC · wyższy zasięg' },
  { id:'cudy_x6',          brand:'Cudy',          name:'Cudy X6 (Wi-Fi 6 AX1800)',          driver:'openwrt',  notes:'ubus JSON-RPC' },
  { id:'cudy_wr3000',      brand:'Cudy',          name:'Cudy WR3000 (Wi-Fi 6 AX3000)',      driver:'openwrt',  notes:'ubus JSON-RPC' },
  { id:'cudy_generic',     brand:'Cudy',          name:'Inny router Cudy',                  driver:'openwrt',  notes:'Firmware Cudy oparty o OpenWrt' },
  { id:'openwrt_generic',  brand:'OpenWrt',       name:'Dowolny router OpenWrt / LuCI',     driver:'openwrt',  notes:'Wymaga rpcd + uhttpd (domyślnie włączone)' },
  { id:'glinet_generic',   brand:'GL.iNet',       name:'GL.iNet (wszystkie modele)',         driver:'openwrt',  notes:'GL.iNet używa OpenWrt — działa bez konfiguracji' },
  { id:'tplink_openwrt',   brand:'TP-Link',       name:'TP-Link (po instalacji OpenWrt)',    driver:'openwrt',  notes:'Oryginalny firmware TP-Link nie ma ubus API' },
  { id:'asus_openwrt',     brand:'ASUS',          name:'ASUS (Asuswrt-Merlin / OpenWrt)',    driver:'openwrt',  notes:'Merlin z ubus lub router po flashu OpenWrt' },
  { id:'netgear_openwrt',  brand:'Netgear',       name:'Netgear (po instalacji OpenWrt)',    driver:'openwrt',  notes:'Oryginalny firmware Netgear nie ma ubus API' },
  { id:'mikrotik_hap_ax3', brand:'MikroTik',      name:'MikroTik hAP ax3',                  driver:'mikrotik', notes:'RouterOS REST API · www-ssl port 443' },
  { id:'mikrotik_chateau', brand:'MikroTik',      name:'MikroTik Chateau',                  driver:'mikrotik', notes:'RouterOS REST API' },
  { id:'mikrotik_rb5009',  brand:'MikroTik',      name:'MikroTik RB5009',                   driver:'mikrotik', notes:'RouterOS REST API' },
  { id:'mikrotik_rb750gr3',brand:'MikroTik',      name:'MikroTik RB750Gr3 (hEX)',            driver:'mikrotik', notes:'RouterOS REST API · wymaga RouterOS ≥ 7.1' },
  { id:'mikrotik_ccr2004', brand:'MikroTik',      name:'MikroTik CCR2004',                  driver:'mikrotik', notes:'RouterOS REST API · router przemysłowy' },
  { id:'mikrotik_generic', brand:'MikroTik',      name:'Inny MikroTik (RouterOS 7+)',        driver:'mikrotik', notes:'Wymaga www/www-ssl + REST API w RouterOS ≥ 7.1' },
];

const DRIVER_GRADIENT = {
  xiaomi:   'linear-gradient(135deg, oklch(0.65 0.22 30), oklch(0.52 0.20 20))',
  openwrt:  'linear-gradient(135deg, oklch(0.55 0.20 255), oklch(0.42 0.18 240))',
  mikrotik: 'linear-gradient(135deg, oklch(0.55 0.22 12), oklch(0.42 0.20 5))',
};
const DRIVER_SHADOW = {
  xiaomi:   'color-mix(in oklch, oklch(0.65 0.22 30) 40%, transparent)',
  openwrt:  'color-mix(in oklch, oklch(0.55 0.20 255) 40%, transparent)',
  mikrotik: 'color-mix(in oklch, oklch(0.55 0.22 12) 40%, transparent)',
};
const DRIVER_LABEL = { xiaomi:'MiWiFi API', openwrt:'OpenWrt ubus', mikrotik:'RouterOS REST' };

function modelById(models, id) {
  return models.find(m => m.id === id) || { id, brand:'?', name:id, driver:'openwrt', notes:'' };
}

// ── Formatowanie ──────────────────────────────────────────────────────────────
function fmtUptime(sec) {
  if (!sec) return '—';
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtBytes(b) {
  if (!b) return '—';
  if (b >= 1e9) return (b/1e9).toFixed(1)+' GB/s';
  if (b >= 1e6) return (b/1e6).toFixed(1)+' MB/s';
  return Math.round(b/1024)+' kB/s';
}

// ── Badge statusu ─────────────────────────────────────────────────────────────
const RtrBadge = ({ status }) => {
  if (status === 'online')   return <span className="badge ok"><span className="dot pulse"/>ONLINE</span>;
  if (status === 'offline')  return <span className="badge"><span className="dot"/>OFFLINE</span>;
  if (status === 'checking') return <span className="badge warn"><span className="dot pulse"/>…</span>;
  return <span className="badge dim"><span className="dot"/>?</span>;
};

// ── Modal ─────────────────────────────────────────────────────────────────────
const RtrModal = ({ title, sub, onClose, width = 580, children, footer }) => (
  <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    style={{position:'fixed',inset:0,zIndex:900,display:'flex',alignItems:'center',justifyContent:'center',
      background:'rgba(0,0,0,.55)',backdropFilter:'blur(3px)'}}>
    <div style={{width,maxWidth:'96vw',maxHeight:'92vh',display:'flex',flexDirection:'column',
      background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:14,
      boxShadow:'0 32px 80px rgba(0,0,0,.6)',overflow:'hidden'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:'var(--fs-lg)'}}>{title}</div>
          {sub && <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',marginTop:2}}>{sub}</div>}
        </div>
        <button className="btn ghost icon-only" onClick={onClose}><Icon name="close" size={14}/></button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'20px'}}>{children}</div>
      {footer && <div style={{padding:'12px 20px',borderTop:'1px solid var(--line)',display:'flex',gap:8,justifyContent:'flex-end'}}>{footer}</div>}
    </div>
  </div>
);

// ── Shared input style ────────────────────────────────────────────────────────
const IS = {height:36,padding:'0 12px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
  borderRadius:7,color:'var(--fg)',fontSize:'var(--fs-base)',outline:'none',fontFamily:'var(--font-ui)',width:'100%',boxSizing:'border-box'};

const Field = ({ label, children, mono }) => (
  <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:14}}>
    <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',fontWeight:500,
      letterSpacing:'.05em',textTransform:'uppercase'}}>{label}</label>
    {children}
  </div>
);

// ── Pasek sygnału (CPE/LTE) ───────────────────────────────────────────────────
const SignalBars = ({ pct }) => {
  if (!pct) return null;
  return (
    <div style={{display:'flex',gap:2,alignItems:'flex-end',height:18}}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{width:5,height:4+i*2.5,borderRadius:1,
          background: pct >= i*20 ? 'var(--ok)' : 'var(--bg-3)'}}/>
      ))}
    </div>
  );
};

// ── Formularz dodawania / edycji routera ──────────────────────────────────────
const RouterForm = ({ initial, models, onSave, onClose }) => {
  const defModel = models[0] || RTR_MODELS_FALLBACK[0];
  const initModel = initial ? modelById(models, initial.model) : defModel;

  const [form, setF] = React.useState(initial || {
    name:'', model:defModel.id, host:'', port:80, use_https:false,
    username:'admin', password:'', notes:'',
  });
  const [busy, setBusy] = React.useState(false);
  const [err,  setErr]  = React.useState('');
  const [probing, setProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState(null);

  const set = (k, v) => setF(f => ({...f, [k]:v}));
  const curModel = modelById(models, form.model);

  const onModelChange = id => {
    const m = modelById(models, id);
    const isSSH    = m.driver === 'xiaomi_ssh';
    const isHttps  = m.driver === 'mikrotik';
    const port     = isSSH ? 22 : isHttps ? 443 : 80;
    const username = isSSH ? 'root' : 'admin';
    setF(f => ({...f, model:id, use_https: isHttps, port, username}));
  };

  const probeHost = async () => {
    if (!form.host) { setErr('Najpierw wpisz adres IP routera'); return; }
    setProbing(true); setProbeResult(null); setErr('');
    try {
      const r = await fetch('/api/routers/probe', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({host: form.host, driver: curModel.driver}),
      });
      const d = await r.json();
      setProbeResult(d);
      if (d.best_port) {
        setF(f => ({...f, port: d.best_port, use_https: d.best_https}));
      }
    } catch(e) { setErr('Skanowanie nieudane: ' + e.message); }
    setProbing(false);
  };

  const save = async () => {
    if (!form.host || !form.model) { setErr('Adres IP i model są wymagane'); return; }
    if (busy) return; // guard przed podwójnym kliknięciem
    setBusy(true); setErr('');
    try {
      const method = initial?.id ? 'PUT' : 'POST';
      const url    = initial?.id ? `/api/routers/${initial.id}` : '/api/routers';
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({...form, port: parseInt(form.port)||80}),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      if (d.status === 'exists') {
        setErr('Router z tym adresem IP i portem już istnieje na liście.');
        setBusy(false);
        return;
      }
      onSave({...form, id: d.id || initial?.id});
    } catch(e) { setErr('Błąd zapisu: ' + e.message); }
    finally { setBusy(false); }
  };

  // Pogrupuj modele wg marki
  const byBrand = {};
  models.forEach(m => { (byBrand[m.brand] = byBrand[m.brand]||[]).push(m); });

  return (
    <RtrModal
      title={initial?.id ? 'Edytuj router' : 'Dodaj router'}
      sub="Xiaomi MiWiFi · Cudy LT400 · MikroTik RouterOS · OpenWrt / LuCI"
      onClose={onClose} width={660}
      footer={<>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Zapisywanie…' : (initial?.id ? 'Zapisz zmiany' : 'Dodaj router')}
        </button>
      </>}
    >
      <Field label="Model routera">
        <select value={form.model} onChange={e => onModelChange(e.target.value)} style={IS}>
          {Object.entries(byBrand).map(([brand, ms]) => (
            <optgroup key={brand} label={brand}>
              {ms.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      {/* Info o sterowniku */}
      <div style={{padding:'9px 13px',marginBottom:14,
        background:'color-mix(in oklch,var(--accent) 6%,transparent)',
        border:'1px solid color-mix(in oklch,var(--accent) 18%,transparent)',
        borderRadius:8,fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.7}}>
        <strong style={{color:'var(--fg)'}}>
          {DRIVER_LABEL[curModel.driver] || curModel.driver}
        </strong> — {curModel.notes}
      </div>

      <Field label="Nazwa (opcjonalna)">
        <input value={form.name} onChange={e=>set('name',e.target.value)}
          placeholder={`np. ${curModel.brand} — salon`} style={IS}/>
      </Field>

      <div style={{display:'grid',gridTemplateColumns:'1fr 100px 90px',gap:12}}>
        <Field label="Adres IP / hostname">
          <input value={form.host} onChange={e=>set('host',e.target.value)} placeholder="192.168.31.1"
            style={{...IS,fontFamily:'var(--font-mono)'}}/>
        </Field>
        <Field label="Port">
          <input type="number" value={form.port} onChange={e=>set('port',e.target.value)}
            style={{...IS,fontFamily:'var(--font-mono)'}}/>
        </Field>
        <Field label="HTTPS">
          <select value={form.use_https?'1':'0'} onChange={e=>set('use_https',e.target.value==='1')} style={IS}>
            <option value="0">HTTP</option>
            <option value="1">HTTPS</option>
          </select>
        </Field>
      </div>

      {/* Przycisk Wykryj port */}
      <div style={{marginBottom:14}}>
        <button className="btn" onClick={probeHost} disabled={probing} style={{marginRight:8}}>
          <Icon name="refresh" size={12}/> {probing ? 'Skanowanie portów…' : 'Wykryj port automatycznie'}
        </button>
        <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
          Sprawdza porty 80, 8080, 443, 1234 w sieci lokalnej
        </span>
      </div>

      {/* Wynik probe */}
      {probeResult && (
        <div style={{marginBottom:14,padding:'10px 14px',borderRadius:8,
          background: probeResult.reachable_any
            ? 'color-mix(in oklch,var(--ok) 8%,transparent)'
            : 'color-mix(in oklch,var(--err) 8%,transparent)',
          border: `1px solid color-mix(in oklch,${probeResult.reachable_any ? 'var(--ok)' : 'var(--err)'} 25%,transparent)`
        }}>
          {probeResult.reachable_any ? (
            <div style={{fontSize:'var(--fs-sm)'}}>
              ✅ Router odpowiada na porcie <strong>{probeResult.best_port}</strong>
              {probeResult.best_https ? ' (HTTPS)' : ' (HTTP)'} — port został ustawiony automatycznie
            </div>
          ) : (
            <div style={{fontSize:'var(--fs-sm)'}}>
              <div style={{fontWeight:600,color:'var(--err)',marginBottom:8}}>
                ❌ Router nie odpowiada na żadnym porcie
              </div>
              <div style={{color:'var(--fg-muted)',lineHeight:1.8,fontSize:'var(--fs-xs)'}}>
                Możliwe przyczyny:<br/>
                • NAS i router są w <strong>różnych podsieciach</strong> — NAS musi być w sieci 192.168.31.x<br/>
                • Router ma <strong>inny adres IP</strong> — sprawdź w ustawieniach Wi-Fi telefonu<br/>
                • Firewall blokuje połączenia z NAS do routera<br/>
                • Router ma wyłączony panel WWW (API)
              </div>
            </div>
          )}
          <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
            {probeResult.results?.map(res => (
              <span key={res.port} style={{
                fontSize:10,padding:'2px 7px',borderRadius:4,
                background: res.reachable ? 'var(--ok)' : 'var(--bg-3)',
                color: res.reachable ? '#fff' : 'var(--fg-dim)',
              }}>
                :{res.port} {res.reachable ? '✓' : '✗'}
              </span>
            ))}
          </div>
        </div>
      )}

      {curModel.driver !== 'xiaomi' && (
        <Field label={curModel.driver === 'xiaomi_ssh' ? 'Login SSH (domyślnie: root)' : 'Login (użytkownik panelu)'}>
          <input value={form.username} onChange={e=>set('username',e.target.value)}
            placeholder={curModel.driver === 'xiaomi_ssh' ? 'root' : 'admin / root'} style={IS}/>
        </Field>
      )}

      <Field label={
        curModel.driver === 'xiaomi'     ? 'Hasło panelu MiWiFi (nie hasło Wi-Fi!)' :
        curModel.driver === 'xiaomi_ssh' ? 'Hasło SSH (to samo co panel WWW)' :
        'Hasło'
      }>
        <input type="password" value={form.password} onChange={e=>set('password',e.target.value)}
          placeholder="••••••••" style={IS}/>
      </Field>

      {curModel.driver === 'xiaomi_ssh' && (
        <div style={{padding:'9px 13px',marginBottom:14,
          background:'color-mix(in oklch,var(--ok) 6%,transparent)',
          border:'1px solid color-mix(in oklch,var(--ok) 20%,transparent)',
          borderRadius:8,fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.7}}>
          💡 <strong style={{color:'var(--fg)'}}>SSH zamiast HTTP</strong> — omija problemy z API routera.<br/>
          Port SSH: <code style={{background:'var(--bg-3)',padding:'0 4px',borderRadius:3}}>22</code>
          · Login: <code style={{background:'var(--bg-3)',padding:'0 4px',borderRadius:3}}>root</code>
          · Hasło: takie samo jak do panelu WWW 192.168.31.1
        </div>
      )}

      <Field label="Notatki">
        <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2}
          placeholder="Lokalizacja, opis…"
          style={{...IS,height:'auto',padding:'8px 12px',resize:'vertical'}}/>
      </Field>

      {err && <div style={{padding:'9px 13px',background:'color-mix(in oklch,var(--err) 12%,transparent)',
        border:'1px solid color-mix(in oklch,var(--err) 30%,transparent)',borderRadius:7,
        color:'var(--err)',fontSize:'var(--fs-sm)'}}>{err}</div>}
    </RtrModal>
  );
};

// ── Panel szczegółów: Status · Wi-Fi · Klienci ────────────────────────────────
const RouterDetail = ({ rtr, models, onClose }) => {
  const [tab,      setTab]      = React.useState('status');
  const [status,   setStatus]   = React.useState(null);
  const [clients,  setClients]  = React.useState(null);
  const [loading,  setLoading]  = React.useState(true);
  const [cloading, setCloading] = React.useState(false);
  const [cerr,     setCerr]     = React.useState('');
  const [rebootConfirm, setRebootConfirm] = React.useState(false);
  const [rebootBusy, setRebootBusy] = React.useState(false);
  const [wifiPending, setWifiPending] = React.useState({});

  const m = modelById(models, rtr.model);
  const grad = DRIVER_GRADIENT[m.driver] || DRIVER_GRADIENT.openwrt;

  const loadStatus = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/routers/${rtr.id}/status`, {credentials:'include'});
      setStatus(await r.json());
    } catch { setStatus({error:'Nie udało się pobrać statusu — sprawdź połączenie z routerem'}); }
    setLoading(false);
  };

  const loadClients = async () => {
    setCloading(true); setCerr('');
    try {
      const r = await fetch(`/api/routers/${rtr.id}/clients`, {credentials:'include'});
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setClients(d.clients || []);
    } catch(e) { setCerr(e.message || 'Pobranie klientów nieudane'); }
    setCloading(false);
  };

  React.useEffect(() => { loadStatus(); }, [rtr.id]);
  React.useEffect(() => { if (tab === 'clients' && clients === null) loadClients(); }, [tab]);

  const doReboot = async () => {
    setRebootBusy(true);
    try {
      const r = await fetch(`/api/routers/${rtr.id}/reboot`, {method:'POST',credentials:'include'});
      if (!r.ok) throw new Error(await r.text());
      setRebootConfirm(false);
      setTimeout(loadStatus, 3000);
    } catch(e) { alert('Restart nieudany: ' + e.message); }
    setRebootBusy(false);
  };

  const toggleWifi = async (radioId, currentlyEnabled) => {
    setWifiPending(p => ({...p, [radioId]:true}));
    try {
      await fetch(`/api/routers/${rtr.id}/wifi`, {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({radio: radioId, enabled: !currentlyEnabled}),
      });
      await loadStatus();
    } catch {}
    setWifiPending(p => ({...p, [radioId]:false}));
  };

  return (
    <RtrModal
      title={rtr.name || m.name}
      sub={`${m.brand} · ${DRIVER_LABEL[m.driver]||m.driver} · ${rtr.host}:${rtr.port}`}
      onClose={onClose} width={720}>

      <div className="segmented" style={{marginBottom:16}}>
        <button className={tab==='status'?'active':''} onClick={()=>setTab('status')}>📊 Status</button>
        <button className={tab==='wifi'?'active':''} onClick={()=>setTab('wifi')}>📶 Wi-Fi</button>
        <button className={tab==='clients'?'active':''} onClick={()=>setTab('clients')}>💻 Klienci</button>
      </div>

      {/* ── STATUS ─────────────────────────────────────────────────────────── */}
      {tab === 'status' && <>
        {loading && <div style={{textAlign:'center',padding:'52px 0',color:'var(--fg-dim)'}}>
          <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
            borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 14px'}}/>
          Łączenie z routerem…
        </div>}
        {!loading && status && <>
          {status.error && (
            <div style={{padding:'12px 16px',marginBottom:14,
              background:'color-mix(in oklch,var(--err) 8%,transparent)',
              border:'1px solid color-mix(in oklch,var(--err) 22%,transparent)',
              borderRadius:8}}>
              <div style={{fontWeight:600,color:'var(--err)',marginBottom:8,fontSize:'var(--fs-sm)'}}>
                ❌ {status.error.split('Sprawdź:')[0].split('1)')[0].trim()}
              </div>
              {(status.error.includes('timeout') || status.error.includes('deadline') || status.error.includes('brak połączenia') || status.error.includes('context')) && (
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:2,marginBottom:8}}>
                  <strong style={{color:'var(--fg)'}}>Lista kontrolna:</strong><br/>
                  □ NAS musi być w tej samej sieci co router (np. 192.168.31.x)<br/>
                  □ Sprawdź IP routera w telefonie: <em>Ustawienia Wi-Fi → router → Brama / Gateway</em><br/>
                  □ Port może być inny — edytuj router i kliknij <strong>"Wykryj port automatycznie"</strong><br/>
                  □ Panel routera musi być dostępny pod tym adresem z przeglądarki<br/>
                  □ Żaden firewall nie blokuje połączeń z NAS → router
                </div>
              )}
              {status.error.includes('hasło') && (
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.8}}>
                  Xiaomi: użyj hasła do <strong>panelu WWW</strong> (nie hasła Wi-Fi).<br/>
                  Otwórz 192.168.31.1 w przeglądarce i sprawdź czy to hasło działa.
                </div>
              )}
            </div>
          )}

          {/* Metryki */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:16}}>
            {[
              ['Stan',        status.online ? '✅ Online' : '❌ Offline'],
              ['Uptime',      fmtUptime(status.uptime_sec)],
              ['CPU',         status.cpu_load_pct ? status.cpu_load_pct.toFixed(1)+'%' : '—'],
              ['RAM',         status.mem_used_pct ? status.mem_used_pct.toFixed(0)+'%' : '—'],
              ['WAN IP',      status.wan_ip || '—'],
              ['WAN typ',     status.wan_type || (status.wan_connected ? 'połączony' : '—')],
              ['Klienci',     status.client_count ?? '—'],
              ['Firmware',    status.firmware ? status.firmware.slice(0,28) : '—'],
            ].map(([k,v]) => (
              <div key={k} className="card" style={{padding:'10px 12px'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',textTransform:'uppercase',
                  letterSpacing:'.04em',marginBottom:3}}>{k}</div>
                <div style={{fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)',wordBreak:'break-all'}}>{v}</div>
              </div>
            ))}
          </div>

          {/* CPE 5G/LTE sygnał */}
          {status.signal_pct > 0 && (
            <div className="card" style={{padding:'12px 16px',marginBottom:14,
              display:'flex',alignItems:'center',gap:14}}>
              <SignalBars pct={status.signal_pct}/>
              <div>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>
                  {status.signal_pct}% / {status.signal_dbm} dBm
                </div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
                  {status.network_type || 'komórkowy'} · CPE
                </div>
              </div>
            </div>
          )}

          {/* Akcje */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
            <button className="btn" onClick={loadStatus}><Icon name="refresh" size={12}/> Odśwież</button>
            {!rebootConfirm ? (
              <button className="btn danger" onClick={()=>setRebootConfirm(true)}>
                <Icon name="restart" size={12}/> Zrestartuj router
              </button>
            ) : <>
              <span style={{fontSize:'var(--fs-sm)',color:'var(--warn)',alignSelf:'center',fontWeight:500}}>
                ⚠ Na pewno zrestartować? Przerwa kilka sekund.
              </span>
              <button className="btn danger" disabled={rebootBusy} onClick={doReboot}>
                {rebootBusy ? 'Restartowanie…' : 'Tak, restartuj'}
              </button>
              <button className="btn" onClick={()=>setRebootConfirm(false)}>Anuluj</button>
            </>}
          </div>
        </>}
      </>}

      {/* ── WI-FI ──────────────────────────────────────────────────────────── */}
      {tab === 'wifi' && <>
        {loading && <div style={{textAlign:'center',padding:'40px 0',color:'var(--fg-dim)'}}>Ładowanie…</div>}
        {!loading && status && <>
          {(!status.wifi || status.wifi.length === 0) ? (
            <div style={{textAlign:'center',padding:'44px 0',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
              <Icon name="signal" size={36} style={{display:'block',margin:'0 auto 12px',opacity:.25}}/>
              Brak danych o sieciach Wi-Fi.<br/>
              <span style={{color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>Ten model / sterownik może nie raportować stanu radio.</span>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {status.wifi.map(radio => (
                <div key={radio.id} className="card" style={{padding:'14px 16px',
                  display:'flex',alignItems:'center',gap:14}}>
                  <div style={{width:38,height:38,borderRadius:9,flexShrink:0,
                    background: radio.enabled
                      ? 'color-mix(in oklch,var(--accent) 12%,var(--bg-3))'
                      : 'var(--bg-3)',
                    display:'grid',placeItems:'center',fontSize:18,
                    transition:'background .2s'}}>
                    📶
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>
                      {radio.band}
                      {radio.ssid && <span style={{color:'var(--fg-muted)',fontWeight:400}}> · {radio.ssid}</span>}
                    </div>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>
                      {radio.channel ? `Kanał ${radio.channel}` : 'Kanał: —'} · {radio.client_count || 0} klientów · ID: {radio.id}
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:'var(--fs-xs)',color: radio.enabled ? 'var(--ok)' : 'var(--fg-dim)'}}>
                      {radio.enabled ? 'Włączone' : 'Wyłączone'}
                    </span>
                    <button
                      className={`btn ${radio.enabled ? 'danger' : 'primary'} sm`}
                      disabled={wifiPending[radio.id]}
                      onClick={() => toggleWifi(radio.id, radio.enabled)}>
                      {wifiPending[radio.id] ? '…' : radio.enabled ? 'Wyłącz' : 'Włącz'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{marginTop:12}}>
            <button className="btn" onClick={loadStatus}><Icon name="refresh" size={12}/> Odśwież</button>
          </div>
        </>}
      </>}

      {/* ── KLIENCI ────────────────────────────────────────────────────────── */}
      {tab === 'clients' && <>
        {cloading && <div style={{textAlign:'center',padding:'40px 0',color:'var(--fg-dim)'}}>Ładowanie…</div>}
        {cerr && (
          <div style={{padding:'9px 13px',marginBottom:12,
            background:'color-mix(in oklch,var(--warn) 10%,transparent)',
            border:'1px solid color-mix(in oklch,var(--warn) 28%,transparent)',
            borderRadius:7,color:'var(--warn)',fontSize:'var(--fs-sm)'}}>
            ⚠ {cerr}
          </div>
        )}
        {!cloading && clients !== null && (
          clients.length === 0 ? (
            <div style={{textAlign:'center',padding:'44px 0',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
              <Icon name="users" size={36} style={{display:'block',margin:'0 auto 12px',opacity:.2}}/>
              Brak podłączonych klientów w liście DHCP
            </div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <div style={{marginBottom:8,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
                {clients.length} klientów
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'var(--fs-sm)'}}>
                <thead>
                  <tr style={{textAlign:'left',color:'var(--fg-dim)',fontSize:'var(--fs-xs)',textTransform:'uppercase'}}>
                    <th style={{padding:'5px 8px',borderBottom:'1px solid var(--line)'}}>Urządzenie</th>
                    <th style={{padding:'5px 8px',borderBottom:'1px solid var(--line)'}}>IP</th>
                    <th style={{padding:'5px 8px',borderBottom:'1px solid var(--line)'}}>MAC</th>
                    <th style={{padding:'5px 8px',borderBottom:'1px solid var(--line)'}}>Rx / Tx</th>
                    <th style={{padding:'5px 8px',borderBottom:'1px solid var(--line)'}}>Stan</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c,i) => (
                    <tr key={i} style={{borderBottom:'1px solid var(--line)'}}>
                      <td style={{padding:'7px 8px',fontWeight:500}}>{c.hostname||'—'}</td>
                      <td style={{padding:'7px 8px',fontFamily:'var(--font-mono)'}}>{c.ip||'—'}</td>
                      <td style={{padding:'7px 8px',fontFamily:'var(--font-mono)',color:'var(--fg-muted)',fontSize:'var(--fs-xs)'}}>{c.mac||'—'}</td>
                      <td style={{padding:'7px 8px',fontFamily:'var(--font-mono)',color:'var(--fg-muted)',fontSize:'var(--fs-xs)'}}>
                        {c.rx_bytes ? fmtBytes(c.rx_bytes) + ' / ' + fmtBytes(c.tx_bytes) : '—'}
                      </td>
                      <td style={{padding:'7px 8px'}}>
                        {c.online
                          ? <span className="badge ok" style={{fontSize:10}}>online</span>
                          : <span className="badge dim" style={{fontSize:10}}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        <button className="btn" style={{marginTop:12}} onClick={loadClients}>
          <Icon name="refresh" size={12}/> Odśwież listę
        </button>
      </>}
    </RtrModal>
  );
};

// ── Karta routera ─────────────────────────────────────────────────────────────
const RouterCard = ({ rtr, models, status, checking, onOpen, onEdit, onDelete, onCheck }) => {
  const m = modelById(models, rtr.model);
  const grad   = DRIVER_GRADIENT[m.driver] || DRIVER_GRADIENT.openwrt;
  const shadow = DRIVER_SHADOW[m.driver]   || DRIVER_SHADOW.openwrt;

  return (
    <div className="card" style={{transition:'box-shadow .18s'}}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.2)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = ''}>

      {/* Header */}
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--line)',
        display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:42,height:42,borderRadius:11,flexShrink:0,
          background:grad,display:'grid',placeItems:'center',
          boxShadow:`0 4px 14px ${shadow}`}}>
          <Icon name="router" size={20} style={{color:'#fff'}}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:'var(--fs-base)',
            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {rtr.name || m.name}
          </div>
          <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',marginTop:1}}>
            {m.brand} · {DRIVER_LABEL[m.driver]||m.driver}
          </div>
        </div>
        {checking
          ? <span className="badge warn"><span className="dot pulse"/>…</span>
          : <RtrBadge status={status}/>}
      </div>

      {/* Body */}
      <div style={{padding:'14px 16px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'5px 12px',marginBottom:12}}>
          {[
            ['Adres IP', rtr.host],
            ['Port / protokół', `${rtr.port} ${rtr.use_https ? 'HTTPS' : 'HTTP'}`],
            ['Model', m.name.split('(')[0].trim()],
            ['Sterownik', DRIVER_LABEL[m.driver]||m.driver],
          ].map(([k,v]) => (
            <div key={k}>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',textTransform:'uppercase',
                letterSpacing:'.04em',marginBottom:1}}>{k}</div>
              <div style={{fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</div>
            </div>
          ))}
        </div>

        {rtr.notes && (
          <div style={{padding:'5px 9px',marginBottom:10,background:'var(--bg-2)',
            borderRadius:6,fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.5}}>
            {rtr.notes}
          </div>
        )}

        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <button className="btn primary" style={{flex:1}} onClick={() => onOpen(rtr)}>
            <Icon name="grid" size={12}/> Otwórz panel
          </button>
          <button className="btn" title="Sprawdź dostępność" onClick={() => onCheck(rtr)}>
            <Icon name="refresh" size={12}/>
          </button>
          <button className="btn" title="Edytuj konfigurację" onClick={() => onEdit(rtr)}>
            <Icon name="settings" size={12}/>
          </button>
          <button className="btn danger" title="Usuń router" onClick={() => onDelete(rtr.id)}>
            <Icon name="close" size={12}/>
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Ekran główny ──────────────────────────────────────────────────────────────
const RouterManager = () => {
  const [models,   setModels]   = React.useState(RTR_MODELS_FALLBACK);
  const [routers,  setRouters]  = React.useState([]);
  const [statuses, setStatuses] = React.useState({});
  const [checking, setChecking] = React.useState({});
  const [loading,  setLoading]  = React.useState(true);
  const [addOpen,  setAddOpen]  = React.useState(false);
  const [editRtr,  setEditRtr]  = React.useState(null);
  const [openRtr,  setOpenRtr]  = React.useState(null);
  const [delId,    setDelId]    = React.useState(null);
  const [deduping, setDeduping] = React.useState(false);

  // Załaduj katalog modeli z serwera
  const loadModels = async () => {
    try {
      const r = await fetch('/api/routers/models', {credentials:'include'});
      if (r.ok) { const d = await r.json(); if (d.models?.length) setModels(d.models); }
    } catch {}
  };

  const loadRouters = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/routers', {credentials:'include'});
      const d = await r.json();
      const list = d.routers || [];
      setRouters(list);
      return list;
    } catch { setRouters([]); return []; }
    finally { setLoading(false); }
  };

  const checkOne = async rtr => {
    setChecking(c => ({...c, [rtr.id]:true}));
    try {
      const r = await fetch(`/api/routers/${rtr.id}/test`, {credentials:'include'});
      const d = await r.json();
      setStatuses(s => ({...s, [rtr.id]: d.reachable ? 'online' : 'offline'}));
    } catch { setStatuses(s => ({...s, [rtr.id]:'offline'})); }
    setChecking(c => ({...c, [rtr.id]:false}));
  };

  const checkAll = list => (list||routers).forEach(checkOne);

  React.useEffect(() => {
    loadModels();
    loadRouters().then(list => checkAll(list));
  }, []);

  // Nasłuchuj eventów z toolbar — [] żeby nie re-rejestrować przy każdej zmianie listy
  React.useEffect(() => {
    const onAdd     = () => setAddOpen(true);
    const onRefresh = () => loadRouters().then(list => checkAll(list));
    document.addEventListener('nimbus:add-router', onAdd);
    document.addEventListener('nimbus:refresh-routers', onRefresh);
    return () => {
      document.removeEventListener('nimbus:add-router', onAdd);
      document.removeEventListener('nimbus:refresh-routers', onRefresh);
    };
  }, []);

  const handleSaved = () => {
    setAddOpen(false); setEditRtr(null);
    loadRouters().then(checkAll);
  };

  const handleDelete = async id => {
    try { await fetch(`/api/routers/${id}`, {method:'DELETE',credentials:'include'}); } catch {}
    setDelId(null);
    setRouters(r => r.filter(x => x.id !== id));
    setStatuses(s => { const n={...s}; delete n[id]; return n; });
  };

  const dedup = async () => {
    setDeduping(true);
    try {
      const r = await fetch('/api/routers/dedup', {method:'POST', credentials:'include'});
      const d = await r.json();
      if (d.removed > 0) await loadRouters();
    } catch {}
    setDeduping(false);
  };

  const onlineCount = Object.values(statuses).filter(s => s === 'online').length;

  return (
    <div>
      {/* Info bar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>
          {routers.length} {routers.length===1?'router':'routerów'} · {onlineCount} online
        </div>
        <div style={{display:'flex',gap:8}}>
          {routers.length > 1 && (
            <button className="btn" onClick={dedup} disabled={deduping} title="Usuń duplikaty routerów">
              {deduping ? '…' : '🧹 Usuń duplikaty'}
            </button>
          )}
          <button className="btn" onClick={() => loadRouters().then(list => checkAll(list))}>
            <Icon name="refresh" size={12}/> Odśwież statusy
          </button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={12}/> Dodaj router
          </button>
        </div>
      </div>

      {/* Spinner */}
      {loading && (
        <div style={{textAlign:'center',padding:'72px 0',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
          <div style={{width:20,height:20,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
            borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 14px'}}/>
          Ładowanie routerów…
        </div>
      )}

      {/* Empty state */}
      {!loading && routers.length === 0 && (
        <div style={{textAlign:'center',padding:'80px 0',color:'var(--fg-dim)'}}>
          <Icon name="router" size={52} style={{opacity:.15,display:'block',margin:'0 auto 18px'}}/>
          <div style={{fontSize:'var(--fs-lg)',fontWeight:600,marginBottom:8}}>Brak routerów</div>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',marginBottom:24,lineHeight:1.6}}>
            Dodaj Xiaomi BE6500, Cudy LT400, MikroTik lub inny router<br/>
            i zarządzaj nim bezpośrednio z panelu Nimbus
          </div>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={12}/> Dodaj pierwszy router
          </button>
        </div>
      )}

      {/* Grid kart */}
      {!loading && routers.length > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14}}>
          {routers.map(rtr => (
            <RouterCard key={rtr.id}
              rtr={rtr} models={models}
              status={statuses[rtr.id]}
              checking={checking[rtr.id]}
              onOpen={setOpenRtr}
              onEdit={setEditRtr}
              onDelete={setDelId}
              onCheck={checkOne}/>
          ))}
        </div>
      )}

      {/* Modals */}
      {addOpen && <RouterForm models={models} onSave={handleSaved} onClose={() => setAddOpen(false)}/>}
      {editRtr && <RouterForm models={models} initial={editRtr} onSave={handleSaved} onClose={() => setEditRtr(null)}/>}
      {openRtr && <RouterDetail rtr={openRtr} models={models} onClose={() => setOpenRtr(null)}/>}

      {/* Potwierdzenie usunięcia */}
      {delId && (
        <RtrModal title="Usuń router" sub="Operacja nieodwracalna" onClose={() => setDelId(null)} width={420}
          footer={<>
            <button className="btn" onClick={() => setDelId(null)}>Anuluj</button>
            <button className="btn danger" onClick={() => handleDelete(delId)}>Usuń router</button>
          </>}>
          <p style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',lineHeight:1.7}}>
            Czy na pewno chcesz usunąć router{' '}
            <strong style={{color:'var(--fg)'}}>{routers.find(r => r.id===delId)?.name || delId}</strong>?
            <br/>Konfiguracja połączenia zostanie trwale usunięta.
          </p>
        </RtrModal>
      )}
    </div>
  );
};

window.RouterManager = RouterManager;
