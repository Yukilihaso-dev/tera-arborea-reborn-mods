'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {PotionEngine}=require('../lib/engine')
const {defaults}=require('../lib/settings')
const catalog={observerItems:[{id:90,group:'hp',cooldownMs:10000}],items:[
  {id:1,name:'Health',hp:true,mp:false,cooldownMs:10000,group:'hp',level:1,automatic:true,rank:1},
  {id:2,name:'Mana',hp:false,mp:true,cooldownMs:10000,group:'mp',level:1,automatic:true,rank:1},
  {id:3,name:'Rejuvenation',hp:true,mp:true,cooldownMs:30000,group:'shared',level:1,automatic:false,rank:2},
  {id:4,name:'Strong health',hp:true,mp:false,cooldownMs:10000,group:'hp',level:65,automatic:true,rank:3},
  {id:5,name:'Precious health',hp:true,mp:false,cooldownMs:10000,group:'hp',level:1,automatic:false,valuable:true,rank:9}
]}
function fixture(settingsPatch={}){
  let time=1000;const sent=[];const settings={...defaults(),enabled:true,...settingsPatch}
  const engine=new PotionEngine({catalog,settings,now:()=>time,send:(...args)=>{sent.push(args);return true}})
  engine.update({connected:true,loading:false,alive:true,inCombat:true,inventoryReady:true,hp:20,maxHp:100,mp:20,maxMp:100,level:70,class:6,loc:{x:1,y:2,z:3},w:0})
  engine.inventoryChanged([{id:1,dbid:101n,amount:3},{id:2,dbid:102n,amount:3}])
  return {engine,sent,advance:(ms)=>time+=ms,settings}
}
test('only explicit tick sends and HP takes priority; snapshots are JSON-safe',()=>{
  const {engine,sent,settings}=fixture();engine.getState();engine.setSettings(settings)
  assert.equal(sent.length,0);engine.tick();assert.equal(sent.length,1);assert.equal(sent[0][0].id,1)
  assert.equal(sent[0][1].dbid,101n);assert.doesNotThrow(()=>JSON.stringify(engine.getState()))
})
test('cooldown confirmation releases pending and independent MP can follow after spacing',()=>{
  const {engine,sent,advance}=fixture();engine.tick();engine.cooldown(1,10000);engine.tick();assert.equal(sent.length,1)
  advance(1100);engine.tick();assert.equal(sent.length,2);assert.equal(sent[1][0].id,2)
  engine.cooldown(2,10000);advance(1100);engine.tick();assert.equal(sent.length,2)
})
test('shared manual cooldown blocks related variants including stronger auto selection',()=>{
  const {engine,sent}=fixture();engine.inventoryChanged([{id:4,dbid:104n,amount:2}]);engine.observeUse(1);engine.tick()
  assert.equal(sent.length,0);assert.equal(engine.getState().channels.hp.itemId,4)
  assert.ok(engine.getState().channels.hp.readyInMs>=10000)
})
test('ordinary strongest owned potion is selected; valuable is never automatic',()=>{
  const {engine,sent}=fixture();engine.inventoryChanged([{id:1,dbid:101n,amount:2},{id:4,dbid:104n,amount:1},{id:5,dbid:105n,amount:1}])
  engine.tick();assert.equal(sent[0][0].id,4)
  engine.reset();assert.equal(engine.getState().live.connected,false);engine.tick();assert.equal(sent.length,1)
})
test('every readiness guard blocks use',()=>{
  for(const patch of [{connected:false},{loading:true},{alive:false},{mounted:true},{trading:true},{inventoryReady:false},{inCombat:false},{hp:null},{hp:0},{maxHp:0},{mp:NaN},{maxMp:Infinity},{loc:null},{w:NaN},{level:0},{class:null}]) {
    const {engine,sent}=fixture();engine.update(patch);engine.tick();assert.equal(sent.length,0,JSON.stringify(patch))
  }
  const {engine,sent}=fixture({enabled:false});engine.tick();assert.equal(sent.length,0)
})
test('an unsupported packet profile is clearly visible in the GUI waiting reason',()=>{
  const {engine,sent}=fixture();engine.update({connected:false,blockedReason:'Required packet S_PLAYER_CHANGE_MP.1 unavailable'})
  engine.tick();assert.equal(sent.length,0);assert.match(engine.getState().reason,/Required packet/)
})
test('bad, empty and zero-DBID inventory cannot be consumed',()=>{
  for(const items of [[],[{id:1,dbid:0n,amount:2}],[{id:1,dbid:101n,amount:0}],[{id:1,dbid:101n,amount:NaN}]]) {
    const {engine,sent}=fixture();engine.inventoryChanged(items);engine.tick();assert.equal(sent.length,0)
  }
})
test('strictly below threshold only, and actual max resources determine percentages',()=>{
  const {engine,sent}=fixture();engine.update({hp:500,maxHp:1000,mp:300,maxMp:1000});engine.tick();assert.equal(sent.length,0)
  engine.update({hp:499});engine.tick();assert.equal(sent.length,1)
})
test('combined either/both policy avoids hidden cross-resource triggers',()=>{
  for(const policy of ['either','both']) {
    const {engine,sent}=fixture({hp:{enabled:true,threshold:50,itemId:3},mp:{enabled:true,threshold:30,itemId:3},combinedPolicy:policy})
    engine.inventoryChanged([{id:3,dbid:103n,amount:2}]);engine.update({mp:90});engine.tick()
    assert.equal(sent.length,policy==='both'?0:1)
    if(policy==='both'){engine.update({mp:20});engine.tick();assert.equal(sent.length,1)}
  }
})
test('no acknowledgement means bounded retries and no simultaneous requests',()=>{
  const {engine,sent,advance}=fixture();engine.tick();advance(2000);engine.tick();assert.equal(sent.length,1)
  advance(1000);engine.tick();assert.equal(sent.length,1)
  advance(3000);engine.tick();assert.equal(sent.length,2);assert.equal(sent[1][0].id,2)
  advance(3000);engine.tick();assert.equal(sent.length,2)
  advance(1000);engine.tick();assert.equal(sent.length,2)
})
test('inventory stack decrease confirms only the sent stack, not unrelated healing',()=>{
  const {engine,sent,advance}=fixture();engine.tick();engine.update({hp:100});assert.ok(engine.getState().pending)
  engine.inventoryChanged([{id:1,dbid:101n,amount:2},{id:2,dbid:102n,amount:3}]);assert.equal(engine.getState().pending,null)
  advance(1100);engine.tick();assert.equal(sent.length,2)
})
test('failed sends and item rejection do not spin or claim success',()=>{
  let now=0,calls=0;const {engine}=fixture();engine.send=()=>{calls++;return false};engine.now=()=>now
  engine.tick();for(let i=0;i<8;i++){now+=250;engine.tick()}assert.equal(calls,1)
  assert.match(engine.getState().lastAction.result,/failed/)
})
test('invalid server cooldown never clears reservation or permits a burst',()=>{
  const {engine,sent,advance}=fixture();engine.tick();engine.cooldown(1,NaN);engine.cooldown(1,-1);engine.cooldown(1,0)
  advance(1000);engine.tick();assert.equal(sent.length,1)
})
test('automatic selection falls back to a ready ordinary potion from a different cooldown group',()=>{
  const {engine,sent}=fixture();const extra={id:6,name:'Ordinary alternate',hp:true,mp:false,cooldownMs:30000,group:'alternate',level:1,automatic:true,rank:0}
  engine.items.push(extra);engine.catalog.set(6,extra)
  engine.inventoryChanged([{id:4,dbid:104n,amount:2},{id:6,dbid:106n,amount:2}])
  engine.cooldown(4,10000);engine.tick();assert.equal(sent.length,1);assert.equal(sent[0][0].id,6)
})
test('explicit unavailable selection never substitutes another potion',()=>{
  const {engine,sent}=fixture({hp:{enabled:true,threshold:50,itemId:5},mp:{enabled:false,threshold:30,itemId:0}})
  engine.tick();assert.equal(sent.length,0);assert.match(engine.getState().reason,/No usable HP/)
})
test('ID-less failures cannot falsely blame an own request after another mod uses an item',()=>{
  const {engine}=fixture();engine.tick();engine.observeUse(999);engine.reject('cannot use item')
  assert.ok(engine.getState().pending);assert.match(engine.getState().lastAction.result,/awaiting confirmation/)
})
test('nonselectable items in the same shared group reserve cooldown without entering potion choices',()=>{
  for(const event of ['manual','server']){
    const {engine,sent}=fixture();engine.inventoryChanged([{id:1,dbid:101n,amount:2}])
    if(event==='manual')engine.observeUse(90);else engine.cooldown(90,10000)
    engine.tick();assert.equal(sent.length,0);assert.ok(engine.getState().channels.hp.readyInMs>=10000)
    assert.ok(!engine.getState().potions.some(i=>i.id===90))
  }
})
test('cooldown from an intervening same-item use cannot claim own request confirmation',()=>{
  const {engine}=fixture();engine.tick();engine.observeUse(1);engine.cooldown(1,10000)
  assert.ok(engine.getState().pending);assert.match(engine.getState().lastAction.result,/attribution uncertain/)
})
test('inventory removal is reported as unconfirmed change rather than successful potion consumption',()=>{
  const {engine}=fixture();engine.tick();engine.inventoryChanged([])
  assert.match(engine.getState().lastAction.result,/stack changed; use unconfirmed/)
  assert.equal(engine.getState().pending,null)
})
test('a nested external use during the outgoing send makes later acknowledgement ambiguous',()=>{
  const {engine}=fixture();engine.send=()=>{engine.observeUse(1);return true}
  engine.tick();engine.cooldown(1,10000)
  assert.ok(engine.getState().pending);assert.match(engine.getState().lastAction.result,/attribution uncertain/)
})
