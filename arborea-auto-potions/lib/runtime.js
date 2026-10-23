'use strict'

// Versions verified in the installed Arborea Toolbox data/data.json bundle.
// There is no guessed packet version or generated game response in this adapter.
// Run after game-state's state hooks, before ordinary item users. Silenced and
// modified real packets remain observable at either side of another hook.
const REAL = {order:-900,filter:{fake:false,modified:null,silenced:null}}
const ITEM_USE = {order:-900,filter:{fake:null,incoming:false,modified:null,silenced:null}}
const CLASSES = Object.freeze({warrior:0,lancer:1,slayer:2,berserker:3,sorcerer:4,archer:5,
  priest:6,elementalist:7,soulless:8,engineer:9,fighter:10,assassin:11,glaiver:12})
const classId = value => Number.isInteger(value) && value >= 0 && value <= 12 ? value :
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(CLASSES,value) ? CLASSES[value] : null
const ITEM_ERRORS = new Set([
  'SMT_BATTLE_CANT_USE_ITEM_THIS_STATUS','SMT_BF_CANT_USE_ITEM',
  'SMT_CANT_USE_ITEM_COOLTIME','SMT_CANT_USE_ITEM_IN_DUNGEON',
  'SMT_CANT_USE_ITEM_IN_TROUBLED_REGION','SMT_CANT_USE_ITEM_MISS_AREA',
  'SMT_CANT_USE_ITEM_NOW','SMT_CANT_USE_ITEM_UNION_LAWLESS_AREA',
  'SMT_COMMON_NO_MORE_ITEM_TO_USE','SMT_HOLD_PLAYER_CANT_USE_ITEM'
])
const EMPTY = () => ({connected:false,loading:true,alive:false,inCombat:false,mounted:false,
  trading:false,inventoryReady:false,hp:null,maxHp:null,mp:null,maxMp:null,
  level:0,class:null,loc:null,w:null,items:[],blockedReason:null})
const validId = value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff
const uint64 = value => typeof value === 'bigint' && value > 0n && value <= 0xffffffffffffffffn
const locCopy = loc => loc && Number.isFinite(loc.x) && Number.isFinite(loc.y) && Number.isFinite(loc.z)
  ? {x:loc.x,y:loc.y,z:loc.z} : null
function resource(value) {
  if (typeof value === 'bigint') return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(value) ? value : null
}

module.exports = function createRuntime(mod,engine) {
  let supported = true, unsupportedReason = null, disposed = false, selfSend = false, pendingOwnSend = null, timer = null
  let gameId = uint64(mod.game && mod.game.me && mod.game.me.gameId) ? mod.game.me.gameId : null
  let inventoryOwner = null, inventoryBatchPending = false, tradeOpen = false, snapshot = EMPTY()
  const hooks = [], listeners = []

  function unavailable(packet) {
    if (!supported) return
    supported = false
    unsupportedReason = `Auto Potions unavailable: ${packet}`
    if (typeof mod.warn === 'function') mod.warn(`Auto Potions paused: required packet/state unavailable (${packet}).`)
  }
  function update(patch) {
    if (disposed) return
    Object.assign(snapshot,patch)
    engine.update(patch)
  }
  function refreshFlags() {
    const game = mod.game, me = game && game.me
    const same = !!me && uint64(gameId) && gameId === me.gameId
    update({blockedReason:unsupportedReason,connected:supported && same && game.isIngame === true,
      loading:!game || game.isInLoadingScreen !== false,
      alive:same && me.alive === true,inCombat:same && me.inCombat === true,
      mounted:!same || me.mounted === true || me.onPegasus === true,
      trading:tradeOpen || !!(game && game.contract && game.contract.active),
      level:same && Number.isSafeInteger(me.level) && me.level > 0 ? me.level : 0,
      class:same ? classId(me.class) : null})
  }
  function inventoryInfo() {
    const inventory = mod.game && mod.game.inventory
    try {
      if (!inventory || inventory._buffer || !Number.isInteger(inventory.pocketCount) ||
          inventory.pocketCount < 1 || !Array.isArray(inventory.pockets) || !inventory.pockets[0]) return {ready:false,items:[]}
      const all = inventory.bagOrPocketItems
      if (!Array.isArray(all)) return {ready:false,items:[]}
      return {ready:true,items:all.filter(item => item && item.container === 0 &&
        Number.isInteger(item.pocket) && item.pocket >= 0 && validId(item.id) && uint64(item.dbid) &&
        Number.isSafeInteger(item.amount) && item.amount > 0).map(item => ({id:item.id,dbid:item.dbid,amount:item.amount}))}
    } catch (_) { return {ready:false,items:[]} }
  }
  function refreshInventory(observed = false) {
    if (disposed) return
    // Equipment and pocket packets can precede the bag in a single batch.
    // game-state clears its per-container _buffer between those packets, so
    // that alone cannot establish that the entire inventory is current.
    if (inventoryBatchPending) { update({inventoryReady:false}); return }
    const info = inventoryInfo()
    if (observed && info.ready && gameId === (mod.game && mod.game.me && mod.game.me.gameId)) inventoryOwner = gameId
    const ready = info.ready && uint64(gameId) && inventoryOwner === gameId
    const items = ready ? info.items : []
    update({inventoryReady:ready,items})
    engine.inventoryChanged(items)
  }
  function reset(full = false) {
    if (disposed) return
    engine.reset({preserveCooldowns:!full})
    snapshot = {...EMPTY(),blockedReason:unsupportedReason}; tradeOpen = false
    // game-state keeps same-character inventory buffers across zone changes.
    // Keep their batch gate until completion; a new character needs fresh data.
    if (full) { inventoryOwner = null; inventoryBatchPending = false }
    engine.update(snapshot)
  }
  function position(event) {
    update({loc:locCopy(event.loc),w:typeof event.w === 'number' && Number.isFinite(event.w) ? event.w : null})
  }
  function own(event,field = 'gameId') { return uint64(gameId) && event[field] === gameId }
  function hook(name,version,callback,options = REAL) {
    try { hooks.push(mod.hook(name,version,options,event => { if (!disposed) callback(event) })) }
    catch (_) { unavailable(`${name}.${version}`) }
  }
  function listen(emitter,event,callback) {
    if (!emitter || typeof emitter.on !== 'function') { unavailable(event); return }
    emitter.on(event,callback); listeners.push({emitter,event,callback})
  }
  function startTimer() {
    if (disposed) return
    // Toolbox automatically clears mod intervals on leave_game. Replacing this
    // handle on login also covers an already-cleared timer without duplicates.
    if (timer !== null) mod.clearInterval(timer)
    timer = mod.setInterval(() => { if (!disposed) { refreshFlags(); engine.tick() } },250)
  }

  try { mod.game.initialize(['inventory','contract']) }
  catch (_) { unavailable('inventory/contract') }
  if (!mod.game || !mod.game.me || !mod.game.inventory || !mod.game.contract) unavailable('game state')
  // This profile uses the definitions installed for Arborea's patch100. Other
  // patches must not fall through to a guessed stat/inventory layout.
  if (mod.majorPatchVersion !== 100) unavailable(`patch ${mod.majorPatchVersion}`)

  hook('S_LOGIN',14,event => {
    reset(true); gameId = uint64(event.gameId) ? event.gameId : null; refreshFlags(); startTimer()
  })
  hook('S_LOAD_TOPO',3,() => { reset(); refreshFlags(); update({loading:true}) })
  for (const name of ['S_RETURN_TO_LOBBY','S_EXIT']) hook(name,'event',() => {
    reset(true); gameId = null; update({connected:false,loading:true})
  })
  hook('S_SPAWN_ME',3,event => {
    if (!own(event)) return
    refreshFlags(); position(event); refreshInventory()
  })
  hook('S_CREATURE_LIFE',3,event => {
    if (!own(event)) return
    reset(); refreshFlags(); update({alive:event.alive === true})
    if (event.alive === true) refreshInventory()
  })
  for (const name of ['S_MOUNT_VEHICLE','S_UNMOUNT_VEHICLE']) hook(name,2,event => {
    if (own(event)) refreshFlags()
  })
  hook('S_USER_STATUS',3,event => { if (own(event)) refreshFlags() })
  hook('S_PLAYER_STAT_UPDATE',14,event => {
    if (!uint64(gameId) || gameId !== mod.game.me.gameId) return
    refreshFlags(); update({hp:resource(event.hp),maxHp:resource(event.maxHp),
      mp:resource(event.mp),maxMp:resource(event.maxMp)})
  })
  hook('S_CREATURE_CHANGE_HP',6,event => {
    if (own(event,'target')) { refreshFlags(); update({hp:resource(event.curHp),maxHp:resource(event.maxHp)}) }
  })
  hook('S_PLAYER_CHANGE_MP',1,event => {
    if (own(event,'target')) { refreshFlags(); update({mp:resource(event.currentMp),maxMp:resource(event.maxMp)}) }
  })
  for (const [name,version] of [['C_PLAYER_LOCATION',5],['C_NOTIFY_LOCATION_IN_ACTION',4],['C_NOTIFY_LOCATION_IN_DASH',4]])
    hook(name,version,event => { if (uint64(gameId)) position(event) })
  hook('S_INSTANT_MOVE',3,event => { if (own(event)) position(event) })
  for (const [name,version] of [['S_ACTION_STAGE',9],['S_ACTION_END',5]])
    hook(name,version,event => { if (own(event)) position(event) })
  hook('S_ITEMLIST',4,event => {
    if (!own(event)) return
    inventoryBatchPending = event.more === true || event.lastInBatch !== true
    if (inventoryBatchPending) update({inventoryReady:false})
    else refreshInventory(true)
  })
  listen(mod.game && mod.game.inventory,'update',() => { refreshFlags(); refreshInventory(true) })

  for (const name of ['S_REQUEST_CONTRACT','S_ACCEPT_CONTRACT','S_CANCEL_CONTRACT','S_REJECT_CONTRACT'])
    hook(name,1,refreshFlags)
  // Conservative UI inference from mapped trade opcodes. The installed bundle
  // has no trade .def, so no payload fields or contract numbers are invented.
  hook('S_TRADE_BOX','event',() => { tradeOpen = true; refreshFlags() })
  hook('S_TRADE_BAG_CLOSE','event',() => { tradeOpen = false; refreshFlags() })

  hook('C_USE_ITEM',3,event => {
    if (!own(event) || !validId(event.id)) return
    // Dispatch runs hooks synchronously. Suppress this one exact automatic
    // request, while still observing additional requests emitted by other mods
    // inside its hook chain, including another use of the same item/stack.
    if (pendingOwnSend && !pendingOwnSend.observed && event.$fake === true && event.$incoming === false &&
        event.gameId === pendingOwnSend.gameId && event.id === pendingOwnSend.id && event.dbid === pendingOwnSend.dbid) {
      pendingOwnSend.observed = true
      return
    }
    engine.observeUse(event.id)
  },ITEM_USE)
  hook('S_START_COOLTIME_ITEM',1,event => {
    if (validId(event.item) && Number.isSafeInteger(event.cooldown) && event.cooldown >= 0)
      engine.cooldown(event.item,event.cooldown * 1000)
  })
  hook('S_SYSTEM_MESSAGE',1,event => {
    if (typeof engine.reject !== 'function') return
    let message
    try { message = mod.parseSystemMessage(event.message) } catch (_) { return }
    if (message && ITEM_ERRORS.has(message.id) && engine.getState().pending)
      engine.reject(`unattributed item-use message: ${message.id}`)
  })

  snapshot.blockedReason = unsupportedReason
  engine.update(snapshot)
  // No immediate tick: the entry point finishes assigning runtime before the
  // first callback can invoke its send method.
  startTimer()

  function send(item,stack) {
    if (disposed || !supported || selfSend) return false
    const game = mod.game, me = game && game.me
    if (!me || !uint64(gameId) || gameId !== me.gameId || game.isIngame !== true ||
        game.isInLoadingScreen !== false || me.alive !== true || me.mounted || me.onPegasus ||
        tradeOpen || !game.contract || game.contract.active || !snapshot.inventoryReady ||
        !snapshot.alive || snapshot.loading || !locCopy(snapshot.loc) || !Number.isFinite(snapshot.w) ||
        snapshot.hp === null || !(snapshot.maxHp > 0) || snapshot.mp === null || !(snapshot.maxMp > 0) ||
        snapshot.hp <= 0 || snapshot.level <= 0 || snapshot.class === null ||
        !item || !validId(item.id) || !stack || !uint64(stack.dbid) || stack.id !== item.id) return false
    const current = inventoryInfo()
    if (!current.ready || !current.items.some(candidate => candidate.id === item.id &&
        candidate.dbid === stack.dbid && candidate.amount > 0)) return false
    const packet = {gameId,id:item.id,dbid:stack.dbid,target:0n,amount:1,
      dest:{x:0,y:0,z:0},loc:locCopy(snapshot.loc),w:snapshot.w,
      unk1:0,unk2:0,unk3:0,unk4:true}
    pendingOwnSend = {gameId,id:item.id,dbid:stack.dbid,observed:false}
    selfSend = true
    try { return mod.send('C_USE_ITEM',3,packet) === true }
    catch (_) { return false }
    finally { selfSend = false; pendingOwnSend = null }
  }
  function destructor() {
    if (disposed) return
    disposed = true
    if (timer !== null) { mod.clearInterval(timer); timer = null }
    for (const handle of hooks.splice(0)) mod.unhook(handle)
    for (const {emitter,event,callback} of listeners.splice(0)) emitter.removeListener(event,callback)
    gameId = null; inventoryOwner = null; snapshot = EMPTY(); engine.reset()
  }
  return {send,destructor}
}
module.exports.createRuntime = module.exports
