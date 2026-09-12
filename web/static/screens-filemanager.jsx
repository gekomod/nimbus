// ===== Menedżer plików — API-driven =====

const Modal = window.Modal;
const Icon  = window.Icon;

const typeIcon  = (t) => ({ dir:'folder', video:'media', audio:'media', text:'log', code:'terminal', archive:'download', image:'dashboard', pdf:'log', file:'log', symlink:'share' }[t] || 'log');
const typeColor = (t) => ({ dir:'var(--accent)', video:'oklch(0.65 0.2 25)', audio:'oklch(0.65 0.18 300)', text:'oklch(0.7 0.15 220)', code:'oklch(0.65 0.18 145)', archive:'oklch(0.65 0.15 75)', pdf:'oklch(0.65 0.2 25)', symlink:'oklch(0.65 0.12 200)' }[t] || 'var(--fg-dim)');

async function apiGet(path) {
  try { const r = await fetch(path, {credentials:'include'}); if (!r.ok) return {error: await r.text()}; return r.json(); }
  catch(e) { return {error: String(e)}; }
}
async function apiPost(path, body) {
  try { const r = await fetch(path, {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.ok ? r.json() : {error: await r.text()}; }
  catch(e) { return {error: String(e)}; }
}

function fmtPercent(p) {
  const pct = Math.round(p);
  const color = pct > 90 ? 'var(--err)' : pct > 75 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div style={{display:'flex',alignItems:'center',gap:5,marginTop:3}}>
      <div style={{flex:1,height:3,borderRadius:2,background:'var(--bg-3)'}}>
        <div style={{width:pct+'%',height:'100%',borderRadius:2,background:color,transition:'width .3s'}}/>
      </div>
      <span style={{fontSize:9,color,fontFamily:'var(--font-mono)',minWidth:28,textAlign:'right'}}>{pct}%</span>
    </div>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

const PermsDialog = ({ file, dir, onClose, onSave }) => {
  const parsePerms = (p) => { const s=p.replace(/^[^-]/,'').padEnd(9,'-'); return {ur:s[0]==='r',uw:s[1]==='w',ux:s[2]==='x',gr:s[3]==='r',gw:s[4]==='w',gx:s[5]==='x',or:s[6]==='r',ow:s[7]==='w',ox:s[8]==='x'}; };
  const [bits,setBits]   = React.useState(parsePerms(file.perms||'-rw-r--r--'));
  const [owner,setOwner] = React.useState(file.owner||'root');
  const [group,setGroup] = React.useState(file.group||'root');
  const [busy,setBusy]   = React.useState(false);
  const toggle = k => setBits(b => ({...b,[k]:!b[k]}));
  const octal  = [(bits.ur?4:0)+(bits.uw?2:0)+(bits.ux?1:0),(bits.gr?4:0)+(bits.gw?2:0)+(bits.gx?1:0),(bits.or?4:0)+(bits.ow?2:0)+(bits.ox?1:0)].join('');
  const save = async () => { setBusy(true); const res=await apiPost('/api/files/chmod',{path:dir+'/'+file.name,mode:octal,owner,group}); setBusy(false); if(!res.error){onSave();onClose();}else alert('Błąd: '+res.error); };
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,padding:'6px 10px',color:'var(--fg)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};
  const Bit = ({k,label}) => (<label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:'var(--fs-sm)'}}><input type="checkbox" checked={bits[k]} onChange={()=>toggle(k)} style={{accentColor:'var(--accent)',width:14,height:14}}/>{label}</label>);
  return (
    <Modal title={`Uprawnienia · ${file.name}`} sub={`chmod ${octal} · chown ${owner}:${group}`} onClose={onClose} width={460}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}><button className="btn sm" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={save} disabled={busy}><Icon name="check" size={11}/> {busy?'Zapisuję…':'Zastosuj'}</button></div>}>
      <div className="col" style={{gap:16}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Właściciel</div><input style={inpSt} value={owner} onChange={e=>setOwner(e.target.value)}/></div>
          <div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Grupa</div><input style={inpSt} value={group} onChange={e=>setGroup(e.target.value)}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          {[['Właściciel','ur','uw','ux'],['Grupa','gr','gw','gx'],['Inni','or','ow','ox']].map(([label,r2,w,x]) => (
            <div key={label} style={{background:'var(--bg-2)',borderRadius:8,padding:'12px',border:'1px solid var(--line-strong)'}}>
              <div style={{fontSize:'var(--fs-xs)',fontWeight:600,marginBottom:10,color:'var(--fg-dim)',textTransform:'uppercase',letterSpacing:'.06em'}}>{label}</div>
              <div className="col" style={{gap:8}}><Bit k={r2} label="Odczyt (r)"/><Bit k={w} label="Zapis (w)"/><Bit k={x} label="Wykonanie (x)"/></div>
            </div>
          ))}
        </div>
        <div style={{padding:'10px 14px',background:'var(--bg-2)',borderRadius:6,fontFamily:'var(--font-mono)',fontSize:13,textAlign:'center',color:'var(--accent)',letterSpacing:'.1em'}}>chmod {octal} · chown {owner}:{group}</div>
      </div>
    </Modal>
  );
};

const PreviewDialog = ({ file, dir, onClose }) => {
  const [content,setContent] = React.useState(null);
  const [previewError,setPreviewError] = React.useState('');
  const [loading,setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!['text','code','file'].includes(file.type)) { setLoading(false); return; }
    apiGet(`/api/files/preview?path=${encodeURIComponent(dir+'/'+file.name)}`).then(d => { setPreviewError(d.error||''); setContent(d.content||''); setLoading(false); });
  }, []);
  const dlUrl = `/api/files/download?path=${encodeURIComponent(dir+'/'+file.name)}`;
  return (
    <Modal title={`Podgląd · ${file.name}`} sub={`${file.size_str} · ${file.mtime}`} onClose={onClose} width={720}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}><a className="btn sm" href={dlUrl} download={file.name}><Icon name="download" size={11}/> Pobierz</a><button className="btn sm primary" onClick={onClose}>Zamknij</button></div>}>
      {loading ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie…</div>
        : previewError ? <div role="alert" className="dlw-error">{previewError}</div> : ['text','code','file'].includes(file.type) && content !== null
          ? <pre style={{background:'oklch(0.12 0.01 260)',borderRadius:8,padding:'16px',fontFamily:'var(--font-mono)',fontSize:12,lineHeight:1.7,color:'oklch(0.85 0.04 260)',maxHeight:420,overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{content||'(pusty plik)'}</pre>
          : file.type==='video'||file.type==='audio'
            ? <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:20}}><div style={{width:120,height:120,borderRadius:16,background:'oklch(0.65 0.2 25 / 0.15)',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="media" size={48} style={{color:'oklch(0.65 0.2 25)'}}/></div><div style={{textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Podgląd niedostępny.<br/>Rozmiar: <span className="mono">{file.size_str}</span></div></div>
            : <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:20,color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}><Icon name={typeIcon(file.type)} size={40}/><div>Brak podglądu dla tego typu pliku.</div></div>}
    </Modal>
  );
};

const NewFolderDialog = ({ dir, onClose, onCreated }) => {
  const [name,setName] = React.useState('nowy-folder');
  const [busy,setBusy] = React.useState(false);
  const [err,setErr]   = React.useState('');
  const create = async () => { if(!name.trim())return; setBusy(true); setErr(''); const res=await apiPost('/api/files/mkdir',{path:dir+'/'+name.trim()}); setBusy(false); if(res.error){setErr(res.error);return;} onCreated(); onClose(); };
  return (
    <Modal title="Nowy folder" sub={dir} onClose={onClose} width={400}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}><button className="btn sm" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={create} disabled={busy}><Icon name="folder" size={11}/> {busy?'Tworzę…':'Utwórz'}</button></div>}>
      <div className="col" style={{gap:10}}>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&create()} autoFocus style={{background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:6,padding:'8px 12px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'}}/>
        {err && <div style={{color:'var(--err)',fontSize:'var(--fs-xs)'}}>{err}</div>}
      </div>
    </Modal>
  );
};

const RenameDialog = ({ file, dir, onClose, onRenamed }) => {
  const [name,setName] = React.useState(file.name);
  const [busy,setBusy] = React.useState(false);
  const [err,setErr]   = React.useState('');
  const save = async () => { if(!name.trim()||name===file.name){onClose();return;} setBusy(true); setErr(''); const res=await apiPost('/api/files/rename',{from:dir+'/'+file.name,to:dir+'/'+name.trim()}); setBusy(false); if(res.error){setErr(res.error);return;} onRenamed(); onClose(); };
  return (
    <Modal title={`Zmień nazwę · ${file.name}`} sub={dir} onClose={onClose} width={420}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}><button className="btn sm" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={save} disabled={busy}><Icon name="check" size={11}/> {busy?'Zapisuję…':'Zmień nazwę'}</button></div>}>
      <div className="col" style={{gap:10}}>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&save()} autoFocus style={{background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:6,padding:'8px 12px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'}}/>
        {err && <div style={{color:'var(--err)',fontSize:'var(--fs-xs)'}}>{err}</div>}
      </div>
    </Modal>
  );
};

// Destination browser uses the same authenticated file listing as the workspace.
const MoveDialog = ({paths,initial,onClose,onMoved}) => {
  const [destination,setDestination]=React.useState(initial),[browse,setBrowse]=React.useState(initial),[folders,setFolders]=React.useState([]),[loading,setLoading]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[results,setResults]=React.useState(null);
  React.useEffect(()=>{let alive=true;setLoading(true);setError('');apiGet('/api/files/list?path='+encodeURIComponent(browse)).then(r=>{if(!alive)return;setLoading(false);if(r.error){setError(r.error);setFolders([])}else setFolders((r.entries||[]).filter(f=>f.is_dir))});return()=>{alive=false}},[browse]);
  const go=p=>{setDestination(p);setBrowse(p)};
  const sending=React.useRef(false);
  const submit=async()=>{if(sending.current||busy||results)return;sending.current=true;setBusy(true);setError('');const r=await apiPost('/api/files/move',{paths,destination});setBusy(false);if(r.error){setError(r.error+' Sprawdź źródło i cel przed ponowieniem.');setResults([]);onMoved();return}if(!Array.isArray(r.results)){setError('Nieznany wynik. Sprawdź źródło i cel przed ponowieniem.');setResults([]);onMoved();return}setResults(r.results);onMoved()};
  return <Modal title="Przenieś elementy" sub={`${paths.length} elementów · bez nadpisywania`} onClose={()=>{if(!busy)onClose()}} width={580} footer={<div className="paper-actions"><button className="btn" disabled={busy} onClick={onClose}>{results?'Zamknij':'Anuluj'}</button>{!results&&<button className="btn primary" disabled={busy||loading||!destination.startsWith('/')} onClick={submit}>{busy?'Przenoszenie…':'Przenieś tutaj'}</button>}</div>}>
    <label className="fm-move-label">Katalog docelowy<input value={destination} disabled={busy||!!results} onChange={e=>setDestination(e.target.value)} /></label>
    {!results&&<><div className="paper-actions"><button className="btn" disabled={busy} onClick={()=>go(browse.slice(0,browse.lastIndexOf('/'))||'/')}>Poziom wyżej</button><button className="btn" disabled={busy} onClick={()=>setBrowse(destination)}>Otwórz ścieżkę</button></div><div className="fm-move-folders">{loading?'Ładowanie…':folders.map(f=><button className="btn" disabled={busy} key={f.name} onClick={()=>go((browse==='/'?'':browse)+'/'+f.name)}><Icon name="folder" size={17}/>{f.name}</button>)}</div></>}
    {busy&&<p role="status">Trwa przenoszenie. Między dyskami może potrwać dłużej — poczekaj na wynik.</p>}
    {error&&<div className="dlw-error" role="alert">{error}</div>}
    {results&&<div aria-live="polite">{results.map((r,i)=><p key={i} className={r.moved?'':'dlw-error'}>{r.source}: {r.moved?'Przeniesiono do '+r.target:r.error}</p>)}</div>}
  </Modal>;
};

// ── Main FileManager ──────────────────────────────────────────────────────────


const FileManager = () => {
  // sidebar — pools from /api/storage/mounts filtered by fs=zfs
  const [pools,      setPools]      = React.useState([]);
  const [poolsLoading, setPoolsLoading] = React.useState(true);
  const [selectedPool, setSelectedPool] = React.useState(null);  // full mount object

  // file list
  const [entries,  setEntries]  = React.useState([]);
  const [loading,  setLoading]  = React.useState(false);
  const [error,    setError]    = React.useState('');
  const [path,     setPath]     = React.useState('/');

  // ui
  const [selected, setSelected] = React.useState([]);
  const [view,     setView]     = React.useState('grid');
  const [sortBy,   setSortBy]   = React.useState('name');
  const [sortDesc, setSortDesc] = React.useState(false);
  const [search,   setSearch]   = React.useState('');

  // dialogs
  const [permsFor,     setPermsFor]     = React.useState(null);
  const [previewFor,   setPreviewFor]   = React.useState(null);
  const [renameFor,    setRenameFor]    = React.useState(null);
  const [newFolderDlg, setNewFolderDlg] = React.useState(false);
  const [uploading,    setUploading]    = React.useState(false);
  const fileInputRef = React.useRef(null);
  const requestID = React.useRef(0);
  const [transfer,setTransfer] = React.useState(null);
  const [poolError,setPoolError] = React.useState('');

  // ── Load ZFS pools from /api/storage/mounts ───────────────────────────
  React.useEffect(() => {
    apiGet('/api/storage/mounts').then(res => {
      // res may be array or {mounts:[...]}
      if(res.error) setPoolError(res.error);
      const all = Array.isArray(res) ? res : (res.mounts || []);
      const zfs = all.filter(m => m.fs === 'zfs' || m.fs === 'ZFS');
      setPools(zfs);
      setPoolsLoading(false);
    });
  }, []);

  // ── Load files ────────────────────────────────────────────────────────
  const loadFiles = React.useCallback(async (p) => {
    if (!p) return;
    const id = ++requestID.current;
    setLoading(true); setError(''); setSelected([]);
    const res = await apiGet(`/api/files/list?path=${encodeURIComponent(p)}`);
    if(id !== requestID.current) return;
    setLoading(false);
    if (res.error) { setError(res.error); setEntries([]); return; }
    setEntries(res.entries || []);
  }, []);

  React.useEffect(() => { loadFiles(path); }, [path]);

  // ── Navigation ────────────────────────────────────────────────────────
  const navigateTo = (newPath, pool) => {
    setPath(newPath);
    setSearch('');
    setSelected([]);
    if (pool !== undefined) setSelectedPool(pool); // null = root, obj = zfs pool
  };

  const navigateIntoDir = (dirName) => {
    navigateTo((path === '/' ? '' : path) + '/' + dirName, undefined);
  };

  // Breadcrumb: always starts with "/"
  const crumbs = path === '/' ? [] : path.split('/').filter(Boolean);

  const navigateToBreadcrumb = (idx) => {
    const newPath = idx < 0 ? '/' : '/' + crumbs.slice(0, idx + 1).join('/');
    // figure out which pool this belongs to (longest matching mount prefix)
    const matchPool = pools.reduce((best, m) => (newPath === m.mount || newPath.startsWith(m.mount + '/')) && m.mount.length > (best?.mount?.length||0) ? m : best, null);
    navigateTo(newPath, matchPool);
  };

  // ── Sorted/filtered list ──────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    let list = search ? entries.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : [...entries];
    list.sort((a,b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      if (sortBy==='name')  cmp = a.name.localeCompare(b.name);
      if (sortBy==='size')  cmp = (a.size||0) - (b.size||0);
      if (sortBy==='mtime') cmp = (a.mtime||'').localeCompare(b.mtime||'');
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [entries, search, sortBy, sortDesc]);

  const toggleSelect = (name,e) => { if(e.ctrlKey||e.metaKey) setSelected(s=>s.includes(name)?s.filter(x=>x!==name):[...s,name]); else setSelected([name]); };

  // ── Actions ────────────────────────────────────────────────────────────
  const handleDelete = async (names) => {
    if (!names.length) return;
    if (!confirm(`Usunąć ${names.length===1?names[0]:names.length+' elementów'}?`)) return;
    const res = await apiPost('/api/files/delete', { paths: names.map(n => (path==='/'?'':path)+'/'+n) });
    if (res.error) alert('Błąd: '+res.error);
    loadFiles(path);
  };

  const handleUpload = (file) => {
    if (!file || uploading) return;
    const destination=path;
    setUploading(true); setTransfer({name:file.name,percent:0,state:'Przesyłanie'});
    const fd=new FormData(); fd.append('file',file);
    const xhr=new XMLHttpRequest();
    xhr.open('POST',`/api/files/upload?path=${encodeURIComponent(destination)}`);
    xhr.withCredentials=true;
    xhr.upload.onprogress=e=>setTransfer({name:file.name,percent:e.lengthComputable?Math.round(e.loaded/e.total*100):null,state:e.lengthComputable&&e.loaded===e.total?'Zapisywanie na serwerze':'Przesyłanie'});
    const finish=error=>{setUploading(false);setTransfer(t=>({...t,state:error?'Błąd':'Zakończono',error}));if(!error&&destination===currentPath.current)loadFiles(destination);if(fileInputRef.current)fileInputRef.current.value='';};
    xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText)}catch{}finish(xhr.status<200||xhr.status>=300?result?.error||`HTTP ${xhr.status}: ${xhr.responseText.slice(0,300)}`:result?.error||null)};
    xhr.onerror=()=>finish('Utracono połączenie. Sprawdź katalog docelowy przed ponowieniem.');
    xhr.send(fd);
  };
  const currentPath=React.useRef(path); currentPath.current=path;


  // ── is a pool entry the "active" one (current path is inside it) ──────
  const isPoolActive = (pool) => path === pool.mount || path.startsWith(pool.mount + '/');

  const [movePaths,setMovePaths]=React.useState(null);
  const beginMove=names=>setMovePaths(names.map(n=>(path==='/'?'':path)+'/'+n));
  const chosen=entries.find(f=>f.name===selected[0]);
  const fileURL=f=>`/api/files/download?path=${encodeURIComponent((path==='/'?'':path)+'/'+f.name)}`;
  const open=f=>f.is_dir?navigateIntoDir(f.name):setPreviewFor(f);
  return <div className="nimbus-paper fm-modern">
    {movePaths&&<MoveDialog paths={movePaths} initial={path} onClose={()=>setMovePaths(null)} onMoved={()=>loadFiles(path)}/>}
    {permsFor&&<PermsDialog file={permsFor} dir={path} onClose={()=>setPermsFor(null)} onSave={()=>loadFiles(path)}/>}
    {previewFor&&<PreviewDialog file={previewFor} dir={path} onClose={()=>setPreviewFor(null)}/>}
    {renameFor&&<RenameDialog file={renameFor} dir={path} onClose={()=>setRenameFor(null)} onRenamed={()=>loadFiles(path)}/>}
    {newFolderDlg&&<NewFolderDialog dir={path} onClose={()=>setNewFolderDlg(false)} onCreated={()=>loadFiles(path)}/>}
    <header className="paper-heading"><div><span>TWOJA PRZESTRZEŃ</span><h2>Pliki</h2><p>Foldery, dokumenty i wszystko, co przechowujesz.</p></div><div className="paper-actions"><button className="btn" onClick={()=>setNewFolderDlg(true)}><Icon name="folder" size={16}/> Nowy folder</button><button className="btn primary" disabled={uploading} onClick={()=>fileInputRef.current?.click()}><Icon name="upload" size={16}/> Prześlij plik</button><input ref={fileInputRef} type="file" hidden onChange={e=>handleUpload(e.target.files[0])}/></div></header>
    <div className="fm-layout"><nav className="fm-locations" aria-label="Lokalizacje"><h3>Lokalizacje</h3><button className={path==='/'?'active':''} onClick={()=>navigateTo('/',null)}><Icon name="disk" size={18}/> System plików</button><h3>Pule ZFS</h3>{poolError&&<p role="alert">{poolError}</p>}{poolsLoading?<p>Ładowanie…</p>:!pools.length?<p>Brak zamontowanych pul ZFS</p>:pools.map(pool=><button key={pool.mount} className={isPoolActive(pool)?'active':''} onClick={()=>navigateTo(pool.mount,pool)}><Icon name="disk" size={18}/><span><strong>{pool.device}</strong><small>{pool.mount}</small>{Number.isFinite(pool.percent)&&fmtPercent(pool.percent)}</span></button>)}<div className="fm-location-note"><Icon name="folder" size={24}/><p>Wybierz lokalizację, a następnie folder lub plik.</p></div></nav>
    <main className="fm-content"><div className="fm-path"><button onClick={()=>navigateToBreadcrumb(-1)}>System plików</button>{crumbs.map((part,i)=><React.Fragment key={i}><span>›</span><button onClick={()=>navigateToBreadcrumb(i)}>{part}</button></React.Fragment>)}</div>
    <div className="fm-tools"><input aria-label="Szukaj w bieżącym folderze" placeholder="Szukaj w tym folderze…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Sortowanie" value={sortBy} onChange={e=>setSortBy(e.target.value)}><option value="name">Nazwa</option><option value="size">Rozmiar</option><option value="mtime">Data zmiany</option></select><button className="btn" aria-label="Odwróć kolejność" onClick={()=>setSortDesc(v=>!v)}>{sortDesc?'↓':'↑'}</button><div className="segmented">{[['grid','Kafelki'],['list','Lista']].map(([v,label])=><button key={v} className={view===v?'active':''} aria-pressed={view===v} onClick={()=>setView(v)}>{label}</button>)}</div><button className="btn" onClick={()=>loadFiles(path)} aria-label="Odśwież"><Icon name="refresh" size={16}/></button></div>
    {selected.length>0&&<div className="fm-selection"><span>Zaznaczono: {selected.length}</span><button className="btn" onClick={()=>beginMove(selected)}>Przenieś…</button><button className="btn" onClick={()=>setSelected([])}>Odznacz</button><button className="btn danger" onClick={()=>handleDelete(selected)}>Usuń zaznaczone</button></div>}
    {error&&<div className="dlw-error" role="alert">{error}</div>}
    {loading?<div className="dlw-empty" role="status">Ładowanie folderu…</div>:!error&&<><div className="fm-section-heading"><h3>{view==='grid'?'Zawartość folderu':'Wszystkie elementy'}</h3><span>{filtered.length} elementów</span></div><div className={'fm-items '+view}>{filtered.map((f,i)=><div key={f.name} className={'fm-item '+(selected.includes(f.name)?'selected':'')}><input type="checkbox" aria-label={'Zaznacz '+f.name} checked={selected.includes(f.name)} onChange={()=>setSelected(s=>s.includes(f.name)?s.filter(n=>n!==f.name):[...s,f.name])}/><button className="fm-file" aria-pressed={selected.includes(f.name)} onClick={e=>toggleSelect(f.name,e)} onDoubleClick={()=>open(f)}><span className={'fm-art '+(f.is_dir?'folder':'document')} style={{'--folder-hue':[220,265,155,35,195][i%5]}}>{!f.is_dir&&<Icon name={typeIcon(f.type)} size={30}/>}</span><strong title={f.name}>{f.name}</strong><small>{f.is_dir?'Folder':f.size_str||'—'}</small>{view==='list'&&<small>{f.mtime}</small>}</button><button className="fm-open" aria-label={'Otwórz '+f.name} onClick={()=>open(f)}>Otwórz ↗</button></div>)}</div>{!filtered.length&&<div className="dlw-empty"><Icon name="folder" size={40}/><h3>{search?'Brak pasujących plików':'Folder jest pusty'}</h3><p>{search?'Zmień wyszukiwaną nazwę.':'Prześlij pierwszy plik lub utwórz folder.'}</p></div>}</>}
    <footer className="fm-footer">{path}</footer></main>
    <aside className="fm-inspector" aria-label="Szczegóły pliku"><span>SZCZEGÓŁY</span>{chosen?<><div className={'fm-preview '+(chosen.is_dir?'is-folder':'')}><Icon name={typeIcon(chosen.type)} size={64}/></div><h3>{chosen.name}</h3><p>{chosen.is_dir?'Folder':chosen.type||'Plik'}</p><dl>{[['Rozmiar',chosen.size_str],['Zmodyfikowano',chosen.mtime],['Właściciel',chosen.owner],['Grupa',chosen.group],['Uprawnienia',chosen.perms]].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value||'—'}</dd></React.Fragment>)}</dl><div className="paper-actions"><button className="btn primary" onClick={()=>open(chosen)}>Otwórz</button>{!chosen.is_dir&&<a className="btn" href={fileURL(chosen)} download={chosen.name}>Pobierz</a>}<button className="btn" onClick={()=>beginMove([chosen.name])}>Przenieś…</button><button className="btn" onClick={()=>setRenameFor(chosen)}>Zmień nazwę</button><button className="btn" onClick={()=>setPermsFor(chosen)}>Uprawnienia</button><button className="btn danger" onClick={()=>handleDelete([chosen.name])}>Usuń</button></div></>:<div className="dlw-empty"><Icon name="folder" size={44}/><h3>Wybierz plik lub folder</h3><p>Kliknij element, aby zobaczyć jego szczegóły. Użyj „Otwórz”, aby wejść do folderu.</p></div>}</aside></div>
    {transfer&&<div className={'fm-transfer '+(transfer.error?'failed':'')} role="status"><div><strong>{transfer.state}</strong>{!uploading&&<button aria-label="Zamknij wynik przesyłania" onClick={()=>setTransfer(null)}>×</button>}</div><p>{transfer.name}</p><progress max="100" value={transfer.percent??undefined}/><small>{transfer.error||`${transfer.percent??'—'}% · ${uploading?'Trwa przesyłanie pliku':'Plik zapisany na serwerze'}`}</small></div>}
  </div>;
};
window.FileManager = FileManager;
