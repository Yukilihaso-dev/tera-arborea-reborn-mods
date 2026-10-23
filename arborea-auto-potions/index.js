'use strict'
const schema=require('./lib/settings')
const catalog=require('./data/potions.json')
const {PotionEngine}=require('./lib/engine')
const {createRuntime}=require('./lib/runtime')
const {createController}=require('./lib/gui-controller')
const {createGui}=require('./lib/gui')
function AutoPotions(mod,dependencies={}){
  const Engine=dependencies.Engine||PotionEngine
  const runtimeFactory=dependencies.createRuntime||createRuntime
  const controllerFactory=dependencies.createController||createController
  const guiFactory=dependencies.createGui||createGui
  const settings=schema.normalize(mod.settings)
  for(const k of Object.keys(mod.settings))delete mod.settings[k]
  Object.assign(mod.settings,settings)
  let runtime,gui,controller,disposed=false
  const engine=new Engine({catalog,settings,send:(item,stack,snapshot)=>runtime?.send(item,stack,snapshot)===true})
  const message=text=>mod.command.message(String(text))
  try{
    runtime=runtimeFactory(mod,engine)
    controller=controllerFactory({mod,engine})
    gui=guiFactory(mod,controller)
    mod.command.add('pot',(sub='gui')=>{
      if(disposed)return
      switch(String(sub).toLowerCase()){
        case 'gui':{
          const result=gui.show()
          if(result?.ok!==true)message(result?.error||'GUI unavailable. Use Toolbox GUI mode; pot on, pot off and pot status still work.')
          break
        }
        case 'on':case 'off':{
          const state=controller.getState(),enabled=String(sub).toLowerCase()==='on'
          const next={...state.settings,enabled}
          // Stop immediately even if a disk problem prevents saving the pause.
          if(!enabled)engine.setSettings(next)
          const result=controller.saveSettings({settings:next,revision:state.revision})
          message(result.ok?`Automatic potions ${enabled?'enabled':'paused'}.`:(!enabled?'Paused for this session. ':'')+result.error)
          break
        }
        case 'status':{
          const s=controller.getState(),pct=v=>v===null?'—':`${Math.round(v)}%`
          message(`${s.status}: ${s.reason}. HP ${pct(s.live.hpPercent)}; MP ${pct(s.live.mpPercent)}.`)
          break
        }
        default:message('Commands: pot gui | pot on | pot off | pot status')
      }
    })
    message('Ready. Open pot gui to choose potions and enable automation.')
  }catch(error){
    engine.setSettings({...settings,enabled:false});gui?.destructor();controller?.destructor?.();runtime?.destructor();throw error
  }
  this.destructor=()=>{
    if(disposed)return;disposed=true
    engine.setSettings({...schema.normalize(mod.settings),enabled:false})
    mod.command.remove('pot');gui?.destructor();controller?.destructor?.();runtime?.destructor();engine.reset()
  }
}
module.exports=AutoPotions
