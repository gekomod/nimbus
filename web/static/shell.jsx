// ===== Shell components =====
const Icon = window.Icon;

// Sparkline generator (deterministic per seed)
function genSeries(seed, n = 32, base = 50, amp = 30) {
  const out = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const r = seed / 233280;
    v = Math.max(5, Math.min(95, v + (r - 0.5) * amp * 0.6));
    out.push(v);
  }
  return out;
}

const Sparkline = ({ data, color = "var(--accent)", fill = true, height = 26 }) => {
  if (!data || !data.length) return null;
  const w = 200, h = height;
  const min = Math.min(...data), max = Math.max(...data);
  const range = Math.max(1, max - min);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`);
  const path = "M " + pts.join(" L ");
  const area = `M 0,${h} L ${pts.join(" L ")} L ${w},${h} Z`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const LineChart = ({ series, height = 180, colors = ["var(--accent)", "oklch(0.7 0.15 280)"], labels = [] }) => {
  const w = 800, h = height, pad = 28;
  if (!series.length) return null;
  const n = series[0].length;
  const all = series.flat();
  const min = Math.min(...all), max = Math.max(...all);
  const range = Math.max(1, max - min);
  const x = i => pad + (i / (n - 1)) * (w - pad * 2);
  const y = v => h - pad - ((v - min) / range) * (h - pad * 2);
  const grid = [0.25, 0.5, 0.75].map(p => h - pad - p * (h - pad * 2));
  return (
    <svg className="line-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {grid.map((gy, i) => (
        <line key={i} x1={pad} x2={w - pad} y1={gy} y2={gy} stroke="var(--line)" strokeDasharray="2 4" />
      ))}
      {series.map((s, si) => {
        const path = "M " + s.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
        const area = `M ${x(0)},${h - pad} L ${s.map((v, i) => `${x(i)},${y(v)}`).join(" L ")} L ${x(n - 1)},${h - pad} Z`;
        return (
          <g key={si}>
            <path d={area} fill={colors[si]} opacity="0.1" />
            <path d={path} fill="none" stroke={colors[si]} strokeWidth="1.8" />
          </g>
        );
      })}
      {labels.length > 0 && labels.map((l, i) => (
        <text key={i} x={pad + i * ((w - pad * 2) / (labels.length - 1))} y={h - 8} fontSize="10" fill="var(--fg-dim)" textAnchor="middle" fontFamily="var(--font-mono)">{l}</text>
      ))}
    </svg>
  );
};

const Donut = ({ value, max = 100, label, color = "var(--accent)", size = 110, thickness = 10 }) => {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} stroke="var(--bg-3)" strokeWidth={thickness} fill="none" />
      <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={thickness} fill="none"
        strokeDasharray={`${c * pct} ${c}`} strokeDashoffset={c * 0.25} transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="round" />
      <text x="50%" y="48%" textAnchor="middle" fontSize="20" fontFamily="var(--font-mono)" fill="var(--fg)" fontWeight="500">{Math.round(pct * 100)}%</text>
      {label && <text x="50%" y="65%" textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)">{label}</text>}
    </svg>
  );
};

// Sidebar
const Sidebar = ({ active, onNav, sideStyle }) => (
  <aside className="side">
    <div className="side-brand">
      <div className="side-logo">N</div>
      <div className="side-name-wrap">
        <div className="side-name">Nimbus NAS</div>
        <div className="side-sub">v3.4.2 · stable</div>
      </div>
    </div>
    <nav className="side-nav">
      {window.NAV.map((g, gi) => (
        <div key={gi}>
          <div className="side-section-label">{g.group}</div>
          {g.items.map(it => (
            <div key={it.id}
              className={"nav-item" + (active === it.id ? " active" : "")}
              onClick={() => onNav(it.id)}
              title={it.label}>
              <span className="nav-icon"><Icon name={it.icon} size={16} /></span>
              <span className="nav-label">{it.label}</span>
              {it.badge && <span className="nav-badge">{it.badge}</span>}
              {it.badgeAlert && <span className="nav-badge alert">{it.badgeAlert}</span>}
            </div>
          ))}
        </div>
      ))}
    </nav>
    <div className="side-foot">
      <div className="foot-row"><span>uptime</span><span className="v">42d 11h</span></div>
      <div className="foot-row"><span>load</span><span className="v">0.42 0.38 0.41</span></div>
      <div className="foot-row"><span>kernel</span><span className="v">6.8.0-31</span></div>
    </div>
  </aside>
);

const Topbar = ({ crumbs, theme, onTheme }) => (
  <header className="topbar">
    <div className="crumb">
      {crumbs.map((c, i) => (
        <span key={i}>{i > 0 && " / "}{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>
      ))}
    </div>
    <div className="topbar-search">
      <Icon name="search" size={14} />
      <input placeholder="Szukaj — udziałów, kontenerów, użytkowników…" />
      <kbd>⌘K</kbd>
    </div>
    <div className="topbar-actions">
      <button className="icon-btn" onClick={onTheme} title="Motyw">
        {theme === "dark" ? <Icon name="check" size={14} /> : <Icon name="check" size={14} />}
        <span style={{fontSize:11,fontFamily:'var(--font-mono)',marginLeft:4}}>{theme === "dark" ? "ciemny" : "jasny"}</span>
      </button>
      <button className="icon-btn" title="Powiadomienia"><Icon name="bell" size={16} /></button>
      <div className="user-chip">
        <div className="avatar">JN</div>
        <span>kuba</span>
      </div>
    </div>
  </header>
);

window.Sparkline = Sparkline;
window.LineChart = LineChart;
window.Donut = Donut;
window.Sidebar = Sidebar;
window.Topbar = Topbar;
window.genSeries = genSeries;
