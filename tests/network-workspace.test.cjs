const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
const compiled=esbuild.transformSync(fs.readFileSync('web/static/screens-network-workspace.jsx','utf8'),{loader:'jsx'}).code;
function load(fetch,states={}){let hook=0;const ctx={fetch,window:{},Date,AbortController,setTimeout,clearTimeout,React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>[Object.hasOwn(states,hook)?states[hook++]:((hook++),v),()=>{}],useCallback:f=>f,useEffect:()=>{}}};vm.createContext(ctx);vm.runInContext(compiled,ctx);return ctx.window;}
function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...(tree.props?.children||[]).flat(Infinity).flatMap(nodes)]}
const iface={name:'enp2s0',kind:'physical',physical:true,admin_up:true,carrier:false,state:'no-carrier',speed_mbps:1000,mtu:9000,addresses:['10.0.0.2/20']};
test('no carrier preserves enabled state without claiming negotiated speed',()=>{const h=load().NetworkWorkspaceHelpers;assert.equal(h.netState(iface),'Brak linku');assert.equal(h.netSpeed(iface),'Brak linku');assert.equal(h.netSpeed({...iface,carrier:true,speed_mbps:2500}),'2.5 Gb/s')});
test('missing rates and unsupported speeds do not become zeros',()=>{const h=load().NetworkWorkspaceHelpers;assert.equal(h.netRate(null),'—');assert.equal(h.netRate(0),'0.0 kB/s');assert.equal(h.netSpeed({speed_mbps:-1}),'—')});
test('HTTP and legacy API failures are surfaced',async()=>{for(const ok of [true,false])await assert.rejects(()=>load(async()=>({ok,json:async()=>({error:'brak uprawnień'})})).NetworkWorkspaceHelpers.networkRequest('/x'),/brak uprawnień/);await assert.rejects(()=>load(async()=>({ok:false,status:502,json:async()=>{throw Error()}})).NetworkWorkspaceHelpers.networkRequest('/x'),/HTTP 502/)});
test('empty, populated, configuration, diagnostics and pending views render',()=>{for(const state of [{},{0:[iface],1:iface.name},{0:[iface],1:iface.name,10:'configuration'},{0:[iface],1:iface.name,10:'diagnostics'},{8:{id:'abc',interface:iface.name,deadline:new Date(Date.now()+90000).toISOString()}}])assert.ok(load(null,state).NetworkWorkspace({onAdvanced:()=>{}}))});
test('enabling no-carrier interface does not issue down as a guessed toggle',()=>{const tree=load(null,{0:[iface],1:iface.name,10:'configuration'}).NetworkWorkspace({onAdvanced:()=>{}});assert.ok(nodes(tree).some(n=>n.type==='button'&&n.props.children.includes('Wyłącz interfejs')))});
test('physical totals exclude traffic already counted on bridge',()=>{const bridge={...iface,name:'br0',physical:false,kind:'bridge'},tree=load(null,{0:[iface,bridge],1:iface.name,4:{enp2s0:{rx:[2],tx:[1]},br0:{rx:[2],tx:[1]}},6:true}).NetworkWorkspace({onAdvanced:()=>{}});const strong=nodes(tree).filter(n=>n.type==='strong').map(n=>n.props.children[0]);assert.ok(strong.includes('2.00 MB/s'));assert.ok(!strong.includes('4.00 MB/s'))});

test('request timeout reports unknown mutation outcome and does not retry',async()=>{
 let calls=0;const ctx={window:{},AbortController,setTimeout:f=>{queueMicrotask(f);return 1},clearTimeout:()=>{},fetch:async(path,o)=>{calls++;return new Promise((resolve,reject)=>{const stop=()=>reject(Object.assign(Error('abort'),{name:'AbortError'}));if(o.signal.aborted)stop();else o.signal.addEventListener('abort',stop)})}};
 vm.createContext(ctx);vm.runInContext(compiled,ctx);
 await assert.rejects(()=>ctx.window.networkRequest('/network/changes',{action:'up'}),/Wynik zmiany jest nieznany/);assert.equal(calls,1);
});
test('parent cancellation is kept as AbortError rather than a server failure',async()=>{
 const signal=new AbortController();signal.abort();
 const h=load(async(p,o)=>{assert.equal(o.signal.aborted,true);throw Object.assign(Error('abort'),{name:'AbortError'})}).NetworkWorkspaceHelpers;
 await assert.rejects(()=>h.networkRequest('/network/interfaces',null,signal.signal),{name:'AbortError'});
});

test('advanced form keeps API errors visible and stays open after success',async()=>{
 const src=fs.readFileSync('web/static/screens-services.jsx','utf8');const a=src.indexOf('const EditIfaceModal'),b=src.indexOf('\nconst ',a+10);const fragment=esbuild.transformSync(src.slice(a,b),{loader:'jsx'}).code;
 for(const fail of [true,false]){
  const updates={};let n=0,closed=false;
  const ctx={window:{networkRequest:async()=>{if(fail)throw Error('DHCP timeout');return {state:'no-carrier',message:'Wykonano'}}},useStore:()=>({}),Modal:()=>{},Icon:()=>{},React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>{const id=n++;return [v,x=>{updates[id]=x}]},useEffect:()=>{}}};vm.createContext(ctx);vm.runInContext(fragment+';globalThis.render=EditIfaceModal;',ctx);
  const tree=ctx.render({iface:{name:'eth0',addresses:['10.0.0.2/24'],mtu:1500},onClose:()=>{closed=true}});
  const button=nodes(tree.props.footer).find(x=>x.type==='button'&&x.props.onClick?.constructor.name==='AsyncFunction');assert.ok(button);await button.props.onClick();
  assert.equal(closed,false);assert.equal(updates[8],false);if(fail)assert.equal(updates[7],'DHCP timeout');else assert.match(updates[9],/brak połączenia fizycznego/);
 }
});

test('server list hides container links while preserving host bridges and VLANs',()=>{
 const h=load().NetworkWorkspaceHelpers;
 const list=[{name:'eth0',physical:true,kind:'physical'},{name:'br0',kind:'bridge'},{name:'br-office',kind:'bridge'},{name:'eth0.100',kind:'vlan'},{name:'docker0',kind:'bridge'},{name:'vethabcd',kind:'virtual'},{name:'br-012345abcdef',kind:'bridge'}];
 assert.deepEqual(Array.from(h.netFilterInterfaces(list,'all',''),i=>i.name),['eth0','br0','br-office','eth0.100']);
 assert.deepEqual(Array.from(h.netFilterInterfaces(list,'containers',''),i=>i.name),['docker0','vethabcd','br-012345abcdef']);
 assert.equal(h.netFilterInterfaces(list,'bridge','').length,2);
 assert.equal(h.netFilterInterfaces(list,'all','docker').length,0);
});
