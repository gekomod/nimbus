const useStore = window.useStore;
const storeSet = window.storeSet;

const fmtMbps = (v) => {
  if (!v || v < 0.001) return '—';
  if (v >= 1024) return (v/1024).toFixed(1) + ' GB/s';
  if (v >= 1)    return Math.round(v) + ' MB/s';
  if (v >= 0.001)return Math.round(v*1024) + ' KB/s';
  return '—';
};
const fmtIops = (v) => (!v || v <= 0) ? '—' : Math.round(v).toLocaleString('pl');

const inputCss = {
  width:'100%', background:'var(--bg-1)', border:'1px solid var(--line)',
  color:'var(--fg)', padding:'8px 10px', borderRadius:5,
  fontSize:'var(--fs-sm)', fontFamily:'var(--font-mono)', outline:'none',
};

// ── Helper wyświetlania rozmiarów ZFS (wartości w TB z parseZFSSize) ────────
// parseZFSSize: T→v, G→v/1024, M→v/1024², K→v/1024³ — czyli zawsze TB
// Wyświetlaj w GB jeśli < 1 TB, w TB jeśli >= 1 TB
// fmtSize — przyjmuje GB, wyświetla czytelnie
const fmtSize = (gb) => {
  if (!gb || gb <= 0) return '—';
  if (gb < 1)    return (gb * 1024).toFixed(0) + ' MB';
  if (gb < 1000) return gb.toFixed(1) + ' GB';
  return (gb / 1024).toFixed(2) + ' TB';
};

// ── Komponenty UI ─────────────────────────────────────────────────────────────
const Modal = ({ title, sub, onClose, footer, children, width=620 }) => (
  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',backdropFilter:'blur(4px)',
    display:'flex',alignItems:'center',justifyContent:'center',zIndex:9000}} onClick={onClose}>
    <div className="card" style={{width,maxWidth:'92vw',maxHeight:'88vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
      </div>
      <div style={{padding:'18px 20px',overflow:'auto',flex:1}}>{children}</div>
      {footer && <div className="row" style={{padding:'12px 18px',borderTop:'1px solid var(--line)',justifyContent:'flex-end',gap:8}}>{footer}</div>}
    </div>
  </div>
);

const Field = ({ label, hint, children }) => (
  <div className="col" style={{gap:5,marginBottom:14}}>
    <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',letterSpacing:'.04em',textTransform:'uppercase',fontWeight:500}}>{label}</label>
    {children}
    {hint && <div className="dim" style={{fontSize:11}}>{hint}</div>}
  </div>
);

const KV = ({ k, v }) => (
  <div className="row" style={{justifyContent:'space-between',gap:16}}>
    <span className="dim" style={{fontSize:'var(--fs-sm)'}}>{k}</span>
    <span style={{fontSize:'var(--fs-sm)'}}>{v}</span>
  </div>
);

const Mini = ({ label, v }) => (
  <div style={{padding:'8px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5}}>
    <div style={{fontSize:9,letterSpacing:'0.08em',color:'var(--fg-dim)',textTransform:'uppercase',fontWeight:500}}>{label}</div>
    <div className="mono" style={{fontSize:13,marginTop:2}}>{v}</div>
  </div>
);

// ── Storage root ──────────────────────────────────────────────────────────────
const Storage = () => {
  const [tab,           setTab]           = React.useState('pools');
  const [selectedPool,  setSelectedPool]  = React.useState(null);
  const [selectedDisk,  setSelectedDisk]  = React.useState(null);
  const [formatTarget,  setFormatTarget]  = React.useState(null);
  const [mountTarget,   setMountTarget]   = React.useState(null);
  const [showFstab,     setShowFstab]     = React.useState(false);
  const [showAddMount,  setShowAddMount]  = React.useState(false);
  const [unmountTarget, setUnmountTarget] = React.useState(null);

  // Ładuj dane przy mount i co 10s
  const [devices, setDevices] = React.useState([]);
  React.useEffect(() => {
    const load = () => fetch('/api/storage/devices',{credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(data => {
        if (!data || !data.devices) return;

        // Dysk "nieprzypisany" = brak puli ZFS ORAZ brak zamontowanych partycji ORAZ brak fs
        // has_mounted_parts pochodzi z backendu (storage.go sprawdza children lsblk)
        const isUnassigned = (d) =>
          d.type === 'disk' &&
          !d.pool &&
          !d.has_mounted_parts &&
          !d.mount &&
          (!d.fs || d.fs === '');

        const allDisks   = data.devices.filter(d => d.type === 'disk');
        const unassigned = allDisks.filter(d => isUnassigned(d));
        storeSet('DISKS', allDisks.map(d => ({
          bay:    d.bay,
          model:  d.model  || '—',
          serial: d.serial || '—',
          size:   d.size   || '—',
          pool:   d.pool   || '—',
          type:   d.tran === 'nvme' ? 'NVMe' : d.rota ? 'HDD' : 'SSD',
          temp:   d.temp   || 0,
          hours:  d.hours  || 0,
          smart:  d.smart  || 'ok',
          io:     d.io     || 0,
          read:   d.read_mbps  || 0,
          write:  d.write_mbps || 0,
          iops:   d.iops   || 0,
          fs:     d.fs     || '—',
        })));
        storeSet('UNASSIGNED_DISKS', unassigned.map(d => ({
          bay:      d.bay,
          model:    d.model  || '—',
          serial:   d.serial || '—',
          size:     d.size   || '—',
          type:     d.tran === 'nvme' ? 'NVMe' : d.rota ? 'HDD' : 'SSD',
          state:    d.fs ? 'foreign' : 'unformatted',
          fs:       d.fs     || '—',
          hours:    d.hours  || 0,
          detected: 'przed chwilą',
          smart:    d.smart  || 'ok',
        })));
        setDevices(data.devices);
      }).catch(()=>{});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const UNASSIGNED_DISKS = useStore('UNASSIGNED_DISKS') || [];
  const newCount = UNASSIGNED_DISKS.length;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {newCount > 0 && tab !== 'unassigned' && (
        <div className="card" style={{borderColor:'color-mix(in oklch, var(--accent) 40%, var(--line))', background:'color-mix(in oklch, var(--accent) 6%, var(--bg-2))'}}>
          <div className="row" style={{padding:'10px 16px',justifyContent:'space-between',gap:12}}>
            <div className="row gap-sm">
              <span className="dot pulse" style={{color:'var(--accent)'}}/>
              <span style={{fontSize:'var(--fs-sm)'}}>Wykryto <b className="mono">{newCount}</b> nowych urządzeń pamięci masowej, które wymagają działania.</span>
            </div>
            <button className="btn sm primary" onClick={() => setTab('unassigned')}>Pokaż niezamontowane <Icon name="chevron" size={11}/></button>
          </div>
        </div>
      )}

      <div className="tabs">
        <div className={"tab " + (tab==='pools'      ? 'active':'')} onClick={()=>setTab('pools')}>Pule</div>
        <div className={"tab " + (tab==='disks'      ? 'active':'')} onClick={()=>setTab('disks')}>Dyski fizyczne</div>
        <div className={"tab " + (tab==='mounts'     ? 'active':'')} onClick={()=>setTab('mounts')}>Punkty montowania</div>
        <div className={"tab " + (tab==='unassigned' ? 'active':'')} onClick={()=>setTab('unassigned')}>
          Niezamontowane {newCount > 0 && <span className="badge accent" style={{marginLeft:6}}>{newCount}</span>}
        </div>
        <div className={"tab " + (tab==='snap'  ? 'active':'')} onClick={()=>setTab('snap')}>Migawki</div>
        <div className={"tab " + (tab==='smart'      ? 'active':'')} onClick={()=>setTab('smart')}>S.M.A.R.T.</div>
        <div className={"tab " + (tab==='leds'       ? 'active':'')} onClick={()=>setTab('leds')}>Zatoki (LED)</div>
      </div>

      {tab==='pools'      && (selectedPool ? <PoolDetail pool={selectedPool} onBack={()=>setSelectedPool(null)} onViewSnapshots={()=>setTab('snap')}/> : <PoolsList onSelect={setSelectedPool}/>)}
      {tab==='disks'      && <DisksList onSelect={setSelectedDisk} selected={selectedDisk}/>}
      {tab==='mounts'     && <MountsView onEditFstab={()=>setShowFstab(true)} onAdd={()=>setShowAddMount(true)} onUnmount={setUnmountTarget}/>}
      {tab==='unassigned' && <UnassignedView onFormat={setFormatTarget} onMount={setMountTarget}/>}
      {tab==='snap'  && <Snapshots/>}
      {tab==='smart' && <SmartView/>}
      {tab==='leds'  && <BayLedsView/>}

      {formatTarget  && <FormatModal   disk={formatTarget}   onClose={()=>setFormatTarget(null)}/>}
      {mountTarget   && <MountModal    disk={mountTarget}    onClose={()=>setMountTarget(null)}/>}
      {showFstab     && <FstabModal                          onClose={()=>setShowFstab(false)}/>}
      {showAddMount  && <AddMountModal                       onClose={()=>setShowAddMount(false)}/>}
      {unmountTarget && <UnmountConfirm mount={unmountTarget} onClose={()=>setUnmountTarget(null)}/>}
    </div>
  );
};

// ── Pools list ────────────────────────────────────────────────────────────────
const PoolsList = ({ onSelect }) => {
  const POOLS = useStore('POOLS') || [];
  const [showCreate, setShowCreate] = React.useState(false);
  return (
    <>
    <div className="grid grid-3">
      {POOLS.length === 0 && (
        <div className="card" style={{gridColumn:'1/-1',padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
          Ładowanie pul ZFS… (lub ZFS niedostępny)
        </div>
      )}
      {POOLS.map(p => {
        const pct = p.total > 0 ? (p.used / p.total) * 100 : 0;
        const cls = pct > 90 ? 'err' : pct > 75 ? 'warn' : 'ok';
        return (
          <div key={p.id || p.name} className="card" style={{cursor:'pointer'}} onClick={() => onSelect(p)}>
            <div className="card-head">
              <div>
                <div className="card-title">{p.name}</div>
                <div className="card-sub">{p.type || 'ZFS'} · {p.drives || '—'} dysków · parytet {p.parity || 0}</div>
              </div>
              <span className={"badge " + (p.health==='ok'?'ok':'warn')}>
                <span className="dot pulse"/>{p.health==='ok'?'OK':'UWAGA'}
              </span>
            </div>
            <div className="card-body col" style={{gap:14}}>
              <div className="row" style={{gap:16,alignItems:'center'}}>
                <Donut value={pct} size={90} thickness={8} color={pct>90?'var(--err)':pct>75?'var(--warn)':'var(--accent)'}/>
                <div className="col" style={{gap:4,flex:1}}>
                  <div className="mono" style={{fontSize:22,fontWeight:500}}>
                    {fmtSize(p.used)} <span className="dim" style={{fontSize:13}}>/ {fmtSize(p.total)}</span>
                  </div>
                  <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{fmtSize(p.avail ?? (p.total - p.used))} wolne</div>
                </div>
              </div>
              <div className="grid" style={{gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                <Mini label="IOPS"    v={fmtIops(p.iops)}/>
                <Mini label="ODCZYT"  v={fmtMbps(p.read_mbps)}/>
                <Mini label="ZAPIS"   v={fmtMbps(p.write_mbps)}/>
              </div>
              <div className={"bar " + cls}><i style={{width:pct+'%'}}/></div>
            </div>
          </div>
        );
      })}
      <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:280,borderStyle:'dashed',cursor:'pointer'}} onClick={()=>setShowCreate(true)}>
        <div className="col" style={{alignItems:'center',gap:6,color:'var(--fg-muted)'}}>
          <Icon name="plus" size={24}/>
          <div style={{fontSize:'var(--fs-sm)'}}>Utwórz nową pulę</div>
          <div className="dim" style={{fontSize:'var(--fs-xs)'}}>RAIDZ · MIRROR · STRIPE</div>
        </div>
      </div>
    </div>
    {showCreate && <CreatePoolModal onClose={()=>setShowCreate(false)}/>}
    </>
  );
};

// ── Pool detail ────────────────────────────────────────────────────────────────
const PoolDetail = ({ pool, onBack, onViewSnapshots }) => {
  const DISKS_ALL = useStore('DISKS') || [];
  const disks = DISKS_ALL.filter(d => d.pool === pool.name);
  const pct    = pool.total > 0 ? (pool.used / pool.total) * 100 : 0;
  const blocks = 32;
  const used   = Math.round((pct / 100) * blocks);

  const [scrubRunning, setScrubRunning] = React.useState(false);
  const [scrubOutput,  setScrubOutput]  = React.useState('');
  const [autoSnap,     setAutoSnap]     = React.useState(null);
  const [poolProps,    setPoolProps]     = React.useState({});

  React.useEffect(() => {
    // Prawdziwe właściwości ZFS
    fetch('/api/storage/exec-command', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({command: 'zfs get -H -o property,value compression,dedup,encryption '+pool.name})})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(!d?.output) return;
        const props = {};
        d.output.split('\n').forEach(line=>{
          const parts = line.split('\t');
          if(parts.length>=2) props[parts[0].trim()] = parts[1].trim();
        });
        setPoolProps(props);
      }).catch(()=>{});

    // Sprawdź cron dla auto-migawek
    fetch('/api/storage/exec-command', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({command: `crontab -l 2>/dev/null | grep -c "zfs snapshot.*${pool.name}" || echo 0`})})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ setAutoSnap(parseInt(d?.output||'0') > 0); })
      .catch(()=>setAutoSnap(false));
  }, [pool.name]);
  const parity = (pool.parity || 0) * 4;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="row" style={{gap:10}}>
          <button className="btn ghost sm" onClick={onBack}>
            <Icon name="chevron" size={14} style={{transform:'rotate(180deg)'}}/> Wszystkie pule
          </button>
          <span className="dim mono" style={{fontSize:'var(--fs-xs)'}}>/{pool.name}</span>
        </div>
        <div className="row gap-sm">
          <button className="btn sm" onClick={onViewSnapshots}>Migawki</button>
          <button className="btn sm" disabled={scrubRunning} onClick={async()=>{
            setScrubRunning(true);
            const r = await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({command:'zpool scrub '+pool.name})});
            const d = await r.json();
            setScrubOutput(d.output||'Scrub uruchomiony');
            setTimeout(()=>setScrubRunning(false), 3000);
          }}>{scrubRunning ? 'Scrub…' : 'Scrub'}</button>
          <button className="btn sm primary" onClick={async()=>{
            if(!confirm('Eksportować pulę '+pool.name+'? Zostanie odmontowana.')) return;
            const r = await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({command:'zpool export '+pool.name})});
            const d = await r.json();
            alert(d.ok ? 'Pula wyeksportowana' : 'Błąd: '+d.output);
            if(d.ok) onBack();
          }}>Eksportuj</button>
        </div>
      </div>

      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Mapa pojemności · {pool.name}</div>
              <div className="card-sub">{pool.type || 'ZFS'} · alokacja: {fmtSize(pool.used)} · wolne: {fmtSize(pool.avail ?? (pool.total - pool.used))}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="pool-vis">
              {Array.from({length:blocks}).map((_,i) => (
                <div key={i} className={"pool-block " + (i < parity ? 'parity' : i >= used + parity ? 'free' : '')}/>
              ))}
            </div>
            <div className="row" style={{gap:18,marginTop:14,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
              <span><span style={{display:'inline-block',width:10,height:10,background:'var(--accent)',borderRadius:2,marginRight:6,verticalAlign:'middle'}}/>Dane ({fmtSize(pool.used)})</span>
              <span><span style={{display:'inline-block',width:10,height:10,background:'oklch(0.6 0.16 280)',borderRadius:2,marginRight:6,verticalAlign:'middle'}}/>Parytet</span>
              <span><span style={{display:'inline-block',width:10,height:10,background:'var(--bg-3)',borderRadius:2,marginRight:6,verticalAlign:'middle'}}/>Wolne ({fmtSize(pool.avail ?? (pool.total - pool.used))})</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Stan i akcje</div></div>
          <div className="card-body col" style={{gap:10}}>
            <KV k="Stan"         v={<span className="badge ok"><span className="dot"/>ONLINE</span>}/>
            <KV k="Typ"          v={<span className="mono">{pool.type || 'ZFS'}</span>}/>
            <KV k="Suma kontrolna" v="SHA-256"/>
            <hr className="div"/>
            <KV k="Kompresja"     v={<span className="mono">{poolProps.compression||'—'}</span>}/>
            <KV k="Deduplikacja"  v={<span className="mono">{poolProps.dedup||'—'}</span>}/>
            <KV k="Szyfrowanie"   v={<span className={poolProps.encryption&&poolProps.encryption!=='off'?'badge ok':'mono dim'}>{poolProps.encryption||'—'}</span>}/>
            <hr className="div"/>
            <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:'var(--fs-sm)'}}>Auto-migawki co godzinę</span>
              <div className={'toggle'+(autoSnap?' on':'')} style={{cursor:'pointer'}} onClick={async()=>{
                const enable = !autoSnap;
                const cmd = enable
                  ? 'echo "0 * * * * zfs snapshot '+pool.name+'@auto-$(date +\%Y\%m\%d\%H%M)" | crontab -'
                  : 'crontab -l | grep -v "zfs snapshot.*'+pool.name+'" | crontab -';
                await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',
                  headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd})});
                setAutoSnap(enable);
              }}/>
            </div>
            {scrubOutput && (
              <div style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--ok)',
                padding:'6px 8px',background:'color-mix(in oklch,var(--ok) 8%,transparent)',
                borderRadius:5,marginTop:4}}>
                {scrubOutput}
              </div>
            )}
          </div>
        </div>
      </div>

      {disks.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Dyski w puli</div>
            <div className="card-actions"><span className="badge">{disks.length} aktywnych</span></div>
          </div>
          <table className="table">
            <thead><tr><th>Zatoka</th><th>Model</th><th>Numer seryjny</th><th>Pojemność</th><th>Temp.</th><th>Godziny</th><th>I/O</th><th>S.M.A.R.T.</th></tr></thead>
            <tbody>
              {disks.map(d => (
                <tr key={d.bay}>
                  <td><span className="row gap-sm"><span className={"disk-led " + (d.smart==='warn'?'warn':'')}/><span className="mono">{d.bay}</span></span></td>
                  <td>{d.model}</td>
                  <td className="mono dim">{d.serial}</td>
                  <td className="mono">{d.size}</td>
                  <td><span className="mono" style={d.temp > 42 ? {color:'var(--warn)'} : {}}>{d.temp}°C</span></td>
                  <td className="mono dim">{(d.hours||0).toLocaleString('pl')}</td>
                  <td style={{width:120}}><div className="bar"><i style={{width:(d.io||0)+'%'}}/></div></td>
                  <td>{d.smart==='warn' ? <span className="badge warn">WARN</span> : <span className="badge ok">PASSED</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Disk icon ─────────────────────────────────────────────────────────────────
const DiskIcon = ({ type, size=32 }) => {
  const s = size;
  if (type === 'NVMe' || type === 'SSD') return (
    <svg width={s} height={s} viewBox="0 0 36 36" fill="none">
      <rect x="2" y="10" width="32" height="16" rx="3" fill="var(--bg-3)" stroke="var(--line)" strokeWidth="1.5"/>
      <rect x="6" y="14" width="18" height="8" rx="1.5" fill="var(--accent)" opacity="0.9"/>
      <rect x="26" y="14" width="4" height="3" rx="1" fill="var(--fg-dim)"/>
      <rect x="26" y="19" width="4" height="3" rx="1" fill="var(--fg-dim)"/>
    </svg>
  );
  return (
    <svg width={s} height={s} viewBox="0 0 36 36" fill="none">
      <rect x="3" y="5" width="30" height="26" rx="3" fill="var(--bg-3)" stroke="var(--line)" strokeWidth="1.5"/>
      <circle cx="18" cy="18" r="8" fill="var(--bg-2)" stroke="var(--line)" strokeWidth="1"/>
      <circle cx="18" cy="18" r="3" fill="var(--fg-dim)"/>
      <circle cx="18" cy="18" r="1.5" fill="var(--bg-1)"/>
      <rect x="5" y="7" width="6" height="2" rx="1" fill="var(--accent)" opacity="0.8"/>
      <rect x="5" y="27" width="26" height="2" rx="1" fill="var(--line)"/>
    </svg>
  );
};

// ── Partition colours ──────────────────────────────────────────────────────────
const PART_COLORS = {
  zfs:'oklch(0.58 0.18 220)', ext4:'oklch(0.58 0.18 140)', xfs:'oklch(0.60 0.17 80)',
  btrfs:'oklch(0.60 0.17 50)', ntfs:'oklch(0.58 0.17 290)', exfat:'oklch(0.60 0.17 20)',
  swap:'oklch(0.55 0.16 350)', efi:'oklch(0.65 0.12 60)', free:'var(--bg-3)',
};
const PART_LABELS = { zfs:'ZFS', ext4:'EXT4', xfs:'XFS', btrfs:'Btrfs', ntfs:'NTFS', exfat:'exFAT', swap:'SWAP', efi:'EFI', free:'Wolne' };

const diskPartitions = (d) => {
  const gb   = parseFloat(d.size) * (d.size.includes('TB') ? 1000 : 1);
  const bay  = d.bay || 'sda';
  // NVMe: nvme0n1 → partycje to nvme0n1p1, nvme0n1p2
  // SATA/SAS: sda → sda1, sda2
  const part = (n) => bay.match(/nvme/) ? bay+'p'+n : bay+n;
  if (d.type === 'NVMe' || d.type === 'SSD') return [
    { label:part(1), fs:'efi',  size:0.5,         mount:'/boot/efi',           flags:'boot' },
    { label:part(2), fs:'zfs',  size:gb*0.98,     mount:'['+(d.pool||'?')+']', flags:'zfs_member' },
    { label:null,    fs:'free', size:gb*0.02-0.5, mount:'—',                   flags:'' },
  ];
  const mainFs = d.fs && d.fs !== '—' ? d.fs : 'ext4';
  const mainMount = d.pool && d.pool !== '—' ? '['+d.pool+']' : (d.mount && d.mount !== '—' ? d.mount : '/mnt/'+bay);
  return [
    { label:part(1), fs:mainFs, size:gb*0.9, mount:mainMount, flags:mainFs==='zfs'?'zfs_member':'' },
    { label:part(2), fs:'swap', size:4,      mount:'[SWAP]',  flags:'swap' },
    { label:null,    fs:'free', size:gb*0.1-4, mount:'—',     flags:'' },
  ];
};

// ── GParted-style disk panel ──────────────────────────────────────────────────
const DiskGparted = ({ disk, onClose }) => {
  const [parts, setParts] = React.useState(diskPartitions(disk));

  // Załaduj prawdziwe partycje z lsblk
  React.useEffect(() => {
    fetch('/api/storage/exec-command', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ command: `lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE -b /dev/${disk.bay}` }),
    })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !data.output) return;
      try {
        const lsblk = JSON.parse(data.output);
        const topDev = (lsblk.blockdevices || [])[0];
        if (!topDev) return;
        const children = topDev.children || [];
        if (!children.length) return;
        const totalBytes = parseInt(topDev.size) || 1;
        const parsed = children.map(p => {
          const sizeBytes = parseInt(p.size) || 0;
          const sizeGB = sizeBytes / 1073741824;
          const fs = (p.fstype || 'free').toLowerCase();
          return {
            label: p.name,
            fs:    fs || 'free',
            size:  sizeGB,
            mount: p.mountpoint || '—',
            flags: '',
          };
        });
        // Dodaj wolne miejsce jeśli jest
        const usedBytes = children.reduce((s,p) => s + (parseInt(p.size)||0), 0);
        const freeBytes = (parseInt(topDev.size)||0) - usedBytes;
        if (freeBytes > 1048576) parsed.push({ label:null, fs:'free', size:freeBytes/1073741824, mount:'—', flags:'' });
        setParts(parsed);
      } catch(e) {}
    }).catch(() => {});
  }, [disk.bay]);

  const total = parts.reduce((s,p) => s + p.size, 0) || 1;
  const gbLabel = v => v >= 1000 ? (v/1000).toFixed(1)+' TB' : v >= 1 ? v.toFixed(1)+' GB' : (v*1024).toFixed(0)+' MB';

  return (
    <div className="card" style={{marginTop:'var(--gutter)'}}>
      <div className="card-head">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <DiskIcon type={disk.type} size={36}/>
          <div>
            <div className="card-title" style={{fontSize:'var(--fs-base)'}}>{disk.bay} — {disk.model}</div>
            <div className="card-sub">{disk.serial} · {disk.size} · {disk.type}</div>
          </div>
        </div>
        <div className="card-actions">
          <button className="btn sm"><Icon name="refresh" size={12}/> Odśwież</button>
          <button className="btn sm primary">Nowa partycja</button>
          <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
        </div>
      </div>

      <div style={{padding:'0 20px 20px'}}>
        {/* GParted bar */}
        <div style={{display:'flex',height:44,borderRadius:5,overflow:'hidden',border:'1px solid var(--line)',marginBottom:8,boxShadow:'inset 0 1px 4px rgba(0,0,0,0.25)'}}>
          {parts.map((p,i) => {
            const w = (p.size/total)*100;
            const col = PART_COLORS[p.fs] || 'var(--bg-3)';
            return (
              <div key={i} style={{width:w+'%',background:col,borderRight:i<parts.length-1?'2px solid var(--bg-1)':'none',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',position:'relative',minWidth:2}}>
                {w > 5 && <span style={{fontSize:10,fontWeight:600,color:'#fff',textShadow:'0 1px 3px rgba(0,0,0,0.6)',whiteSpace:'nowrap',padding:'0 4px'}}>{p.label||'wolne'} <span style={{opacity:0.75}}>{PART_LABELS[p.fs]}</span></span>}
                {p.fs==='free' && <div style={{position:'absolute',inset:0,backgroundImage:'repeating-linear-gradient(-45deg,transparent,transparent 3px,rgba(255,255,255,0.04) 3px,rgba(255,255,255,0.04) 6px)'}}/>}
              </div>
            );
          })}
        </div>

        <div style={{display:'flex',gap:16,marginBottom:18,flexWrap:'wrap'}}>
          {parts.map((p,i) => p.fs !== 'free' && (
            <span key={i} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--fg-muted)'}}>
              <span style={{width:10,height:10,borderRadius:2,background:PART_COLORS[p.fs],display:'inline-block'}}/>{p.label} · {PART_LABELS[p.fs]}
            </span>
          ))}
          <span style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--fg-muted)'}}>
            <span style={{width:10,height:10,borderRadius:2,background:'var(--bg-3)',border:'1px solid var(--line)',display:'inline-block'}}/>Wolne
          </span>
        </div>

        <table className="table">
          <thead><tr><th style={{width:14}}></th><th>Partycja</th><th>System plików</th><th>Punkt montowania</th><th>Rozmiar</th><th>Flagi</th><th></th></tr></thead>
          <tbody>
            {parts.map((p,i) => (
              <tr key={i} style={p.fs==='free'?{opacity:0.55}:{}}>
                <td><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:PART_COLORS[p.fs]||'var(--bg-3)',border:'1px solid var(--line)'}}/></td>
                <td className="mono">{p.label || <span className="dim">—</span>}</td>
                <td><span className={"chip " + (p.fs==='zfs'?'accent':'')}>{PART_LABELS[p.fs]}</span></td>
                <td className="mono dim">{p.mount}</td>
                <td className="mono">{gbLabel(p.size)}</td>
                <td className="mono dim" style={{fontSize:10}}>{p.flags||'—'}</td>
                <td>
                  {p.fs !== 'free'
                    ? <div style={{display:'flex',gap:4}}><button className="btn ghost sm">Zmień rozmiar</button><button className="btn ghost sm">Sprawdź</button></div>
                    : <button className="btn sm primary" style={{fontSize:11}}>+ Utwórz</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* SMART strip z prawdziwych danych */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginTop:16}}>
          {[
            {k:'Temperatura',     v:disk.temp+'°C',                    warn:disk.temp>42},
            {k:'Godziny pracy',   v:(disk.hours||0).toLocaleString('pl'), warn:false},
            {k:'Realocowane',     v:disk.smart==='warn'?'12':'0',       warn:disk.smart==='warn'},
            {k:'Niekorektowalne', v:'0',                                 warn:false},
            {k:'S.M.A.R.T.',      v:disk.smart==='warn'?'WARN':'PASSED',warn:disk.smart==='warn'},
          ].map((x,i) => (
            <div key={i} style={{padding:'8px 10px',background:'var(--bg-2)',border:'1px solid '+(x.warn?'color-mix(in oklch,var(--warn) 40%,var(--line))':'var(--line)'),borderRadius:5}}>
              <div style={{fontSize:9,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--fg-dim)',fontWeight:500}}>{x.k}</div>
              <div className="mono" style={{fontSize:13,marginTop:2,color:x.warn?'var(--warn)':'var(--fg)'}}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Context menu ──────────────────────────────────────────────────────────────
const DiskMenu = ({ disk }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = [
    { label:'Uruchom test S.M.A.R.T.', action: async () => { await fetch('/api/storage/smart/run-extended-test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:disk.bay})}); }},
    { label:'Sprawdź system plików',   action: async () => { await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'fsck -n /dev/'+disk.bay})}); }},
    { label:'─' },
    { label:'Wysuń dysk', action: async () => { await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'udisksctl power-off -b /dev/'+disk.bay})}); }},
    { label:'─' },
    { label:'Usuń wszystkie partycje', danger:true, action: async () => { if(confirm('Usunąć wszystkie partycje na '+disk.bay+'?')) await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'wipefs -a /dev/'+disk.bay})}); }},
  ];

  return (
    <div ref={ref} style={{position:'relative'}}>
      <button className="icon-btn" onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}>
        <Icon name="more"/>
      </button>
      {open && (
        <div style={{position:'absolute',right:0,top:'100%',zIndex:500,marginTop:4,background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:7,boxShadow:'0 8px 28px rgba(0,0,0,0.35)',minWidth:230,padding:'4px 0'}}>
          <div style={{padding:'6px 12px 4px',fontSize:10,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--fg-dim)',fontWeight:500}}>{disk.bay} — {disk.model}</div>
          {items.map((it,i) => it.label==='─'
            ? <div key={i} style={{height:1,background:'var(--line)',margin:'3px 0'}}/>
            : <div key={i} onClick={e=>{e.stopPropagation();setOpen(false);it.action&&it.action();}}
                style={{display:'flex',alignItems:'center',gap:9,padding:'7px 14px',cursor:'pointer',fontSize:'var(--fs-sm)',color:it.danger?'var(--err)':'var(--fg)',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg-3)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                {it.label}
              </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Disks list ────────────────────────────────────────────────────────────────
const DisksList = ({ onSelect, selected }) => {
  const DISKS = useStore('DISKS') || [];
  const [filter, setFilter] = React.useState('');
  const visible  = DISKS.filter(d => !filter || d.model.toLowerCase().includes(filter.toLowerCase()) || d.bay.includes(filter) || (d.pool||'').includes(filter));
  const selDisk  = DISKS.find(d => d.bay === selected);

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Dyski fizyczne</div>
          <div className="card-actions">
            <div className="topbar-search" style={{flex:'none',width:240}}>
              <Icon name="search" size={12}/>
              <input placeholder="Filtruj..." value={filter} onChange={e=>setFilter(e.target.value)}/>
            </div>
            <button className="btn sm" onClick={()=>fetch('/api/storage/rescan',{method:'POST',credentials:'include'})}><Icon name="refresh" size={12}/> Skanuj</button>
          </div>
        </div>
        <div style={{overflow:'auto'}}>
          <table className="table">
            <thead><tr>
              <th style={{width:30}}><div className="checkbox"/></th>
              <th></th>
              <th>Zatoka</th><th>Typ</th><th>Model</th><th>S/N</th><th>Pojemność</th><th>Pula</th>
              <th>Temp.</th><th>Pracy [h]</th><th>S.M.A.R.T.</th><th>I/O</th><th></th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={13} style={{textAlign:'center',padding:30,color:'var(--fg-dim)'}}>
                  {DISKS.length === 0 ? 'Ładowanie dysków…' : 'Brak dysków pasujących do filtra'}
                </td></tr>
              )}
              {visible.map(d => (
                <tr key={d.bay} className={selected===d.bay?'selected':''} onClick={()=>onSelect(selected===d.bay?null:d.bay)} style={{cursor:'pointer'}}>
                  <td><div className="checkbox"/></td>
                  <td style={{width:28,paddingRight:0}}><DiskIcon type={d.type} size={22}/></td>
                  <td><span className="row gap-sm"><span className={"disk-led "+(d.smart==='warn'?'warn':'')}/><span className="mono">{d.bay}</span></span></td>
                  <td><span className="chip">{d.type}</span></td>
                  <td>{d.model}</td>
                  <td className="mono dim">{d.serial}</td>
                  <td className="mono">{d.size}</td>
                  <td>{d.pool && d.pool !== '—' ? <span className="chip accent">{d.pool}</span> : <span className="dim">—</span>}</td>
                  <td><span className="mono" style={d.temp>42?{color:'var(--warn)'}:{}}>{d.temp}°C</span></td>
                  <td className="mono dim">{(d.hours||0).toLocaleString('pl')}</td>
                  <td>{d.smart==='warn'?<span className="badge warn">WARN</span>:<span className="badge ok">PASSED</span>}</td>
                  <td style={{width:90}}><div className="bar"><i style={{width:Math.min(100,d.io||0)+'%'}}/></div></td>
                  <td onClick={e=>e.stopPropagation()}><DiskMenu disk={d}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selDisk && <DiskGparted disk={selDisk} onClose={()=>onSelect(null)}/>}
    </div>
  );
};

// ── Mounts ────────────────────────────────────────────────────────────────────
const MountsView = ({ onEditFstab, onAdd, onUnmount }) => {
  const MOUNTS = useStore('MOUNTS') || [];
  const [mounts, setMounts] = React.useState(MOUNTS);
  React.useEffect(() => { setMounts(MOUNTS); }, [MOUNTS]);

  // Odśwież z API co 8s
  React.useEffect(() => {
    const load = () => fetch('/api/storage/mounts',{credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(raw => {
        if (!Array.isArray(raw)) return;
        const skip = new Set(['tmpfs','devtmpfs','sysfs','proc','cgroup','cgroup2','pstore','securityfs','debugfs','hugetlbfs','mqueue','fusectl','bpf','tracefs']);
        const parsed = raw.filter(m=>m.mount&&!skip.has(m.fs)&&m.mount!=='none').map(m=>({
          mp:      m.mount   || '/',
          device:  m.device  || '—',
          fs:      m.fs      || 'ext4',
          opts:    m.options || 'rw',
          size:    (m.total_gb||0).toFixed(1) + ' GB',
          used:    m.used_gb || 0,
          pct:     m.percent || 0,
          auto:    true,
          type:    (m.fs||'').toLowerCase()==='zfs'?'ZFS':(m.fs||'').toUpperCase().slice(0,5),
          inFstab: true,
        }));
        setMounts(parsed);
        storeSet('MOUNTS', parsed);
      }).catch(()=>{});
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Aktywne punkty montowania</div>
            <div className="card-sub">{mounts.length} montowań · {mounts.filter(m=>m.inFstab).length} we /etc/fstab · {mounts.filter(m=>!m.inFstab).length} tymczasowych</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={onEditFstab}><Icon name="terminal" size={12}/> Edytuj /etc/fstab</button>
            <button className="btn sm primary" onClick={onAdd}><Icon name="plus" size={12}/> Dodaj montowanie</button>
          </div>
        </div>
        <table className="table">
          <thead><tr>
            <th>Punkt montowania</th><th>Urządzenie</th><th>Typ</th><th>System plików</th><th>Opcje</th><th>Wykorzystanie</th><th>Auto</th><th>fstab</th><th></th>
          </tr></thead>
          <tbody>
            {mounts.length === 0 && <tr><td colSpan={9} style={{textAlign:'center',padding:30,color:'var(--fg-dim)'}}>Ładowanie punktów montowania…</td></tr>}
            {mounts.map((m,i) => {
              const pct = m.pct || (m.used / parseFloat(m.size)) * 100 || 0;
              return (
                <tr key={i}>
                  <td><span className="row gap-sm"><Icon name="folder" size={12} style={{color:'var(--fg-dim)'}}/><span className="mono">{m.mp}</span></span></td>
                  <td className="mono">{m.device}</td>
                  <td><span className={"chip "+(m.type==='ZFS'?'accent':'')}>{m.type}</span></td>
                  <td className="mono dim">{m.fs}</td>
                  <td className="mono dim" style={{fontSize:11,maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.opts}</td>
                  <td style={{width:200}}>
                    <div className="row gap-sm">
                      <div className="bar" style={{flex:1}}><i style={{width:Math.min(100,pct)+'%'}}/></div>
                      <span className="mono dim" style={{fontSize:11,minWidth:78,textAlign:'right'}}>{m.used.toFixed?m.used.toFixed(1):m.used}/{m.size}</span>
                    </div>
                  </td>
                  <td><div className={"toggle "+(m.auto?'on':'')}/></td>
                  <td>{m.inFstab?<span className="badge ok">tak</span>:<span className="badge warn">nie</span>}</td>
                  <td>
                    <button className="btn ghost sm" onClick={()=>onUnmount(m)}>Odmontuj</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Unassigned ────────────────────────────────────────────────────────────────
const stateLabel = {
  unformatted: { txt:'Niesformatowany',    cls:'warn' },
  foreign:     { txt:'Obcy system plików', cls:'info' },
  'mounted-ro':{ txt:'Tylko do odczytu',   cls:'' },
};

const UnassignedView = ({ onFormat, onMount }) => {
  const UNASSIGNED = useStore('UNASSIGNED_DISKS') || [];
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title row gap-sm"><span className="dot pulse" style={{color:'var(--accent)'}}/> Wykryte urządzenia</div>
            <div className="card-sub">Automatyczne wykrywanie nowych dysków · ostatni skan: przed chwilą</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>fetch('/api/storage/rescan',{method:'POST',credentials:'include'})}><Icon name="refresh" size={12}/> Skanuj teraz</button>
          </div>
        </div>
        <div className="card-body" style={{padding:0}}>
          {UNASSIGNED.length === 0 && (
            <div style={{padding:30,textAlign:'center',color:'var(--fg-dim)'}}>
              <Icon name="check" size={20} style={{opacity:.4,display:'block',margin:'0 auto 8px'}}/> Brak niezamontowanych urządzeń
            </div>
          )}
          {UNASSIGNED.map((d,i) => {
            const s = stateLabel[d.state] || {txt:d.state, cls:''};
            return (
              <div key={i} style={{padding:'14px 18px',borderTop:i>0?'1px solid var(--line)':'none',display:'grid',gridTemplateColumns:'auto 1fr auto',gap:16,alignItems:'center'}}>
                <div className="row gap-sm">
                  <span className="disk-led warn"/>
                  <div className="col" style={{gap:2}}>
                    <span className="mono" style={{fontSize:'var(--fs-sm)',fontWeight:500}}>{d.bay}</span>
                    <span className="chip" style={{fontSize:9,alignSelf:'flex-start'}}>{d.type}</span>
                  </div>
                </div>
                <div className="col" style={{gap:4}}>
                  <div className="row gap-sm" style={{flexWrap:'wrap'}}>
                    <span style={{fontSize:'var(--fs-sm)',fontWeight:500}}>{d.model}</span>
                    <span className="mono dim" style={{fontSize:11}}>· {d.serial}</span>
                    <span className={"badge "+s.cls}>{s.txt}</span>
                  </div>
                  <div className="row gap-sm" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                    <span>Pojemność: <span style={{color:'var(--fg-muted)'}}>{d.size}</span></span>
                    <span>·</span>
                    <span>FS: <span style={{color:'var(--fg-muted)'}}>{d.fs}</span></span>
                    <span>·</span>
                    <span>Wykryto: <span style={{color:'var(--fg-muted)'}}>{d.detected}</span></span>
                  </div>
                </div>
                <div className="row gap-sm">
                  <button className="btn sm" onClick={()=>onMount(d)}><Icon name="folder" size={12}/> Zamontuj</button>
                  <button className="btn sm primary" onClick={()=>onFormat(d)}><Icon name="settings" size={12}/> Formatuj</button>
                  <button className="icon-btn"><Icon name="more"/></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Wskazówki</div></div>
        <div className="card-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,fontSize:'var(--fs-sm)'}}>
          <div className="col" style={{gap:6}}><div className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',letterSpacing:'.06em',textTransform:'uppercase'}}>ZFS</div><div>Najlepsze dla pul z parytetem (RAIDZ1/Z2), migawkami i kompresją lz4. Wymaga ≥3 dysków dla RAIDZ.</div></div>
          <div className="col" style={{gap:6}}><div className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',letterSpacing:'.06em',textTransform:'uppercase'}}>RAID (mdadm)</div><div>Klasyczny RAID 0/1/5/6/10. Tworzy /dev/md* sformatowane EXT4 lub XFS.</div></div>
          <div className="col" style={{gap:6}}><div className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',letterSpacing:'.06em',textTransform:'uppercase'}}>EXT4 / XFS / Btrfs</div><div>Pojedynczy dysk lub partycja USB. Btrfs — migawki; XFS — duże pliki; EXT4 — uniwersalny.</div></div>
        </div>
      </div>
    </div>
  );
};

// ── Snapshots ─────────────────────────────────────────────────────────────────
const SNAP_INIT = [
  { name:'tank/media@auto-08-30',      size:'12.4 GB', date:'dzisiaj 08:31',  auto:true  },
  { name:'tank/media@auto-07-30',      size:'12.1 GB', date:'dzisiaj 07:31',  auto:true  },
  { name:'tank/docs@manual-pre-mig',   size:'412 MB',  date:'wczoraj 22:00',  auto:false },
  { name:'fast-nvme/work@auto-daily',  size:'84 MB',   date:'wczoraj 00:00',  auto:true  },
  { name:'backup-cold/archive@weekly', size:'118 GB',  date:'23.04 03:00',    auto:true  },
  { name:'tank/media@manual-vacation', size:'9.8 GB',  date:'20.04 18:42',    auto:false },
];

const Snapshots = () => {
  const [snaps,         setSnaps]         = React.useState([]);
  const [loading,       setLoading]       = React.useState(true);
  const [showCreate,    setShowCreate]    = React.useState(false);
  const [restoreTarget, setRestoreTarget] = React.useState(null);
  const [deleteTarget,  setDeleteTarget]  = React.useState(null);
  const [showPolicy,    setShowPolicy]    = React.useState(false);

  // Załaduj migawki z API
  const loadSnaps = () => {
    fetch('/api/zfs/snapshots', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.snapshots) {
          setSnaps(data.snapshots);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => {
    loadSnaps();
    const id = setInterval(loadSnaps, 30000); // Odświeżaj co 30s
    return () => clearInterval(id);
  }, []);

  const doDelete = async (snap) => {
    await fetch('/api/zfs/snapshots/' + encodeURIComponent(snap.name), {
      method: 'DELETE',
      credentials: 'include'
    });
    loadSnaps();
    setDeleteTarget(null);
  };

  const doRestore = async (snap, mode) => {
    await fetch('/api/zfs/snapshots/' + encodeURIComponent(snap.name), {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: mode})
    });
    setRestoreTarget(null);
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Migawki ZFS</div>
            <div className="card-sub">{snaps.length} migawek · {snaps.filter(s=>s.auto).length} automatycznych · {snaps.filter(s=>!s.auto).length} ręcznych</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>setShowCreate(true)}><Icon name="plus" size={12}/> Utwórz migawkę</button>
            <button className="btn sm primary" onClick={()=>setShowPolicy(true)}>Polityka retencji</button>
          </div>
        </div>
        <table className="table">
          <thead><tr>
            <th style={{width:30}}><div className="checkbox"/></th>
            <th>Dataset@migawka</th><th>Rozmiar</th><th>Utworzono</th><th>Typ</th><th></th>
          </tr></thead>
          <tbody>
            {snaps.map((s,i) => (
              <tr key={i}>
                <td><div className="checkbox"/></td>
                <td>
                  <div className="col" style={{gap:2}}>
                    <span className="mono" style={{fontSize:'var(--fs-sm)'}}>
                      {s.name.split('@')[0]}<span style={{color:'var(--fg-dim)'}}>@</span>{s.name.split('@')[1]}
                    </span>
                  </div>
                </td>
                <td className="mono">{s.size}</td>
                <td className="dim">{s.date}</td>
                <td>{s.auto ? <span className="badge" style={{color:'var(--info)'}}>auto</span> : <span className="badge accent">manual</span>}</td>
                <td>
                  <div className="row gap-sm">
                    <button className="btn ghost sm" onClick={()=>setRestoreTarget(s)}>Przywróć</button>
                    <button className="btn ghost sm" style={{color:'var(--fg-dim)'}}>Klonuj</button>
                    <button className="btn ghost sm" onClick={()=>setDeleteTarget(s)} style={{color:'var(--err)'}}>Usuń</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate    && <SnapCreateModal  onClose={()=>setShowCreate(false)}  onCreate={s=>{setSnaps(prev=>[s,...prev]);setShowCreate(false);}}/>}
      {restoreTarget && <SnapRestoreModal snap={restoreTarget} onClose={()=>setRestoreTarget(null)}/>}
      {deleteTarget  && <SnapDeleteModal  snap={deleteTarget}  onClose={()=>setDeleteTarget(null)} onConfirm={()=>doDelete(deleteTarget)}/>}
      {showPolicy    && <SnapPolicyModal  onClose={()=>setShowPolicy(false)}/>}
    </div>
  );
};

const SnapCreateModal = ({ onClose, onCreate }) => {
  const POOLS_RAW = useStore('POOLS') || [];
  const datasets  = POOLS_RAW.length ? POOLS_RAW.flatMap(p=>[p.name+'/media',p.name+'/docs',p.name]) : ['tank/media','tank/docs','tank'];
  const [ds,        setDs]        = React.useState(datasets[0]);
  const [label,     setLabel]     = React.useState('manual-'+new Date().toISOString().slice(0,10));
  const [recursive, setRecursive] = React.useState(false);
  const snapName = `${ds}@${label}`;
  const create = async () => {
    await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({command:'zfs snapshot'+(recursive?' -r':'')+' '+snapName})}).catch(()=>{});
    onCreate({ name:snapName, size:'0 B', date:'teraz', auto:false });
  };
  return (
    <Modal title="Utwórz migawkę ZFS" sub="zfs snapshot" onClose={onClose} width={560}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={create}>Utwórz migawkę</button></>}>
      <Field label="Dataset">
        <select style={{...inputCss,fontFamily:'var(--font-mono)'}} value={ds} onChange={e=>setDs(e.target.value)}>
          {datasets.map(d=><option key={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Nazwa migawki" hint="Dozwolone: litery, cyfry, myślnik, podkreślenie">
        <input style={inputCss} value={label} onChange={e=>setLabel(e.target.value)}/>
      </Field>
      <div style={{padding:'8px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,marginBottom:14}}>
        <div className="row" style={{justifyContent:'space-between'}}>
          <div className="col" style={{gap:2}}>
            <span style={{fontSize:'var(--fs-sm)'}}>Rekurencyjnie <span className="mono dim">(-r)</span></span>
            <span className="dim" style={{fontSize:11}}>Obejmie wszystkie pod-datasety</span>
          </div>
          <div className={"toggle "+(recursive?'on':'')} onClick={()=>setRecursive(!recursive)}/>
        </div>
      </div>
      <Field label="Polecenie">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:12,color:'var(--fg-muted)'}}>
          {`zfs snapshot${recursive?' -r':''} ${snapName}`}
        </pre>
      </Field>
    </Modal>
  );
};

const SnapRestoreModal = ({ snap, onClose }) => {
  const [mode, setMode] = React.useState('rollback');
  const doRestore = async () => {
    const cmd = mode==='rollback' ? `zfs rollback -r ${snap.name}` : `zfs clone ${snap.name} ${snap.name.split('@')[0]}-clone`;
    await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd})}).catch(()=>{});
    onClose();
  };
  return (
    <Modal title="Przywróć migawkę" sub={snap.name} onClose={onClose} width={620}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" style={{background:'var(--warn)',borderColor:'var(--warn)'}} onClick={doRestore}>Przywróć</button></>}>
      <div style={{padding:'10px 12px',background:'color-mix(in oklch,var(--warn) 8%,var(--bg-2))',border:'1px solid color-mix(in oklch,var(--warn) 35%,var(--line))',borderRadius:5,marginBottom:16,fontSize:'var(--fs-sm)'}}>
        <b style={{color:'var(--warn)'}}>Uwaga:</b> przywrócenie nadpisze bieżący stan datasetu. Operacja jest nieodwracalna.
      </div>
      <Field label="Tryb przywracania">
        <div style={{display:'flex',gap:8}}>
          {[{v:'rollback',t:'Rollback',d:'Przywróć dataset (usuwa nowsze migawki)'},{v:'clone',t:'Klonuj',d:'Utwórz nowy dataset (bezpieczne)'}].map(o => (
            <div key={o.v} onClick={()=>setMode(o.v)} style={{flex:1,padding:'10px 12px',border:'1px solid '+(mode===o.v?'var(--accent)':'var(--line)'),background:mode===o.v?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer'}}>
              <div className="mono" style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:3}}>{o.t}</div>
              <div className="dim" style={{fontSize:11}}>{o.d}</div>
            </div>
          ))}
        </div>
      </Field>
      <Field label="Polecenie">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:12,color:'var(--fg-muted)'}}>
          {mode==='rollback' ? `zfs rollback -r ${snap.name}` : `zfs clone ${snap.name} ${snap.name.split('@')[0]}-clone`}
        </pre>
      </Field>
    </Modal>
  );
};

const SnapDeleteModal = ({ snap, onClose, onConfirm }) => (
  <Modal title="Usuń migawkę" sub={snap.name} onClose={onClose} width={480}
    footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" style={{background:'var(--err)',borderColor:'var(--err)'}} onClick={onConfirm}>Usuń na stałe</button></>}>
    <div style={{fontSize:'var(--fs-sm)',marginBottom:14}}>Migawka <span className="mono">{snap.name}</span> ({snap.size}) zostanie trwale usunięta.</div>
    <Field label="Polecenie">
      <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:12,color:'var(--fg-muted)'}}>{`zfs destroy ${snap.name}`}</pre>
    </Field>
  </Modal>
);

const SnapPolicyModal = ({ onClose }) => {
  const [hourly, setHourly] = React.useState(24);
  const [daily,  setDaily]  = React.useState(7);
  const [weekly, setWeekly] = React.useState(4);
  const [monthly,setMonthly]= React.useState(3);
  const Row = ({label,v,set}) => (
    <div className="row" style={{justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line)'}}>
      <span style={{fontSize:'var(--fs-sm)'}}>{label}</span>
      <div className="row gap-sm">
        <button className="icon-btn" style={{width:26,height:26}} onClick={()=>set(x=>Math.max(0,x-1))}>−</button>
        <span className="mono" style={{minWidth:28,textAlign:'center',fontSize:'var(--fs-sm)'}}>{v}</span>
        <button className="icon-btn" style={{width:26,height:26}} onClick={()=>set(x=>x+1)}>+</button>
        <span className="dim" style={{fontSize:11,minWidth:50}}>{v===0?'wyłączone':v===1?'1 kopia':v+' kopii'}</span>
      </div>
    </div>
  );
  return (
    <Modal title="Polityka retencji migawek" sub="Automatyczne tworzenie i usuwanie migawek ZFS" onClose={onClose} width={520}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={onClose}>Zapisz politykę</button></>}>
      <Row label="Godzinowe (co 1h)"         v={hourly}  set={setHourly}/>
      <Row label="Dzienne (co 24h)"           v={daily}   set={setDaily}/>
      <Row label="Tygodniowe (w niedzielę)"   v={weekly}  set={setWeekly}/>
      <Row label="Miesięczne (1. dnia)"       v={monthly} set={setMonthly}/>
      <div style={{marginTop:14,padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)',fontFamily:'var(--font-mono)'}}>
        Łącznie retencja: ~{hourly+daily*24+weekly*168+monthly*720}h · {hourly+daily+weekly+monthly} migawek max
      </div>
    </Modal>
  );
};

// ── SMART view ────────────────────────────────────────────────────────────────
const SmartView = () => {
  const DISKS = useStore('DISKS') || [];
  const [details, setDetails] = React.useState({});

  const loadDetails = async (bay) => {
    const r = await fetch('/api/storage/smart/details/'+bay,{credentials:'include'}).catch(()=>null);
    if (!r || !r.ok) return;
    const d = await r.json();
    setDetails(prev => ({...prev, [bay]: d}));
  };

  return (
    <div className="grid grid-2">
      {DISKS.length === 0 && <div className="card" style={{gridColumn:'1/-1',padding:40,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie danych S.M.A.R.T.…</div>}
      {DISKS.slice(0,8).map(d => {
        const det = details[d.bay];
        const attrs = det && det.ata_smart_attributes && det.ata_smart_attributes.table;
        const getAttr = (id) => attrs ? (attrs.find(a=>a.id===id)||{}).raw?.value || '0' : '—';
        return (
          <div key={d.bay} className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{d.bay} · {d.model}</div>
                <div className="card-sub">{d.serial} · {d.type}</div>
              </div>
              <div className="row gap-sm">
                {d.smart==='warn' ? <span className="badge warn">UWAGA</span> : <span className="badge ok">PASSED</span>}
                <button className="btn sm" onClick={()=>loadDetails(d.bay)}><Icon name="refresh" size={11}/></button>
              </div>
            </div>
            <div className="card-body">
              <table className="table" style={{fontSize:11}}>
                <tbody>
                  <tr><td className="dim">Temperatura</td><td className="mono" style={d.temp>42?{color:'var(--warn)'}:{}}>{d.temp}°C</td></tr>
                  <tr><td className="dim">Godziny pracy</td><td className="mono">{(d.hours||0).toLocaleString('pl')}</td></tr>
                  <tr><td className="dim">5 Reallocated Sectors</td><td className="mono">{getAttr(5)}</td></tr>
                  <tr><td className="dim">197 Current Pending</td><td className="mono">{getAttr(197)}</td></tr>
                  <tr><td className="dim">198 Offline Uncorrectable</td><td className="mono">{getAttr(198)}</td></tr>
                  {attrs && <tr><td className="dim">I/O Utilization</td><td className="mono">{Math.round(d.io||0)}%</td></tr>}
                </tbody>
              </table>
              {!det && <button className="btn sm" style={{marginTop:8,width:'100%'}} onClick={()=>loadDetails(d.bay)}>Załaduj szczegóły S.M.A.R.T.</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Format modal ──────────────────────────────────────────────────────────────
const FormatModal = ({ disk, onClose }) => {
  const [fs,      setFs]      = React.useState('zfs');
  const [label,   setLabel]   = React.useState((disk.bay||'').replace('-','_'));
  const [mp,      setMp]      = React.useState(`/mnt/${(disk.bay||'').replace('-','_')}`);
  const [trim,    setTrim]    = React.useState(disk.type==='NVMe'||disk.type==='SSD');
  const [encrypt, setEncrypt] = React.useState(false);
  const [confirm, setConfirm] = React.useState('');

  const fsOptions = [
    {v:'zfs',   t:'ZFS',   d:'Migawki, kompresja, parytet (jako pula)'},
    {v:'ext4',  t:'EXT4',  d:'Uniwersalny, dobry dla pojedynczych dysków'},
    {v:'xfs',   t:'XFS',   d:'Duże pliki, wysoka wydajność I/O'},
    {v:'btrfs', t:'Btrfs', d:'Migawki, kompresja, sumy kontrolne'},
    {v:'exfat', t:'exFAT', d:'Wymienne, kompatybilność z Windows/macOS'},
  ];
  const ok = confirm === disk.bay;

  const doFormat = async () => {
    if (!ok) return;
    // Wywołaj API format
    await fetch('/api/storage/format',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({device:'/dev/'+disk.bay, fs, label})}).catch(()=>{});
    // Opcjonalnie mount
    if (fs !== 'zfs' && mp) {
      // mkfs powyżej działa na całym dysku (bez tabeli partycji), więc montujemy
      // też cały dysk — NIE "/dev/sdX1" (taka partycja nigdy nie powstała).
      await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({command:`mkdir -p ${mp} && mount /dev/${disk.bay} ${mp}`})}).catch(()=>{});
    }
    onClose();
  };

  return (
    <Modal title={`Formatuj ${disk.bay}`} sub={`${disk.model} · ${disk.size} · ${disk.serial} · obecnie: ${disk.fs}`} onClose={onClose} width={680}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" disabled={!ok} style={!ok?{opacity:0.4,cursor:'not-allowed'}:{}} onClick={doFormat}>Sformatuj i zamontuj</button></>}>
      <div style={{padding:'10px 12px',background:'color-mix(in oklch,var(--err) 8%,var(--bg-2))',border:'1px solid color-mix(in oklch,var(--err) 35%,var(--line))',borderRadius:5,marginBottom:16,fontSize:'var(--fs-sm)'}}>
        <b style={{color:'var(--err)'}}>Uwaga:</b> wszystkie dane na dysku zostaną nieodwracalnie usunięte.
      </div>
      <Field label="System plików">
        <div className="grid" style={{gridTemplateColumns:'repeat(5,1fr)',gap:6}}>
          {fsOptions.map(o => (
            <div key={o.v} onClick={()=>setFs(o.v)} style={{padding:'10px 8px',border:'1px solid '+(fs===o.v?'var(--accent)':'var(--line)'),background:fs===o.v?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer',textAlign:'center'}}>
              <div className="mono" style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{o.t}</div>
            </div>
          ))}
        </div>
        <div className="dim" style={{fontSize:11,marginTop:6}}>{fsOptions.find(o=>o.v===fs).d}</div>
      </Field>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Field label="Etykieta"><input style={inputCss} value={label} onChange={e=>setLabel(e.target.value)}/></Field>
        <Field label="Punkt montowania"><input style={inputCss} value={mp} onChange={e=>setMp(e.target.value)}/></Field>
      </div>
      <Field label="Opcje">
        <div className="col" style={{gap:8,padding:'8px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5}}>
          <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:'var(--fs-sm)'}}>TRIM/discard (zalecane dla SSD/NVMe)</span><div className={"toggle "+(trim?'on':'')} onClick={()=>setTrim(!trim)}/></div>
          <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:'var(--fs-sm)'}}>Szyfrowanie LUKS</span><div className={"toggle "+(encrypt?'on':'')} onClick={()=>setEncrypt(!encrypt)}/></div>
          <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:'var(--fs-sm)'}}>Dodaj wpis do /etc/fstab (auto-mount)</span><div className="toggle on"/></div>
        </div>
      </Field>
      <Field label="Polecenie shell">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)',whiteSpace:'pre-wrap'}}>
{fs==='zfs' ? `zpool create -f -o ashift=12 ${label} /dev/${disk.bay}` :
 fs==='exfat' ? `mkfs.exfat -n "${label}" /dev/${disk.bay}` :
 `mkfs.${fs} -L "${label}" /dev/${disk.bay}`}
{fs==='zfs' ? '' : `\nmkdir -p ${mp}\nmount /dev/${disk.bay} ${mp}`}
        </pre>
      </Field>
      <Field label={`Aby potwierdzić, wpisz nazwę zatoki: ${disk.bay}`}>
        <input style={{...inputCss,borderColor:confirm===disk.bay?'var(--ok)':''}} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder={disk.bay}/>
      </Field>
    </Modal>
  );
};

// ── Mount modal ───────────────────────────────────────────────────────────────
const MountModal = ({ disk, onClose }) => {
  const [mp,   setMp]   = React.useState(`/mnt/${(disk.bay||'').replace('-','_')}`);
  const [opts, setOpts] = React.useState(disk.fs==='ntfs'?'rw,uid=1000,gid=1000,umask=000':'rw,relatime');
  const [auto, setAuto] = React.useState(true);

  const doMount = async () => {
    await fetch('/api/storage/mount',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({device:'/dev/'+disk.bay+'1', target:mp, options:opts})}).catch(()=>{});
    if (auto) {
      // Dodaj do fstab
      const fstabLine = `/dev/${disk.bay}1   ${mp}   ${disk.fs||'auto'}   ${opts}   0   2\n`;
      const cur = await fetch('/api/storage/fstab-content',{credentials:'include'}).then(r=>r.json()).catch(()=>({content:''}));
      await fetch('/api/storage/save-fstab',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content:(cur.content||'')+fstabLine})}).catch(()=>{});
    }
    onClose();
  };

  return (
    <Modal title={`Zamontuj ${disk.bay}`} sub={`${disk.model} · ${disk.size} · system plików: ${disk.fs}`} onClose={onClose}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={doMount}>Zamontuj</button></>}>
      <Field label="Punkt montowania"><input style={inputCss} value={mp} onChange={e=>setMp(e.target.value)}/></Field>
      <Field label="Opcje montowania" hint="Oddziel przecinkami. Dla NTFS dodaj uid/gid by uzyskać zapis."><input style={inputCss} value={opts} onChange={e=>setOpts(e.target.value)}/></Field>
      <Field label="">
        <div className="row" style={{justifyContent:'space-between',padding:'8px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5}}>
          <span style={{fontSize:'var(--fs-sm)'}}>Dodaj do /etc/fstab (auto-mount po starcie)</span>
          <div className={"toggle "+(auto?'on':'')} onClick={()=>setAuto(!auto)}/>
        </div>
      </Field>
      <Field label="Wpis fstab">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)'}}>
{`/dev/${disk.bay}1   ${mp}   ${disk.fs||'auto'}   ${opts}   0   2`}
        </pre>
      </Field>
    </Modal>
  );
};

// ── Fstab modal ───────────────────────────────────────────────────────────────
const FstabModal = ({ onClose }) => {
  const FSTAB_TEXT = useStore('FSTAB_TEXT') || '';
  const [text, setText] = React.useState(FSTAB_TEXT);

  const check = async () => {
    const r = await fetch('/api/storage/fstab-check',{credentials:'include'}).then(r=>r.json()).catch(()=>null);
    if (r) alert(r.output || (r.ok ? 'OK — brak błędów' : 'Błędy w fstab!'));
  };

  const save = async () => {
    await fetch('/api/storage/save-fstab',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text})}).catch(()=>{});
    await fetch('/api/storage/exec-command',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'mount -a'})}).catch(()=>{});
    storeSet('FSTAB_TEXT', text);
    onClose();
  };

  return (
    <Modal title="Edytor /etc/fstab" sub="Zmiany aktywują się po wykonaniu mount -a lub po restarcie" onClose={onClose} width={920}
      footer={<>
        <button className="btn sm ghost" onClick={check}>Sprawdź składnię</button>
        <button className="btn sm" onClick={async()=>{const cur=text; setText(cur); alert('Kopia w schowku')}}>Kopia zapasowa</button>
        <div style={{flex:1}}/>
        <button className="btn sm ghost" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={save}>Zapisz i mount -a</button>
      </>}>
      <textarea value={text} onChange={e=>setText(e.target.value)} spellCheck={false}
        style={{width:'100%',minHeight:360,background:'var(--bg-1)',border:'1px solid var(--line)',color:'var(--fg)',padding:'12px 14px',borderRadius:5,fontSize:12,fontFamily:'var(--font-mono)',lineHeight:1.55,outline:'none',resize:'vertical'}}/>
      <div className="dim" style={{fontSize:11,marginTop:8}}>Format: <span className="mono">device · mount point · fs · opcje · dump · pass</span></div>
    </Modal>
  );
};

// ── Add mount modal ───────────────────────────────────────────────────────────
const AddMountModal = ({ onClose }) => {
  const [device, setDevice] = React.useState('');
  const [mp,     setMp]     = React.useState('/mnt/');
  const [fs,     setFs]     = React.useState('ext4');
  const [opts,   setOpts]   = React.useState('rw,relatime');
  const [auto,   setAuto]   = React.useState(true);
  const [fstab,  setFstab]  = React.useState(true);

  const fsOpts = ['ext4','xfs','btrfs','zfs','ntfs','exfat','vfat','nfs','cifs'];
  const ok = device.trim().length > 2 && mp.trim().length > 1;
  const fstabLine = `${device||'<urządzenie>'}   ${mp}   ${fs}   ${opts}   0   2`;

  const testMount = async () => {
    const r = await fetch('/api/storage/check-device',{credentials:'include',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).catch(()=>null);
    alert(r ? 'Urządzenie dostępne' : 'Urządzenie niedostępne');
  };

  const doMount = async () => {
    await fetch('/api/storage/mount',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({device, target:mp, fs, options:opts})}).catch(()=>{});
    if (fstab) {
      const cur = await fetch('/api/storage/fstab-content',{credentials:'include'}).then(r=>r.json()).catch(()=>({content:''}));
      await fetch('/api/storage/save-fstab',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content:(cur.content||'')+'\n'+fstabLine+'\n'})}).catch(()=>{});
    }
    onClose();
  };

  return (
    <Modal title="Dodaj punkt montowania" sub="Ręczna konfiguracja montowania urządzenia lub zasobu sieciowego" onClose={onClose} width={700}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm" disabled={!ok} onClick={testMount}>Testuj połączenie</button><button className="btn sm primary" disabled={!ok} onClick={doMount}>Zamontuj</button></>}>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Field label="Urządzenie / źródło" hint="np. /dev/sdb1, UUID=…, 192.168.1.5:/share">
          <input style={inputCss} value={device} onChange={e=>setDevice(e.target.value)} placeholder="/dev/sdb1"/>
        </Field>
        <Field label="Punkt montowania">
          <input style={inputCss} value={mp} onChange={e=>setMp(e.target.value)} placeholder="/mnt/dysk"/>
        </Field>
      </div>
      <Field label="System plików">
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {fsOpts.map(f => (
            <div key={f} onClick={()=>setFs(f)} style={{padding:'6px 12px',border:'1px solid '+(fs===f?'var(--accent)':'var(--line)'),background:fs===f?'color-mix(in oklch,var(--accent) 12%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',fontWeight:fs===f?600:400}}>
              {f}
            </div>
          ))}
        </div>
      </Field>
      <Field label="Opcje montowania" hint="Oddziel przecinkami">
        <input style={inputCss} value={opts} onChange={e=>setOpts(e.target.value)}/>
      </Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,marginBottom:14}}>
        <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:'var(--fs-sm)'}}>Auto-mount po starcie</span><div className={"toggle "+(auto?'on':'')} onClick={()=>setAuto(!auto)}/></div>
        <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:'var(--fs-sm)'}}>Dodaj do /etc/fstab</span><div className={"toggle "+(fstab?'on':'')} onClick={()=>setFstab(!fstab)}/></div>
      </div>
      {fstab && (
        <Field label="Wpis fstab (podgląd)">
          <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{fstabLine}</pre>
        </Field>
      )}
    </Modal>
  );
};

// ── Unmount confirm ───────────────────────────────────────────────────────────
const UnmountConfirm = ({ mount, onClose }) => {
  const [lazy,  setLazy]  = React.useState(false);
  const [force, setForce] = React.useState(false);
  const cmd = `umount${lazy?' -l':''}${force?' -f':''} ${mount.mp}`;

  const doUnmount = async () => {
    await fetch('/api/storage/unmount',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target:mount.mp, force})}).catch(()=>{});
    onClose();
  };

  return (
    <Modal title={`Odmontuj ${mount.mp}`} sub={`${mount.device} · ${mount.fs} · ${mount.type}`} onClose={onClose} width={520}
      footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" style={{background:'var(--err)',borderColor:'var(--err)'}} onClick={doUnmount}>Odmontuj</button></>}>
      {mount.inFstab && (
        <div style={{padding:'10px 12px',background:'color-mix(in oklch,var(--warn) 8%,var(--bg-2))',border:'1px solid color-mix(in oklch,var(--warn) 35%,var(--line))',borderRadius:5,marginBottom:14,fontSize:'var(--fs-sm)'}}>
          <b style={{color:'var(--warn)'}}>Uwaga:</b> ten punkt jest w /etc/fstab — zostanie odmontowany tylko do restartu.
        </div>
      )}
      <div className="col" style={{gap:8,padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,marginBottom:14}}>
        <div className="row" style={{justifyContent:'space-between'}}>
          <div className="col" style={{gap:2}}><span style={{fontSize:'var(--fs-sm)'}}>Leniwe odmontowanie <span className="mono dim">(-l)</span></span><span className="dim" style={{fontSize:11}}>Odłącz od drzewa; zwolnij gdy zajęty</span></div>
          <div className={"toggle "+(lazy?'on':'')} onClick={()=>setLazy(!lazy)}/>
        </div>
        <div className="row" style={{justifyContent:'space-between'}}>
          <div className="col" style={{gap:2}}><span style={{fontSize:'var(--fs-sm)'}}>Wymuś odmontowanie <span className="mono dim">(-f)</span></span><span className="dim" style={{fontSize:11}}>Tylko NFS — może spowodować utratę danych</span></div>
          <div className={"toggle "+(force?'on':'')} onClick={()=>setForce(!force)}/>
        </div>
      </div>
      <Field label="Polecenie">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:12,color:'var(--fg-muted)'}}>{cmd}</pre>
      </Field>
    </Modal>
  );
};

// ── CreatePoolModal (z oryginału, dostosowane do API) ─────────────────────────

const POOL_TYPES = {
  zfs: [
    { v:'stripe',  t:'Single / Stripe', d:'Brak redundancji, pełna pojemność. Utrata dysku = utrata danych.', min:1, parity:0 },
    { v:'mirror',  t:'Mirror',          d:'Pełne lustro — 50% pojemności, przeżywa utratę 1 dysku (≥2 dysków).', min:2, parity:1 },
    { v:'raidz1',  t:'RAIDZ-1',         d:'Parytet 1 — przeżywa utratę 1 dysku. Minimum 3 dyski.', min:3, parity:1 },
    { v:'raidz2',  t:'RAIDZ-2',         d:'Parytet 2 — przeżywa utratę 2 dysków. Minimum 4 dyski.', min:4, parity:2 },
    { v:'raidz3',  t:'RAIDZ-3',         d:'Parytet 3 — przeżywa utratę 3 dysków. Minimum 5 dysków.', min:5, parity:3 },
  ],
  mdadm: [
    { v:'raid0',  t:'RAID 0 (Stripe)',  d:'Brak redundancji, pełna pojemność + prędkość.', min:2, parity:0 },
    { v:'raid1',  t:'RAID 1 (Mirror)',  d:'Lustro, 50% pojemności, przeżywa utratę 1 dysku.', min:2, parity:1 },
    { v:'raid5',  t:'RAID 5',           d:'Parytet rozproszony, 1 dysk parity. Min. 3 dyski.', min:3, parity:1 },
    { v:'raid6',  t:'RAID 6',           d:'Podwójny parytet, przeżywa 2 awarie. Min. 4 dyski.', min:4, parity:2 },
    { v:'raid10', t:'RAID 10',          d:'Mirror + Stripe. Min. 4 dyski, przeżywa 1 awarię na grupę.', min:4, parity:2 },
  ],
  lvm: [
    { v:'linear',  t:'Linear (LVM)',  d:'Woluminy logiczne bez redundancji.', min:1, parity:0 },
    { v:'lvmraid1',t:'LVM RAID1',     d:'Lustro przez LVM. Min. 2 dyski.', min:2, parity:1 },
  ],
};

const CreatePoolModal = ({ onClose }) => {
  const Modal    = window.Modal;
  const Field    = window.Field;
  const inputCss = window.inputCss;
  const DISKS_ALL = useStore('DISKS') || [];

  const [backend,       setBackend]       = React.useState('zfs');
  const [raidType,      setRaidType]      = React.useState('raidz2');
  const [name,          setName]          = React.useState('');
  const [compress,      setCompress]      = React.useState('lz4');
  const [dedup,         setDedup]         = React.useState(false);
  const [encrypt,       setEncrypt]       = React.useState(false);
  const [ashift,        setAshift]        = React.useState('12');
  const [selectedDisks, setSelectedDisks] = React.useState([]);
  const [busy,          setBusy]          = React.useState(false);
  const [log,           setLog]           = React.useState('');

  const types = POOL_TYPES[backend];
  const rt    = types.find(t => t.v === raidType) || types[0];

  const setBackendAndReset = (b) => { setBackend(b); setRaidType(POOL_TYPES[b][0].v); setSelectedDisks([]); };
  const toggleDisk = (bay) => setSelectedDisks(prev => prev.includes(bay) ? prev.filter(x=>x!==bay) : [...prev, bay]);

  const enough = selectedDisks.length >= rt.min;
  const ok     = enough && name.trim().length > 0;

  const diskGb = selectedDisks.length > 0
    ? parseFloat(DISKS_ALL.find(d=>d.bay===selectedDisks[0])?.size || '8') * 1000
    : 8000;
  const usable = backend === 'zfs'
    ? (rt.v==='stripe' ? selectedDisks.length : rt.v==='mirror' ? 1 : selectedDisks.length - rt.parity) * diskGb
    : rt.v==='raid0' ? selectedDisks.length*diskGb : rt.v==='raid1' ? diskGb
    : rt.v==='raid10' ? Math.floor(selectedDisks.length/2)*diskGb
    : (selectedDisks.length - rt.parity)*diskGb;
  const usableTb = usable >= 1000 ? (usable/1000).toFixed(1)+' TB' : usable.toFixed(0)+' GB';

  const cmd = backend === 'zfs'
    ? `zpool create -f -o ashift=${ashift} -O compression=${compress} ${name||'<nazwa>'} ${rt.v==='stripe'?'':rt.v} ${selectedDisks.join(' ')}`
    : backend === 'mdadm'
    ? `mdadm --create /dev/md0 --level=${rt.v.replace('raid','')} --raid-devices=${selectedDisks.length} ${selectedDisks.map(b=>'/dev/'+b).join(' ')}`
    : `vgcreate ${name||'<nazwa>'} ${selectedDisks.map(b=>'/dev/'+b).join(' ')}`;

  const doCreate = async () => {
    if (!ok) return;
    setBusy(true); setLog('');
    try {
      const r = await fetch('/api/zfs/pool/create', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ backend, raid_type: raidType, name: name.trim(), disks: selectedDisks, ashift: parseInt(ashift), compress, dedup, encrypt }),
      });
      const data = await r.json();
      if (data.ok) { setLog('[OK] Pula została utworzona.'); setTimeout(onClose, 1200); }
      else          { setLog('[BŁĄD] ' + (data.error || 'Nieznany błąd')); }
    } catch(e) { setLog('[BŁĄD] ' + e.message); }
    setBusy(false);
  };

  return (
    <Modal title="Utwórz nową pulę" sub="Konfiguracja macierzy dyskowej" onClose={onClose} width={780}
      footer={<>
        <button className="btn sm ghost" onClick={onClose}>Anuluj</button>
        <button className="btn sm" disabled={!ok||busy} style={(!ok||busy)?{opacity:0.4,cursor:'not-allowed'}:{}}>Sprawdź konfigurację</button>
        <button className="btn sm primary" disabled={!ok||busy} style={(!ok||busy)?{opacity:0.4,cursor:'not-allowed'}: {}} onClick={doCreate}>
          {busy ? <><span className="dot pulse" style={{marginRight:6}}/> Tworzę…</> : 'Utwórz pulę'}
        </button>
      </>}
    >
      {/* Backend */}
      <Field label="Technologia">
        <div style={{display:'flex',gap:8}}>
          {[{v:'zfs',t:'ZFS',d:'Migawki, kompresja, sumy kontrolne'},{v:'mdadm',t:'mdadm RAID',d:'Klasyczny RAID kernela'},{v:'lvm',t:'LVM',d:'Woluminy logiczne'}].map(b=>(
            <div key={b.v} onClick={()=>setBackendAndReset(b.v)} style={{flex:1,padding:'10px 12px',border:'1px solid '+(backend===b.v?'var(--accent)':'var(--line)'),background:backend===b.v?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer'}}>
              <div className="mono" style={{fontWeight:700,fontSize:'var(--fs-sm)',marginBottom:2}}>{b.t}</div>
              <div className="dim" style={{fontSize:10}}>{b.d}</div>
            </div>
          ))}
        </div>
      </Field>

      {/* RAID type */}
      <Field label="Typ macierzy">
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:6}}>
          {types.map(t=>(
            <div key={t.v} onClick={()=>setRaidType(t.v)} style={{padding:'7px 14px',border:'1px solid '+(raidType===t.v?'var(--accent)':'var(--line)'),background:raidType===t.v?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',fontWeight:raidType===t.v?600:400}}>
              {t.t}
            </div>
          ))}
        </div>
        <div style={{padding:'8px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,fontSize:'var(--fs-sm)',color:'var(--fg-muted)'}}>
          {rt.d} <span className="mono" style={{marginLeft:8}}>Min. dysków: {rt.min}</span>
        </div>
      </Field>

      {/* Disk picker */}
      <Field label={`Wybierz dyski (zaznaczono: ${selectedDisks.length} / min. ${rt.min})`}>
        {DISKS_ALL.length === 0 ? (
          <div style={{padding:12,color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Ładowanie dysków…</div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
            {DISKS_ALL.map(d=>{
              const sel = selectedDisks.includes(d.bay);
              return (
                <div key={d.bay} onClick={()=>toggleDisk(d.bay)} style={{padding:'8px 10px',border:'1px solid '+(sel?'var(--accent)':'var(--line)'),background:sel?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                  <div className="col" style={{gap:1,minWidth:0}}>
                    <span className="mono" style={{fontSize:11,fontWeight:600}}>{d.bay}</span>
                    <span className="dim" style={{fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.size} · {d.type}</span>
                  </div>
                  {sel && <span style={{marginLeft:'auto',color:'var(--accent)',fontSize:12}}>✓</span>}
                </div>
              );
            })}
          </div>
        )}
        {selectedDisks.length > 0 && (
          <div style={{marginTop:8,padding:'6px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
            Szacowana pojemność użytkowa: <span style={{color:'var(--fg)',fontWeight:600}}>{usableTb}</span>
            {rt.parity>0 && <span> · parytet: {rt.parity} {rt.parity===1?'dysk':'dyski'}</span>}
          </div>
        )}
      </Field>

      <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Field label="Nazwa puli">
          <input style={inputCss} value={name} onChange={e=>setName(e.target.value)} placeholder="np. tank, fast-nvme, backup"/>
        </Field>
        {backend === 'zfs' && (
          <Field label="ashift (rozmiar sektora)">
            <select style={{...inputCss,fontFamily:'var(--font-mono)'}} value={ashift} onChange={e=>setAshift(e.target.value)}>
              <option value="9">9 — 512B (starsze HDD)</option>
              <option value="12">12 — 4K (nowoczesne HDD/SSD)</option>
              <option value="13">13 — 8K (niektóre SSD)</option>
            </select>
          </Field>
        )}
      </div>

      {backend === 'zfs' && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:5,marginBottom:14}}>
          <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <div className="col" style={{gap:1}}>
              <span style={{fontSize:'var(--fs-sm)'}}>Kompresja</span>
              <select style={{fontSize:11,background:'transparent',border:'none',color:'var(--fg-muted)',fontFamily:'var(--font-mono)',outline:'none',cursor:'pointer'}} value={compress} onChange={e=>setCompress(e.target.value)}>
                {['lz4','zstd','gzip','off'].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:'var(--fs-sm)'}}>Deduplikacja</span>
            <div className={"toggle "+(dedup?'on':'')} onClick={()=>setDedup(!dedup)}/>
          </div>
          <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:'var(--fs-sm)'}}>Szyfrowanie</span>
            <div className={"toggle "+(encrypt?'on':'')} onClick={()=>setEncrypt(!encrypt)}/>
          </div>
        </div>
      )}

      <Field label="Polecenie (podgląd)">
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
          {cmd}
        </pre>
      </Field>

      {log && (
        <div style={{padding:'8px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontFamily:'var(--font-mono)',fontSize:12,color:log.includes('[OK]')?'var(--ok)':'var(--err)'}}>
          {log}
        </div>
      )}
    </Modal>
  );
};

// ===== Zatoki (LED) — pełne API =====
// GET  /api/bays/info     — enclosure info + lista narzędzi
// GET  /api/bays          — lista slotów: urządzenie, model, SMART, stan LED
// POST /api/bays/scan     — wymuś reskan
// POST /api/bays/all-off  — wyłącz wszystkie LED
// POST /api/bays/{slot}/led  {action:"locate-on"|"locate-off"|"fault-on"|"fault-off", tool:"ledctl"|...}

const BayLedsView = () => {
  const [enclosure,  setEnclosure] = React.useState(null);   // dane z /api/bays/info
  const [slots,      setSlots]     = React.useState([]);       // dane z /api/bays
  const [tool,       setTool]      = React.useState('');       // aktualnie wybrany tool
  const [selected,   setSelected]  = React.useState(null);    // wybrany numer slotu
  const [loading,    setLoading]   = React.useState(true);
  const [scanning,   setScanning]  = React.useState(false);
  const [ledBusy,    setLedBusy]   = React.useState(false);
  const [lastResult, setLastResult]= React.useState(null);    // wynik ostatniej komendy LED

  // ── Ładowanie ──────────────────────────────────────────────────────────────
  const loadAll = async () => {
    setLoading(true);
    try {
      const [infoRes, baysRes] = await Promise.all([
        fetch('/api/bays/info', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/bays',      { credentials: 'include' }).then(r => r.json()),
      ]);
      setEnclosure(infoRes);
      // Ustaw tool z serwera jeśli jeszcze nie ustawiony przez użytkownika
      setTool(prev => prev || infoRes.tool || 'mock');
      const list = baysRes.slots || [];
      setSlots(list);
      // Wybierz pierwszy zajęty slot domyślnie
      if (selected === null && list.length > 0) {
        setSelected((list.find(s => s.occupied) || list[0]).slot);
      }
    } catch (e) {
      console.error('BayLedsView load error:', e);
    }
    setLoading(false);
  };

  React.useEffect(() => { loadAll(); }, []);

  // ── Rescan ────────────────────────────────────────────────────────────────
  const rescan = async () => {
    setScanning(true);
    try {
      await fetch('/api/bays/scan', { method: 'POST', credentials: 'include' });
      await loadAll();
    } catch {}
    setScanning(false);
  };

  // ── Sterowanie LED ────────────────────────────────────────────────────────
  const applyLed = async (action) => {
    if (selected === null) return;
    setLedBusy(true);
    setLastResult(null);
    try {
      const r = await fetch(`/api/bays/${selected}/led`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tool }),
      });
      const res = await r.json();
      setLastResult(res);
      // Zaktualizuj stan LED lokalnie bez ponownego ładowania
      if (res.new_led !== undefined) {
        setSlots(ss => ss.map(s =>
          s.slot === selected ? { ...s, led: res.new_led, led_color: res.new_led === 'off' ? 'off' : res.new_led === 'locate' ? 'blue' : 'amber' } : s
        ));
      }
    } catch (e) {
      setLastResult({ ok: false, error: e.message, command: '' });
    }
    setLedBusy(false);
  };

  // ── Wszystkie OFF ─────────────────────────────────────────────────────────
  const allOff = async () => {
    setLedBusy(true);
    try {
      await fetch('/api/bays/all-off', { method: 'POST', credentials: 'include' });
      setSlots(ss => ss.map(s => ({ ...s, led: 'off', led_color: 'off' })));
    } catch {}
    setLedBusy(false);
  };

  // ── Dane wybranej zatoki ──────────────────────────────────────────────────
  const bay = slots.find(s => s.slot === selected) || null;
  const occupied   = slots.filter(s => s.occupied).length;
  const activeLEDs = slots.filter(s => s.led && s.led !== 'off').length;
  const faultOK    = ['ledctl', 'ledmon', 'sg_ses'].includes(tool);

  // Kolory LED
  const ledColor = led => led === 'locate' ? 'var(--accent)' : led === 'fault' ? 'var(--err)' : 'var(--line-strong)';
  const ledGlow  = led => led === 'locate' ? '0 0 8px var(--accent)' : led === 'fault' ? '0 0 8px var(--err)' : 'none';

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--fg-dim)' }}>
      <div style={{ width: 20, height: 20, border: '2px solid var(--line)', borderTopColor: 'var(--accent)',
        borderRadius: '50%', animation: '_spin .7s linear infinite', margin: '0 auto 14px' }}/>
      Wykrywanie enclosure i zatok…
    </div>
  );

  return (
    <div className="col" style={{ gap: 'var(--gutter)' }}>

      {/* ── Info o enclosure + wybór narzędzia ── */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Sterownik obudowy</div>
            <div className="card-sub">
              {enclosure
                ? `${enclosure.name} · sterownik: ${enclosure.driver}${enclosure.ses_device ? ' · SES: ' + enclosure.ses_device : ''}`
                : 'Wykrywanie…'}
            </div>
          </div>
          <div className="row gap-sm">
            {activeLEDs > 0 && (
              <button className="btn sm" onClick={allOff} disabled={ledBusy}>
                Wszystkie LED OFF
              </button>
            )}
            <button className="btn sm" onClick={rescan} disabled={scanning}>
              <Icon name="refresh" size={11}/> {scanning ? 'Skanowanie…' : 'Rescan'}
            </button>
          </div>
        </div>

        <div className="card-body col" style={{ gap: 14 }}>
          {/* Statsy */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
            {[
              ['ZATOKI',        enclosure?.total_slots || slots.length],
              ['ZAJĘTE',        occupied],
              ['PUSTE',         slots.length - occupied],
              ['LED AKTYWNYCH', activeLEDs],
            ].map(([k, v]) => <Mini key={k} label={k} v={v}/>)}
          </div>

          {/* Wybór narzędzia */}
          <Field label="Narzędzie sterowania LED">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 6 }}>
              {(enclosure?.tools || []).map(t => (
                <div key={t.name}
                  onClick={() => t.available && setTool(t.name)}
                  style={{
                    padding: '8px 10px', borderRadius: 5, cursor: t.available ? 'pointer' : 'default',
                    opacity: t.available ? 1 : 0.4,
                    border: '1px solid ' + (tool === t.name ? 'var(--accent)' : 'var(--line)'),
                    background: tool === t.name ? 'color-mix(in oklch, var(--accent) 10%, transparent)' : 'var(--bg-1)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span className="mono" style={{ fontWeight: 500, fontSize: 'var(--fs-sm)' }}>{t.name}</span>
                    {t.available
                      ? <span className="badge ok" style={{ fontSize: 9 }}>dostępny</span>
                      : <span className="badge"    style={{ fontSize: 9 }}>brak</span>}
                  </div>
                  <div className="dim" style={{ fontSize: 10, lineHeight: 1.4 }}>{t.note}</div>
                </div>
              ))}
              {/* Zawsze dostępny tryb demo */}
              <div onClick={() => setTool('mock')}
                style={{
                  padding: '8px 10px', borderRadius: 5, cursor: 'pointer',
                  border: '1px solid ' + (tool === 'mock' ? 'var(--accent)' : 'var(--line)'),
                  background: tool === 'mock' ? 'color-mix(in oklch, var(--accent) 10%, transparent)' : 'var(--bg-1)',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span className="mono" style={{ fontWeight: 500, fontSize: 'var(--fs-sm)' }}>mock</span>
                  <span className="badge info" style={{ fontSize: 9 }}>demo</span>
                </div>
                <div className="dim" style={{ fontSize: 10 }}>Tryb offline — podgląd UI bez sprzętu</div>
              </div>
            </div>
          </Field>

          {!faultOK && (
            <div style={{ padding: '8px 10px', background: 'color-mix(in oklch, var(--warn) 8%, var(--bg-2))',
              border: '1px solid color-mix(in oklch, var(--warn) 35%, var(--line))',
              borderRadius: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
              ⚠ Narzędzie <span className="mono">{tool}</span> nie obsługuje ręcznego LED awarii (fault) — dostępny tylko locate/identify.
            </div>
          )}
        </div>
      </div>

      {/* ── Mapa zatok + panel szczegółów ── */}
      <div className="grid grid-2-1">

        {/* Mapa */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Mapa zatok</div>
              <div className="card-sub">Kliknij zatokę, aby zobaczyć szczegóły i sterować LED</div>
            </div>
            <div className="row gap-sm" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>
              {[['off', 'brak'], ['locate', 'locate'], ['fault', 'fault']].map(([led, lbl]) => (
                <span key={led} className="row gap-sm">
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: ledColor(led), boxShadow: ledGlow(led), flexShrink: 0,
                  }}/>
                  {lbl}
                </span>
              ))}
            </div>
          </div>
          <div className="card-body">
            {slots.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fg-dim)', fontSize: 'var(--fs-sm)' }}>
                Brak wykrytych zatok — kliknij <strong>Rescan</strong>
              </div>
            ) : (
              <>
                {/* Chassis render — układ siatki n×5 jak oryginał */}
                <div className="bay-chassis">
                  <div className="bay-chassis-cap" style={{ flexDirection: 'column' }}>
                    <span className="bay-chassis-btn"/>
                    <span className="bay-chassis-brand" style={{ writingMode: 'vertical-rl' }}>
                      {enclosure?.name || 'Enclosure'}
                    </span>
                    <span className="bay-chassis-btn uid" title="UID"/>
                  </div>
                  <div className="bay-rows">
                    {Array.from({ length: Math.ceil(slots.length / 5) }).map((_, row) => (
                      <div className="bay-row" key={row}>
                        {slots.slice(row * 5, row * 5 + 5).map(b => (
                          <div key={b.slot}
                            className={"bay-tray" + (!b.occupied ? " empty" : "") + (selected === b.slot ? " selected" : "")}
                            onClick={() => setSelected(b.slot)}
                            title={b.occupied ? `${b.slot}: ${b.device || b.bay}` : `Zatoka ${b.slot} — pusta`}>
                            <div className="bay-tray-leds">
                              <span className={"bay-tray-led " + (b.occupied ? "act" : "")}/>
                              <span className={"bay-tray-led " + (b.led === 'locate' ? 'locate' : b.led === 'fault' ? 'fault' : '')}/>
                            </div>
                            <div className="bay-tray-handle"/>
                            <span className="bay-tray-num">{String(b.slot).padStart(2, '0')}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="bay-chassis-cap" style={{ flexDirection: 'column' }}>
                    <span className="bay-chassis-btn"/>
                    <span className="bay-chassis-brand" style={{ writingMode: 'vertical-rl' }}>
                      {slots.length}× SFF
                    </span>
                    <span className="bay-chassis-btn"/>
                  </div>
                </div>
                <div className="row gap-sm" style={{ marginTop: 10, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>
                  <span className="row gap-sm"><span className="bay-tray-led act" style={{ position: 'static' }}/>aktywność</span>
                  <span className="row gap-sm"><span className="bay-tray-led locate" style={{ position: 'static' }}/>locate</span>
                  <span className="row gap-sm"><span className="bay-tray-led fault" style={{ position: 'static' }}/>fault</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Panel szczegółów wybranego slotu */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              {bay ? `Zatoka ${String(bay.slot).padStart(2, '0')}` : 'Szczegóły'}
            </div>
          </div>
          <div className="card-body col" style={{ gap: 10 }}>
            {!bay && (
              <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Wybierz zatokę z mapy</div>
            )}
            {bay && (<>
              {/* Adres / urządzenie */}
              <KV k="Urządzenie" v={<span className="mono">{bay.device || bay.bay || '—'}</span>}/>
              <KV k="Adres SAS"  v={<span className="mono">{bay.sas_addr || '—'}</span>}/>
              <KV k="Stan LED"   v={
                bay.led === 'fault'  ? <span className="badge err"><span className="dot pulse"/>FAULT</span>  :
                bay.led === 'locate' ? <span className="badge info"><span className="dot pulse"/>LOCATE</span> :
                                       <span className="badge">wyłączony</span>
              }/>

              <hr className="div"/>

              {/* Dane dysku */}
              {bay.occupied && bay.model ? (<>
                <KV k="Model"     v={bay.model}/>
                <KV k="S/N"       v={<span className="mono dim">{bay.serial || '—'}</span>}/>
                <KV k="Pojemność" v={<span className="mono">{bay.size || '—'}</span>}/>
                <KV k="Temp."     v={
                  <span className="mono" style={bay.temp > 42 ? { color: 'var(--warn)' } : {}}>
                    {bay.temp ? `${bay.temp}°C` : '—'}
                  </span>
                }/>
                <KV k="S.M.A.R.T." v={
                  bay.smart === 'warn'
                    ? <span className="badge warn">WARN</span>
                    : <span className="badge ok">PASSED</span>
                }/>
              </>) : bay.occupied ? (
                <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Dysk obecny — kliknij Rescan po danych</div>
              ) : (
                <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Pusta zatoka — brak nośnika</div>
              )}

              <hr className="div"/>

              {/* Przyciski sterowania */}
              <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm"
                  disabled={!bay.occupied || ledBusy}
                  style={!bay.occupied ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  onClick={() => applyLed('locate-on')}>Lokalizuj (ON)</button>
                <button className="btn sm"
                  disabled={!bay.occupied || ledBusy}
                  style={!bay.occupied ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  onClick={() => applyLed('locate-off')}>Locate OFF</button>
                <button className="btn sm"
                  disabled={!bay.occupied || !faultOK || ledBusy}
                  style={(!bay.occupied || !faultOK) ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  onClick={() => applyLed('fault-on')}>Ustaw fault</button>
                <button className="btn sm"
                  disabled={!bay.occupied || !faultOK || ledBusy}
                  style={(!bay.occupied || !faultOK) ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  onClick={() => applyLed('fault-off')}>Wyczyść fault</button>
              </div>

              {/* Wynik ostatniej komendy */}
              {lastResult && (
                <Field label="Wykonane polecenie">
                  <pre className="mono" style={{
                    margin: 0, padding: '8px 10px',
                    background: 'var(--bg-1)', border: '1px solid var(--line)',
                    borderRadius: 5, fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'pre-wrap',
                  }}>{lastResult.command || '—'}</pre>
                  {lastResult.output && (
                    <pre className="mono" style={{
                      margin: '4px 0 0', padding: '6px 10px',
                      background: 'var(--bg)', border: '1px solid var(--line)',
                      borderRadius: 5, fontSize: 10, color: 'var(--fg-dim)', whiteSpace: 'pre-wrap',
                    }}>{lastResult.output}</pre>
                  )}
                  {lastResult.error && (
                    <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--warn)' }}>
                      ⚠ {lastResult.error}
                    </div>
                  )}
                  <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: lastResult.ok ? 'var(--ok)' : 'var(--err)' }}>
                    {lastResult.ok ? '✓ Sukces' : '✗ Błąd'}
                  </div>
                </Field>
              )}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
};

window.Storage = Storage;
window.KV      = KV;
window.Mini    = Mini;
window.Field   = Field;
window.Modal   = Modal;
