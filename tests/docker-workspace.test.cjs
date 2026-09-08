// Pure UI/API contracts. These tests do not substitute for a browser smoke test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const esbuild=require('esbuild');
const source=fs.readFileSync('web/static/screens-docker.jsx','utf8');
const compiled=esbuild.transformSync(source,{loader:'jsx',target:'es2020'}).code;
function load(fetch){
  const context={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},window:{},location:{hostname:'nas.local'},fetch};
  vm.createContext(context);
  vm.runInContext(compiled+'\nglobalThis.contracts={dockerAPI,problem,statusTone,DockerAppLink,DCStatus};',context);
  return context.contracts;
}
test('unhealthy running containers remain visible as problems',()=>{
  const ui=load();const c={state:'running',health:'unhealthy'};
  assert.equal(ui.problem(c),true);assert.equal(ui.statusTone(c),'bad');
  assert.match(JSON.stringify(ui.DCStatus({c})) ,/Błąd healthchecka/);
});
test('restarting and dead containers are problems; intentionally stopped containers are not',()=>{
  const ui=load();for(const state of ['restarting','dead'])assert.equal(ui.problem({state}),true);
  for(const state of ['exited','created','paused'])assert.equal(ui.problem({state}),false);
});
test('healthcheck startup is shown as pending rather than healthy',()=>{
  const ui=load();assert.equal(ui.statusTone({state:'running',health:'starting'}),'warn');
});
test('web links use the published host port and safe protocol',()=>{
  const ui=load();const c={state:'running',ports:'0.0.0.0:9443->443/tcp, [::]:9443->443/tcp'};
  const link=ui.DockerAppLink({c});assert.equal(link.props.href,'https://nas.local:9443');assert.equal(link.props.rel,'noopener noreferrer');
});
test('do not offer web links to UDP services, stopped containers or remote loopback',()=>{
  const ui=load();
  for(const c of [{state:'running',ports:'0.0.0.0:53->53/udp'},{state:'exited',ports:'0.0.0.0:80->80/tcp'},{state:'running',ports:'127.0.0.1:8080->80/tcp'}])assert.equal(ui.DockerAppLink({c}),null);
});
test('API refuses legacy HTTP 200 error payloads',async()=>{
  const ui=load(async()=>({ok:true,status:200,json:async()=>({error:'Docker unavailable'})}));
  await assert.rejects(()=>ui.dockerAPI('/services/docker/containers'),/Docker unavailable/);
});
test('API preserves saved-file information after a failed deployment',async()=>{
  const ui=load(async()=>({ok:false,status:500,json:async()=>({error:'Port occupied',saved:true,file:'/opt/stacks/media/compose.yml'})}));
  await assert.rejects(()=>ui.dockerAPI('/api/docker/workspace/compose'),e=>e.data.saved===true&&e.data.file==='/opt/stacks/media/compose.yml');
});
test('API rejects non-JSON success responses instead of showing a false success',async()=>{
  const ui=load(async()=>({ok:true,status:200,json:async()=>{throw new Error('bad JSON');}}));
  await assert.rejects(()=>ui.dockerAPI('/services/docker/container/id/start'),/Nieprawidłowa odpowiedź/);
});
