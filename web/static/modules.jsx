// modules.jsx — system włączania/wyłączania modułów
// Każdy moduł ma id, nazwę, opis, grupę
// Gdy wyłączony — nie pobiera danych i nie pokazuje w menu

const MODULES_DEFAULT = {
  // Magazyn
  disks:     { label:'Dyski i pule',        group:'Magazyn',       enabled:true,  icon:'💾', desc:'ZFS pools, SMART, I/O stats' },
  files:     { label:'Menedżer plików',     group:'Magazyn',       enabled:true,  icon:'📁', desc:'Przeglądarka, upload, uprawnienia' },
  shares:    { label:'Usługi plików',       group:'Magazyn',       enabled:true,  icon:'🔗', desc:'SMB · NFS · FTP · SSH · rsync' },
  backup:    { label:'Kopie zapasowe',      group:'Magazyn',       enabled:true,  icon:'🗄', desc:'Harmonogram, historia, przywracanie' },
  downloads: { label:'Download Center',    group:'Magazyn',       enabled:true,  icon:'⬇', desc:'Pobieranie plików z internetu na NAS' },
  // Aplikacje
  docker:    { label:'Kontenery Docker',    group:'Aplikacje',     enabled:true,  icon:'🐳', desc:'Kontenery, obrazy, Compose, sieci' },
  kvm:       { label:'Wirtualizacja KVM',   group:'Aplikacje',     enabled:false, icon:'🖥', desc:'QEMU/KVM, noVNC, snapshoty' },
  media:     { label:'Serwery mediów',      group:'Aplikacje',     enabled:true,  icon:'🎬', desc:'Plex · Jellyfin · Navidrome' },
  nfs:       { label:'NFS Server',          group:'Aplikacje',     enabled:true,  icon:'📡', desc:'Eksporty NFS, klienci, montowanie' },
  ssh_svc:   { label:'SSH / SFTP',          group:'Aplikacje',     enabled:true,  icon:'🔑', desc:'OpenSSH, klucze, sesje, fail2ban' },
  samba:     { label:'Samba / SMB',         group:'Aplikacje',     enabled:true,  icon:'🪟', desc:'SMB3, udziały sieciowe, połączenia' },
  ftp_svc:   { label:'FTP / FTPS',          group:'Aplikacje',     enabled:false, icon:'📤', desc:'vsftpd, TLS, tryb pasywny' },
  webdav:    { label:'WebDAV',              group:'Aplikacje',     enabled:false, icon:'☁', desc:'Apache mod_dav, HTTPS, ścieżki' },
  mail:      { label:'Serwer poczty',       group:'Aplikacje',     enabled:false, icon:'✉', desc:'Postfix + Dovecot, kolejka, konta' },
  webmail:   { label:'Webmail',             group:'Aplikacje',     enabled:false, icon:'📬', desc:'Klient IMAP w przeglądarce' },
  clamav:    { label:'Antywirus ClamAV',    group:'Aplikacje',     enabled:true,  icon:'🛡', desc:'Skanowanie, kwarantanna, ochrona RT' },
  // Sieć
  network:   { label:'Sieć',                group:'Sieć',          enabled:true,  icon:'🌐', desc:'Interfejsy, WireGuard, DHCP, DNS, UFW' },
  netdetail: { label:'Sieć szczegółowo',    group:'Sieć',          enabled:true,  icon:'📊', desc:'Bandwidth, per-kontener, firewall' },
  servers:   { label:'Serwery zdalne',      group:'Sieć',          enabled:true,  icon:'🖧', desc:'SSH do zdalnych hostów, CPU/RAM/dyski na żywo' },
  routers:   { label:'Routery',             group:'Sieć',          enabled:true,  icon:'📶', desc:'Xiaomi BE6500 · Cudy LT400 · MikroTik · OpenWrt' },
  // System
  logs:      { label:'Logi systemowe',      group:'System',        enabled:true,  icon:'📋', desc:'journald stream, filtrowanie, eksport' },
  processes: { label:'Procesy',             group:'System',        enabled:true,  icon:'⚙', desc:'Lista wg CPU, kill z potwierdzeniem' },
  smart:     { label:'S.M.A.R.T.',          group:'System',        enabled:true,  icon:'🔍', desc:'Pełny raport dysków, błędy, testy' },
  temps:     { label:'Temperatury',         group:'System',        enabled:true,  icon:'🌡', desc:'CPU, płyta główna, wentylatory, dyski' },
  ipmi:      { label:'IPMI / Czujniki',     group:'System',        enabled:true,  icon:'🧭', desc:'BMC, zasilanie, SEL — ipmitool' },
  terminal:  { label:'Terminal',            group:'System',        enabled:true,  icon:'💻', desc:'Sesja powłoki bash w przeglądarce' },
  hardware:  { label:'Sprzęt',              group:'System',        enabled:true,  icon:'🔧', desc:'CPU, RAM, PCIe, USB, BIOS' },
  ups:       { label:'UPS',                 group:'System',        enabled:false, icon:'🔋', desc:'NUT, historia napięcia, shutdown kaskadowy' },
  // Administracja
  cron:      { label:'Harmonogram',         group:'Administracja', enabled:true,  icon:'🕐', desc:'Zadania cron, dodaj/edytuj/uruchom' },
  notif:     { label:'Powiadomienia',       group:'Administracja', enabled:true,  icon:'🔔', desc:'Email, Telegram, Discord, Slack, reguły' },
  users:     { label:'Użytkownicy',         group:'Administracja', enabled:true,  icon:'👥', desc:'Konta, grupy, uprawnienia, 2FA' },
  updates:   { label:'Aktualizacje',        group:'Administracja', enabled:true,  icon:'🔄', desc:'apt, unattended-upgrades, historia' },
  packages:  { label:'Pakiety APT',         group:'Administracja', enabled:false, icon:'📦', desc:'dpkg, wyszukiwanie, instalacja, zależności' },
};

const MODULES_API = '/api/modules';

function mergeWithDefaults(saved) {
  const merged = {};
  Object.entries(MODULES_DEFAULT).forEach(([id, def]) => {
    merged[id] = { ...def };
    if (saved && saved[id] !== undefined) {
      merged[id].enabled = saved[id];
    }
  });
  return merged;
}

function loadModules() {
  // Wczytaj z domyślnych synchronicznie (async load w tle)
  return { ...MODULES_DEFAULT };
}

async function fetchModules() {
  try {
    const r = await fetch(MODULES_API, { credentials: 'include' });
    if (!r.ok) return;
    const d = await r.json();
    const merged = mergeWithDefaults(d.modules || {});
    _modules = merged;
    notifyModules();
    window.dispatchEvent(new Event('nimbus_modules_changed'));
  } catch {}
}

function saveModules(mods) {
  const toSave = {};
  Object.entries(mods).forEach(([id, m]) => {
    toSave[id] = m.enabled;
  });
  fetch(MODULES_API, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSave),
  }).catch(() => {});
}

// Wczytaj z serwera przy starcie
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fetchModules);
} else {
  fetchModules();
}

// Global state
let _modules = loadModules();
const _modListeners = new Set();

function notifyModules() {
  _modListeners.forEach(fn => fn({ ..._modules }));
}

window.moduleEnabled = (id) => _modules[id]?.enabled !== false;

window._origSetModuleEnabled = (id, enabled) => {
  if (_modules[id]) {
    _modules[id] = { ..._modules[id], enabled };
    saveModules(_modules);
    notifyModules();
    window.dispatchEvent(new Event('nimbus_modules_changed'));
  }
};
window.setModuleEnabled = window._origSetModuleEnabled;

window.useModules = function() {
  const [mods, setMods] = React.useState({ ..._modules });
  React.useEffect(() => {
    _modListeners.add(setMods);
    return () => _modListeners.delete(setMods);
  }, []);
  return mods;
};

// ── Komponent ustawień modułów ────────────────────────────────────────────────
const ModuleSettings = () => {
  const mods = window.useModules();
  const [search, setSearch] = React.useState('');

  const byGroup = {};
  Object.entries(mods).forEach(([id, m]) => {
    if (search && !m.label.toLowerCase().includes(search.toLowerCase()) && !id.includes(search.toLowerCase())) return;
    if (!byGroup[m.group]) byGroup[m.group] = [];
    byGroup[m.group].push({ id, ...m });
  });

  const groupColors = {
    'Magazyn':       'oklch(0.65 0.18 245)',
    'Aplikacje':     'oklch(0.72 0.14 150)',
    'Sieć':          'oklch(0.65 0.18 200)',
    'System':        'oklch(0.68 0.12 290)',
    'Administracja': 'oklch(0.78 0.15 75)',
  };

  const totalEnabled  = Object.values(mods).filter(m => m.enabled).length;
  const totalModules  = Object.values(mods).length;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* Nagłówek z infobarem i wyszukiwarką */}
      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
        <div style={{
          flex:1, padding:'10px 16px',
          background:'color-mix(in oklch,var(--accent) 8%,transparent)',
          border:'1px solid color-mix(in oklch,var(--accent) 20%,transparent)',
          borderRadius:8, fontSize:'var(--fs-sm)', color:'var(--fg-muted)', lineHeight:1.7,
        }}>
          💡 Wyłączone moduły znikają z menu i <strong>nie pobierają danych</strong> — zmniejsza obciążenie.
          Aktywnych: <strong>{totalEnabled}/{totalModules}</strong>
        </div>
        <input
          className="inp"
          placeholder="🔍 Szukaj modułu…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{width:200}}
        />
      </div>

      {Object.entries(byGroup).map(([group, items]) => (
        <div key={group} className="card">
          <div className="card-head">
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:groupColors[group]||'var(--accent)',flexShrink:0}}/>
              <div className="card-title">{group}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
                {items.filter(m=>m.enabled).length}/{items.length} aktywnych
              </div>
              {/* Szybkie akcje: włącz/wyłącz grupę */}
              <button className="btn sm"
                onClick={() => items.forEach(m => window.setModuleEnabled(m.id, true))}
                style={{fontSize:10, padding:'2px 8px'}}>
                Wszystkie ✓
              </button>
              <button className="btn sm"
                onClick={() => items.forEach(m => window.setModuleEnabled(m.id, false))}
                style={{fontSize:10, padding:'2px 8px', color:'var(--fg-dim)'}}>
                Brak ✗
              </button>
            </div>
          </div>
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',
            gap:8, padding:'8px var(--pad-card) var(--pad-card)',
          }}>
            {items.map(m => (
              <div key={m.id}
                onClick={() => window.setModuleEnabled(m.id, !m.enabled)}
                style={{
                  display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                  borderRadius:8, cursor:'pointer',
                  border:`1px solid ${m.enabled
                    ? 'color-mix(in oklch,var(--accent) 25%,var(--line-strong))'
                    : 'var(--line)'}`,
                  background: m.enabled
                    ? 'color-mix(in oklch,var(--accent) 5%,var(--bg-2))'
                    : 'var(--bg-2)',
                  transition:'all .15s',
                  userSelect:'none',
                }}>
                {/* Emoji ikona */}
                <div style={{
                  width:34, height:34, borderRadius:8, flexShrink:0,
                  background: m.enabled ? 'color-mix(in oklch,var(--accent) 12%,var(--bg-3))' : 'var(--bg-3)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:16, transition:'background .2s',
                }}>
                  {m.icon || '🔧'}
                </div>

                {/* Treść */}
                <div style={{flex:1, minWidth:0}}>
                  <div style={{
                    fontSize:'var(--fs-sm)', fontWeight:500,
                    color: m.enabled ? 'var(--fg)' : 'var(--fg-dim)',
                    marginBottom: m.desc ? 2 : 0,
                  }}>{m.label}</div>
                  {m.desc && (
                    <div style={{
                      fontSize:9, color:'var(--fg-dim)',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{m.desc}</div>
                  )}
                </div>

                {/* Toggle switch */}
                <div style={{
                  width:34, height:18, borderRadius:9, flexShrink:0,
                  background: m.enabled ? 'var(--accent)' : 'var(--bg-3)',
                  transition:'background .2s', position:'relative',
                  border:`1px solid ${m.enabled ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                  <div style={{
                    position:'absolute', top:2,
                    left: m.enabled ? 17 : 2,
                    width:12, height:12, borderRadius:'50%',
                    background: m.enabled ? 'white' : 'var(--fg-dim)',
                    transition:'left .2s',
                    boxShadow:'0 1px 3px rgba(0,0,0,.3)',
                  }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {Object.keys(byGroup).length === 0 && search && (
        <div style={{
          textAlign:'center', padding:'32px 20px',
          color:'var(--fg-dim)', fontSize:'var(--fs-sm)',
        }}>
          Brak modułów pasujących do: <strong>{search}</strong>
        </div>
      )}
    </div>
  );
};

window.ModuleSettings = ModuleSettings;
