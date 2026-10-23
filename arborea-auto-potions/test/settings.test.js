'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {defaults,normalize,validate} = require('../lib/settings')
const catalog={items:[{id:116,hp:true,mp:false},{id:117,hp:false,mp:true},{id:111,hp:true,mp:true}]}
test('new installation is paused with sensible independent thresholds',()=>{
  const s=defaults();assert.equal(s.enabled,false);assert.equal(s.combatOnly,true)
  assert.deepEqual(s.hp,{enabled:true,threshold:50,itemId:0,fallbackItemIds:[]});assert.equal(s.mp.threshold,30)
  s.hp.threshold=1;assert.equal(defaults().hp.threshold,50)
})
test('migration repairs corrupt values and never enables by coercion',()=>{
  const s=normalize({enabled:'true',hp:{threshold:101,itemId:-1},mp:{threshold:40}})
  assert.equal(s.enabled,false);assert.equal(s.hp.threshold,50);assert.equal(s.mp.threshold,40)
  assert.equal(s.hp.itemId,0)
})
test('GUI rejects incomplete, unknown, out-of-range and wrong-resource fields',()=>{
  const s=defaults();assert.equal(validate(s,catalog).ok,true)
  for(const mutate of [s=>delete s.mp,s=>s.extra=1,s=>s.hp.threshold=0,s=>s.hp.threshold=50.2,s=>s.hp.itemId=117,s=>s.mp.itemId=999,s=>s.enabled='true',s=>s.combinedPolicy='unknown']) {
    const bad=defaults();mutate(bad);assert.equal(validate(bad,catalog).ok,false)
  }
  s.hp.itemId=111;s.mp.itemId=111;assert.equal(validate(s,catalog).ok,true)
})
test('accessor and prototype-bearing input is not executed or accepted',()=>{
  const s=defaults();let ran=false;Object.defineProperty(s,'enabled',{get(){ran=true;throw Error('no')},enumerable:true})
  assert.equal(validate(s,catalog).ok,false);assert.equal(ran,false)
  assert.equal(validate(Object.assign(Object.create({}),defaults()),catalog).ok,false)
})
