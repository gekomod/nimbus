// ===== Antywirus ClamAV — podłączony pod /api/clamav/* =====
const { useState: useCS, useEffect: useCE, useRef: useCR } = React;

const clamAPI = {
  get:  (p)    => fetch('/api/clamav/'+p, {credentials:'include'}).then(r=>r.json()),
  post: (p, b) => fetch('/api/clamav/'+p, {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),
  del:  (p, b) => fetch('/api/clamav/'+p, {method:'DELETE',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),
};

// Toast helpers — delegują do ui-modern.jsx window.toast
const toast = {
  ok:   (msg, extra={}) => window.toast?.success(msg, extra),
  err:  (msg, extra={}) => window.toast?.error(msg, extra),
  info: (msg, extra={}) => window.toast?.info(msg, extra),
  load: (msg, extra={}) => window.toast?.loading(msg, extra),
  warn: (msg, extra={}) => window.toast?.warn(msg, extra),
};

const clamInput = {
  background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
  padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',
  fontSize:'var(--fs-sm)',outline:'none',width:'100%',boxSizing:'border-box'
};

const ScanBadge = ({s}) => {
  if(s==='running')   return <span className="badge ok"><span className="dot pulse"/>SKANOWANIE</span>;
  if(s==='completed') return <span className="badge ok">CLEAN</span>;
  if(s==='threat')    return <span className="badge err"><span className="dot pulse"/>ZAGROŻENIE</span>;
  if(s==='paused')    return <span className="badge warn">WSTRZYMANY</span>;
  if(s==='error')     return <span className="badge err">BŁĄD</span>;
  return <span className="badge">{(s||'').toUpperCase()}</span>;
};

// ── Modal ─────────────────────────────────────────────────────────────────────
const Modal = ({title,sub,onClose,children,footer,width=600}) => (
  <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(4px)'}}
    onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:12,width,maxWidth:'94vw',maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid var(--line)'}}>
        <div>
          <div style={{fontWeight:600,fontSize:'var(--fs-md)'}}>{title}</div>
          {sub&&<div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>{sub}</div>}
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="close" size={14}/></button>
      </div>
      <div style={{padding:'20px'}}>{children}</div>
      {footer&&<div style={{padding:'12px 20px',borderTop:'1px solid var(--line)',display:'flex',gap:8,justifyContent:'flex-end'}}>{footer}</div>}
    </div>
  </div>
);

const FormRow = ({label,hint,children}) => (
  <div style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:12,alignItems:'start',marginBottom:12}}>
    <div>
      <div style={{fontSize:12,fontWeight:500,paddingTop:7}}>{label}</div>
      {hint&&<div style={{fontSize:11,color:'var(--fg-dim)',marginTop:2}}>{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

// ── New Scan Dialog ───────────────────────────────────────────────────────────
const NewScanDialog = ({onClose,onStart}) => {
  const [form,setForm] = useCS({target:'/srv',recursive:true,archives:true,pua:true,priority:'normal'});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <Modal title="Nowe skanowanie" sub="clamscan · uruchomiony jako root" onClose={onClose} width={580}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" onClick={()=>{onStart(form);onClose();}}><Icon name="play" size={11}/> Uruchom skan</button></>}>
      <FormRow label="Ścieżka">
        <input style={clamInput} value={form.target} onChange={e=>set('target',e.target.value)} placeholder="/srv"/>
      </FormRow>
      <FormRow label="Priorytet I/O">
        <select style={clamInput} value={form.priority} onChange={e=>set('priority',e.target.value)}>
          <option value="idle">idle (ionice)</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
      </FormRow>
      <FormRow label="Opcje">
        <div className="col" style={{gap:8}}>
          {[['recursive','Skanuj rekurencyjnie (-r)'],['archives','Rozpakowuj archiwa'],['pua','Wykrywaj PUA']].map(([k,l])=>(
            <label key={k} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:'var(--fs-sm)'}}>
              <input type="checkbox" checked={form[k]} onChange={e=>set(k,e.target.checked)}/> {l}
            </label>
          ))}
        </div>
      </FormRow>
      <div style={{background:'var(--bg)',borderRadius:6,padding:'8px 12px',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--fg-dim)',lineHeight:1.7,marginTop:8}}>
        clamscan {form.recursive?'-r ':''}{form.archives?'--scan-archive ':''}{form.pua?'--detect-pua=yes ':''}<span style={{color:'var(--accent)'}}>{form.target}</span>
      </div>
    </Modal>
  );
};

// ── Schedule Dialog ───────────────────────────────────────────────────────────
const ScheduleDialog = ({sch,onClose,onSave}) => {
  const [form,setForm] = useCS(sch||{name:'',target:'/srv',when:'Codziennie 03:00',cron:'0 3 * * *',onAccess:false,on:true});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const presets = [
    ['Codziennie 03:00','0 3 * * *'],
    ['Co niedziela 02:00','0 2 * * 0'],
    ['Co godzina','0 * * * *'],
    ['Co tydzień (pon)','0 3 * * 1'],
    ['Niestandardowy','custom'],
  ];
  return (
    <Modal title={sch?.id?'Edytuj zadanie':'Nowe zadanie harmonogramu'} onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" onClick={()=>{onSave(form);onClose();}}>Zapisz</button></>}>
      <FormRow label="Nazwa">
        <input style={clamInput} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="np. Nocny skan /srv"/>
      </FormRow>
      <FormRow label="Ścieżka">
        <input style={clamInput} value={form.target} onChange={e=>set('target',e.target.value)} placeholder="/srv"/>
      </FormRow>
      <FormRow label="Częstotliwość">
        <select style={clamInput} value={form.when} onChange={e=>{
          const p = presets.find(x=>x[0]===e.target.value);
          set('when',e.target.value);
          if(p&&p[1]!=='custom') set('cron',p[1]);
        }}>
          {presets.map(([l])=><option key={l} value={l}>{l}</option>)}
        </select>
      </FormRow>
      {form.when==='Niestandardowy'&&(
        <FormRow label="Cron" hint="min godz dzień miesiąc dzień-tyg">
          <input style={clamInput} value={form.cron} onChange={e=>set('cron',e.target.value)} placeholder="0 3 * * *"/>
        </FormRow>
      )}
      <FormRow label="Aktywne">
        <div className={"toggle "+(form.on?'on':'')} onClick={()=>set('on',!form.on)}/>
      </FormRow>
    </Modal>
  );
};

// ── Overview ──────────────────────────────────────────────────────────────────
const ClamOverview = ({status,scans,quarantine,history,fresh30d,onNewScan}) => {
  const activeScan = scans.find(s=>s.state==='running'||s.state==='paused');
  const sigCount = (status.signatures||[]).reduce((a,s)=>a+(parseInt((s.sigs||'').replace(/[\s,]/g,''))||0),0);

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">CLAMD</div>
          <div className="kpi-value" style={{fontSize:18,color:status.daemon?'var(--ok)':'var(--err)'}}>{status.daemon?'ONLINE':'OFFLINE'}</div>
          <div className="kpi-foot"><span>{(status.version||'').split('/')[0]||'—'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">OCHRONA REAL-TIME</div>
          <div className="kpi-value" style={{fontSize:18,color:status.on_access?.enabled?'var(--ok)':'var(--fg-dim)'}}>{status.on_access?.enabled?'AKTYWNA':'WYŁĄCZONA'}</div>
          <div className="kpi-foot"><span>fanotify · OnAccess</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">KWARANTANNA</div>
          <div className="kpi-value" style={{color:quarantine.length>0?'var(--warn)':'var(--ok)'}}>{quarantine.length}</div>
          <div className="kpi-foot"><span>plików izolowanych</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SYGNATURY</div>
          <div className="kpi-value" style={{fontSize:18}}>{sigCount>0?sigCount.toLocaleString('pl-PL'):'—'}</div>
          <div className="kpi-foot"><span>{status.freshclam?'freshclam OK':'freshclam stopped'}</span></div>
        </div>
      </div>

      <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr',gap:'var(--gutter)'}}>
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">{activeScan?'Trwające skanowanie':'Status skanera'}</div><div className="card-sub">{activeScan?activeScan.target:'brak aktywnych skanów'}</div></div>
            <div className="card-actions">
              {activeScan?<button className="btn sm danger" onClick={async()=>{await clamAPI.post('scan/'+activeScan.id+'?action=stop',{});toast.ok('Skan zatrzymany');}}><Icon name="stop" size={11}/> Zatrzymaj</button>
               :<button className="btn sm primary" onClick={onNewScan}><Icon name="play" size={12}/> Nowy skan</button>}
            </div>
          </div>
          <div className="card-body col" style={{gap:14}}>
            {activeScan?(
              <>
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                    <span className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{activeScan.files}</span>
                    <span className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--accent)'}}>{activeScan.state==='running'?activeScan.rate:activeScan.state}</span>
                  </div>
                  <div style={{height:6,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',background:'var(--accent)',width:activeScan.state==='running'?'100%':'100%',transition:'width .3s',animation:activeScan.state==='running'?'progress-indeterminate 1.5s infinite':'none'}}/>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,fontSize:'var(--fs-xs)'}}>
                  <div><div style={{color:'var(--fg-dim)',fontSize:10,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:3}}>Zagrożenia</div><div className="mono" style={{fontSize:16,color:activeScan.threats>0?'var(--err)':'var(--ok)'}}>{activeScan.threats}</div></div>
                  <div><div style={{color:'var(--fg-dim)',fontSize:10,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:3}}>Tempo</div><div className="mono" style={{fontSize:16}}>{activeScan.rate}</div></div>
                  <div><div style={{color:'var(--fg-dim)',fontSize:10,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:3}}>Start</div><div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{activeScan.started}</div></div>
                </div>
              </>
            ):(
              <div style={{padding:'24px 0',textAlign:'center',color:'var(--fg-dim)'}}>
                <Icon name="shield" size={28}/>
                <div style={{marginTop:8,fontSize:'var(--fs-sm)'}}>System bezczynny · <button className="btn sm primary" onClick={onNewScan}>Uruchom skan</button></div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><div className="card-title">Silnik ClamAV</div></div><span className={"badge "+(status.daemon?'ok':'err')}>{status.daemon?'OK':'DOWN'}</span></div>
          <div className="card-body col" style={{gap:6,fontSize:'var(--fs-sm)'}}>
            {[['Wersja',status.version||'—'],['freshclam',status.freshclam?'running':'stopped'],['Bazy',`${(status.signatures||[]).length} plików`],['Kwarantanna','/var/lib/clamav/quarantine'],['Pamięć clamd',status.mem_mb||'—']].map(([k,v])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--line)'}}>
                <span style={{color:'var(--fg-dim)'}}>{k}</span>
                <span className="mono" style={{fontSize:'var(--fs-xs)'}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Aktualizacje bazy (30 dni)</div><div className="card-sub">freshclam · {status.freshclam_interval||'codziennie'}</div></div></div>
          <div className="card-body">
            <div style={{display:'grid',gridTemplateColumns:'repeat(30,1fr)',gap:3,marginBottom:8}}>
              {fresh30d.map((v,i)=><div key={i} style={{aspectRatio:'1',borderRadius:2,background:v===1?'color-mix(in oklch,var(--ok) 55%,var(--bg-2))':v===2?'color-mix(in oklch,var(--err) 65%,var(--bg-2))':'var(--bg-2)',border:'1px solid var(--line)'}}/>)}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:9,fontFamily:'var(--font-mono)',color:'var(--fg-dim)'}}><span>-30d</span><span>dziś</span></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Ostatnie skanowania</div></div></div>
          <table className="table">
            <thead><tr><th>Data</th><th>Cel</th><th>Pliki</th><th>Wynik</th></tr></thead>
            <tbody>
              {history.slice(0,6).map((h,i)=>(
                <tr key={i}>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{h.date}</td>
                  <td className="mono" style={{fontSize:'var(--fs-xs)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.target||'—'}</td>
                  <td className="mono dim">{h.files||'—'}</td>
                  <td>{h.threats>0?<span className="badge err">{h.threats} zagroż.</span>:<span className="badge ok">clean</span>}</td>
                </tr>
              ))}
              {history.length===0&&<tr><td colSpan={4} style={{textAlign:'center',padding:16,color:'var(--fg-dim)'}}>Brak historii</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`@keyframes progress-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>
    </div>
  );
};

// ── Scans ─────────────────────────────────────────────────────────────────────
const ClamScans = ({scans,setScans,history}) => {
  const [showNew,setShowNew] = useCS(false);

  const startScan = async (form) => {
    toast.load('Uruchamianie skanu…');
    const d = await clamAPI.post('scan',form);
    if(d.scan) { setScans(s=>[...s,d.scan]); toast.ok('Skan uruchomiony: '+form.target); }
    else toast.err('Błąd uruchamiania skanu');
  };

  const act = async (id,action) => {
    await clamAPI.post('scan/'+id+'?action='+action,{});
    if(action==='stop') { setScans(s=>s.filter(x=>x.id!==id)); toast.ok('Skan zatrzymany'); }
    else setScans(s=>s.map(x=>x.id===id?(action==='pause'?{...x,state:'paused'}:{...x,state:'running'}):x));
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {showNew&&<NewScanDialog onClose={()=>setShowNew(false)} onStart={startScan}/>}
      <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <span style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>{scans.filter(s=>s.state==='running').length} aktywnych</span>
        <div className="row gap-sm">
          <button className="btn sm" onClick={()=>clamAPI.get('scan').then(d=>setScans(d.scans||[]))}><Icon name="refresh" size={11}/></button>
          <button className="btn sm primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={11}/> Nowy skan</button>
        </div>
      </div>
      <div className="grid grid-2">
        {scans.map(s=>(
          <div key={s.id} className="card">
            <div className="card-head">
              <div><div className="card-title mono" style={{fontSize:13}}>{s.target}</div><div className="card-sub">{s.mode}</div></div>
              <ScanBadge s={s.state}/>
            </div>
            <div className="card-body col" style={{gap:10}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-xs)'}}>
                <span className="mono">{s.files}</span>
                <span className="mono dim">{s.rate}</span>
              </div>
              <div style={{height:5,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',background:s.threats>0?'var(--err)':s.state==='paused'?'var(--warn)':'var(--accent)',
                  animation:s.state==='running'?'progress-indeterminate 1.5s infinite':'none',
                  width:s.state==='completed'||s.state==='threat'?'100%':'60%'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-xs)'}}>
                <span style={{color:s.threats>0?'var(--err)':'var(--ok)'}}>zagroż: {s.threats}</span>
                <span className="mono dim">{s.started}</span>
              </div>
              <div className="row gap-sm" style={{borderTop:'1px solid var(--line)',paddingTop:8}}>
                {s.state==='running'&&<button className="btn sm" onClick={()=>act(s.id,'pause')}><Icon name="pause" size={11}/> Wstrzymaj</button>}
                {s.state==='paused'&&<button className="btn sm" onClick={()=>act(s.id,'resume')}><Icon name="play" size={11}/> Wznów</button>}
                <button className="btn sm danger" onClick={()=>act(s.id,'stop')}><Icon name="stop" size={11}/> Zatrzymaj</button>
              </div>
            </div>
          </div>
        ))}
        {scans.length===0&&<div style={{gridColumn:'1/-1',textAlign:'center',padding:40,color:'var(--fg-dim)'}}>Brak aktywnych skanowań</div>}
      </div>
      <div className="card">
        <div className="card-head"><div><div className="card-title">Historia</div></div></div>
        <table className="table">
          <thead><tr><th>Data</th><th>Cel</th><th>Czas</th><th>Pliki</th><th>Wynik</th></tr></thead>
          <tbody>
            {history.map((h,i)=>(
              <tr key={i}>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{h.date}</td>
                <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{h.target||'—'}</td>
                <td className="mono dim">{h.duration||'—'}</td>
                <td className="mono dim">{h.files||'—'}</td>
                <td>{h.threats>0?<span className="badge err">{h.threats} zagroż.</span>:<span className="badge ok">clean</span>}</td>
              </tr>
            ))}
            {history.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:16,color:'var(--fg-dim)'}}>Brak historii</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Quarantine ────────────────────────────────────────────────────────────────
const ClamQuarantine = ({quarantine,setQuarantine}) => {
  const [sel,setSel] = useCS(new Set());
  const toggle = id => setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const allSel = quarantine.length>0&&sel.size===quarantine.length;

  const remove = async (ids,action='delete') => {
    await clamAPI.del('quarantine',{ids,action});
    setQuarantine(qs=>qs.filter(q=>!ids.includes(q.id)));
    setSel(new Set());
    toast.ok(action==='restore'?'Przywrócono pliki':'Usunięto z kwarantanny');
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-3">
        <div className="kpi"><div className="kpi-label">PLIKI</div><div className="kpi-value" style={{color:quarantine.length>0?'var(--warn)':'var(--ok)'}}>{quarantine.length}</div><div className="kpi-foot"><span>w kwarantannie</span></div></div>
        <div className="kpi"><div className="kpi-label">KRYTYCZNE</div><div className="kpi-value" style={{color:'var(--err)'}}>{quarantine.filter(q=>q.sev==='err').length}</div><div className="kpi-foot"><span>wirusy / malware</span></div></div>
        <div className="kpi"><div className="kpi-label">PUA</div><div className="kpi-value" style={{color:'var(--warn)'}}>{quarantine.filter(q=>q.sev==='warn').length}</div><div className="kpi-foot"><span>potencjalnie niechciane</span></div></div>
      </div>

      {sel.size>0&&(
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'color-mix(in oklch,var(--accent) 8%,transparent)',border:'1px solid color-mix(in oklch,var(--accent) 30%,transparent)',borderRadius:8,fontSize:'var(--fs-sm)'}}>
          <span>{sel.size} wybranych</span>
          <div className="row gap-sm" style={{marginLeft:'auto'}}>
            <button className="btn sm" onClick={()=>remove([...sel],'restore')}>Przywróć</button>
            <button className="btn sm" onClick={async()=>{for(const id of sel){const q=quarantine.find(x=>x.id===id);if(q){const d=await clamAPI.post('virustotal',{file:q.file});window.open(d.url,'_blank');}}}}>VirusTotal</button>
            <button className="btn sm danger" onClick={()=>remove([...sel])}><Icon name="trash" size={11}/> Usuń</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Kwarantanna</div><div className="card-sub">/var/lib/clamav/quarantine</div></div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>clamAPI.get('quarantine').then(d=>setQuarantine(d.files||[]))}><Icon name="refresh" size={11}/></button>
            {quarantine.length>0&&<button className="btn sm danger" onClick={()=>remove(quarantine.map(q=>q.id))}>Wyczyść wszystko</button>}
          </div>
        </div>
        <table className="table">
          <thead><tr>
            <th style={{width:28}}><input type="checkbox" checked={allSel} onChange={()=>setSel(allSel?new Set():new Set(quarantine.map(q=>q.id)))}/></th>
            <th>Plik</th><th>Zagrożenie</th><th>Rozmiar</th><th>Dodano</th><th></th>
          </tr></thead>
          <tbody>
            {quarantine.map(q=>(
              <tr key={q.id}>
                <td><input type="checkbox" checked={sel.has(q.id)} onChange={()=>toggle(q.id)}/></td>
                <td className="mono" style={{fontSize:'var(--fs-xs)',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{q.file}</td>
                <td className="mono" style={{fontSize:'var(--fs-xs)',color:q.sev==='err'?'var(--err)':'var(--warn)'}}>{q.threat}</td>
                <td className="mono">{q.size}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{q.added}</td>
                <td><div className="row gap-sm">
                  <button className="btn sm ghost" onClick={async()=>{const d=await clamAPI.post('virustotal',{file:q.file});window.open(d.url,'_blank');}}>VT</button>
                  <button className="btn sm" onClick={()=>remove([q.id],'restore')}>Przywróć</button>
                  <button className="icon-btn" onClick={()=>remove([q.id])}><Icon name="trash" size={13}/></button>
                </div></td>
              </tr>
            ))}
            {quarantine.length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:32,color:'var(--fg-dim)'}}>
              <Icon name="shield" size={22} style={{color:'var(--ok)'}}/><div style={{marginTop:6}}>Kwarantanna pusta</div>
            </td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Signatures ────────────────────────────────────────────────────────────────
const ClamSignatures = ({signatures,status,onRefresh}) => {
  const [busy,setBusy] = useCS(false);
  const update = async () => {
    setBusy(true);
    toast.load('Aktualizacja sygnatur…');
    await clamAPI.post('freshclam',{});
    setTimeout(()=>{setBusy(false);onRefresh();toast.ok('Sygnatury zaktualizowane');},6000);
  };
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Bazy sygnatur</div><div className="card-sub">freshclam · {status.freshclam_interval||'—'}</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={update} disabled={busy}><Icon name="download" size={11}/> {busy?'Aktualizacja…':'Sprawdź teraz'}</button>
          </div>
        </div>
        <table className="table">
          <thead><tr><th>Baza</th><th>Wersja</th><th>Sygnatury</th><th>Data</th><th>Rozmiar</th><th>Status</th></tr></thead>
          <tbody>
            {signatures.map((s,i)=>(
              <tr key={i}>
                <td className="mono" style={{fontWeight:600}}>{s.name}</td>
                <td className="mono dim">{s.ver||'—'}</td>
                <td className="mono">{s.sigs||'—'}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{s.date}</td>
                <td className="mono">{s.size}</td>
                <td><span className="badge ok">OK</span></td>
              </tr>
            ))}
            {signatures.length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:20,color:'var(--fg-dim)'}}>Ładowanie…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Schedule ──────────────────────────────────────────────────────────────────
const ClamSchedule = ({schedules,setSchedules}) => {
  const [dialog,setDialog] = useCS(null);

  const save = async (form) => {
    const d = await clamAPI.post('schedules',form);
    if(d.status==='ok') {
      const updated = await clamAPI.get('schedules');
      setSchedules(updated.schedules||[]);
      toast.ok(form.id?'Zadanie zaktualizowane':'Zadanie dodane');
    } else toast.err('Błąd zapisu');
  };
  const toggle = async (id) => {
    const item = schedules.find(x=>x.id===id);
    if(!item) return;
    await clamAPI.post('schedules',{...item,on:!item.on});
    setSchedules(l=>l.map(x=>x.id===id?{...x,on:!x.on}:x));
  };
  const del = async (id) => {
    await clamAPI.del('schedules',{id});
    setSchedules(l=>l.filter(x=>x.id!==id));
    toast.ok('Zadanie usunięte');
  };
  const runNow = async (target) => {
    await clamAPI.post('scan',{target,recursive:true});
    toast.ok('Skan uruchomiony: '+target);
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {dialog!==null&&<ScheduleDialog sch={dialog||undefined} onClose={()=>setDialog(null)} onSave={save}/>}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Harmonogram skanów</div><div className="card-sub">cron · automatyczne skanowanie</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>setDialog({})}><Icon name="plus" size={11}/> Nowe zadanie</button>
          </div>
        </div>
        <table className="table">
          <thead><tr><th style={{width:40}}></th><th>Nazwa</th><th>Cel</th><th>Częstotliwość</th><th>Następne</th><th>Ostatnie</th><th></th></tr></thead>
          <tbody>
            {schedules.map(s=>(
              <tr key={s.id} style={{opacity:s.on?1:0.55}}>
                <td><div className={"toggle "+(s.on?'on':'')} onClick={()=>toggle(s.id)}/></td>
                <td style={{fontWeight:500}}>{s.name||'—'}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{s.target}</td>
                <td className="mono">{s.when||s.cron||'—'}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{s.next||'—'}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{s.last||'—'}</td>
                <td><div className="row gap-sm">
                  <button className="btn sm" onClick={()=>setDialog(s)}>Edytuj</button>
                  <button className="btn sm ghost" onClick={()=>runNow(s.target)}><Icon name="play" size={11}/></button>
                  <button className="icon-btn" onClick={()=>del(s.id)}><Icon name="trash" size={13}/></button>
                </div></td>
              </tr>
            ))}
            {schedules.length===0&&<tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'var(--fg-dim)'}}>Brak zaplanowanych zadań · <button className="btn sm primary" onClick={()=>setDialog({})}>Dodaj pierwsze</button></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── OnAccess ──────────────────────────────────────────────────────────────────
const ClamOnAccess = ({onAccess,onSave}) => {
  const [enabled,    setEnabled]    = useCS(false);
  const [prevention, setPrevention] = useCS(false);
  const [extra,      setExtra]      = useCS(true);
  const [maxSize,    setMaxSize]    = useCS('25M');
  const [paths,      setPaths]      = useCS([]);
  const [saving,     setSaving]     = useCS(false);

  useCE(()=>{
    setEnabled(onAccess.enabled||false);
    if(onAccess.paths&&onAccess.paths.length>0) setPaths(onAccess.paths);
  },[onAccess]);

  const save = async () => {
    setSaving(true);
    try {
      const d = await clamAPI.post('onaccess',{enabled,prevention,extra,max_size:maxSize,paths});
      if(d.status==='ok') { toast.ok('Konfiguracja OnAccess zapisana · clamd zrestartowany'); onSave(); }
      else toast.err('Błąd: '+(d.error||'nieznany'));
    } catch(e) { toast.err('Błąd połączenia'); }
    finally { setSaving(false); }
  };

  const restartClamd = async () => {
    toast.load('Restart clamd…');
    const d = await clamAPI.post('service',{service:'daemon',action:'restart'});
    toast.ok(d.results?.join(' · ')||'Restart OK');
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Ochrona w czasie rzeczywistym</div><div className="card-sub">fanotify · OnAccess · clamd.conf</div></div>
          <div className="card-actions">
            <button className="btn sm" onClick={restartClamd}><Icon name="refresh" size={11}/> Restart clamd</button>
            <button className="btn sm primary" onClick={save} disabled={saving}><Icon name="check" size={11}/> {saving?'Zapisywanie…':'Zapisz i zastosuj'}</button>
          </div>
        </div>
        <div className="card-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div className="col" style={{gap:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,border:'1px solid var(--line)'}}>
              <div>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Ochrona OnAccess</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>ScanOnAccess · fanotify</div>
              </div>
              <div className={"toggle "+(enabled?'on':'')} onClick={()=>setEnabled(!enabled)}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,border:'1px solid var(--line)'}}>
              <div>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Tryb prewencji</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>OnAccessPrevention — blokuj</div>
              </div>
              <div className={"toggle "+(prevention?'on':'')} onClick={()=>setPrevention(!prevention)}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,border:'1px solid var(--line)'}}>
              <div>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Extra scanning</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>OnAccessExtraScanning</div>
              </div>
              <div className={"toggle "+(extra?'on':'')} onClick={()=>setExtra(!extra)}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,border:'1px solid var(--line)'}}>
              <div>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Max rozmiar pliku</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>OnAccessMaxFileSize</div>
              </div>
              <input style={{...clamInput,width:90}} value={maxSize} onChange={e=>setMaxSize(e.target.value)}/>
            </div>
          </div>
          <div className="col" style={{gap:8}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <span style={{fontSize:'var(--fs-sm)',fontWeight:600}}>Monitorowane ścieżki</span>
              <button className="btn sm primary" onClick={()=>setPaths(p=>[...p,{p:'/',mode:'include'}])}><Icon name="plus" size={11}/> Dodaj</button>
            </div>
            {paths.map((p,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'110px 1fr 28px',gap:6,alignItems:'center'}}>
                <select style={clamInput} value={p.mode} onChange={e=>setPaths(a=>a.map((x,j)=>j===i?{...x,mode:e.target.value}:x))}>
                  <option value="include">include</option>
                  <option value="exclude">exclude</option>
                </select>
                <input style={clamInput} value={p.p} onChange={e=>setPaths(a=>a.map((x,j)=>j===i?{...x,p:e.target.value}:x))}/>
                <button className="icon-btn" onClick={()=>setPaths(a=>a.filter((_,j)=>j!==i))}><Icon name="trash" size={12}/></button>
              </div>
            ))}
            {paths.length===0&&<div style={{textAlign:'center',padding:'16px',color:'var(--fg-dim)',fontSize:'var(--fs-xs)',background:'var(--bg-2)',borderRadius:6,border:'1px dashed var(--line-strong)'}}>Brak ścieżek — kliknij Dodaj</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Logs ──────────────────────────────────────────────────────────────────────
const ClamLogs = ({logs,onReload}) => {
  const [filter,setFilter] = useCS('');
  const [lvl,setLvl]       = useCS('all');
  const shown = logs.filter(l=>(lvl==='all'||l.lvl===lvl.toUpperCase())&&(!filter||l.msg.toLowerCase().includes(filter.toLowerCase())));
  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">Logi ClamAV</div><div className="card-sub">/var/log/clamav/*.log · journalctl</div></div>
        <div className="card-actions">
          <div className="segmented">{['all','ok','info','warn','error'].map(k=>(<button key={k} className={lvl===k?'active':''} onClick={()=>setLvl(k)}>{k}</button>))}</div>
          <button className="btn sm" onClick={onReload}><Icon name="refresh" size={11}/></button>
        </div>
      </div>
      <div className="card-body">
        <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center'}}>
          <Icon name="search" size={13} style={{color:'var(--fg-dim)'}}/>
          <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtruj logi…" style={{...clamInput,flex:1}}/>
        </div>
        <div style={{background:'var(--bg)',borderRadius:6,padding:'10px 12px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',lineHeight:1.9,maxHeight:460,overflowY:'auto'}}>
          {shown.map((l,i)=>{
            const color=l.lvl==='WARN'?'var(--warn)':l.lvl==='ERROR'||l.lvl==='ERR'?'var(--err)':l.lvl==='OK'?'var(--ok)':'var(--fg-muted)';
            return (<div key={i} style={{display:'grid',gridTemplateColumns:'90px 50px 1fr',gap:8}}>
              <span style={{color:'var(--fg-dim)'}}>{(l.t||'').slice(0,19)}</span>
              <span className="badge" style={{fontSize:9,background:`color-mix(in oklch,${color} 14%,transparent)`,color,border:`1px solid color-mix(in oklch,${color} 30%,transparent)`}}>{l.lvl}</span>
              <span style={{color}}>{l.msg}</span>
            </div>);
          })}
          {shown.length===0&&<div style={{textAlign:'center',padding:20,color:'var(--fg-dim)'}}>Brak logów</div>}
        </div>
      </div>
    </div>
  );
};

// ── Config — pola formularza zamiast surowego tekstu ─────────────────────────
const ClamConfig = ({config,onReload}) => {
  // Parsuj clamd.conf do struktury
  const parseConf = (text) => {
    const obj = {};
    (text||'').split('\n').forEach(line=>{
      const trimmed = line.trim();
      if(!trimmed||trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf(' ');
      if(idx>0) { obj[trimmed.slice(0,idx)] = trimmed.slice(idx+1).trim(); }
    });
    return obj;
  };

  const [cfg,setCfg]     = useCS({});
  const [fresh,setFresh] = useCS({});
  const [tab,setTab]     = useCS('clamd');
  const [saving,setSaving] = useCS(false);
  const [raw,setRaw]     = useCS(false);
  const [rawText,setRawText] = useCS({clamd:'',freshclam:''});

  useCE(()=>{
    if(config.clamd)     { setCfg(parseConf(config.clamd)); setRawText(r=>({...r,clamd:config.clamd})); }
    if(config.freshclam) { setFresh(parseConf(config.freshclam)); setRawText(r=>({...r,freshclam:config.freshclam})); }
  },[config]);

  const set = (k,v) => tab==='clamd' ? setCfg(c=>({...c,[k]:v})) : setFresh(c=>({...c,[k]:v}));
  const get = (k,def='') => (tab==='clamd'?cfg:fresh)[k]||def;

  // Zbuduj tekst konfiguracji z pól
  const buildConf = (original, overrides) => {
    const lines = (original||'').split('\n');
    const set = new Set();
    const result = lines.map(line => {
      const trimmed = line.trim();
      if(!trimmed||trimmed.startsWith('#')) return line;
      const idx = trimmed.indexOf(' ');
      if(idx<0) return line;
      const key = trimmed.slice(0,idx);
      if(overrides[key]!==undefined) { set.add(key); return `${key} ${overrides[key]}`; }
      return line;
    });
    Object.entries(overrides).forEach(([k,v])=>{ if(!set.has(k)&&v) result.push(`${k} ${v}`); });
    return result.join('\n');
  };

  const save = async (restart=false) => {
    setSaving(true);
    try {
      const clamdText  = raw ? rawText.clamd  : buildConf(config.clamd, cfg);
      const freshText  = raw ? rawText.freshclam : buildConf(config.freshclam, fresh);
      const d = await clamAPI.post('config',{clamd:clamdText,freshclam:freshText,restart:restart?'true':'false'});
      if(d.status==='ok') {
        toast.ok('Konfiguracja zapisana'+(restart?' · restart clamd zaplanowany':''));
        setTimeout(onReload,restart?3000:0);
      } else toast.err('Błąd: '+(d.output||'sprawdź logi'));
    } catch(e) { toast.err('Błąd połączenia'); }
    finally { setSaving(false); }
  };

  const testSyntax = async () => {
    toast.load('Sprawdzanie składni…');
    const d = await clamAPI.post('config',{clamd:rawText.clamd,action:'test'});
    if(d.status==='ok') toast.ok('Składnia OK'); else toast.err('Błąd składni: '+d.output);
  };

  const CLAMD_FIELDS = [
    ['LogFile','/var/log/clamav/clamav.log','Plik logów'],
    ['LogFileMaxSize','100M','Max rozmiar logu'],
    ['LogTime','yes','Znacznik czasu w logach'],
    ['DatabaseDirectory','/var/lib/clamav','Katalog baz sygnatur'],
    ['LocalSocket','/run/clamav/clamd.ctl','Socket UNIX'],
    ['User','clamav','Użytkownik procesu'],
    ['MaxFileSize','100M','Max rozmiar skanowanego pliku'],
    ['MaxRecursion','10','Max głębokość rekurencji'],
    ['MaxFiles','15000','Max liczba plików w archiwum'],
    ['ScanArchive','yes','Skanuj archiwa'],
    ['ScanMail','yes','Skanuj wiadomości e-mail'],
    ['ScanPDF','yes','Skanuj pliki PDF'],
    ['ScanELF','yes','Skanuj pliki ELF'],
    ['DetectPUA','no','Wykrywaj PUA'],
    ['ExcludePath','^/proc/','Wyklucz ścieżki (regex)'],
    ['StreamMaxLength','100M','Max długość strumienia'],
  ];
  const FRESH_FIELDS = [
    ['UpdateLogFile','/var/log/clamav/freshclam.log','Plik logów freshclam'],
    ['DatabaseDirectory','/var/lib/clamav','Katalog baz'],
    ['DatabaseMirror','database.clamav.net','Serwer lustrzany'],
    ['Checks','24','Sprawdzenia na dobę'],
    ['ConnectTimeout','30','Timeout połączenia (s)'],
    ['HTTPProxyServer','','Proxy HTTP (opcjonalne)'],
    ['HTTPProxyPort','','Port proxy'],
    ['CompressLocalDatabase','no','Kompresja lokalnej bazy'],
    ['NotifyClamd','/etc/clamav/clamd.conf','Powiadom clamd po aktualizacji'],
  ];

  const fields = tab==='clamd' ? CLAMD_FIELDS : FRESH_FIELDS;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Konfiguracja ClamAV</div><div className="card-sub">{tab==='clamd'?'/etc/clamav/clamd.conf':'/etc/clamav/freshclam.conf'}</div></div>
          <div className="card-actions">
            <div className="segmented">
              <button className={tab==='clamd'?'active':''} onClick={()=>setTab('clamd')}>clamd.conf</button>
              <button className={tab==='fresh'?'active':''} onClick={()=>setTab('fresh')}>freshclam.conf</button>
            </div>
            <button className="btn sm" onClick={()=>setRaw(!raw)}>{raw?'Formularz':'Raw'}</button>
            <button className="btn sm" onClick={testSyntax}>Test składni</button>
            <button className="btn sm" onClick={()=>save(false)} disabled={saving}>Zapisz</button>
            <button className="btn sm primary" onClick={()=>save(true)} disabled={saving}><Icon name="check" size={11}/> Zapisz i restart</button>
          </div>
        </div>
        <div className="card-body">
          {raw ? (
            <textarea value={tab==='clamd'?rawText.clamd:rawText.freshclam}
              onChange={e=>setRawText(r=>({...r,[tab==='clamd'?'clamd':'freshclam']:e.target.value}))}
              style={{...clamInput,height:480,resize:'vertical',lineHeight:1.7,fontSize:11,whiteSpace:'pre'}}/>
          ) : (
            <div className="col" style={{gap:0}}>
              {fields.map(([key,def,label])=>(
                <div key={key} style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:16,padding:'10px 0',borderBottom:'1px solid var(--line)',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{label}</div>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{key}</div>
                  </div>
                  {(get(key,def)==='yes'||get(key,def)==='no') ? (
                    <div style={{display:'flex',gap:8}}>
                      {['yes','no'].map(v=>(
                        <button key={v} onClick={()=>set(key,v)} style={{padding:'5px 16px',borderRadius:5,border:'1px solid',cursor:'pointer',fontSize:'var(--fs-sm)',
                          borderColor:get(key,def)===v?'var(--accent)':'var(--line-strong)',
                          background:get(key,def)===v?'color-mix(in oklch,var(--accent) 12%,var(--bg-2))':'var(--bg-2)',
                          color:get(key,def)===v?'var(--accent)':'var(--fg)'}}>
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input style={clamInput} value={get(key,def)} onChange={e=>set(key,e.target.value)} placeholder={def}/>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Usługi systemd</div></div></div>
          <table className="table">
            <thead><tr><th>Unit</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {[['clamav-daemon.service','daemon'],['clamav-freshclam.service','freshclam'],['clamav-clamonacc.service','onaccess']].map(([name,key])=>(
                <tr key={name}>
                  <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{name}</td>
                  <td><span className="badge ok"><span className="dot pulse"/>aktywny</span></td>
                  <td><div className="row gap-sm">
                    <button className="btn sm" onClick={async()=>{toast.load('Restart '+name+'…');const d=await clamAPI.post('service',{service:key,action:'restart'});toast.ok(d.results?.join(' · ')||'OK');}}>restart</button>
                    <button className="btn sm" onClick={async()=>{const d=await clamAPI.post('service',{service:key,action:'stop'});toast.ok(d.results?.join(' · ')||'OK');}}>stop</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Integracje</div></div></div>
          <div className="card-body col" style={{gap:8,fontSize:'var(--fs-sm)'}}>
            {[['Samba VFS (vfs_virusfilter)','SMB skanowanie na upload',true],['Postfix milter','SMTP skanowanie',true],['Dovecot Sieve','IMAP filtr',false],['rspamd → clamd','spam scoring',true]].map(([name,desc,on],i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg-2)',padding:'10px 12px',borderRadius:6,border:'1px solid var(--line)'}}>
                <div><div style={{fontWeight:500}}>{name}</div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{desc}</div></div>
                <div className={"toggle "+(on?'on':'')}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Root ──────────────────────────────────────────────────────────────────────
const ClamAV = () => {
  const [tab,setTab]           = useCS('overview');
  const [status,setStatus]     = useCS({daemon:false,freshclam:false,signatures:[],on_access:{enabled:false,paths:[]}});
  const [scans,setScans]       = useCS([]);
  const [quarantine,setQuar]   = useCS([]);
  const [history,setHistory]   = useCS([]);
  const [fresh30d,setFresh30d] = useCS(Array(30).fill(1));
  const [schedules,setSched]   = useCS([]);
  const [logs,setLogs]         = useCS([]);
  const [config,setConfig]     = useCS({clamd:'',freshclam:''});
  const [loading,setLoading]   = useCS(true);

  const loadAll = async () => {
    const [st,h,q,sch,lg,cfg,fr] = await Promise.allSettled([
      clamAPI.get('status'),
      clamAPI.get('history'),
      clamAPI.get('quarantine'),
      clamAPI.get('schedules'),
      clamAPI.get('logs?n=100'),
      clamAPI.get('config'),
      clamAPI.get('freshclam'),
    ]);
    if(st.value)             { setStatus(st.value); setScans(st.value.active_scans||[]); }
    if(h.value?.history)     setHistory(h.value.history);
    if(q.value?.files)       setQuar(q.value.files||[]);
    if(sch.value?.schedules) setSched(sch.value.schedules||[]);
    if(lg.value?.logs)       setLogs(lg.value.logs||[]);
    if(cfg.value)            setConfig(cfg.value);
    if(fr.value?.history30d) setFresh30d(fr.value.history30d);
    setLoading(false);
  };

  const reloadStatus = async () => {
    const d = await clamAPI.get('status');
    setStatus(d);
    const api = d.active_scans||[];
    if(api.length>0) setScans(api);
    else setScans(prev=>prev.filter(s=>s.state==='running'||s.state==='paused'));
  };

  useCE(()=>{ loadAll(); const id=setInterval(reloadStatus,8000); return()=>clearInterval(id); },[]);

  const TABS = [
    {id:'overview',   label:'Przegląd'},
    {id:'scans',      label:'Skanowanie'},
    {id:'quarantine', label:'Kwarantanna · '+quarantine.length},
    {id:'sigs',       label:'Definicje'},
    {id:'schedule',   label:'Harmonogram'},
    {id:'onaccess',   label:'Ochrona real-time'},
    {id:'logs',       label:'Logi'},
    {id:'config',     label:'Konfiguracja'},
  ];

  if(loading) return(
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .6s linear infinite',margin:'0 auto 12px'}}/>
      Łączenie z ClamAV…
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="segmented" style={{flexWrap:'wrap'}}>
        {TABS.map(t=><button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab==='overview'   && <ClamOverview status={status} scans={scans} quarantine={quarantine} history={history} fresh30d={fresh30d} onNewScan={()=>setTab('scans')}/>}
      {tab==='scans'      && <ClamScans scans={scans} setScans={setScans} history={history}/>}
      {tab==='quarantine' && <ClamQuarantine quarantine={quarantine} setQuarantine={setQuar}/>}
      {tab==='sigs'       && <ClamSignatures signatures={status.signatures||[]} status={status} onRefresh={reloadStatus}/>}
      {tab==='schedule'   && <ClamSchedule schedules={schedules} setSchedules={setSched}/>}
      {tab==='onaccess'   && <ClamOnAccess onAccess={status.on_access||{}} onSave={reloadStatus}/>}
      {tab==='logs'       && <ClamLogs logs={logs} onReload={()=>clamAPI.get('logs?n=100').then(d=>setLogs(d.logs||[]))}/>}
      {tab==='config'     && <ClamConfig config={config} onReload={loadAll}/>}
    </div>
  );
};

window.ClamAV = ClamAV;
