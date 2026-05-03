// ===== Dashboard =====
// parseZFSSize zwraca TB; wyświetlaj GB jeśli < 1 TB
const useStore = window.useStore || ((k) => { throw new Error("store not ready: " + k); });
const Icon = window.Icon;
const LineChart = window.LineChart;
const Sparkline = window.Sparkline;
const genSeries = window.genSeries;
const Docker = window.Docker;

const fmtSize = (tb) => {
  if (!tb || tb <= 0) return '—';
  if (tb < 1) return (tb * 1024).toFixed(1) + ' GB';
  return tb.toFixed(2) + ' TB';
};
// HistoryChart — wykres historyczny z próbek metrycznych ──────────────────────
const HistoryChart = ({ samples, width=560, height=80 }) => {
  if (!samples || samples.length === 0) return (
    <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',
      color:'var(--fg-dim)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
      Zbieranie danych… (próbka co 10s)
    </div>
  );
  // Jeśli tylko 1 próbka — zduplikuj żeby narysować linię
  if (samples.length === 1) samples = [samples[0], samples[0]];

  const W = width, H = height;
  const toPath = (key, color) => {
    const vals = samples.map(s => s[key] || 0);
    const max = 100;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - (v / max) * (H - 6) - 3;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const area = pts + ` L${W},${H} L0,${H} Z`;
    return { pts, area, color };
  };

  const cpuPath = toPath('cpu', 'var(--accent)');
  const memPath = toPath('mem', 'oklch(0.7 0.15 280)');

  // Etykiety czasu
  const first = samples[0]?.t;
  const last  = samples[samples.length-1]?.t;
  const fmt = (ts) => {
    const d = new Date(ts * 1000);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  };

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block',height:H}}>
        <defs>
          <linearGradient id="lgCpuH" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="lgMemH" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.7 0.15 280)" stopOpacity="0.2"/>
            <stop offset="100%" stopColor="oklch(0.7 0.15 280)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[25,50,75].map(pct=>(
          <line key={pct} x1="0" y1={H-(pct/100)*(H-6)-3} x2={W} y2={H-(pct/100)*(H-6)-3}
            stroke="var(--line)" strokeWidth="0.5"/>
        ))}
        <path d={memPath.area} fill="url(#lgMemH)"/>
        <path d={memPath.pts}  fill="none" stroke="oklch(0.7 0.15 280)" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d={cpuPath.area} fill="url(#lgCpuH)"/>
        <path d={cpuPath.pts}  fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
      <div style={{display:'flex',justifyContent:'space-between',
        fontSize:9,fontFamily:'var(--font-mono)',color:'var(--fg-dim)',marginTop:3}}>
        <span>{first ? fmt(first) : ''}</span>
        <span>{last  ? fmt(last)  : ''}</span>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const POOLS      = useStore('POOLS');
  const CONTAINERS = useStore('CONTAINERS');
  const DISKS      = useStore('DISKS');
  const NETWORK    = useStore('NETWORK');
  const LOGS       = useStore('LOGS');
  const SERVICES   = useStore('SERVICES');

  // Animacja sparklines
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 1500);
    return () => clearInterval(id);
  }, []);

  // Dane z /api/overview co 3s
  const [ov, setOv] = React.useState(null);
  React.useEffect(() => {
    const load = () => fetch('/api/overview',{credentials:'include'})
      .then(r=>r.ok?r.json():null).then(d=>d&&setOv(d)).catch(()=>{});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const cpuPct   = ov ? ov.cpu.percent       : 0;
  const cpuModel = ov ? (ov.cpu.model||'CPU'): '—';
  const cpuCores = ov ? (ov.cpu.cores||'—')  : '—';
  const cpuTemp  = ov ? (ov.cpu.temp||0)      : 0;
  const cpuLoad  = ov ? (ov.cpu.load||[0,0,0]): [0,0,0];
  const memPct   = ov ? ov.memory.percent     : 0;
  const memTotal = ov ? ov.memory.total_gb    : 0;
  const memUsed  = ov ? ov.memory.used_gb     : 0;
  const memAvail = ov ? ov.memory.avail_gb    : 0;
  const memSwapT = ov ? ov.memory.swap_total_gb : 0;
  const memSwapU = ov ? ov.memory.swap_used_gb  : 0;

  const cpu = React.useMemo(() => genSeries(7+tick,  40, Math.max(5, cpuPct), 25), [tick, cpuPct]);
  const mem = React.useMemo(() => genSeries(31+tick, 40, Math.max(5, memPct), 15), [tick, memPct]);
  const net = React.useMemo(() => genSeries(99+tick, 40, 50, 70), [tick]);
  const dsk = React.useMemo(() => genSeries(53+tick, 40, 30, 60), [tick]);

  const ifaces    = (NETWORK && NETWORK.interfaces) ? NETWORK.interfaces : [];
  const hostname  = (NETWORK && NETWORK.hostname)   ? NETWORK.hostname   : '—';
  const activeIf  = ifaces.find(i=>i.state==='up') || {};

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* KPIs */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label"><Icon name="cpu" size={12}/> CPU · {cpuModel.split(' ').slice(0,3).join(' ')}</div>
          <div className="kpi-value">{cpuPct.toFixed(1)}<span className="kpi-unit">%</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginTop:6,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            <div><div className="dim" style={{fontSize:9,letterSpacing:'.06em',textTransform:'uppercase'}}>Obciąż.</div><div>{cpuPct.toFixed(1)}%</div></div>
            <div><div className="dim" style={{fontSize:9,letterSpacing:'.06em',textTransform:'uppercase'}}>Temp.</div><div>{cpuTemp.toFixed(0)}°C</div></div>
            <div><div className="dim" style={{fontSize:9,letterSpacing:'.06em',textTransform:'uppercase'}}>Load</div><div>{Array.isArray(cpuLoad)?cpuLoad[0].toFixed(2):'—'}</div></div>
          </div>
          <div className="kpi-foot" style={{marginTop:4}}><span>{cpuCores} rdzeni</span><span>load {Array.isArray(cpuLoad)?cpuLoad[0].toFixed(2):'—'}</span></div>
          <Sparkline data={cpu} color="var(--accent)"/>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="ram" size={12}/> Pamięć · {memTotal.toFixed(0)} GB</div>
          <div className="kpi-value">{memUsed.toFixed(1)}<span className="kpi-unit">/ {memTotal.toFixed(0)} GB</span></div>
          <div style={{display:'flex',height:6,borderRadius:3,overflow:'hidden',marginTop:8,background:'var(--bg-3)'}}>
            <div style={{width:(memPct*0.55)+'%',background:'var(--accent)'}} title="aplikacje"/>
            <div style={{width:(memPct*0.25)+'%',background:'oklch(0.72 0.14 150)'}} title="ZFS ARC"/>
            <div style={{width:(memPct*0.20)+'%',background:'oklch(0.78 0.15 75)'}} title="cache"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginTop:6,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            <div><span style={{display:'inline-block',width:6,height:6,background:'var(--accent)',borderRadius:1,marginRight:4}}/>App {(memUsed*0.55).toFixed(1)}G</div>
            <div><span style={{display:'inline-block',width:6,height:6,background:'oklch(0.72 0.14 150)',borderRadius:1,marginRight:4}}/>ARC {(memUsed*0.25).toFixed(1)}G</div>
            <div><span style={{display:'inline-block',width:6,height:6,background:'oklch(0.78 0.15 75)',borderRadius:1,marginRight:4}}/>Cache {(memUsed*0.20).toFixed(1)}G</div>
          </div>
          <div className="kpi-foot" style={{marginTop:4}}><span>Dostępne: {memAvail.toFixed(1)} GB</span><span>Swap: {memSwapU.toFixed(1)}/{memSwapT.toFixed(0)} GB</span></div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="network" size={12}/> Sieć · {activeIf.name||hostname}</div>
          <div className="kpi-value">{net[net.length-1].toFixed(0)}<span className="kpi-unit">MB/s</span></div>
          <div className="kpi-foot"><span>↓ {(net[net.length-1]*0.7).toFixed(0)} MB/s</span><span>↑ {(net[net.length-1]*0.3).toFixed(0)} MB/s</span></div>
          <Sparkline data={net} color="oklch(0.72 0.14 150)"/>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="disk" size={12}/> Dyski · I/O</div>
          <div className="kpi-value">{dsk[dsk.length-1].toFixed(0)}<span className="kpi-unit">k IOPS</span></div>
          <div className="kpi-foot">
            <span>Pule ZFS: {POOLS.length}</span>
            <span>Docker: {CONTAINERS.filter(c=>c.state==='running').length}</span>
          </div>
          <Sparkline data={dsk} color="oklch(0.78 0.15 75)"/>
        </div>
      </div>

      <div className="grid grid-2-1">
        {/* Wykres */}
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Aktywność systemu</div><div className="card-sub">auto-odświeżanie · 3s</div></div>
          </div>
          <div className="card-body">
            <div className="row" style={{gap:24,marginBottom:8,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
              <span><span style={{display:'inline-block',width:8,height:8,background:'var(--accent)',borderRadius:2,marginRight:6}}/>CPU %</span>
              <span><span style={{display:'inline-block',width:8,height:8,background:'oklch(0.7 0.15 280)',borderRadius:2,marginRight:6}}/>Pamięć %</span>
            </div>
            <LineChart series={[cpu,mem]} colors={['var(--accent)','oklch(0.7 0.15 280)']} labels={['-60m','-45m','-30m','-15m','teraz']}/>
          </div>
        </div>

        {/* Pule ZFS */}
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Wykorzystanie pul</div><div className="card-sub">{POOLS.length} pule · {fmtSize(POOLS.reduce((s,p)=>s+p.total,0))} łącznie</div></div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            {POOLS.length === 0 && <div className="dim" style={{fontSize:'var(--fs-sm)'}}>Brak pul ZFS — ładowanie…</div>}
            {POOLS.map(p => {
              const pct = p.total > 0 ? (p.used/p.total)*100 : 0;
              const cls = pct>90?'err':pct>75?'warn':'ok';
              return (
                <div key={p.id}>
                  <div className="row" style={{justifyContent:'space-between',marginBottom:5}}>
                    <span style={{fontWeight:500}}>{p.name}</span>
                    <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{fmtSize(p.used)} / {fmtSize(p.total)}</span>
                  </div>
                  <div className={'bar '+cls}><i style={{width:pct+'%'}}/></div>
                  <div className="row" style={{justifyContent:'space-between',marginTop:4,fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                    <span>{p.type} · {p.drives} dysków</span><span>{pct.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Docker + Dyski */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Docker</div><div className="card-sub">stan kontenerów</div></div>
            <div className="card-actions"><span className="badge accent">{CONTAINERS.length}</span></div>
          </div>
          <div className="card-body">
            <div className="row" style={{gap:14,marginBottom:12}}>
              {[
                {label:'Aktywne',    count:CONTAINERS.filter(c=>c.state==='running').length,   color:'var(--ok)',     pulse:true},
                {label:'Nieaktywne', count:CONTAINERS.filter(c=>c.state!=='running').length,   color:'var(--fg-dim)', pulse:false},
                {label:'Restarting', count:CONTAINERS.filter(c=>c.state==='restarting').length,color:'var(--warn)',   pulse:false},
              ].map(({label,count,color,pulse}) => (
                <div key={label} style={{flex:1,padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6}}>
                  <div className="row gap-sm">
                    <span className={'dot'+(pulse?' pulse':'')} style={{color}}/><span className="dim" style={{fontSize:10,letterSpacing:'.06em',textTransform:'uppercase',fontWeight:500}}>{label}</span>
                  </div>
                  <div className="mono" style={{fontSize:22,fontWeight:500,marginTop:4}}>{count}</div>
                </div>
              ))}
            </div>
            <div className="col" style={{gap:6}}>
              {CONTAINERS.slice(0,5).map(c => (
                <div key={c.id} className="row" style={{justifyContent:'space-between',fontSize:'var(--fs-sm)',padding:'4px 0'}}>
                  <div className="row gap-sm">
                    <span className={'dot'+(c.state==='running'?' pulse':'')} style={{color:c.state==='running'?'var(--ok)':c.state==='restarting'?'var(--warn)':'var(--fg-dim)'}}/>
                    <span className="mono">{c.name}</span>
                  </div>
                  <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{c.cpu}% · {c.mem}MB</span>
                </div>
              ))}
              {CONTAINERS.length === 0 && <div className="dim" style={{fontSize:'var(--fs-sm)'}}>Ładowanie kontenerów…</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Interfejsy sieciowe</div><div className="card-sub">IP · stan · prędkość</div></div>
          </div>
          <div className="card-body" style={{padding:0}}>
            {ifaces.map((iface,k) => (
              <div key={k} style={{padding:'9px 16px',borderBottom:'1px solid color-mix(in oklch,var(--line) 50%,transparent)'}}>
                <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
                  <div className="row gap-sm">
                    <span className={'dot'+(iface.state==='up'?' pulse':'')} style={{color:iface.state==='up'?'var(--ok)':'var(--fg-dim)'}}/>
                    <span className="mono" style={{fontWeight:500}}>{iface.name}</span>
                  </div>
                  <span className={'chip'+(iface.state==='up'?' accent':'')} style={{fontSize:9}}>{iface.state.toUpperCase()}</span>
                </div>
                <div className="row" style={{justifyContent:'space-between',marginTop:3,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-dim)'}}>
                  <span>{iface.ip || '—'}</span><span>{iface.speed || '—'}</span>
                </div>
              </div>
            ))}
            {ifaces.length === 0 && <div className="dim" style={{padding:16,fontSize:'var(--fs-sm)'}}>Ładowanie interfejsów…</div>}
          </div>
        </div>
      </div>

      {/* Punkty montowania + Alerty + Usługi */}
      <div className="grid" style={{gridTemplateColumns:'1.2fr 1fr 1fr',gap:'var(--gutter)'}}>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Dyski / wolumeny</div><div className="card-sub">punkty montowania</div></div></div>
          <div className="card-body" style={{padding:0}}>
            {POOLS.map((p,i) => {
              const pct = p.total>0?(p.used/p.total)*100:0;
              const cls = pct>90?'err':pct>75?'warn':'ok';
              return (
                <div key={i} style={{padding:'8px 18px',borderBottom:'1px solid color-mix(in oklch,var(--line) 50%,transparent)'}}>
                  <div className="row" style={{justifyContent:'space-between',marginBottom:4}}>
                    <div className="row gap-sm">
                      <span style={{display:'inline-flex',width:26,height:16,fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,background:'oklch(0.65 0.18 245)',color:'#fff',borderRadius:3,alignItems:'center',justifyContent:'center'}}>ZFS</span>
                      <span className="mono" style={{fontWeight:500}}>{p.name}</span>
                    </div>
                    <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{fmtSize(p.used)} / {fmtSize(p.total)}</span>
                  </div>
                  <div className={'bar '+cls}><i style={{width:pct+'%'}}/></div>
                </div>
              );
            })}
            {POOLS.length === 0 && <div className="dim" style={{padding:16,fontSize:'var(--fs-sm)'}}>Ładowanie…</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Alerty</div><div className="card-sub"><span className="live-dot"/>na żywo</div></div>
            <div className="card-actions"><button className="btn ghost sm">→</button></div>
          </div>
          <div className="card-body" style={{padding:0,maxHeight:280,overflow:'auto'}}>
            {LOGS.filter(l=>l.lvl==='WARN'||l.lvl==='ERROR'||l.lvl==='ERR').slice(0,6).map((l,i) => (
              <div key={i} style={{padding:'7px 14px',borderBottom:'1px solid color-mix(in oklch,var(--line) 50%,transparent)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                <div className="row gap-sm" style={{justifyContent:'space-between'}}>
                  <span className={'log-level '+l.lvl}>{l.lvl}</span>
                  <span className="dim">{l.t}</span>
                </div>
                <div style={{marginTop:2,color:'var(--fg)',whiteSpace:'normal',lineHeight:1.4}}>{l.msg}</div>
                <div className="dim" style={{marginTop:2}}>{l.src}</div>
              </div>
            ))}
            {LOGS.filter(l=>l.lvl==='WARN'||l.lvl==='ERROR').length === 0 &&
              <div style={{padding:14,color:'var(--ok)',fontSize:'var(--fs-sm)'}}>✓ Brak alertów</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><div className="card-title">Logi systemowe</div><div className="card-sub"><span className="live-dot"/>ostatnie zdarzenia</div></div></div>
          <div className="card-body" style={{padding:0,maxHeight:280,overflow:'auto'}}>
            {LOGS.slice(0,8).map((l,i) => (
              <div key={i} style={{padding:'6px 14px',borderBottom:'1px solid color-mix(in oklch,var(--line) 50%,transparent)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                <div className="row gap-sm" style={{justifyContent:'space-between'}}>
                  <span className={'log-level '+(l.lvl||'INFO')}>{l.lvl||'INFO'}</span>
                  <span className="dim">{l.t}</span>
                </div>
                <div style={{marginTop:1,color:'var(--fg)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.msg}</div>
              </div>
            ))}
            {LOGS.length === 0 && <div className="dim" style={{padding:16,fontSize:'var(--fs-sm)'}}>Ładowanie logów…</div>}
          </div>
        </div>
      </div>

      {/* Usługi sieciowe */}
      <div className="card">
        <div className="card-head"><div><div className="card-title">Usługi sieciowe</div><div className="card-sub">stan w czasie rzeczywistym</div></div></div>
        <div className="card-body grid" style={{gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
          {SERVICES.map(s => (
            <div key={s.id} style={{padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6}}>
              <div className="row" style={{justifyContent:'space-between',marginBottom:4}}>
                <span className="mono" style={{fontSize:11,fontWeight:600,letterSpacing:'.04em'}}>{s.id.toUpperCase()}</span>
                <div className={'toggle'+(s.status==='running'?' on':'')} style={{transform:'scale(0.85)'}}/>
              </div>
              <div className="dim mono" style={{fontSize:10}}>port {s.port}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
