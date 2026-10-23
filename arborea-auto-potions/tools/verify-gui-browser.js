'use strict'
// Developer-only browser checks. No browser dependency is needed by the mod.
const fs = require('fs'), path = require('path'), assert = require('assert/strict')
const {pathToFileURL} = require('url')
const root = path.resolve(__dirname,'..')
const out = path.resolve(process.env.GUI_VERIFY_OUTPUT || path.join(root,'..','auto-potions-gui-check'))
const checks=[]
const check=(name, value)=>{assert.ok(value,name);checks.push(name)}
check('Potion window document exists',fs.existsSync(path.join(root,'gui/index.html')))
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
;(async()=>{
  fs.mkdirSync(out,{recursive:true})
  const browser=await chromium.launch({headless:true,...(process.env.GUI_BROWSER_EXECUTABLE?{executablePath:process.env.GUI_BROWSER_EXECUTABLE}:{})})
  const errors=[],requests=[]
  const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())})}
  try {
    const preview=await browser.newPage({viewport:{width:1020,height:900},reducedMotion:'reduce'});watch(preview)
    const url=pathToFileURL(path.join(root,'gui/index.html')).href
    await preview.goto(url)
    check('Preview is explicitly labelled',(await preview.locator('#connection-label').innerText())==='Browser preview')
    check('Preview does not invent resources',(await preview.locator('#hp-live-value').innerText())==='—')
    check('Preview cannot save',await preview.locator('#save-button').isDisabled())
    await preview.locator('#hp-threshold').fill('65')
    check('Threshold slider follows typed percentage',await preview.locator('#hp-slider').inputValue()==='65')
    check('Preview changes remain a draft',(await preview.locator('#change-count').innerText()).includes('1 unsaved'))
    await preview.locator('#discard-button').click()
    check('Discard restores the original threshold',await preview.locator('#hp-threshold').inputValue()==='50')
    await preview.reload()
    await preview.setViewportSize({width:1020,height:await preview.evaluate(()=>Math.max(850,document.documentElement.scrollHeight))})
    await preview.screenshot({path:path.join(out,'preview.png'),animations:'disabled'})
    const {defaults}=require(path.join(root,'lib/settings'))
    const {createController}=require(path.join(root,'lib/gui-controller'))
    const {createSettingsStore}=require(path.join(root,'lib/settings-store'))
    const catalog=require(path.join(root,'data/potions.json'))
    const hp=catalog.items.find(i=>i.hp&&!i.mp),mp=catalog.items.find(i=>i.mp&&!i.hp),combo=catalog.items.find(i=>i.hp&&i.mp)
    const hpBackup=catalog.items.find(i=>i.id===6553),mpBackup=catalog.items.find(i=>i.id===6563),hpOther=catalog.items.find(i=>i.id===80095)
    check('Catalog supplies independent HP/MP and combined choices',hp&&mp&&combo)
    const directory=fs.mkdtempSync(path.join(out,'store-')),disk=createSettingsStore(directory)
    const mod={settings:defaults()},sent=[];let apply=0,fail=false
    const engineState={status:'paused',reason:'Automation is paused.',live:{connected:true,hp:42000,maxHp:100000,mp:3000,maxMp:10000,hpPercent:42,mpPercent:30,inCombat:true},
      channels:{hp:{itemId:hp.id,name:hp.name,owned:12,readyInMs:0},mp:{itemId:mp.id,name:mp.name,owned:7,readyInMs:2400}},
      potions:[hp,mp,combo,hpBackup,mpBackup,hpOther].map((p,i)=>({...p,owned:[12,7,3,8,9,4][i],readyInMs:0})),pending:null,lastAction:null}
    const engine={getState:()=>structuredClone(engineState),setSettings(settings){
      apply++
      for(const kind of ['hp','mp']) {
        const chosen=engineState.potions.find(p=>p.id===settings[kind].itemId)
        if(chosen)engineState.channels[kind]={itemId:chosen.id,name:chosen.name,owned:chosen.owned,readyInMs:0}
      }
    },tick(){throw Error('The GUI must never tick the engine')}}
    const controller=createController({mod,engine,store:{save:s=>fail?{ok:false,error:'Test disk failure'}:disk.save(s)}})
    const page=await browser.newPage({viewport:{width:1020,height:850},reducedMotion:'reduce'});watch(page)
    await page.exposeFunction('__request',(type,payload)=>{
      sent.push(type)
      if(type==='request-state')return {name:'state',value:controller.getState()}
      if(type==='save-settings')return {name:'result',value:controller.saveSettings(payload)}
      throw Error('Unexpected transport action: '+type)
    })
    await page.addInitScript(()=>{
      const callbacks={};window.__push=value=>callbacks.state?.(value);window.__pauseState=false
      window.__offset=0;const now=Date.now;Date.now=()=>now()+window.__offset
      window.require=()=>({Renderer:class{on(name,fn){callbacks[name]=fn}send(type,payload){if(type==='request-state'&&window.__pauseState)return;window.__request(type,payload).then(r=>callbacks[r.name]?.(r.value))}destructor(){}}})
    })
    await page.goto(url);await page.locator('#connection-label').filter({hasText:'Game connected'}).waitFor()
    check('Live HP reports backend value',(await page.locator('#hp-live-value').innerText()).includes('42'))
    check('Owned amounts are shown in potion options',(await page.locator('#hp-potion').innerText()).includes('Owned: 12'))
    check('Channel cooldown is reported',(await page.locator('#mp-ready').innerText()).includes('2.4'))
    check('Opening the window never activates settings',apply===0)
    check('Both potion selectors and combat preference are visible in the default window',await page.evaluate(()=>{
      const footer=document.querySelector('.savebar').getBoundingClientRect().top
      return ['hp-potion','mp-potion','combat-only'].every(id=>document.getElementById(id).getBoundingClientRect().bottom<footer)
    }))
    check('Explicit backup controls exist for both resources',await page.locator('#hp-fallback-add').count()===1&&await page.locator('#mp-fallback-add').count()===1)
    await page.locator('#hp-rotation-editor summary').click()
    await page.locator('#hp-potion').selectOption(String(hpBackup.id))
    for(const item of [hp,combo,hpOther]){
      await page.locator('#hp-fallback-potion').selectOption(String(item.id));await page.locator('#hp-fallback-add').click()
    }
    const keyboardRow=page.locator(`#hp-fallbacks .fallback-row[data-item-id="${hpOther.id}"]`)
    await keyboardRow.locator('[data-action="up"]').focus();await page.keyboard.press('Enter')
    check('Keyboard reordering preserves focus on a still-enabled action',await keyboardRow.locator('[data-action="up"]').evaluate(el=>el===document.activeElement))
    await page.keyboard.press('Enter')
    check('Moving to the first position focuses the same row’s available down action',await keyboardRow.locator('[data-action="down"]').evaluate(el=>el===document.activeElement))
    await page.keyboard.press('Enter')
    check('Moving down preserves focus when another down move is possible',await keyboardRow.locator('[data-action="down"]').evaluate(el=>el===document.activeElement))
    await page.keyboard.press('Enter')
    check('Moving to the last position keeps focus on the same row’s available action',await keyboardRow.locator('[data-action="up"]').evaluate(el=>el===document.activeElement))
    await keyboardRow.locator('[data-action="remove"]').focus();await page.keyboard.press('Enter')
    check('Removing the last row focuses its surviving neighbor',await page.locator(`#hp-fallbacks .fallback-row[data-item-id="${combo.id}"] [data-action="remove"]`).evaluate(el=>el===document.activeElement))
    while(await page.locator('#hp-fallbacks .fallback-row').count())await page.locator('#hp-fallbacks [data-action="remove"]').first().click()
    check('Removing the final backup focuses the add selector',await page.locator('#hp-fallback-potion').evaluate(el=>el===document.activeElement))
    await page.locator('#hp-potion').selectOption(String(hp.id))
    check('A single explicit choice clearly reports no backup',(await page.locator('#hp-rotation-note').innerText()).includes('No backup'))
    await page.locator('#hp-fallback-potion').selectOption(String(hpBackup.id))
    await page.locator('#hp-fallback-add').click()
    check('HP backup row shows owned stock and independent cooldown',(await page.locator('#hp-fallbacks').innerText()).includes('8 owned')&&(await page.locator('#hp-fallbacks').innerText()).includes('group 66'))
    await page.locator('#hp-fallback-potion').selectOption(String(combo.id));await page.locator('#hp-fallback-add').click()
    check('Combined policy appears for a backup too',await page.locator('#combined-panel').isVisible())
    check('A backup sharing an earlier group is clearly labelled',(await page.locator('#hp-fallbacks').innerText()).includes('Shares a cooldown'))
    await page.locator('#hp-fallbacks [data-action="up"]').nth(1).click()
    check('Backup priorities can be reordered',await page.locator('#hp-fallbacks .fallback-row').first().getAttribute('data-item-id')===String(combo.id))
    await page.locator('#hp-fallbacks [data-action="remove"]').first().click()
    check('Removing a backup restores the remaining ordered list',await page.locator('#hp-fallbacks .fallback-row').count()===1&&await page.locator('#hp-fallbacks .fallback-row').first().getAttribute('data-item-id')===String(hpBackup.id))
    await page.locator('#mp-rotation-editor summary').click()
    await page.locator('#mp-fallback-potion').selectOption(String(mpBackup.id));await page.locator('#mp-fallback-add').click()
    check('MP has an independent backup draft too',await page.locator('#mp-fallbacks .fallback-row').count()===1)
    check('Automatic warns when a selected ordinary backup is already in its shared group',(await page.locator('#mp-fallbacks').innerText()).includes('Already included in Automatic'))
    await page.locator('#hp-threshold').fill('66');await page.locator('#hp-threshold').focus()
    engineState.live.hpPercent=39;engineState.live.hp=39000
    engineState.lastAction={itemId:hp.id,result:'Inventory stack changed; use unconfirmed'}
    await page.evaluate(state=>window.__push(state),controller.getState())
    check('Live refresh preserves dirty input and focus',await page.locator('#hp-threshold').inputValue()==='66'&&await page.locator('#hp-threshold').evaluate(el=>el===document.activeElement))
    check('Activity retains the engines unconfirmed-result wording',(await page.locator('#last-action').innerText()).includes('Inventory stack changed; use unconfirmed'))
    await page.locator('#hp-potion').selectOption(String(combo.id))
    check('Combined policy appears for an explicitly selected combined potion',await page.locator('#combined-panel').isVisible())
    await page.locator('#combined-policy').selectOption('both')
    check('Editing never uses a potion or activates settings',apply===0&&sent.every(x=>x==='request-state'))
    await page.locator('#hp-threshold').fill('100')
    check('Invalid threshold blocks save',await page.locator('#save-button').isDisabled())
    await page.locator('#hp-threshold').fill('66')
    await page.locator('#save-button').click()
    await page.locator('#feedback').filter({hasText:'Settings saved'}).waitFor()
    check('Save reaches the real controller and atomic store',apply===1&&JSON.parse(fs.readFileSync(path.join(directory,'settings.json'))).data.hp.threshold===66)
    check('Both ordered backup lists are persisted without item use',JSON.stringify(mod.settings.hp.fallbackItemIds)===JSON.stringify([hpBackup.id])&&JSON.stringify(mod.settings.mp.fallbackItemIds)===JSON.stringify([mpBackup.id]))
    await page.setViewportSize({width:1020,height:await page.evaluate(()=>Math.max(850,document.documentElement.scrollHeight))})
    await page.screenshot({path:path.join(out,'rotation-harness.png'),animations:'disabled'})
    await page.setViewportSize({width:1020,height:850})
    check('Saved draft is clean',(await page.locator('#change-count').innerText())==='All changes saved')
    await page.locator('#mp-threshold').fill('44')
    mod.settings.combatOnly=false
    await page.evaluate(state=>window.__push(state),controller.getState())
    check('External setting revision creates a visible conflict',await page.locator('#conflict-banner').isVisible()&&await page.locator('#save-button').isDisabled())
    check('Conflict preserves the local draft',await page.locator('#mp-threshold').inputValue()==='44')
    await page.locator('#load-current').click()
    check('Load current resolves conflict',!(await page.locator('#conflict-banner').isVisible())&&await page.locator('#mp-threshold').inputValue()==='30')
    fail=true;await page.locator('#mp-threshold').fill('40');await page.locator('#save-button').click()
    await page.locator('#feedback').filter({hasText:'Test disk failure'}).waitFor()
    check('Failed save retains the draft and active settings',await page.locator('#mp-threshold').inputValue()==='40'&&mod.settings.mp.threshold===30&&apply===1)
    let dialogSeen=false
    page.once('dialog',async d=>{dialogSeen=true;await d.dismiss()})
    const blocked=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})
    check('Native dirty close asks and respects cancellation',dialogSeen&&blocked)
    await page.locator('#discard-button').click()
    await page.reload();await page.locator('#connection-label').filter({hasText:'Game connected'}).waitFor()
    await page.setViewportSize({width:1020,height:await page.evaluate(()=>Math.max(850,document.documentElement.scrollHeight))})
    await page.screenshot({path:path.join(out,'connected-harness.png'),animations:'disabled'})
    await page.setViewportSize({width:800,height:700})
    check('Minimum window width has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.evaluate(()=>{window.__pauseState=true;window.__offset=10000})
    await page.locator('#connection-label').filter({hasText:'Status unavailable'}).waitFor()
    check('Stale state hides resources and blocks saving',(await page.locator('#hp-live-value').innerText())==='—'&&await page.locator('#save-button').isDisabled())
    await page.evaluate(()=>{window.__pauseState=false})
    await page.evaluate(state=>window.__push({...state,live:{...state.live,connected:false,hp:null,maxHp:null,hpPercent:null}}),controller.getState())
    check('Disconnected resources are cleared',(await page.locator('#hp-live-value').innerText())==='—')
    check('Transport contains only allowed state/save requests',sent.every(x=>['request-state','save-settings'].includes(x)))
    check('No renderer exceptions',errors.length===0)
    check('No external network requests',requests.length===0)
    fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,screenshots:['preview.png','connected-harness.png','rotation-harness.png'],scope:'Browser harness and local controller only. No live potion use tested.'},null,2))
    console.log(`${checks.length} browser checks passed. Screenshots: ${out}`)
  } finally { await browser.close() }
})().catch(error=>{console.error(error);process.exitCode=1})
