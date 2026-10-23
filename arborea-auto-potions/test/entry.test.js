'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const AutoPotions=require('../index')
const {PotionEngine}=require('../lib/engine')
const {createController}=require('../lib/gui-controller')
const {defaults}=require('../lib/settings')
function fixture({storageOk=true}={}){
  let engine,command,runtimeDestroyed=0,guiDestroyed=0,shown=0;const sends=[],messages=[],writes=[]
  const original=defaults(),mod={settings:original,command:{add(name,fn){assert.equal(name,'pot');command=fn},remove(name){assert.equal(name,'pot')},message(s){messages.push(s)}}}
  class Engine extends PotionEngine{constructor(options){super(options);engine=this}}
  const instance=new AutoPotions(mod,{Engine,
    createRuntime:()=>({send:(...args)=>{sends.push(args);return true},destructor:()=>runtimeDestroyed++}),
    createController:args=>createController({...args,store:{save:s=>{writes.push(s);return {ok:storageOk,error:'Disk full'}}}}),
    createGui:()=>({show:()=>{shown++;return {ok:true}},destructor:()=>guiDestroyed++})})
  engine.update({connected:true,loading:false,alive:true,inCombat:true,inventoryReady:true,hp:20,maxHp:100,mp:20,maxMp:100,level:70,class:6,loc:{x:1,y:2,z:3},w:0})
  engine.inventoryChanged([{id:6553,dbid:10n,amount:5}])
  return {instance,engine,mod,original,sends,messages,writes,command:(...args)=>command(...args),counts:()=>({runtimeDestroyed,guiDestroyed,shown})}
}
test('entry preserves the Toolbox settings reference; opening/status/saving never use items',()=>{
  const f=fixture();assert.equal(f.mod.settings,f.original)
  f.command();f.command('status');f.command('on');assert.equal(f.counts().shown,1)
  assert.equal(f.sends.length,0);assert.equal(f.writes[0].enabled,true)
  assert.ok(!f.messages.some(m=>m.includes('GUI unavailable')))
  f.engine.tick();assert.equal(f.sends.length,1)
})
test('off immediately stops the current session even when saving fails',()=>{
  const f=fixture({storageOk:false});f.engine.setSettings({...defaults(),enabled:true})
  f.command('off');f.engine.tick();assert.equal(f.sends.length,0)
  assert.equal(f.engine.getState().status,'paused');assert.match(f.messages.at(-1),/Paused for this session.*Disk full/)
})
test('module teardown is idempotent and disables any future command or timer decision',()=>{
  const f=fixture();f.command('on');f.instance.destructor();f.instance.destructor();f.command('on');f.engine.tick()
  assert.equal(f.sends.length,0);assert.deepEqual(f.counts(),{runtimeDestroyed:1,guiDestroyed:1,shown:0})
})
