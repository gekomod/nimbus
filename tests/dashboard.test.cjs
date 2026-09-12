const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
const code=esbuild.transformSync(fs.readFileSync('web/static/screens-overview.jsx','utf8'),{loader:'jsx'}).code;
const ctx={window:{useStore:()=>[],Icon:()=>null},React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>[typeof v==='function'?v():v,()=>{}],useEffect:()=>{},useRef:()=>({current:null})}};
vm.createContext(ctx);vm.runInContext(code,ctx);const h=ctx.window.DashboardHelpers;
const counter=(t,read,write,boot='boot1')=>({t,boot,disks:{sda:{read,write}},errors:{}});
test('disk throughput is the delta in bytes per elapsed second, including real zeros',()=>{
 const a=counter(1000,1e9,2e9),b=counter(6000,1e9+10e6,2e9+5e6);const v=h.dashRates(a,b,'disks');assert.equal(v.read,2);assert.equal(v.write,1);assert.equal(h.dashRates(b,{...b,t:11000},'disks').read,0);
});
test('first sample, reset, reboot, changed devices and telemetry gaps are unknown',()=>{
 const a=counter(1000,100,200),b=counter(6000,200,300);
 for(const [prev,next] of [[null,b],[a,counter(6000,0,300)],[a,counter(6000,200,300,'boot2')],[a,{...b,disks:{sdb:b.disks.sda}}],[a,{...b,t:40000}],[a,{...b,errors:{disks:'partial'}}]])assert.equal(h.dashRates(prev,next,'disks'),null);
});
test('missing numbers do not become zero and critical sensors never become healthy',()=>{
 for(const v of [null,undefined,'',NaN])assert.equal(h.dashFmt(v),'—');assert.equal(h.dashFmt(0,'%'),'0%');
 assert.equal(h.dashSensorTone({val:0,unavailable:true,raw_status:'ok'}),'unknown');assert.equal(h.dashSensorTone({val:30,raw_status:'ucr',unit:'°C'}),'warn');
});
test('UPS uses actual NUT values instead of estimated runtime or default online state',()=>{
 const u=h.dashUPS({connected:true,status:{runtime_min:50,battery_charge:0,status:'online'},nut_raw:{'ups.status':'OB LB','battery.charge':'0','battery.runtime':'120'}},'');assert.equal(u.battery,true);assert.equal(u.fault,true);assert.equal(u.online,false);assert.equal(u.runtime_min,2);assert.equal(u.battery_charge,0);
 const missing=h.dashUPS({connected:true,status:{runtime_min:50},nut_raw:{}},'');assert.equal(missing.runtime_min,null);assert.equal(missing.online,false);
 assert.equal(h.dashUPS({connected:true},'offline').online,undefined);
});
function expand(node){if(node===null||node===undefined||typeof node!=='object')return node;if(Array.isArray(node))return node.map(expand);if(typeof node.type==='function')return expand(node.type(node.props));return {...node,props:{...node.props,children:expand(node.props.children)}}}
function flatten(n,all=[]){if(!n||typeof n!=='object')return all;if(Array.isArray(n)){n.forEach(x=>flatten(x,all));return all}all.push(n);flatten(n.props?.children,all);return all}
test('empty dashboard renders 25 accessible bays and no invented live metrics',()=>{
 const tree=expand(ctx.window.Dashboard()),nodes=flatten(tree),bays=nodes.filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Zatoka '));assert.equal(bays.length,25);assert.ok(bays.every(b=>b.props['aria-label'].includes('brak danych')));assert.ok(!JSON.stringify(tree).includes('genSeries'));
 const historyLink=nodes.find(n=>n.type==='a'&&JSON.stringify(n.props.children).includes('Szczegóły →')&&n.props.onClick&&n.props.href==='#disks');assert.ok(historyLink);
 const links=nodes.filter(n=>n.type==='a');links.forEach(n=>n.props.onClick?.());assert.ok(['overview','jobs'].includes(ctx.window.__nimbusStorageTab));
});
test('populated dashboard renders telemetry, alarms and unmapped occupied bay without crashing',()=>{
 const data=[{hostname:'nimbus',uptime_secs:90000,cpu:{percent:18,temp:43,cores:16},memory:{percent:37,total_gb:64,used_gb:24}},
 {samples:[{t:10,cpu:12,mem:36},{t:20,cpu:18,mem:37}]},{t:20000,boot:'b',errors:{}},
 {slots:[{slot:7,pd_id:'1I:1:7',occupied:true,model:'SAS disk',serial:'123',smart:'OK'}]},
 {bmc_present:true,sensors:[{name:'CPU',val:95,unit:'°C',raw_status:'ucr'}],power:{psu1:{status:'OK'},psu2:{status:'Failed'}}},
 {connected:true,nut_raw:{'ups.status':'OB','battery.charge':'40','battery.runtime':'600'}},
 [{kind:'zfs',name:'dane',used:512,total:1024,health:'DEGRADED'}],{containers:[{name:'jellyfin',state:'running'}]},
 {vms:[{name:'debian',state:'paused'}]},{jobs:[{id:'1',operation:'format',state:'failed',result:{error:'device changed'}}]}];
 let index=0;const original=ctx.React.useState;ctx.React.useState=v=>[index<data.length?{data:data[index++],error:'',at:20000}:original(v)[0],()=>{}];
 try{const tree=expand(ctx.window.Dashboard()),text=JSON.stringify(tree),nodes=flatten(tree);assert.ok(text.includes('UPS pracuje na baterii'));assert.ok(text.includes('DEGRADED'));assert.ok(text.includes('device changed'));const bay=nodes.find(n=>n.type==='button'&&n.props['aria-label']==='Zatoka 7: SAS disk');assert.ok(bay);assert.ok(!bay.props.disabled);const job=nodes.find(n=>n.type==='a'&&n.props.className.includes('nd-task'));job.props.onClick();assert.equal(ctx.window.__nimbusStorageTab,'jobs');}finally{ctx.React.useState=original}
});
