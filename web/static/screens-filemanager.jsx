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
  const [loading,setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!['text','code','file'].includes(file.type)) { setLoading(false); return; }
    apiGet(`/api/files/preview?path=${encodeURIComponent(dir+'/'+file.name)}`).then(d => { setContent(d.content||''); setLoading(false); });
  }, []);
  const dlUrl = `/api/files/download?path=${encodeURIComponent(dir+'/'+file.name)}`;
  return (
    <Modal title={`Podgląd · ${file.name}`} sub={`${file.size_str} · ${file.mtime}`} onClose={onClose} width={720}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}><a className="btn sm" href={dlUrl} download={file.name}><Icon name="download" size={11}/> Pobierz</a><button className="btn sm primary" onClick={onClose}>Zamknij</button></div>}>
      {loading ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie…</div>
        : ['text','code'].includes(file.type) && content !== null
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

// ── Main FileManager ──────────────────────────────────────────────────────────

const ROOT_NODE = { id:'__root__', label:'/', path:'/', icon:'disk' };

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
  const [view,     setView]     = React.useState('list');
  const [sortBy,   setSortBy]   = React.useState('name');
  const [sortDesc, setSortDesc] = React.useState(false);
  const [search,   setSearch]   = React.useState('');

  // dialogs
  const [permsFor,     setPermsFor]     = React.useState(null);
  const [previewFor,   setPreviewFor]   = React.useState(null);
  const [renameFor,    setRenameFor]    = React.useState(null);
  const [newFolderDlg, setNewFolderDlg] = React.useState(false);
  const [ctxMenu,      setCtxMenu]      = React.useState(null);
  const [uploading,    setUploading]    = React.useState(false);
  const fileInputRef = React.useRef(null);

  // ── Load ZFS pools from /api/storage/mounts ───────────────────────────
  React.useEffect(() => {
    apiGet('/api/storage/mounts').then(res => {
      // res may be array or {mounts:[...]}
      const all = Array.isArray(res) ? res : (res.mounts || []);
      const zfs = all.filter(m => m.fs === 'zfs' || m.fs === 'ZFS');
      setPools(zfs);
      setPoolsLoading(false);
    });
  }, []);

  // ── Load files ────────────────────────────────────────────────────────
  const loadFiles = React.useCallback(async (p) => {
    if (!p) return;
    setLoading(true); setError(''); setSelected([]);
    const res = await apiGet(`/api/files/list?path=${encodeURIComponent(p)}`);
    setLoading(false);
    if (res.error) { setError(res.error); setEntries([]); return; }
    setEntries(res.entries || []);
  }, []);

  React.useEffect(() => { loadFiles(path); }, [path]);

  React.useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

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
    const matchPool = pools.reduce((best, m) => newPath.startsWith(m.mount) && m.mount.length > (best?.mount?.length||0) ? m : best, null);
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

  const toggleSort   = col => { if(sortBy===col) setSortDesc(d=>!d); else {setSortBy(col);setSortDesc(false);} };
  const toggleSelect = (name,e) => { if(e.ctrlKey||e.metaKey) setSelected(s=>s.includes(name)?s.filter(x=>x!==name):[...s,name]); else setSelected([name]); };

  // ── Actions ────────────────────────────────────────────────────────────
  const handleDelete = async (names) => {
    if (!names.length) return;
    if (!confirm(`Usunąć ${names.length===1?names[0]:names.length+' elementów'}?`)) return;
    const res = await apiPost('/api/files/delete', { paths: names.map(n => (path==='/'?'':path)+'/'+n) });
    if (res.error) alert('Błąd: '+res.error);
    loadFiles(path);
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    await fetch(`/api/files/upload?path=${encodeURIComponent(path)}`, {method:'POST',credentials:'include',body:fd});
    setUploading(false); loadFiles(path);
  };

  const onCtx = (e, file) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY,file}); };

  // ── is a pool entry the "active" one (current path is inside it) ──────
  const isPoolActive = (pool) => path === pool.mount || path.startsWith(pool.mount + '/');

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{display:'flex',height:'calc(100vh - 160px)',minHeight:500,border:'1px solid var(--line-strong)',borderRadius:10,overflow:'hidden',background:'var(--bg-1)'}}>

      {/* Dialogs */}
      {permsFor    && <PermsDialog    file={permsFor}    dir={path} onClose={()=>setPermsFor(null)}    onSave={()=>loadFiles(path)}/>}
      {previewFor  && <PreviewDialog  file={previewFor}  dir={path} onClose={()=>setPreviewFor(null)}/>}
      {renameFor   && <RenameDialog   file={renameFor}   dir={path} onClose={()=>setRenameFor(null)}   onRenamed={()=>loadFiles(path)}/>}
      {newFolderDlg && <NewFolderDialog dir={path} onClose={()=>setNewFolderDlg(false)} onCreated={()=>loadFiles(path)}/>}

      {/* Context menu */}
      {ctxMenu && (
        <div onClick={e=>e.stopPropagation()} style={{position:'fixed',left:ctxMenu.x,top:ctxMenu.y,zIndex:1000,background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:8,padding:4,minWidth:180,boxShadow:'0 8px 24px rgba(0,0,0,0.4)'}}>
          {[
            {icon:'log',     label:'Podgląd',     show:!ctxMenu.file.is_dir, action:()=>{setPreviewFor(ctxMenu.file);setCtxMenu(null);}},
            {icon:'download',label:'Pobierz',      show:!ctxMenu.file.is_dir, action:()=>{window.open(`/api/files/download?path=${encodeURIComponent(path+'/'+ctxMenu.file.name)}`,'_blank');setCtxMenu(null);}},
            {icon:'edit',    label:'Zmień nazwę', show:true, action:()=>{setRenameFor(ctxMenu.file);setCtxMenu(null);}},
            {icon:'key',     label:'Uprawnienia', show:true, action:()=>{setPermsFor(ctxMenu.file);setCtxMenu(null);}},
            null,
            {icon:'trash',   label:'Usuń',        show:true, action:()=>{handleDelete([ctxMenu.file.name]);setCtxMenu(null);}, danger:true},
          ].filter(x=>x===null||x.show).map((item,i)=>item===null
            ?<div key={i} style={{height:1,background:'var(--line)',margin:'4px 0'}}/>
            :<button key={i} onClick={item.action}
                style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'7px 10px',background:'none',border:'none',borderRadius:5,cursor:'pointer',textAlign:'left',color:item.danger?'var(--err)':'var(--fg)',fontSize:'var(--fs-sm)'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg-2)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <Icon name={item.icon} size={13}/>{item.label}
              </button>
          )}
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <div style={{width:230,borderRight:'1px solid var(--line-strong)',overflowY:'auto',padding:'8px 6px',flexShrink:0,display:'flex',flexDirection:'column',gap:0}}>

        {/* Header */}
        <div style={{fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--fg-dim)',textTransform:'uppercase',letterSpacing:'.06em',padding:'4px 8px 10px'}}>
          Pule ZFS
        </div>

        {/* / root */}
        {(() => {
          const isRoot = path === '/';
          return (
            <div onClick={() => navigateTo('/', null)}
              style={{display:'flex',alignItems:'center',gap:7,padding:'6px 8px',borderRadius:6,cursor:'pointer',marginBottom:2,
                background: isRoot ? 'oklch(0.55 0.2 260 / 0.12)' : 'none',
                border: isRoot ? '1px solid oklch(0.55 0.2 260 / 0.25)' : '1px solid transparent'}}
              onMouseEnter={e=>{if(!isRoot)e.currentTarget.style.background='var(--bg-2)';}}
              onMouseLeave={e=>{if(!isRoot)e.currentTarget.style.background='none';}}>
              <Icon name="disk" size={14} style={{color:isRoot?'var(--accent)':'var(--fg-dim)',flexShrink:0}}/>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',color:isRoot?'var(--accent)':'var(--fg)',fontWeight:500}}>/ (root)</span>
            </div>
          );
        })()}

        {/* Divider */}
        <div style={{height:1,background:'var(--line)',margin:'6px 4px 8px'}}/>

        {/* ZFS pools */}
        {poolsLoading ? (
          <div style={{padding:'10px 8px',color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>
            <span className="dot pulse" style={{display:'inline-block',marginRight:6}}/>Ładowanie…
          </div>
        ) : pools.length === 0 ? (
          <div style={{padding:'10px 8px',color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>Brak pul ZFS</div>
        ) : (
          pools.map(pool => {
            const active = isPoolActive(pool);
            return (
              <div key={pool.mount}
                onClick={() => navigateTo(pool.mount, pool)}
                style={{padding:'8px 10px',borderRadius:7,cursor:'pointer',marginBottom:3,
                  background: active ? 'oklch(0.55 0.2 260 / 0.12)' : 'none',
                  border: active ? '1px solid oklch(0.55 0.2 260 / 0.25)' : '1px solid transparent'}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.background='var(--bg-2)';}}
                onMouseLeave={e=>{if(!active)e.currentTarget.style.background='none';}}>

                {/* Pool name + icon */}
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  <Icon name="disk" size={14} style={{color:active?'var(--accent)':'oklch(0.7 0.15 75)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',fontWeight:600,color:active?'var(--accent)':'var(--fg)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {pool.device}
                    </div>
                    <div style={{fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1}}>
                      {pool.mount}
                    </div>
                  </div>
                </div>

                {/* Usage bar */}
                <div style={{marginTop:6}}>
                  {fmtPercent(pool.percent)}
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:3}}>
                    <span style={{fontSize:9,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                      {pool.used_gb?.toFixed(1)} / {pool.total_gb?.toFixed(1)} GB
                    </span>
                    <span style={{fontSize:9,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                      {pool.free_gb?.toFixed(1)} GB wolne
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── MAIN AREA ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

        {/* Toolbar */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--line-strong)',flexWrap:'wrap'}}>

          {/* Breadcrumb — always starts with clickable "/" */}
          <div className="row" style={{flex:1,fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',flexWrap:'wrap',alignItems:'center',gap:0}}>
            <span style={{color:crumbs.length===0?'var(--fg)':'var(--accent)',cursor:'pointer',padding:'0 3px',fontWeight:500}}
              onClick={() => navigateToBreadcrumb(-1)}>/</span>
            {crumbs.map((part, i) => (
              <span key={i} style={{display:'flex',alignItems:'center'}}>
                <span style={{color:'var(--fg-dim)',margin:'0 1px'}}>/</span>
                <span style={{color:i===crumbs.length-1?'var(--fg)':'var(--accent)',cursor:'pointer',padding:'0 2px'}}
                  onClick={() => navigateToBreadcrumb(i)}>{part}</span>
              </span>
            ))}
          </div>

          <div className="row gap-sm">
            {/* Search */}
            <div style={{display:'flex',alignItems:'center',gap:6,background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,padding:'4px 8px'}}>
              <Icon name="search" size={12} style={{color:'var(--fg-dim)'}}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Szukaj…"
                style={{background:'none',border:'none',outline:'none',color:'var(--fg)',fontSize:'var(--fs-xs)',width:120}}/>
            </div>
            <button className="btn sm" onClick={()=>setNewFolderDlg(true)}><Icon name="folder" size={11}/> Nowy folder</button>
            <button className="btn sm primary" onClick={()=>fileInputRef.current?.click()} disabled={uploading}>
              {uploading?<><span className="dot pulse" style={{display:'inline-block',marginRight:6}}/>Przesyłanie…</>:<><Icon name="upload" size={11}/> Wgraj</>}
            </button>
            <input ref={fileInputRef} type="file" style={{display:'none'}} onChange={e=>handleUpload(e.target.files[0])}/>
            {selected.length > 0 && <>
              <button className="btn sm"><Icon name="download" size={11}/> Pobierz</button>
              <button className="btn sm danger" onClick={()=>handleDelete(selected)}><Icon name="trash" size={11}/> Usuń ({selected.length})</button>
            </>}
            <div className="segmented">
              <button className={view==='list'?'active':''} onClick={()=>setView('list')}>Lista</button>
              <button className={view==='grid'?'active':''} onClick={()=>setView('grid')}>Siatka</button>
            </div>
            <button className="icon-btn" onClick={()=>loadFiles(path)} title="Odśwież"><Icon name="refresh" size={13}/></button>
          </div>
        </div>

        {/* File list */}
        <div style={{flex:1,overflowY:'auto',position:'relative'}}>
          {loading && <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'var(--bg-1)',opacity:.6,zIndex:5}}><span className="dot pulse" style={{display:'inline-block'}}/></div>}
          {error   && <div style={{padding:24,color:'var(--err)',fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>⚠ {error}</div>}

          {!error && view==='list' && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{width:24}}><input type="checkbox" style={{accentColor:'var(--accent)'}} checked={selected.length===filtered.length&&filtered.length>0} onChange={e=>setSelected(e.target.checked?filtered.map(f=>f.name):[])}/></th>
                  <th style={{cursor:'pointer'}} onClick={()=>toggleSort('name')}>Nazwa {sortBy==='name'&&(sortDesc?'↓':'↑')}</th>
                  <th style={{cursor:'pointer'}} onClick={()=>toggleSort('size')}>Rozmiar {sortBy==='size'&&(sortDesc?'↓':'↑')}</th>
                  <th style={{cursor:'pointer'}} onClick={()=>toggleSort('mtime')}>Modyfikacja {sortBy==='mtime'&&(sortDesc?'↓':'↑')}</th>
                  <th>Uprawnienia</th>
                  <th>Właściciel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length===0&&!loading&&<tr><td colSpan={7} style={{textAlign:'center',padding:32,color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Pusty katalog</td></tr>}
                {filtered.map(f => (
                  <tr key={f.name}
                    onClick={e => { if(f.is_dir) navigateIntoDir(f.name); else toggleSelect(f.name,e); }}
                    onContextMenu={e => onCtx(e,f)}
                    style={{background:selected.includes(f.name)?'oklch(0.55 0.2 260 / 0.1)':'',cursor:'pointer'}}>
                    <td onClick={e=>{e.stopPropagation();toggleSelect(f.name,e);}}><input type="checkbox" checked={selected.includes(f.name)} onChange={()=>{}} style={{accentColor:'var(--accent)'}}/></td>
                    <td>
                      <div className="row gap-sm">
                        <Icon name={typeIcon(f.type)} size={14} style={{color:typeColor(f.type),flexShrink:0}}/>
                        <span style={{fontWeight:f.is_dir?600:400}}>{f.name}</span>
                        {f.type==='symlink'&&<span style={{color:'var(--fg-dim)',fontSize:10}}>(symlink)</span>}
                      </div>
                    </td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{f.size_str}</td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{f.mtime}</td>
                    <td className="mono"     style={{fontSize:'var(--fs-xs)',letterSpacing:'.04em'}}>{f.perms}</td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{f.owner}:{f.group}</td>
                    <td onClick={e=>e.stopPropagation()}>
                      <div className="row gap-sm">
                        {!f.is_dir&&<button className="icon-btn" onClick={()=>setPreviewFor(f)} title="Podgląd"><Icon name="log" size={13}/></button>}
                        <button className="icon-btn" title="Zmień nazwę" onClick={()=>setRenameFor(f)}><Icon name="edit" size={13}/></button>
                        <button className="icon-btn" title="Uprawnienia" onClick={()=>setPermsFor(f)}><Icon name="key" size={13}/></button>
                        {!f.is_dir&&<a className="icon-btn" href={`/api/files/download?path=${encodeURIComponent(path+'/'+f.name)}`} download={f.name} title="Pobierz"><Icon name="download" size={13}/></a>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!error && view==='grid' && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:10,padding:14}}>
              {filtered.length===0&&!loading&&<div style={{gridColumn:'1/-1',textAlign:'center',padding:32,color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Pusty katalog</div>}
              {filtered.map(f => (
                <div key={f.name} onContextMenu={e=>onCtx(e,f)}
                  onClick={e=>{if(f.is_dir)navigateIntoDir(f.name);else toggleSelect(f.name,e);}}
                  style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'14px 10px',borderRadius:8,cursor:'pointer',border:'1px solid',transition:'all .15s',userSelect:'none',
                    borderColor:selected.includes(f.name)?'var(--accent)':'transparent',
                    background:selected.includes(f.name)?'oklch(0.55 0.2 260 / 0.1)':'var(--bg-2)'}}>
                  <Icon name={typeIcon(f.type)} size={36} style={{color:typeColor(f.type)}}/>
                  <div style={{fontSize:'var(--fs-xs)',textAlign:'center',wordBreak:'break-all',lineHeight:1.4,color:'var(--fg)',fontWeight:f.is_dir?600:400}}>
                    {f.name.length>22?f.name.slice(0,20)+'…':f.name}
                  </div>
                  <div style={{fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{f.size_str}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status bar */}
        <div style={{padding:'6px 14px',borderTop:'1px solid var(--line)',fontSize:'var(--fs-xs)',color:'var(--fg-dim)',display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)'}}>
          <span>{filtered.length} elementów{selected.length>0?` · ${selected.length} zaznaczonych`:''}</span>
          {selectedPool && (
            <span style={{color:'var(--fg-dim)'}}>
              {selectedPool.device} · {selectedPool.used_gb?.toFixed(1)}/{selectedPool.total_gb?.toFixed(1)} GB
            </span>
          )}
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:320}}>{path}</span>
        </div>
      </div>
    </div>
  );
};

window.FileManager = FileManager;
