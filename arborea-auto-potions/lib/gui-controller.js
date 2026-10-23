'use strict'
// Local GUI/persistence patterns adapted from Arborea Prediction, GPL-3.0-only.
const {createHash} = require('crypto')
const schema = require('./settings')
const catalog = require('../data/potions.json')
const {createSettingsStore} = require('./settings-store')
const clone = value => JSON.parse(JSON.stringify(value))
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const message = error => String(error?.message || error).slice(0,512)
// Toolbox network instances share one settings object but have separate engines.
// Publish only durable commits, and only to controllers owning that same object.
const subscribers = new WeakMap()

function createController({mod, engine, store}) {
  const storage = store || createSettingsStore(mod.info?.path || mod.path)
  const version = require('../package.json').version
  const shared = mod.settings
  let activationError = null, destroyed = false, active = schema.normalize(shared)
  let peers = subscribers.get(shared)
  if(!peers) { peers = new Set(); subscribers.set(shared, peers) }
  function applyCommitted(settings) {
    try {
      engine.setSettings(clone(settings))
      active = clone(settings)
      activationError = null
    } catch(error) {
      activationError = `Settings were saved, but could not be activated: ${message(error)}. Restart Toolbox.`
    }
  }
  peers.add(applyCommitted)
  function getState() {
    const settings = schema.normalize(mod.settings)
    return {...clone(engine.getState()), version, settings:clone(settings), defaults:schema.defaults(),
      // The production engine also exposes a session-only emergency pause here.
      activeSettings:clone(engine.settings ? schema.normalize(engine.settings) : active),
      revision:revision(settings), ...(activationError ? {activationError} : {})}
  }
  function failed(error, conflict = false) { return {ok:false, error, ...(conflict ? {conflict:true} : {}), state:getState()} }
  function saveSettings(payload) {
    if(destroyed) return failed('This settings controller has been unloaded.')
    if(mod.settings !== shared) return failed('The settings reference changed. Reopen the module before saving.')
    let candidate, requestedRevision
    try {
      if(!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
        Reflect.ownKeys(payload).some(key => !['settings','revision'].includes(key))) return failed('Invalid save request.')
      const s = Object.getOwnPropertyDescriptor(payload, 'settings'), r = Object.getOwnPropertyDescriptor(payload, 'revision')
      if(!s || !r || !own(s,'value') || !own(r,'value') || !s.enumerable || !r.enumerable ||
        typeof r.value !== 'string' || !/^[a-f0-9]{64}$/.test(r.value)) return failed('Settings and a valid revision are required.')
      requestedRevision = r.value
      const checked = schema.validate(s.value, catalog)
      if(!checked.ok) return failed(checked.error || 'Invalid settings.')
      candidate = clone(checked.settings)
    } catch(error) { return failed(`Invalid settings: ${message(error)}`) }
    if(requestedRevision !== revision(schema.normalize(mod.settings)))
      return failed('Settings changed elsewhere. Load the current settings before saving.', true)
    let result
    try { result = storage.save(candidate) }
    catch(error) { return failed(`Could not save: ${message(error)}`) }
    if(result?.ok !== true) return failed(`Could not save: ${result?.error || 'Storage did not confirm the write.'}`)
    // Toolbox's legacy Proxy forwards settings reads, but not root assignment.
    for(const key of Object.keys(shared)) delete shared[key]
    Object.assign(shared, clone(candidate))
    for(const apply of [...peers]) apply(candidate)
    if(activationError) return failed(activationError)
    return {ok:true, state:getState()}
  }
  function destructor() {
    if(destroyed) return
    destroyed = true
    peers.delete(applyCommitted)
    if(peers.size === 0) subscribers.delete(shared)
  }
  return {getState, saveSettings, destructor}
}
module.exports = {createController}
