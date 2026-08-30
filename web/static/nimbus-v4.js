const $=id=>document.getElementById(id),num=v=>Number(v)||0;
document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>location.href='/#'+el.dataset.go);
$('theme').onclick=()=>document.body.classList.toggle('dark');
$('logout').onclick=()=>fetch('/api/logout',{method:'POST',credentials:'include'}).finally(()=>location.href='/login.html');
const get=async url=>{const r=await fetch(url,{credentials:'include'});if(r.status===401){location.href='/login.html';throw Error('unauthorized')}if(!r.ok)throw Error(url);return r.json()};
const history={cpu:Array(20).fill(18),ram:Array(20).fill(42),tx:Array(20).fill(8),rx:Array(20).fill(18)};
function path(data,w=190,h=46){const max=Math.max(100,...data),step=w/(data.length-1);return data.map((v,i)=>(i?'L':'M')+(i*step).toFixed(1)+' '+(h-5-v/max*(h-10)).toFixed(1)).join(' ')}
function push(k,v){history[k].push(v);if(history[k].length>20)history[k].shift()}
function renderDrives(pools){let count=pools.reduce((a,p)=>a+(num(p.drives)||0),0);const wall=$('driveWall');wall.innerHTML='';for(let i=0;i<25;i++){const d=document.createElement('div');d.className='drive '+(i>=count?'off':'')+(i===Math.max(0,count-1)&&pools.some(p=>(p.health||'online').toLowerCase()!=='online')?' warn':'');d.innerHTML='<span class="latch"></span><span class="led"></span>';wall.appendChild(d)}}
function service(name,sub,on,icon){return '<article class="service '+(on?'on':'')+'"><span class="service-icon">'+icon+'</span><span><b>'+name+'</b><small>'+sub+'</small></span><i></i></article>'}
async function refresh(){try{
 const [ov,poolRaw,dockerRaw,net,smb,ssh,nfs,ftp]=await Promise.all([
  get('/api/overview'),get('/api/zfs/pools').catch(()=>[]),get('/services/docker/containers').catch(()=>[]),get('/api/network').catch(()=>null),
  get('/services/samba/status').catch(()=>null),get('/services/ssh/status').catch(()=>null),get('/api/nfs-server/status').catch(()=>null),get('/api/services/ftp-sftp/status').catch(()=>null)
 ]);
 const pools=poolRaw?.pools||poolRaw||[],containers=dockerRaw?.containers||dockerRaw||[];
 const cpu=num(ov.cpu?.percent),ram=num(ov.memory?.percent),used=num(ov.memory?.used_gb),total=num(ov.memory?.total_gb);
 const iface=(net?.interfaces||[]).find(x=>(x.state||x.State)==='up')||{};
 const tx=num(iface.tx||iface.Tx||iface.tx_mbps),rx=num(iface.rx||iface.Rx||iface.rx_mbps);
 $('hostTop').textContent=ov.hostname||net?.hostname||'nimbus';$('cpu').textContent=cpu.toFixed(0);$('ram').textContent=ram.toFixed(0);
 $('cpuRing').style.setProperty('--pct',cpu);$('ramRing').style.setProperty('--pct',ram);
 $('cpuClock').textContent=(num(ov.cpu?.mhz)/1000||num(ov.cpu?.ghz)||0).toFixed(1)+' GHz';$('ramUsed').textContent=used.toFixed(1);$('ramTotal').textContent=total.toFixed(0);
 $('iface').textContent=(iface.name||iface.Name||'LAN')+' - Aktywna';$('speed').textContent=iface.speed||iface.Speed||'—';$('tx').textContent=tx.toFixed(0);$('rx').textContent=rx.toFixed(0);
 $('kernel').textContent=(ov.kernel||'System').replace('Linux ','').slice(0,14);$('poolActivity').textContent=pools.length+' pul';$('snapshotPool').textContent=pools[0]?.name||'Pula 1';
 push('cpu',cpu);push('ram',ram);push('tx',Math.min(100,tx));push('rx',Math.min(100,rx));$('cpuPath').setAttribute('d',path(history.cpu));$('ramPath').setAttribute('d',path(history.ram));$('txPath').setAttribute('d',path(history.tx,190,52));$('rxPath').setAttribute('d',path(history.rx,190,52));
 renderDrives(pools);
 const running=containers.filter(c=>(c.state||c.State||'').toLowerCase()==='running').length;
 $('services').innerHTML=service('SMB','Udostępnianie plików',!!smb?.active,'▣')+service('SSH / SFTP','Dostęp zdalny',!!ssh?.active,'›_')+service('NFS','Udostępnianie plików',!!nfs?.active,'▤')+service('Docker',running+'/'+containers.length+' kontenerów',running>0,'⬡')+service('Rsync','Synchronizacja',false,'↻')+service('WireGuard','VPN sieciowe',true,'⌘');
 $('alerts').textContent=pools.filter(p=>(p.health||'online').toLowerCase()!=='online').length;
}catch(e){console.error(e)}}
refresh();setInterval(refresh,5000);