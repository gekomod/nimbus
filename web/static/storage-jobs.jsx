// Accepted jobs survive navigation and reload; never resubmit after a lost response.
const storageJobResult = job => {
  if(job.state==='succeeded' && !job.result?.error) return {ok:true,...job.result};
  return {ok:false,...job.result,error:job.error||job.result?.error||'Operacja została przerwana. Sprawdź stan urządzenia.'};
};
const storageJobKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
async function nimbusStorageFetch(url,options={}) {
  const method=(options.method||'GET').toUpperCase();
  const opts={...options,credentials:'include'};
  let key='';
  if(method!=='GET') {key=storageJobKey();opts.headers={...options.headers,'Idempotency-Key':key};}
  let response;
  try {response=await fetch(url,opts);}
  catch(e) {throw new Error(key?'Brak potwierdzenia przyjęcia zadania '+key+'. Sprawdź historię przed ponowieniem.':e.message);}
  if(response.status===503 && key && response.headers.get('X-Nimbus-Job-ID')) {
    const d=await response.json();return new Response(JSON.stringify({...d,error:(d.error||'Brak odpowiedzi')+' Identyfikator: '+key}),{status:503,headers:{'Content-Type':'application/json'}});
  }
  if(response.status!==202) return response;
  let job=await response.json();
  window.dispatchEvent(new CustomEvent('nimbus-storage-job',{detail:job}));
  const started=Date.now();
  while(['queued','running'].includes(job.state)) {
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(Date.now()-started>7200000) throw new Error('Zadanie nadal trwa. Jego wynik znajdziesz w zakładce Zadania: '+job.id);
    let next;
    try {next=await fetch('/api/storage/jobs/'+encodeURIComponent(job.id),{credentials:'include',cache:'no-store'});}
    catch(e){throw new Error('Utracono połączenie. Zadanie '+job.id+' pozostaje w historii; nie zlecaj go ponownie.');}
    if(!next.ok) throw new Error('Nie można odczytać zadania '+job.id+'. Sprawdź zakładkę Zadania przed ponowieniem.');
    job=await next.json();
    window.dispatchEvent(new CustomEvent('nimbus-storage-job',{detail:job}));
  }
  const result=storageJobResult(job);
  window.dispatchEvent(new Event('nimbus-storage-changed'));
  return new Response(JSON.stringify(result),{status:result.ok?200:422,headers:{'Content-Type':'application/json'}});
}
window.nimbusStorageFetch=nimbusStorageFetch;
const storageJobLabels={queued:'Oczekuje',running:'W toku',succeeded:'Zakończone',failed:'Błąd',interrupted:'Przerwane'};
function StorageJobs(){
  const [jobs,setJobs]=React.useState([]),[error,setError]=React.useState(''),[selected,setSelected]=React.useState(null),[loading,setLoading]=React.useState(true);
  React.useEffect(()=>{let alive=true,busy=false;const load=async()=>{if(busy)return;busy=true;try{const r=await fetch('/api/storage/jobs',{credentials:'include',cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Usługa niedostępna');if(alive){setJobs(d.jobs||[]);setError('');}}catch(e){if(alive)setError(e.message);}finally{busy=false;if(alive)setLoading(false);}};load();const timer=setInterval(()=>{if(!document.hidden)load();},3000);window.addEventListener('nimbus-storage-job',load);return()=>{alive=false;clearInterval(timer);window.removeEventListener('nimbus-storage-job',load);};},[]);
  const current=jobs.find(j=>j.id===selected);
  return <div className="storage-detail"><div className="storage-detail-head"><div><div className="storage-eyebrow">MAGAZYN DANYCH / OPERACJE</div><h2>Zadania dyskowe</h2><p className="dim">Operacje trwają także po zamknięciu panelu. Historia pozostaje po restarcie serwera.</p></div></div><div className="storage-summary"><div><span>W kolejce</span><strong>{jobs.filter(j=>j.state==='queued').length}</strong></div><div><span>Wykonywane</span><strong>{jobs.filter(j=>j.state==='running').length}</strong></div><div><span>Wymagają sprawdzenia</span><strong>{jobs.filter(j=>['failed','interrupted'].includes(j.state)||j.result?.error).length}</strong></div></div>{error&&<div className="storage-alert" role="alert">{error}</div>}<section className="card"><div className="card-head"><div className="card-title">Ostatnie 200 operacji</div></div><div className="storage-table-wrap"><table className="table"><thead><tr><th>Operacja / urządzenie</th><th>Stan</th><th>Etap</th><th>Zlecono</th><th>Wynik</th></tr></thead><tbody>{jobs.map(job=><tr key={job.id}><td><strong>{job.operation}</strong><small className="storage-uuid">{job.target||'—'}</small></td><td><span className={'badge '+(job.state==='succeeded'&&!job.result?.error?'ok':job.state==='running'?'accent':'warn')}>{job.result?.error?'Błąd zastosowania':storageJobLabels[job.state]||job.state}</span></td><td>{job.stage}</td><td>{new Date(job.created*1000).toLocaleString('pl-PL')}</td><td><button className="btn sm" onClick={()=>setSelected(job.id)}>Szczegóły</button></td></tr>)}</tbody></table></div>{!jobs.length&&<div className="storage-empty">{loading?'Ładowanie historii…':'Brak zleconych operacji'}</div>}</section>{current&&<section className="card"><div className="card-head"><div><div className="card-title">{current.operation}</div><div className="card-sub mono">{current.id}</div></div><button className="btn sm" onClick={()=>setSelected(null)}>Zamknij</button></div><div className="card-body">{current.error&&<div className="storage-alert" role="alert">{current.error}</div>}<pre className="storage-output">{current.result?JSON.stringify(current.result,null,2):current.stage}</pre></div></section>}</div>;
}
function StoragePartitionPlan({device,onChanged}) {
  const [start,setStart]=React.useState('1'),[end,setEnd]=React.useState(''),[number,setNumber]=React.useState(''),[plan,setPlan]=React.useState([]),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{setPlan([]);setError('');},[device]);
  const add=op=>{setError('');const item=op==='partition.create'?{operation:op,device,start_mib:Number(start),end_mib:Number(end)}:{operation:op,device,number:Number(number)};if(op==='partition.create'?(!Number.isInteger(item.start_mib)||!Number.isInteger(item.end_mib)||item.start_mib<1||item.end_mib<=item.start_mib):(!Number.isInteger(item.number)||item.number<1)){setError('Podaj poprawny zakres lub numer partycji.');return;}setPlan(p=>[...p,item]);};
  const apply=async()=>{if(!confirm('Zastosować '+plan.length+' operacji na '+device+'? Usunięcie partycji może spowodować utratę danych.'))return;setBusy(true);setError('');try{for(const item of plan){const r=await nimbusStorageFetch('/api/storage/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Nie udało się wykonać zadania');setPlan(p=>p.slice(1));}onChanged?.();}catch(e){setError(e.message+' Kolejka zatrzymana; sprawdź historię przed dalszymi zmianami.');}finally{setBusy(false);}};
  return <section className="card"><div className="card-head"><div><div className="card-title">Partycjonowanie — plan zmian</div><div className="card-sub">{device} · istniejąca tablica GPT · granice w MiB</div></div></div><div className="card-body"><p className="dim">Dodaj operacje do planu i sprawdź je przed zastosowaniem. Dyski systemowe, zamontowane i używane przez ZFS/RAID/LVM są chronione.</p>{error&&<div className="storage-alert" role="alert">{error}</div>}<fieldset disabled={busy} style={{border:0,padding:0}}><div className="row" style={{gap:12,flexWrap:'wrap'}}><label>Początek (MiB)<input className="input" type="number" min="1" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Koniec (MiB)<input className="input" type="number" min="2" value={end} onChange={e=>setEnd(e.target.value)}/></label><button className="btn" onClick={()=>add('partition.create')}>Zaplanuj utworzenie</button></div><div className="row" style={{gap:12,marginTop:16,flexWrap:'wrap'}}><label>Numer partycji<input className="input" type="number" min="1" max="128" value={number} onChange={e=>setNumber(e.target.value)}/></label><button className="btn" onClick={()=>add('partition.delete')}>Zaplanuj usunięcie</button></div>{plan.length>0&&<ol>{plan.map((item,i)=><li key={i}>{item.operation==='partition.create'?`Utwórz partycję: ${item.start_mib}–${item.end_mib} MiB`:`Usuń partycję ${item.number}`} <button className="btn sm ghost" onClick={()=>setPlan(p=>p.filter((_,n)=>n!==i))}>Usuń z planu</button></li>)}</ol>}<button className="btn primary" style={{marginTop:16}} disabled={!plan.length} onClick={apply}>{busy?'Wykonywanie…':'Zastosuj plan ('+plan.length+')'}</button></fieldset></div></section>;
}
window.StorageJobs=StorageJobs;window.StoragePartitionPlan=StoragePartitionPlan;
