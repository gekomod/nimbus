// ===== UPS / ViewPower — podłączone pod /api/ups/* =====

const UPS_STATUS_META = {
  "online":      { label: "ON-LINE",     color: "var(--ok)",   blurb: "Zasilanie z sieci · akumulator w gotowości" },
  "on-line":     { label: "ON-LINE",     color: "var(--ok)",   blurb: "Zasilanie z sieci · akumulator w gotowości" },
  "on_battery":  { label: "ON BATTERY",  color: "var(--err)",  blurb: "Brak zasilania sieciowego · praca z akumulatora" },
  "on-battery":  { label: "ON BATTERY",  color: "var(--err)",  blurb: "Brak zasilania sieciowego · praca z akumulatora" },
  "low_battery": { label: "LOW BATTERY", color: "var(--err)",  blurb: "Krytycznie niski poziom baterii!" },
  "bypass":      { label: "BYPASS",      color: "var(--warn)", blurb: "Tryb obejścia · brak ochrony" },
  "fault":       { label: "FAULT",       color: "var(--err)",  blurb: "Awaria UPS — wymagana interwencja" },
};

const UPS_EVT_META = {
  OK:   { color: "var(--ok)",   bg: "color-mix(in oklch, var(--ok) 14%, transparent)" },
  INFO: { color: "var(--accent)", bg: "color-mix(in oklch, var(--accent) 14%, transparent)" },
  WARN: { color: "var(--warn)", bg: "color-mix(in oklch, var(--warn) 14%, transparent)" },
  ERR:  { color: "var(--err)",  bg: "color-mix(in oklch, var(--err) 14%, transparent)" },
};

const UpsArcGauge = ({ value, max = 100, label, sub, color = "var(--accent)", size = 220, thickness = 14, suffix = "%" }) => {
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size - thickness;
  const len = Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const offset = len * (1 - pct);
  return (
    <svg width={size} height={size * 0.6 + 8} viewBox={`0 0 ${size} ${size * 0.6 + 8}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`gx-${label}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor={color} stopOpacity="0.6" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={`M ${thickness/2} ${cy} A ${r} ${r} 0 0 1 ${size - thickness/2} ${cy}`}
        fill="none" stroke="var(--bg-3)" strokeWidth={thickness} strokeLinecap="round"/>
      <path d={`M ${thickness/2} ${cy} A ${r} ${r} 0 0 1 ${size - thickness/2} ${cy}`}
        fill="none" stroke={`url(#gx-${label})`} strokeWidth={thickness} strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}/>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const a = Math.PI - t * Math.PI;
        const x1 = cx + (r - thickness/2 - 2) * Math.cos(a);
        const y1 = cy - (r - thickness/2 - 2) * Math.sin(a);
        const x2 = cx + (r + thickness/2 + 4) * Math.cos(a);
        const y2 = cy - (r + thickness/2 + 4) * Math.sin(a);
        return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg-dim)" strokeWidth="1" opacity={0.4}/>;
      })}
      <text x={cx} y={cy - 24} textAnchor="middle" fontSize="38" fontWeight="600" fontFamily="var(--font-mono)" fill="var(--fg)" letterSpacing="-0.02em">
        {Math.round(value)}<tspan fontSize="18" fill="var(--fg-dim)" dx="2">{suffix}</tspan>
      </text>
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">{label}</text>
      {sub && <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill="var(--fg-muted)" fontFamily="var(--font-mono)">{sub}</text>}
    </svg>
  );
};

const VStrip = ({ label, value, unit, min, max, ideal, warn }) => {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const idealPct = (ideal - min) / (max - min);
  const inWarn = value < warn[0] || value > warn[1];
  return (
    <div className="col" style={{ gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: inWarn ? "var(--warn)" : "var(--fg)" }}>
          {value.toFixed(1)} <span style={{ color: "var(--fg-dim)", fontSize: 11, fontWeight: 400 }}>{unit}</span>
        </span>
      </div>
      <div style={{ height: 6, background: "var(--bg-3)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${pct * 100}%`,
          background: inWarn ? "var(--warn)" : "var(--ok)", transition: "width 0.4s" }}/>
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `${idealPct * 100}%`, width: 2,
          background: "var(--accent)", opacity: 0.7 }}/>
      </div>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--fg-dim)" }}>
        <span>{min}</span><span>nom. {ideal}</span><span>{max}</span>
      </div>
    </div>
  );
};

const PowerFlow = ({ status, inputVoltage, loadW, ratedVA }) => {
  const onBattery = status === "on_battery" || status === "on-battery";
  return (
    <svg viewBox="0 0 520 110" style={{ width: "100%", height: 110, display: "block" }}>
      <g>
        <rect x="8" y="32" width="100" height="46" rx="8" fill="var(--bg-2)" stroke="var(--line)"/>
        <text x="58" y="50" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.06em">SIEĆ 230V</text>
        <text x="58" y="68" textAnchor="middle" fontSize="14" fill={onBattery ? "var(--err)" : "var(--ok)"} fontWeight="600" fontFamily="var(--font-mono)">
          {onBattery ? "BRAK" : `${(inputVoltage||0).toFixed(0)}V`}
        </text>
      </g>
      <line x1="108" y1="55" x2="206" y2="55" stroke={onBattery ? "var(--err)" : "var(--ok)"} strokeWidth="2" strokeDasharray={onBattery ? "4 4" : "0"}/>
      {!onBattery && <circle r="3" fill="var(--ok)"><animateMotion dur="1.4s" repeatCount="indefinite" path="M 108 55 L 206 55"/></circle>}
      <g>
        <rect x="206" y="20" width="108" height="70" rx="10" fill="var(--bg-2)" stroke="var(--accent)" strokeWidth="1.5"/>
        <text x="260" y="40" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.06em">UPS</text>
        <text x="260" y="62" textAnchor="middle" fontSize="18" fill="var(--accent)" fontWeight="600" fontFamily="var(--font-mono)">{ratedVA||600}VA</text>
        <text x="260" y="80" textAnchor="middle" fontSize="9" fill="var(--fg-muted)" fontFamily="var(--font-mono)">Megatec Q1</text>
      </g>
      <line x1="314" y1="55" x2="412" y2="55" stroke="var(--ok)" strokeWidth="2"/>
      <circle r="3" fill="var(--ok)"><animateMotion dur="1.4s" repeatCount="indefinite" path="M 314 55 L 412 55"/></circle>
      <g>
        <rect x="412" y="32" width="100" height="46" rx="8" fill="var(--bg-2)" stroke="var(--line)"/>
        <text x="462" y="50" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.06em">SERWER</text>
        <text x="462" y="68" textAnchor="middle" fontSize="14" fill="var(--ok)" fontWeight="600" fontFamily="var(--font-mono)">{Math.round(loadW||0)} W</text>
      </g>
    </svg>
  );
};

const UpsKpi = ({ status }) => {
  const meta = UPS_STATUS_META[status] || UPS_STATUS_META["online"];
  return (
    <div className="kpi" style={{ borderColor: `color-mix(in oklch, ${meta.color} 35%, var(--line))`, background: `linear-gradient(180deg, color-mix(in oklch, ${meta.color} 10%, var(--bg-1)), var(--bg-1))` }}>
      <div className="kpi-label">STATUS</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: meta.color,
          boxShadow: `0 0 0 3px color-mix(in oklch, ${meta.color} 30%, transparent), 0 0 12px ${meta.color}`,
          animation: (status === "online"||status==="on-line") ? "ups-pulse 2.4s ease-out infinite" : "none" }}/>
        <span style={{ fontSize: 17, fontWeight: 600, color: meta.color, letterSpacing: "-0.01em" }}>{meta.label}</span>
      </div>
      <div className="kpi-foot" style={{ marginTop: 6 }}><span>{meta.blurb}</span></div>
    </div>
  );
};

const PowerWalkerLogo = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
    <defs>
      <linearGradient id="ups-logo-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="oklch(0.7 0.16 245)"/>
        <stop offset="100%" stopColor="oklch(0.55 0.18 260)"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="12" fill="url(#ups-logo-g)"/>
    <path d="M 28 14 L 14 36 L 26 36 L 22 50 L 42 28 L 30 28 L 36 14 Z"
      fill="white" stroke="white" strokeLinejoin="round" strokeWidth="1.2"/>
  </svg>
);

const UPSScreen = () => {
  const [tab,      setTab]     = React.useState("overview");
  const [data,     setData]    = React.useState(null);
  const [info,     setInfo]    = React.useState(null);
  const [loading,  setLoading] = React.useState(true);
  const [cmdMsg,   setCmdMsg]  = React.useState('');
  const [running,  setRunning] = React.useState('');

  const load = async () => {
    try {
      const [statusRes, infoRes] = await Promise.all([
        fetch('/api/ups/status', { credentials:'include' }),
        fetch('/api/ups/info',   { credentials:'include' }),
      ]);
      const statusData = await statusRes.json();
      const infoData   = await infoRes.json();
      setData(statusData);
      setInfo(infoData);
    } catch(e) {}
    finally { setLoading(false); }
  };

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const sendCommand = async (cmd) => {
    setRunning(cmd); setCmdMsg('');
    try {
      const r = await fetch('/api/ups/command', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ command: cmd }),
      });
      const d = await r.json();
      setCmdMsg(d.status === 'ok' ? `✅ Komenda wykonana` : `❌ ${d.error}`);
      setTimeout(() => setCmdMsg(''), 4000);
    } catch(e) { setCmdMsg('❌ Błąd'); }
    finally { setRunning(''); }
  };

  if (loading) return (
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
        borderRadius:'50%',animation:'spin .6s linear infinite',margin:'0 auto 12px'}}/>
      Łączenie z UPS…
    </div>
  );

  const connected = data?.connected;
  const s = data?.status || {};
  const cfg = data?.config || {};
  const status = s.status || 'online';
  const meta = UPS_STATUS_META[status] || UPS_STATUS_META['online'];

  // Jeśli brak połączenia — pokaż panel konfiguracji
  if (!connected) return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card" style={{padding:40,textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:16,opacity:0.3}}>🔌</div>
        <div style={{fontWeight:600,fontSize:'var(--fs-lg)',marginBottom:8}}>Brak połączenia z UPS</div>
        <div style={{color:'var(--err)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',marginBottom:20}}>
          {data?.error}
        </div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:20}}>
          Port: <code>{cfg.port || '/dev/hidraw0'}</code> · Protokół: Megatec Q1 · USB HID (Cypress 0665:5161)
        </div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
          Sprawdź: <code>ls -la /dev/hidraw*</code>
        </div>
      </div>
    </div>
  );

  // Dane do wyświetlenia
  const battPct    = Math.round(s.battery_pct || 0);
  const loadPct    = Math.round(s.output_current_pct || 0);
  const loadW      = Math.round(s.load_watts || 0);
  const battV      = (s.battery_voltage || 0).toFixed(2);
  const inputV     = s.input_voltage   || 0;
  const outputV    = s.output_voltage  || 0;
  const inputFreq  = s.input_freq      || 0;
  const temperature= s.temperature     || 0;
  const runtimeMin = s.runtime_min     || 0;
  const ratedVA    = cfg.rated_va      || 600;
  const port       = cfg.port          || '/dev/hidraw0';

  const rawRows = [
    ["battery.charge",   `${battPct}`],
    ["battery.runtime",  `${runtimeMin * 60}`],
    ["battery.voltage",  `${battV}`],
    ["input.voltage",    `${inputV.toFixed(1)}`],
    ["input.frequency",  `${inputFreq.toFixed(1)}`],
    ["output.voltage",   `${outputV.toFixed(1)}`],
    ["output.current.pct",`${loadPct}`],
    ["ups.load",         `${loadPct}`],
    ["ups.realpower",    `${loadW}`],
    ["ups.realpower.nominal", `${Math.round(ratedVA * 0.8)}`],
    ["ups.status",       s.on_battery ? "OB DISCHRG" : "OL"],
    ["ups.temperature",  `${temperature.toFixed(1)}`],
    ["device.mfr",       info?.model || "ViewPower"],
    ["driver.port",      port],
    ["battery.status.raw", s.raw || ""],
  ];

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>

      {/* Header */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 18 }}>
        <PowerWalkerLogo/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em" }}>
              {info?.model || "UPS ViewPower"}
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
              Megatec Q1 · {port}
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12, color: "var(--fg-muted)", flexWrap: "wrap" }}>
            <span><span style={{ color: "var(--fg-dim)" }}>moc:</span> {ratedVA} VA / {Math.round(ratedVA*0.8)} W</span>
            <span><span style={{ color: "var(--fg-dim)" }}>bateria:</span> {battV} V</span>
            <span><span style={{ color: "var(--fg-dim)" }}>protokół:</span> <span className="mono">Megatec Q1 · USB HID</span></span>
            <span><span style={{ color: "var(--fg-dim)" }}>aktualizacja:</span> <span className="mono">{s.last_update}</span></span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Raw Q1</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg)", marginTop: 2, maxWidth: 200, wordBreak: "break-all" }}>{s.raw}</div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4">
        <UpsKpi status={status}/>
        <div className="kpi">
          <div className="kpi-label">AKUMULATOR</div>
          <div className="kpi-value">{battPct}<span style={{ fontSize: 14, color: "var(--fg-dim)", fontWeight: 400 }}>%</span></div>
          <div className="kpi-foot"><span>{battV} V</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">RUNTIME</div>
          <div className="kpi-value">{runtimeMin}<span style={{ fontSize: 14, color: "var(--fg-dim)", fontWeight: 400 }}> min</span></div>
          <div className="kpi-foot"><span>przy obciążeniu {loadPct}%</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">OBCIĄŻENIE</div>
          <div className="kpi-value">{loadW}<span style={{ fontSize: 14, color: "var(--fg-dim)", fontWeight: 400 }}> W</span></div>
          <div className="kpi-foot"><span>{loadPct}% pojemności{temperature>0?` · ${temperature.toFixed(1)}°C`:''}</span></div>
        </div>
      </div>

      {/* Gauges + Power flow */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr", gap: "var(--gutter)" }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="card-head" style={{ padding: 0, border: 0, marginBottom: 4 }}>
            <div><div className="card-title">Stan w czasie rzeczywistym</div><div className="card-sub">aktualizacja co 5 s</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
            <UpsArcGauge value={battPct} label="AKUMULATOR"
              sub={runtimeMin > 0 ? `${runtimeMin} min` : ''}
              color={battPct > 50 ? "var(--ok)" : battPct > 20 ? "var(--warn)" : "var(--err)"}/>
            <UpsArcGauge value={loadPct} label="OBCIĄŻENIE"
              sub={`${loadW} W`}
              color={loadPct > 80 ? "var(--err)" : loadPct > 60 ? "var(--warn)" : "var(--accent)"}/>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="card-head" style={{ padding: 0, border: 0, marginBottom: 14 }}>
            <div><div className="card-title">Topologia zasilania</div><div className="card-sub">przepływ mocy na żywo</div></div>
            <div className="card-actions">
              <span className="badge" style={{ background: meta.color, color: "var(--bg)" }}>{meta.label}</span>
            </div>
          </div>
          <PowerFlow status={status} inputVoltage={inputV} loadW={loadW} ratedVA={ratedVA}/>
          <div className="grid grid-2" style={{ marginTop: 14, gap: 18 }}>
            <VStrip label="WEJŚCIE"   value={inputV||0}    unit="V"  min={180} max={260} ideal={230} warn={[200,250]}/>
            <VStrip label="WYJŚCIE"   value={outputV||0}   unit="V"  min={210} max={240} ideal={230} warn={[220,240]}/>
            <VStrip label="CZĘST. WEJ" value={inputFreq||0} unit="Hz" min={48}  max={52}  ideal={50}  warn={[49,51]}/>
            <VStrip label="BATERIA"   value={s.battery_voltage||0} unit="V" min={10} max={30} ideal={27.4} warn={[21,29]}/>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="segmented">
        {[["overview","Szczegóły"],["commands","Komendy"],["flags","Bity statusu"],["raw","Raw Q1"]].map(([id,l]) => (
          <button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><div><div className="card-title">Informacje o urządzeniu</div><div className="card-sub">Megatec Q1 · USB HID</div></div></div>
            <div className="card-body col" style={{ gap: 8, fontSize: "var(--fs-sm)" }}>
              {[
                ["Model",        info?.model || "—"],
                ["Protokół",     "Megatec Q1"],
                ["Interfejs",    "USB HID (Cypress 0665:5161)"],
                ["Port",         port],
                ["Pojemność",    `${ratedVA} VA · ${Math.round(ratedVA*0.8)} W`],
                ["Napięcie bat.",battV + " V"],
                ["Temperatura",  temperature > 0 ? temperature.toFixed(1)+" °C" : "—"],
                ["Ostatni odczyt", s.last_update || "—"],
              ].map(([k,v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8 }}>
                  <span style={{ color: "var(--fg-dim)" }}>{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Szybkie akcje</div></div></div>
            <div className="card-body col" style={{ gap: 12 }}>
              {cmdMsg && (
                <div style={{padding:'8px 12px',borderRadius:6,fontSize:'var(--fs-sm)',
                  background: cmdMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 8%,transparent)' : 'color-mix(in oklch,var(--err) 8%,transparent)',
                  border: '1px solid ' + (cmdMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 25%,transparent)' : 'color-mix(in oklch,var(--err) 25%,transparent)'),
                }}>{cmdMsg}</div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" disabled={!!running} onClick={()=>sendCommand('test')}>
                  <Icon name="play" size={12}/> Test baterii (10s)
                </button>
                <button className="btn" disabled={!!running} onClick={()=>sendCommand('test_long')}>
                  <Icon name="play" size={12}/> Pełny test
                </button>
                <button className="btn" disabled={!!running} onClick={()=>sendCommand('beeper_toggle')}>
                  <Icon name="bell" size={12}/> Wycisz/włącz alarm
                </button>
                <button className="btn" disabled={!!running} onClick={()=>sendCommand('test_cancel')}>
                  <Icon name="close" size={12}/> Anuluj test
                </button>
                <button className="btn" disabled={!!running} onClick={()=>sendCommand('shutdown_cancel')}>
                  <Icon name="close" size={12}/> Anuluj shutdown
                </button>
                <button className="btn" style={{borderColor:'var(--err)',color:'var(--err)'}}
                  disabled={!!running} onClick={()=>sendCommand('shutdown_1min')}>
                  <Icon name="power" size={12}/> Wyłącz za 1 min
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "commands" && (
        <div className="grid grid-3">
          {[
            { id:'test',           label:'Test baterii',      desc:'10 sekund · sprawdza baterię',       color:'var(--ok)' },
            { id:'test_long',      label:'Pełny test',        desc:'Pełne rozładowanie i ładowanie',     color:'var(--warn)' },
            { id:'test_cancel',    label:'Anuluj test',       desc:'Przerywa aktywny test',              color:'var(--fg-dim)' },
            { id:'beeper_toggle',  label:'Wycisz/włącz',      desc:'Przełącz sygnał dźwiękowy',          color:'var(--accent)' },
            { id:'shutdown_1min',  label:'Wyłącz za 1 min',   desc:'Bezpieczne wyłączenie za 1 minutę',  color:'var(--err)' },
            { id:'shutdown_2min',  label:'Wyłącz za 2 min',   desc:'Bezpieczne wyłączenie za 2 minuty',  color:'var(--err)' },
            { id:'shutdown_5min',  label:'Wyłącz za 5 min',   desc:'Bezpieczne wyłączenie za 5 minut',   color:'var(--warn)' },
            { id:'shutdown_cancel','label':'Anuluj wyłączenie',desc:'Anuluje zaplanowane wyłączenie',     color:'var(--ok)' },
          ].map(cmd => (
            <div key={cmd.id} className="card" style={{padding:'16px'}}>
              <div style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:4,color:cmd.color}}>{cmd.label}</div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:12}}>{cmd.desc}</div>
              <button className="btn sm" style={{width:'100%',justifyContent:'center'}}
                disabled={!!running} onClick={()=>sendCommand(cmd.id)}>
                {running===cmd.id?'Wykonywanie…':'Wykonaj'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "flags" && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Bity statusu Q1</div><div className="card-sub">Raw: {s.raw}</div></div></div>
          <div style={{padding:'4px 0'}}>
            {[
              ["Brak zasilania AC",    s.utility_fail,    "var(--err)"],
              ["Niski poziom baterii", s.battery_low,     "var(--err)"],
              ["Aktywny bypass",       s.bypass_active,   "var(--warn)"],
              ["Awaria UPS",           s.ups_failed,      "var(--err)"],
              ["Test w toku",          s.test_in_progress,"var(--accent)"],
              ["Shutdown aktywny",     s.shutdown_active, "var(--err)"],
              ["Buzzer włączony",      s.beeper_on,       "var(--warn)"],
            ].map(([label, val, onColor], i) => (
              <div key={label} style={{display:'flex',alignItems:'center',gap:12,
                padding:'10px var(--pad-card)',borderTop:i>0?'1px solid var(--line)':'none'}}>
                <div style={{width:10,height:10,borderRadius:'50%',flexShrink:0,
                  background: val ? onColor : 'var(--bg-3)',
                  boxShadow: val ? `0 0 8px ${onColor}` : 'none'}}/>
                <span style={{flex:1,fontSize:'var(--fs-sm)'}}>{label}</span>
                <span style={{fontWeight:600,fontSize:'var(--fs-xs)',color:val?onColor:'var(--fg-dim)'}}>
                  {val?'TAK':'NIE'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "raw" && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Surowe dane Q1</div><div className="card-sub">format Megatec · odświeżane co 5s</div></div></div>
          <div style={{ padding:"12px 16px", fontFamily:"var(--font-mono)", fontSize:"var(--fs-xs)",
            color:"var(--fg-muted)", lineHeight:1.75, background:"var(--bg)" }}>
            {rawRows.map(([k,v]) => (
              <div key={k}><span style={{color:"var(--fg-dim)"}}>{k}:</span> {v}</div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes ups-pulse {
          0%   { box-shadow: 0 0 0 0  color-mix(in oklch, var(--ok) 50%, transparent), 0 0 12px var(--ok); }
          70%  { box-shadow: 0 0 0 8px color-mix(in oklch, var(--ok) 0%,  transparent), 0 0 12px var(--ok); }
          100% { box-shadow: 0 0 0 0  color-mix(in oklch, var(--ok) 0%,  transparent), 0 0 12px var(--ok); }
        }
      `}</style>
    </div>
  );
};

window.UPSScreen = UPSScreen;
