// ===== Temperatura systemu — lm-sensors + i8k =====

const tempColor = (t, warn, crit) => {
  if (t >= crit)      return 'var(--err)';
  if (t >= warn)      return 'var(--warn)';
  if (t >= warn - 10) return 'oklch(0.78 0.15 75)';
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
  if (!data || !data.length) return null;
  const w=120, h=30;
  const mn = Math.min(...data)-2, mx = Math.max(...data)+2;
  const range = mx - mn || 1;
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h-((v-mn)/range)*(h-4)-2}`);
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

// ── Animowany wentylator SVG ──────────────────────────────────────────────────
const FanSVG = ({ rpm, size=80 }) => {
  const maxRPM = 4500;
  const pct = Math.min(1, rpm / maxRPM);
  // Prędkość animacji: wolniej = więcej sekund na obrót
  const duration = rpm > 0 ? Math.max(0.2, 3 - pct * 2.8) : 0;
  const color = rpm > 3000 ? 'var(--err)' : rpm > 1500 ? 'var(--warn)' : 'var(--accent)';

  return (
    <div style={{ width:size, height:size, display:'grid', placeItems:'center', position:'relative' }}>
      {/* Pierścień tła */}
      <div style={{
        position:'absolute', inset:4,
        borderRadius:'50%',
        background:`conic-gradient(${color} ${Math.round(pct*100)}%, var(--bg-3) 0)`,
        opacity:0.3,
      }}/>
      <svg width={size} height={size} viewBox="0 0 80 80">
        {/* Obrotowe łopaty */}
        <g transform="translate(40,40)"
          style={{ transformOrigin:'0 0', animation: rpm > 0 ? `_spin ${duration}s linear infinite` : 'none' }}>
          {[0, 90, 180, 270].map(angle => (
            <g key={angle} transform={`rotate(${angle})`}>
              <ellipse cx={0} cy={-18} rx={8} ry={14} fill={color} opacity={0.85}/>
            </g>
          ))}
          {/* Środek */}
          <circle cx={0} cy={0} r={7} fill="var(--bg-2)" stroke={color} strokeWidth={2}/>
          <circle cx={0} cy={0} r={3} fill={color}/>
        </g>
      </svg>
    </div>
  );
};

// ── Karta wentylatora ─────────────────────────────────────────────────────────
const FanCard = ({ fan, index, i8kInstalled, autoMode, onSpeedChange }) => {
  const [changing, setChanging] = React.useState(false);

  const SPEED_LABELS = ['Wyłączony', 'Wolny', 'Szybki', 'Maksymalny'];
  const SPEED_COLORS = ['var(--fg-dim)', 'var(--ok)', 'var(--warn)', 'var(--err)'];

  const pct = fan.max > 0 ? Math.round((fan.rpm / fan.max) * 100) : 0;

  const setSpeed = async (speed) => {
    if (!i8kInstalled) return;
    setChanging(true);
    try {
      await fetch('/api/fans/control', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fan: index + 1, speed }),
      });
      onSpeedChange && onSpeedChange(index, speed);
    } finally {
      setTimeout(() => setChanging(false), 1000);
    }
  };

  return (
    <div className="card" style={{ padding:20 }}>
      <div style={{ display:'flex', gap:16, alignItems:'center', marginBottom:16 }}>
        {/* Animowany wentylator */}
        <FanSVG rpm={fan.rpm} size={72}/>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, fontSize:'var(--fs-base)', marginBottom:4 }}>{fan.name}</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:700,
              color: fan.rpm > 3500 ? 'var(--err)' : fan.rpm > 2000 ? 'var(--warn)' : 'var(--fg)' }}>
              {fan.rpm.toLocaleString('pl')}
            </span>
            <span style={{ color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>RPM</span>
          </div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)', fontFamily:'var(--font-mono)' }}>
            {fan.min} – {fan.max || 4500} RPM · {pct}%
          </div>
        </div>
      </div>

      {/* Pasek prędkości */}
      <div style={{ marginBottom:12 }}>
        <div style={{ height:8, background:'var(--bg-3)', borderRadius:4, overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:4,
            width: pct + '%',
            background: pct > 80 ? 'var(--err)' : pct > 50 ? 'var(--warn)' : 'var(--accent)',
            transition:'width .5s ease-out',
          }}/>
        </div>
      </div>

      {/* Sterowanie i8k */}
      {i8kInstalled ? (
        <div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)', marginBottom:8 }}>
            Sterowanie prędkością (i8kctl):
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {SPEED_LABELS.map((label, i) => (
              <button key={i}
                disabled={changing || autoMode}
                title={autoMode ? "Wyłącz tryb automatyczny żeby sterować ręcznie" : ""}
                onClick={() => setSpeed(i)}
                style={{
                  flex:1, padding:'6px 4px', borderRadius:6, border:'1px solid',
                  fontSize:'var(--fs-xs)', cursor:'pointer', fontFamily:'var(--font-mono)',
                  borderColor: fan.speed === i ? SPEED_COLORS[i] : 'var(--line-strong)',
                  background: fan.speed === i ? `color-mix(in oklch, ${SPEED_COLORS[i]} 15%, var(--bg-2))` : 'var(--bg-2)',
                  color: fan.speed === i ? SPEED_COLORS[i] : 'var(--fg-dim)',
                  transition:'all .15s',
                  opacity: changing ? 0.5 : 1,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)', textAlign:'center', padding:'4px 0' }}>
          Zainstaluj i8kutils aby sterować wentylatorami
        </div>
      )}
    </div>
  );
};

// ── Główny komponent ──────────────────────────────────────────────────────────
const SystemTemps = () => {
  const [data,       setData]       = React.useState(null);
  const [loading,    setLoading]    = React.useState(true);
  const [tab,        setTab]        = React.useState('overview');
  const [cpuHist,    setCpuHist]    = React.useState([]);
  const [mbHist,     setMbHist]     = React.useState([]);
  const [fans,       setFans]       = React.useState([]);
  const [installing, setInstalling] = React.useState(false);
  const [autoMode,   setAutoMode]   = React.useState(false);
  const DISKS = window.useStore ? window.useStore('DISKS') || [] : [];

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

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/temps/install', { method:'POST', credentials:'include' });
      await load();
    } finally { setInstalling(false); }
  };

  const toggleFanAuto = async () => {
    const next = !autoMode;
    setAutoMode(next); // optimistic
    try {
      const r = await fetch('/api/fans/auto', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ enable: next }),
      });
      const d = await r.json();
      setAutoMode(d.auto ?? next);
    } catch { setAutoMode(!next); } // rollback on error
    load();
  };

  // Pogrupuj sensory wg typu
  const groups = data?.groups || [];
  const cpuGroups   = groups.filter(g => /core|coretemp|k10temp|cpu/i.test(g.name));
  const mbGroups    = groups.filter(g => /acpi|dell_smm|nct|it8|w83/i.test(g.name) && !/core/i.test(g.name));
  const otherGroups = groups.filter(g => !cpuGroups.includes(g) && !mbGroups.includes(g));

  const allSensors  = groups.flatMap(g => g.sensors || []);
  const cpuSensors  = cpuGroups.flatMap(g => g.sensors || []).filter(s => s.temp > 0);
  const mbSensors   = mbGroups.flatMap(g => g.sensors || []).filter(s => s.temp > 0);

  const cpuMax  = cpuSensors.length ? Math.max(...cpuSensors.map(s => s.temp)) : 0;
  const mbMax   = mbSensors.length  ? Math.max(...mbSensors.map(s => s.temp))  : 0;
  const fanMax  = fans.length       ? Math.max(...fans.map(f => f.rpm))        : 0;
  const diskMax = DISKS.reduce((m,d) => Math.max(m, d.temp||0), 0);

  const anyAlert = allSensors.some(s => s.temp >= s.warn);
  const anyCrit  = allSensors.some(s => s.temp >= s.crit);

  if (loading) return (
    <div style={{ padding:60, textAlign:'center', color:'var(--fg-dim)' }}>
      <div style={{ width:18, height:18, border:'2px solid var(--line-strong)', borderTopColor:'var(--accent)',
        borderRadius:'50%', animation:'_spin .6s linear infinite', margin:'0 auto 12px' }}/>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)' }}>Odczyt czujników…</div>
    </div>
  );

  // lm-sensors nie zainstalowany
  if (!data?.installed) return (
    <div className="card" style={{ padding:48, textAlign:'center' }}>
      <Icon name="thermometer" size={48} style={{ opacity:.2, display:'block', margin:'0 auto 20px' }}/>
      <div style={{ fontWeight:700, fontSize:'var(--fs-lg)', marginBottom:10 }}>lm-sensors nie jest zainstalowany</div>
      <div style={{ color:'var(--fg-muted)', fontSize:'var(--fs-sm)', maxWidth:520, margin:'0 auto 24px', lineHeight:1.7 }}>
        Aby odczytywać temperatury CPU, płyty głównej i sterować wentylatorami, zainstaluj pakiety:
        <br/><code style={{ color:'var(--accent)' }}>lm-sensors</code> i <code style={{ color:'var(--accent)' }}>i8kutils</code>
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

      {/* Alert banner */}
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

      {/* KPI */}
      <div className="grid grid-4">
        {[
          { label:'CPU',         val: cpuMax  ? cpuMax.toFixed(1)+'°C'  : '—', sub: cpuSensors.length+' rdzeni',   color: cpuMax  ? tempColor(cpuMax, 75, 95)  : 'var(--fg-dim)', spark: cpuHist },
          { label:'PŁYTA GŁÓWNA',val: mbMax   ? mbMax.toFixed(1)+'°C'   : '—', sub: mbSensors.length+' czujników', color: mbMax   ? tempColor(mbMax, 55, 85)   : 'var(--fg-dim)', spark: mbHist  },
          { label:'WENTYLATORY', val: fanMax  ? fanMax.toLocaleString('pl')+' RPM' : '—', sub: fans.length+' wentylatorów', color: fanMax > 3500 ? 'var(--err)' : 'var(--accent)', spark: null },
          { label:'DYSKI',       val: diskMax ? diskMax+'°C'            : '—', sub: 'SMART · HDD/SSD/NVMe',       color: diskMax ? tempColor(diskMax, 45, 60) : 'var(--fg-dim)', spark: null  },
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

      {/* Tabs */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
        <div className="segmented" style={{ flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="row gap-sm">
          <span className="badge dim" style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)' }}>
            <span className="dot pulse" style={{ background:'var(--ok)' }}/>
            lm-sensors · {data?.i8k_installed ? 'i8kutils' : 'bez i8k'} · co 5s
          </span>
          <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
        </div>
      </div>

      {/* ── MAPA CIEPLNA ── */}
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
                <div key={i} style={{
                  padding:'8px 12px', borderRadius:8, minWidth:90,
                  background:`color-mix(in oklch, ${color} ${Math.round(pct*25+5)}%, var(--bg-2))`,
                  border:`1px solid color-mix(in oklch, ${color} 30%, var(--line-strong))`,
                }}>
                  <div style={{ fontSize:10, color:'var(--fg-dim)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>
                    {s.unit || '°C'}
                  </div>
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

      {/* ── WENTYLATORY ── */}
      {tab === 'fans' && (
        <div className="col" style={{ gap:'var(--gutter)' }}>
          <div className="row gap-sm" style={{ justifyContent:'flex-end', alignItems:'center' }}>
            {data?.i8k_installed && (
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {autoMode && (
                  <span style={{ fontSize:'var(--fs-xs)', color:'var(--ok)', fontFamily:'var(--font-mono)',
                    display:'flex', alignItems:'center', gap:5 }}>
                    <span className="dot pulse" style={{ background:'var(--ok)' }}/>
                    Termostat aktywny · &lt;50°C→wolny · ≥50°C→szybki · ≥70°C→max
                  </span>
                )}
                <button
                  className={autoMode ? 'btn primary sm' : 'btn sm'}
                  onClick={toggleFanAuto}
                  style={autoMode ? { background:'var(--ok)', borderColor:'var(--ok)' } : {}}>
                  <Icon name="settings" size={12}/>
                  {autoMode ? ' Wyłącz termostat' : ' Tryb automatyczny'}
                </button>
              </div>
            )}
          </div>
          {fans.length === 0 ? (
            <div className="card" style={{ padding:40, textAlign:'center', color:'var(--fg-dim)' }}>
              <Icon name="refresh" size={40} style={{ opacity:.2, display:'block', margin:'0 auto 16px' }}/>
              <div>Brak wykrytych wentylatorów</div>
              <div style={{ fontSize:'var(--fs-xs)', marginTop:8 }}>
                Zainstaluj i8kutils lub sprawdź czy dell_smm jest załadowany: <code>modprobe dell-smm-hwmon</code>
              </div>
            </div>
          ) : (
            <div className="grid grid-2">
              {fans.map((fan, i) => (
                <FanCard key={i} fan={fan} index={i}
                  i8kInstalled={data?.i8k_installed}
                  autoMode={autoMode}
                  onSpeedChange={(idx, spd) => {
                    setFans(prev => prev.map((f, fi) => fi===idx ? {...f, speed: spd} : f));
                  }}
                />
              ))}
            </div>
          )}
          {!data?.i8k_installed && fans.length > 0 && (
            <div style={{ padding:'10px 14px', background:'var(--bg-2)', borderRadius:7,
              fontSize:'var(--fs-sm)', color:'var(--fg-muted)' }}>
              💡 Zainstaluj <code>i8kutils</code> aby uzyskać ręczne sterowanie prędkością wentylatorów.
              Komenda: <code style={{ color:'var(--accent)' }}>apt install i8kutils</code>
            </div>
          )}
        </div>
      )}

      {/* ── CPU ── */}
      {tab === 'cpu' && (
        <SensorGroup title="Procesor" sensors={cpuSensors} icon="thermometer"/>
      )}

      {/* ── PŁYTA GŁÓWNA ── */}
      {tab === 'mb' && (
        <div className="col" style={{ gap:'var(--gutter)' }}>
          <SensorGroup title="Płyta główna / Ambient" sensors={mbSensors} icon="settings"/>
          {mbSensors.length === 0 && (
            <div className="card" style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
              Brak czujników płyty głównej (acpitz, dell_smm, nct*, w83*)
            </div>
          )}
        </div>
      )}

      {/* ── DYSKI ── */}
      {tab === 'disks' && (() => {
        const diskTemps = DISKS.filter(d => d.temp > 0).map(d => ({
          label: d.bay, model: d.model, temp: d.temp||0,
          warn: d.type==='NVMe' ? 65 : 45,
          crit: d.type==='NVMe' ? 80 : 60,
          type: d.type,
        }));
        return (
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Temperatura dysków</div><div className="card-sub">S.M.A.R.T. · {diskTemps.length} napędów</div></div>
            </div>
            {diskTemps.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
                Brak danych o temperaturze dysków — wejdź do sekcji Dyski i pule
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Bay</th><th>Model</th><th>Typ</th><th style={{ width:220 }}>Temperatura</th><th>Warn</th><th>Crit</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {diskTemps.map(d => (
                    <tr key={d.label} style={{ background: d.temp>=d.crit ? 'oklch(0.66 0.2 25/0.05)' : d.temp>=d.warn ? 'oklch(0.78 0.15 75/0.04)' : '' }}>
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
                      <td>
                        {d.temp>=d.crit ? <span className="badge err">KRYT.</span>
                         : d.temp>=d.warn ? <span className="badge warn">WARN</span>
                         : <span className="badge ok">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* ── HISTORIA ── */}
      {tab === 'history' && (() => {
        const series  = [cpuHist, mbHist].filter(h => h.length > 0);
        const colors  = ['var(--err)', 'var(--accent)'];
        const labels  = ['CPU', 'Płyta główna'];
        if (!series.length) return (
          <div className="card" style={{ padding:40, textAlign:'center', color:'var(--fg-dim)' }}>
            Historia zbierana co 30s — wróć za chwilę
          </div>
        );
        const n   = Math.max(...series.map(s => s.length));
        const all = series.flat();
        const mn  = Math.floor(Math.min(...all) - 3);
        const mx  = Math.ceil(Math.max(...all)  + 3);
        const range = mx - mn || 1;
        const W=800, H=220, pad=40;
        const x = (i, len) => pad + (i / (len-1)) * (W - pad*2);
        const y = v => H - pad - ((v-mn)/range) * (H-pad*2);
        const gridYs = [0.25,0.5,0.75,1].map(p => ({ v: Math.round(mn+p*range), y: H-pad-p*(H-pad*2) }));

        return (
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Historia temperatur</div><div className="card-sub">Próbkowanie co 30s · max {n} próbek</div></div>
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
