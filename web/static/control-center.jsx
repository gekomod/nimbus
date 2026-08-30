// Nimbus Control Center — alternate React shell and dashboard.
// Backend/API stays unchanged: every value comes from the existing Go endpoints/store.
(() => {
  const Icon = window.Icon;
  const useStore = window.useStore;

  const ControlNavigation = ({ active, onNav }) => {
    const nav = (window.NAV || []).filter(group =>
      group.items.some(item => !window.moduleEnabled || window.moduleEnabled(item.id) !== false)
    );
    const currentGroup = nav.find(group => group.items.some(item => item.id === active)) || nav[0];
    const [open, setOpen] = React.useState(null);

    const select = (id) => {
      onNav(id);
      setOpen(null);
    };

    return (
      <div className="cc-shell-nav">
        <div className="cc-brand" onClick={() => select('dashboard')}>
          <span className="cc-brand-mark"><span>N</span></span>
          <span><b>Nimbus</b><small>NAS Control Center</small></span>
        </div>
        <nav className="cc-categories" aria-label="Główna nawigacja">
          {nav.map(group => {
            const selected = group === currentGroup;
            return (
              <div className="cc-nav-group" key={group.group}>
                <button className={selected ? 'active' : ''} onClick={() => setOpen(open === group.group ? null : group.group)}>
                  {group.group}<span>⌄</span>
                </button>
                {open === group.group && (
                  <div className="cc-nav-popover">
                    {group.items.map(item => (
                      <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => select(item.id)}>
                        <span className="cc-module-icon"><Icon name={item.icon} size={17}/></span>
                        <span><b>{item.label}</b><small>{item.badgeAlert ? item.badgeAlert + ' alertów' : item.badge ? item.badge + ' aktywnych' : 'Otwórz moduł'}</small></span>
                        {(item.badge || item.badgeAlert) && <em className={item.badgeAlert ? 'alert' : ''}>{item.badgeAlert || item.badge}</em>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="cc-live"><i/> system online</div>
      </div>
    );
  };

  const Ring = ({ value = 0, label, detail, tone = 'blue' }) => {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    return (
      <div className={'cc-ring ' + tone} style={{'--pct': pct}}>
        <div className="cc-ring-visual"><span>{pct.toFixed(0)}<small>%</small></span></div>
        <div><b>{label}</b><small>{detail}</small></div>
      </div>
    );
  };

  const ServiceTile = ({ service }) => {
    const running = service.status === 'running';
    return (
      <div className={'cc-service ' + (running ? 'running' : service.status === 'unknown' ? 'unknown' : 'stopped')}>
        <span className="cc-service-state"><i/></span>
        <div><b>{service.name}</b><small>{running ? 'Usługa działa' : service.status === 'unknown' ? 'Sprawdzanie stanu' : 'Usługa zatrzymana'}</small></div>
        <span className="cc-service-port">{service.port || '—'}</span>
      </div>
    );
  };

  const PoolCard = ({ pool }) => {
    const total = Number(pool.total) || 0;
    const used = Number(pool.used) || 0;
    const pct = total ? Math.min(100, used / total * 100) : 0;
    return (
      <button className="cc-pool" onClick={() => { location.hash = 'disks'; }}>
        <div className="cc-pool-top">
          <span className="cc-pool-icon"><Icon name="disk" size={20}/></span>
          <span><b>{pool.name}</b><small>{pool.type || 'ZFS'} · {pool.drives || 0} dysków</small></span>
          <em className={pool.health === 'ok' ? 'ok' : 'warn'}>{pool.health === 'ok' ? 'ONLINE' : 'UWAGA'}</em>
        </div>
        <div className="cc-capacity"><span style={{width: pct + '%'}}/></div>
        <div className="cc-pool-foot"><b>{used.toFixed(1)} GB</b><span>z {total.toFixed(1)} GB · {pct.toFixed(0)}%</span></div>
      </button>
    );
  };

  const ControlDashboard = () => {
    const pools = useStore('POOLS') || [];
    const containers = useStore('CONTAINERS') || [];
    const services = useStore('SERVICES') || [];
    const network = useStore('NETWORK') || {};
    const overviewStore = useStore('OVERVIEW');
    const [overview, setOverview] = React.useState(overviewStore || null);

    React.useEffect(() => {
      let alive = true;
      const load = () => fetch('/api/overview', {credentials:'include'})
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (alive && data) setOverview(data); })
        .catch(() => {});
      load();
      const timer = setInterval(load, 3000);
      return () => { alive = false; clearInterval(timer); };
    }, []);

    const cpu = overview?.cpu || {};
    const memory = overview?.memory || {};
    const runningContainers = containers.filter(c => c.state === 'running').length;
    const activeServices = services.filter(s => s.status === 'running').length;
    const host = overview?.hostname || network.hostname || 'Nimbus';
    const uptime = overview?.uptime || (overview?.uptime_secs ? Math.floor(overview.uptime_secs / 86400) + ' dni' : '—');
    const iface = (network.interfaces || []).find(item => item.state === 'up');

    return (
      <div className="cc-dashboard">
        <section className="cc-hero">
          <div>
            <span className="cc-eyebrow"><i/> SYSTEM DZIAŁA PRAWIDŁOWO</span>
            <h2>{host}</h2>
            <p>Centrum zarządzania pamięcią, aplikacjami i siecią.</p>
          </div>
          <div className="cc-hero-meta">
            <span><small>UPTIME</small><b>{uptime}</b></span>
            <span><small>SIEĆ</small><b>{iface?.name || '—'} · {iface?.speed || '—'}</b></span>
            <span><small>KONTENERY</small><b>{runningContainers}/{containers.length} działa</b></span>
          </div>
        </section>

        <section className="cc-health-grid">
          <Ring value={cpu.percent} label="Procesor" detail={(cpu.temp || 0).toFixed(0) + '°C · ' + (cpu.cores || '—') + ' rdzeni'} tone="blue"/>
          <Ring value={memory.percent} label="Pamięć RAM" detail={(memory.used_gb || 0).toFixed(1) + ' z ' + (memory.total_gb || 0).toFixed(1) + ' GB'} tone="violet"/>
          <div className="cc-summary-card">
            <span><Icon name="docker" size={19}/></span><div><small>APLIKACJE</small><b>{runningContainers}</b><em>kontenerów online</em></div>
          </div>
          <div className="cc-summary-card">
            <span><Icon name="share" size={19}/></span><div><small>USŁUGI</small><b>{activeServices}</b><em>aktywnych usług</em></div>
          </div>
        </section>

        <div className="cc-main-grid">
          <section className="cc-panel cc-storage">
            <header><div><small>MAGAZYN</small><h3>Pule i przestrzeń</h3></div><button onClick={() => { location.hash='disks'; }}>Wszystkie dyski →</button></header>
            <div className="cc-pools">
              {pools.length ? pools.slice(0,3).map(pool => <PoolCard key={pool.id || pool.name} pool={pool}/>) :
                <div className="cc-empty">Oczekiwanie na dane ZFS…</div>}
            </div>
          </section>

          <section className="cc-panel">
            <header><div><small>USŁUGI SIECIOWE</small><h3>Stan usług</h3></div><span className="cc-count">{activeServices}/{services.length}</span></header>
            <div className="cc-services">
              {services.slice(0,6).map(service => <ServiceTile key={service.id} service={service}/>)}
            </div>
          </section>
        </div>

        <section className="cc-quick">
          <header><div><small>SZYBKI DOSTĘP</small><h3>Najczęstsze zadania</h3></div></header>
          <div>
            {[
              ['docker','Kontenery','docker'],['disk','Dyski i pule','disks'],['network','Sieć','network'],
              ['terminal','Terminal','terminal'],['download','Aktualizacje','updates'],['settings','Ustawienia','settings']
            ].map(([icon,label,id]) => (
              <button key={id} onClick={() => { location.hash=id; }}><Icon name={icon} size={18}/><span>{label}</span><b>→</b></button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  window.Sidebar = ControlNavigation;
  window.Dashboard = ControlDashboard;
})();
