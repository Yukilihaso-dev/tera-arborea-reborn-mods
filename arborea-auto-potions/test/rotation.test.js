'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {PotionEngine}=require('../lib/engine')
const {defaults,normalize,validate}=require('../lib/settings')
const catalog=require('../data/potions.json')

function fixture(kind='hp',primary=6553,fallbacks=[116],source=catalog){
  let time=1000
  const sent=[],settings=defaults()
  settings.enabled=true
  settings.hp.enabled=kind==='hp';settings.mp.enabled=kind==='mp'
  settings[kind]={...settings[kind],itemId:primary,fallbackItemIds:fallbacks}
  const engine=new PotionEngine({catalog:source,settings,now:()=>time,send:(item,stack)=>{sent.push({id:item.id,dbid:stack.dbid});return true}})
  engine.update({connected:true,loading:false,alive:true,inCombat:true,inventoryReady:true,hp:40,maxHp:100,mp:20,maxMp:100,level:70,class:6,loc:{x:0,y:0,z:0},w:0})
  engine.inventoryChanged([primary,...fallbacks].map((id,index)=>({id,dbid:BigInt(index+1),amount:5})))
  return {engine,sent,settings,advance:ms=>time+=ms}
}

test('a second HP drop uses the explicit independent fallback while its preferred potion cools down',()=>{
  const f=fixture()
  assert.equal(f.engine.tick(),true);assert.deepEqual(f.sent.map(i=>i.id),[6553])
  f.engine.cooldown(6553,10000)
  f.engine.update({hp:90});f.advance(2000);assert.equal(f.engine.tick(),false)
  f.engine.update({hp:40});assert.equal(f.engine.tick(),true)
  assert.deepEqual(f.sent.map(i=>i.id),[6553,116])
  f.engine.cooldown(116,30000);f.advance(8000)
  assert.equal(f.engine.tick(),true,'Preferred potion regains priority when its own group expires')
  assert.deepEqual(f.sent.map(i=>i.id),[6553,116,6553])
})

test('MP uses its ordered independently cooling alternative after the ordinary MP group is reserved',()=>{
  const f=fixture('mp',6563,[130])
  f.engine.tick();f.engine.cooldown(6563,10000);f.advance(2000)
  assert.equal(f.engine.tick(),true)
  assert.deepEqual(f.sent.map(i=>i.id),[6563,130])
})

test('Automatic HP uses a second independent ordinary group two seconds after a new HP drop',()=>{
  const f=fixture('hp',0,[])
  f.engine.inventoryChanged([{id:116,dbid:1n,amount:5},{id:6553,dbid:2n,amount:5}])
  f.engine.tick();f.engine.cooldown(116,30000);f.engine.update({hp:90});f.advance(2000)
  assert.equal(f.engine.tick(),false)
  f.engine.update({hp:40});f.engine.tick()
  assert.deepEqual(f.sent.map(i=>i.id),[116,6553])
})

test('Automatic MP needs an explicit independent backup because ordinary MP items share group67',()=>{
  for(const fallbacks of [[],[130]]){
    const f=fixture('mp',0,fallbacks)
    f.engine.inventoryChanged([{id:209208,dbid:1n,amount:5},{id:6563,dbid:2n,amount:5},{id:130,dbid:3n,amount:5}])
    f.engine.tick();f.engine.cooldown(209208,10000);f.engine.update({mp:90});f.advance(2000)
    assert.equal(f.engine.tick(),false)
    f.engine.update({mp:20});f.engine.tick()
    assert.deepEqual(f.sent.map(i=>i.id),fallbacks.length?[209208,130]:[209208])
  }
})

test('a fallback sharing the first group cannot bypass its lock but a later independent one can',()=>{
  const f=fixture('hp',6553,[209205,116])
  f.engine.tick();f.engine.cooldown(6553,10000);f.advance(2000);f.engine.tick()
  assert.deepEqual(f.sent.map(i=>i.id),[6553,116])
  const only=fixture('hp',6553,[209205])
  only.engine.observeUse(6553);only.advance(2000)
  assert.equal(only.engine.tick(),false)
  assert.equal(only.sent.length,0)
})

test('priority skips absent or character-ineligible fallbacks without choosing an unlisted potion',()=>{
  const f=fixture('hp',6553,[209205,116])
  f.engine.inventoryChanged([{id:116,dbid:3n,amount:1},{id:209206,dbid:4n,amount:1}])
  f.engine.tick();assert.deepEqual(f.sent,[{id:116,dbid:3n}])
  const restricted=fixture('hp',6553,[116])
  restricted.engine.update({level:32});restricted.engine.tick()
  assert.deepEqual(restricted.sent.map(i=>i.id),[116])
})

test('manual use of another shared variant blocks every configured item in that group',()=>{
  const f=fixture('hp',6553,[116])
  f.engine.observeUse(209206);f.engine.observeUse(1);f.advance(2000)
  assert.equal(f.engine.tick(),false)
  assert.equal(f.sent.length,0)
})

test('rotation cannot bypass pending acknowledgement, global spacing or failed-send backoff',()=>{
  const f=fixture()
  f.engine.tick();f.advance(2000);assert.equal(f.engine.tick(),false,'Pending remains global across the list')
  f.engine.cooldown(6553,10000);f.engine.tick()
  assert.equal(f.sent.length,2)
  f.engine.cooldown(116,30000);f.advance(200)
  assert.equal(f.engine.tick(),false)
  const failed=fixture();let calls=0
  failed.engine.send=()=>{calls++;return false}
  failed.engine.tick();failed.advance(2000);failed.engine.tick()
  assert.equal(calls,1,'A failed preferred send does not immediately try another item')
})

test('a combined-only-both candidate does not block a later permitted single-resource fallback',()=>{
  const f=fixture('hp',7219,[116])
  f.settings.combinedPolicy='both';f.engine.setSettings(f.settings);f.engine.update({mp:90})
  f.engine.tick();assert.deepEqual(f.sent.map(i=>i.id),[116])
})

test('rotation state shows each listed item ownership, shared group and current independent lock',()=>{
  const f=fixture('hp',6553,[116])
  f.engine.cooldown(6553,10000)
  const state=f.engine.getState()
  assert.equal(state.channels.hp.itemId,116)
  assert.deepEqual(state.channels.hp.rotation.map(i=>({id:i.itemId,owned:i.owned,group:i.group,readyInMs:i.readyInMs})),[
    {id:6553,owned:5,group:'66',readyInMs:10000},{id:116,owned:5,group:'3',readyInMs:0}
  ])
  assert.doesNotThrow(()=>JSON.stringify(state))
})

test('legacy single selections migrate without adding extra consumption and new defaults remain paused',()=>{
  const s=normalize({enabled:false,hp:{itemId:6553,threshold:40},mp:{itemId:6563}})
  assert.deepEqual(s.hp,{enabled:true,threshold:40,itemId:6553,fallbackItemIds:[]})
  assert.deepEqual(s.mp.fallbackItemIds,[])
  assert.equal(defaults().enabled,false)
})

test('ordered fallback IDs are preserved, copied and accepted only for the correct resource',()=>{
  const s=defaults();s.hp.itemId=6553;s.hp.fallbackItemIds=[116,209205];s.mp.fallbackItemIds=[130]
  assert.equal(validate(s,catalog).ok,true)
  const n=normalize(s);s.hp.fallbackItemIds.reverse()
  assert.deepEqual(n.hp.fallbackItemIds,[116,209205])
  const wrong=defaults();wrong.hp.fallbackItemIds=[6563]
  assert.equal(validate(wrong,catalog).ok,false)
})

test('strict list validation rejects unknown, duplicate, zero, oversized and accessor payloads without executing them',()=>{
  const badLists=[[999999],[0],[116,116],Array(8).fill(116),[NaN],['116'],null,new Array(1)]
  for(const list of badLists){const s=defaults();s.hp.fallbackItemIds=list;assert.equal(validate(s,catalog).ok,false)}
  const same=defaults();same.hp.itemId=116;same.hp.fallbackItemIds=[116]
  assert.equal(validate(same,catalog).ok,false)
  let ran=false
  const accessor=[];Object.defineProperty(accessor,'0',{enumerable:true,get(){ran=true;throw Error('must not execute')}})
  const s=defaults();s.hp.fallbackItemIds=accessor
  assert.equal(validate(s,catalog).ok,false);assert.equal(ran,false)
  assert.deepEqual(normalize(s).hp.fallbackItemIds,[]);assert.equal(ran,false)
})

test('ordered backups persist through the real controller before activation without requesting any item',()=>{
  const f=fixture('hp',6553,[116,209205]),mod={settings:f.settings}
  let written
  const controller=require('../lib/gui-controller').createController({mod,engine:f.engine,store:{save:s=>{
    assert.deepEqual(f.engine.settings.hp.fallbackItemIds,[116,209205])
    written=structuredClone(s);return {ok:true}
  }}})
  const state=controller.getState(),next=structuredClone(state.settings)
  next.hp.fallbackItemIds=[209205,116]
  assert.equal(controller.saveSettings({settings:next,revision:state.revision}).ok,true)
  assert.deepEqual(written.hp.fallbackItemIds,[209205,116])
  assert.deepEqual(f.engine.settings.hp.fallbackItemIds,[209205,116])
  assert.equal(f.sent.length,0)
  controller.destructor()
})

test('a priority-only change by another client invalidates the old GUI revision',()=>{
  const f=fixture('hp',6553,[116,209205]),mod={settings:f.settings}
  const controller=require('../lib/gui-controller').createController({mod,engine:f.engine,store:{save:()=>{throw Error('Stale list must not persist')}}})
  const old=controller.getState()
  mod.settings.hp.fallbackItemIds.reverse()
  const result=controller.saveSettings({settings:old.settings,revision:old.revision})
  assert.equal(result.ok,false);assert.equal(result.conflict,true)
  assert.deepEqual(mod.settings.hp.fallbackItemIds,[209205,116])
  assert.equal(f.sent.length,0);controller.destructor()
})

test('a single explicit primary preserves the old no-substitution behavior until a backup is selected',()=>{
  const f=fixture('hp',6553,[])
  f.engine.inventoryChanged([{id:6553,dbid:1n,amount:5},{id:116,dbid:2n,amount:5}])
  f.engine.cooldown(6553,10000);assert.equal(f.engine.tick(),false)
  assert.equal(f.sent.length,0)
})

test('an array with an out-of-range numeric property cannot hide unknown save fields',()=>{
  const s=defaults();s.hp.fallbackItemIds=[116]
  s.hp.fallbackItemIds['4294967295']=6553
  assert.equal(validate(s,catalog).ok,false)
  assert.deepEqual(normalize(s).hp.fallbackItemIds,[])
})
