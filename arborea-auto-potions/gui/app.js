'use strict'
;(() => {
  const $ = id => document.getElementById(id)
  const MAX_FALLBACKS=7
  const defaults = {schemaVersion:1,enabled:false,combatOnly:true,hp:{enabled:true,threshold:50,itemId:0,fallbackItemIds:[]},mp:{enabled:true,threshold:30,itemId:0,fallbackItemIds:[]},combinedPolicy:'either'}
  const clone = value => JSON.parse(JSON.stringify(value))
  const keys = ['enabled','combatOnly','hp.enabled','hp.threshold','hp.itemId','hp.fallbackItemIds','mp.enabled','mp.threshold','mp.itemId','mp.fallbackItemIds','combinedPolicy']
  const get = (object,key) => key.split('.').reduce((value,part) => value?.[part],object)
  const set = (object,key,value) => { const parts=key.split('.'); if(parts.length===1)object[key]=value;else object[parts[0]][parts[1]]=value }
  const equal = (a,b) => Array.isArray(a)&&Array.isArray(b)?JSON.stringify(a)===JSON.stringify(b):Object.is(a,b)
  const changes = () => keys.filter(key => !equal(get(draft,key),get(base,key)))
  const same = (a,b) => keys.every(key => equal(get(a,key),get(b,key)))
  let bridge=null,state=null,base=clone(defaults),draft=clone(defaults),revision=null
  let conflict=false,saving=false,pendingDraft=null,saveAt=0,lastStateAt=0
  const controls = new Map([['enabled',$('master-enabled')],['combatOnly',$('combat-only')],
    ['hp.enabled',$('hp-enabled')],['hp.threshold',$('hp-threshold')],['hp.itemId',$('hp-potion')],
    ['mp.enabled',$('mp-enabled')],['mp.threshold',$('mp-threshold')],['mp.itemId',$('mp-potion')],['combinedPolicy',$('combined-policy')]])
  const text = value => String(value ?? '').slice(0,240)
  const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—'
  const stale = () => !!bridge && !!state && Date.now()-lastStateAt>7000
  function feedback(message,error=false) {
    $('feedback').textContent=message
    $('feedback').className=`feedback${error?' error':''}`
    $('feedback').hidden=!message
  }
  function valid() {
    return ['hp','mp'].every(kind => Number.isInteger(draft[kind].threshold)&&draft[kind].threshold>=1&&draft[kind].threshold<=99&&
      Number.isSafeInteger(draft[kind].itemId)&&draft[kind].itemId>=0&&Array.isArray(draft[kind].fallbackItemIds)&&draft[kind].fallbackItemIds.length<=MAX_FALLBACKS&&
      draft[kind].fallbackItemIds.every(id=>Number.isSafeInteger(id)&&id>0&&id!==draft[kind].itemId)&&new Set(draft[kind].fallbackItemIds).size===draft[kind].fallbackItemIds.length)
  }
  function adopt(settings,nextRevision) {
    base=clone(settings);draft=clone(settings);revision=nextRevision;conflict=false
    refreshDraft(true)
  }
  function updatePotions() {
    const potions=Array.isArray(state?.potions)?state.potions:[]
    for(const kind of ['hp','mp']) {
      const select=$(`${kind}-potion`), wanted=new Map([['0','Automatic · ordinary potions']])
      for(const item of potions) {
        if(item[kind]!==true||!Number.isSafeInteger(item.id)||item.id<=0)continue
        wanted.set(String(item.id),`${text(item.name)||`Item ${item.id}`}${item.hp&&item.mp?' · HP + MP':''}${item.valuable?' · Special':''} · Owned: ${number(item.owned)}`)
      }
      const selected=String(draft[kind].itemId)
      if(!wanted.has(selected))wanted.set(selected,`Unavailable selection · Item ${selected}`)
      for(const option of [...select.options])if(!wanted.has(option.value))option.remove()
      for(const [value,label] of wanted) {
        let option=[...select.options].find(option=>option.value===value)
        if(!option){option=document.createElement('option');option.value=value;select.append(option)}
        if(option.textContent!==label)option.textContent=label
      }
      select.value=selected
    }
  }
  function renderFallbacks(kind,potions) {
    const ids=draft[kind].fallbackItemIds,container=$(`${kind}-fallbacks`),select=$(`${kind}-fallback-potion`)
    const wanted=new Map([['','Choose a backup…']])
    for(const item of potions)if(item[kind]===true&&Number.isSafeInteger(item.id)&&item.id>0&&item.id!==draft[kind].itemId&&!ids.includes(item.id))
      wanted.set(String(item.id),`${text(item.name)}${item.hp&&item.mp?' · HP + MP':''}${item.valuable?' · Special':''} · Owned: ${number(item.owned)}`)
    const previous=select.value
    for(const option of [...select.options])if(!wanted.has(option.value))option.remove()
    for(const [value,label] of wanted) {
      let option=[...select.options].find(o=>o.value===value)
      if(!option){option=document.createElement('option');option.value=value;select.append(option)}
      option.textContent=label
    }
    select.value=wanted.has(previous)?previous:''
    const groups=new Set(),primary=potions.find(item=>item.id===draft[kind].itemId)
    if(primary?.group)groups.add(primary.group)
    for(const row of [...container.children])if(!ids.includes(Number(row.dataset.itemId)))row.remove()
    ids.forEach((id,index)=>{
      const item=potions.find(p=>p.id===id),shared=item?.group&&groups.has(item.group)
      const covered=draft[kind].itemId===0&&item?.automatic===true&&!item.valuable
      if(item?.group)groups.add(item.group)
      let row=[...container.children].find(row=>row.dataset.itemId===String(id))
      if(!row){
        row=document.createElement('li');row.className='fallback-row';row.dataset.itemId=String(id)
        const copy=document.createElement('div');copy.className='fallback-copy'
        const name=document.createElement('strong'),detail=document.createElement('span'),note=document.createElement('small')
        copy.append(name,detail,note);row.append(copy)
        const actions=document.createElement('div');actions.className='fallback-actions'
        for(const [action,label,symbol] of [['up','Move backup up','↑'],['down','Move backup down','↓'],['remove','Remove backup','×']]){
          const button=document.createElement('button');button.type='button';button.dataset.action=action;button.textContent=symbol;button.setAttribute('aria-label',label);actions.append(button)
        }
        row.append(actions)
      }
      row.querySelector('strong').textContent=`${index+2}. ${text(item?.name)||`Unavailable item ${id}`}`
      const cooldown=Number.isFinite(item?.cooldownMs)?`${item.cooldownMs/1000} s cooldown`:'Cooldown unknown'
      const ready=Number.isFinite(item?.readyInMs)?item.readyInMs>0?`ready in ${(item.readyInMs/1000).toFixed(1)} s`:'Ready':'Status unknown'
      row.querySelector('span').textContent=`${number(item?.owned)} owned · ${cooldown} · ${ready}${item?.group?` · group ${text(item.group)}`:''}`
      const note=row.querySelector('small');note.textContent=covered?'Already included in Automatic; shares its ordinary cooldown group. This adds no extra independent backup.':
        shared?'Shares a cooldown with an earlier choice; cannot bypass that group’s cooldown.':item?.note?text(item.note):''
      note.className=shared||covered?'shared-cooldown':'';note.hidden=!note.textContent
      row.querySelector('[data-action="up"]').disabled=saving||index===0
      row.querySelector('[data-action="down"]').disabled=saving||index===ids.length-1
      row.querySelector('[data-action="remove"]').disabled=saving
      if(container.children[index]!==row)container.insertBefore(row,container.children[index]||null)
    })
    $(`${kind}-backup-count`).textContent=ids.length?`${ids.length} selected`:'No backup'
    $(`${kind}-rotation-note`).textContent=ids.length?'First ready, owned and compatible choice wins. Move backups to set their priority.':
      draft[kind].itemId===0?'Automatic already tries ready ordinary potions. Add a verified special or regeneration backup explicitly.':'No backup selected. Only the preferred potion will be used. Add another potion below.'
    select.disabled=saving||ids.length>=MAX_FALLBACKS
    $(`${kind}-fallback-add`).disabled=saving||ids.length>=MAX_FALLBACKS||!select.value
  }
  function refreshDraft(write=false) {
    if(write)for(const [key,control] of controls) {
      if(control.type==='checkbox')control.checked=get(draft,key)
      else control.value=String(get(draft,key))
    }
    const potions=Array.isArray(state?.potions)?state.potions:[]
    for(const kind of ['hp','mp']) {
      const value=draft[kind].threshold, ok=Number.isInteger(value)&&value>=1&&value<=99
      $(`${kind}-error`).hidden=ok
      $(`${kind}-error`).textContent=ok?'':'Enter a whole percentage from 1 to 99.'
      $(`${kind}-threshold`).setAttribute('aria-invalid',String(!ok))
      if(ok)$(`${kind}-slider`).value=String(value)
      const item=potions.find(p=>p.id===draft[kind].itemId)
      let note=!bridge?'Connect Toolbox to see verified potions and owned amounts.':draft[kind].itemId===0?
        'Tries ready ordinary potions you own. Special and combined potions require an explicit choice.':
        item?text(item.note)||`${item.hp&&item.mp?'Restores HP + MP. ':''}Preferred potion; a ready configured backup may follow.`:'This selection is not in the current verified catalog.'
      $(`${kind}-selection-note`).textContent=note
      $(`${kind}-enabled`).closest('.resource-card').classList.toggle('channel-disabled',!draft[kind].enabled)
      renderFallbacks(kind,potions)
    }
    const usesCombined=['hp','mp'].some(kind=>potions.some(p=>[draft[kind].itemId,...draft[kind].fallbackItemIds].includes(p.id)&&p.hp&&p.mp))
    $('combined-panel').hidden=!usesCombined
    $('conflict-banner').hidden=!conflict
    const count=changes().length
    $('change-count').textContent=saving?'Saving settings…':count?`${count} unsaved change${count===1?'':'s'}`:'All changes saved'
    $('save-hint').textContent=!bridge?'Preview · saving unavailable':conflict?'Load the current settings to resolve this conflict.':saving?'Waiting for confirmed storage.':!valid()?'Check the highlighted threshold.':stale()?'Waiting for a fresh Toolbox status.':count?'Changes apply after you save.':'Use pot gui to reopen this window.'
    $('save-button').disabled=!bridge||!state||stale()||saving||conflict||!valid()||!count
    $('discard-button').disabled=saving||!count&&!conflict
    $('defaults-button').disabled=saving
    $('load-current').disabled=saving
    for(const control of controls.values())control.disabled=saving
    for(const kind of ['hp','mp'])$(`${kind}-slider`).disabled=saving
  }
  function renderLive() {
    const old=stale(), live=state?.live, connected=!!bridge&&!old&&live?.connected===true
    $('connection-label').textContent=!bridge?'Browser preview':old?'Status unavailable':connected?'Game connected':state?'Toolbox connected':'Connecting…'
    $('connection-dot').className=`status-dot${connected?' online':''}`
    $('version').textContent=state?.version?`v${text(state.version)}`:'v1.1'
    $('preview-banner').hidden=!!bridge&&!!state&&!old
    $('preview-banner').querySelector('strong').textContent=!bridge?'Browser preview':old?'Waiting for Toolbox':'Connecting to Toolbox'
    $('preview-description').textContent=!bridge?'No game connection. Settings stay in this window; saving is unavailable.':old?'Your draft is preserved. Live values are hidden until a fresh status arrives.':'Requesting saved settings and real game status.'
    const statuses={paused:'Paused',pending:'Request pending',ready:'Ready',waiting:'Waiting'}
    $('automation-state').textContent=!bridge?'No live status':old?'Status unavailable':statuses[state?.status]||'Waiting'
    $('status-reason').textContent=!bridge?'Connect Toolbox to see why automation is ready or waiting.':old?'Waiting for a fresh status response.':
      state?.activationError?text(state.activationError):text(state?.reason)||'Waiting for the game.'
    for(const kind of ['hp','mp']) {
      const value=connected?live?.[`${kind}Percent`]:null,maximum=live?.[kind==='hp'?'maxHp':'maxMp'],current=live?.[kind]
      const known=Number.isFinite(value)&&value>=0&&value<=100&&Number.isFinite(maximum)&&maximum>0&&Number.isFinite(current)&&current>=0
      $(`${kind}-live-value`).textContent=known?`${Math.round(value)}%`:'—'
      $(`${kind}-live-detail`).textContent=known?`${number(current)} / ${number(maximum)}`:connected?'Resource data unavailable':'Waiting for game data'
      $(`${kind}-fill`).style.width=known?`${value}%`:'0%'
      if(known)$(`${kind}-meter`).setAttribute('aria-valuenow',String(Math.round(value)))
      else $(`${kind}-meter`).removeAttribute('aria-valuenow')
      const channel=connected?state?.channels?.[kind]:null
      $(`${kind}-active-name`).textContent=channel?.name?`${text(channel.name)} · ${number(channel.owned)} owned`:'—'
      $(`${kind}-ready`).textContent=!channel?'—':Number.isFinite(channel.owned)&&channel.owned<=0?'No stock':
        Number.isFinite(channel.readyInMs)?channel.readyInMs>0?`${(channel.readyInMs/1000).toFixed(1)} s`:'Ready':'Unknown'
    }
    const action=state?.lastAction
    $('last-action').textContent=!bridge||old?'No potion activity reported.':state?.pending?'A potion request is awaiting confirmation.':
      action?`Last activity: ${text(action.result||action.reason||action.status||action.type)||'potion request recorded'}${action.name?` · ${text(action.name)}`:action.itemId?` · item ${text(action.itemId)}`:''}.`:'No potion activity reported.'
  }
  function receiveState(next) {
    if(!next||!next.settings||!next.defaults||typeof next.revision!=='string') {
      feedback('Toolbox returned incomplete settings. Your draft was not changed.',true);return
    }
    const first=!state
    state=next;lastStateAt=Date.now()
    if(!saving) {
      if(first&&!changes().length)adopt(next.settings,next.revision)
      else if(next.revision!==revision) {
        if(changes().length)conflict=true
        else adopt(next.settings,next.revision)
      }
    }
    updatePotions();refreshDraft(false);renderLive()
  }
  function send(type,payload) {
    if(!bridge)return false
    try{bridge.send(type,payload);return true}
    catch{saving=false;pendingDraft=null;feedback('Toolbox is unavailable. Your draft is preserved.',true);refreshDraft();return false}
  }
  function save() {
    if($('save-button').disabled)return
    saving=true;pendingDraft=clone(draft);saveAt=Date.now();refreshDraft()
    send('save-settings',{settings:clone(draft),revision})
  }
  function receiveResult(result) {
    if(!result||typeof result!=='object')return
    const requested=pendingDraft
    saving=false;pendingDraft=null
    if(result.state) {
      if(result.ok===true&&requested&&same(result.state.settings,requested))adopt(result.state.settings,result.state.revision)
      receiveState(result.state)
    }
    if(result.conflict)conflict=true
    feedback(result.ok===true?'Settings saved. They apply to the next regular automation check.':text(result.error)||'Settings could not be saved.',result.ok!==true)
    if(!result.state)send('request-state')
    refreshDraft();renderLive()
  }
  for(const [key,control] of controls)control.addEventListener(control.tagName==='SELECT'?'change':'input',()=>{
    set(draft,key,control.type==='checkbox'?control.checked:key.endsWith('threshold')?control.value===''?NaN:Number(control.value):key.endsWith('itemId')?Number(control.value):control.value)
    if(key.endsWith('itemId')){const kind=key.split('.')[0];draft[kind].fallbackItemIds=draft[kind].fallbackItemIds.filter(id=>id!==draft[kind].itemId)}
    refreshDraft(false)
  })
  for(const kind of ['hp','mp']){
    $(`${kind}-fallback-potion`).addEventListener('change',()=>refreshDraft())
    $(`${kind}-fallback-add`).addEventListener('click',()=>{
      if(saving||$(`${kind}-fallback-add`).disabled)return
      const id=Number($(`${kind}-fallback-potion`).value)
      if(Number.isSafeInteger(id)&&id>0&&draft[kind].fallbackItemIds.length<MAX_FALLBACKS&&!draft[kind].fallbackItemIds.includes(id)&&draft[kind].itemId!==id){
        draft[kind].fallbackItemIds.push(id);refreshDraft()
      }
    })
    $(`${kind}-fallbacks`).addEventListener('click',event=>{
      if(saving)return
      const button=event.target.closest('button'),row=button?.closest('.fallback-row')
      if(!button||!row||button.disabled)return
      const ids=draft[kind].fallbackItemIds,index=ids.indexOf(Number(row.dataset.itemId)),action=button.dataset.action
      if(index<0)return
      if(action==='remove')ids.splice(index,1)
      else if(action==='up'&&index>0)[ids[index-1],ids[index]]=[ids[index],ids[index-1]]
      else if(action==='down'&&index<ids.length-1)[ids[index],ids[index+1]]=[ids[index+1],ids[index]]
      refreshDraft()
      const neighbor=action==='remove'?$(`${kind}-fallbacks`).children[Math.min(index,ids.length-1)]:row
      const preferred=neighbor?.querySelector(`[data-action="${action}"]`)
      const focus=preferred&&!preferred.disabled?preferred:neighbor?.querySelector('button:not(:disabled)')||$(`${kind}-fallback-potion`)
      focus.focus()
    })
  }
  for(const kind of ['hp','mp'])$(`${kind}-slider`).addEventListener('input',event=>{
    draft[kind].threshold=Number(event.target.value);$(`${kind}-threshold`).value=String(draft[kind].threshold);refreshDraft(false)
  })
  function discard(){if(saving)return;adopt(state?.settings||base,state?.revision??revision);updatePotions();feedback('Current settings loaded. Your local draft was discarded.')}
  $('discard-button').addEventListener('click',discard);$('load-current').addEventListener('click',discard)
  $('defaults-button').addEventListener('click',()=>{draft=clone(state?.defaults||defaults);refreshDraft(true);updatePotions();feedback('Default settings loaded as a draft. Save to apply them.')})
  $('save-button').addEventListener('click',save)
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save()}})
  window.addEventListener('beforeunload',event=>{
    if(!changes().length)return
    if(bridge&&window.confirm('Discard unsaved changes and close this window?'))return
    event.preventDefault();event.returnValue=''
  })
  try {
    if(typeof require==='function') {
      const Renderer=require('tera-mod-ui').Renderer
      bridge=new Renderer();bridge.on('state',receiveState);bridge.on('result',receiveResult);send('request-state')
    }
  } catch{bridge=null}
  refreshDraft(true);renderLive()
  const poll=setInterval(()=>{
    if(document.hidden||!bridge)return
    if(saving&&Date.now()-saveAt>10000){saving=false;pendingDraft=null;feedback('Save confirmation did not arrive. Your draft is preserved; check the current state before retrying.',true)}
    renderLive();refreshDraft();send('request-state')
  },1500)
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&bridge){renderLive();send('request-state')}})
  window.addEventListener('unload',()=>{clearInterval(poll);try{bridge?.destructor?.()}catch{}})
})()
