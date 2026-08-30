const $=id=>document.getElementById(id),num=v=>Number(v)||0;
document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>location.href='/#'+el.dataset.go);
$('theme').onclick=()=>document.body.classList.toggle('dark');
$('logout').onclick=()=>fetch('/api/logout',{method:'POST',credentials:'include'}).finally(()=>location.href='/login.html');

const history={cpu:Array(20).fill(18),ram:Array(20).fill(42),tx:Array(20).fill(8),rx:Array(20).fill(18)};
const safe=async url=>{try{const r=await fetch(url,{credentials:'include'});if(r.status===401){location.href='/login.html';return null}return r.ok?await r.json():null}catch{return null}};
const seriesPath=(data,w=190,h=46)=>{const max=Math.max(100,...data),step=w/(data.length-1);return data.map((v,i)=>(i?'L':'M')+(i*step).toFixed(1)+' '+(h-5-v/max*(h-10)).toFixed(1)).join(' ')};
const push=(key,value)=>{history[key].push(value);if(history[key].length>20)history[key].shift()};
const service=(name,sub,on,icon)=>'<article class="service '+(on?'on':'')+'"><span class="service-icon">'+icon+'</span><span><b>'+name+'</b><small>'+sub+'</small></span><i></i></article>';
const renderServices=(smb,ssh,nfs,running,total)=>{$('services').innerHTML=
 service('SMB','Udostępnianie plików',!!smb?.active,'▣')+
 service('SSH / SFTP','Dostęp zdalny',!!ssh?.active,'›_')+
 service('NFS','Udostępnianie plików',!!nfs?.active,'▤')+
 service('Docker',running+'/'+total+' kontenerów',running>0,'⬡')+
 service('Rsync','Synchronizacja',false,'↻')+
 service('WireGuard','VPN sieciowe',false,'⌘')};
renderServices(null,null,null,0,0);

async function refresh(){
 const [ov,poolRaw,dockerRaw,net,smb,ssh,nfs]=await Promise.all([
  safe('/api/overview'),safe('/api/zfs/pools'),safe('/services/docker/containers'),safe('/api/network'),
  safe('/services/samba/status'),safe('/services/ssh/status'),safe('/api/nfs-server/status')
 ]);
 const pools=poolRaw?.pools||(Array.isArray(poolRaw)?poolRaw:[]);
 const containers=dockerRaw?.containers||(Array.isArray(dockerRaw)?dockerRaw:[]);
 const cpu=num(ov?.cpu?.percent),ram=num(ov?.memory?.percent),used=num(ov?.memory?.used_gb),total=num(ov?.memory?.total_gb);
 const iface=(net?.interfaces||[]).find(x=>(x.state||x.State)==='up')||{};
 const tx=num(iface.tx||iface.Tx||iface.tx_mbps),rx=num(iface.rx||iface.Rx||iface.rx_mbps);
 $('hostTop').textContent=ov?.hostname||net?.hostname||'nimbus';
 $('cpu').textContent=cpu.toFixed(0);$('ram').textContent=ram.toFixed(0);
 $('cpuRing').style.setProperty('--pct',cpu);$('ramRing').style.setProperty('--pct',ram);
 const ghz=num(ov?.cpu?.mhz)/1000||num(ov?.cpu?.ghz);
 $('cpuClock').textContent=ghz?ghz.toFixed(1)+' GHz':'— GHz';
 $('ramUsed').textContent=ov?used.toFixed(1):'—';$('ramTotal').textContent=ov?total.toFixed(0):'—';
 $('iface').textContent=(iface.name||iface.Name||'LAN')+(iface.name||iface.Name?' - Aktywna':'');
 $('speed').textContent=iface.speed||iface.Speed||'—';$('tx').textContent=tx.toFixed(0);$('rx').textContent=rx.toFixed(0);
 $('kernel').textContent=(ov?.kernel||'System').replace('Linux ','').slice(0,14);
 $('poolActivity').textContent=pools.length?pools.length+' pul':'Brak danych';
 $('snapshotPool').textContent=pools[0]?.name||'Pula 1';
 push('cpu',cpu);push('ram',ram);push('tx',Math.min(100,tx));push('rx',Math.min(100,rx));
 $('cpuPath').setAttribute('d',seriesPath(history.cpu));$('ramPath').setAttribute('d',seriesPath(history.ram));
 $('txPath').setAttribute('d',seriesPath(history.tx,190,52));$('rxPath').setAttribute('d',seriesPath(history.rx,190,52));
 const running=containers.filter(c=>(c.state||c.State||'').toLowerCase()==='running').length;
 renderServices(smb,ssh,nfs,running,containers.length);
 $('alerts').textContent=pools.filter(p=>(p.health||'online').toLowerCase()!=='online').length;
}
refresh();setInterval(refresh,5000);
