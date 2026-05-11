// ===== Shell components =====
const Icon = window.Icon;

function genSeries(seed, n = 32, base = 50, amp = 30) {
  const out = []; let v = base;
  for (let i = 0; i < n; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    v = Math.max(5, Math.min(95, v + (seed/233280 - 0.5) * amp * 0.6));
    out.push(v);
  }
  return out;
}

const Sparkline = ({ data, color = "var(--accent)", fill = true, height = 26 }) => {
  if (!data || !data.length) return null;
  const w = 200, h = height;
  const min = Math.min(...data), max = Math.max(...data), range = Math.max(1, max - min);
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-((v-min)/range)*(h-4)-2}`);
  const path = "M " + pts.join(" L ");
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={`M 0,${h} L ${pts.join(" L ")} L ${w},${h} Z`} fill={color} opacity="0.12"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5"/>
    </svg>
  );
};

const LineChart = ({ series, height=180, colors=["var(--accent)","oklch(0.7 0.15 280)"], labels=[] }) => {
  const w=800,h=height,pad=28;
  if (!series.length) return null;
  const n=series[0].length, all=series.flat();
  const min=Math.min(...all),max=Math.max(...all),range=Math.max(1,max-min);
  const x=i=>pad+(i/(n-1))*(w-pad*2), y=v=>h-pad-((v-min)/range)*(h-pad*2);
  return (
    <svg className="line-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {[.25,.5,.75].map((p,i)=><line key={i} x1={pad} x2={w-pad} y1={h-pad-p*(h-pad*2)} y2={h-pad-p*(h-pad*2)} stroke="var(--line)" strokeDasharray="2 4"/>)}
      {series.map((s,si)=>{
        const path="M "+s.map((v,i)=>`${x(i)},${y(v)}`).join(" L ");
        const area=`M ${x(0)},${h-pad} L ${s.map((v,i)=>`${x(i)},${y(v)}`).join(" L ")} L ${x(n-1)},${h-pad} Z`;
        return <g key={si}><path d={area} fill={colors[si]} opacity="0.1"/><path d={path} fill="none" stroke={colors[si]} strokeWidth="1.8"/></g>;
      })}
      {labels.map((l,i)=><text key={i} x={pad+i*((w-pad*2)/(labels.length-1))} y={h-8} fontSize="10" fill="var(--fg-dim)" textAnchor="middle" fontFamily="var(--font-mono)">{l}</text>)}
    </svg>
  );
};

const Donut = ({ value, max=100, label, color="var(--accent)", size=110, thickness=10 }) => {
  const r=(size-thickness)/2, c=2*Math.PI*r, pct=Math.min(1,value/max);
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} stroke="var(--bg-3)" strokeWidth={thickness} fill="none"/>
      <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={thickness} fill="none"
        strokeDasharray={`${c*pct} ${c}`} strokeDashoffset={c*.25} transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="round"/>
      <text x="50%" y="48%" textAnchor="middle" fontSize="20" fontFamily="var(--font-mono)" fill="var(--fg)" fontWeight="500">{Math.round(pct*100)}%</text>
      {label && <text x="50%" y="65%" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)">{label}</text>}
    </svg>
  );
};

// ── Sidebar ulepszone ─────────────────────────────────────────────────────────
const Sidebar = ({ active, onNav }) => {
  const [search,    setSearch]    = React.useState('');
  const [collapsed, setCollapsed] = React.useState({});
  const [pinned,    setPinned]    = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('nimbus_pins') || '[]'); } catch { return []; }
  });
  const searchRef = React.useRef(null);

  // Moduły — reaguj na zmiany
  const [mods, setMods] = React.useState(() =>
    typeof window.useModules === 'function' ? {} : {}
  );
  React.useEffect(() => {
    if (!window.useModules) return;
    // Subskrybuj zmiany modułów
    const unsub = window._onModuleChange && window._onModuleChange(setMods);
    return unsub;
  }, []);

  // Buduj NAV z filtrowaniem wyłączonych modułów
  const nav = React.useMemo(() => {
    const base = window.NAV || [];
    return base.map(g => ({
      ...g,
      items: g.items.filter(it =>
        window.moduleEnabled ? window.moduleEnabled(it.id) !== false : true
      ),
    })).filter(g => g.items.length > 0);
  }, [mods]); // przelicz gdy moduły się zmienią

  // Wyszukiwanie
  const filtered = React.useMemo(() => {
    if (!search.trim()) return nav;
    const q = search.toLowerCase();
    return nav.map(g => ({
      ...g,
      items: g.items.filter(it => it.label.toLowerCase().includes(q) || it.id.includes(q)),
    })).filter(g => g.items.length > 0);
  }, [search, nav]);

  const togglePin = (id, e) => {
    e.stopPropagation();
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(p=>p!==id) : [...prev, id];
      localStorage.setItem('nimbus_pins', JSON.stringify(next));
      return next;
    });
  };

  const toggleCollapse = (group, e) => {
    e.stopPropagation();
    setCollapsed(c => ({...c, [group]: !c[group]}));
  };

  // Szybkie skróty klawiszowe: Ctrl+K
  React.useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const groupIcons = {
    'Przegląd': 'dashboard', 'Magazyn': 'disk', 'Aplikacje': 'docker',
    'Sieć': 'network', 'System': 'settings', 'Administracja': 'users',
  };

  // Wszystkie itemy dla pinów
  const allItems = (window.NAV||[]).flatMap(g=>g.items);
  const pinnedItems = pinned.map(id => allItems.find(it=>it.id===id)).filter(Boolean);

  return (
    <aside className="side">
      {/* Branding */}
      <div className="side-brand">
        <div className="side-logo">N</div>
        <div className="side-name-wrap">
          <div className="side-name">Nimbus NAS</div>
          <div className="side-sub">v3.5 · stable</div>
        </div>
      </div>

      {/* Wyszukiwarka */}
      <div style={{padding:'0 12px 10px',position:'relative'}}>
        <div style={{
          display:'flex',alignItems:'center',gap:8,
          background:'var(--bg-2)',border:'1px solid var(--line-strong)',
          borderRadius:8,padding:'7px 10px',cursor:'text',
        }} onClick={()=>searchRef.current?.focus()}>
          <Icon name="search" size={13} style={{color:'var(--fg-dim)',flexShrink:0}}/>
          <input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Szukaj…"
            style={{background:'none',border:'none',outline:'none',width:'100%',
              fontSize:'var(--fs-xs)',color:'var(--fg)',fontFamily:'var(--font-ui)'}}/>
          {search
            ? <button onClick={()=>setSearch('')} style={{background:'none',border:'none',
                cursor:'pointer',color:'var(--fg-dim)',padding:0,lineHeight:1}}>✕</button>
            : <kbd style={{fontSize:10,color:'var(--fg-dim)',background:'var(--bg-3)',
                borderRadius:4,padding:'1px 5px',fontFamily:'var(--font-mono)'}}>⌃K</kbd>
          }
        </div>
      </div>

      <nav className="side-nav" style={{flex:1,overflowY:'auto'}}>

        {/* Przypięte */}
        {!search && pinnedItems.length > 0 && (
          <div style={{marginBottom:4}}>
            <div className="side-section-label" style={{display:'flex',alignItems:'center',gap:6}}>
              <span>📌</span> Przypięte
            </div>
            {pinnedItems.map(it => (
              <NavItem key={it.id} it={it} active={active} onNav={onNav}
                pinned={pinned} onPin={togglePin} showPin/>
            ))}
          </div>
        )}

        {/* Grupy */}
        {filtered.map((g, gi) => (
          <div key={gi} style={{marginBottom:2}}>
            <div className="side-section-label"
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',
                userSelect:'none',paddingRight:8}}
              onClick={e=>toggleCollapse(g.group,e)}>
              <span style={{display:'flex',alignItems:'center',gap:6}}>
                <Icon name={groupIcons[g.group]||'settings'} size={11}
                  style={{color:'var(--fg-dim)',opacity:.6}}/>
                {g.group}
              </span>
              <span style={{fontSize:10,color:'var(--fg-dim)',transform:collapsed[g.group]?'rotate(-90deg)':'',
                transition:'transform .15s',display:'inline-block'}}>▾</span>
            </div>
            {!collapsed[g.group] && g.items.map(it => (
              <NavItem key={it.id} it={it} active={active} onNav={onNav}
                pinned={pinned} onPin={togglePin} showPin={!search}/>
            ))}
          </div>
        ))}

        {/* Brak wyników */}
        {filtered.length === 0 && (
          <div style={{padding:'20px 16px',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>
            Brak wyników dla „{search}"
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="side-foot">
        <SidebarFooter/>
      </div>
    </aside>
  );
};

const NavItem = ({ it, active, onNav, pinned, onPin, showPin }) => {
  const [hover, setHover] = React.useState(false);
  const isPinned = pinned.includes(it.id);
  return (
    <div
      className={"nav-item" + (active===it.id?" active":"")}
      onClick={() => onNav(it.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={it.label}
      style={{position:'relative'}}>
      <span className="nav-icon"><Icon name={it.icon} size={16}/></span>
      <span className="nav-label">{it.label}</span>
      {/* Badges */}
      {it.badge && <span className="nav-badge">{it.badge}</span>}
      {it.badgeAlert && <span className="nav-badge alert">{it.badgeAlert}</span>}
      {/* Pin button */}
      {showPin && hover && (
        <button
          onClick={e=>onPin(it.id,e)}
          title={isPinned?'Odepnij':'Przypnij'}
          style={{
            position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',
            background:'none',border:'none',cursor:'pointer',padding:'2px 4px',
            color: isPinned ? 'var(--accent)' : 'var(--fg-dim)',
            fontSize:12,lineHeight:1,borderRadius:4,
            opacity: isPinned ? 1 : 0.6,
          }}>
          📌
        </button>
      )}
    </div>
  );
};

// Footer z live danymi
const SidebarFooter = () => {
  const OV = window.useStore ? window.useStore('OVERVIEW') : null;
  const uptime = OV?.uptime || '—';
  const load   = OV?.cpu?.load?.[0]?.toFixed(2) || '—';
  const kernel  = OV?.kernel || '—';
  return (
    <>
      <div className="foot-row"><span>uptime</span><span className="v">{uptime}</span></div>
      <div className="foot-row"><span>load</span><span className="v">{load}</span></div>
      <div className="foot-row"><span>kernel</span><span className="v" style={{fontFamily:'var(--font-mono)',fontSize:10}}>{kernel}</span></div>
    </>
  );
};

const Topbar = ({ crumbs, theme, onTheme }) => (
  <header className="topbar">
    <div className="crumb">
      {crumbs.map((c,i) => (
        <span key={i}>{i>0&&" / "}{i===crumbs.length-1?<b>{c}</b>:c}</span>
      ))}
    </div>
    <div className="topbar-search">
      <Icon name="search" size={14}/>
      <input placeholder="Szukaj — udziałów, kontenerów, użytkowników…"/>
      <kbd>⌘K</kbd>
    </div>
    <div className="topbar-actions">
      <button className="icon-btn" onClick={onTheme} title="Motyw">
        <span style={{fontSize:11,fontFamily:'var(--font-mono)'}}>{theme==="dark"?"🌙 ciemny":"☀️ jasny"}</span>
      </button>
      <button className="icon-btn" title="Powiadomienia"><Icon name="bell" size={16}/></button>
      <div className="user-chip">
        <div className="avatar">N</div>
        <span>root</span>
      </div>
    </div>
  </header>
);

window.Sparkline = Sparkline;
window.LineChart = LineChart;
window.Donut     = Donut;
window.Sidebar   = Sidebar;
window.Topbar    = Topbar;
window.genSeries = genSeries;
