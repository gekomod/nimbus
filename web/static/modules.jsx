// modules.jsx — system włączania/wyłączania modułów
// Każdy moduł ma id, nazwę, opis, grupę
// Gdy wyłączony — nie pobiera danych i nie pokazuje w menu

const MODULES_DEFAULT = {
  // Magazyn
  disks:     { label:'Dyski i pule',        group:'Magazyn',       enabled:true },
  files:     { label:'Menedżer plików',      group:'Magazyn',       enabled:true },
  shares:    { label:'Usługi plików',        group:'Magazyn',       enabled:true },
  backup:    { label:'Kopie zapasowe',       group:'Magazyn',       enabled:true },
  // Aplikacje
  docker:    { label:'Kontenery Docker',     group:'Aplikacje',     enabled:true },
  kvm:       { label:'Wirtualizacja KVM',    group:'Aplikacje',     enabled:false },
  media:     { label:'Serwery mediów',       group:'Aplikacje',     enabled:true },
  nfs:       { label:'NFS Server',           group:'Aplikacje',     enabled:true },
  ssh_svc:   { label:'SSH / SFTP',           group:'Aplikacje',     enabled:true },
  samba:     { label:'Samba / SMB',          group:'Aplikacje',     enabled:true },
  ftp_svc:   { label:'FTP / FTPS',           group:'Aplikacje',     enabled:false },
  webdav:    { label:'WebDAV',               group:'Aplikacje',     enabled:false },
  // Sieć
  network:   { label:'Sieć',                 group:'Sieć',          enabled:true },
  netdetail: { label:'Sieć szczegółowo',     group:'Sieć',          enabled:true },
  servers:   { label:'Serwery zdalne',       group:'Sieć',          enabled:true },
  // System
  logs:      { label:'Logi systemowe',       group:'System',        enabled:true },
  processes: { label:'Procesy',              group:'System',        enabled:true },
  smart:     { label:'S.M.A.R.T.',           group:'System',        enabled:true },
  temps:     { label:'Temperatury',          group:'System',        enabled:true },
  terminal:  { label:'Terminal',             group:'System',        enabled:true },
  // Administracja
  cron:      { label:'Harmonogram',          group:'Administracja', enabled:true },
  notif:     { label:'Powiadomienia',        group:'Administracja', enabled:true },
  users:     { label:'Użytkownicy',          group:'Administracja', enabled:true },
  updates:   { label:'Aktualizacje',         group:'Administracja', enabled:true },
  packages:  { label:'Pakiety APT',          group:'Administracja', enabled:false },
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

  const byGroup = {};
  Object.entries(mods).forEach(([id, m]) => {
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

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div style={{padding:'12px 16px',background:'color-mix(in oklch,var(--accent) 8%,transparent)',
        border:'1px solid color-mix(in oklch,var(--accent) 20%,transparent)',borderRadius:8,
        fontSize:'var(--fs-sm)',color:'var(--fg-muted)',lineHeight:1.7}}>
        💡 Wyłączone moduły znikają z menu i <strong>nie pobierają danych</strong> z serwera — zmniejsza obciążenie. Zmiany są natychmiastowe.
      </div>

      {Object.entries(byGroup).map(([group, items]) => (
        <div key={group} className="card">
          <div className="card-head">
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:groupColors[group]||'var(--accent)',flexShrink:0}}/>
              <div className="card-title">{group}</div>
            </div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
              {items.filter(m=>m.enabled).length}/{items.length} aktywnych
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8,padding:'8px var(--pad-card) var(--pad-card)'}}>
            {items.map(m => (
              <div key={m.id}
                onClick={() => window.setModuleEnabled(m.id, !m.enabled)}
                style={{
                  display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                  borderRadius:8,cursor:'pointer',
                  border:`1px solid ${m.enabled ? 'color-mix(in oklch,var(--accent) 25%,var(--line-strong))' : 'var(--line)'}`,
                  background: m.enabled ? 'color-mix(in oklch,var(--accent) 5%,var(--bg-2))' : 'var(--bg-2)',
                  transition:'all .15s',
                }}>
                <div style={{
                  width:36,height:20,borderRadius:10,flexShrink:0,
                  background: m.enabled ? 'var(--accent)' : 'var(--bg-3)',
                  transition:'background .2s',position:'relative',
                }}>
                  <div style={{
                    position:'absolute',top:2,
                    left: m.enabled ? 18 : 2,
                    width:16,height:16,borderRadius:'50%',
                    background:'white',transition:'left .2s',
                    boxShadow:'0 1px 3px rgba(0,0,0,.3)',
                  }}/>
                </div>
                <div>
                  <div style={{fontSize:'var(--fs-sm)',fontWeight:500,color:m.enabled?'var(--fg)':'var(--fg-dim)'}}>{m.label}</div>
                  <div style={{fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{m.id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

window.ModuleSettings = ModuleSettings;
