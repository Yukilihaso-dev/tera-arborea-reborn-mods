'use strict'
const {normalize}=require('./settings')
const SPACING_MS=1000,ACK_TIMEOUT_MS=2500,FAILURE_BASE_MS=10000,MAX_FAILURE_MS=120000
const empty=()=>({connected:false,loading:true,alive:false,inCombat:false,mounted:false,trading:false,inventoryReady:false,hp:null,maxHp:null,mp:null,maxMp:null,level:0,class:null,loc:null,w:null,items:[],blockedReason:null})
const finite=Number.isFinite
const validDbid=id=>typeof id==='bigint'?id>0n:Number.isSafeInteger(id)&&id>0
const validStack=i=>i&&Number.isSafeInteger(i.id)&&i.id>0&&validDbid(i.dbid)&&Number.isInteger(i.amount)&&i.amount>0
const key=id=>String(id)
class PotionEngine{
  constructor({catalog,settings,now=Date.now,send}){
    this.items=(catalog?.items||[]).map(i=>({...i,group:String(i.group),classes:i.classes?.slice()}))
    this.catalog=new Map(this.items.map(i=>[i.id,i]))
    this.observers=new Map((catalog?.observerItems||[]).map(i=>[i.id,{...i,group:String(i.group)}]))
    this.now=now;this.send=send;this.settings=normalize(settings);this.reset()
  }
  reset({preserveCooldowns=false}={}){
    this.snapshot=empty()
    if(!preserveCooldowns){this.locks=new Map();this.failures=new Map();this.backoffs=new Map();this.nextUseAt=0}
    this.pending=null;this.lastAction=null;this.externalSerial=0
  }
  setSettings(settings){this.settings=normalize(settings)}
  update(patch){
    for(const k of Object.keys(empty()))if(k!=='items'&&Object.prototype.hasOwnProperty.call(patch,k))this.snapshot[k]=k==='loc'&&patch.loc?{x:patch.loc.x,y:patch.loc.y,z:patch.loc.z}:patch[k]
  }
  inventoryChanged(items){
    const next=Array.isArray(items)?items.filter(validStack).map(i=>({id:i.id,dbid:i.dbid,amount:i.amount,pocket:i.pocket,container:i.container})):[]
    if(this.pending){
      const stack=next.find(i=>key(i.dbid)===this.pending.dbid&&i.id===this.pending.id)
      if(!stack||stack.amount<this.pending.amount){
        this.lastAction={itemId:this.pending.id,name:this.pending.name,at:this.now(),result:'Inventory stack changed; use unconfirmed'}
        if(this.pending.externalSerial===this.externalSerial)this.pending=null
      }
    }
    this.snapshot.items=next
  }
  reserve(item,ms){
    const deadline=this.now()+ms
    this.locks.set(item.group,Math.max(this.locks.get(item.group)||0,deadline))
  }
  observeUse(itemId){
    this.externalSerial++
    this.nextUseAt=Math.max(this.nextUseAt,this.now()+SPACING_MS)
    const item=this.catalog.get(itemId)||this.observers.get(itemId)
    if(item&&finite(item.cooldownMs)&&item.cooldownMs>0)this.reserve(item,item.cooldownMs)
  }
  cooldown(itemId,ms){
    const item=this.catalog.get(itemId)||this.observers.get(itemId)
    if(!item||!finite(ms)||ms<=0||ms>86400000)return
    this.reserve(item,ms)
    if(this.pending?.id===itemId){
      if(this.pending.externalSerial===this.externalSerial)this.confirm('Server cooldown observed')
      else this.lastAction={itemId,name:this.pending.name,at:this.now(),result:'Server cooldown observed; request attribution uncertain'}
    }
  }
  confirm(result){
    if(!this.pending)return
    this.failures.delete(this.pending.id);this.backoffs.delete(this.pending.id)
    this.lastAction={itemId:this.pending.id,name:this.pending.name,at:this.now(),result}
    this.pending=null
  }
  fail(itemId,result){
    const count=(this.failures.get(itemId)||0)+1
    this.failures.set(itemId,count)
    this.backoffs.set(itemId,this.now()+Math.min(MAX_FAILURE_MS,FAILURE_BASE_MS*2**Math.min(count-1,4)))
    this.lastAction={itemId,name:this.catalog.get(itemId)?.name||'Potion',at:this.now(),result}
    this.nextUseAt=Math.max(this.nextUseAt,this.now()+3000)
  }
  reject(reason='Item use rejected'){
    // Server messages have no item/request ID. Only attach a failure if no
    // intervening manual or other-mod use makes the pending request ambiguous.
    this.nextUseAt=Math.max(this.nextUseAt,this.now()+3000)
    if(this.pending&&this.pending.externalSerial===this.externalSerial){this.fail(this.pending.id,`Request failed: ${String(reason).slice(0,160)}`);this.pending=null}
  }
  readyReason(){
    const s=this.snapshot
    if(!this.settings.enabled)return 'Automatic potions are paused'
    if(typeof s.blockedReason==='string'&&s.blockedReason)return s.blockedReason.slice(0,240)
    if(!s.connected)return 'Waiting for a character'
    if(s.loading)return 'Waiting for loading to finish'
    if(!s.alive)return 'Character is not alive'
    if(s.mounted)return 'Paused while mounted'
    if(s.trading)return 'Paused while trading'
    if(!s.inventoryReady)return 'Waiting for inventory'
    if(s.hp===0)return 'Character has no HP; waiting for life status'
    if(!finite(s.hp)||s.hp<0||!finite(s.maxHp)||s.maxHp<=0||!finite(s.mp)||s.mp<0||!finite(s.maxMp)||s.maxMp<=0)return 'Waiting for current HP and MP'
    if(!s.loc||![s.loc.x,s.loc.y,s.loc.z,s.w].every(finite))return 'Waiting for player position'
    if(!Number.isInteger(s.level)||s.level<=0||!Number.isInteger(s.class)||s.class<0)return 'Waiting for character details'
    if(this.settings.combatOnly&&!s.inCombat)return 'Waiting for combat'
    return null
  }
  eligible(item,kind){
    const s=this.snapshot
    return item?.[kind]===true&&item.level<=s.level&&(!item.classes?.length||item.classes.includes(s.class))&&!(item.combatAllowed===false&&s.inCombat)
  }
  candidates(kind){
    const {itemId,fallbackItemIds}=this.settings[kind]
    const primary=itemId?[this.catalog.get(itemId)]:this.items.filter(i=>i.automatic===true&&!i.valuable).sort((a,b)=>(b.rank||0)-(a.rank||0)||a.id-b.id)
    const seen=new Set()
    return [...primary,...fallbackItemIds.map(id=>this.catalog.get(id))].filter(item=>{
      if(!item||seen.has(item.id))return false
      seen.add(item.id);return true
    })
  }
  choose(kind){
    let waiting=null
    for(const item of this.candidates(kind)){
      if(!this.eligible(item,kind))continue
      const stack=this.snapshot.items.find(s=>s.id===item.id)
      if(!stack)continue
      const choice={item,stack}
      const combinedAllowed=!(item.hp&&item.mp&&this.settings.combinedPolicy==='both')||(this.low('hp')&&this.low('mp'))
      if(this.remaining(item)===0&&combinedAllowed)return choice
      if(!waiting)waiting=choice
    }
    return waiting
  }
  low(kind){const s=this.snapshot;return this.settings[kind].enabled&&finite(s[kind])&&finite(s[kind==='hp'?'maxHp':'maxMp'])&&s[kind]/s[kind==='hp'?'maxHp':'maxMp']*100<this.settings[kind].threshold}
  remaining(item){return Math.max(0,(this.locks.get(item.group)||0)-this.now(),(this.backoffs.get(item.id)||0)-this.now())}
  decision(){
    const reason=this.readyReason()
    if(reason)return {reason}
    if(this.pending)return {reason:'Waiting for potion confirmation'}
    if(this.now()<this.nextUseAt)return {reason:'Waiting between item uses'}
    let waiting=null
    for(const kind of ['hp','mp']){
      if(!this.low(kind))continue
      const choice=this.choose(kind)
      if(!choice){waiting=`No usable ${kind.toUpperCase()} potion in inventory`;continue}
      const {item}=choice
      if(item.hp&&item.mp&&this.settings.combinedPolicy==='both'&&!(this.low('hp')&&this.low('mp'))){waiting='Combined potion waits until both resources are low';continue}
      if(this.remaining(item)>0){waiting='Waiting for potion cooldown or retry delay';continue}
      return {...choice,kind,reason:'Ready to use a potion'}
    }
    return {reason:waiting||'Resources are above the enabled thresholds'}
  }
  tick(){
    if(this.pending&&this.now()>=this.pending.until){this.fail(this.pending.id,'Request failed: no cooldown or inventory confirmation');this.pending=null}
    const choice=this.decision()
    if(!choice.item)return false
    const {item,stack}=choice
    const externalSerial=this.externalSerial
    let handed=false
    try{handed=this.send(item,{...stack},{...this.snapshot,loc:{...this.snapshot.loc},items:undefined})===true}catch{}
    if(!handed){this.fail(item.id,'Request failed: Toolbox did not accept the item request');return false}
    this.reserve(item,item.cooldownMs)
    this.nextUseAt=this.now()+SPACING_MS
    this.pending={id:item.id,name:item.name,dbid:key(stack.dbid),amount:stack.amount,until:this.now()+ACK_TIMEOUT_MS,externalSerial}
    this.lastAction={itemId:item.id,name:item.name,at:this.now(),result:'Request sent; awaiting confirmation'}
    return true
  }
  getState(){
    const s=this.snapshot,decision=this.decision(),percent=(v,max)=>finite(v)&&finite(max)&&max>0?Math.min(100,Math.max(0,v/max*100)):null
    const owned=id=>this.snapshot.items.filter(s=>s.id===id).reduce((sum,s)=>sum+s.amount,0)
    const channel=kind=>{
      const choice=this.choose(kind)
      const rotation=[this.settings[kind].itemId,...this.settings[kind].fallbackItemIds].map(id=>{
        const item=this.catalog.get(id)
        return {itemId:id,name:id===0?'Automatic ordinary potions':item?.name||'Unavailable selection',owned:owned(id),
          group:item?.group||null,readyInMs:item?this.remaining(item):0,available:id===0||this.eligible(item,kind),selected:choice?.item.id===id}
      })
      return {itemId:choice?.item.id||this.settings[kind].itemId,name:choice?.item.name||'No usable potion',owned:choice?owned(choice.item.id):0,readyInMs:choice?this.remaining(choice.item):0,rotation}
    }
    return {status:!this.settings.enabled?'paused':this.pending?'pending':decision.item?'ready':'waiting',reason:decision.reason,
      live:{connected:s.connected,hp:finite(s.hp)?s.hp:null,maxHp:finite(s.maxHp)?s.maxHp:null,mp:finite(s.mp)?s.mp:null,maxMp:finite(s.maxMp)?s.maxMp:null,hpPercent:percent(s.hp,s.maxHp),mpPercent:percent(s.mp,s.maxMp),inCombat:s.inCombat},
      channels:{hp:channel('hp'),mp:channel('mp')},
      potions:this.items.map(i=>({id:i.id,name:i.name,hp:i.hp,mp:i.mp,owned:owned(i.id),automatic:i.automatic===true,valuable:i.valuable===true,note:i.note||'',level:i.level,available:this.eligible(i,i.hp?'hp':'mp'),group:i.group,cooldownMs:i.cooldownMs,readyInMs:this.remaining(i)})),
      pending:this.pending?{itemId:this.pending.id,name:this.pending.name,remainingMs:Math.max(0,this.pending.until-this.now())}:null,lastAction:this.lastAction?{...this.lastAction}:null}
  }
}
module.exports={PotionEngine,SPACING_MS,ACK_TIMEOUT_MS}
