const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
const code=esbuild.transformSync(fs.readFileSync('web/static/screens-storage-detail.jsx','utf8'),{loader:'jsx',target:'es2020'}).code;
const ctx={React:{},window:{}};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.rules={storageHealth,storageNodes,storageCanMount};',ctx);const r=ctx.rules;
test('missing SMART never becomes PASSED',()=>{for(const s of [undefined,null,'unknown','N/A'])assert.equal(r.storageHealth(s),'unknown');assert.equal(r.storageHealth('passed'),'ok');assert.equal(r.storageHealth('failed'),'warn');});
test('whole-disk filesystem does not acquire invented partitions',()=>{const nodes=r.storageNodes({name:'sdb',fstype:'ext4',size:1000});assert.equal(nodes.length,1);assert.equal(nodes[0].name,'sdb');});
test('nested LVM layout preserves device order and hierarchy',()=>{const nodes=r.storageNodes({name:'nvme0n1',children:[{name:'nvme0n1p2',children:[{name:'vg-data',mountpoint:'/srv/data'}]}]});assert.equal(nodes.length,3);assert.equal(nodes[2].depth,2);assert.equal(nodes[2].mountpoint,'/srv/data');});
test('mount action targets filesystems and excludes storage members',()=>{assert.equal(r.storageCanMount({fstype:'ext3'}),true);for(const fstype of ['swap','zfs_member','LVM2_member','linux_raid_member','crypto_LUKS',''])assert.equal(r.storageCanMount({fstype}),false);assert.equal(r.storageCanMount({fstype:'ext4',mountpoint:'/data'}),false);});
