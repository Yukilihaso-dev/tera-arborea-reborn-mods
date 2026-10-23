'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

function fixture(store = {save: () => ({ok: true})}) {
  const {defaults} = require('../lib/settings')
  const {createController} = require('../lib/gui-controller')
  const shared = defaults(), calls = []
  const mod = new Proxy({}, {get: (_, key) => key === 'settings' ? shared : undefined})
  const engine = {getState: () => ({status:'paused', reason:'disabled', live:{connected:false}, potions:[]}),
    setSettings: value => calls.push(structuredClone(value)), tick: () => { throw Error('GUI must not tick') }}
  return {controller:createController({mod, engine, store}), shared, calls}
}

test('state reads never send, tick or expose mutable settings references', () => {
  const f = fixture(), first = f.controller.getState()
  assert.match(first.revision, /^[a-f0-9]{64}$/)
  assert.equal(first.settings.enabled, false)
  first.settings.enabled = true
  first.defaults.hp.threshold = 99
  assert.equal(f.controller.getState().settings.enabled, false)
  assert.equal(f.controller.getState().defaults.hp.threshold, 50)
  assert.deepEqual(f.calls, [])
})

test('save persists before applying through the shared Toolbox settings object, without a tick', () => {
  let f, written
  f = fixture({save: settings => { assert.equal(f.shared.enabled, false); written = structuredClone(settings); return {ok:true} }})
  const state = f.controller.getState(), settings = {...state.settings, enabled:true}
  const result = f.controller.saveSettings({settings, revision:state.revision})
  assert.equal(result.ok, true)
  assert.equal(f.shared.enabled, true)
  assert.deepEqual(written, settings)
  assert.deepEqual(f.calls, [settings])
  assert.notEqual(result.state.revision, state.revision)
})

test('stale revisions never overwrite a concurrent change or call storage', () => {
  const f = fixture({save: () => { throw Error('must not save') }})
  const old = f.controller.getState()
  f.shared.combatOnly = false
  const result = f.controller.saveSettings({settings:{...old.settings,enabled:true}, revision:old.revision})
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true)
  assert.equal(f.shared.enabled, false)
  assert.deepEqual(f.calls, [])
})

test('invalid threshold and foreign payload keys fail without changing persistent or live settings', () => {
  const f = fixture({save: () => { throw Error('must not save') }})
  const state = f.controller.getState()
  const invalid = structuredClone(state.settings); invalid.hp.threshold = 100
  for(const payload of [{settings:invalid, revision:state.revision},
    {settings:state.settings, revision:state.revision, filename:'elsewhere.json'}]) {
    assert.equal(f.controller.saveSettings(payload).ok, false)
  }
  assert.deepEqual(f.calls, [])
  assert.equal(f.shared.hp.threshold, 50)
})

test('a failed or thrown persistent save never activates automation', () => {
  for(const save of [() => ({ok:false,error:'disk full'}), () => { throw Error('disk full') }]) {
    const f = fixture({save}), state = f.controller.getState()
    const result = f.controller.saveSettings({settings:{...state.settings, enabled:true}, revision:state.revision})
    assert.equal(result.ok, false)
    assert.match(result.error, /disk full/)
    assert.equal(f.shared.enabled, false)
    assert.deepEqual(f.calls, [])
  }
})

function realPeer(shared, store = {save: () => ({ok:true})}) {
  const {PotionEngine} = require('../lib/engine')
  const {createController} = require('../lib/gui-controller')
  const sent = []
  const engine = new PotionEngine({settings:shared, now:()=>1000, send:(...args)=>{sent.push(args);return true},
    catalog:{items:[{id:1,name:'Fixture HP potion',hp:true,mp:false,automatic:true,level:1,rank:1,group:'hp',cooldownMs:1000}]}})
  engine.update({connected:true,loading:false,alive:true,inCombat:true,inventoryReady:true,
    hp:20,maxHp:100,mp:100,maxMp:100,level:65,class:0,loc:{x:0,y:0,z:0},w:0})
  engine.inventoryChanged([{id:1,dbid:1n,amount:3}])
  const controller = createController({mod:{settings:shared},engine,store})
  return {engine,controller,sent}
}

test('a committed pause synchronizes real engines sharing Toolbox settings before another tick', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared)
  assert.equal(a.engine.getState().status,'ready')
  const state = b.controller.getState()
  assert.equal(b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision}).ok,true)
  assert.equal(a.sent.length,0,'Publishing settings must not send or tick')
  assert.equal(b.sent.length,0,'Saving must not send or tick')
  assert.equal(a.engine.tick(),false,'Peer A must already be paused before its next scheduler tick')
  assert.equal(b.engine.tick(),false)
  assert.equal(a.sent.length,0)
  assert.equal(a.controller.getState().activeSettings.enabled,false)
})

test('publishing settings never changes controllers with a different settings object', () => {
  const defaults = require('../lib/settings').defaults
  const a = realPeer({...defaults(),enabled:true}), b = realPeer({...defaults(),enabled:true})
  const state = b.controller.getState()
  b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision})
  assert.equal(a.engine.tick(),true)
  assert.equal(a.sent.length,1)
  assert.equal(b.engine.tick(),false)
})

test('destroyed controllers unsubscribe and cannot save or receive later peer updates', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared)
  a.controller.destructor();a.controller.destructor()
  const state = b.controller.getState()
  b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision})
  assert.equal(a.engine.settings.enabled,true,'The disposed engine must no longer receive callbacks')
  assert.equal(b.engine.settings.enabled,false)
  const current = a.controller.getState()
  assert.equal(a.controller.saveSettings({settings:current.settings,revision:current.revision}).ok,false)
})

test('a failed peer activation stays visible without preventing other peers from applying a committed save', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared)
  a.engine.setSettings=()=>{throw Error('controlled engine failure')}
  const state = b.controller.getState()
  const result = b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision})
  assert.equal(result.ok,true)
  const peer = a.controller.getState()
  assert.equal(peer.settings.enabled,false)
  assert.equal(peer.activeSettings.enabled,true)
  assert.match(peer.activationError,/controlled engine failure/)
  assert.equal(b.engine.settings.enabled,false)
})

test('an unpersisted save never publishes changes to a shared peer', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared,{save:()=>({ok:false,error:'disk failure'})})
  const state = b.controller.getState()
  assert.equal(b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision}).ok,false)
  assert.equal(a.engine.settings.enabled,true)
  assert.equal(b.engine.settings.enabled,true)
  assert.equal(shared.enabled,true)
})

test('the saving controller reports its own activation failure while other peers still update', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared)
  b.engine.setSettings=()=>{throw Error('own activation failed')}
  const state = b.controller.getState()
  const result = b.controller.saveSettings({settings:{...state.settings,enabled:false},revision:state.revision})
  assert.equal(result.ok,false)
  assert.match(result.error,/own activation failed/)
  assert.equal(a.engine.settings.enabled,false)
  assert.equal(result.state.settings.enabled,false)
  assert.equal(result.state.activeSettings.enabled,true)
})

test('a session-only emergency pause is visible locally without publishing to another session', () => {
  const shared = {...require('../lib/settings').defaults(),enabled:true}
  const a = realPeer(shared), b = realPeer(shared)
  a.engine.setSettings({...shared,enabled:false})
  assert.equal(a.controller.getState().settings.enabled,true)
  assert.equal(a.controller.getState().activeSettings.enabled,false)
  assert.equal(a.controller.getState().status,'paused')
  assert.equal(b.engine.settings.enabled,true)
  assert.equal(a.sent.length,0)
  assert.equal(b.sent.length,0)
})
