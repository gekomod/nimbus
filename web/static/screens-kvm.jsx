// ===== Wirtualizacja KVM/QEMU =====

// KVM API helpers
const kvmApi = {
  list:      ()         => fetch('/api/kvm/vms',       {credentials:'include'}).then(r=>r.json()),
  status:    ()         => fetch('/api/kvm/status',    {credentials:'include'}).then(r=>r.json()),
  action:    (vm, act)  => fetch('/api/kvm/action',    {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({vm,action:act})}),
  create:    (data)     => fetch('/api/kvm/create',    {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),
  snapList:  (vm)       => fetch('/api/kvm/snapshots?vm='+encodeURIComponent(vm), {credentials:'include'}).then(r=>r.json()),
  snapCreate:(vm,name,desc) => fetch('/api/kvm/snapshots?vm='+encodeURIComponent(vm), {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,desc})}),
  snapDelete:(vm,snap)  => fetch('/api/kvm/snapshots?vm='+encodeURIComponent(vm)+'&snap='+encodeURIComponent(snap), {method:'DELETE',credentials:'include'}),
  isos:      ()         => fetch('/api/kvm/isos',      {credentials:'include'}).then(r=>r.json()),
  networks:  ()         => fetch('/api/kvm/networks',  {credentials:'include'}).then(r=>r.json()),
  config:    ()         => fetch('/api/kvm/config',    {credentials:'include'}).then(r=>r.json()),
  saveConfig:(cfg)      => fetch('/api/kvm/config',    {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)}),
  vncProxy:     (vm)    => fetch('/api/kvm/vnc-proxy', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({vm})}).then(r=>r.json()),
  vncConfig:    (vm)    => fetch('/api/kvm/vnc-config?vm='+encodeURIComponent(vm), {credentials:'include'}).then(r=>r.json()),
  vncSetConfig: (body)  => fetch('/api/kvm/vnc-config', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()),
  delete:    (vm, removeDisks) => fetch('/api/kvm/delete', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({vm,remove_disks:removeDisks})}),
  isoDownload: (url, filename) => fetch('/api/kvm/iso-download', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,filename})}),
  isoDownloads: ()       => fetch('/api/kvm/iso-download', {credentials:'include'}).then(r=>r.json()),
  isoDeleteDownload: (id) => fetch('/api/kvm/iso-download?id='+id, {method:'DELETE',credentials:'include'}),
  install:   ()         => fetch('/api/kvm/install',   {method:'POST',credentials:'include'}),
  templates: ()         => fetch('/api/kvm/templates', {credentials:'include'}).then(r=>r.json()),
	templateSave: (data,edit=false) => fetch('/api/kvm/templates',{method:edit?'PUT':'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Błąd zapisu');return d}),
	templateDelete: id => fetch('/api/kvm/templates?id='+encodeURIComponent(id),{method:'DELETE',credentials:'include'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Błąd usuwania');return d}),
  templateDeploy: data  => fetch('/api/kvm/template-deploy', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Błąd wdrażania');return d}),
  templateJobs: ()      => fetch('/api/kvm/template-jobs', {credentials:'include'}).then(r=>r.json()),
};

const KVMModal = window.Modal;

const KVMTemplatesPanel = ({ onReady }) => {
  const [templates,setTemplates]=React.useState([]), [jobs,setJobs]=React.useState([]);
  const [networks,setNetworks]=React.useState([]);
  const [chosen,setChosen]=React.useState(null), [error,setError]=React.useState('');
	const [editor,setEditor]=React.useState(null), [editorError,setEditorError]=React.useState('');
  const [form,setForm]=React.useState({name:'',network:'default',cpu:2,ram:2048,disk:20,sshKey:''});
	const loadTemplates=()=>kvmApi.templates().then(d=>setTemplates(d.templates||[])).catch(()=>{});
  const loadJobs=()=>kvmApi.templateJobs().then(d=>setJobs(d.jobs||[])).catch(()=>{});
	React.useEffect(()=>{loadTemplates();kvmApi.networks().then(d=>setNetworks(d.networks||[])).catch(()=>{});loadJobs();const t=setInterval(loadJobs,1800);return()=>clearInterval(t)},[]);
  React.useEffect(()=>{if(jobs.some(j=>j.status==='done'))onReady&&onReady()},[jobs.map(j=>j.status).join(',')]);
  const select=t=>{setChosen(t);setForm(f=>({...f,name:t.id+'-01',cpu:t.min_cpu,ram:t.min_ram,disk:t.min_disk}))};
  const deploy=async()=>{setError('');try{await kvmApi.templateDeploy({template:chosen.id,...form});setChosen(null);loadJobs()}catch(e){setError(e.message)}};
	const fieldStyle={width:'100%',marginTop:6,background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:7,padding:'9px 11px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'};
	const labelStyle={display:'block',fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--fg-muted)'};
	const emptyTemplate={id:'',name:'',version:'',family:'linux',icon:'💿',description:'',url:'',format:'qcow2',min_cpu:1,min_ram:1024,min_disk:10};
	const saveTemplate=async()=>{setEditorError('');try{await kvmApi.templateSave(editor,!!editor.custom);setEditor(null);loadTemplates()}catch(e){setEditorError(e.message)}};
	const deleteTemplate=async t=>{if(!confirm(`Usunąć szablon ${t.name}?`))return;try{await kvmApi.templateDelete(t.id);loadTemplates()}catch(e){alert(e.message)}};
  return <div className="col" style={{gap:'var(--gutter)'}}>
	<div className="card" style={{padding:18,display:'flex',justifyContent:'space-between',alignItems:'center',gap:16}}><div><div className="card-title">Gotowe systemy</div><div className="card-sub">Obrazy QCOW2 oraz QCOW2 spakowane w ZIP · konfiguracja w /etc/nimbus/kvm-templates.json</div></div><button className="btn primary" onClick={()=>setEditor({...emptyTemplate})}>＋ Dodaj system</button></div>
	<div className="grid grid-3">{templates.map(t=><div key={t.id} className="card" onClick={()=>select(t)} style={{padding:18,textAlign:'left',cursor:'pointer',border:chosen?.id===t.id?'1px solid var(--accent)':undefined,position:'relative'}}>
      <div className="row" style={{justifyContent:'space-between'}}><span style={{fontSize:28}}>{t.icon}</span><div className="row" style={{gap:5}}>{t.format==='qcow2.zip'&&<span className="badge warn">ZIP</span>}<span className="badge">{t.version}</span></div></div>
      <div style={{fontWeight:700,marginTop:12}}>{t.name}</div><div className="card-sub" style={{marginTop:5,minHeight:34}}>{t.description}</div>
      <div className="mono dim" style={{fontSize:'var(--fs-xs)',marginTop:12}}>{t.min_cpu} vCPU · {Math.round(t.min_ram/1024*10)/10} GB RAM · {t.min_disk} GB</div>
	  {t.custom&&<div className="row" style={{gap:5,marginTop:12}}><button className="btn sm" onClick={e=>{e.stopPropagation();setEditor({...t})}}>Edytuj</button><button className="btn sm danger" onClick={e=>{e.stopPropagation();deleteTemplate(t)}}>Usuń</button></div>}
	</div>)}</div>
	{editor&&<KVMModal title={editor.custom?'Edytuj własny system':'Dodaj własny system'} sub="Szablon zostanie zapisany w /etc/nimbus/kvm-templates.json" onClose={()=>{setEditor(null);setEditorError('')}} width={700} footer={<><button className="btn" onClick={()=>setEditor(null)}>Anuluj</button><button className="btn primary" onClick={saveTemplate}>Zapisz system</button></>}>
	  <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:14}}>
	    {[['ID systemu','id','ubuntu-custom'],['Nazwa','name','Ubuntu Custom'],['Wersja','version','24.04'],['Rodzina','family','ubuntu'],['Ikona','icon','💿']].map(([l,k,p])=><label key={k} style={labelStyle}>{l}<input style={fieldStyle} disabled={editor.custom&&k==='id'} value={editor[k]||''} placeholder={p} onChange={e=>setEditor({...editor,[k]:e.target.value})}/></label>)}
	    <label style={labelStyle}>Format obrazu<select style={fieldStyle} value={editor.format||'qcow2'} onChange={e=>setEditor({...editor,format:e.target.value})}><option value="qcow2">QCOW2</option><option value="qcow2.zip">QCOW2 w archiwum ZIP</option></select></label>
	    <label style={{...labelStyle,gridColumn:'1/-1'}}>Opis<input style={fieldStyle} value={editor.description||''} onChange={e=>setEditor({...editor,description:e.target.value})}/></label>
	    <label style={{...labelStyle,gridColumn:'1/-1'}}>Adres obrazu<input style={fieldStyle} value={editor.url||''} placeholder={editor.format==='qcow2.zip'?'https://serwer/system.qcow2.zip':'https://serwer/system.qcow2'} onChange={e=>setEditor({...editor,url:e.target.value})}/><span className="dim" style={{display:'block',marginTop:5,fontWeight:400}}>Nimbus pobierze plik, a dla ZIP automatycznie znajdzie i rozpakuje obraz .qcow2.</span></label>
	    {[['Minimalne vCPU','min_cpu',1],['Minimalny RAM (MB)','min_ram',256],['Minimalny dysk (GB)','min_disk',1]].map(([l,k,min])=><label key={k} style={labelStyle}>{l}<input style={fieldStyle} type="number" min={min} value={editor[k]} onChange={e=>setEditor({...editor,[k]:+e.target.value})}/></label>)}
	  </div>{editorError&&<div style={{color:'var(--err)',marginTop:12}}>{editorError}</div>}
	</KVMModal>}
	{chosen&&<KVMModal title={`Wdróż ${chosen.name} ${chosen.version}`} sub={chosen.format==='qcow2.zip'?'Archiwum zostanie pobrane, rozpakowane i sprawdzone. Gotowy QCOW2 pozostanie bazą kolejnych maszyn.':'Obraz zostanie pobrany raz i zachowany jako baza kolejnych maszyn.'} onClose={()=>{setChosen(null);setError('')}} width={680}
	  footer={<><button className="btn" onClick={()=>{setChosen(null);setError('')}}>Anuluj</button><button className="btn primary" onClick={deploy} disabled={!form.name||!form.network}>Pobierz i uruchom system</button></>}>
	  <div style={{display:'flex',gap:14,alignItems:'center',padding:'12px 14px',background:'color-mix(in oklch,var(--accent) 7%,var(--bg-2))',border:'1px solid color-mix(in oklch,var(--accent) 22%,var(--line))',borderRadius:9,marginBottom:18}}><span style={{fontSize:34}}>{chosen.icon}</span><div><div style={{fontWeight:700}}>{chosen.name} {chosen.version}</div><div className="card-sub" style={{marginTop:3}}>{chosen.description}</div></div></div>
	  <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:14}}>
	    <label style={labelStyle}>Nazwa maszyny<input style={fieldStyle} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
	    <label style={labelStyle}>Sieć<select style={fieldStyle} value={form.network} onChange={e=>setForm({...form,network:e.target.value})}>{(networks.length?networks:[{name:'default'}]).map(n=><option key={n.name||n} value={n.name||n}>{n.name||n}</option>)}</select></label>
	    <label style={labelStyle}>Procesory vCPU<input style={fieldStyle} type="number" min={chosen.min_cpu} value={form.cpu} onChange={e=>setForm({...form,cpu:+e.target.value})}/></label>
	    <label style={labelStyle}>Pamięć RAM (MB)<input style={fieldStyle} type="number" min={chosen.min_ram} step="512" value={form.ram} onChange={e=>setForm({...form,ram:+e.target.value})}/></label>
	    <label style={labelStyle}>Rozmiar dysku (GB)<input style={fieldStyle} type="number" min={chosen.min_disk} value={form.disk} onChange={e=>setForm({...form,disk:+e.target.value})}/></label>
	    <label style={{...labelStyle,gridColumn:'1/-1'}}>Klucz publiczny SSH <span className="dim">(opcjonalnie)</span><textarea style={{...fieldStyle,minHeight:74,resize:'vertical'}} value={form.sshKey} onChange={e=>setForm({...form,sshKey:e.target.value})} placeholder="ssh-ed25519 AAAA…"/></label>
	  </div>
	  <div className="mono dim" style={{fontSize:'var(--fs-xs)',marginTop:14,padding:'9px 11px',background:'var(--bg-2)',borderRadius:7}}>Minimum: {chosen.min_cpu} vCPU · {Math.round(chosen.min_ram/1024*10)/10} GB RAM · {chosen.min_disk} GB dysku{chosen.format==='qcow2.zip'?' · automatyczne rozpakowanie ZIP':''}</div>
	  {error&&<div style={{color:'var(--err)',marginTop:12,padding:'9px 11px',border:'1px solid color-mix(in oklch,var(--err) 35%,var(--line))',borderRadius:7}}>{error}</div>}
	</KVMModal>}
    {jobs.length>0&&<div className="card"><div style={{padding:16,borderBottom:'1px solid var(--line)'}}><div className="card-title">Wdrożenia</div></div>{jobs.map(j=><div key={j.id} style={{padding:'14px 16px',borderBottom:'1px solid var(--line)'}}><div className="row" style={{justifyContent:'space-between'}}><b>{j.name}</b><span className={`badge ${j.status==='done'?'ok':j.status==='error'?'err':'warn'}`}>{j.status==='done'?'GOTOWE':j.status==='error'?'BŁĄD':j.progress+'%'}</span></div><div className="card-sub" style={{marginTop:4}}>{j.error||j.step}</div><div style={{height:4,background:'var(--line)',borderRadius:4,marginTop:9}}><div style={{height:'100%',width:j.progress+'%',background:j.status==='error'?'var(--err)':'var(--accent)',borderRadius:4}}/></div></div>)}</div>}
  </div>
};

const OS_COLOR = { windows:'oklch(0.65 0.15 220)', linux:'oklch(0.65 0.18 145)', bsd:'oklch(0.65 0.2 25)' };

const CPUVirtBadge = ({ cpuVirt }) => {
  if (!cpuVirt) return null;
  const ok = cpuVirt.supported && cpuVirt.kvm_module;
  const warn = cpuVirt.supported && !cpuVirt.kvm_module;
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:8,
      background: ok ? 'oklch(0.65 0.18 145/0.08)' : warn ? 'oklch(0.78 0.15 75/0.08)' : 'oklch(0.66 0.2 25/0.08)',
      border: `1px solid ${ok ? 'oklch(0.65 0.18 145/0.3)' : warn ? 'oklch(0.78 0.15 75/0.3)' : 'oklch(0.66 0.2 25/0.3)'}`,
      fontSize:'var(--fs-xs)'}}>
      <span style={{fontSize:16}}>{ok ? '✅' : warn ? '⚠️' : '❌'}</span>
      <div>
        <div style={{fontWeight:600,color: ok ? 'var(--ok)' : warn ? 'var(--warn)' : 'var(--err)'}}>
          {cpuVirt.supported ? cpuVirt.type : 'Wirtualizacja CPU nieobsługiwana'}
        </div>
        <div style={{color:'var(--fg-dim)',marginTop:2}}>
          {ok ? 'Moduł KVM załadowany' : warn ? 'Moduł KVM niezaładowany — uruchom: modprobe kvm_intel lub kvm_amd' : 'CPU nie obsługuje VT-x/AMD-V'}
        </div>
      </div>
    </div>
  );
};


// ── VncRemoteDialog — konfiguracja zdalnego dostępu VNC ─────────────────────
const VncRemoteDialog = ({ vm, onClose }) => {
  const [cfg,     setCfg]    = React.useState(null);
  const [loading, setLoad]   = React.useState(true);
  const [saving,  setSaving] = React.useState(false);
  const [listen,  setListen] = React.useState('127.0.0.1');
  const [usePass, setUsePass]= React.useState(false);
  const [passwd,  setPasswd] = React.useState('');
  const [result,  setResult] = React.useState(null);

  React.useEffect(() => {
    kvmApi.vncConfig(vm.name || vm.id).then(d => {
      setCfg(d);
      setListen(d.vnc_listen || '127.0.0.1');
      setLoad(false);
    }).catch(() => setLoad(false));
  }, []);

  const apply = async () => {
    setSaving(true);
    try {
      const d = await kvmApi.vncSetConfig({
        vm: vm.name || vm.id,
        listen, set_passwd: usePass, password: passwd,
      });
      setResult(d);
      setCfg(prev => ({...prev, vnc_listen: listen, remote_ready: listen === '0.0.0.0'}));
      window.toast?.success('Konfiguracja VNC zaktualizowana');
    } catch(e) {
      window.toast?.error('Błąd: ' + e.message);
    } finally { setSaving(false); }
  };

  const inp = {
    background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
    padding:'6px 10px', color:'var(--fg)', fontFamily:'var(--font-mono)',
    fontSize:'var(--fs-sm)', outline:'none', width:'100%',
  };

  return (
    <Modal title={`Zdalny VNC · ${vm.name}`} sub="Konfiguracja połączenia przez klienta VNC"
      onClose={onClose} width={560}
      footer={<>
        <button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" onClick={apply} disabled={saving||loading}>
          {saving ? 'Stosowanie…' : 'Zastosuj konfigurację'}
        </button>
      </>}>
      {loading ? (
        <div style={{padding:32, textAlign:'center', color:'var(--fg-dim)'}}>
          Ładowanie konfiguracji VNC…
        </div>
      ) : (<>
        {/* Status */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20}}>
          {[
            ['Port VNC',  cfg?.actual_port || cfg?.vnc_port || '—'],
            ['Listen',    cfg?.vnc_listen || '127.0.0.1'],
            ['Status',    cfg?.remote_ready ? '✅ Zdalny' : '⚠ Lokalny'],
          ].map(([l,v]) => (
            <div key={l} style={{background:'var(--bg-2)', borderRadius:8, padding:'10px 12px', border:'1px solid var(--line)'}}>
              <div style={{fontSize:10, color:'var(--fg-dim)', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em'}}>{l}</div>
              <div className="mono" style={{fontWeight:600}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Listen address */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:'var(--fs-sm)', fontWeight:600, marginBottom:8}}>Adres nasłuchiwania VNC</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
            {[
              ['127.0.0.1', '🔒 Tylko lokalnie', 'Bezpieczne · użyj SSH tunnel do zdalnego dostępu'],
              ['0.0.0.0',   '🌐 Wszystkie interfejsy', 'Dostęp z sieci lokalnej · zalecane hasło VNC'],
            ].map(([val, label, desc]) => (
              <div key={val} onClick={() => setListen(val)} style={{
                padding:'12px 14px', borderRadius:8, cursor:'pointer',
                border:`1px solid ${listen===val ? 'var(--accent)' : 'var(--line-strong)'}`,
                background: listen===val ? 'color-mix(in oklch,var(--accent) 10%,var(--bg-2))' : 'var(--bg-2)',
              }}>
                <div style={{fontWeight:600, fontSize:'var(--fs-sm)', color:listen===val?'var(--accent)':'var(--fg)', marginBottom:2}}>{label}</div>
                <div className="mono" style={{fontSize:'var(--fs-xs)', color:'var(--fg-dim)', marginBottom:4}}>{val}</div>
                <div style={{fontSize:'var(--fs-xs)', color:'var(--fg-muted)', lineHeight:1.4}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Hasło VNC */}
        <div style={{marginBottom:16, padding:'12px 14px', background:'var(--bg-2)', borderRadius:8, border:'1px solid var(--line)'}}>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom: usePass ? 10 : 0}}>
            <div className={"toggle " + (usePass ? 'on' : '')} onClick={() => setUsePass(!usePass)}/>
            <div>
              <div style={{fontWeight:600, fontSize:'var(--fs-sm)'}}>Hasło VNC</div>
              <div style={{fontSize:'var(--fs-xs)', color:'var(--fg-dim)'}}>
                {usePass ? 'wymagane przy połączeniu' : 'brak ochrony hasłem'}
              </div>
            </div>
          </div>
          {usePass && (
            <input style={inp} type="password" value={passwd}
              onChange={e => setPasswd(e.target.value)}
              placeholder="Hasło VNC (max 8 znaków)"
              maxLength={8}/>
          )}
        </div>

        {/* SSH Tunnel */}
        {listen === '127.0.0.1' && cfg?.actual_port && (
          <div style={{padding:'12px 14px', background:'color-mix(in oklch,var(--accent) 6%,transparent)',
            borderRadius:8, border:'1px solid color-mix(in oklch,var(--accent) 20%,transparent)', marginBottom:12}}>
            <div style={{fontWeight:600, fontSize:'var(--fs-sm)', marginBottom:8}}>💡 Połącz przez SSH tunnel</div>
            <div className="mono" style={{fontSize:11, color:'var(--fg-dim)', lineHeight:2}}>
              <div style={{color:'var(--fg-dim)'}}># Na lokalnym komputerze:</div>
              <div style={{color:'var(--accent)'}}>ssh -L 5900:localhost:{cfg.actual_port} user@{window.location.hostname}</div>
              <div style={{color:'var(--fg-dim)'}}># Następnie połącz klientem VNC:</div>
              <div style={{color:'var(--ok)'}}>vncviewer localhost:5900</div>
            </div>
          </div>
        )}

        {/* Wynik */}
        {result && (
          <div style={{padding:'12px 14px', background:'color-mix(in oklch,var(--ok) 8%,transparent)',
            borderRadius:8, border:'1px solid color-mix(in oklch,var(--ok) 25%,transparent)', marginBottom:12}}>
            <div style={{fontWeight:600, marginBottom:6}}>✅ Zastosowano</div>
            <div className="mono" style={{fontSize:11, color:'var(--fg-dim)', lineHeight:1.8}}>
              {result.direct_vnc && <div>Połącz: <span style={{color:'var(--ok)'}}>vncviewer {result.direct_vnc}</span></div>}
              {result.note && <div style={{color:'var(--warn)', marginTop:4}}>{result.note}</div>}
            </div>
          </div>
        )}

        {/* Warning */}
        {listen === '0.0.0.0' && !usePass && (
          <div style={{padding:'10px 12px', background:'color-mix(in oklch,var(--warn) 8%,transparent)',
            borderRadius:6, border:'1px solid color-mix(in oklch,var(--warn) 25%,transparent)',
            fontSize:'var(--fs-xs)', color:'var(--warn)'}}>
            ⚠ VNC bez hasła będzie dostępne z całej sieci — ustaw hasło lub ogranicz firewallem.
          </div>
        )}
      </>)}
    </Modal>
  );
};

const VncConsole = ({ vm, onClose }) => {
  const [state, setState] = React.useState('connecting');
  const [vncData, setVncData] = React.useState(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    kvmApi.vncProxy(vm.id || vm.name).then(d => {
      setVncData(d);
      if (d.novnc_ready && d.novnc_url && d.ws_ready) {
        setState('novnc');
        window.open(d.novnc_url, 'noVNC-'+vm.name,
          'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no');
      } else if (d.ws_port) {
        // websockify działa ale brak noVNC lub ws nie gotowy
        if (!d.ws_ready) {
          setError('Websockify nie uruchomił się na porcie '+d.ws_port+
            (d.ws_log ? '\nLog: '+d.ws_log : '\nSprawdź: ss -tlnp | grep '+d.ws_port));
          setState('error');
        } else {
          setState('manual');
        }
      } else {
        setError(d.error || 'Nie można uruchomić VNC proxy');
        setState('error');
      }
    }).catch(e => { setError(String(e)); setState('error'); });
  }, [vm.id, vm.name]);

  const reopen = () => {
    if (vncData?.novnc_url) {
      window.open(vncData.novnc_url, 'noVNC-'+vm.name,
        'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no');
    }
  };

  return (
    <Modal title={`Konsola VNC · ${vm.name}`} sub={`${vm.os} · port ${vncData?.vnc_port||vm.vnc}`} onClose={onClose} width={560}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        {state === 'novnc' && (
          <button className="btn sm primary" onClick={reopen}>
            🖥️ Otwórz konsolę ponownie
          </button>
        )}
        <button className="btn sm" onClick={onClose}>Zamknij</button>
      </div>}
    >
      {state === 'connecting' && (
        <div style={{padding:48,textAlign:'center',color:'var(--fg-dim)'}}>
          <div style={{width:24,height:24,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
            borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 16px'}}/>
          <div style={{fontWeight:600,marginBottom:6}}>Uruchamianie VNC proxy…</div>
          <div style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-dim)'}}>
            websockify → {vm.name}
          </div>
        </div>
      )}
      {state === 'novnc' && vncData && (
        <div style={{padding:24}}>
          <div style={{padding:'14px 18px',background:'oklch(0.65 0.18 145/0.08)',
            border:'1px solid oklch(0.65 0.18 145/0.3)',borderRadius:8,marginBottom:16,
            display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:28}}>✅</span>
            <div>
              <div style={{fontWeight:600,marginBottom:2}}>Konsola otwarta w nowym oknie</div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
                noVNC działa poprawnie. Jeśli okno zostało zablokowane przez przeglądarkę — kliknij przycisk poniżej.
              </div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,fontSize:'var(--fs-xs)',
            fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
            <div style={{padding:'8px 12px',background:'var(--bg-2)',borderRadius:6}}>
              <div style={{color:'var(--fg-dim)',marginBottom:2}}>Port VNC</div>
              <div style={{fontWeight:600,color:'var(--fg)'}}>{vncData.vnc_port}</div>
            </div>
            <div style={{padding:'8px 12px',background:'var(--bg-2)',borderRadius:6}}>
              <div style={{color:'var(--fg-dim)',marginBottom:2}}>Websockify</div>
              <div style={{fontWeight:600,color:'var(--fg)'}}>:{vncData.ws_port}</div>
            </div>
            <div style={{padding:'8px 12px',background:'var(--bg-2)',borderRadius:6,gridColumn:'1/-1'}}>
              <div style={{color:'var(--fg-dim)',marginBottom:2}}>Bezpośredni VNC</div>
              <div style={{color:'var(--accent)'}}>{vncData.direct_vnc}</div>
            </div>
          </div>
          <div style={{marginTop:12,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
            💡 Możesz też połączyć się klientem VNC: <code style={{color:'var(--accent)'}}>vncviewer {vncData.direct_vnc}</code>
          </div>
        </div>
      )}
      {state === 'manual' && vncData && (
        <div style={{padding:24}}>
          <div style={{padding:'12px 16px',background:'oklch(0.78 0.15 75/0.08)',
            border:'1px solid oklch(0.78 0.15 75/0.3)',borderRadius:8,marginBottom:16}}>
            <div style={{fontWeight:600,marginBottom:6}}>⚠️ noVNC nie jest zainstalowane</div>
            <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)'}}>
              Zainstaluj: <code style={{color:'var(--accent)'}}>apt install novnc websockify</code>
            </div>
          </div>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',lineHeight:2,fontFamily:'var(--font-mono)'}}>
            <div>Port VNC: <span style={{color:'var(--accent)'}}>{vncData.vnc_port}</span></div>
            <div>Połącz: <span style={{color:'var(--accent)'}}>vncviewer {vncData.direct_vnc}</span></div>
          </div>
        </div>
      )}
      {state === 'error' && (
        <div style={{padding:40,textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
          <div style={{fontWeight:600,marginBottom:8,color:'var(--err)'}}>Błąd VNC</div>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',lineHeight:1.7}}>{error}</div>
          <div style={{marginTop:16,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
            Sprawdź: <code>virsh dumpxml {vm.name} | grep vnc</code>
          </div>
        </div>
      )}
    </Modal>
  );
};

const NewVmDialog = ({ onClose, onAdd, kvmStatus }) => {
  const [form, setForm] = React.useState({
    name:'', os:'linux', cpu:2, ram:2048, disk:32, net:'default', iso:'',
  });
  const [isos, setIsos]       = React.useState([]);
  const [isoPaths, setIsoPaths] = React.useState([]);
  const [creating, setCreating] = React.useState(false);
  const [progress, setProgress] = React.useState(null);
  const [networks, setNetworks] = React.useState([]); // null | {step, msg, error}

  React.useEffect(() => {
    kvmApi.isos().then(d => {
      setIsos(d.isos || []);
      setIsoPaths(d.paths || []);
    }).catch(()=>{});
    kvmApi.networks().then(d => setNetworks(d.networks || [])).catch(()=>{});
  }, []);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'6px 10px',color:'var(--fg)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};
  // Walidacja nazwy — tylko litery, cyfry, myślnik, podkreślenie, kropka
  const nameOk = /^[a-zA-Z0-9._-]+$/.test(form.name.trim()) && form.name.trim().length > 0;
  const nameHasSpaces = form.name.includes(' ');
  const valid = nameOk;
  const imagePath = kvmStatus?.image_path || '/var/lib/libvirt/images';
  const diskFile  = `${imagePath}/${form.name||'vm'}.qcow2`;

  const STEPS = [
    { id:1, label:'Tworzenie dysku',    desc:`qemu-img create ${diskFile}` },
    { id:2, label:'Rejestracja VM',     desc:'virt-install --name '+form.name },
    { id:3, label:'Gotowe',             desc:'VM dodana do listy' },
  ];

  const doCreate = async () => {
    setCreating(true);
    setProgress({ step:1, msg:'Tworzenie obrazu dysku ('+form.disk+' GB)…', error:null });
    try {
      const r = await kvmApi.create({
        name: form.name, os: form.os, cpu: form.cpu,
        ram: form.ram, disk: form.disk, net: form.net, iso: form.iso,
      });

      setProgress({ step:2, msg:'Uruchamianie virt-install…', error:null });
      let d;
      try {
        d = await r.json();
      } catch(e) {
        setProgress({ step:0, msg:'', error:'Serwer zwrócił nieprawidłową odpowiedź. Sprawdź logi.' });
        setCreating(false);
        return;
      }

      if (d.status === 'ok') {
        setProgress({ step:3, msg:'VM '+form.name+' została utworzona!', error:null });
        setTimeout(() => {
          onAdd({ ...form, id: form.name, icon: form.os==='windows'?'🪟':'🐧',
            disk: form.disk+'G', state:'stopped', cpuUsed:0, ramUsed:0,
            diskUsed:0, ip:'—', vnc:'—', uptime:'—', boot:'hd', snapshot:0 });
          onClose();
        }, 1200);
      } else {
        setProgress({ step:0, msg:'', error: d.error || d.output || 'Nieznany błąd — sprawdź: journalctl -xe' });
        setCreating(false);
      }
    } catch(e) {
      setProgress({ step:0, msg:'', error:'Błąd połączenia z serwerem: '+String(e) });
      setCreating(false);
    }
  };

  return (
    <Modal title="Nowa maszyna wirtualna" sub="KVM/QEMU · libvirt" onClose={onClose} width={560}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose} disabled={creating}>Anuluj</button>
        <button className="btn sm primary" disabled={!valid||creating} onClick={doCreate}>
          {creating
            ? <><span style={{display:'inline-block',width:10,height:10,border:'2px solid #fff3',
                borderTopColor:'#fff',borderRadius:'50%',animation:'_spin .6s linear infinite',marginRight:6}}/> Tworzenie…</>
            : <><Icon name="play" size={11}/> Utwórz VM</>}
        </button>
      </div>}
    >
      <div className="col" style={{gap:14}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa maszyny</div>
          <input style={{...inpSt, borderColor: form.name && !nameOk ? 'var(--err)' : 'var(--line-strong)'}}
            value={form.name} onChange={e=>set('name',e.target.value)} placeholder="np. windows-xp"/>
          {form.name && !nameOk && (
            <div style={{fontSize:'var(--fs-xs)',color:'var(--err)',marginTop:4}}>
              {nameHasSpaces
                ? '⚠ Spacje niedozwolone — użyj myślnika: np. "Windows-XP"'
                : '⚠ Tylko litery, cyfry, myślnik (-), podkreślenie (_), kropka (.)'}
            </div>
          )}
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>System operacyjny</div>
          <div className="segmented">
            {[['linux','🐧 Linux'],['windows','🪟 Windows'],['bsd','🔥 BSD']].map(([v,l])=><button key={v} className={form.os===v?'active':''} onClick={()=>set('os',v)}>{l}</button>)}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>CPU (vCPU)</div>
            <select style={inpSt} value={form.cpu} onChange={e=>set('cpu',+e.target.value)}>
              {[1,2,4,8,16].map(n=><option key={n} value={n}>{n} vCPU</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Pamięć RAM</div>
            <select style={inpSt} value={form.ram} onChange={e=>set('ram',+e.target.value)}>
              {[512,1024,2048,4096,8192,16384].map(n=><option key={n} value={n}>{n>=1024?n/1024+' GB':n+' MB'}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Rozmiar dysku</div>
            <select style={inpSt} value={form.disk} onChange={e=>set('disk',+e.target.value)}>
              {[16,32,64,128,256,512].map(n=><option key={n} value={n}>{n} GB</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Sieć</div>
            <select style={{...inpSt, borderColor: form.net && networks.find(n=>n.name===form.net)?.active===false ? 'var(--warn)' : 'var(--line-strong)'}}
              value={form.net} onChange={e=>set('net',e.target.value)}>
              {networks.length > 0
                ? networks.map(n => (
                    <option key={n.name} value={n.name}>
                      {n.name} {n.active ? '● aktywna' : '○ nieaktywna — zostanie uruchomiona'}
                    </option>
                  ))
                : <option value="default">default</option>
              }
            </select>
            {form.net && networks.find(n=>n.name===form.net)?.active===false && (
              <div style={{fontSize:'var(--fs-xs)',color:'var(--warn)',marginTop:4}}>
                ⚠ Sieć nieaktywna — zostanie automatycznie uruchomiona przed instalacją
              </div>
            )}
          </div>
        </div>

        {/* Lokalizacja dysku */}
        <div style={{padding:'10px 14px',background:'var(--bg-2)',borderRadius:7,fontSize:'var(--fs-xs)',lineHeight:1.8}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
            <span style={{fontSize:14}}>💾</span>
            <span style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Lokalizacja dysku VM</span>
          </div>
          <div style={{fontFamily:'var(--font-mono)',color:'var(--accent)'}}>{diskFile}</div>
          <div style={{color:'var(--fg-dim)',marginTop:2}}>
            Ścieżka z konfiguracji kvm.json · <code>{imagePath}</code>
          </div>
        </div>

        {/* ISO */}
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Obraz ISO (opcjonalny)</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
              Szukano w: {isoPaths.join(', ')||'/var/lib/libvirt/boot'}
            </div>
          </div>
          <select style={inpSt} value={form.iso} onChange={e=>set('iso',e.target.value)}>
            <option value="">— Bez ISO (import istniejącego dysku) —</option>
            {isos.map(iso=>(
              <option key={iso.path} value={iso.path}>
                {iso.name} ({iso.size ? (iso.size/1024/1024/1024).toFixed(1)+' GB' : '?'})
              </option>
            ))}
          </select>
          {isos.length === 0 && (
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:4}}>
              Brak plików ISO — wgraj do jednego z katalogów z konfiguracji
            </div>
          )}
        </div>

        {/* virt-install preview */}
        <div style={{padding:'10px 14px',background:'var(--bg-2)',borderRadius:6,fontSize:11,
          color:'var(--fg-dim)',fontFamily:'var(--font-mono)',lineHeight:1.7,wordBreak:'break-all'}}>
          virt-install --name {form.name||'vm'} --vcpus {form.cpu} --memory {form.ram}<br/>
          &nbsp;&nbsp;--disk {diskFile},format=qcow2<br/>
          &nbsp;&nbsp;--os-variant {form.os==='linux'?'ubuntu24.04':form.os==='windows'?'win11':'freebsd14'}<br/>
          {form.iso && <>&nbsp;&nbsp;--cdrom {form.iso}</>}
        </div>

        {/* Panel postępu */}
        {progress && (
          <div style={{borderRadius:8,overflow:'hidden',border:'1px solid var(--line)'}}>
            {/* Kroki */}
            <div style={{display:'flex',borderBottom:'1px solid var(--line)'}}>
              {STEPS.map(s => {
                const done  = progress.step > s.id;
                const active = progress.step === s.id && !progress.error;
                const color = done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--fg-dim)';
                return (
                  <div key={s.id} style={{flex:1,padding:'8px 12px',textAlign:'center',
                    background: active ? 'color-mix(in oklch,var(--accent) 8%,transparent)' : 'transparent',
                    borderRight:'1px solid var(--line)'}}>
                    <div style={{fontSize:16,marginBottom:2}}>
                      {done ? '✅' : active
                        ? <span style={{display:'inline-block',width:14,height:14,border:'2px solid var(--accent)',
                            borderTopColor:'transparent',borderRadius:'50%',animation:'_spin .6s linear infinite'}}/>
                        : <span style={{opacity:.3}}>○</span>}
                    </div>
                    <div style={{fontSize:10,color,fontWeight:active?600:400}}>{s.label}</div>
                  </div>
                );
              })}
            </div>
            {/* Status */}
            <div style={{padding:'10px 14px',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',
              background: progress.error ? 'oklch(0.66 0.2 25/0.06)' : progress.step===3 ? 'oklch(0.65 0.18 145/0.06)' : 'var(--bg-2)',
              color: progress.error ? 'var(--err)' : progress.step===3 ? 'var(--ok)' : 'var(--fg-muted)'}}>
              {progress.error
                ? <><span style={{fontWeight:600}}>❌ Błąd: </span>{progress.error}</>
                : <><span style={{color:'var(--fg-dim)'}}>▶ </span>{progress.msg}</>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const POPULAR_ISOS = [
  { category: 'Linux', items: [
    { name: 'Ubuntu 24.04 LTS',    size: '~5.7 GB', url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso' },
    { name: 'Ubuntu Server 24.04', size: '~2.6 GB', url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.2-live-server-amd64.iso' },
    { name: 'Debian 12',           size: '~3.7 GB', url: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.10.0-amd64-netinst.iso' },
    { name: 'Fedora 41',           size: '~2.1 GB', url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso' },
    { name: 'AlmaLinux 9',         size: '~1.8 GB', url: 'https://repo.almalinux.org/almalinux/9/isos/x86_64/AlmaLinux-9-latest-x86_64-minimal.iso' },
    { name: 'Arch Linux',          size: '~1.1 GB', url: 'https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso' },
  ]},
  { category: 'BSD', items: [
    { name: 'FreeBSD 14.2',        size: '~1.1 GB', url: 'https://download.freebsd.org/releases/amd64/amd64/ISO-IMAGES/14.2/FreeBSD-14.2-RELEASE-amd64-dvd1.iso' },
    { name: 'pfSense CE 2.7',      size: '~0.8 GB', url: 'https://atxfiles.netgate.com/mirror/downloads/pfSense-CE-2.7.2-RELEASE-amd64.iso.gz' },
  ]},
  { category: 'Narzędzia', items: [
    { name: 'GParted Live',        size: '~0.5 GB', url: 'https://downloads.sourceforge.net/gparted/gparted-live-1.6.0-10-amd64.iso' },
    { name: 'Clonezilla Live',     size: '~0.5 GB', url: 'https://downloads.sourceforge.net/clonezilla/clonezilla-live-3.2.0-5-amd64.iso' },
  ]},
];

const KVMISOPanel = ({ kvmStatus }) => {
  const [downloads, setDownloads]   = React.useState([]);
  const [isos,      setIsos]        = React.useState([]);
  const [isoPaths,  setIsoPaths]    = React.useState([]);
  const [customUrl, setCustomUrl]   = React.useState('');
  const [customName,setCustomName]  = React.useState('');
  const [starting,  setStarting]    = React.useState('');
  const [destDir,   setDestDir]     = React.useState('');

  // Poll pobrania co 1.5s
  React.useEffect(() => {
    const refresh = () => {
      kvmApi.isoDownloads().then(d => setDownloads(d.downloads || [])).catch(()=>{});
      kvmApi.isos().then(d => {
        setIsos(d.isos || []);
        setIsoPaths(d.paths || []);
        // Ustaw domyślny katalog docelowy
        setDestDir(prev => prev || (d.paths && d.paths[0]) || '');
      }).catch(()=>{});
    };
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, []);

  const startDownload = async (url, filename) => {
    setStarting(url);
    try {
      await fetch('/api/kvm/iso-download', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({url, filename, dest_dir: destDir}),
      });
    } finally { setStarting(''); }
  };

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'7px 10px',color:'var(--fg)',fontSize:'var(--fs-sm)',outline:'none'};

  const isDownloading = (url) => downloads.some(d => d.url === url && d.status === 'downloading');
  const isDone        = (url) => downloads.some(d => d.url === url && d.status === 'done');
  const activeCount   = downloads.filter(d=>d.status==='downloading').length;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* Aktywne pobrania — widoczne gdy coś się pobiera */}
      {activeCount > 0 && (
        <div className="card" style={{border:'1px solid var(--accent)'}}>
          <div className="card-head">
            <div><div className="card-title">⬇️ Pobieranie w toku</div>
              <div className="card-sub">{activeCount} aktywnych · odświeża się co 1.5s</div></div>
          </div>
          <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:12}}>
            {downloads.filter(d=>d.status==='downloading').map(dl => (
              <div key={dl.id}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontWeight:600,fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>{dl.filename}</span>
                  <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{dl.speed}</span>
                </div>
                <div style={{height:8,background:'var(--bg-3)',borderRadius:4,overflow:'hidden',marginBottom:4}}>
                  <div style={{height:'100%',borderRadius:4,background:'var(--accent)',
                    width:(dl.pct||0)+'%',transition:'width .8s ease'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                  <span>{dl.pct||0}%</span>
                  <span>{dl.total > 0
                    ? (dl.done/1024/1024/1024).toFixed(2)+' / '+(dl.total/1024/1024/1024).toFixed(2)+' GB'
                    : (dl.done/1024/1024).toFixed(0)+' MB pobrано'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zakończone / błędy */}
      {downloads.filter(d=>d.status!=='downloading').length > 0 && (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Historia pobrań</div></div></div>
          <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:8}}>
            {downloads.filter(d=>d.status!=='downloading').map(dl => (
              <div key={dl.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'8px 12px',background:'var(--bg-2)',borderRadius:6}}>
                <div>
                  <div style={{fontWeight:600,fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>{dl.filename}</div>
                  {dl.status==='done' && <div style={{fontSize:'var(--fs-xs)',color:'var(--ok)'}}>{dl.dest_path}</div>}
                  {dl.status==='error' && <div style={{fontSize:'var(--fs-xs)',color:'var(--err)'}}>{dl.error}</div>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className={`badge ${dl.status==='done'?'ok':'err'}`}>
                    {dl.status==='done'?'✓ Gotowe':'✗ Błąd'}
                  </span>
                  <button className="icon-btn" onClick={()=>kvmApi.isoDeleteDownload(dl.id)}><Icon name="trash" size={12}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Własny URL */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">🔗 Pobierz z URL</div>
            <div className="card-sub">Wklej bezpośredni link do pliku .iso</div></div>
        </div>
        <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:10}}>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>URL obrazu ISO</div>
            <input style={{...inpSt,width:'100%'}} value={customUrl} onChange={e=>setCustomUrl(e.target.value)}
              placeholder="https://releases.ubuntu.com/.../ubuntu-24.04-amd64.iso"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>Nazwa pliku (opcjonalna)</div>
              <input style={{...inpSt,width:'100%'}} value={customName} onChange={e=>setCustomName(e.target.value)}
                placeholder="moj-obraz.iso"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>Katalog docelowy</div>
              <select style={{...inpSt,width:'100%'}} value={destDir} onChange={e=>setDestDir(e.target.value)}>
                {isoPaths.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="">— domyślny —</option>
              </select>
            </div>
          </div>
          <button className="btn primary" disabled={!customUrl.trim() || starting===customUrl}
            style={{alignSelf:'flex-start'}}
            onClick={()=>{ startDownload(customUrl.trim(), customName.trim()); setCustomUrl(''); setCustomName(''); }}>
            {starting===customUrl ? 'Startowanie…' : '⬇️ Pobierz'}
          </button>
        </div>
      </div>

      {/* Popularne dystrybucje */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">📋 Popularne dystrybucje</div><div className="card-sub">Kliknij żeby pobrać bezpośrednio na serwer</div></div>
          {isoPaths.length > 0 && (
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',whiteSpace:'nowrap'}}>Pobierz do:</span>
              <select style={{background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
                padding:'5px 8px',color:'var(--fg)',fontSize:'var(--fs-xs)',outline:'none'}}
                value={destDir} onChange={e=>setDestDir(e.target.value)}>
                {isoPaths.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>
        <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:16}}>
          {POPULAR_ISOS.map(cat => (
            <div key={cat.category}>
              <div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:'var(--fg-dim)',
                textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{cat.category}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:8}}>
                {cat.items.map(iso => {
                  const downloading = isDownloading(iso.url);
                  const done = isDone(iso.url);
                  const alreadyHave = isos.some(i => i.name && iso.name && i.name.toLowerCase().includes(iso.name.split(' ')[0].toLowerCase()));
                  return (
                    <div key={iso.url} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                      padding:'10px 14px',background:'var(--bg-2)',borderRadius:8,
                      border:`1px solid ${done?'var(--ok)':downloading?'var(--accent)':'var(--line)'}`,
                      opacity: alreadyHave ? 0.7 : 1}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>{iso.name}</div>
                        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>{iso.size}</div>
                      </div>
                      <button className="btn sm"
                        disabled={downloading || starting===iso.url}
                        style={done?{color:'var(--ok)',borderColor:'var(--ok)'}:{}}
                        onClick={()=>startDownload(iso.url, '')}>
                        {downloading ? <><span style={{display:'inline-block',width:8,height:8,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',animation:'_spin .6s linear infinite',marginRight:4}}/> Pobieranie…</>
                         : done ? '✓ Pobrano'
                         : '⬇️ Pobierz'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dostępne ISO na dysku */}
      {isos.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">💿 Obrazy na dysku</div><div className="card-sub">{isos.length} plików · {isoPaths.join(', ')}</div></div>
          </div>
          <table className="table">
            <thead><tr><th>Nazwa</th><th>Rozmiar</th><th>Ścieżka</th></tr></thead>
            <tbody>
              {isos.map(iso => (
                <tr key={iso.path}>
                  <td className="mono" style={{fontWeight:500}}>💿 {iso.name}</td>
                  <td className="mono dim">{iso.size ? (iso.size/1024/1024/1024).toFixed(2)+' GB' : '—'}</td>
                  <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{iso.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const KVMConfigPanel = ({ kvmStatus, setKvmStatus }) => {
  const [cfg,     setCfg]     = React.useState(null);
  const [saving,  setSaving]  = React.useState(false);
  const [saved,   setSaved]   = React.useState(false);
  const [newPath, setNewPath] = React.useState('');
  const [diag,    setDiag]    = React.useState(null);

  React.useEffect(() => {
    kvmApi.config().then(d => setCfg(d)).catch(() => setCfg({
      iso_paths: ['/var/lib/libvirt/boot'], image_path: '/var/lib/libvirt/images',
      novnc_path: '', novnc_port: 6080,
    }));
    fetch('/api/kvm/novnc-diag', {credentials:'include'}).then(r=>r.json()).then(d=>setDiag(d)).catch(()=>{});
  }, []);

  const save = async () => {
    setSaving(true);
    await kvmApi.saveConfig(cfg).catch(()=>{});
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    kvmApi.status().then(d => setKvmStatus(d)).catch(()=>{});
  };
  const set = (k, v) => setCfg(c => ({...c, [k]: v}));
  const addPath = () => { if (!newPath.trim()) return; set('iso_paths', [...(cfg.iso_paths||[]), newPath.trim()]); setNewPath(''); };
  const remPath = (i) => set('iso_paths', cfg.iso_paths.filter((_,j) => j !== i));
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'7px 10px',color:'var(--fg)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};

  if (!cfg) return <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie…</div>;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">💾 Lokalizacja dysków VM</div><div className="card-sub">Katalog gdzie tworzone są pliki .qcow2 nowych maszyn</div></div>
        </div>
        <div style={{padding:'var(--pad-card)'}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Ścieżka do katalogu obrazów</div>
          <input style={inpSt} value={cfg.image_path||''} onChange={e=>set('image_path',e.target.value)} placeholder="/var/lib/libvirt/images"/>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:6}}>
            Nowe VM: <code style={{color:'var(--accent)'}}>{cfg.image_path||'/var/lib/libvirt/images'}/{'<nazwa>'}.qcow2</code>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">📀 Katalogi z obrazami ISO</div><div className="card-sub">Pliki .iso szukane rekurencyjnie — możesz dodać dowolny dysk/katalog</div></div>
        </div>
        <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:8}}>
          {(cfg.iso_paths||[]).map((p,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',
              background:'var(--bg-2)',borderRadius:6,border:'1px solid var(--line)'}}>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',flex:1}}>{p}</span>
              <button className="icon-btn" onClick={()=>remPath(i)} title="Usuń"><Icon name="trash" size={13}/></button>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <input style={{...inpSt,flex:1}} value={newPath} onChange={e=>setNewPath(e.target.value)}
              placeholder="/mnt/dysk/isos lub /home/user/isos"
              onKeyDown={e=>e.key==='Enter'&&addPath()}/>
            <button className="btn sm" onClick={addPath}><Icon name="plus" size={12}/> Dodaj</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">🖥️ noVNC / Websockify</div><div className="card-sub">Dostęp do pulpitu VM przez przeglądarkę</div></div>
          <span className={`badge ${kvmStatus?.novnc_installed ? 'ok' : 'warn'}`}>
            {kvmStatus?.novnc_installed ? 'Zainstalowane' : 'Niezainstalowane'}
          </span>
        </div>
        <div style={{padding:'var(--pad-card)',display:'flex',flexDirection:'column',gap:14}}>
          {!kvmStatus?.novnc_installed && (
            <div style={{padding:'10px 14px',background:'oklch(0.78 0.15 75/0.08)',border:'1px solid oklch(0.78 0.15 75/0.3)',borderRadius:7,fontSize:'var(--fs-sm)'}}>
              Zainstaluj: <code style={{color:'var(--accent)'}}>apt install novnc websockify</code>
            </div>
          )}
          {diag && (
            <div style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',lineHeight:1.8,
              padding:'10px 12px',background:'var(--bg-2)',borderRadius:7,border:'1px solid var(--line)'}}>
              <div style={{fontWeight:600,marginBottom:6,fontSize:'var(--fs-sm)'}}>📁 Diagnostyka noVNC na dysku:</div>
              {(diag.dirs||[]).filter(d=>d.exists).length === 0
                ? <div style={{color:'var(--err)'}}>✗ Brak katalogu noVNC — uruchom: apt install novnc</div>
                : (diag.dirs||[]).filter(d=>d.exists).map(d=>(
                    <div key={d.path} style={{marginBottom:4}}>
                      <span style={{color:'var(--ok)'}}>✓</span> <span style={{color:'var(--accent)'}}>{d.path}</span>
                      <div style={{color:'var(--fg-dim)',paddingLeft:14}}>
                        {(d.files||[]).filter(f=>f.endsWith('.html')).join(' · ') || 'brak .html'}
                      </div>
                    </div>
                  ))
              }
              <div style={{marginTop:6,borderTop:'1px solid var(--line)',paddingTop:6}}>
                websockify: <span style={{color:diag.websockify_ok?'var(--ok)':'var(--err)'}}>
                  {diag.websockify_ok ? '✓ '+diag.websockify_path : '✗ nie znaleziono — apt install websockify'}
                </span>
              </div>
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Ścieżka noVNC</div>
              <input style={inpSt} value={cfg.novnc_path||''} onChange={e=>set('novnc_path',e.target.value)} placeholder="/usr/share/novnc"/>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:4}}>Zostaw puste = auto-wykrywanie</div>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Port Websockify</div>
              <input style={inpSt} type="number" value={cfg.novnc_port||6080}
                onChange={e=>set('novnc_port',+e.target.value)} min={1024} max={65535}/>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:4}}>
                Dostęp: <code>http://host:{cfg.novnc_port||6080}/novnc/</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">📄 Podgląd kvm.json</div><div className="card-sub">/etc/nimbus/kvm.json</div></div>
        </div>
        <div style={{padding:'var(--pad-card)'}}>
          <pre style={{background:'var(--bg-2)',borderRadius:7,padding:'12px 14px',margin:0,
            fontSize:12,fontFamily:'var(--font-mono)',color:'var(--fg-muted)',overflowX:'auto',
            border:'1px solid var(--line)',lineHeight:1.7}}>
            {JSON.stringify(cfg, null, 2)}
          </pre>
        </div>
      </div>

      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button className="btn primary" onClick={save} disabled={saving}
          style={saved?{background:'var(--ok)',borderColor:'var(--ok)'}:{}}>
          {saving ? 'Zapisywanie…' : saved ? '✓ Zapisano' : 'Zapisz konfigurację'}
        </button>
      </div>
    </div>
  );
};

const DeleteVmDialog = ({ vm, onClose, onDeleted }) => {
  const [removeDisks, setRemoveDisks] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');

  const doDelete = async () => {
    setDeleting(true);
    try {
      const r = await kvmApi.delete(vm.id || vm.name, removeDisks);
      const d = await r.json();
      if (d.status === 'ok') {
        // Poczekaj chwilę żeby libvirt zaktualizował listę
        await new Promise(res => setTimeout(res, 1000));
        onDeleted(vm.id);
      } else {
        setError(d.error || 'Błąd usuwania');
        setDeleting(false);
      }
    } catch(e) { setError(String(e)); setDeleting(false); }
  };

  return (
    <Modal title={`Usuń maszynę · ${vm.name}`} sub="Operacja nieodwracalna" onClose={onClose} width={460}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose} disabled={deleting}>Anuluj</button>
        <button className="btn sm" onClick={doDelete} disabled={deleting}
          style={{background:'var(--err)',borderColor:'var(--err)',color:'#fff'}}>
          {deleting ? 'Usuwanie…' : '🗑 Usuń VM'}
        </button>
      </div>}
    >
      <div className="col" style={{gap:16,padding:4}}>
        <div style={{padding:'12px 16px',background:'oklch(0.66 0.2 25/0.08)',
          border:'1px solid oklch(0.66 0.2 25/0.3)',borderRadius:8,fontSize:'var(--fs-sm)'}}>
          <div style={{fontWeight:600,marginBottom:4}}>⚠️ Usuwasz: <span style={{fontFamily:'var(--font-mono)',color:'var(--err)'}}>{vm.name}</span></div>
          <div style={{color:'var(--fg-muted)'}}>Definicja VM zostanie usunięta z libvirt.</div>
        </div>
        <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer',
          padding:'12px 14px',background:'var(--bg-2)',borderRadius:8,border:'1px solid var(--line)'}}>
          <input type="checkbox" checked={removeDisks} onChange={e=>setRemoveDisks(e.target.checked)}
            style={{marginTop:2,flexShrink:0}}/>
          <div>
            <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Usuń pliki dysków (.qcow2)</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>
              Usunie fizyczne pliki obrazów z dysku. Odznacz jeśli chcesz zachować dane.
            </div>
          </div>
        </label>
        {error && (
          <div style={{color:'var(--err)',fontSize:'var(--fs-sm)',padding:'8px 12px',
            background:'oklch(0.66 0.2 25/0.06)',borderRadius:6}}>{error}</div>
        )}
      </div>
    </Modal>
  );
};

// Shared dialogs retained by the KVM workspace.
window.KVMPanels = {NewVmDialog,VncConsole,VncRemoteDialog,DeleteVmDialog,KVMISOPanel,KVMConfigPanel,KVMTemplatesPanel,CPUVirtBadge};
