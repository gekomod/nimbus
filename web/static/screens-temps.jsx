// ===== Temperatura systemu — lm-sensors + i8k (API-driven) =====

const tempColor = (t, warn, crit) => {
  if (t >= crit)       return 'var(--err)';
  if (t >= warn)       return 'var(--warn)';
  if (t >= warn - 10)  return 'oklch(0.78 0.15 75)';
  return 'var(--ok)';
};

const TempBar = ({ temp, warn, crit, max }) => {
  const pct     = Math.min(100, (temp / max) * 100);
  const color   = tempColor(temp, warn, crit);
  const warnPct = (warn / max) * 100;
  const critPct = (crit / max) * 100;
  return (
    <div style={{ position:'relative', height:6, background:'var(--bg-3)', borderRadius:4, overflow:'hidden', flex:1 }}>
      <div style={{ position:'absolute', left:0, top:0, height:'100%', width:pct+'%',
        background:color, borderRadius:4, transition:'width .4s' }}/>
      <div style={{ position:'absolute', left:warnPct+'%', top:0, width:1, height:'100%', background:'oklch(0.78 0.15 75 / 0.5)' }}/>
      <div style={{ position:'absolute', left:critPct+'%', top:0, width:1, height:'100%', background:'var(--err)', opacity:0.5 }}/>
    </div>
  );
};

const MiniSparkTemp = ({ data, color }) => {
  if (!data || data.length < 2) return null;
  const w=120, h=30;
  const mn = Math.min(...data)-2, mx = Math.max(...data)+2;
  const range = mx - mn || 1;
  const pts = data.map((v,i) => {
    const x = (i/(data.length-1))*w;
    const y = h-((v-mn)/range)*(h-4)-2;
    if (!isFinite(x) || !isFinite(y)) return null;
    return `${x},${y}`;
  }).filter(Boolean);
  if (pts.length < 2) return null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width:120, height:30 }} preserveAspectRatio="none">
      <path d={`M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`} fill={color} opacity=".15"/>
      <path d={`M ${pts.join(' L ')}`} fill="none" stroke={color} strokeWidth="1.5"/>
    </svg>
  );
};

const SensorGroup = ({ title, sensors, icon }) => {
  if (!sensors || !sensors.length) return null;
  const hottest = sensors.reduce((a,b) => a.temp > b.temp ? a : b, sensors[0]);
  const anyWarn = sensors.some(s => s.temp >= s.warn);
  const anyCrit = sensors.some(s => s.temp >= s.crit);
  return (
    <div className="card">
      <div className="card-head">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'var(--bg-3)',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Icon name={icon} size={15} style={{ color: anyCrit?'var(--err)':anyWarn?'var(--warn)':'var(--accent)' }}/>
          </div>
          <div>
            <div className="card-title">{title}</div>
            <div className="card-sub">Najcieplej: <span style={{ fontFamily:'var(--font-mono)', color:tempColor(hottest.temp,hottest.warn,hottest.crit) }}>{hottest.temp.toFixed(1)}°C</span> · {hottest.label}</div>
          </div>
        </div>
        {anyCrit && <span className="badge err">KRYTYCZNY</span>}
        {!anyCrit && anyWarn && <span className="badge warn">OSTRZEŻENIE</span>}
      </div>
      <div style={{ padding:'0 0 4px' }}>
        {sensors.map(s => (
          <div key={s.label} style={{
            display:'grid', gridTemplateColumns:'110px 1fr 58px',
            alignItems:'center', gap:10,
            padding:'6px var(--pad-card)',
            borderTop:'1px solid var(--line)',
            background: s.temp >= s.crit ? 'oklch(0.66 0.2 25 / 0.05)' : s.temp >= s.warn ? 'oklch(0.78 0.15 75 / 0.04)' : '',
          }}>
            <div style={{ fontSize:'var(--fs-xs)', fontFamily:'var(--font-mono)', color:'var(--fg-muted)' }}>{s.label}</div>
            <TempBar temp={s.temp} warn={s.warn} crit={s.crit} max={s.crit+5}/>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)', fontWeight:600,
              color:tempColor(s.temp,s.warn,s.crit), textAlign:'right' }}>
              {s.temp.toFixed(1)}°C
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ===== Fan control (pełny UI z szablonu, podpięty pod API) =====

const FAN_STYLE = `
@keyframes fan-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
.fan-svg { animation: fan-spin linear infinite; transform-origin:50% 50%; }
.fan-stop { animation: none !important; }
@keyframes auto-shimmer { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
.auto-glow { animation: auto-shimmer 2.6s ease-in-out infinite; }
@keyframes auto-sweep {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.auto-banner-sweep {
  background: linear-gradient(90deg, transparent 0%,
    color-mix(in oklch, var(--accent) 30%, transparent) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: auto-sweep 3.5s linear infinite;
}
`;

const FAN_PRESETS = {
  silent:   { label:'Cichy',        icon:'🔇', desc:'Minimalne obroty · maks. komfort akustyczny', color:'oklch(0.7 0.15 230)' },
  balanced: { label:'Zbalansowany', icon:'⚖️', desc:'Wyważony hałas i chłodzenie · zalecane',     color:'oklch(0.7 0.15 160)' },
  turbo:    { label:'Turbo',        icon:'🚀', desc:'Maks. chłodzenie · wyższy hałas',             color:'oklch(0.75 0.18 50)' },
};

// Progi krzywej dla widgetu (spójne z backendem)
const PRESET_CURVE = {
  silent:   [[25,5],[40,10],[50,20],[65,50],[75,80],[85,100]],
  balanced: [[25,5],[40,15],[50,35],[60,55],[70,80],[85,100]],
  turbo:    [[25,15],[35,25],[45,50],[55,70],[65,90],[75,100]],
};

const FanGraphic = ({ rpm, size=80, color='var(--accent)', stopped=false, max=2200 }) => {
  const safeRpm = Math.max(1, rpm);
  const dur = stopped ? 0 : Math.max(0.22, 60 / Math.min(safeRpm, max));
  const blades = 7;
  const uid = `fan${size}${(color||'').replace(/\W/g,'')}`;
  return (
    <div style={{ position:'relative', width:size, height:size, display:'inline-block' }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ position:'absolute', inset:0 }}>
        <defs>
          <radialGradient id={`fan-bg-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="var(--bg)"/>
            <stop offset="80%"  stopColor="var(--bg-2)"/>
            <stop offset="100%" stopColor="var(--bg-3)"/>
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="96" height="96" rx="8" fill="var(--bg-2)" stroke="var(--line-strong)" strokeWidth="1"/>
        <circle cx="50" cy="50" r="47" fill={`url(#fan-bg-${uid})`} stroke="var(--line-strong)" strokeWidth="0.8"/>
        {[[10,10],[90,10],[10,90],[90,90]].map(([x,y],i)=>(
          <g key={i}>
            <circle cx={x} cy={y} r="3" fill="var(--bg-3)" stroke="var(--line-strong)" strokeWidth="0.5"/>
            <circle cx={x} cy={y} r="1.2" fill="var(--bg)"/>
          </g>
        ))}
      </svg>
      <svg width={size} height={size} viewBox="0 0 100 100"
        className={"fan-svg" + (stopped ? " fan-stop" : "")}
        style={{ position:'absolute', inset:0, animationDuration: dur+'s' }}>
        <defs>
          <linearGradient id={`fan-blade-${uid}`} x1="50%" y1="50%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.35"/>
            <stop offset="60%"  stopColor={color} stopOpacity="0.85"/>
            <stop offset="100%" stopColor={color} stopOpacity="0.55"/>
          </linearGradient>
        </defs>
        {Array.from({length:blades}).map((_,i) => (
          <g key={i} transform={`rotate(${(i/blades)*360} 50 50)`}>
            <path d="M 50 50 C 58 44 70 36 84 42 C 80 50 70 56 60 58 C 54 56 51 53 50 50 Z"
              fill={`url(#fan-blade-${uid})`} stroke={color} strokeWidth="0.5" strokeOpacity="0.7"/>
            <path d="M 53 49 C 62 43 72 38 82 43" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="0.6" strokeLinecap="round"/>
          </g>
        ))}
        <circle cx="50" cy="50" r="14" fill="var(--bg-1)" stroke={color} strokeWidth="0.8"/>
        <circle cx="50" cy="50" r="12" fill="var(--bg-2)" stroke="var(--line)" strokeWidth="0.5"/>
        <circle cx="50" cy="50" r="9"  fill={color} opacity="0.18"/>
        <circle cx="50" cy="50" r="2.5" fill={color}/>
        <circle cx="50" cy="50" r="0.9" fill="var(--bg)"/>
      </svg>
      {!stopped && rpm > 1200 && (
        <div style={{ position:'absolute', inset:6, borderRadius:'50%',
          background:`radial-gradient(circle, transparent 50%, color-mix(in oklch, ${color} 8%, transparent) 70%, transparent 80%)`,
          pointerEvents:'none' }}/>
      )}
    </div>
  );
};

const AutoModeBanner = ({ preset, avgRpm, hottest }) => {
  const p = FAN_PRESETS[preset] || FAN_PRESETS.balanced;
  return (
    <div style={{ position:'relative', overflow:'hidden', borderRadius:12,
      border:'1px solid color-mix(in oklch, var(--accent) 30%, var(--line))',
      background:'linear-gradient(135deg, color-mix(in oklch, var(--accent) 8%, var(--bg-1)) 0%, var(--bg-1) 100%)',
      padding:'18px 22px' }}>
      <div className="auto-banner-sweep" style={{ position:'absolute', inset:0, pointerEvents:'none' }}/>
      <div style={{ position:'relative', display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
        <div style={{ width:46, height:46, borderRadius:12, flexShrink:0,
          background:'color-mix(in oklch, var(--accent) 18%, var(--bg-2))',
          border:'1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
          display:'grid', placeItems:'center',
          boxShadow:'0 0 24px color-mix(in oklch, var(--accent) 25%, transparent)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="auto-glow">
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            <circle cx="12" cy="12" r="4"/>
          </svg>
        </div>
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
            <span style={{ fontSize:'var(--fs-xs)', textTransform:'uppercase', letterSpacing:'.08em', color:'var(--accent)', fontWeight:700 }}>Tryb automatyczny aktywny</span>
            <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10,
              background:'color-mix(in oklch, var(--accent) 18%, transparent)',
              color:'var(--accent)', fontWeight:600, letterSpacing:'.05em' }}>{p.label.toUpperCase()}</span>
          </div>
          <div style={{ fontSize:'var(--fs-base)', fontWeight:600, color:'var(--fg)', marginBottom:3 }}>
            Inteligentne sterowanie wentylatorami
          </div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-muted)', lineHeight:1.55 }}>
            Krzywa PWM z histerezą dopasowuje obroty do temperatur na bieżąco.
            Najcieplejszy: <b style={{ color:'var(--fg)' }}>{hottest?.label} {hottest?.temp?.toFixed(1)}°C</b>
            {avgRpm > 0 && <> · średnie obroty: <b style={{ color:'var(--fg)', fontFamily:'var(--font-mono)' }}>{Math.round(avgRpm)} RPM</b></>}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
          <FanGraphic rpm={1200} size={56} color="var(--accent)"/>
          <FanGraphic rpm={1800} size={42} color="var(--accent)"/>
        </div>
      </div>
    </div>
  );
};

const FanCard = ({ fan, index, autoMode, hwmonFans, onFansUpdate }) => {
  const [localPWM, setLocalPWM] = React.useState(fan.pwm ?? 128);
  const [changing,  setChanging]  = React.useState(false);

  React.useEffect(() => {
    if (fan.pwm != null) setLocalPWM(fan.pwm);
  }, [fan.pwm]);

  const pwmMax  = fan.pwm_max || 255;
  const pwmPct  = Math.round((localPWM / pwmMax) * 100);
  const rpm     = fan.rpm || 0;
  const mode    = fan.mode; // 1=manual,2=auto

  const pctColor = pwmPct > 80 ? 'var(--err)' : pwmPct > 50 ? 'var(--warn)' : pwmPct > 20 ? 'var(--ok)' : 'var(--fg-dim)';

  const applyPWM = async (val) => {
    if (autoMode) return;
    setChanging(true);
    try {
      // Używamy pwm_file (ścieżka /sys/.../pwmN) — stabilna identyfikacja
      // niezależna od kolejności wykrywania hwmon
      const body = fan.pwm_file
        ? { pwm_file: fan.pwm_file, pwm: val }
        : { fan: fan.index, pwm: val };
      const r = await fetch('/api/fans/control', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.fans) onFansUpdate && onFansUpdate(d.fans);
    } finally { setTimeout(() => setChanging(false), 400); }
  };

  const setPresetPWM = (val) => {
    setLocalPWM(val);
    applyPWM(val);
  };

  return (
    <div className="card" style={{ padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
        <FanGraphic rpm={rpm} size={58} color={pctColor} stopped={rpm === 0} max={fan.rpm_max || 4500}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:600, fontSize:'var(--fs-sm)', marginBottom:2 }}>{fan.label}</div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>{fan.loc}</div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)', fontFamily:'var(--font-mono)', marginTop:2 }}>
            {fan.hwmon_path?.replace('/sys/class/hwmon/','') || ''} · {fan.pwm_file?.split('/').pop() || ''}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:20, fontWeight:700, color:pctColor, lineHeight:1 }}>
            {rpm > 0 ? rpm.toLocaleString('pl') : '—'}
          </div>
          <div style={{ fontSize:9, color:'var(--fg-dim)', letterSpacing:'.08em', marginTop:2 }}>RPM</div>
        </div>
      </div>

      {/* Suwak PWM */}
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <span style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>PWM</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)', fontWeight:600, color:pctColor }}>
            {localPWM} / {pwmMax} <span style={{ color:'var(--fg-dim)', fontWeight:400 }}>({pwmPct}%)</span>
          </span>
        </div>
        <input type="range" min={fan.pwm_min || 0} max={pwmMax} value={localPWM}
          disabled={autoMode || changing}
          onChange={e => setLocalPWM(parseInt(e.target.value))}
          onMouseUp={e => applyPWM(parseInt(e.target.value))}
          onTouchEnd={e => applyPWM(parseInt(e.target.value))}
          style={{ width:'100%', accentColor:pctColor, cursor: autoMode ? 'not-allowed' : 'pointer' }}/>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:9,
          color:'var(--fg-dim)', fontFamily:'var(--font-mono)', marginTop:2 }}>
          <span>{fan.pwm_min || 0}</span>
          <span style={{ color:'var(--fg-dim)' }}>
            {mode === 2 ? '⚙ BIOS auto' : mode === 1 ? '✎ manual' : ''}
          </span>
          <span>{pwmMax}</span>
        </div>
      </div>

      {/* Szybkie presety PWM */}
      <div style={{ display:'flex', gap:5 }}>
        {[
          { label:'Stop',  val:0,   color:'var(--fg-dim)' },
          { label:'25%',   val:64,  color:'var(--ok)' },
          { label:'50%',   val:128, color:'var(--ok)' },
          { label:'75%',   val:192, color:'var(--warn)' },
          { label:'Max',   val:255, color:'var(--err)' },
        ].map(p => (
          <button key={p.val}
            disabled={autoMode || changing}
            onClick={() => setPresetPWM(p.val)}
            style={{
              flex:1, padding:'5px 2px', borderRadius:5, border:'1px solid',
              fontSize:10, fontFamily:'var(--font-mono)', cursor: autoMode ? 'not-allowed' : 'pointer',
              borderColor: localPWM === p.val ? p.color : 'var(--line-strong)',
              background: localPWM === p.val ? `color-mix(in oklch, ${p.color} 15%, var(--bg-2))` : 'var(--bg-2)',
              color: localPWM === p.val ? p.color : 'var(--fg-dim)',
              opacity: autoMode ? 0.5 : 1,
              transition:'all .15s',
            }}>{p.label}</button>
        ))}
      </div>
      {autoMode && (
        <div style={{ marginTop:6, fontSize:'var(--fs-xs)', color:'var(--accent)', textAlign:'center' }}>
          ⚙ Tryb automatyczny — wyłącz aby sterować ręcznie
        </div>
      )}
    </div>
  );
};
// Krzywa PWM dla presetu
const FanCurve = ({ preset, color='var(--accent)' }) => {
  const pts = PRESET_CURVE[preset] || PRESET_CURVE.balanced;
  const w=300, h=120, pl=28, pr=12, pt=10, pb=22;
  const x = t => pl + ((t-20)/(95-20))*(w-pl-pr);
  const y = p => h-pb - (p/100)*(h-pt-pb);
  const path = "M " + pts.map(([t,p]) => `${x(t)},${y(p)}`).join(" L ");
  const area = `${path} L ${x(pts[pts.length-1][0])},${h-pb} L ${x(pts[0][0])},${h-pb} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width:'100%', height:120 }}>
      {[0,25,50,75,100].map(p=>(
        <line key={p} x1={pl} x2={w-pr} y1={y(p)} y2={y(p)} stroke="var(--line)" strokeDasharray="2 4"/>
      ))}
      {pts.map(([t])=>(
        <text key={t} x={x(t)} y={h-6} fontSize="9" fill="var(--fg-dim)" textAnchor="middle" fontFamily="var(--font-mono)">{t}°</text>
      ))}
      {[0,50,100].map(p=>(
        <text key={p} x={pl-4} y={y(p)+3} fontSize="9" fill="var(--fg-dim)" textAnchor="end" fontFamily="var(--font-mono)">{p}%</text>
      ))}
      <path d={area} fill={color} opacity="0.15"/>
      <path d={path} fill="none" stroke={color} strokeWidth="2"/>
      {pts.map(([t,p],i)=>(
        <circle key={i} cx={x(t)} cy={y(p)} r="3" fill={color}/>
      ))}
    </svg>
  );
};

// ── FanControl — główny komponent zakładki Wentylatory ──────────────────────
const FanControl = ({ data, fans, setFans, autoMode, setAutoMode, i8kInstalled }) => {
  const [preset, setPreset] = React.useState('balanced');
  const [fanCfg, setFanCfg] = React.useState({
    zero_rpm: true, hyst: 5, night_mode: false, night_from: 22, night_to: 6, alert_tach: true, log_pwm: false,
  });
  const [saving, setSaving] = React.useState(false);

  // Wczytaj konfigurację z /api/fans/config przy montowaniu
  React.useEffect(() => {
    fetch('/api/fans/config', { credentials:'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setPreset(d.preset || 'balanced');
        setFanCfg({
          zero_rpm:   d.zero_rpm   ?? true,
          hyst:       d.hyst       > 0 ? d.hyst : 5,
          night_mode: d.night_mode ?? false,
          night_from: d.night_from ?? 22,
          night_to:   d.night_to   ?? 6,
          alert_tach: d.alert_tach ?? true,
          log_pwm:    d.log_pwm    ?? false,
        });
      })
      .catch(() => {});
  }, []);

  // saveCfgDirect — przyjmuje gotowy obiekt (omija problem zamrożonego closure)
  const saveCfgDirect = async (cfg) => {
    setSaving(true);
    const payload = {
      preset:     cfg.preset     || preset,
      zero_rpm:   cfg.zero_rpm   ?? true,
      hyst:       cfg.hyst > 0 ? cfg.hyst : 5,
      night_mode: cfg.night_mode ?? false,
      night_from: cfg.night_from ?? 22,
      night_to:   cfg.night_to   ?? 6,
      alert_tach: cfg.alert_tach ?? true,
      log_pwm:    cfg.log_pwm    ?? false,
    };
    try {
      await fetch('/api/fans/config', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      if (autoMode) {
        await fetch('/api/fans/auto', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ enable: true, preset: payload.preset }),
        });
      }
    } finally { setSaving(false); }
  };

  // saveCfg — wersja dla presetu (przekazuje override presetu)
  const saveCfg = async (overridePreset) => {
    saveCfgDirect({ ...fanCfg, preset: overridePreset || preset });
  };

  const toggleAuto = async () => {
    const next = !autoMode;
    setAutoMode(next);
    try {
      const r = await fetch('/api/fans/auto', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ enable: next, preset }),
      });
      const d = await r.json();
      if (d.auto !== undefined) setAutoMode(d.auto);
      if (d.preset) setPreset(d.preset);
    } catch { setAutoMode(!next); }
  };

  // Zmiana presetu — zapisuje od razu do backendu
  const switchPreset = async (key) => {
    setPreset(key);
    await saveCfg(key);
  };

  const activeRpm = fans.filter(f => f.rpm > 0);
  const avgRpm = activeRpm.length ? Math.round(activeRpm.reduce((s,f) => s + f.rpm, 0) / activeRpm.length) : 0;
  const maxRpmVal = fans.reduce((m,f) => Math.max(m, f.rpm||0), 0);

  // Hottest sensor do banera
  const allSensors = (data?.groups || []).flatMap(g => g.sensors || []).filter(s => s.temp > 0);
  const hottest = allSensors.length ? allSensors.reduce((a,b) => a.temp > b.temp ? a : b) : null;

  return (
    <div className="col" style={{ gap:'var(--gutter)' }}>
      <style>{FAN_STYLE}</style>

      {/* Baner trybu */}
      {autoMode
        ? <AutoModeBanner preset={preset} avgRpm={avgRpm} hottest={hottest}/>
        : (
          <div style={{ padding:'14px 18px', borderRadius:12,
            background:'oklch(0.78 0.15 75 / 0.08)', border:'1px solid oklch(0.78 0.15 75 / 0.3)',
            display:'flex', alignItems:'center', gap:14 }}>
            <Icon name="thermometer" size={20} style={{ color:'var(--warn)' }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:'var(--fs-sm)', marginBottom:2 }}>Tryb ręczny</div>
              <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-muted)' }}>
                Sterujesz wentylatorami ręcznie. Włącz tryb automatyczny aby system zarządzał chłodzeniem.
              </div>
            </div>
            <button className="btn primary" onClick={toggleAuto}>
              <Icon name="check" size={13}/> Włącz auto
            </button>
          </div>
        )
      }

      {/* Tryb pracy + presety + krzywa */}
      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Tryb pracy</div><div className="card-sub">Sterowanie automatyczne lub ręczne</div></div>
            <div className="card-actions">
              <span style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>{autoMode?'AUTO':'RĘCZNY'}</span>
              <div className={"toggle "+(autoMode?'on':'')} onClick={toggleAuto}/>
            </div>
          </div>
          <div className="card-body" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {Object.entries(FAN_PRESETS).map(([key,p]) => {
              const active = preset === key;
              return (
                <div key={key} onClick={() => switchPreset(key)}
                  style={{ padding:'14px', borderRadius:9, cursor:'pointer',
                    background: active ? `color-mix(in oklch, ${p.color} 14%, var(--bg-2))` : 'var(--bg-2)',
                    border: '1px solid ' + (active ? p.color : 'var(--line)'),
                    position:'relative', transition:'all .2s' }}>
                  <div style={{ fontSize:22, marginBottom:6 }}>{p.icon}</div>
                  <div style={{ fontWeight:600, fontSize:'var(--fs-sm)', marginBottom:3, color:active?p.color:'var(--fg)' }}>{p.label}</div>
                  <div style={{ fontSize:10, color:'var(--fg-muted)', lineHeight:1.4 }}>{p.desc}</div>
                  {active && <div style={{ position:'absolute', top:8, right:8, width:8, height:8, borderRadius:'50%', background:p.color, boxShadow:`0 0 8px ${p.color}` }}/>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Krzywa wentylatorów</div><div className="card-sub">PWM vs temperatura · profil {FAN_PRESETS[preset]?.label}</div></div>
          </div>
          <div style={{ padding:'10px var(--pad-card) 4px' }}>
            <FanCurve preset={preset} color={FAN_PRESETS[preset]?.color || 'var(--accent)'}/>
          </div>
        </div>
      </div>

      {/* KPI — tylko prawdziwe dane z API */}
      <div className="grid grid-3">
        <div className="kpi">
          <div className="kpi-label">WENTYLATORY</div>
          <div className="kpi-value">{fans.filter(f=>f.rpm>0).length}<span style={{color:'var(--fg-dim)',fontSize:14,fontWeight:400}}> / {fans.length}</span></div>
          <div className="kpi-foot"><span>{fans.filter(f=>f.rpm===0).length} zatrzymanych</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ŚREDNIE RPM</div>
          <div className="kpi-value">{avgRpm > 0 ? avgRpm.toLocaleString('pl') : '—'}</div>
          <div className="kpi-foot"><span>aktywne wentylatory</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">MAX RPM</div>
          <div className="kpi-value" style={{color: maxRpmVal > 3500 ? 'var(--err)' : maxRpmVal > 2000 ? 'var(--warn)' : 'var(--fg)'}}>
            {maxRpmVal > 0 ? maxRpmVal.toLocaleString('pl') : '—'}
          </div>
          <div className="kpi-foot"><span>najszybszy wentylator</span></div>
        </div>
      </div>

      {/* Karty wentylatorów */}
      {fans.length === 0 ? (
        <div className="card" style={{ padding:40, textAlign:'center', color:'var(--fg-dim)' }}>
          <Icon name="refresh" size={40} style={{ opacity:.2, display:'block', margin:'0 auto 16px' }}/>
          <div>Brak wykrytych wentylatorów</div>
          <div style={{ fontSize:'var(--fs-xs)', marginTop:8 }}>
            Zainstaluj i8kutils lub sprawdź: <code>modprobe dell-smm-hwmon</code>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Wentylatory</div><div className="card-sub">{fans.length} kanałów · sterowanie {autoMode?'automatyczne':'ręczne'}</div></div>
            <div className="card-actions">
              <button className="btn sm" onClick={async () => {
                const r = await fetch('/api/fans/control',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({fan:0,pwm:128})});
                // fan:0 = wszystkie wentylatory przez discoverHwmonFans()
                const d = await r.json();
                if (d.fans) setFans(d.fans);
              }}><Icon name="play" size={11}/> Uruchom (50%)</button>
            </div>
          </div>
          <div style={{ padding:'var(--pad-card)', display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }}>
            {fans.map((fan,i) => (
              <FanCard key={i} fan={fan} index={i}
                autoMode={autoMode}
                hwmonFans={data?.hwmon_fans}
                onFansUpdate={newFans => setFans(newFans)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Opcje dodatkowe */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Opcje termostatu</div>
            <div className="card-sub">{saving ? 'Zapisywanie…' : 'Zmiany zapisują się automatycznie'}</div>
          </div>
        </div>
        <div style={{ padding:'4px 0' }}>
          {[
            { key:'zero_rpm',    icon:'check', label:'Zero-RPM przy niskiej temp.',
              desc:'Wentylatory zatrzymują się gdy CPU < 40°C' },
            { key:'alert_tach', icon:'bell',  label:'Alarm przy awarii (tach=0)',
              desc:'Powiadomienie gdy wentylator nie raportuje RPM' },
            { key:'log_pwm',    icon:'log',   label:'Loguj zmiany PWM do syslog',
              desc:'Każda zmiana prędkości trafia do /var/log/syslog' },
            { key:'night_mode', icon:'clock', label:'Tryb nocny (22:00 – 06:00)',
              desc:'Wymusza profil "Cichy" w nocy niezależnie od obciążenia' },
          ].map((opt, i) => (
            <div key={opt.key} style={{ display:'flex', alignItems:'center', gap:12,
              padding:'10px var(--pad-card)', borderTop: i>0 ? '1px solid var(--line)' : 'none' }}>
              <Icon name={opt.icon} size={14} style={{ color: fanCfg[opt.key]?'var(--accent)':'var(--fg-dim)' }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:500, fontSize:'var(--fs-sm)' }}>{opt.label}</div>
                <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>{opt.desc}</div>
              </div>
              <div className={"toggle "+(fanCfg[opt.key]?'on':'')}
                onClick={() => {
                  const updated = {...fanCfg, [opt.key]: !fanCfg[opt.key]};
                  setFanCfg(updated);
                  saveCfgDirect(updated);
                }}/>
            </div>
          ))}
          <div style={{ padding:'10px var(--pad-card)', borderTop:'1px solid var(--line)', display:'flex', alignItems:'center', gap:16 }}>
            <Icon name="settings" size={14} style={{ color:'var(--fg-dim)' }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:500, fontSize:'var(--fs-sm)' }}>Hystereza temperatury</div>
              <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)' }}>Minimalna zmiana temp. przed korektą prędkości</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="range" min="1" max="15" value={fanCfg.hyst || 5}
                onChange={e => setFanCfg(c => ({...c, hyst: parseInt(e.target.value)}))}
                onMouseUp={e => saveCfgDirect({...fanCfg, hyst: parseInt(e.target.value)})}
                onTouchEnd={e => saveCfgDirect({...fanCfg, hyst: parseInt(e.target.value)})}
                style={{ width:80, accentColor:'var(--accent)' }}/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', minWidth:30 }}>{fanCfg.hyst || 5}°C</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── SystemTemps — główny komponent ────────────────────────────────────────────
const SystemTemps = () => {
  const [data,       setData]       = React.useState(null);
  const [loading,    setLoading]    = React.useState(true);
  const [tab,        setTab]        = React.useState('overview');
  const [cpuHist,    setCpuHist]    = React.useState([]);
  const [mbHist,     setMbHist]     = React.useState([]);
  const [fans,       setFans]       = React.useState([]);
  const [installing, setInstalling] = React.useState(false);
  const [autoMode,   setAutoMode]   = React.useState(false);
  const [disks,      setDisks]      = React.useState([]);

  const load = async () => {
    try {
      const r = await fetch('/api/temps', { credentials:'include' });
      if (!r.ok) return;
      const d = await r.json();
      setData(d);
      setFans(d.fans || []);
      if (d.history?.cpu?.length) setCpuHist(d.history.cpu);
      if (d.history?.mb?.length)  setMbHist(d.history.mb);
      if (d.auto_mode !== undefined) setAutoMode(d.auto_mode);
    } catch(e) {}
    finally { setLoading(false); }
  };

  const loadDisks = async () => {
    try {
      const r = await fetch('/api/storage/devices', { credentials:'include' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d || !d.devices) return;
      const mapped = d.devices
        .filter(dev => dev.type === 'disk' && dev.temp > 0)
        .map(dev => ({
          bay:   dev.bay,
          model: dev.model || '—',
          temp:  dev.temp  || 0,
          type:  dev.tran === 'nvme' ? 'NVMe' : dev.rota ? 'HDD' : 'SSD',
          warn:  dev.tran === 'nvme' ? 65 : 45,
          crit:  dev.tran === 'nvme' ? 80 : 60,
        }));
      setDisks(mapped);
      // Aktualizuj store żeby inne zakładki też miały świeże dane
      if (window.storeSet && d.devices) {
        const allDisks = d.devices.filter(dev => dev.type === 'disk');
        window.storeSet('DISKS', allDisks.map(dev => ({
          bay: dev.bay, model: dev.model||'—', serial: dev.serial||'—',
          size: dev.size||'—', pool: dev.pool||'—',
          type: dev.tran==='nvme'?'NVMe':dev.rota?'HDD':'SSD',
          temp: dev.temp||0, hours: dev.hours||0, smart: dev.smart||'ok',
          io: dev.io||0,
        })));
      }
    } catch(e) {}
  };

  React.useEffect(() => {
    load();
    loadDisks();
    const id = setInterval(load, 5000);
    const id2 = setInterval(loadDisks, 30000);
    return () => { clearInterval(id); clearInterval(id2); };
  }, []);

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/temps/install', { method:'POST', credentials:'include' });
      await load();
    } finally { setInstalling(false); }
  };

  const groups = data?.groups || [];
  const cpuGroups   = groups.filter(g => /core|coretemp|k10temp|cpu/i.test(g.name));
  const mbGroups    = groups.filter(g => /acpi|dell_smm|nct|it8|w83/i.test(g.name) && !/core/i.test(g.name));

  const allSensors  = groups.flatMap(g => g.sensors || []);
  const cpuSensors  = cpuGroups.flatMap(g => g.sensors || []).filter(s => s.temp > 0);
  const mbSensors   = mbGroups.flatMap(g => g.sensors || []).filter(s => s.temp > 0);

  const cpuMax  = cpuSensors.length ? Math.max(...cpuSensors.map(s => s.temp)) : 0;
  const mbMax   = mbSensors.length  ? Math.max(...mbSensors.map(s => s.temp))  : 0;
  const fanMax  = fans.length       ? Math.max(...fans.map(f => f.rpm))        : 0;
  const diskMax = disks.reduce((m,d) => Math.max(m, d.temp||0), 0);

  const anyAlert = allSensors.some(s => s.temp >= s.warn);
  const anyCrit  = allSensors.some(s => s.temp >= s.crit);

  if (loading) return (
    <div style={{ padding:60, textAlign:'center', color:'var(--fg-dim)' }}>
      <div style={{ width:18, height:18, border:'2px solid var(--line-strong)', borderTopColor:'var(--accent)',
        borderRadius:'50%', animation:'_spin .6s linear infinite', margin:'0 auto 12px' }}/>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)' }}>Odczyt czujników…</div>
    </div>
  );

  if (!data?.installed) return (
    <div className="card" style={{ padding:48, textAlign:'center' }}>
      <Icon name="thermometer" size={48} style={{ opacity:.2, display:'block', margin:'0 auto 20px' }}/>
      <div style={{ fontWeight:700, fontSize:'var(--fs-lg)', marginBottom:10 }}>lm-sensors nie jest zainstalowany</div>
      <div style={{ color:'var(--fg-muted)', fontSize:'var(--fs-sm)', maxWidth:520, margin:'0 auto 24px', lineHeight:1.7 }}>
        Aby odczytywać temperatury CPU, płyty głównej i sterować wentylatorami, zainstaluj:<br/>
        <code style={{ color:'var(--accent)' }}>lm-sensors</code> i <code style={{ color:'var(--accent)' }}>i8kutils</code>
      </div>
      <button className="btn primary" onClick={install} disabled={installing} style={{ padding:'9px 28px' }}>
        {installing ? 'Instalowanie…' : 'Zainstaluj lm-sensors + i8kutils'}
      </button>
    </div>
  );

  const TABS = [
    { id:'overview', label:'Mapa cieplna' },
    { id:'fans',     label:`Wentylatory (${fans.length})` },
    { id:'cpu',      label:'CPU' },
    { id:'mb',       label:'Płyta główna' },
    { id:'disks',    label:'Dyski' },
    { id:'history',  label:'Historia' },
  ];

  return (
    <div className="col" style={{ gap:'var(--gutter)' }}>
      {anyCrit && (
        <div style={{ padding:'10px 14px', background:'color-mix(in oklch,var(--err) 8%,transparent)',
          border:'1px solid color-mix(in oklch,var(--err) 25%,transparent)', borderRadius:8,
          display:'flex', alignItems:'center', gap:10, fontSize:'var(--fs-sm)' }}>
          <Icon name="thermometer" size={15} style={{ color:'var(--err)', flexShrink:0 }}/>
          <span>🔴 TEMPERATURA KRYTYCZNA! Sprawdź natychmiast wentylację i nakładkę termiczną.</span>
        </div>
      )}
      {!anyCrit && anyAlert && (
        <div style={{ padding:'10px 14px', background:'oklch(0.78 0.15 75 / 0.08)',
          border:'1px solid oklch(0.78 0.15 75 / 0.3)', borderRadius:8,
          display:'flex', alignItems:'center', gap:10, fontSize:'var(--fs-sm)' }}>
          <Icon name="thermometer" size={15} style={{ color:'var(--warn)', flexShrink:0 }}/>
          <span>Niektóre czujniki przekraczają próg ostrzeżenia. Sprawdź wentylację.</span>
        </div>
      )}

      <div className="grid grid-4">
        {[
          { label:'CPU',         val: cpuMax  ? cpuMax.toFixed(1)+'°C'  : '—', sub: cpuSensors.length+' czujników', color: cpuMax  ? tempColor(cpuMax, 75, 95)  : 'var(--fg-dim)', spark: cpuHist },
          { label:'PŁYTA GŁÓWNA',val: mbMax   ? mbMax.toFixed(1)+'°C'   : '—', sub: mbSensors.length+' czujników',  color: mbMax   ? tempColor(mbMax, 55, 85)   : 'var(--fg-dim)', spark: mbHist  },
          { label:'WENTYLATORY', val: fanMax  ? fanMax.toLocaleString('pl')+' RPM' : '—', sub: fans.length+' wentylatorów', color: fanMax > 3500 ? 'var(--err)' : 'var(--accent)', spark: null },
          { label:'DYSKI',       val: diskMax ? diskMax+'°C'            : '—', sub: 'SMART · HDD/SSD/NVMe',          color: diskMax ? tempColor(diskMax, 45, 60) : 'var(--fg-dim)', spark: null  },
        ].map(({ label, val, sub, color, spark }) => (
          <div key={label} className="kpi">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ color, fontSize:22 }}>{val}</div>
            <div className="kpi-foot">
              <span>{sub}</span>
              {spark && spark.length > 0 && <MiniSparkTemp data={spark} color={color}/>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
        <div className="segmented" style={{ flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="row gap-sm">
          <span className="badge dim" style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)' }}>
            <span className="dot pulse" style={{ background:'var(--ok)' }}/>
            lm-sensors · {data?.i8k_installed ? 'i8kutils ✓' : 'bez i8k'} · co 5s
          </span>
          <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
        </div>
      </div>

      {tab === 'overview' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Mapa cieplna systemu</div><div className="card-sub">Wszystkie czujniki · lm-sensors</div></div>
          </div>
          <div style={{ padding:'var(--pad-card)', display:'flex', flexWrap:'wrap', gap:8 }}>
            {allSensors.filter(s => s.temp > 0).map((s, i) => {
              const pct   = Math.min(1, (s.temp - 20) / ((s.crit||100) - 20));
              const color = tempColor(s.temp, s.warn||75, s.crit||100);
              return (
                <div key={i} style={{ padding:'8px 12px', borderRadius:8, minWidth:90,
                  background:`color-mix(in oklch, ${color} ${Math.round(pct*25+5)}%, var(--bg-2))`,
                  border:`1px solid color-mix(in oklch, ${color} 30%, var(--line-strong))` }}>
                  <div style={{ fontSize:10, color:'var(--fg-dim)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>{s.unit||'°C'}</div>
                  <div style={{ fontSize:'var(--fs-xs)', fontFamily:'var(--font-mono)', color:'var(--fg-muted)', marginBottom:2 }}>{s.label}</div>
                  <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--font-mono)', color }}>{s.temp.toFixed(1)}°C</div>
                </div>
              );
            })}
            {allSensors.filter(s => s.temp > 0).length === 0 && (
              <div style={{ color:'var(--fg-dim)', padding:'20px 0' }}>Brak odczytów czujników</div>
            )}
          </div>
        </div>
      )}

      {tab === 'fans' && (
        <FanControl
          data={data} fans={fans} setFans={setFans}
          autoMode={autoMode} setAutoMode={setAutoMode}
          i8kInstalled={data?.i8k_installed}
        />
      )}

      {tab === 'cpu' && <SensorGroup title="Procesor" sensors={cpuSensors} icon="thermometer"/>}
      {tab === 'mb'  && (
        <div className="col" style={{ gap:'var(--gutter)' }}>
          <SensorGroup title="Płyta główna / Ambient" sensors={mbSensors} icon="settings"/>
          {mbSensors.length === 0 && (
            <div className="card" style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
              Brak czujników płyty głównej (acpitz, dell_smm, nct*, w83*)
            </div>
          )}
        </div>
      )}

      {tab === 'disks' && (() => {
        const diskTemps = disks.filter(d => d.temp > 0).map(d => ({
          label: d.bay, model: d.model, temp: d.temp||0,
          warn: d.type==='NVMe' ? 65 : 45, crit: d.type==='NVMe' ? 80 : 60, type: d.type,
        }));
        return (
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Temperatura dysków</div><div className="card-sub">S.M.A.R.T. · {diskTemps.length} napędów</div></div>
            </div>
            {diskTemps.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
                Brak danych o temperaturze dysków
              </div>
            ) : (
              <table className="table">
                <thead><tr><th>Bay</th><th>Model</th><th>Typ</th><th style={{ width:220 }}>Temperatura</th><th>Warn</th><th>Crit</th><th>Status</th></tr></thead>
                <tbody>
                  {diskTemps.map(d => (
                    <tr key={d.label} style={{ background: d.temp>=d.crit?'oklch(0.66 0.2 25/0.05)':d.temp>=d.warn?'oklch(0.78 0.15 75/0.04)':'' }}>
                      <td className="mono" style={{ fontWeight:600 }}>{d.label}</td>
                      <td style={{ fontSize:'var(--fs-xs)', color:'var(--fg-muted)' }}>{d.model}</td>
                      <td><span className="chip">{d.type}</span></td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <TempBar temp={d.temp} warn={d.warn} crit={d.crit} max={d.crit+5}/>
                          <span className="mono" style={{ fontWeight:600, color:tempColor(d.temp,d.warn,d.crit), minWidth:46, textAlign:'right' }}>{d.temp}°C</span>
                        </div>
                      </td>
                      <td className="mono dim">{d.warn}°C</td>
                      <td className="mono dim">{d.crit}°C</td>
                      <td>{d.temp>=d.crit?<span className="badge err">KRYT.</span>:d.temp>=d.warn?<span className="badge warn">WARN</span>:<span className="badge ok">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {tab === 'history' && (() => {
        const series = [cpuHist, mbHist].filter(h => h.length > 0);
        const colors = ['var(--err)', 'var(--accent)'];
        const labels = ['CPU', 'Płyta główna'];
        if (!series.length) return (
          <div className="card" style={{ padding:40, textAlign:'center', color:'var(--fg-dim)' }}>
            Historia zbierana co 30s — wróć za chwilę
          </div>
        );
        const n = Math.max(...series.map(s => s.length));
        const all = series.flat();
        const mn = Math.floor(Math.min(...all) - 3);
        const mx = Math.ceil(Math.max(...all)  + 3);
        const range = mx - mn || 1;
        const W=800, H=220, pad=40;
        const x = (i, len) => pad + (i / (len-1)) * (W - pad*2);
        const y = v => H - pad - ((v-mn)/range) * (H-pad*2);
        const gridYs = [0.25,0.5,0.75,1].map(p => ({ v: Math.round(mn+p*range), y: H-pad-p*(H-pad*2) }));
        return (
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Historia temperatur</div><div className="card-sub">Próbkowanie co 30s · {n} próbek</div></div>
            </div>
            <div style={{ padding:'var(--pad-card)' }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:220 }} preserveAspectRatio="none">
                {gridYs.map(g => (
                  <g key={g.v}>
                    <line x1={pad} x2={W-pad} y1={g.y} y2={g.y} stroke="var(--line)" strokeDasharray="3 5"/>
                    <text x={pad-4} y={g.y+4} fontSize="10" fill="var(--fg-dim)" textAnchor="end" fontFamily="var(--font-mono)">{g.v}°</text>
                  </g>
                ))}
                {series.map((s, si) => {
                  const path = 'M ' + s.map((v,i) => `${x(i,s.length)},${y(v)}`).join(' L ');
                  const area = `M ${x(0,s.length)},${H-pad} L ${s.map((v,i)=>`${x(i,s.length)},${y(v)}`).join(' L ')} L ${x(s.length-1,s.length)},${H-pad} Z`;
                  return (
                    <g key={si}>
                      <path d={area} fill={colors[si]} opacity=".08"/>
                      <path d={path} fill="none" stroke={colors[si]} strokeWidth="2"/>
                    </g>
                  );
                })}
              </svg>
              <div style={{ display:'flex', gap:20, marginTop:10, flexWrap:'wrap' }}>
                {series.map((s, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:'var(--fs-xs)' }}>
                    <div style={{ width:24, height:3, borderRadius:2, background:colors[i] }}/>
                    <span style={{ color:'var(--fg-muted)' }}>{labels[i]}</span>
                    <span className="mono" style={{ color:colors[i] }}>{s[s.length-1]?.toFixed(1)}°C</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

window.SystemTemps = SystemTemps;
