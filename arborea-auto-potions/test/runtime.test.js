'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {EventEmitter} = require('node:events')
const fs = require('node:fs')
const path = require('node:path')

function createRuntime(...args) {
  const file = path.resolve(__dirname, '../lib/runtime.js')
  assert.ok(fs.existsSync(file), 'The packet/lifecycle adapter has not been implemented')
  return require(file)(...args)
}
function fixture({missing, sendResult = true, sendThrows = false,realEngine = false,patch = 100,engineCatalog,engineSettings} = {}) {
  const hooks = [], intervals = new Map(), warnings = [], sent = [], updates = []
  const me = Object.assign(new EventEmitter(), {gameId:null,alive:null,inCombat:false,
    mounted:false,onPegasus:false,level:0,class:null})
  const inventory = Object.assign(new EventEmitter(), {pocketCount:1,pockets:[{slots:{}}],
    bagOrPocketItems:[{id:6552,dbid:9007199254740993n,amount:3,container:0,pocket:1},
      {id:6562,dbid:12n,amount:2,container:0,pocket:0}]})
  const game = Object.assign(new EventEmitter(), {me,inventory,contract:{active:false},
    isIngame:false,isInLoadingScreen:true,initialize(features) { this.features = features }})
  const calls = {ticks:0,resets:0,uses:[],cooldowns:[],inventories:[],rejects:[]}
  let time = 0, runtime
  const engine = realEngine ? new (require('../lib/engine').PotionEngine)({
    catalog:engineCatalog||{items:[
      {id:6552,name:'Health',hp:true,mp:false,cooldownMs:10000,group:'66',level:1,automatic:true,rank:1},
      {id:6562,name:'Mana',hp:false,mp:true,cooldownMs:10000,group:'67',level:1,automatic:true,rank:1}
    ]},settings:engineSettings||{...require('../lib/settings').defaults(),enabled:true},
    now:() => time,send:(...args) => runtime && runtime.send(...args)
  }) : {
    snapshot:{},pending:null,
    update(patch) { updates.push(patch); Object.assign(this.snapshot,patch) },
    tick() { calls.ticks++ },
    reset(options) { calls.resets++; calls.resetOptions = options; this.snapshot = {}; this.pending = null },
    inventoryChanged(items) { calls.inventories.push(items); this.snapshot.items = items },
    observeUse(id) { calls.uses.push(id) },
    cooldown(id,ms) { calls.cooldowns.push([id,ms]) },
    reject(reason) { calls.rejects.push(reason); this.pending = null },
    getState() { return {pending:this.pending} }
  }
  const mod = {
    majorPatchVersion:patch,game,
    hook(name,version,options,fn) {
      if (name === missing) throw new Error('Definition/opcode unavailable')
      const handle = {name,version,options,fn}; hooks.push(handle); return handle
    },
    unhook(handle) { const index = hooks.indexOf(handle); if (index >= 0) hooks.splice(index,1) },
    setInterval(fn,ms) { const id = intervals.size + 1; intervals.set(id,{fn,ms}); return id },
    clearInterval(id) { intervals.delete(id) },
    warn(message) { warnings.push(message) },
    parseSystemMessage(message) { if (typeof message !== 'string' || message[0] !== '@') throw Error('Malformed'); return {id:message.slice(1)} },
    send(name,version,payload) {
      sent.push({name,version,payload})
      emit(name,payload,{fake:true})
      if (sendThrows) throw Error('Write failed')
      return sendResult
    }
  }
  function emit(name,event = {},meta = {}) {
    const flags = {fake:false,modified:false,silenced:false,incoming:name.startsWith('S_'),...meta}
    for (const hook of hooks.filter(h => h.name === name)) {
      const filter = hook.options.filter || {}
      if (Object.keys(filter).some(key => filter[key] !== null && filter[key] !== flags[key])) continue
      assert.equal(hook.fn({...event,$fake:flags.fake,$incoming:flags.incoming}),undefined, 'Observation hooks must not silence or rewrite game packets')
    }
  }
  runtime = createRuntime(mod,engine)
  function login() {
    Object.assign(me,{gameId:1n,alive:true,level:70,class:'priest',inCombat:true})
    game.isIngame = true; game.isInLoadingScreen = true
    emit('S_LOGIN',{gameId:1n,alive:true})
    inventory.emit('update')
  }
  function spawn() {
    game.isInLoadingScreen = false
    emit('S_SPAWN_ME',{gameId:me.gameId,alive:true,loc:{x:1,y:2,z:3},w:0})
  }
  function stats(extra,meta) { emit('S_PLAYER_STAT_UPDATE',{hp:30n,maxHp:100n,mp:20,maxMp:100,...extra},meta) }
  function ready() { login(); spawn(); stats() }
  const item = {id:6552,level:1}
  const stack = inventory.bagOrPocketItems[0]
  return {mod,engine,calls,hooks,intervals,warnings,sent,updates,me,game,inventory,runtime,
    emit,login,spawn,stats,ready,item,stack,
    send:() => runtime.send(item,stack,engine.snapshot),
    advance:ms => { time += ms },
    pulse:() => { time += 250; for (const timer of intervals.values()) timer.fn() }}
}

test('construction stays paused with unknown resources and checks only on a 250 ms interval', () => {
  const f = fixture()
  assert.deepEqual(f.game.features,['inventory','contract'])
  assert.equal(f.calls.ticks,0)
  assert.equal(f.sent.length,0)
  assert.equal(f.intervals.size,1)
  assert.equal([...f.intervals.values()][0].ms,250)
  assert.equal(f.engine.snapshot.hp,null)
  assert.equal(f.send(),false)
  f.pulse(); assert.equal(f.calls.ticks,1)
})

test('supported stat, HP and MP definitions update only authoritative own resources', () => {
  const f = fixture(); f.ready()
  assert.equal(f.hooks.find(h => h.name === 'S_PLAYER_STAT_UPDATE').version,14)
  f.emit('S_CREATURE_CHANGE_HP',{target:2n,curHp:1n,maxHp:100n})
  assert.equal(f.engine.snapshot.hp,30)
  f.emit('S_CREATURE_CHANGE_HP',{target:1n,curHp:25n,maxHp:110n})
  f.emit('S_PLAYER_CHANGE_MP',{target:1n,currentMp:15,maxMp:120})
  assert.equal(f.engine.snapshot.hp,25); assert.equal(f.engine.snapshot.maxHp,110)
  assert.equal(f.engine.snapshot.mp,15); assert.equal(f.engine.snapshot.maxMp,120)
  f.stats({hp:1n,mp:1},{fake:true})
  f.emit('S_CREATURE_CHANGE_HP',{target:1n,curHp:1n,maxHp:100n},{fake:true})
  assert.equal(f.engine.snapshot.hp,25)
})

test('observation receives silenced or modified real resource packets without altering them', () => {
  const f = fixture(); f.ready()
  f.emit('S_PLAYER_CHANGE_MP',{target:1n,currentMp:10,maxMp:200},{silenced:true,modified:true})
  assert.equal(f.engine.snapshot.mp,10); assert.equal(f.engine.snapshot.maxMp,200)
})

test('real stack DBID, zero heading and all exact C_USE_ITEM3 fields survive sending', () => {
  const f = fixture(); f.ready()
  assert.equal(f.send(),true)
  assert.deepEqual(f.sent,[{name:'C_USE_ITEM',version:3,payload:{gameId:1n,id:6552,
    dbid:9007199254740993n,target:0n,amount:1,dest:{x:0,y:0,z:0},loc:{x:1,y:2,z:3},w:0,
    unk1:0,unk2:0,unk3:0,unk4:true}}])
  assert.deepEqual(f.calls.uses,[], 'The engine already owns its automatic reservation')
})

test('manual and other-mod item uses reserve their actual item once without blocking them', () => {
  const f = fixture(); f.ready()
  f.emit('C_USE_ITEM',{gameId:1n,id:6552})
  f.emit('C_USE_ITEM',{gameId:1n,id:6562},{fake:true})
  f.emit('C_USE_ITEM',{gameId:2n,id:6552})
  assert.deepEqual(f.calls.uses,[6552,6562])
})

test('only one exact own outgoing request is skipped; nested other-mod item uses remain observable', () => {
  const f = fixture(); f.ready()
  f.mod.send = (name,version,payload) => {
    f.sent.push({name,version,payload})
    f.emit(name,payload,{fake:true}) // This exact single request belongs to the engine.
    f.emit(name,{...payload,id:6562,dbid:12n},{fake:true})
    f.emit(name,{...payload,dbid:99n},{fake:true})
    f.emit(name,payload,{fake:true}) // An additional identical request is still external.
    assert.equal(f.send(),false, 'A nested call cannot recursively send another automatic request')
    return true
  }
  assert.equal(f.send(),true)
  assert.deepEqual(f.calls.uses,[6562,6552,6552])
  f.emit('C_USE_ITEM',{gameId:1n,id:6552,dbid:f.stack.dbid},{fake:true,incoming:true})
  assert.deepEqual(f.calls.uses,[6562,6552,6552], 'An incoming fake is not an item request to the server')
})

for (const flag of ['mounted','onPegasus']) test(`${flag} blocks sending with refreshed game state`, () => {
  const f = fixture(); f.ready(); f.me[flag] = true
  assert.equal(f.send(),false); assert.equal(f.sent.length,0)
})

test('inventory refresh only includes bag and pockets and makes no speculative decrement', () => {
  const f = fixture(); f.ready()
  f.inventory.bagOrPocketItems.push({id:6552,dbid:99n,amount:4,container:14,pocket:0})
  f.inventory.emit('update')
  assert.equal(f.engine.snapshot.inventoryReady,true)
  assert.equal(f.engine.snapshot.items.length,2)
  assert.equal(f.send(),true)
  assert.equal(f.inventory.bagOrPocketItems[0].amount,3)
  assert.equal(f.engine.snapshot.items[0].amount,3)
})

test('a stack removed since the decision and a lossy numeric DBID cannot be sent', () => {
  const f = fixture(); f.ready()
  f.inventory.bagOrPocketItems = []
  assert.equal(f.send(),false)
  f.inventory.bagOrPocketItems = [{...f.stack,dbid:9007199254740992}]
  assert.equal(f.runtime.send(f.item,f.inventory.bagOrPocketItems[0],f.engine.snapshot),false)
  assert.equal(f.sent.length,0)
})

test('server cooldown seconds are preserved even if another mod silences them', () => {
  const f = fixture(); f.ready()
  f.emit('S_START_COOLTIME_ITEM',{item:6552,cooldown:10},{silenced:true})
  f.emit('S_START_COOLTIME_ITEM',{item:6552,cooldown:0},{silenced:true})
  f.emit('S_START_COOLTIME_ITEM',{item:6552,cooldown:-1})
  assert.deepEqual(f.calls.cooldowns,[[6552,10000],[6552,0]])
})

test('system failures suspend only an outstanding attempt and success messages do not confirm use', () => {
  const f = fixture(); f.ready()
  f.emit('S_SYSTEM_MESSAGE',{message:'@SMT_CANT_USE_ITEM_NOW'})
  assert.deepEqual(f.calls.rejects,[])
  f.engine.pending = {itemId:6552}
  f.emit('S_SYSTEM_MESSAGE',{message:'@SMT_ITEM_USED'},{silenced:true})
  assert.ok(f.engine.pending)
  f.emit('S_SYSTEM_MESSAGE',{message:'invalid'})
  assert.ok(f.engine.pending)
  f.emit('S_SYSTEM_MESSAGE',{message:'@SMT_CANT_USE_ITEM_COOLTIME'},{silenced:true})
  assert.equal(f.calls.rejects.length,1)
  assert.match(f.calls.rejects[0],/unattributed/)
})

test('an accepted contract cannot clear a separately opened trade before the server closes it', () => {
  const f = fixture(); f.ready()
  f.game.contract.active = true; f.emit('S_REQUEST_CONTRACT',{id:1,type:1})
  assert.equal(f.send(),false)
  f.emit('S_TRADE_BOX')
  f.game.contract.active = false; f.emit('S_ACCEPT_CONTRACT')
  assert.equal(f.engine.snapshot.trading,true)
  assert.equal(f.send(),false)
  f.emit('S_TRADE_BAG_CLOSE')
  assert.equal(f.engine.snapshot.trading,false)
  assert.equal(f.send(),true)
})

test('loading resets old resources and position; spawn restores inventory but needs fresh stats', () => {
  const f = fixture(); f.ready()
  f.game.isInLoadingScreen = true; f.emit('S_LOAD_TOPO',{zone:1})
  assert.deepEqual(f.calls.resetOptions,{preserveCooldowns:true})
  assert.equal(f.engine.snapshot.hp,null); assert.equal(f.engine.snapshot.loc,null)
  assert.equal(f.engine.snapshot.inventoryReady,false); assert.equal(f.send(),false)
  f.spawn()
  assert.equal(f.engine.snapshot.inventoryReady,true)
  assert.equal(f.send(),false)
  f.stats(); assert.equal(f.send(),true)
})

test('death and resurrection invalidate resources without assuming a successful heal', () => {
  const f = fixture(); f.ready()
  f.me.alive = false; f.emit('S_CREATURE_LIFE',{gameId:1n,alive:false,loc:{x:1,y:2,z:3}})
  assert.equal(f.send(),false); assert.equal(f.engine.snapshot.hp,null)
  f.me.alive = true; f.emit('S_CREATURE_LIFE',{gameId:1n,alive:true,loc:{x:2,y:3,z:4}})
  assert.equal(f.send(),false)
  f.emit('C_PLAYER_LOCATION',{loc:{x:2,y:3,z:4},w:1})
  f.stats(); assert.equal(f.send(),true)
})

test('logout and a different character cannot inherit resources, position, trade or inventory readiness', () => {
  const f = fixture(); f.ready(); f.emit('S_TRADE_BOX')
  f.game.isIngame = false; f.me.gameId = null; f.emit('S_RETURN_TO_LOBBY')
  assert.equal(f.engine.snapshot.connected,false); assert.equal(f.send(),false)
  f.login(); f.me.gameId = 2n; f.emit('S_LOGIN',{gameId:2n,alive:true})
  assert.equal(f.engine.snapshot.hp,null); assert.equal(f.engine.snapshot.loc,null)
  assert.equal(f.engine.snapshot.trading,false); assert.equal(f.send(),false)
  f.emit('S_CREATURE_CHANGE_HP',{target:1n,curHp:10n,maxHp:100n})
  assert.equal(f.engine.snapshot.hp,null)
})

test('position notifications and server teleports update the exact latest coordinates', () => {
  const f = fixture(); f.ready()
  f.emit('C_NOTIFY_LOCATION_IN_ACTION',{loc:{x:4,y:5,z:6},w:2})
  f.emit('S_INSTANT_MOVE',{gameId:2n,loc:{x:90,y:90,z:90},w:1})
  assert.equal(f.send(),true)
  assert.deepEqual(f.sent.at(-1).payload.loc,{x:4,y:5,z:6})
  f.emit('S_INSTANT_MOVE',{gameId:1n,loc:{x:7,y:8,z:9},w:0})
  assert.equal(f.send(),true); assert.deepEqual(f.sent.at(-1).payload.loc,{x:7,y:8,z:9})
})

for (const packet of ['C_USE_ITEM','S_PLAYER_CHANGE_MP','S_TRADE_BOX']) test(`missing ${packet} fails closed with one clear warning`, () => {
  const f = fixture({missing:packet}); f.ready(); f.pulse()
  assert.equal(f.engine.snapshot.connected,false)
  assert.equal(f.send(),false); assert.equal(f.sent.length,0)
  assert.equal(f.warnings.length,1); assert.match(f.warnings[0],/unavailable|unsupported/i)
})

test('invalid maxima, overflowing HP and malformed positions cannot enter a potion request', () => {
  const f = fixture(); f.ready()
  f.stats({maxHp:0}); assert.equal(f.send(),false)
  f.stats({hp:9007199254740993n,maxHp:9007199254740995n}); assert.equal(f.send(),false)
  f.stats(); f.emit('C_PLAYER_LOCATION',{loc:{x:NaN,y:1,z:2},w:0})
  assert.equal(f.send(),false)
})

test('failed and throwing Toolbox writes report failure and always release the self-send guard', () => {
  for (const options of [{sendResult:false},{sendThrows:true}]) {
    const f = fixture(options); f.ready()
    assert.equal(f.send(),false)
    f.emit('C_USE_ITEM',{gameId:1n,id:6562},{fake:true})
    assert.deepEqual(f.calls.uses,[6562])
  }
})

test('destruction clears the timer, owned subscriptions and hooks exactly once', () => {
  const f = fixture(); f.ready()
  const unrelated = () => {}; f.inventory.on('update',unrelated)
  f.runtime.destructor(); f.runtime.destructor()
  assert.equal(f.intervals.size,0); assert.equal(f.hooks.length,0)
  assert.deepEqual(f.inventory.listeners('update'),[unrelated])
  assert.equal(f.send(),false)
  const ticks = f.calls.ticks; f.pulse(); assert.equal(f.calls.ticks,ticks)
})

test('all thirteen exact UserData class strings normalize to the engine numeric class contract', () => {
  const classes = ['warrior','lancer','slayer','berserker','sorcerer','archer','priest',
    'elementalist','soulless','engineer','fighter','assassin','glaiver']
  const f = fixture(); f.ready()
  classes.forEach((name,index) => {
    f.me.class = name; f.pulse(); assert.equal(f.engine.snapshot.class,index)
  })
  f.me.class = 'unknown'; f.pulse(); assert.equal(f.engine.snapshot.class,null)
})

test('an unverified patch cannot use the patch100 packet profile', () => {
  const f = fixture({patch:92}); f.ready(); f.pulse()
  assert.equal(f.send(),false); assert.equal(f.engine.snapshot.connected,false)
  assert.equal(f.warnings.length,1)
})

test('an unsupported packet profile is visible immediately and after lifecycle resets in the real engine', () => {
  const f = fixture({realEngine:true,patch:92})
  assert.match(f.engine.getState().reason,/Auto Potions unavailable: patch 92/)
  f.ready(); f.emit('S_RETURN_TO_LOBBY'); f.pulse()
  assert.match(f.engine.getState().reason,/Auto Potions unavailable: patch 92/)
  assert.equal(f.sent.length,0)
})

test('login restarts one timer after Toolbox clears all mod intervals on leaving the game', () => {
  const f = fixture({realEngine:true}); f.ready(); f.stats({mp:100})
  assert.equal(f.intervals.size,1)
  f.pulse(); assert.equal(f.sent.length,1)
  f.emit('S_RETURN_TO_LOBBY'); f.game.isIngame = false
  f.intervals.clear() // Installed Toolbox's leave_game handler clears mod timers.
  assert.equal(f.intervals.size,0)
  f.ready(); f.stats({mp:100})
  assert.equal(f.intervals.size,1, 'A new login must restore the bounded automation timer')
  f.pulse(); assert.equal(f.sent.length,2)
  f.login(); assert.equal(f.intervals.size,1, 'Repeated login initialization must replace, not duplicate, its timer')
  f.runtime.destructor(); assert.equal(f.intervals.size,0)
})

test('inventory is suspended between multipart packets and enabled only after the stitched batch', () => {
  const f = fixture(); f.ready()
  f.inventory._buffer = {items:[]}
  f.emit('S_ITEMLIST',{gameId:1n,container:0,more:true,lastInBatch:false})
  assert.equal(f.engine.snapshot.inventoryReady,false); assert.equal(f.send(),false)
  f.inventory._buffer = null
  f.inventory.emit('update')
  f.emit('S_ITEMLIST',{gameId:1n,container:0,more:false,lastInBatch:true})
  assert.equal(f.engine.snapshot.inventoryReady,true); assert.equal(f.send(),true)
})

test('an equipment-first inventory batch blocks cached potion stacks until every container is complete', () => {
  const f = fixture(); f.ready()
  f.emit('S_ITEMLIST',{gameId:2n,container:14,first:true,more:false,lastInBatch:false})
  assert.equal(f.engine.snapshot.inventoryReady,true, 'Another character cannot close own inventory readiness')
  f.emit('S_ITEMLIST',{gameId:1n,container:14,first:true,more:false,lastInBatch:false})
  assert.equal(f.engine.snapshot.inventoryReady,false)
  assert.equal(f.send(),false)
  f.spawn(); f.inventory.emit('update')
  assert.equal(f.engine.snapshot.inventoryReady,false, 'A refresh cannot reopen an incomplete batch')
  assert.equal(f.send(),false)
  f.inventory.bagOrPocketItems = []
  f.inventory.emit('update')
  f.emit('S_ITEMLIST',{gameId:1n,container:0,first:true,more:false,lastInBatch:true})
  assert.equal(f.engine.snapshot.inventoryReady,true)
  assert.equal(f.engine.snapshot.items.length,0)
  assert.equal(f.send(),false)
  assert.equal(f.sent.length,0)
})

test('a completed equipment-last batch refreshes bag ownership instead of waiting for another bag packet', () => {
  const f = fixture(); f.ready()
  f.emit('S_ITEMLIST',{gameId:1n,container:0,first:true,more:false,lastInBatch:false})
  assert.equal(f.engine.snapshot.inventoryReady,false)
  f.inventory.emit('update')
  f.emit('S_ITEMLIST',{gameId:1n,container:14,first:true,more:false,lastInBatch:true})
  assert.equal(f.engine.snapshot.inventoryReady,true)
  assert.equal(f.send(),true)
})

test('same-character loading cannot unlock an inventory batch which was still incomplete', () => {
  const f = fixture(); f.ready()
  f.emit('S_ITEMLIST',{gameId:1n,container:14,first:true,more:false,lastInBatch:false})
  f.game.isInLoadingScreen = true; f.emit('S_LOAD_TOPO',{zone:2})
  f.spawn(); f.stats()
  assert.equal(f.engine.snapshot.inventoryReady,false)
  assert.equal(f.send(),false)
  f.inventory.emit('update')
  f.emit('S_ITEMLIST',{gameId:1n,container:0,first:true,more:false,lastInBatch:true})
  assert.equal(f.engine.snapshot.inventoryReady,true)
  assert.equal(f.send(),true)
})

test('the real engine sends only on its timer; cooldown confirms a request and inventory change releases it unconfirmed', () => {
  const f = fixture({realEngine:true}); f.ready()
  assert.equal(f.sent.length,0); assert.equal(f.engine.snapshot.class,6)
  f.pulse(); assert.equal(f.sent.length,1)
  assert.equal(f.sent[0].payload.id,6552)
  assert.ok(f.engine.getState().pending)
  f.stats({hp:80n}); assert.ok(f.engine.getState().pending)
  f.emit('S_START_COOLTIME_ITEM',{item:6552,cooldown:10})
  assert.equal(f.engine.getState().pending,null)
  f.advance(1000); f.pulse(); assert.equal(f.sent.length,2)
  assert.equal(f.sent[1].payload.id,6562)
  f.inventory.bagOrPocketItems[1].amount--
  f.inventory.emit('update')
  assert.equal(f.engine.getState().pending,null)
  assert.match(f.engine.getState().lastAction.result,/Inventory stack changed; use unconfirmed/)
})

test('same-character zoning preserves an actual shared cooldown in the real engine', () => {
  const f = fixture({realEngine:true}); f.ready(); f.stats({mp:100})
  f.pulse(); assert.equal(f.sent.length,1)
  f.emit('S_START_COOLTIME_ITEM',{item:6552,cooldown:10})
  f.game.isInLoadingScreen = true; f.emit('S_LOAD_TOPO',{zone:1})
  f.spawn(); f.stats({mp:100}); f.advance(1000); f.pulse()
  assert.equal(f.sent.length,1)
  assert.ok(f.engine.getState().channels.hp.readyInMs > 0)
})

for(const [kind,primary,backup] of [['hp',6553,116],['mp',6563,130]]) {
  test(`the real ${kind.toUpperCase()} packet path uses an independent configured backup on the second loss two seconds later`,()=>{
    const settings=require('../lib/settings').defaults()
    settings.enabled=true;settings.hp.enabled=kind==='hp';settings.mp.enabled=kind==='mp'
    settings[kind].itemId=primary;settings[kind].fallbackItemIds=[backup]
    const f=fixture({realEngine:true,engineCatalog:require('../data/potions.json'),engineSettings:settings})
    f.inventory.bagOrPocketItems=[
      {id:primary,dbid:9007199254740993n,amount:5,container:0,pocket:1},
      {id:backup,dbid:9007199254740994n,amount:5,container:0,pocket:0}
    ]
    f.ready();f.stats(kind==='hp'?{hp:40n,mp:100}:{hp:100n,mp:20})
    assert.equal(f.sent.length,0,'Resource packets cannot directly use an item')
    f.pulse();assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.id,primary)
    f.emit('S_START_COOLTIME_ITEM',{item:primary,cooldown:10})
    const loss=value=>kind==='hp'?f.emit('S_CREATURE_CHANGE_HP',{target:1n,curHp:BigInt(value),maxHp:100n}):
      f.emit('S_PLAYER_CHANGE_MP',{target:1n,currentMp:value,maxMp:100})
    loss(90);f.advance(1500);f.pulse()
    assert.equal(f.sent.length,1,'No backup is consumed when resources recovered')
    loss(kind==='hp'?40:20);assert.equal(f.sent.length,1)
    f.pulse();assert.equal(f.sent.length,2)
    assert.deepEqual(f.sent.map(p=>p.payload.id),[primary,backup])
    assert.equal(f.sent[1].version,3);assert.equal(f.sent[1].payload.dbid,9007199254740994n)
    assert.ok(f.engine.getState().pending,'Fallback still needs its own acknowledgement')
    f.pulse();assert.equal(f.sent.length,2)
    f.emit('S_START_COOLTIME_ITEM',{item:backup,cooldown:30})
    f.game.isInLoadingScreen=true;f.emit('S_LOAD_TOPO',{zone:2});f.spawn()
    f.stats(kind==='hp'?{hp:40n,mp:100}:{hp:100n,mp:20});f.advance(1000);f.pulse()
    assert.equal(f.sent.length,2,'Zoning cannot forget either independent group lock')
    f.runtime.destructor()
  })
}
