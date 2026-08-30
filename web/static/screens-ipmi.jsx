// ===== IPMI / Czujniki — API-driven (/api/ipmi) =====
// Źródło danych: ipmitool (sensor list, mc info, lan print, chassis status,
// dcmi power reading, sdr type "Power Supply", sel elist) przez backend Go.

const Mini2 = ({ label, v, sub, color }) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{ color: color || 'var(--fg)' }}>{v}</div>
    {sub && <div className="kpi-foot"><span>{sub}</span></div>}
  </div>
);

const KV = ({ k, v }) => (
  <div className="row" style={{ justifyContent:'space-between', fontSize:'var(--fs-sm)' }}>
    <span className="dim">{k}</span>
    <span>{v}</span>
  </div>
);

const sevColor = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--err)' };

const sensorStatus = (s) => {
  if (s.unit === 'RPM') return s.val === 0 ? 'crit' : s.val < s.warn ? 'warn' : 'ok';
  if (s.unit === '°C')  return s.val >= s.crit ? 'crit' : s.val >= s.warn ? 'warn' : 'ok';
  // Napięcia/moc/prąd: porównuj po module — obsługuje też szyny ujemne (np. -12V),
  // gdzie proste "val >= crit" fałszywie zgłaszałoby awarię przy każdym odczycie.
  const av = Math.abs(s.val), ac = Math.abs(s.crit), aw = Math.abs(s.warn);
  return av >= ac ? 'crit' : av >= aw ? 'warn' : 'ok';
};

const SensorBar = ({ s }) => {
  const status = s.status || sensorStatus(s);
  const pct = Math.min(100, Math.max(0, (s.val / (s.max || 1)) * 100));
  return (
    <div style={{padding:'10px 14px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6}}>
      <div className="row" style={{justifyContent:'space-between',marginBottom:6}}>
        <span style={{fontSize:'var(--fs-sm)',fontWeight:500}}>{s.name}</span>
        <span className="mono" style={{fontSize:'var(--fs-sm)',color:sevColor[status]}}>{s.val}{s.unit==='°C'?'°C':s.unit==='V'?'V':s.unit==='W'?'W':s.unit==='A'?'A':' RPM'}</span>
      </div>
      <div className="bar" style={{background:'var(--bg-3)'}}>
        <i style={{width:pct+'%', background: status==='crit'?'var(--err)':status==='warn'?'var(--warn)':'var(--ok)'}}/>
      </div>
      <div className="row" style={{justifyContent:'space-between',marginTop:4,fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
        <span>0</span><span>próg {s.warn}{s.unit==='RPM'?'':s.unit}</span><span>{s.max}</span>
      </div>
    </div>
  );
};

// ── Stan gdy ipmitool niezainstalowany ────────────────────────────────────────
const IPMINotInstalled = ({ onInstall, installing }) => (
  <div className="card" style={{ padding:48, textAlign:'center' }}>
    <Icon name="cpu" size={48} style={{ opacity:.2, display:'block', margin:'0 auto 20px' }}/>
    <div style={{ fontWeight:700, fontSize:'var(--fs-lg)', marginBottom:10 }}>ipmitool nie jest zainstalowany</div>
    <div style={{ color:'var(--fg-muted)', fontSize:'var(--fs-sm)', maxWidth:520, margin:'0 auto 24px', lineHeight:1.7 }}>
      Aby odczytywać czujniki BMC, zasilanie i dziennik zdarzeń SEL, zainstaluj:<br/>
      <code style={{ color:'var(--accent)' }}>ipmitool</code>
    </div>
    <button className="btn primary" onClick={onInstall} disabled={installing} style={{ padding:'9px 28px' }}>
      {installing ? 'Instalowanie…' : 'Zainstaluj ipmitool'}
    </button>
  </div>
);

// ── Stan gdy ipmitool jest, ale brak fizycznego kontrolera BMC ───────────────
const IPMINoBMC = () => (
  <div className="card" style={{ padding:48, textAlign:'center' }}>
    <Icon name="cpu" size={48} style={{ opacity:.2, display:'block', margin:'0 auto 20px' }}/>
    <div style={{ fontWeight:700, fontSize:'var(--fs-lg)', marginBottom:10 }}>Nie wykryto kontrolera BMC</div>
    <div style={{ color:'var(--fg-muted)', fontSize:'var(--fs-sm)', maxWidth:560, margin:'0 auto 4px', lineHeight:1.7 }}>
      <code style={{ color:'var(--accent)' }}>ipmitool</code> jest zainstalowany, ale ten sprzęt nie zgłasza
      kontrolera IPMI/BMC (brak <code>/dev/ipmi0</code>). Ta zakładka dotyczy serwerów z dedykowanym
      chipem BMC (Dell iDRAC, HP iLO, Supermicro/ASRock Rack IPMI) — konsumenckie płyty główne
      zwykle go nie mają.
    </div>
  </div>
);

const IPMIUnreachable = ({ onRetry }) => (
  <div className="card" style={{ padding:48, textAlign:'center' }}>
    <Icon name="close" size={40} style={{ opacity:.25, display:'block', margin:'0 auto 20px', color:'var(--err)' }}/>
    <div style={{ fontWeight:700, fontSize:'var(--fs-lg)', marginBottom:10 }}>Brak odpowiedzi z /api/ipmi</div>
    <div style={{ color:'var(--fg-muted)', fontSize:'var(--fs-sm)', maxWidth:560, margin:'0 auto 20px', lineHeight:1.7 }}>
      To zwykle znaczy, że backend Nimbusa nie został przebudowany/zrestartowany po aktualizacji
      i stara binarka jeszcze nie zna tego endpointu. Na serwerze wykonaj:<br/>
      <code style={{ color:'var(--accent)' }}>make go</code> (lub <code style={{ color:'var(--accent)' }}>go build ./cmd/nimbus</code>),
      a następnie <code style={{ color:'var(--accent)' }}>systemctl restart nimbus</code>.
    </div>
    <button className="btn primary" onClick={onRetry} style={{ padding:'9px 28px' }}>Spróbuj ponownie</button>
  </div>
);

const IPMI = () => {
  const [data,       setData]       = React.useState(null);
  const [loading,    setLoading]    = React.useState(true);
  const [unreachable,setUnreachable]= React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [clearing,   setClearing]   = React.useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/ipmi', { credentials:'include' });
      if (!r.ok) { setUnreachable(true); return; }
      const d = await r.json();
      setData(d);
      setUnreachable(false);
    } catch (e) { setUnreachable(true); }
    finally { setLoading(false); }
  };

  React.useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/ipmi/install', { method:'POST', credentials:'include' });
      await load();
    } finally { setInstalling(false); }
  };

  const clearSEL = async () => {
    setClearing(true);
    try {
      const r = await fetch('/api/ipmi/sel/clear', { method:'POST', credentials:'include' });
      if (r.ok) {
        window.toast && window.toast.success('Dziennik SEL wyczyszczony');
        await load();
      } else {
        window.toast && window.toast.error('Nie udało się wyczyścić SEL');
      }
    } finally { setClearing(false); }
  };

  if (loading) return (
    <div style={{ padding:60, textAlign:'center', color:'var(--fg-dim)' }}>
      <div style={{ width:18, height:18, border:'2px solid var(--line-strong)', borderTopColor:'var(--accent)',
        borderRadius:'50%', animation:'_spin .6s linear infinite', margin:'0 auto 12px' }}/>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)' }}>Odczyt kontrolera BMC…</div>
    </div>
  );

  if (unreachable && !data) return <IPMIUnreachable onRetry={load}/>;
  if (!data?.installed) return <IPMINotInstalled onInstall={install} installing={installing}/>;
  if (!data?.bmc_present) return <IPMINoBMC/>;

  const I = data;
  const sensors = I.sensors || [];
  const temps = sensors.filter(s => s.unit === '°C');
  const fans  = sensors.filter(s => s.unit === 'RPM');
  const volts = sensors.filter(s => s.unit === 'V');
  const others = sensors.filter(s => s.unit !== '°C' && s.unit !== 'RPM' && s.unit !== 'V');
  const alarmable = sensors.filter(s => s.unit !== 'W' && s.unit !== 'A');
  const critCount = alarmable.filter(s => sensorStatus(s) === 'crit').length;
  const warnCount = alarmable.filter(s => sensorStatus(s) === 'warn').length;
  const events = I.events || [];

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <Mini2 label="STAN OGÓLNY" v={critCount>0?'AWARIA':warnCount>0?'UWAGA':'OK'} color={critCount>0?'var(--err)':warnCount>0?'var(--warn)':'var(--ok)'}/>
        <Mini2 label="POBÓR MOCY" v={I.power?.totalW ? I.power.totalW+' W' : '—'}/>
        <Mini2 label="ZASILACZE" v={[I.power?.psu1?.status, I.power?.psu2?.status].filter(s=>s && s!=='—').length + '/2 OK'} color="var(--ok)"/>
        <Mini2 label="LICZBA CZUJNIKÓW" v={sensors.length}/>
      </div>

      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Kontroler BMC</div><div className="card-sub">{I.bmc?.model}</div></div></div>
          <div className="card-body col" style={{gap:8}}>
            <KV k="Adres IP" v={<span className="mono">{I.bmc?.ip}</span>}/>
            <KV k="MAC" v={<span className="mono dim">{I.bmc?.mac}</span>}/>
            <KV k="Wersja firmware" v={<span className="mono">{I.bmc?.fw}</span>}/>
            <KV k="Protokoły" v={<span className="row gap-sm"><span className="chip accent">IPMI 2.0</span></span>}/>
            <hr className="div"/>
            <div className="row gap-sm">
              {I.bmc?.ip && I.bmc.ip !== '—' && (
                <button className="btn sm" onClick={() => window.open('https://'+I.bmc.ip, '_blank')}>Otwórz konsolę WebUI →</button>
              )}
              <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/> Odśwież</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Zasilanie</div></div>
          <div className="card-body col" style={{gap:10}}>
            <KV k="Stan systemu" v={<span className={"badge " + (I.power?.state==='ON'?'ok':'dim')}><span className="dot pulse"/>{I.power?.state || '—'}</span>}/>
            <div style={{padding:'8px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5}}>
              <div className="row" style={{justifyContent:'space-between'}}><span className="mono" style={{fontWeight:500}}>PSU 1</span><span className={"badge " + (I.power?.psu1?.status==='OK'?'ok':'dim')}>{I.power?.psu1?.status || '—'}</span></div>
              <div className="dim mono" style={{fontSize:11,marginTop:2}}>{I.power?.psu1?.in} → {I.power?.psu1?.out}</div>
            </div>
            <div style={{padding:'8px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5}}>
              <div className="row" style={{justifyContent:'space-between'}}><span className="mono" style={{fontWeight:500}}>PSU 2</span><span className={"badge " + (I.power?.psu2?.status==='OK'?'ok':'dim')}>{I.power?.psu2?.status || '—'}</span></div>
              <div className="dim mono" style={{fontSize:11,marginTop:2}}>{I.power?.psu2?.in} → {I.power?.psu2?.out}</div>
            </div>
          </div>
        </div>
      </div>

      {temps.length > 0 && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Temperatury</div><div className="card-sub">Czujniki BMC · {temps.length}</div></div></div>
          <div className="card-body grid" style={{gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            {temps.map((s,i) => <SensorBar key={i} s={s}/>)}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Obudowa i zdarzenia sprzętowe</div></div></div>
          <div className="card-body col" style={{gap:8}}>
            <KV k="Czujnik intruzji" v={<span className={"badge " + (I.chassis?.intrusion?.startsWith('OK')?'ok':'err')}>{I.chassis?.intrusion}</span>}/>
            <KV k="Panel przedni" v={<span className="badge ok">{I.chassis?.frontPanel}</span>}/>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Moc i prąd</div><div className="card-sub">czujniki BMC · W / A</div></div></div>
          <div className="card-body col" style={{gap:8}}>
            {others.length === 0 && (
              <div className="dim" style={{fontSize:'var(--fs-sm)'}}>Brak odczytów mocy/prądu</div>
            )}
            {others.map((s,i) => <KV key={i} k={s.name} v={<span className="mono">{s.val} {s.unit}</span>}/>)}
          </div>
        </div>
      </div>

      {fans.length > 0 && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Wentylatory</div><div className="card-sub">RPM na żywo (BMC)</div></div></div>
          <div className="card-body col" style={{gap:10}}>
            {fans.map((s,i) => <SensorBar key={i} s={s}/>)}
          </div>
        </div>
      )}

      {volts.length > 0 && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Napięcia</div><div className="card-sub">płyta główna</div></div></div>
          <div className="card-body col" style={{gap:10}}>
            {volts.map((s,i) => <SensorBar key={i} s={s}/>)}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div><div className="card-title">Dziennik zdarzeń SEL (System Event Log)</div>
          {typeof I.sel_entries === 'number' && I.sel_entries >= 0 && (
            <div className="card-sub">BMC zgłasza {I.sel_entries} wpisów w SEL</div>
          )}
        </div>
          <div className="card-actions">
            <button className="btn sm ghost" onClick={clearSEL} disabled={clearing}>
              {clearing ? 'Czyszczenie…' : 'Wyczyść SEL'}
            </button>
          </div>
        </div>
        <div className="card-body" style={{padding:0}}>
          {events.length === 0 && (!I.sel_raw || I.sel_raw.length === 0) && (
            <div style={{padding:'20px 18px',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak zdarzeń w dzienniku SEL</div>
          )}
          {events.length === 0 && I.sel_raw && I.sel_raw.length > 0 && (
            <div style={{padding:'14px 18px'}}>
              <div style={{color:'var(--warn)',fontSize:'var(--fs-sm)',marginBottom:8}}>
                BMC zgłasza {I.sel_entries} wpisów, ale format tego firmware różni się od zakładanego —
                pokazuję surowe linie zamiast rozpoznanych zdarzeń:
              </div>
              {I.sel_raw.map((l,i) => (
                <div key={i} className="mono dim" style={{fontSize:'var(--fs-xs)',padding:'3px 0',borderTop:i>0?'1px solid var(--line)':'none'}}>{l}</div>
              ))}
            </div>
          )}
          {events.map((e,i) => (
            <div key={i} className="row" style={{ padding:'8px 18px',borderBottom: i<events.length-1?'1px solid var(--line)':'none',gap:12,fontSize:'var(--fs-sm)' }}>
              <span className="mono dim" style={{width:130,flexShrink:0,fontSize:'var(--fs-xs)'}}>{e.t}</span>
              <span className={"badge " + (e.sev==='crit'?'err':e.sev==='warn'?'warn':'info')} style={{flexShrink:0}}>{e.sev.toUpperCase()}</span>
              <span style={{flex:1}}>{e.msg}</span>
              <span className="chip" style={{flexShrink:0}}>{e.src}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.IPMI = IPMI;
