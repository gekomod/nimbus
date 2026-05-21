// ===== UPS / NUT — design by Claude Design, API by Nimbus =====

const UPS_STATUS_META = {
  "on-line":     { label: "ON-LINE",     color: "var(--ok)",   blurb: "Zasilanie z sieci · akumulator w gotowości" },
  "online":      { label: "ON-LINE",     color: "var(--ok)",   blurb: "Zasilanie z sieci · akumulator w gotowości" },
  "on-battery":  { label: "ON BATTERY",  color: "var(--err)",  blurb: "Brak zasilania sieciowego · praca z akumulatora" },
  "on_battery":  { label: "ON BATTERY",  color: "var(--err)",  blurb: "Brak zasilania sieciowego · praca z akumulatora" },
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

const UpsArcGauge = ({ value, max=100, label, sub, color="var(--accent)", size=220, thickness=14, suffix="%" }) => {
  const r=(size-thickness)/2, cx=size/2, cy=size-thickness, len=Math.PI*r;
  const pct=Math.max(0,Math.min(1,value/max)), offset=len*(1-pct);
  return (
    <svg width={size} height={size*0.6+8} viewBox={`0 0 ${size} ${size*0.6+8}`} style={{overflow:"visible"}}>
      <defs>
        <linearGradient id={`gx-${label}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.6"/>
          <stop offset="100%" stopColor={color} stopOpacity="1"/>
        </linearGradient>
      </defs>
      <path d={`M ${thickness/2} ${cy} A ${r} ${r} 0 0 1 ${size-thickness/2} ${cy}`} fill="none" stroke="var(--bg-3)" strokeWidth={thickness} strokeLinecap="round"/>
      <path d={`M ${thickness/2} ${cy} A ${r} ${r} 0 0 1 ${size-thickness/2} ${cy}`} fill="none" stroke={`url(#gx-${label})`} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={offset} style={{transition:"stroke-dashoffset 0.5s ease"}}/>
      {[0,0.25,0.5,0.75,1].map(t=>{const a=Math.PI-t*Math.PI,x1=cx+(r-thickness/2-2)*Math.cos(a),y1=cy-(r-thickness/2-2)*Math.sin(a),x2=cx+(r+thickness/2+4)*Math.cos(a),y2=cy-(r+thickness/2+4)*Math.sin(a);return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg-dim)" strokeWidth="1" opacity={0.4}/>;})}
      <text x={cx} y={cy-24} textAnchor="middle" fontSize="38" fontWeight="600" fontFamily="var(--font-mono)" fill="var(--fg)" letterSpacing="-0.02em">{Math.round(value)}<tspan fontSize="18" fill="var(--fg-dim)" dx="2">{suffix}</tspan></text>
      <text x={cx} y={cy-6} textAnchor="middle" fontSize="11" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">{label}</text>
      {sub && <text x={cx} y={cy+16} textAnchor="middle" fontSize="11" fill="var(--fg-muted)" fontFamily="var(--font-mono)">{sub}</text>}
    </svg>
  );
};

const VStrip = ({ label, value, unit, min, max, ideal, warn }) => {
  const v=value||0, pct=Math.max(0,Math.min(1,(v-min)/(max-min))), idealPct=(ideal-min)/(max-min), inWarn=v<warn[0]||v>warn[1];
  return (
    <div className="col" style={{gap:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <span style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>{label}</span>
        <span className="mono" style={{fontSize:16,fontWeight:600,color:inWarn?"var(--warn)":"var(--fg)"}}>{v.toFixed(2)} <span style={{color:"var(--fg-dim)",fontSize:11,fontWeight:400}}>{unit}</span></span>
      </div>
      <div style={{height:6,background:"var(--bg-3)",borderRadius:3,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,bottom:0,left:0,width:`${pct*100}%`,background:inWarn?"var(--warn)":"var(--ok)",transition:"width 0.4s"}}/>
        <div style={{position:"absolute",top:-2,bottom:-2,left:`${idealPct*100}%`,width:2,background:"var(--accent)",opacity:0.7}}/>
      </div>
      <div className="mono" style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--fg-dim)"}}>
        <span>{min}</span><span>nominalne {ideal}</span><span>{max}</span>
      </div>
    </div>
  );
};

const PowerFlow = ({ status, inputVoltage, outputVoltage, loadW, ratedVA, battPct }) => {
  const onBattery = status==="on-battery"||status==="on_battery";
  return (
    <svg viewBox="0 0 520 110" style={{width:"100%",height:110,display:"block"}}>
      <g>
        <rect x="8" y="32" width="100" height="46" rx="8" fill="var(--bg-2)" stroke="var(--line)"/>
        <text x="58" y="50" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.06em">SIEĆ 230V</text>
        <text x="58" y="68" textAnchor="middle" fontSize="14" fill={onBattery?"var(--err)":"var(--ok)"} fontWeight="600" fontFamily="var(--font-mono)">{onBattery?"BRAK":"OK"}</text>
      </g>
      <line x1="108" y1="55" x2="206" y2="55" stroke={onBattery?"var(--err)":"var(--ok)"} strokeWidth="2" strokeDasharray={onBattery?"4 4":"0"}/>
      {!onBattery&&<circle r="3" fill="var(--ok)"><animateMotion dur="1.4s" repeatCount="indefinite" path="M 108 55 L 206 55"/></circle>}
      <g>
        <rect x="206" y="20" width="108" height="70" rx="10" fill="var(--bg-2)" stroke="var(--accent)" strokeWidth="1.5"/>
        <text x="260" y="40" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.06em">UPS</text>
        <text x="260" y="62" textAnchor="middle" fontSize="20" fill="var(--accent)" fontWeight="600" fontFamily="var(--font-mono)">{ratedVA||600}VA</text>
        <text x="260" y="80" textAnchor="middle" fontSize="9" fill="var(--fg-muted)" fontFamily="var(--font-mono)">blazer_usb · NUT</text>
      </g>
      <g>
        <rect x="222" y="92" width="78" height="14" rx="3" fill="var(--bg)" stroke={onBattery?"var(--warn)":"var(--ok)"}/>
        <rect x="224" y="94" width={Math.max(2,Math.round(74*(battPct||0)/100))} height="10" rx="2" fill={onBattery?"var(--warn)":"var(--ok)"} opacity="0.7"/>
        <text x="261" y="103" textAnchor="middle" fontSize="9" fill="var(--bg)" fontFamily="var(--font-mono)" fontWeight="600">BATTERY {Math.round(battPct||0)}%</text>
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

const VoltageHistory = ({ inputVoltage }) => {
  const [pts, setPts] = React.useState([inputVoltage||230]);

  React.useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/ups/voltage-history', { credentials:'include' });
        const d = await r.json();
        if (d.history && d.history.length > 1) {
          setPts(d.history);
        } else if (inputVoltage > 0) {
          setPts(prev => [...prev.slice(-359), inputVoltage]);
        }
      } catch(e) {
        if (inputVoltage > 0) setPts(prev => [...prev.slice(-359), inputVoltage]);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [inputVoltage]);

  if (pts.length < 2) return (
    <div style={{height:140,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>
      Zbieranie danych historycznych… (próbka co 10s)
    </div>
  );

  const W=800,H=140,pad=28;
  const allMin=Math.min(...pts),allMax=Math.max(...pts);
  const vMin=Math.min(200,allMin-5),vMax=Math.max(245,allMax+5);
  const x=i=>pad+(i/(pts.length-1))*(W-pad*2);
  const y=v=>H-pad-((v-vMin)/(vMax-vMin))*(H-pad*2);
  const linePath="M "+pts.map((p,i)=>`${x(i)},${y(p)}`).join(" L ");
  const areaPath=`${linePath} L ${x(pts.length-1)},${H-pad} L ${x(0)},${H-pad} Z`;
  const minV=Math.min(...pts),minIdx=pts.indexOf(minV);
  const gridVals=[210,220,230,240].filter(g=>g>=vMin&&g<=vMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:140,display:"block"}}>
      <rect x={pad} y={y(235)} width={W-pad*2} height={Math.max(0,y(225)-y(235))} fill="color-mix(in oklch, var(--ok) 10%, transparent)"/>
      <line x1={pad} x2={W-pad} y1={y(230)} y2={y(230)} stroke="var(--ok)" strokeDasharray="2 4" opacity="0.5"/>
      {gridVals.map(g=>(
        <g key={g}>
          <line x1={pad} x2={W-pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="1 4"/>
          <text x={pad-6} y={y(g)+3} textAnchor="end" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)">{g}V</text>
        </g>
      ))}
      <path d={areaPath} fill="var(--accent)" opacity="0.08"/>
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.6"/>
      {minV < 220 && <>
        <circle cx={x(minIdx)} cy={y(minV)} r="3" fill="var(--warn)"/>
        <text x={x(minIdx)+6} y={y(minV)-6} fontSize="10" fill="var(--warn)" fontFamily="var(--font-mono)">{minV.toFixed(1)}V</text>
      </>}
      <text x={W-pad-2} y={y(pts[pts.length-1])-6} textAnchor="end" fontSize="9" fill="var(--accent)" fontFamily="var(--font-mono)">{(pts[pts.length-1]||0).toFixed(1)}V</text>
    </svg>
  );
};

const UpsKpi = ({ status }) => {
  const meta = UPS_STATUS_META[status] || UPS_STATUS_META["on-line"];
  return (
    <div className="kpi" style={{borderColor:`color-mix(in oklch, ${meta.color} 35%, var(--line))`,background:`linear-gradient(180deg, color-mix(in oklch, ${meta.color} 10%, var(--bg-1)), var(--bg-1))`}}>
      <div className="kpi-label">STATUS</div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
        <span style={{width:10,height:10,borderRadius:"50%",background:meta.color,boxShadow:`0 0 0 3px color-mix(in oklch, ${meta.color} 30%, transparent), 0 0 12px ${meta.color}`,animation:(status==="on-line"||status==="online")?"ups-pulse 2.4s ease-out infinite":"none"}}/>
        <span style={{fontSize:17,fontWeight:600,color:meta.color,letterSpacing:"-0.01em"}}>{meta.label}</span>
      </div>
      <div className="kpi-foot" style={{marginTop:6}}><span>{meta.blurb}</span></div>
    </div>
  );
};

const PowerWalkerLogo = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" style={{flexShrink:0}}>
    <defs><linearGradient id="ups-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="oklch(0.7 0.16 245)"/><stop offset="100%" stopColor="oklch(0.55 0.18 260)"/></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="12" fill="url(#ups-logo-g)"/>
    <path d="M 28 14 L 14 36 L 26 36 L 22 50 L 42 28 L 30 28 L 36 14 Z" fill="white" stroke="white" strokeLinejoin="round" strokeWidth="1.2"/>
  </svg>
);

const Field = ({ label, hint, children, span }) => (
  <div style={{display:"flex",flexDirection:"column",gap:5,gridColumn:span?`span ${span}`:"auto"}}>
    <span style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>{label}</span>
    {children}
    {hint&&<span style={{fontSize:11,color:"var(--fg-muted)",lineHeight:1.4}}>{hint}</span>}
  </div>
);

const ConfigRow = ({ label, hint, children, danger }) => (
  <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:18,alignItems:"center",padding:"12px 0",borderTop:"1px dashed var(--line)"}}>
    <div>
      <div style={{fontSize:12,fontWeight:600,color:danger?"var(--err)":"var(--fg)"}}>{label}</div>
      {hint&&<div style={{fontSize:11,color:"var(--fg-muted)",marginTop:2,lineHeight:1.4}}>{hint}</div>}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"flex-end"}}>{children}</div>
  </div>
);

const Seg = ({ value, onChange, options }) => (
  <div className="segmented" style={{width:"auto",display:"inline-flex"}}>
    {options.map(([v,l])=>(
      <button key={v} className={value===v?"active":""} onClick={()=>onChange(v)} type="button">{l}</button>
    ))}
  </div>
);

const ShutdownSequence = ({ steps, onEdit, onDelete }) => {
  const tone=cls=>cls==="err"?"var(--err)":cls==="warn"?"var(--warn)":"var(--accent)";
  return (
    <div className="col" style={{position:"relative",padding:"4px 0"}}>
      <div style={{position:"absolute",left:23,top:14,bottom:14,width:2,background:"var(--bg-3)"}}/>
      {steps.map((s,i)=>{const c=tone(s.cls);return(
        <div key={s.id} style={{display:"grid",gridTemplateColumns:"48px 130px 1fr auto",alignItems:"center",gap:14,padding:"10px 0",position:"relative"}}>
          <div style={{display:"flex",justifyContent:"center",position:"relative",zIndex:1}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:`color-mix(in oklch, ${c} 15%, var(--bg))`,border:`1.5px solid ${c}`,display:"flex",alignItems:"center",justifyContent:"center",color:c}}>
              <Icon name={s.icon} size={14}/>
            </div>
          </div>
          <div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-dim)",letterSpacing:"0.06em"}}>ETAP {String(i+1).padStart(2,"0")}</div>
            <div className="mono" style={{fontSize:12,color:c,fontWeight:600}}>{s.at}</div>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--fg)"}}>{s.what}</div>
            <div className="mono" style={{fontSize:11,color:"var(--fg-muted)",marginTop:3}}>{s.detail}</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span className="badge" style={{background:`color-mix(in oklch, ${c} 14%, transparent)`,color:c,borderColor:`color-mix(in oklch, ${c} 30%, transparent)`}}>aktywny</span>
            <button className="icon-btn"><Icon name="edit" size={12}/></button>
          </div>
        </div>
      );})}
    </div>
  );
};

// ── Główny komponent ──────────────────────────────────────────────────────────


// ── Modalne dialogi ───────────────────────────────────────────────────────────

const Modal = ({ title, onClose, children, width=520 }) => (
  <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(4px)'}}
    onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:12,width,maxWidth:'94vw',maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid var(--line)'}}>
        <div style={{fontWeight:600,fontSize:'var(--fs-md)'}}>{title}</div>
        <button className="icon-btn" onClick={onClose}><Icon name="close" size={14}/></button>
      </div>
      <div style={{padding:'20px'}}>{children}</div>
    </div>
  </div>
);

const FormRow = ({ label, hint, children }) => (
  <div style={{display:'grid',gridTemplateColumns:'140px 1fr',gap:12,alignItems:'start',marginBottom:14}}>
    <div>
      <div style={{fontSize:12,fontWeight:500,color:'var(--fg)',paddingTop:7}}>{label}</div>
      {hint&&<div style={{fontSize:11,color:'var(--fg-dim)',marginTop:2,lineHeight:1.4}}>{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

// Dialog edycji reguły
const RuleDialog = ({ rule, onSave, onClose }) => {
  const [form, setForm] = React.useState(rule || {
    on: true, trigger: 'on-battery', after: 'natychmiast', action: 'Powiadomienie', target: ''
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <Modal title={rule?.id ? 'Edytuj regułę' : 'Nowa reguła'} onClose={onClose} width={540}>
      <FormRow label="Wyzwalacz" hint="Zdarzenie które uruchamia regułę">
        <select className="select" value={form.trigger} onChange={e=>set('trigger',e.target.value)}>
          <option value="on-battery">on-battery — utrata zasilania AC</option>
          <option value="battery &lt; 25%">battery &lt; 25% — niski poziom</option>
          <option value="battery &lt; 15%">battery &lt; 15% — krytyczny poziom</option>
          <option value="battery &lt; 10%">battery &lt; 10% — awaryjny poziom</option>
          <option value="load &gt; 80%">load &gt; 80% — wysokie obciążenie</option>
          <option value="online">online — powrót zasilania AC</option>
          <option value="lowbatt">lowbatt — sygnał LB z UPS</option>
          <option value="fsd">FSD — Forced Shutdown</option>
        </select>
      </FormRow>
      <FormRow label="Opóźnienie" hint="Czas od wyzwalacza do wykonania akcji">
        <select className="select" value={form.after} onChange={e=>set('after',e.target.value)}>
          <option value="natychmiast">natychmiast</option>
          <option value="30s">30 sekund</option>
          <option value="60s">60 sekund</option>
          <option value="120s">2 minuty</option>
          <option value="300s">5 minut</option>
        </select>
      </FormRow>
      <FormRow label="Akcja">
        <select className="select" value={form.action} onChange={e=>set('action',e.target.value)}>
          <option value="Powiadomienie">Powiadomienie (e-mail/Telegram)</option>
          <option value="Shutdown slave">Shutdown slave</option>
          <option value="Shutdown host">Shutdown host (shutdown -h)</option>
          <option value="Skrypt">Skrypt niestandardowy</option>
        </select>
      </FormRow>
      <FormRow label="Cel" hint="Adres IP, e-mail lub ścieżka skryptu">
        <input className="input" value={form.target} onChange={e=>set('target',e.target.value)} placeholder="np. 192.168.1.100 lub admin@example.com"/>
      </FormRow>
      <FormRow label="Aktywna">
        <span className={'toggle'+(form.on?' on':'')} onClick={()=>set('on',!form.on)}/>
      </FormRow>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8,paddingTop:16,borderTop:'1px solid var(--line)'}}>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={()=>{ onSave(form); onClose(); }}>
          <Icon name="check" size={12}/> {rule?.id?'Zapisz zmiany':'Dodaj regułę'}
        </button>
      </div>
    </Modal>
  );
};

// Dialog edycji etapu sekwencji wyłączenia
const ShutdownStepDialog = ({ step, stepIndex, totalSteps, onSave, onClose }) => {
  const [form, setForm] = React.useState(step || {
    icon: 'bell', cls: 'info', at: 'T + 0 s', what: '', detail: ''
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <Modal title={step ? 'Edytuj etap sekwencji' : 'Nowy etap wyłączenia'} onClose={onClose} width={560}>
      <FormRow label="Czas" hint="Czas od momentu utraty zasilania">
        <input className="input mono" value={form.at} onChange={e=>set('at',e.target.value)} placeholder="np. T + 60 s"/>
      </FormRow>
      <FormRow label="Ikona">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {['bell','server','power','bolt','mail','close','shield','wifi'].map(ic=>(
            <button key={ic} className={'btn sm'+(form.icon===ic?' primary':'')} onClick={()=>set('icon',ic)} style={{width:36,height:36,padding:0,display:'grid',placeItems:'center'}}>
              <Icon name={ic} size={13}/>
            </button>
          ))}
        </div>
      </FormRow>
      <FormRow label="Priorytet">
        <div style={{display:'flex',gap:6}}>
          {[['info','Info','var(--accent)'],['warn','Ostrzeżenie','var(--warn)'],['err','Krytyczny','var(--err)']].map(([v,l,c])=>(
            <button key={v} onClick={()=>set('cls',v)} style={{padding:'6px 14px',borderRadius:6,border:'1px solid',cursor:'pointer',fontSize:12,
              borderColor:form.cls===v?c:'var(--line-strong)',background:form.cls===v?`color-mix(in oklch,${c} 15%,var(--bg-2))`:'var(--bg-2)',color:form.cls===v?c:'var(--fg)'}}>
              {l}
            </button>
          ))}
        </div>
      </FormRow>
      <FormRow label="Akcja" hint="Krótki opis wykonywanej akcji">
        <input className="input" value={form.what} onChange={e=>set('what',e.target.value)} placeholder="np. Shutdown systemu hosta"/>
      </FormRow>
      <FormRow label="Szczegóły" hint="Komenda lub opis techniczny">
        <input className="input mono" value={form.detail} onChange={e=>set('detail',e.target.value)} placeholder="np. shutdown -h +0"/>
      </FormRow>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8,paddingTop:16,borderTop:'1px solid var(--line)'}}>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={()=>{ onSave({...form,id:step?.id||Date.now()}); onClose(); }}>
          <Icon name="check" size={12}/> {step?'Zapisz zmiany':'Dodaj etap'}
        </button>
      </div>
    </Modal>
  );
};

// Dialog edycji ups.conf
const NutConfigDialog = ({ config, onSave, onClose }) => {
  const [upsConf,  setUpsConf]  = React.useState(config.ups_conf||'');
  const [upsdConf, setUpsdConf] = React.useState(config.upsd_conf||'');
  const [tab, setTab] = React.useState('ups');
  return (
    <Modal title="Edytor konfiguracji NUT" onClose={onClose} width={700}>
      <div className="segmented" style={{marginBottom:16}}>
        {[['ups','/etc/nut/ups.conf'],['upsd','/etc/nut/upsd.conf']].map(([id,l])=>(
          <button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{l}</button>
        ))}
      </div>
      {tab==='ups' && (
        <textarea value={upsConf} onChange={e=>setUpsConf(e.target.value)}
          style={{width:'100%',height:280,fontFamily:'var(--font-mono)',fontSize:12,background:'var(--bg)',color:'var(--fg)',border:'1px solid var(--line-strong)',borderRadius:6,padding:12,resize:'vertical',outline:'none'}}/>
      )}
      {tab==='upsd' && (
        <textarea value={upsdConf} onChange={e=>setUpsdConf(e.target.value)}
          style={{width:'100%',height:280,fontFamily:'var(--font-mono)',fontSize:12,background:'var(--bg)',color:'var(--fg)',border:'1px solid var(--line-strong)',borderRadius:6,padding:12,resize:'vertical',outline:'none'}}/>
      )}
      <div style={{fontSize:11,color:'var(--warn)',marginTop:8}}>⚠ Zmiany wymagają restartu sterownika NUT</div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,paddingTop:16,borderTop:'1px solid var(--line)'}}>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={()=>{ onSave({ups_conf:upsConf,upsd_conf:upsdConf}); onClose(); }}>
          <Icon name="check" size={12}/> Zapisz i przeładuj
        </button>
      </div>
    </Modal>
  );
};

const UPSScreen = () => {
  const [tab,      setTab]     = React.useState("overview");
  const [data,     setData]    = React.useState(null);
  const [info,     setInfo]    = React.useState(null);
  const [events,   setEvents]  = React.useState([]);
  const [upsmon,   setUpsmon]  = React.useState({});
  const [channels, setChannels]= React.useState([]);
  const [loading,  setLoading] = React.useState(true);
  const [cmdMsg,   setCmdMsg]  = React.useState("");
  const [running,  setRunning] = React.useState("");

  const loadStatus = async () => {
    try { const r=await fetch("/api/ups/status",{credentials:"include"}); setData(await r.json()); }
    catch(e){}
    finally { setLoading(false); }
  };
  const loadInfo = async () => {
    try { const r=await fetch("/api/ups/info",{credentials:"include"}); setInfo(await r.json()); }
    catch(e){}
  };
  const loadEvents = async () => {
    try { const r=await fetch("/api/ups/events",{credentials:"include"}); const d=await r.json(); setEvents(d.events||[]); }
    catch(e){}
  };
  const loadUpsmon = async () => {
    try { const r=await fetch("/api/ups/upsmon",{credentials:"include"}); setUpsmon(await r.json()); }
    catch(e){}
  };
  const [rules,     setRules]    = React.useState([]);
  const [slaves,    setSlaves]   = React.useState([]);
  const [selftests, setSelftests]= React.useState([]);
  const [nutConfig, setNutConfig]= React.useState({});
  const [simMsg,    setSimMsg]   = React.useState("");
  const [ruleDialog,       setRuleDialog]       = React.useState(null); // null|{rule}|{}
  const [shutdownDialog,   setShutdownDialog]   = React.useState(null);
  const [shutdownSteps,    setShutdownSteps]    = React.useState(null); // null = używaj domyślnych
  const [nutConfigDialog,  setNutConfigDialog]  = React.useState(false);

  const loadChannels = async () => {
    try {
      const r=await fetch("/api/notifications/channels",{credentials:"include"});
      const d=await r.json();
      setChannels(Array.isArray(d) ? d : (d.channels||[]));
    } catch(e){}
  };
  const loadRules = async () => {
    try { const r=await fetch("/api/ups/rules",{credentials:"include"}); const d=await r.json(); setRules(d.rules||[]); } catch(e){}
  };
  const loadSlaves = async () => {
    try { const r=await fetch("/api/ups/slaves",{credentials:"include"}); const d=await r.json(); setSlaves(d.slaves||[]); } catch(e){}
  };
  const loadSelftests = async () => {
    try { const r=await fetch("/api/ups/selftests",{credentials:"include"}); const d=await r.json(); setSelftests(d.tests||[]); } catch(e){}
  };
  const loadNutConfig = async () => {
    try { const r=await fetch("/api/ups/nut-config",{credentials:"include"}); setNutConfig(await r.json()); } catch(e){}
  };

  const serviceAction = async (service, action="restart") => {
    const r=await fetch("/api/ups/service",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({service,action})});
    const d=await r.json();
    setCmdMsg("✅ "+d.results?.join(" · "));
    setTimeout(()=>{ setCmdMsg(""); loadStatus(); },3000);
  };

  const simulate = async (type) => {
    setSimMsg("⏳ Symulacja…");
    const r=await fetch("/api/ups/simulate",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({type})});
    const d=await r.json();
    setSimMsg((d.status==="ok"?"✅ ":"⚠ ")+(d.message||d.status));
    setTimeout(()=>setSimMsg(""),5000);
  };

  const saveRule = async (rule) => {
    await fetch("/api/ups/rules",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(rule)});
    loadRules();
  };
  const deleteRule = async (id) => {
    await fetch("/api/ups/rules",{method:"DELETE",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
    loadRules();
  };
  const toggleRule = async (rule) => saveRule({...rule, on: !rule.on});

  const saveShutdownStep = (step) => {
    setShutdownSteps(prev => {
      const base = prev || UPS_SHUTDOWN_SEQ;
      const idx = base.findIndex(s=>s.id===step.id);
      if(idx>=0) { const n=[...base]; n[idx]=step; return n; }
      return [...base, step];
    });
  };
  const deleteShutdownStep = (id) => {
    setShutdownSteps(prev=>(prev||UPS_SHUTDOWN_SEQ).filter(s=>s.id!==id));
  };

  const saveNutConfig = async (cfg) => {
    await fetch("/api/ups/nut-config",{method:"POST",credentials:"include",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(cfg)});
    setTimeout(()=>{ loadNutConfig(); serviceAction("nut-driver","restart"); },500);
    setCmdMsg("✅ Konfiguracja NUT zapisana · restart drivera…");
    setTimeout(()=>setCmdMsg(""),4000);
  };

  React.useEffect(()=>{
    loadStatus().then(()=>{
      setTimeout(loadInfo,500);
      setTimeout(loadEvents,1000);
      setTimeout(loadUpsmon,1500);
      setTimeout(loadChannels,2000);
      setTimeout(loadRules,2500);
      setTimeout(loadSlaves,3000);
      setTimeout(loadSelftests,3500);
      setTimeout(loadNutConfig,4000);
    });
    const id=setInterval(loadStatus,10000);
    return ()=>clearInterval(id);
  },[]);

  const sendCmd = async (cmd) => {
    setRunning(cmd); setCmdMsg("");
    try {
      const r=await fetch("/api/ups/command",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:cmd})});
      const d=await r.json();
      setCmdMsg(d.status==="ok"?`✅ OK — ${d.response||cmd}`:`❌ ${d.error||"błąd"}`);
      setTimeout(()=>setCmdMsg(""),5000);
    } catch(e){setCmdMsg("❌ Błąd");}
    finally{setRunning("");}
  };

  if (loading) return (
    <div style={{padding:60,textAlign:"center",color:"var(--fg-dim)"}}>
      <div style={{width:18,height:18,border:"2px solid var(--line-strong)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin .6s linear infinite",margin:"0 auto 12px"}}/>
      Łączenie z NUT…
    </div>
  );

  if (!data?.connected) return (
    <div className="card" style={{padding:40,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16,opacity:0.3}}>🔌</div>
      <div style={{fontWeight:600,fontSize:"var(--fs-lg)",marginBottom:8}}>Brak połączenia z UPS</div>
      <div style={{color:"var(--err)",fontFamily:"var(--font-mono)",fontSize:"var(--fs-sm)",marginBottom:12}}>{data?.error}</div>
      <div style={{fontSize:"var(--fs-xs)",color:"var(--fg-dim)",marginBottom:20}}>
        Sprawdź: <code>systemctl status nut-server nut-driver</code>
      </div>
      <button className="btn primary" onClick={loadStatus}><Icon name="refresh" size={12}/> Odśwież</button>
    </div>
  );

  const s=data.status||{}, cfg=data.config||{}, nut=data.nut_raw||{};
  const status    = s.status||"on-line";
  const meta      = UPS_STATUS_META[status]||UPS_STATUS_META["on-line"];
  const battPct   = Math.round(s.battery_charge||s.battery_pct||0);
  const loadPct   = Math.round(s.ups_load||s.output_current_pct||0);
  const loadW     = Math.round(s.load_watts||0);
  const battV     = (s.battery_voltage||0).toFixed(2);
  const inputV    = s.input_voltage||0;
  const outputV   = s.output_voltage||0;
  const inputFreq = s.input_freq||0;
  const outputFreq= parseFloat(nut["output.frequency"]||inputFreq||0);
  const temp      = s.temperature||0;
  const runtime   = s.runtime_min||0;
  const ratedVA   = cfg.rated_va||600;
  const upsName   = cfg.ups_name||"moj_ups";
  const host      = cfg.host||"localhost";
  const drvName   = info?.driver_name||nut["driver.name"]||"blazer_usb";
  const drvVer    = info?.driver_ver||nut["driver.version"]||"";
  const topology  = nut["ups.type"]||s.ups_type||"line-interactive";
  const vendor    = nut["device.mfr"]||"PowerWalker";
  const model     = nut["device.model"]||info?.model||"UPS";
  const serial    = nut["device.serial"]||"—";
  const firmware  = nut["ups.firmware"]||"—";
  const port      = nut["driver.parameter.port"]||cfg.port||"/dev/hidraw0";
  const battType  = (nut["battery.voltage.nominal"]||"24")+"V · "+( nut["battery.type"]||"PbAc");
  const capacityW = Math.round(ratedVA*0.8);

  // Dane statyczne / konfiguracyjne
  const UPS_SHUTDOWN_SEQ = [
    {id:1,icon:"bell",   cls:"info",at:"T + 0 s",  what:"Alert — praca na akumulatorze",     detail:"upsmon ONBATT → powiadomienia"},
    {id:2,icon:"server", cls:"warn",at:"T + 60 s", what:"Graceful shutdown — serwery slave",  detail:"FSD do klientów upsmon secondary"},
    {id:3,icon:"server", cls:"warn",at:"T + 120 s",what:"Zamknięcie usług na hoście",         detail:"systemctl stop docker nimbus"},
    {id:4,icon:"power",  cls:"err", at:"T + 180 s",what:"Shutdown systemu hosta",             detail:"shutdown -h +0"},
    {id:5,icon:"bolt",   cls:"err", at:"T + 210 s",what:"UPS odcina zasilanie",               detail:"ups.delay.shutdown = 30s po FSD"},
  ];

  const UPS_RULES = [
    {id:1,on:true, trigger:"on-battery",   after:"natychmiast",action:"Powiadomienie e-mail", target:"admin@nasserver.pl"},
    {id:2,on:true, trigger:"battery < 25%",after:"60s",        action:"Shutdown slave",        target:"192.168.1.101"},
    {id:3,on:true, trigger:"battery < 15%",after:"30s",        action:"Shutdown host",         target:"nimbus.local"},
    {id:4,on:false,trigger:"load > 80%",   after:"300s",       action:"Powiadomienie e-mail",  target:"admin@nasserver.pl"},
  ];

  const UPS_SELFTESTS = [
    {date:"2026-05-19 03:00",mode:"Quick",duration:"12s",result:"ok",  batPct:battPct,runtimeEst:runtime+" min"},
    {date:"2026-05-12 03:00",mode:"Quick",duration:"12s",result:"ok",  batPct:battPct,runtimeEst:runtime+" min"},
    {date:"2026-05-05 03:00",mode:"Quick",duration:"11s",result:"ok",  batPct:battPct-1,runtimeEst:runtime+" min"},
    {date:"2026-05-01 03:00",mode:"Deep", duration:"9m", result:"ok",  batPct:battPct-2,runtimeEst:Math.max(0,runtime-2)+" min"},
    {date:"2026-04-28 03:00",mode:"Quick",duration:"12s",result:"warn",batPct:battPct-3,runtimeEst:Math.max(0,runtime-5)+" min"},
  ];

  const UPS_CONFIG = {
    mode:"standalone", upsName, driver:drvName, port,
    listenAddr:"127.0.0.1", listenPort:"3493",
    pollInterval: nut["driver.parameter.pollinterval"]||"2",
    pollFreq: "5",
    minSupplies: upsmon["MINSUPPLIES"]||"1",
    deadTime:    upsmon["DEADTIME"]||"15",
    rbWarnTime:  upsmon["RBWARNTIME"]||"43200",
    noCommWarnTime: upsmon["NOCOMMWARNTIME"]||"300",
    finalDelay:  upsmon["FINALDELAY"]||"5",
    users:[{name:"nimbus",role:"primary",actions:"SET INSTCMD"},{name:"monitor",role:"secondary",actions:"monitor"}],
  };

  const UPS_SLAVES = [];

  return (
    <div className="col" style={{gap:"var(--gutter)"}}>

      {/* Header */}
      <div className="card" style={{padding:"18px 22px",display:"flex",alignItems:"center",gap:18}}>
        <PowerWalkerLogo/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:18,fontWeight:600,letterSpacing:"-0.015em"}}>{vendor} {model}</span>
            <span className="mono" style={{fontSize:11,color:"var(--fg-dim)"}}>fw {firmware} · S/N {serial}</span>
          </div>
          <div style={{display:"flex",gap:14,marginTop:6,fontSize:12,color:"var(--fg-muted)",flexWrap:"wrap"}}>
            <span><span style={{color:"var(--fg-dim)"}}>topologia:</span> {topology}</span>
            <span><span style={{color:"var(--fg-dim)"}}>moc:</span> {ratedVA} VA / {capacityW} W</span>
            <span><span style={{color:"var(--fg-dim)"}}>port:</span> <span className="mono">{port}</span></span>
            <span><span style={{color:"var(--fg-dim)"}}>driver:</span> <span className="mono">{drvName}</span></span>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div className="mono" style={{fontSize:11,color:"var(--fg-dim)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Ostatni self-test</div>
          <div className="mono" style={{fontSize:13,color:"var(--fg)",marginTop:2}}>{UPS_SELFTESTS[0].date}</div>
          <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",marginTop:4}}>
            <span className="badge ok" style={{fontSize:10}}>PASS</span>
            <span className="mono" style={{fontSize:10,color:"var(--fg-dim)"}}>następny: {UPS_SELFTESTS[1].date.split(" ")[0]} 03:00</span>
          </div>
        </div>
        <button className="btn" style={{flexShrink:0}} onClick={()=>{ loadStatus(); loadInfo(); loadEvents(); }}>
          <Icon name="refresh" size={12}/> Odśwież
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-4">
        <UpsKpi status={status}/>
        <div className="kpi">
          <div className="kpi-label">AKUMULATOR</div>
          <div className="kpi-value">{battPct}<span style={{fontSize:14,color:"var(--fg-dim)",fontWeight:400}}>%</span></div>
          <div className="kpi-foot"><span>{battV} V · {battType.split(" · ")[0]}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">RUNTIME</div>
          <div className="kpi-value">{runtime}<span style={{fontSize:14,color:"var(--fg-dim)",fontWeight:400}}> min</span></div>
          <div className="kpi-foot"><span>przy obecnym obciążeniu {loadPct}%</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">OBCIĄŻENIE</div>
          <div className="kpi-value">{loadW}<span style={{fontSize:14,color:"var(--fg-dim)",fontWeight:400}}> W</span></div>
          <div className="kpi-foot"><span>{loadPct}% pojemności{temp>0?` · temp ${temp.toFixed(1)} °C`:""}</span></div>
        </div>
      </div>

      {/* Gauges + Flow */}
      <div className="grid" style={{gridTemplateColumns:"1fr 1.4fr",gap:"var(--gutter)"}}>
        <div className="card" style={{padding:18}}>
          <div className="card-head" style={{padding:0,border:0,marginBottom:4}}>
            <div><div className="card-title">Stan w czasie rzeczywistym</div><div className="card-sub">aktualizacja co 10 s · NUT poll</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,alignItems:"center"}}>
            <UpsArcGauge value={battPct} label="AKUMULATOR" sub={`${runtime} min`}
              color={battPct>50?"var(--ok)":battPct>20?"var(--warn)":"var(--err)"}/>
            <UpsArcGauge value={loadPct} label="OBCIĄŻENIE" sub={`${loadW} W`}
              color={loadPct>80?"var(--err)":loadPct>60?"var(--warn)":"var(--accent)"}/>
          </div>
        </div>
        <div className="card" style={{padding:18}}>
          <div className="card-head" style={{padding:0,border:0,marginBottom:14}}>
            <div><div className="card-title">Topologia zasilania</div><div className="card-sub">przepływ mocy na żywo</div></div>
            <div className="card-actions">
              <span className="badge" style={{background:meta.color,color:"var(--accent-fg)"}}>{meta.label}</span>
            </div>
          </div>
          <PowerFlow status={status} inputVoltage={inputV} outputVoltage={outputV} loadW={loadW} ratedVA={ratedVA} battPct={battPct}/>
          <div className="grid grid-2" style={{marginTop:14,gap:18}}>
            <VStrip label="WEJŚCIE"   value={inputV}    unit="V"  min={180} max={260} ideal={230} warn={[210,250]}/>
            <VStrip label="WYJŚCIE"   value={outputV}   unit="V"  min={220} max={240} ideal={230} warn={[225,235]}/>
            <VStrip label="WEJŚCIE F" value={inputFreq}  unit="Hz" min={48}  max={52}  ideal={50}  warn={[49.5,50.5]}/>
            <VStrip label="WYJŚCIE F" value={outputFreq} unit="Hz" min={49.5}max={50.5}ideal={50}  warn={[49.8,50.2]}/>
          </div>
        </div>
      </div>

      {/* Voltage history */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Napięcie wejściowe — ostatnia godzina</div><div className="card-sub">zielony pas = strefa nominalna 225–235 V · próbka co 10s</div></div>
          <div className="card-actions">
            <button className="btn" onClick={()=>window.open("/api/ups/voltage-export","_blank")}><Icon name="download" size={12}/> Eksport CSV</button>
          </div>
        </div>
        <VoltageHistory inputVoltage={inputV}/>
      </div>

      {/* Tabs */}
      <div className="segmented">
        {[["overview","Szczegóły urządzenia"],["config","Konfiguracja"],["shutdown","Sekwencja wyłączenia · "+UPS_SHUTDOWN_SEQ.length],["events","Zdarzenia · "+events.length],["rules","Reguły · "+UPS_RULES.length],["selftest","Self-testy"],["raw","Surowe odczyty"]].map(([id,l])=>(
          <button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{l}</button>
        ))}
      </div>

      {tab==="overview" && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><div><div className="card-title">Informacje o urządzeniu</div><div className="card-sub">NUT · upsc {upsName}@{host}</div></div></div>
            <div className="card-body col" style={{gap:8,fontSize:"var(--fs-sm)"}}>
              {[
                ["Producent",   vendor],
                ["Model",       model],
                ["Numer seryjny",serial],
                ["Firmware",    firmware],
                ["Topologia",   topology],
                ["Pojemność",   `${ratedVA} VA · ${capacityW} W`],
                ["Protokół",    "Megatec Q1 (blazer_usb)"],
                ["Driver NUT",  `${drvName}${drvVer?" · "+drvVer:""}`],
                ["Port",        port],
                ["Zainstalowano","—"],
                ["Bateria zainstalowana","—"],
                ["Typ baterii", battType],
              ].map(([k,v])=>(
                <div key={k} style={{display:"grid",gridTemplateColumns:"160px 1fr",gap:8}}>
                  <span style={{color:"var(--fg-dim)"}}>{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Konserwacja</div><div className="card-sub">cykl baterii · self-testy · alerty</div></div></div>
            <div className="card-body col" style={{gap:14}}>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:11,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Zużycie baterii (cykle)</span>
                  <span className="mono" style={{fontSize:12,color:"var(--fg)"}}>147 / 800</span>
                </div>
                <div style={{height:8,background:"var(--bg-3)",borderRadius:4,overflow:"hidden"}}>
                  <div style={{width:"18%",height:"100%",background:"var(--ok)"}}/>
                </div>
                <div style={{fontSize:11,color:"var(--fg-dim)",marginTop:6}}>Bateria w dobrym stanie · szac. żywotność: 4–5 lat</div>
              </div>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:11,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Test głęboki — następny</span>
                  <span className="mono" style={{fontSize:12,color:"var(--fg)"}}>za 5 dni</span>
                </div>
                <div className="mono" style={{fontSize:11,color:"var(--fg-dim)"}}>Niedziela 02:00 · trwa do 12 minut</div>
              </div>
              {cmdMsg && (
                <div style={{padding:"8px 12px",borderRadius:6,fontSize:"var(--fs-sm)",
                  background:cmdMsg.startsWith("✅")?"color-mix(in oklch,var(--ok) 8%,transparent)":"color-mix(in oklch,var(--err) 8%,transparent)",
                  border:"1px solid "+(cmdMsg.startsWith("✅")?"color-mix(in oklch,var(--ok) 25%,transparent)":"color-mix(in oklch,var(--err) 25%,transparent)")
                }}>{cmdMsg}</div>
              )}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn primary" disabled={!!running} onClick={()=>sendCmd("test")}><Icon name="play" size={12}/> Uruchom self-test</button>
                <button className="btn" disabled={!!running} onClick={()=>sendCmd("test_long")}><Icon name="bolt" size={12}/> Test obciążeniowy</button>
                <button className="btn" disabled={!!running} onClick={()=>sendCmd("beeper_toggle")}><Icon name="bell" size={12}/> Wycisz alarm</button>
                <button className="btn" style={{marginLeft:"auto",borderColor:"var(--err)",color:"var(--err)"}} disabled={!!running} onClick={()=>sendCmd("shutdown_return")}><Icon name="power" size={12}/> Wymuś shutdown</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="events" && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Log zdarzeń zasilania</div><div className="card-sub">journalctl -u nut-server · ostatnie {events.length}</div></div>
            <div className="card-actions">
              <button className="btn sm" onClick={loadEvents}><Icon name="refresh" size={11}/> Odśwież</button>
              <button className="btn"><Icon name="download" size={12}/> Eksport</button>
            </div>
          </div>
          {events.length===0 ? (
            <div style={{padding:24,textAlign:"center",color:"var(--fg-dim)",fontSize:"var(--fs-sm)"}}>Brak zdarzeń</div>
          ) : (
            <table className="table">
              <thead><tr><th style={{width:170}}>Czas</th><th style={{width:80}}>Poziom</th><th>Komunikat</th></tr></thead>
              <tbody>
                {events.map((e,i)=>{const m=UPS_EVT_META[e.lvl]||UPS_EVT_META.INFO;return(
                  <tr key={i}>
                    <td className="mono dim" style={{fontSize:11}}>{e.t}</td>
                    <td><span className="badge" style={{background:m.bg,color:m.color,borderColor:`color-mix(in oklch, ${m.color} 30%, transparent)`}}>{e.lvl}</span></td>
                    <td className="mono" style={{fontSize:12}}>{e.msg}</td>
                  </tr>
                );})}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab==="rules" && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Reguły reakcji na zdarzenia zasilania</div><div className="card-sub">wykonywane sekwencyjnie według priorytetu</div></div>
            <div className="card-actions"><button className="btn primary" onClick={()=>setRuleDialog({})}><Icon name="plus" size={12}/> Nowa reguła</button></div>
          </div>
          <div className="card-body col" style={{gap:10}}>
            {(rules.length>0?rules:UPS_RULES).map((r,i)=>(
              <div key={r.id} style={{display:"grid",gridTemplateColumns:"32px 1fr 1fr 1.4fr 1fr auto",gap:12,alignItems:"center",padding:"12px 14px",borderRadius:8,background:r.on?"var(--bg-2)":"color-mix(in oklch, var(--bg-2) 40%, transparent)",border:"1px solid var(--line)",opacity:r.on?1:0.55}}>
                <div className="mono" style={{fontSize:11,color:"var(--fg-dim)",textAlign:"center"}}>#{i+1}</div>
                <div><div style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Wyzwalacz</div><div className="mono" style={{fontSize:13,color:r.on?"var(--accent)":"var(--fg-dim)"}}>{r.trigger}</div></div>
                <div><div style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Opóźnienie</div><div className="mono" style={{fontSize:13}}>{r.after}</div></div>
                <div><div style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Akcja</div><div className="mono" style={{fontSize:12}}>{r.action}</div><div style={{fontSize:11,color:"var(--fg-muted)",marginTop:2}}>{r.target}</div></div>
                <div><div style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</div><span className={"badge "+(r.on?"ok":"")}>{r.on?"aktywna":"wyłączona"}</span></div>
                <div style={{display:"flex",gap:4}}>
                  <button className="icon-btn" onClick={()=>setRuleDialog(r)} title="Edytuj"><Icon name="edit" size={12}/></button>
                  <button className="icon-btn" onClick={()=>toggleRule(r)} title={r.on?"Wyłącz":"Włącz"}><Icon name={r.on?"pause":"play"} size={12}/></button>
                  <button className="icon-btn" onClick={()=>deleteRule(r.id)} title="Usuń"><Icon name="trash" size={12}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="selftest" && (
        <div className="grid" style={{gridTemplateColumns:"1fr 1.6fr",gap:"var(--gutter)"}}>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Harmonogram testów</div></div></div>
            <div className="card-body col" style={{gap:12,fontSize:"var(--fs-sm)"}}>
              {[["Quick (12 s)","co tydzień · niedz 03:00"],["Deep (12 min)","co miesiąc · 1. niedz 03:00"],["Auto-anulowanie","load > 70%"],["Powiadomienia","tylko po fail"]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--fg-dim)"}}>{k}</span><span className="mono">{v}</span></div>
              ))}
              <button className="btn primary" style={{marginTop:8}} disabled={!!running} onClick={()=>sendCmd("test")}><Icon name="play" size={12}/> Uruchom teraz (10s)</button>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Historia testów</div><div className="card-sub">z journalctl · ostatnie {(selftests.length||UPS_SELFTESTS.length)}</div></div></div>
            <table className="table">
              <thead><tr><th>Data</th><th>Tryb</th><th>Czas</th><th>Wynik</th><th>Bateria po</th><th>Szac. runtime</th></tr></thead>
              <tbody>
                {(selftests.length>0?selftests:UPS_SELFTESTS).map((t,i)=>(
                  <tr key={i}>
                    <td className="mono">{t.date}</td><td>{t.mode}</td><td className="mono dim">{t.duration}</td>
                    <td><span className={"badge "+(t.result==="ok"?"ok":t.result==="warn"?"warn":"err")}>{t.result.toUpperCase()}</span></td>
                    <td className="mono">{t.batPct}%</td><td className="mono dim">{t.runtimeEst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==="config" && (
        <div className="col" style={{gap:"var(--gutter)"}}>
          <div className="card" style={{padding:"14px 18px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:38,height:38,borderRadius:8,background:"color-mix(in oklch, var(--ok) 18%, transparent)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--ok)"}}>
              <Icon name="shield" size={18}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600}}>NUT (Network UPS Tools) · <span className="mono" style={{color:"var(--ok)"}}>upsd</span> aktywny</div>
              <div className="mono" style={{fontSize:11,color:"var(--fg-muted)",marginTop:2}}>
                nasłuchuje na <span style={{color:"var(--fg)"}}>{UPS_CONFIG.listenAddr}:{UPS_CONFIG.listenPort}</span> · {upsName}@{host} · driver: {drvName} · {UPS_SLAVES.length} klientów zdalnych
              </div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn" onClick={()=>serviceAction("nut-server","reload")}><Icon name="refresh" size={12}/> Reload upsd</button>
              <button className="btn" onClick={()=>serviceAction("all","restart")}><Icon name="refresh" size={12}/> Restart wszystkich</button>
            </div>
          </div>

          <div className="grid" style={{gridTemplateColumns:"1fr 1fr",gap:"var(--gutter)"}}>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Połączenie z UPS</div><div className="card-sub">driver NUT · /etc/nut/ups.conf</div></div><span className="badge ok">połączony</span></div>
              <div className="card-body" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <Field label="Tryb pracy" span={2}>
                  <Seg value={UPS_CONFIG.mode} onChange={()=>{}} options={[["standalone","Standalone"],["netserver","Net-Server"],["netclient","Net-Client"]]}/>
                </Field>
                <Field label="Nazwa urządzenia"><input className="input mono" defaultValue={UPS_CONFIG.upsName} readOnly/></Field>
                <Field label="Driver">
                  <select className="select mono" defaultValue={UPS_CONFIG.driver}>
                    <option>blazer_usb</option><option>usbhid-ups</option><option>nutdrv_qx</option><option>snmp-ups</option>
                  </select>
                </Field>
                <Field label="Port" hint="urządzenie USB HID" span={2}><input className="input mono" defaultValue={UPS_CONFIG.port} readOnly/></Field>
                <Field label="Listen address"><input className="input mono" defaultValue={UPS_CONFIG.listenAddr}/></Field>
                <Field label="Listen port"><input className="input mono" defaultValue={UPS_CONFIG.listenPort}/></Field>
                <Field label="Polling — szybkie"><input className="input mono" defaultValue={UPS_CONFIG.pollInterval}/></Field>
                <Field label="Polling — pełne"><input className="input mono" defaultValue={UPS_CONFIG.pollFreq}/></Field>
              </div>
              <ConfigRow label="Automatyczny restart drivera" hint="po utracie komunikacji z UPS przez > 30 s"><span className="toggle on"/></ConfigRow>
              <ConfigRow label="Edytuj konfigurację NUT" hint="ups.conf · upsd.conf">
                <button className="btn sm" onClick={()=>{ loadNutConfig().then(()=>setNutConfigDialog(true)); }}>
                  <Icon name="edit" size={11}/> Otwórz edytor
                </button>
              </ConfigRow>
            </div>

            <div className="card">
              <div className="card-head"><div><div className="card-title">upsmon — monitor i reakcja</div><div className="card-sub">/etc/nut/upsmon.conf · master</div></div><span className="badge" style={{background:"color-mix(in oklch, var(--accent) 14%, transparent)",color:"var(--accent)"}}>PRIMARY</span></div>
              <div className="card-body" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <Field label="MINSUPPLIES" hint="ilu UPS musi działać"><input className="input mono" defaultValue={UPS_CONFIG.minSupplies}/></Field>
                <Field label="DEADTIME (s)"><input className="input mono" defaultValue={UPS_CONFIG.deadTime}/></Field>
                <Field label="RBWARNTIME (s)"><input className="input mono" defaultValue={UPS_CONFIG.rbWarnTime}/></Field>
                <Field label="NOCOMMWARNTIME (s)"><input className="input mono" defaultValue={UPS_CONFIG.noCommWarnTime}/></Field>
                <Field label="FINALDELAY (s)"><input className="input mono" defaultValue={UPS_CONFIG.finalDelay}/></Field>
                <Field label="POWERDOWNFLAG"><input className="input mono" defaultValue="/etc/killpower"/></Field>
              </div>
              <div className="card-body" style={{paddingTop:0}}>
                <div style={{fontSize:10,color:"var(--fg-dim)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:8}}>Konta NUT</div>
                <table className="table" style={{marginTop:4}}>
                  <thead><tr><th>Nazwa</th><th>Rola</th><th>Uprawnienia</th><th></th></tr></thead>
                  <tbody>{UPS_CONFIG.users.map(u2=>(
                    <tr key={u2.name}>
                      <td className="mono">{u2.name}</td>
                      <td><span className={"badge "+(u2.role==="primary"?"ok":u2.role==="admin"?"warn":"")}>{u2.role}</span></td>
                      <td className="mono dim" style={{fontSize:11}}>{u2.actions}</td>
                      <td style={{textAlign:"right"}}><button className="icon-btn"><Icon name="edit" size={12}/></button></td>
                    </tr>
                  ))}</tbody>
                </table>
                <button className="btn" style={{marginTop:10}}><Icon name="plus" size={12}/> Dodaj konto</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Powiadomienia o zdarzeniach zasilania</div><div className="card-sub">kanały z panelu Powiadomień Nimbus</div></div>
              <div className="card-actions">
                <button className="btn" onClick={()=>{ window.location.hash="notifications"; }}><Icon name="link" size={12}/> Zarządzaj kanałami</button>
              </div>
            </div>
            {channels.length===0 ? (
              <div style={{padding:24,textAlign:"center",color:"var(--fg-dim)",fontSize:"var(--fs-sm)"}}>
                Brak skonfigurowanych kanałów.<br/>
                <button className="btn primary" style={{marginTop:12}} onClick={()=>{ window.location.hash="notifications"; }}>
                  <Icon name="plus" size={12}/> Skonfiguruj powiadomienia
                </button>
              </div>
            ) : (
              <table className="table">
                <thead><tr><th style={{width:40}}/><th>Kanał</th><th>Typ</th><th>Cel</th><th style={{width:80}}/></tr></thead>
                <tbody>{channels.map(c=>(
                  <tr key={c.id||c.name}>
                    <td><span className={"toggle"+(c.enabled?" on":"")}/></td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Icon name={c.type==="email"?"mail":c.type==="telegram"?"send":c.type==="discord"?"link":"bell"} size={13}/>
                        <span style={{fontWeight:600,fontSize:12}}>{c.name}</span>
                      </div>
                    </td>
                    <td><span className="badge mono" style={{fontSize:10}}>{c.type}</span></td>
                    <td className="mono" style={{fontSize:11}}>{c.target||c.chat_id||c.user_key||"—"}</td>
                    <td style={{textAlign:"right"}}>
                      <button className="icon-btn" title="Wyślij test" onClick={async()=>{ await fetch("/api/notifications/channels/"+c.id+"/test",{method:"POST",credentials:"include"}); }}><Icon name="send" size={12}/></button>
                      <button className="icon-btn" onClick={()=>{ window.location.hash="notifications"; }}><Icon name="edit" size={12}/></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Klienci zdalni (upsmon slaves)</div><div className="card-sub">hosty oczekujące na sygnał FSD z {host}</div></div>
              <div className="card-actions">
                <button className="btn" onClick={()=>window.open("/api/ups/client-config","_blank")}><Icon name="download" size={12}/> Pobierz upsmon.conf dla klienta</button>
                <button className="btn primary"><Icon name="plus" size={12}/> Autoryzuj nowego</button>
              </div>
            </div>
            {slaves.length===0 ? (
              <div style={{padding:20,textAlign:"center",color:"var(--fg-dim)",fontSize:"var(--fs-sm)"}}>
                Brak podłączonych klientów zdalnych
                <div style={{marginTop:6,fontSize:"var(--fs-xs)"}}>Pobierz konfigurację niżej i skonfiguruj klientów upsmon</div>
              </div>
            ) : (
              <table className="table">
                <thead><tr><th>Host</th><th>Rola</th><th>Status</th><th></th></tr></thead>
                <tbody>{slaves.map(sl=>(
                  <tr key={sl.host}>
                    <td className="mono">{sl.host}</td>
                    <td><span className="badge">{sl.role}</span></td>
                    <td><span className={"badge "+(sl.state==="ok"?"ok":"warn")}>{sl.state}</span></td>
                    <td style={{textAlign:"right"}}><button className="icon-btn"><Icon name="trash" size={12}/></button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab==="shutdown" && (
        <div className="grid" style={{gridTemplateColumns:"1.7fr 1fr",gap:"var(--gutter)"}}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Kaskada wyłączania po utracie zasilania</div><div className="card-sub">etapy sekwencyjne · T = moment przejścia na akumulator</div></div>
              <div className="card-actions">
                <button className="btn" onClick={()=>simulate("onbattery")}><Icon name="play" size={12}/> Symuluj awarię</button>
                <button className="btn primary" onClick={()=>setShutdownDialog({})}><Icon name="plus" size={12}/> Dodaj etap</button>
              </div>
            </div>
            <div className="card-body">
              <ShutdownSequence steps={shutdownSteps||UPS_SHUTDOWN_SEQ}
                onEdit={step=>setShutdownDialog(step)}
                onDelete={id=>deleteShutdownStep(id)}/>
            </div>
          </div>
          <div className="col" style={{gap:"var(--gutter)"}}>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Parametry globalne</div></div></div>
              <div className="card-body" style={{paddingTop:4}}>
                <ConfigRow label="Auto-shutdown systemu" hint="wyłącz gdy spełniony próg krytyczny"><span className="toggle on"/></ConfigRow>
                <ConfigRow label="Próg krytyczny — bateria"><input className="input mono" style={{width:80,textAlign:"right"}} defaultValue="10"/><span className="mono dim" style={{fontSize:11}}>%</span></ConfigRow>
                <ConfigRow label="Próg krytyczny — runtime"><input className="input mono" style={{width:80,textAlign:"right"}} defaultValue="3"/><span className="mono dim" style={{fontSize:11}}>min</span></ConfigRow>
                <ConfigRow label="Grace period FSD"><input className="input mono" style={{width:80,textAlign:"right"}} defaultValue="90"/><span className="mono dim" style={{fontSize:11}}>s</span></ConfigRow>
                <ConfigRow label="Odetnij zasilanie UPS po FSD" hint="shutdown.stayoff"><span className="toggle on"/></ConfigRow>
                <ConfigRow label="Auto-start po powrocie sieci"><span className="toggle on"/></ConfigRow>
                <ConfigRow label="Dry-run mode" hint="loguj zamiast wykonywać · do testów" danger><span className="toggle"/></ConfigRow>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Wczesny test sekwencji</div><div className="card-sub">bezpieczna symulacja na żywym systemie</div></div></div>
              <div className="card-body col" style={{gap:8}}>
                {simMsg && <div style={{padding:"8px 10px",borderRadius:6,fontSize:"var(--fs-xs)",background:"color-mix(in oklch,var(--accent) 8%,transparent)",border:"1px solid color-mix(in oklch,var(--accent) 25%,transparent)"}}>{simMsg}</div>}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0"}}>
                  <span style={{fontSize:12}}>Symuluj <span className="mono">on-battery</span> (test baterii 10s)</span>
                  <button className="btn" onClick={()=>simulate("onbattery")}><Icon name="play" size={12}/> Uruchom</button>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:"1px dashed var(--line)"}}>
                  <span style={{fontSize:12}}>Symuluj <span className="mono">battery &lt; 25%</span></span>
                  <button className="btn" onClick={()=>simulate("lowbattery")}><Icon name="play" size={12}/> dry-run</button>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:"1px dashed var(--line)"}}>
                  <span style={{fontSize:12,color:"var(--err)"}}>Wymuś FSD (poweroff!)</span>
                  <button className="btn" style={{borderColor:"var(--err)",color:"var(--err)"}} onClick={()=>simulate("fsd")}><Icon name="bolt" size={12}/> Wykonaj</button>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Parametry upsmon</div><div className="card-sub">/etc/nut/upsmon.conf</div></div></div>
              <div className="card-body col" style={{gap:8,fontSize:"var(--fs-sm)"}}>
                {[["MINSUPPLIES",UPS_CONFIG.minSupplies,"min. UPS"],["DEADTIME",UPS_CONFIG.deadTime,"s"],["FINALDELAY",UPS_CONFIG.finalDelay,"s"],["ups.delay.shutdown",nut["ups.delay.shutdown"]||"30","s"],["ups.delay.start",nut["ups.delay.start"]||"180","s"]].map(([k,v,u2])=>(
                  <div key={k} style={{display:"grid",gridTemplateColumns:"160px 50px 1fr",gap:8,alignItems:"baseline"}}>
                    <span className="mono" style={{fontSize:"var(--fs-xs)",color:"var(--fg-dim)"}}>{k}</span>
                    <span className="mono" style={{fontWeight:600}}>{v}</span>
                    <span style={{fontSize:"var(--fs-xs)",color:"var(--fg-muted)"}}>{u2}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="raw" && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">upsc {upsName}@{host}</div><div className="card-sub">surowe zmienne NUT · {Object.keys(nut).length} pól</div></div>
            <div className="card-actions"><button className="btn sm" onClick={loadStatus}><Icon name="refresh" size={11}/> Odśwież</button></div>
          </div>
          <div style={{padding:"12px 16px",fontFamily:"var(--font-mono)",fontSize:"var(--fs-xs)",color:"var(--fg-muted)",lineHeight:1.75,background:"var(--bg)"}}>
            {Object.keys(nut).sort().map(k=>(
              <div key={k}><span style={{color:"var(--fg-dim)"}}>{k}:</span> {nut[k]}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dialogi modalne ── */}
      {ruleDialog !== null && (
        <RuleDialog rule={ruleDialog} onSave={saveRule} onClose={()=>setRuleDialog(null)}/>
      )}
      {shutdownDialog !== null && (
        <ShutdownStepDialog step={shutdownDialog} onSave={saveShutdownStep} onClose={()=>setShutdownDialog(null)}/>
      )}
      {nutConfigDialog && (
        <NutConfigDialog config={nutConfig} onSave={saveNutConfig} onClose={()=>setNutConfigDialog(false)}/>
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
