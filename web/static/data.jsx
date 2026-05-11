const storeSet = window.storeSet;
const storeGet = window.storeGet;
// ===== Reaktywny store + fetch danych z API =====
// Brak mock danych — tylko prawdziwe dane z serwera.
// store.jsx musi być załadowany wcześniej.

// ─── Stan aplikacji ────────────────────────────────────────────────────────
// Zainicjuj puste tablice żeby komponenty nie crashowały
storeSet('POOLS',      []);
storeSet('DISKS',      []);
storeSet('CONTAINERS', []);
storeSet('USERS',      []);
storeSet('SHARES',     []);
storeSet('MOUNTS',     []);
storeSet('NETWORK',    { hostname:'—', domain:'—', gateway:'—', dns:[], interfaces:[] });
storeSet('PROCESSES',  []);
storeSet('LOGS',       []);
storeSet('SERVICES',   [
  { id:'smb',   name:'Samba (SMB/CIFS)',   port:'445, 139', status:'unknown', desc:'Udostępnianie plików dla Windows i macOS'    },
  { id:'nfs',   name:'NFS v4',             port:'2049',      status:'unknown', desc:'Udostępnianie plików dla systemów Unix/Linux' },
  { id:'ftp',   name:'FTP / FTPS',         port:'21, 990',   status:'unknown', desc:'Klasyczny transfer plików'                   },
  { id:'ssh',   name:'SSH',                port:'22',        status:'unknown', desc:'Dostęp powłoki i SFTP'                       },
  { id:'afp',   name:'AFP (Time Machine)', port:'548',       status:'unknown', desc:'Apple Filing Protocol'                       },
  { id:'rsync', name:'rsync',              port:'873',       status:'unknown', desc:'Synchronizacja przyrostowa'                  },
]);
storeSet('MEDIA_SRV',  []);
storeSet('UNASSIGNED_DISKS', []);
storeSet('FSTAB_TEXT', '');
storeSet('LOGGED_USER', { username:'—', uid:0, groups:[] });

window.NAV = [
  { group: "Przegląd", items: [
    { id: "dashboard", label: "Pulpit", icon: "dashboard" },
  ]},
  { group: "Magazyn", items: [
    { id: "disks", label: "Dyski i pule", icon: "disk" },
    { id: "shares", label: "Usługi plików", icon: "share", badge: "4" },
    { id: "files",   label: "Menedżer plików", icon: "folder" },
    { id: "backup",  label: "Kopie zapasowe",  icon: "download", badgeAlert: "1" },
  ]},
  { group: "Aplikacje", items: [
    { id: "docker",   label: "Kontenery",      icon: "docker",   badge: "12" },
    { id: "kvm",      label: "Wirtualizacja",   icon: "settings" },
    { id: "media",    label: "Serwery mediów",  icon: "media" },
    { id: "nfs",     label: "NFS Server",    icon: "share" },
    { id: "ssh_svc", label: "SSH / SFTP",    icon: "terminal" },
    { id: "samba",   label: "Samba / SMB",   icon: "network" },
    { id: "ftp_svc", label: "FTP / FTPS",    icon: "upload" },
    { id: "webdav",  label: "WebDAV",        icon: "globe" },
  ]},
  { group: "Sieć", items: [
    { id: "network",    label: "Sieć",           icon: "network" },
    { id: "netdetail",  label: "Sieć szczegółowo", icon: "network" },
    { id: "servers",    label: "Serwery",          icon: "network" },
  ]},
  { group: "System", items: [
    { id: "logs", label: "Logi systemowe", icon: "log", badgeAlert: "3" },
    { id: "processes", label: "Procesy", icon: "process" },
    { id: "smart",     label: "S.M.A.R.T.",       icon: "thermometer", badgeAlert: "2" },
    { id: "temps",     label: "Temperatury",       icon: "thermometer" },
    { id: "terminal", label: "Terminal", icon: "terminal" },
  ]},
  { group: "Administracja", items: [
    { id: "cron",    label: "Harmonogram",        icon: "clock",  badge: "8" },
    { id: "notif",   label: "Powiadomienia",      icon: "bell",   badgeAlert: "1" },
    { id: "users",   label: "Użytkownicy",        icon: "users" },
    { id: "updates", label: "Aktualizacje systemu", icon: "download", badgeAlert: "12" },
    { id: "packages",label: "Pakiety APT",           icon: "terminal" },
    { id: "settings",label: "Ustawienia",          icon: "settings" },
  ]},
];

// Subskrypcja zmian modułów → przebuduj NAV w sidebar
window._onModuleChange = (fn) => {
  // Trick: force sidebar re-render przez custom event
  const handler = () => fn({});
  window.addEventListener('nimbus_modules_changed', handler);
  return () => window.removeEventListener('nimbus_modules_changed', handler);
};
window.setModuleEnabled = (id, enabled) => {
  if (window._origSetModuleEnabled) window._origSetModuleEnabled(id, enabled);
  window.dispatchEvent(new Event('nimbus_modules_changed'));
};


// ─── Fetch helper ──────────────────────────────────────────────────────────
// ── Session interceptor ──────────────────────────────────────────────────────
// Każdy fetch który dostanie 401 → przekieruj na /login.html
let _sessionExpired = false;

const _origFetch = window.fetch.bind(window);
window.fetch = async function(...args) {
  const r = await _origFetch(...args);
  if (r.status === 401 && !_sessionExpired) {
    // Nie przekierowuj jeśli to sam login lub check-auth
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (!url.includes('/api/login') && !url.includes('check-auth')) {
      _sessionExpired = true;
      // Pokaż komunikat przed przekierowaniem
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;' +
        'background:var(--err,#ef4444);color:#fff;text-align:center;' +
        'padding:12px;font-size:14px;font-family:sans-serif;';
      banner.textContent = '⚠️ Sesja wygasła — przekierowanie do logowania…';
      document.body.appendChild(banner);
      setTimeout(() => {
        sessionStorage.setItem('nimbus_redirect', window.location.hash);
        window.location.replace('/login.html');
      }, 1500);
    }
  }
  return r;
};

async function _get(path) {
  try {
    const r = await fetch(path, { credentials:'include' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ─── Parsery — mapują pola API na format używany przez komponenty ──────────

function _parseIfaces(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(i => ({
    name:  i.Name  || i.name  || '?',
    ip:    i.IP    || i.ip    || i.address || '—',
    mac:   i.MAC   || i.mac   || '—',
    state: i.State || i.state || 'down',
    speed: i.Speed || i.speed || '—',
    // RxB/TxB są w bajtach łącznie — przelicz na MB/s (szacunkowe)
    rx:    i.rx    || (i.RxB  ? Math.round(i.RxB / 1048576 / 3600) : 0),
    tx:    i.tx    || (i.TxB  ? Math.round(i.TxB / 1048576 / 3600) : 0),
    vlan:  i.vlan  || '—',
  }));
}

function _parseProcs(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  // CPU z /proc/stat jest w % (już przeliczone w sys.go)
  // Ale wartości mogą być duże jeśli długo działający proces
  // Normalizuj do max 100%
  const maxCPU = Math.max(...raw.map(p => p.CPU || p.cpu || 0));
  const scale  = maxCPU > 100 ? 100 / maxCPU : 1;
  return raw.slice(0, 50).map(p => ({
    pid:  p.PID     || p.pid  || 0,
    user: p.User    || p.user || 'root',
    name: p.Name    || p.name || p.Command || p.command || '—',
    cpu:  Math.round((p.CPU  || p.cpu  || 0) * scale * 10) / 10,
    mem:  Math.round((p.Mem  || p.mem  || p.Memory || p.memory || 0) * 10) / 10,
  }));
}

function _parseLogs(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.filter(l => l && (l.msg || l.Msg || l.message || l.MESSAGE)).map(l => ({
    t:   l.t   || l.Time || l.time   || '',
    src: l.src || l.Src  || l.unit   || l.SYSLOG_IDENTIFIER || 'kernel',
    lvl: l.lvl || l.Lvl  || l.level  || 'INFO',
    msg: l.msg || l.Msg  || l.message|| l.MESSAGE || '',
  }));
}

function _parseContainers(raw) {
  const list = raw && raw.containers ? raw.containers : (Array.isArray(raw) ? raw : []);
  if (!list.length) return [];
  
  return list.map((c, i) => {
    const name  = (c.name || c.Names || c.ID || 'c'+i).replace(/^\//, '');
    const state = (c.state || c.State || 'unknown').toLowerCase();
    
    // Normalizuj stan - Docker używa "exited" zamiast "stopped"
    let normalizedState = state;
    if (state === 'exited' || state === 'dead') normalizedState = 'stopped';
    if (state === 'created') normalizedState = 'stopped';
    if (state === 'removing') normalizedState = 'stopped';
    
    // CPU - może być liczbą lub stringiem z %
    let cpu = 0;
    if (typeof c.cpu === 'number') {
      cpu = c.cpu;
    } else if (typeof c.cpu_percent === 'number') {
      cpu = c.cpu_percent;
    } else if (typeof c.CPUPerc === 'string') {
      cpu = parseFloat(c.CPUPerc.replace('%', '')) || 0;
    } else {
      cpu = parseFloat(c.cpu) || 0;
    }
    
    // Mem - może być liczbą (MB) lub stringiem
    let mem = 0;
    if (typeof c.mem === 'number') {
      mem = Math.round(c.mem); // Już w MB
    } else if (typeof c.memory_usage === 'number') {
      mem = Math.round(c.memory_usage);
    } else if (typeof c.MemUsage === 'string') {
      const memM = c.MemUsage.match(/([\d.]+)\s*([KMGTi]+B)?/i);
      if (memM) {
        const v = parseFloat(memM[1]);
        const u = (memM[2] || '').toUpperCase();
        mem = u.startsWith('G') ? Math.round(v*1024) : u.startsWith('K') ? Math.round(v/1024) : Math.round(v);
      }
    } else {
      mem = parseFloat(c.mem) || 0;
    }
    
    return {
      id:     c.id || c.ID || 'c'+i,
      name,
      image:  c.image || c.Image || '—',
      state:  normalizedState,  // Użyj znormalizowanego stanu
      uptime: c.uptime || c.status || c.Status || '—',
      cpu:    Math.round(cpu * 100) / 100,
      mem,
      ports:  typeof (c.ports||c.Ports) === 'string' ? (c.ports||c.Ports) : '—',
      tag:    'other',
    };
  });
}

function _parsePools(raw) {
  const list = raw && raw.pools ? raw.pools : (Array.isArray(raw) ? raw : []);
  if (!list.length) return [];
  
  return list.map((p, i) => {
    // Backend zwraca GB - konwertuj na TB dla wyświetlania
    const totalGB = typeof p.total === 'number' ? p.total : 0;
    const usedGB  = typeof p.used  === 'number' ? p.used  : 0;
    const availGB = typeof p.avail === 'number' ? p.avail : (totalGB - usedGB);

    return {
      id:     p.name || 'pool'+i,
      name:   p.name || 'pool'+i,
      type:   p.type || 'ZFS',
      total:  totalGB,  // GB
      used:   usedGB,   // GB
      avail:  availGB,  // GB — prawdziwe wolne z "zfs list"
      health: (p.health || 'ONLINE').toLowerCase() === 'online' ? 'ok' : 'warn',
      iops:       p.iops       || 0,
      read_mbps:  p.read_mbps  || 0,
      write_mbps: p.write_mbps || 0,
      drives: p.drives || 1,
      parity: p.parity || 0,
    };
  });
}

function _parseMounts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const skip = new Set(['tmpfs','devtmpfs','sysfs','proc','cgroup','cgroup2','pstore',
                        'securityfs','debugfs','hugetlbfs','mqueue','fusectl','bpf','tracefs']);
  return list
    .filter(m => m.mount && !skip.has(m.fs) && m.mount !== 'none')
    .map(m => ({
      mp:      m.mount   || m.MountAt || '/',
      device:  m.device  || m.Device  || '—',
      fs:      m.fs      || m.FS      || 'ext4',
      opts:    m.options || m.Options || 'rw',
      size:    `${(m.total_gb || 0).toFixed(1)} GB`,
      used:    m.used_gb || 0,
      auto:    true,
      type:    (m.fs||'').toLowerCase() === 'zfs' ? 'ZFS' : (m.fs||'').toUpperCase().slice(0,5),
      inFstab: true,
    }));
}

function _parseUsers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(u => ({
    id:      u.login || u.Login || u.name || u.Name || '?',
    name:    u.name  || u.Name  || u.login || '?',
    login:   u.login || u.Login || '?',
    uid:     u.uid   || u.UID   || 0,
    role:    u.uid === 0 ? 'Administrator' : 'Operator',
    groups:  u.groups || u.Groups || [],
    shell:   u.shell  || u.Shell  || '—',
    active:  true,
    twofa:   false,
    last:    '—',
  }));
}

// ─── Główna pętla synchronizacji ──────────────────────────────────────────
async function _syncOnce() {
  // Ładuj tylko dane potrzebne dla dashboardu i sidebaru
  // Dane specyficzne dla ekranów są ładowane lazy przez same ekrany
  const [overview, containers, pools, network, smb, ssh, nfs, ftp, logs] = await Promise.all([
    _get('/api/overview'),
    _get('/services/docker/containers'),
    _get('/api/zfs/pools'),
    _get('/api/network'),
    _get('/services/samba/status'),
    _get('/services/ssh/status'),
    _get('/api/nfs-server/status'),
    _get('/api/services/ftp-sftp/status'),
    _get('/api/logs?n=50'),
  ]);

  // Zmienne których już nie pobieramy globalnie (lazy load per ekran)
  const mounts = null;
  const procs  = null;
  const users  = null;
  const fstab  = null;
  const mediaDash = null;

  // Overview — zapisz do store dla Sidebar
  if (overview) {
    storeSet('OVERVIEW', overview);
    // Zaktualizuj stopkę sidebar
    const foot = document.querySelectorAll('.foot-row .v');
    if (foot.length >= 3) {
      foot[0].textContent = overview.hostname || '—';
      const us = overview.uptime_secs || 0;
      foot[1].textContent = `${Math.floor(us/86400)}d ${Math.floor((us%86400)/3600)}h`;
      foot[2].textContent = (overview.kernel||'').replace('Linux ','').slice(0,16);
    }
  }

  const p = _parsePools(pools);
  if (p.length) storeSet('POOLS', p);

  const c = _parseContainers(containers);
  if (c.length) {
    storeSet('CONTAINERS', c);
    window.NAV[2].items[0].badge = String(c.length);
  }

  const m = _parseMounts(mounts);
  if (m.length) storeSet('MOUNTS', m);

  if (network && network.interfaces) {
    storeSet('NETWORK', {
      hostname: network.hostname || '—',
      domain:   network.domain   || 'local',
      gateway:  network.gateway  || '—',
      dns:      network.dns      || [],
      interfaces: _parseIfaces(network.interfaces),
    });
  }

  const pr = _parseProcs(procs);
  if (pr.length) storeSet('PROCESSES', pr);

  const lg = _parseLogs(logs);
  if (lg.length) {
    storeSet('LOGS', lg);
    const alerts = lg.filter(l => l.lvl==='WARN'||l.lvl==='ERROR').length;
    if (alerts) window.NAV[4].items[0].badgeAlert = String(alerts);
  }

  // Services
  const svcUpdate = smb || ssh || nfs || ftp;
  if (svcUpdate) {
    storeSet('SERVICES', storeGet('SERVICES').map(s => {
      if (s.id==='smb'  && smb) return {...s, status: smb.active  ? 'running' : 'stopped'};
      if (s.id==='ssh'  && ssh) return {...s, status: ssh.active  ? 'running' : 'stopped'};
      if (s.id==='nfs'  && nfs) return {...s, status: nfs.active  ? 'running' : 'stopped'};
      if (s.id==='ftp'  && ftp) return {...s, status: ftp.active  ? 'running' : 'stopped'};
      return s;
    }));
  }

  const us = _parseUsers(users);
  if (us.length) storeSet('USERS', us);

  if (fstab && fstab.content) storeSet('FSTAB_TEXT', fstab.content);

  // Media — teraz z dashboard
  const media = mediaDash;
  if (media && typeof media === 'object') {
    storeSet('MEDIA_SRV', Object.entries(media).map(([id, info]) => ({
      id, name: id.charAt(0).toUpperCase()+id.slice(1),
      ver:   info.version || '—',
      state: info.active ? 'running' : 'stopped',
      lib:   '—',
      url:   info.url || `http://nas.local`,
      play:  0,
    })));
  }
}

let _syncTimer = null;
window.__startSync = function() {
  _syncOnce();
  _syncTimer = setInterval(_syncOnce, 8000);
};
window.__stopSync = function() {
  clearInterval(_syncTimer);
};

// ── Lazy loading per ekran ────────────────────────────────────────────────────
// Każdy ekran wywołuje useLazyData(url, interval) zamiast polegać na globalnym sync
// Dane są ładowane TYLKO gdy ekran jest widoczny

window.useLazyData = function(url, interval = 10000) {
  const [data,    setData]    = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error,   setError]   = React.useState(null);

  React.useEffect(() => {
    let timer = null;
    let cancelled = false;

    const load = async () => {
      if (document.hidden) return; // nie ładuj gdy tab niewidoczny
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!cancelled) { setData(d); setError(null); }
      } catch(e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    timer = setInterval(load, interval);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, interval]);

  return { data, loading, error };
};
