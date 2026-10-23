'use strict'
// Host lifecycle and sender isolation adapted from Arborea Prediction, GPL-3.0-only.
const path = require('path')
const EVENTS = new Set(['request-state','save-settings'])
function secureHostClass(Base) {
  return class PrivateHost extends Base {
    close() { this.window?.close() }
    _handleEvent(event, name, ...args) {
      if(this.window && event.sender === this.window.webContents && EVENTS.has(name)) this.emit(name, ...args)
    }
  }
}
function createGui(mod, controller, options = {}) {
  const available = options.guiAvailable || (() => globalThis.TeraProxy?.GUIMode === true)
  const makeHost = options.createHost || (() => {
    const Host = secureHostClass(require('tera-mod-ui').Host)
    return new Host(mod, 'gui/index.html', {
      title:'Arborea · Auto Potions', width:1020, height:850, minWidth:800, minHeight:700,
      backgroundColor:'#0d131e', autoHideMenuBar:true,
      webPreferences:{nodeIntegration:true,contextIsolation:false,webSecurity:true,webviewTag:false}
    }, false, path.join(__dirname,'..'))
  })
  let host = null, destroyed = false
  const windows = new Set(), nativeWindows = new WeakMap()
  function dispose(target) {
    if(!windows.delete(target)) return
    target.removeAllListeners()
    const window = nativeWindows.get(target) || target.window
    nativeWindows.delete(target)
    try { if(window && !window.isDestroyed?.()) window.destroy?.() } catch {}
    try { target.destructor() } catch {}
  }
  function reply(target, event, value) { try { target.send(event,value) } catch {} }
  return {
    show() {
      if(destroyed) return {ok:false,error:'The potion window has been unloaded.'}
      if(!available()) return {ok:false,error:'Start Toolbox in GUI mode to open the potion window.'}
      try {
        if(host?.window) { host.show(); host.window.focus?.(); return {ok:true} }
        if(host) dispose(host)
        const target = host = makeHost(mod); windows.add(target)
        target.on('request-state', () => {
          try { reply(target,'state',controller.getState()) }
          catch(error) { reply(target,'result',{ok:false,error:`Status unavailable: ${String(error.message).slice(0,200)}`}) }
        })
        target.on('save-settings', payload => {
          try { reply(target,'result',controller.saveSettings(payload)) }
          catch(error) { reply(target,'result',{ok:false,error:`Save failed: ${String(error.message).slice(0,200)}`}) }
        })
        target.show()
        const window = target.window, web = window?.webContents
        if(!web) throw Error('Toolbox did not create a window.')
        nativeWindows.set(target,window)
        for(const event of ['will-navigate','will-redirect','new-window','will-attach-webview']) web.on(event,e => e.preventDefault())
        web.setWindowOpenHandler?.(() => ({action:'deny'}))
        window.on('closed', () => { if(host === target) host = null; dispose(target) })
        return {ok:true}
      } catch(error) {
        if(host) dispose(host)
        host = null
        return {ok:false,error:`Window unavailable: ${String(error.message).slice(0,200)}`}
      }
    },
    destructor() {
      if(destroyed) return
      destroyed = true
      for(const target of [...windows]) dispose(target)
      host = null
    }
  }
}
module.exports = {createGui, secureHostClass}
