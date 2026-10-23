'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {EventEmitter} = require('node:events')
class Host extends EventEmitter {
  constructor() { super(); this.sent=[]; this.destroyed=0 }
  show() {
    if(this.window) return
    this.window = new EventEmitter()
    this.window.webContents = new EventEmitter()
    this.window.webContents.setWindowOpenHandler = fn => { this.openHandler=fn }
    this.window.focus = () => {}
    this.window.close = () => { this.closeRequests=(this.closeRequests||0)+1 }
    this.window.destroy = () => { this.destroyed++; this.window.emit('closed') }
  }
  send(...args) { this.sent.push(args) }
  destructor() { this.cleaned = true }
}
test('host authenticates actual WebContents and allowlists only state and save', () => {
  const {secureHostClass} = require('../lib/gui')
  const Secure = secureHostClass(Host), host = new Secure()
  host.show(); let requests=0, uses=0
  host.on('request-state', () => requests++)
  host.on('use-item', () => uses++)
  host._handleEvent({sender:{id:host.window.id}}, 'request-state')
  host._handleEvent({sender:host.window.webContents}, 'use-item', 1)
  host._handleEvent({sender:host.window.webContents}, 'request-state')
  assert.equal(requests, 1); assert.equal(uses, 0)
})
test('GUI opens once, relays only controller requests, blocks navigation and destroys on unload', () => {
  const {createGui} = require('../lib/gui')
  const hosts=[]; let saves=0, reads=0
  const gui=createGui({}, {getState:()=>({read:++reads}), saveSettings:()=>({ok:true, count:++saves})},
    {guiAvailable:()=>true, createHost:()=>{ const host=new Host();hosts.push(host);return host }})
  assert.equal(gui.show().ok,true); assert.equal(gui.show().ok,true); assert.equal(hosts.length,1)
  hosts[0].emit('request-state'); hosts[0].emit('save-settings', {})
  assert.deepEqual(hosts[0].sent,[['state',{read:1}],['result',{ok:true,count:1}]])
  let prevented=false
  hosts[0].window.webContents.emit('will-navigate',{preventDefault(){prevented=true}})
  assert.equal(prevented,true);assert.deepEqual(hosts[0].openHandler(),{action:'deny'})
  gui.destructor();gui.destructor()
  assert.equal(hosts[0].destroyed,1);assert.equal(hosts[0].cleaned,true)
  assert.equal(gui.show().ok,false)
})
test('a cancelled close leaves the native window and event listeners connected', () => {
  const {secureHostClass} = require('../lib/gui')
  const Secure=secureHostClass(Host),host=new Secure();host.show()
  const window=host.window
  host.close()
  assert.equal(host.window,window);assert.equal(host.closeRequests,1)
})
