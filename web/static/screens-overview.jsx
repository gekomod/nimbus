// Nimbus dashboard — all values come from telemetry, never generated series.
const dashNumber = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const dashFmt = (v, unit='', digits=0) => dashNumber(v)===null ? '—' : Number(v).toLocaleString('pl-PL',{maximumFractionDigits:digits})+unit;
const dashSize = gb => dashNumber(gb)===null?'—':gb>=1024?dashFmt(gb/1024,' TiB',2):dashFmt(gb,' GiB',1);
const dashTone = state => /^(ok|online|passed|running|completed|succeeded)$/i.test(state||'')?'ok':/^(warn|degraded|failed|faulted|offline|interrupted|restarting|crit)$/i.test(state||'')?'warn':'unknown';
const dashList = (raw,key) => Array.isArray(raw)?raw:Array.isArray(raw?.[key])?raw[key]:[];
function dashRates(previous,current,key){
 if(!previous||!current||!current.boot||current.boot!==previous.boot||current.errors?.[key]||previous.errors?.[key])return null;
 const dt=(current.t-previous.t)/1000, before=previous[key]||{},after=current[key]||{},names=Object.keys(after).sort();
 if(dt<=0||dt>30||!names.length||names.join('|')!==Object.keys(before).sort().join('|'))return null;
 let read=0,write=0;
 for(const name of names){const a=before[name],b=after[name];if([a.read,a.write,b.read,b.write].some(v=>dashNumber(v)===null)||b.read<a.read||b.write<a.write)return null;read+=b.read-a.read;write+=b.write-a.write;}
 return {read:read/dt/1e6,write:write/dt/1e6};
}
function dashSensorTone(s){
 const raw=String(s.raw_status||'').toLowerCase();
 if(['cr','lcr','ucr','lnr','unr','critical','failure'].includes(raw))return 'warn';
 if(['nc','lnc','unc','non-critical'].includes(raw))return 'warn';
 if(s.unavailable||s.discrete||dashNumber(s.val)===null)return 'unknown';
 if(s.unit==='°C'&&((s.crit>0&&s.val>=s.crit)||(s.warn>0&&s.val>=s.warn)))return 'warn';
 if((s.unit==='RPM'||s.kind==='fan')&&s.warn>0&&s.val<s.warn)return 'warn';
 return raw==='ok'?'ok':'unknown';
}
function dashUPS(data,error){
 if(error||!data?.connected)return {};
 const raw=data.nut_raw||{},status=String(raw['ups.status']||'').split(/\s+/);
 return {online:status.includes('OL')&&!status.includes('OB')&&!status.includes('ALARM')&&!status.includes('FSD'),battery:status.includes('OB'),fault:status.includes('ALARM')||status.includes('FSD')||status.includes('LB'),
 battery_charge:dashNumber(raw['battery.charge']),runtime_min:dashNumber(raw['battery.runtime'])===null?null:Number(raw['battery.runtime'])/60,ups_load:dashNumber(raw['ups.load']),input_voltage:dashNumber(raw['input.voltage'])};
}
function useDashboardResource(path,delay=30000){
 const [state,setState]=React.useState({data:null,error:'',at:null});
 React.useEffect(()=>{
  const lifetime=new AbortController();let timer,request;
  const load=async()=>{
   if(document.hidden){timer=setTimeout(load,delay);return;}
   request=new AbortController();const timeout=setTimeout(()=>request.abort(),20000);
   try{const r=await fetch(path,{credentials:'include',signal:request.signal});const data=await r.json();if(!r.ok||data?.error)throw Error(data?.error||'HTTP '+r.status);if(!lifetime.signal.aborted)setState({data,error:'',at:Date.now()});}
   catch(e){if(!lifetime.signal.aborted)setState(s=>({...s,error:e.name==='AbortError'?'Brak odpowiedzi przez 20 sekund':e.message}));}
   finally{clearTimeout(timeout);if(!lifetime.signal.aborted)timer=setTimeout(load,delay);}
  };load();return()=>{lifetime.abort();request?.abort();clearTimeout(timer)};
 },[path,delay]);return state;
}
const DashLink=({to,children,className='',storageTab})=><a className={'nd-link '+className} href={'#'+to} onClick={()=>{if(to==='disks')window.__nimbusStorageTab=storageTab||'overview'}}>{children}</a>;
const DashState=({state,label})=><span className={'nd-state '+dashTone(state)}><i/>{label||state||'Brak danych'}</span>;
const DashSource=({source})=>source.error?<div className="nd-source-error" role="status">{source.error}{source.at?' · ostatni odczyt '+new Date(source.at).toLocaleTimeString('pl-PL'):''}</div>:null;
function DashChart({points,keys,colors,percent=false}){
 const rows=(points||[]).slice(-90),width=360,height=85;
 if(rows.filter(p=>keys.some(k=>dashNumber(p[k])!==null)).length<2)return <div className="nd-chart-empty">Zbieranie pomiarów…</div>;
 const start=rows[0].t,end=rows[rows.length-1].t,values=rows.flatMap(p=>keys.map(k=>dashNumber(p[k]))).filter(v=>v!==null),max=percent?100:Math.max(1,...values)*1.12;
 const paths=keys.map(k=>{let drawing=false;return rows.map(p=>{const v=dashNumber(p[k]);if(v===null){drawing=false;return '';}const x=(p.t-start)/Math.max(1,end-start)*width,y=height-4-Math.max(0,Math.min(max,v))/max*(height-8),piece=(drawing?'L':'M')+x.toFixed(1)+','+y.toFixed(1);drawing=true;return piece;}).join(' ')});
 const time=t=>new Date(t).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 return <div className="nd-chart"><svg role="img" aria-label={'Historia pomiarów od '+time(start)+' do '+time(end)} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">{[.25,.5,.75,1].map(n=><line key={n} x1="0" x2={width} y1={height*n} y2={height*n}/>)}{paths.map((d,i)=><path key={i} d={d} fill="none" stroke={colors[i]} strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}</svg><div className="nd-chart-times"><span>{time(start)}</span><span>{percent?'0–100%':dashFmt(max,' MB/s',1)}</span><span>{time(end)}</span></div></div>;
}
const DashPanel=({title,icon,to,children,className='',storageTab})=><section className={'nd-panel '+className}><div className="nd-panel-head"><h2><window.Icon name={icon} size={18}/>{title}</h2>{to&&<DashLink to={to} storageTab={storageTab}>Szczegóły →</DashLink>}</div>{children}</section>;
function Dashboard(){
 const overview=useDashboardResource('/api/overview',5000),metrics=useDashboardResource('/api/metrics?range=1h',15000),io=useDashboardResource('/api/dashboard/io',5000);
 const bays=useDashboardResource('/api/bays',300000),ipmi=useDashboardResource('/api/ipmi',60000),ups=useDashboardResource('/api/ups/status',15000);
 const pools=useDashboardResource('/api/storage/pools',30000),containers=useDashboardResource('/services/docker/containers',30000),vms=useDashboardResource('/api/kvm/vms',30000),jobs=useDashboardResource('/api/storage/jobs',15000);
 const logs=window.useStore('LOGS')||[];
 const [selectedBay,setSelectedBay]=React.useState(null),[traffic,setTraffic]=React.useState([]);const previous=React.useRef(null);
 React.useEffect(()=>{if(!io.data||io.error)return;const current=io.data,net=dashRates(previous.current,current,'network'),disk=dashRates(previous.current,current,'disks');previous.current=current;setTraffic(p=>[...p,{t:current.t,rx:net?.read??null,tx:net?.write??null,read:disk?.read??null,write:disk?.write??null}].slice(-90));},[io.data,io.error]);
 const ov=overview.data,cpu=ov?.cpu||{},mem=ov?.memory||{},hw=ipmi.data||{},power=hw.power||{},sensors=hw.sensors||[],fans=sensors.filter(s=>s.unit==='RPM'||s.kind==='fan');
 const liveHW=!ipmi.error&&!hw.stale&&hw.bmc_present===true;
 const u=dashUPS(ups.data,ups.error),uOnline=u.online,uBattery=u.battery;
 const slots=bays.data?.slots||[],mapped=slots.some(s=>s.pd_id),slot=mapped?slots.find(s=>Number(s.slot)===selectedBay):null;
 const poolList=dashList(pools.data,'pools').filter(p=>p.kind!=='mount'),mounts=dashList(pools.data,'pools').filter(p=>p.kind==='mount');
 const apps=dashList(containers.data,'containers'),machines=dashList(vms.data,'vms'),taskList=dashList(jobs.data,'jobs');
 const alarms=[];
 sensors.filter(s=>dashSensorTone(s)==='warn').forEach(s=>alarms.push({text:s.name+': '+(s.unavailable?s.raw_status:dashFmt(s.val,' '+s.unit)),to:'ipmi'}));
 [power.psu1,power.psu2].forEach((p,i)=>{if(p?.status&&p.status!=='—'&&p.status!=='OK')alarms.push({text:'PSU '+(i+1)+': '+p.status,to:'ipmi'})});
 if(u.fault||uBattery)alarms.push({text:u.fault?'UPS zgłasza alarm':'UPS pracuje na baterii',to:'ups'});
 poolList.filter(p=>dashTone(p.health)==='warn').forEach(p=>alarms.push({text:'Pula '+p.name+': '+p.health,to:'disks',storageTab:'pools'}));
 taskList.filter(j=>['failed','interrupted'].includes(j.state)).slice(0,2).forEach(j=>alarms.push({text:(j.target||j.operation)+': '+(j.result?.error||j.stage||j.state),to:'disks',storageTab:'jobs'}));
 logs.filter(l=>['ERROR','ERR','WARN'].includes(l.lvl)).slice(0,2).forEach(l=>alarms.push({text:l.msg,to:'logs'}));
 const history=(metrics.error?[]:metrics.data?.samples||[]).map(s=>({...s,t:s.t*1000}));
 const last=io.error?{}:traffic[traffic.length-1]||{};
 const stateName=s=>({running:'Działa',stopped:'Wyłączona',exited:'Zatrzymany',paused:'Wstrzymana',restarting:'Restartowanie',queued:'Oczekuje',completed:'Ukończono',succeeded:'Ukończono',failed:'Błąd',interrupted:'Przerwano'})[s]||s||'Nieznany';
 const graphColors=['#58adff','#64d994'];
 return <div className="nd-dashboard">
  <div className={'nd-alert '+(alarms.length?'warn':'neutral')} role="status"><window.Icon name={alarms.length?'bell':'hdd'} size={21}/><div><strong>{alarms.length?alarms.length+' zdarzeń wymaga uwagi':'Stan Twojego serwera'}</strong><span>{alarms.length?alarms[0].text:!ov?'Pobieranie stanu systemu…':overview.error?'Utracono odczyt systemu':`Ostatni odczyt: ${new Date(overview.at).toLocaleTimeString('pl-PL')} · ${ov.hostname}`}</span></div><DashLink to={alarms[0]?.to||'logs'} storageTab={alarms[0]?.storageTab}>Szczegóły →</DashLink></div>
  {alarms.length>1&&<div className="nd-alert-more">{alarms.slice(1,5).map((a,i)=><DashLink key={i} to={a.to} storageTab={a.storageTab}>{a.text} →</DashLink>)}</div>}
  <div className="nd-hero-grid">
   <section className="nd-panel nd-server"><div className="nd-server-heading"><div><h2>HP ProLiant SE326M1R2</h2><p>{ov?.hostname||'Serwer NAS'} · 2U · 25 × 2,5″</p></div><div><DashState state={ov&&dashNumber(cpu.percent)!==null&&!overview.error?'online':'unknown'} label={overview.error?'Brak połączenia':ov?'Serwer online':'Odczyt…'}/><p>Czas pracy {ov?Math.floor(ov.uptime_secs/86400)+' dni '+Math.floor(ov.uptime_secs%86400/3600)+' godz.':'—'}</p></div></div>
    <div className="nd-chassis"><div className="nd-rack-ear"><b>hp</b><i/><i/></div><div className="nd-rack-center"><div className="nd-rack-caption"><span>PROLIANT · STORAGE SERVER</span><span>25 SFF</span></div><div className="nd-bays" aria-label="25 zatok serwera">{Array.from({length:25},(_,i)=>{const b=mapped?slots.find(s=>Number(s.slot)===i+1):null;const known=b&&!bays.error;return <button key={i} className={'nd-bay '+(known&&b.occupied?'occupied ':'')+(known?dashTone(b.smart):'unknown')+(selectedBay===i+1?' selected':'')} onClick={()=>setSelectedBay(i+1)} aria-pressed={selectedBay===i+1} aria-label={'Zatoka '+(i+1)+': '+(!known?'brak danych':b.occupied?b.model||'dysk':'pusta')}><span>{String(i+1).padStart(2,'0')}</span><i className="nd-drive-grille"/><i className={'nd-led '+(known&&b.occupied?'lit':'')}/></button>})}</div></div><div className="nd-rack-ear right"><i/><span>ProLiant</span></div></div>
    <div className="nd-bay-caption"><span>{mapped?'Mapa zatok z kontrolera':'Schemat 25 zatok · brak potwierdzonego mapowania'}</span><DashLink to="disks">Dyski i pule →</DashLink></div>
    {selectedBay!==null&&<div className="nd-bay-detail" aria-live="polite"><strong>Zatoka {selectedBay}</strong><span>{slot?(slot.occupied?[slot.model,slot.size,slot.device||'Brak mapowania /dev',slot.serial].filter(Boolean).join(' · '):'Pusta zatoka'):'Brak danych kontrolera dla tej zatoki'}</span><DashLink to="disks">Zarządzaj →</DashLink><button className="btn ghost sm" aria-label="Zamknij szczegóły zatoki" onClick={()=>setSelectedBay(null)}>×</button></div>}
    <div className="nd-server-facts"><DashLink to="temps"><window.Icon name="thermometer" size={23}/><span>CPU<strong>{cpu.temp>0?dashFmt(cpu.temp,'°C'):'Brak odczytu'}</strong></span></DashLink><DashLink to="ipmi"><window.Icon name="fan" size={23}/><span>Wentylatory<strong>{liveHW&&fans.length?fans.filter(f=>dashSensorTone(f)==='ok').length+' / '+fans.length+' OK':'Brak odczytu'}</strong></span></DashLink><DashLink to="ipmi"><window.Icon name="hdd" size={23}/><span>iLO / BMC<strong className={liveHW?'ok':''}>{liveHW?'Połączone':hw.stale?'Dane nieaktualne':'Brak odczytu'}</strong></span></DashLink></div>
    <DashSource source={overview}/><DashSource source={bays}/><DashSource source={ipmi}/>
   </section>
   <DashPanel title="Zasilanie i UPS" icon="bolt" to="ups" className="nd-power">
    {[power.psu1,power.psu2].map((p,i)=><div className="nd-psu" key={i}><window.Icon name="bolt" size={19}/><strong>PSU {i+1}</strong><DashState state={liveHW?p?.status:null} label={liveHW?p?.status||'Brak danych':'Brak odczytu'}/><small>{liveHW?p?.out||'—':'—'}</small></div>)}
    <div className="nd-redundancy">Redundancja: <b>{liveHW?hw.power_meta?.redundancy||'Brak danych':'Brak danych'}</b></div>
    <div className="nd-ups-title"><strong><window.Icon name="bolt" size={20}/> UPS</strong><DashState state={u.fault||uBattery?'warn':uOnline?'online':null} label={u.fault?'Alarm UPS':uBattery?'Praca na baterii':uOnline?'Zasilanie sieciowe':'Brak odczytu'}/></div>
    <div className="nd-battery"><div><i style={{width:Math.max(0,Math.min(100,u.battery_charge??u.battery_pct??0))+'%',background:uBattery?'var(--warn)':'var(--ok)'}}/></div><strong>{dashFmt(u.battery_charge??u.battery_pct,'%')}</strong></div>
    <div className="nd-power-facts"><div><span>Podtrzymanie</span><strong>{dashFmt(u.runtime_min,' min',1)}</strong></div><div><span>Pobór serwera</span><strong>{liveHW&&power.totalW>0?dashFmt(power.totalW,' W'):'—'}</strong></div><div><span>Obciążenie UPS</span><strong>{dashFmt(u.ups_load??u.output_current_pct,'%')}</strong></div><div><span>Napięcie wejściowe</span><strong>{dashFmt(u.input_voltage,' V')}</strong></div></div><DashSource source={ups}/>
   </DashPanel>
  </div>
  <div className="nd-metrics">
   <DashPanel title="CPU" icon="cpu" to="processes"><div className="nd-metric-value">{overview.error?'—':dashFmt(cpu.percent,'%',1)}</div><DashChart points={history} keys={['cpu']} colors={graphColors} percent/><p className="nd-footnote">{cpu.model||'Procesor —'} · {cpu.cores||'—'} rdzeni</p></DashPanel>
   <DashPanel title="Pamięć" icon="ram" to="hardware"><div className="nd-metric-value">{overview.error?'—':dashFmt(mem.used_gb,'',1)} <small>/ {dashFmt(mem.total_gb,' GiB')}</small><em>{overview.error?'—':dashFmt(mem.percent,'%',1)}</em></div><DashChart points={history} keys={['mem']} colors={['#bc8aff']} percent/><p className="nd-footnote">Dostępne {dashFmt(mem.avail_gb,' GiB',1)} · cache {dashFmt(mem.cached_gb,' GiB',1)}</p></DashPanel>
   <DashPanel title="Sieć" icon="network" to="network"><div className="nd-metric-value nd-rates"><span>↓ {dashFmt(last.rx,' MB/s',1)}</span><span>↑ {dashFmt(last.tx,' MB/s',1)}</span></div><DashChart points={traffic} keys={['rx','tx']} colors={graphColors}/><p className="nd-footnote"><i style={{background:graphColors[0]}}/>Pobieranie <i style={{background:graphColors[1]}}/>Wysyłanie · porty fizyczne</p></DashPanel>
   <DashPanel title="Dyski I/O" icon="disk" to="disks"><div className="nd-metric-value nd-rates"><span>↓ {dashFmt(last.read,' MB/s',1)}</span><span>↑ {dashFmt(last.write,' MB/s',1)}</span></div><DashChart points={traffic} keys={['read','write']} colors={graphColors}/><p className="nd-footnote"><i style={{background:graphColors[0]}}/>Odczyt <i style={{background:graphColors[1]}}/>Zapis · urządzenia fizyczne</p></DashPanel>
  </div><DashSource source={metrics}/><DashSource source={io}/>{Object.entries(io.data?.errors||{}).map(([k,v])=><div className="nd-source-error" key={k}>{k==='disks'?'Dyski':'Sieć'}: {v}</div>)}
  <div className="nd-bottom-grid">
   <DashPanel title="Pule ZFS" icon="disk" to="disks"><DashSource source={pools}/>{poolList.slice(0,4).map(p=>{const pct=p.total>0?Math.max(0,Math.min(100,p.used/p.total*100)):null;return <DashLink className="nd-pool" key={p.id||p.name} to="disks" storageTab="pools"><div><strong>{p.name}</strong><span>{p.type||'ZFS'}</span><DashState state={pools.error?null:p.health} label={pools.error?'Nieaktualne':p.health}/></div><div><div className="nd-pool-bar"><i style={{width:(pct||0)+'%',background:pct>90?'var(--warn)':undefined}}/></div><span>{dashSize(p.used)} / {dashSize(p.total)}</span><b>{dashFmt(pct,'%')}</b></div></DashLink>})}{!poolList.length&&<p className="nd-empty">{pools.data?'Brak pul ZFS w odpowiedzi serwera.':'Pobieranie pul…'}</p>}{mounts.length>0&&<DashLink to="disks">Montowania danych: {mounts.length} →</DashLink>}</DashPanel>
   <DashPanel title="Aplikacje i maszyny" icon="docker" to="docker"><div className="nd-app-summary"><DashLink to="docker">Docker <b>{containers.data&&!containers.error?apps.filter(c=>(c.state||c.State)==='running').length:'—'}</b> działa</DashLink><DashLink to="kvm">VM <b>{vms.data&&!vms.error?machines.filter(v=>v.state==='running').length:'—'}</b> działa</DashLink></div><DashSource source={containers}/><DashSource source={vms}/>{[...apps.slice(0,3).map(c=>({name:c.name||c.Names||c.ID,state:c.state||c.State,type:'Kontener Docker',to:'docker',stale:!!containers.error})),...machines.slice(0,2).map(v=>({...v,type:'Maszyna wirtualna',to:'kvm',stale:!!vms.error}))].map((a,i)=><DashLink className="nd-app" key={i} to={a.to}><span className={'nd-app-icon '+a.to}><window.Icon name={a.to==='docker'?'docker':'hdd'} size={19}/></span><strong>{a.name}</strong><small>{a.type}</small><DashState state={a.stale?null:a.state} label={a.stale?'Nieaktualne':stateName(a.state)}/><span>›</span></DashLink>)}{!apps.length&&!machines.length&&<p className="nd-empty">{containers.data&&vms.data?'Brak kontenerów i maszyn wirtualnych.':'Pobieranie aplikacji…'}</p>}</DashPanel>
  </div>
  <DashPanel title="Ostatnie zadania" icon="clock" to="disks" storageTab="jobs"><DashSource source={jobs}/><div className="nd-tasks">{taskList.slice(0,5).map(j=><DashLink key={j.id} className="nd-task" to="disks" storageTab="jobs"><window.Icon name="disk" size={18}/><strong>{j.target||j.operation}</strong><span>{j.stage||j.operation}</span><DashState state={j.state} label={stateName(j.state)}/>{j.result?.error&&<small>{j.result.error}</small>}</DashLink>)}{!taskList.length&&<p className="nd-empty">{jobs.data?'Brak zadań dyskowych w historii.':'Pobieranie historii operacji…'}</p>}</div></DashPanel>
  <div className="nd-footer"><span>Wykresy CPU/RAM: historia serwera · Sieć i I/O: pomiary bieżącej sesji</span><DashLink to="updates">Aktualizacje →</DashLink><DashLink to="logs">Logi systemowe {logs.filter(l=>['ERROR','ERR','WARN'].includes(l.lvl)).length?'· zgłoszone ostrzeżenia':''} →</DashLink></div>
 </div>;
}
window.Dashboard=Dashboard;
window.DashboardHelpers={dashRates,dashNumber,dashFmt,dashSensorTone,dashUPS};
