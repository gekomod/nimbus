// ===== App root =====
const storeSet = window.storeSet;
const useStore = window.useStore;
const Icon = window.Icon;
const Sidebar = window.Sidebar;
const Topbar = window.Topbar;
const Docker = window.Docker;
const Network = window.Network;
const FileServices = window.FileServices;
const Media = window.Media;
const Logs = window.Logs;
const Processes = window.Processes;
const Terminal = window.Terminal;
const Storage = window.Storage;
const Dashboard = window.Dashboard;
const Users = window.Users;
const Settings = window.Settings;
const SystemUpdates = window.SystemUpdates;
const SystemTemps    = window.SystemTemps;
const NetworkDetail  = window.NetworkDetail;
const NfsServer = window.NfsServer;
const Servers         = window.Servers;
const KVMScreen       = window.KVMScreen;
const ModuleSettings  = window.ModuleSettings;
const HardwareInventory = window.HardwareInventory;
const MailServer        = window.MailServer;
const Webmail           = window.Webmail;
const CommandPalette    = window.CommandPalette;

// ── Login screen ──────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }) => {
  const [user, setUser] = React.useState('');
  const [pass, setPass] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err,  setErr ] = React.useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/login', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username: user, password: pass }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      onLogin(data.user || { username: user });
    } catch {
      setErr('Nieprawidłowy login lub hasło');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'var(--bg)',
      backgroundImage:'radial-gradient(ellipse 80% 50% at 50% -20%,color-mix(in oklch,var(--accent) 14%,transparent),transparent)'}}>
      <form onSubmit={submit} style={{width:360,background:'var(--bg-1)',border:'1px solid var(--line-strong)',
        borderRadius:16,padding:'36px 32px 32px',boxShadow:'0 24px 64px rgba(0,0,0,.45)'}}>
        <div style={{width:44,height:44,borderRadius:12,
          background:'linear-gradient(135deg,var(--accent),oklch(from var(--accent) calc(l - 0.15) c h))',
          display:'grid',placeItems:'center',color:'#fff',fontWeight:700,fontSize:20,marginBottom:20,
          boxShadow:'0 8px 24px color-mix(in oklch,var(--accent) 40%,transparent)'}}>N</div>
        <div style={{fontSize:20,fontWeight:600,marginBottom:4}}>Nimbus NAS</div>
        <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)',marginBottom:28}}>Panel administracyjny</div>
        {[
          {label:'Użytkownik',type:'text',    value:user,set:setUser,ph:'root',     ac:'username'},
          {label:'Hasło',     type:'password',value:pass,set:setPass,ph:'••••••••',ac:'current-password'},
        ].map(f => (
          <div key={f.label} style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
            <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',fontWeight:500,
              letterSpacing:'.04em',textTransform:'uppercase'}}>{f.label}</label>
            <input type={f.type} value={f.value} onChange={e=>f.set(e.target.value)}
              placeholder={f.ph} autoComplete={f.ac}
              style={{height:38,padding:'0 12px',background:'var(--bg-2)',
                border:'1px solid var(--line-strong)',borderRadius:7,
                color:'var(--fg)',fontSize:'var(--fs-base)',outline:'none',
                fontFamily:'var(--font-ui)',transition:'border-color .15s'}}/>
          </div>
        ))}
        {err && <div style={{marginTop:4,padding:'10px 14px',
          background:'color-mix(in oklch,var(--err) 15%,transparent)',
          border:'1px solid color-mix(in oklch,var(--err) 30%,transparent)',
          borderRadius:6,color:'var(--err)',fontSize:'var(--fs-sm)',textAlign:'center'}}>{err}</div>}
        <button type="submit" disabled={busy} style={{width:'100%',height:40,marginTop:20,
          background:'var(--accent)',border:0,borderRadius:8,color:'#fff',
          fontSize:'var(--fs-base)',fontWeight:600,cursor:busy?'default':'pointer',
          opacity:busy?.5:1,fontFamily:'var(--font-ui)'}}>
          {busy ? 'Logowanie…' : 'Zaloguj się →'}
        </button>
      </form>
    </div>
  );
};

const CheckingAuth = () => (
  <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'var(--bg)'}}>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16}}>
      <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:20,height:20,border:'2px solid var(--line-strong)',
        borderTopColor:'var(--accent)',borderRadius:'50%',animation:'_spin .6s linear infinite'}}/>
      <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Nimbus NAS…</div>
    </div>
  </div>
);

// ── Progress bar ładowania API ────────────────────────────────────────────────
const NavProgress = () => {
  const loading = useStore('LOADING');
  const [visible,  setVisible]  = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [leaving,  setLeaving]  = React.useState(false);
  const timerRef = React.useRef(null);

  React.useEffect(() => {
    let grow = null;
    if (loading) {
      setLeaving(false);
      setVisible(true);
      setProgress(0);
      // Symuluj wolny wzrost do ~85% — prawdziwe 100% gdy loading=false
      let p = 0;
      grow = setInterval(() => {
        // Coraz wolniej zbliża się do 85%
        p += (85 - p) * 0.08 + 0.3;
        if (p >= 85) { p = 85; clearInterval(grow); }
        setProgress(p);
      }, 60);
    } else {
      if (!visible) return;
      clearInterval(grow);
      // Dopełnij do 100% i znikaj
      setProgress(100);
      setLeaving(true);
      const hide = setTimeout(() => { setVisible(false); setLeaving(false); setProgress(0); }, 380);
      return () => clearTimeout(hide);
    }
    return () => clearInterval(grow);
  }, [loading]);

  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 9999,
      background: 'transparent', pointerEvents: 'none',
    }}>
      <div style={{
        height: '100%',
        width: progress + '%',
        background: 'var(--accent)',
        boxShadow: '0 0 8px color-mix(in oklch, var(--accent) 70%, transparent)',
        transition: leaving ? 'width 0.2s ease, opacity 0.3s ease' : 'width 0.1s ease-out',
        opacity: leaving ? 0 : 1,
        borderRadius: '0 2px 2px 0',
      }}/>
    </div>
  );
};

// ── Topbar z prawdziwym zalogowanym userem ────────────────────────────────────
const AppTopbar = ({ crumbs, theme, onTheme, user, onLogout }) => {
  const initials = user ? user.split(' ').map(s=>s[0]).join('').toUpperCase().slice(0,2) : '??';
  return (
    <header className="topbar">
      <div className="crumb">
        {crumbs.map((c,i) => <span key={i}>{i>0&&' / '}{i===crumbs.length-1?<b>{c}</b>:c}</span>)}
      </div>
      <div className="topbar-search">
        <Icon name="search" size={14}/>
        <input placeholder="Szukaj — usług, kontenerów, użytkowników…"/>
        <kbd>⌘K</kbd>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={onTheme} title="Motyw">
          <Icon name="check" size={14}/>
          <span style={{fontSize:11,fontFamily:'var(--font-mono)',marginLeft:4}}>{theme==='dark'?'ciemny':'jasny'}</span>
        </button>
        <button className="icon-btn" title="Powiadomienia"><Icon name="bell" size={16}/></button>
        <div className="user-chip" style={{cursor:'pointer'}} onClick={onLogout} title="Wyloguj">
          <div className="avatar">{initials}</div>
          <span>{user}</span>
        </div>
      </div>
    </header>
  );
};

// ── Oryginalna aplikacja ──────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme":   "dark",
  "density": "normal",
  "side":    "labeled",
  "font":    "plex"
}/*EDITMODE-END*/;


// Wrapper dodający zakładkę Moduły do istniejącego Settings
const SettingsWithModules = () => {
  const [tab, setTab] = React.useState('settings');
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="segmented">
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>Ustawienia</button>
        <button className={tab==='modules'?'active':''} onClick={()=>setTab('modules')}>🧩 Moduły</button>
      </div>
      {tab === 'settings' && <Settings/>}
      {tab === 'modules'  && <ModuleSettings/>}
    </div>
  );
};

const SCREENS = {
  dashboard: { title: 'Pulpit',           sub: 'Przegląd całego systemu', comp: () => <Dashboard/>, crumbs: ['nimbus','Pulpit'] },
  disks:     { title: 'Dyski i pule',     sub: 'Magazyn ZFS · 12 dysków · 3 pule', comp: () => <Storage/>, crumbs: ['nimbus','Magazyn','Dyski i pule'] },
  files:     { title: 'Menedżer plików',    sub: 'Przeglądarka · upload · uprawnienia', comp: () => <FileManager/>, crumbs: ['nimbus','Magazyn','Menedżer plików'] },
  shares:    { title: 'Usługi plików',    sub: 'SMB · NFS · FTP · SSH · rsync', comp: () => <FileServices/>, crumbs: ['nimbus','Magazyn','Usługi plików'] },
  kvm:       { title: 'Wirtualizacja KVM',   sub: 'QEMU/KVM · maszyny wirtualne', comp: () => <KVMScreen/>, crumbs: ['nimbus','Aplikacje','KVM'] },
  docker:    { title: 'Kontenery Docker', sub: '12 kontenerów · 34 obrazy', comp: () => <Docker/>, crumbs: ['nimbus','Aplikacje','Kontenery'] },
  media:     { title: 'Serwery mediów',   sub: 'Plex · Jellyfin · Navidrome', comp: () => <Media/>, crumbs: ['nimbus','Aplikacje','Media'] },
  nfs:       { title: 'NFS Server',       sub: 'Serwer NFS v4 · klient · montowanie', comp: () => <NfsServer/>, crumbs: ['nimbus','Aplikacje','NFS Server'] },
  ssh_svc:   { title: 'SSH / SFTP',       sub: 'OpenSSH · klucze · sesje · fail2ban', comp: () => <SshService/>, crumbs: ['nimbus','Aplikacje','SSH'] },
  samba:     { title: 'Samba / SMB',      sub: 'SMB3 · udziały sieciowe · połączenia', comp: () => <SambaService/>, crumbs: ['nimbus','Aplikacje','Samba'] },
  ftp_svc:   { title: 'FTP / FTPS',       sub: 'vsftpd · TLS · tryb pasywny', comp: () => <FtpService/>, crumbs: ['nimbus','Aplikacje','FTP'] },
  webdav:    { title: 'WebDAV',           sub: 'Apache mod_dav · HTTPS · ścieżki', comp: () => <WebDavService/>, crumbs: ['nimbus','Aplikacje','WebDAV'] },
  netdetail: { title: 'Sieć szczegółowo', sub: 'Bandwidth · per-kontener · firewall', comp: () => <NetworkDetail/>, crumbs: ['nimbus','Sieć','Szczegóły'] },
  network:   { title: 'Sieć',             sub: '2× 10 GbE · WireGuard · firewall', comp: () => <Network/>, crumbs: ['nimbus','Sieć'] },
  servers:   { title: 'Serwery',          sub: 'Zarządzanie zdalnymi hostami SSH', comp: () => <Servers/>, crumbs: ['nimbus','Sieć','Serwery'] },
  logs:      { title: 'Logi systemowe',   sub: 'Strumień zdarzeń na żywo', comp: () => <Logs/>, crumbs: ['nimbus','System','Logi'] },
  processes: { title: 'Procesy',          sub: 'Lista procesów systemowych', comp: () => <Processes/>, crumbs: ['nimbus','System','Procesy'] },
  temps:     { title: 'Temperatury',          sub: 'CPU · płyta główna · wentylatory · dyski', comp: () => <SystemTemps/>, crumbs: ['nimbus','System','Temperatury'] },
  smart:     { title: 'S.M.A.R.T. szczegóły',sub: 'Pełny raport dysków · błędy · testy · predykcja', comp: () => <SmartDetails/>, crumbs: ['nimbus','System','S.M.A.R.T.'] },
  terminal:  { title: 'Terminal',         sub: 'Sesja powłoki przez przeglądarkę', comp: () => <Terminal/>, crumbs: ['nimbus','System','Terminal'] },
  cron:      { title: 'Harmonogram zadań',    sub: 'cron · systemd timers · historia wykonań',   comp: () => <CronJobs/>,     crumbs: ['nimbus','Administracja','Harmonogram'] },
  notif:     { title: 'Powiadomienia',        sub: 'e-mail · Telegram · webhook · reguły alertów', comp: () => <Notifications/>, crumbs: ['nimbus','Administracja','Powiadomienia'] },
  users:     { title: 'Użytkownicy',      sub: 'Konta · grupy · uprawnienia · 2FA', comp: () => <Users/>, crumbs: ['nimbus','Administracja','Użytkownicy'] },
  updates:   { title: 'Aktualizacje systemu', sub: 'apt · 12 pakietów dostępnych · 5 security', comp: () => <SystemUpdates/>, crumbs: ['nimbus','Administracja','Aktualizacje'] },
  packages:  { title: 'Menedżer pakietów',    sub: 'apt · dpkg · zainstalowane · wyszukiwanie · zależności', comp: () => <PackageManager/>, crumbs: ['nimbus','Administracja','Pakiety'] },
  settings:  { title: 'Ustawienia',       sub: 'System · backup · alerty · UPS · moduły', comp: () => <SettingsWithModules/>, crumbs: ['nimbus','Administracja','Ustawienia'] },
  hardware:  { title: 'Sprzęt',           sub: 'CPU · RAM · PCIe · USB · karty sieciowe · BIOS', comp: () => <HardwareInventory/>, crumbs: ['nimbus','System','Sprzęt'] },
  mail:      { title: 'Serwer poczty',    sub: 'Postfix · Dovecot · kolejka · spam · konta',      comp: () => <MailServer/>,       crumbs: ['nimbus','Aplikacje','Mail'] },
  webmail:   { title: 'Webmail',          sub: 'Klient pocztowy w przeglądarce · IMAP',            comp: () => <Webmail/>,          crumbs: ['nimbus','Aplikacje','Webmail'] },
};

const AppInner = ({ user, onLogout }) => {
  const initial = (location.hash && SCREENS[location.hash.slice(1)]) ? location.hash.slice(1) : 'dashboard';
  const [active, setActive]       = React.useState(initial);
  const [tweaks, setTweak]        = useTweaks(TWEAK_DEFAULTS);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const h = () => { const id = location.hash.slice(1); if (SCREENS[id]) setActive(id); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  React.useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme   = tweaks.theme;
    r.dataset.density = tweaks.density;
    r.dataset.side    = tweaks.side;
    r.dataset.font    = tweaks.font;
  }, [tweaks]);

  const nav = id => {
    if (!SCREENS[id]) return;
    setActive(id);
    location.hash = id;
    window.__onScreenChange && window.__onScreenChange(id);
  };
  const screen = SCREENS[active] || SCREENS['dashboard'];

  return (
    <>
      <div className="app">
        <Sidebar active={active} onNav={nav}/>
        <div className="main">
          <NavProgress/>
          <AppTopbar
            crumbs={screen.crumbs}
            theme={tweaks.theme}
            onTheme={() => setTweak('theme', tweaks.theme==='dark'?'light':'dark')}
            user={user}
            onLogout={onLogout}
          />
          <div className="content">
            <div className="page-head">
              <div>
                <h1 className="page-title">{screen.title}</h1>
                <PageSub sub={screen.sub}/>
              </div>
              <div className="page-actions">
                <button className="btn"><Icon name="refresh" size={12}/> Odśwież</button>
                {active==='dashboard' && <button className="btn primary"><Icon name="download" size={12}/> Raport</button>}
                {active==='servers'    && <button className="btn" onClick={()=>document.dispatchEvent(new CustomEvent('nimbus:refresh-servers'))}><Icon name="refresh" size={12}/> Odśwież statusy</button>}
                {active==='servers'    && <button className="btn primary" onClick={()=>document.dispatchEvent(new CustomEvent('nimbus:add-server'))}><Icon name="plus" size={12}/> Dodaj serwer</button>}
                {active==='users'     && <button className="btn primary"><Icon name="plus"     size={12}/> Nowy użytkownik</button>}
              </div>
            </div>
            {screen.comp()}
          </div>
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          onNav={(screen) => { if (SCREENS[screen]) setActive(screen); }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Wygląd"/>
        <TweakRadio label="Motyw"      value={tweaks.theme}   options={[{value:'dark',label:'Ciemny'},{value:'light',label:'Jasny'}]}                                                                    onChange={v=>setTweak('theme',v)}/>
        <TweakRadio label="Gęstość"    value={tweaks.density} options={[{value:'compact',label:'Kompakt'},{value:'normal',label:'Normalna'},{value:'cozy',label:'Cozy'}]}                                onChange={v=>setTweak('density',v)}/>
        <TweakSection label="Sidebar"/>
        <TweakRadio label="Styl paska" value={tweaks.side}    options={[{value:'icons',label:'Ikony'},{value:'labeled',label:'Etykiety'},{value:'wide',label:'Szeroki'}]}                                onChange={v=>setTweak('side',v)}/>
        <TweakSection label="Typografia"/>
        <TweakRadio label="Fonty"      value={tweaks.font}    options={[{value:'inter',label:'Inter'},{value:'plex',label:'Plex'},{value:'system',label:'Sys'},{value:'mono',label:'Mono'}]}             onChange={v=>setTweak('font',v)}/>
      </TweaksPanel>
    </>
  );
};

// ── Root ──────────────────────────────────────────────────────────────────────
const App = () => {
  const [authed,     setAuthed]     = React.useState(null); // null=sprawdzanie
  const [loggedUser, setLoggedUser] = React.useState('—');

  React.useEffect(() => {
    fetch('/api/check-auth', { credentials:'include' })
      .then(async r => {
        if (r.ok) {
          const d = await r.json();
          const u = d.username || 'admin';
          setLoggedUser(u);
          storeSet('LOGGED_USER', { username: u });
          setAuthed(true);
          // Naprawiony bug: initial jest w AppInner — oblicz tu
          const startScreen = (location.hash && SCREENS[location.hash.slice(1)])
            ? location.hash.slice(1) : 'dashboard';
          window.__startSync && window.__startSync(startScreen);
        } else {
          // Brak sesji — przekieruj do login.html (zachowaj hash do powrotu)
          if (location.hash && location.hash !== '#') {
            sessionStorage.setItem('nimbus_redirect', location.hash);
          }
          window.location.replace('/login.html');
        }
      })
      .catch(() => {
        window.location.replace('/login.html');
      });
  }, []);

  const handleLogout = async () => {
    window.__stopSync && window.__stopSync();
    await fetch('/api/logout', { method:'POST', credentials:'include' }).catch(()=>{});
    window.location.replace('/login.html');
  };

  if (authed === null) return <CheckingAuth/>;
  return <AppInner user={loggedUser} onLogout={handleLogout}/>;
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

// ── PageSub z inline loading dot ─────────────────────────────────────────────
const PageSub = ({ sub }) => {
  const loading = useStore('LOADING');
  return (
    <div className="page-sub" style={{display:'flex', alignItems:'center', gap:8}}>
      {loading && (
        <span style={{
          display:'inline-flex', alignItems:'center', gap:5,
          fontSize:'var(--fs-xs)', color:'var(--fg-dim)',
          fontFamily:'var(--font-mono)',
        }}>
          <span style={{
            width:6, height:6, borderRadius:'50%',
            background:'var(--accent)', display:'inline-block',
            animation:'_nb-pulse 1s ease-in-out infinite',
            flexShrink:0,
          }}/>
          ładowanie…
        </span>
      )}
      <span>{sub}</span>
    </div>
  );
};
