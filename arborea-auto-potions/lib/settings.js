'use strict'
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k)
const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o))
const field=(o,k)=>{if(!record(o))return undefined;const d=Object.getOwnPropertyDescriptor(o,k);return d&&own(d,'value')?d.value:undefined}
const MAX_FALLBACKS=7
function list(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value
  if(!Number.isInteger(length)||length<0||length>MAX_FALLBACKS)return null
  if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||(k!=='length'&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=length))))return null
  const out=[]
  for(let i=0;i<length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i))
    if(!d||!own(d,'value')||!d.enumerable||!Number.isSafeInteger(d.value)||d.value<=0)return null
    out.push(d.value)
  }
  return out
}
function defaults(){return {schemaVersion:1,enabled:false,combatOnly:true,hp:{enabled:true,threshold:50,itemId:0,fallbackItemIds:[]},mp:{enabled:true,threshold:30,itemId:0,fallbackItemIds:[]},combinedPolicy:'either'}}
function normalize(raw){
  const out=defaults()
  for(const key of ['enabled','combatOnly'])if(typeof field(raw,key)==='boolean')out[key]=field(raw,key)
  for(const kind of ['hp','mp']){
    const source=field(raw,kind)
    if(typeof field(source,'enabled')==='boolean')out[kind].enabled=field(source,'enabled')
    const threshold=field(source,'threshold'),itemId=field(source,'itemId')
    if(Number.isInteger(threshold)&&threshold>=1&&threshold<=99)out[kind].threshold=threshold
    if(Number.isSafeInteger(itemId)&&itemId>=0)out[kind].itemId=itemId
    const fallbacks=list(field(source,'fallbackItemIds'))
    if(fallbacks)out[kind].fallbackItemIds=[...new Set(fallbacks)].filter(id=>id!==out[kind].itemId)
  }
  if(['either','both'].includes(field(raw,'combinedPolicy')))out.combinedPolicy=field(raw,'combinedPolicy')
  return out
}
function validate(raw,catalog){
  const template=defaults()
  function shape(value,expected,prefix='settings'){
    if(!record(value))return `${prefix}: expected a plain settings object.`
    for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!own(expected,key))return `${prefix}: unknown field.`
    for(const [key,type] of Object.entries(expected)){
      const d=Object.getOwnPropertyDescriptor(value,key)
      if(!d||!own(d,'value')||!d.enumerable)return `${prefix}.${key}: missing or invalid field.`
      if(Array.isArray(type)){if(!list(d.value))return `${prefix}.${key}: expected at most ${MAX_FALLBACKS} positive potion IDs.`}
      else if(typeof type==='object'){const e=shape(d.value,type,`${prefix}.${key}`);if(e)return e}
      else if(typeof d.value!==typeof type)return `${prefix}.${key}: wrong value type.`
    }
    return null
  }
  let error=shape(raw,template)
  if(!error&&raw.schemaVersion!==1)error='Unsupported settings version.'
  if(!error&&!['either','both'].includes(raw.combinedPolicy))error='Choose either-resource or both-resources for combined potions.'
  for(const kind of ['hp','mp']){
    if(error)break
    const channel=raw[kind]
    if(!Number.isInteger(channel.threshold)||channel.threshold<1||channel.threshold>99)error=`${kind.toUpperCase()} threshold must be a whole percentage from 1 to 99.`
    else if(!Number.isSafeInteger(channel.itemId)||channel.itemId<0)error='Invalid potion ID.'
    else if(channel.itemId!==0&&!(catalog?.items||[]).some(i=>i.id===channel.itemId&&i[kind]===true))error=`Choose a verified ${kind.toUpperCase()} potion from the list.`
    else if(new Set(channel.fallbackItemIds).size!==channel.fallbackItemIds.length||channel.fallbackItemIds.includes(channel.itemId))error='Each potion may appear only once in its resource priority list.'
    else if(channel.fallbackItemIds.some(id=>!(catalog?.items||[]).some(i=>i.id===id&&i[kind]===true)))error=`Choose verified ${kind.toUpperCase()} fallback potions from the list.`
  }
  return error?{ok:false,error}:{ok:true,settings:normalize(raw)}
}
module.exports={defaults,normalize,validate,MAX_FALLBACKS}
