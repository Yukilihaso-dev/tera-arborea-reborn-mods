# Arborea Auto Potions 1.0

Build a separate, local TERA Toolbox mod for Arborea Reborn. Start paused. The player opens `pot gui`, chooses HP and MP thresholds and inventory potions, then enables it. The UI is English, compact, and reports actual resources, owned amounts, cooldowns, and the reason automation is waiting.

Use the current TW DataCenter supplied by the user to produce a curated potion catalog. Deprecated potions, foods, chests, and buff-only consumables are excluded. Automatic selection uses ordinary verified potions; valuable and combined potions are explicit choices. Combined potions have a visible either-resource / both-resources policy.

The pure engine decides from an authoritative snapshot; the Toolbox adapter owns packets, timers, and character lifecycle. A missing resource maximum, inventory, character, position, or supported packet disables use. Loading, death, mounting and trading also suspend use. One potion request can be outstanding. Observe manual/other-mod item use and server cooldowns, reserve shared cooldown groups immediately, and use bounded timeout/backoff on missing or failed confirmation. Never fabricate potion success from HP changes.

The adapter uses actual inventory stack DBIDs and `C_USE_ITEM` version 3. Opening, refreshing, or saving the GUI does not call the engine's use function. A bounded 250 ms timer performs normal automation checks. Settings change without forcing an immediate check. HP has priority when both independent resources are low.

Strict settings schema, atomic saves, revision checks, local-only renderer, sender validation, and teardown are required. GUI transport has only state-request and settings-save events. No game files or running installations are modified. Deliver a verified ZIP and a safe install script targeting only the new mod directory.

## Shared interfaces

Settings: `{schemaVersion:1, enabled:false, combatOnly:true, hp:{enabled:true,threshold:50,itemId:0}, mp:{enabled:true,threshold:30,itemId:0}, combinedPolicy:'either'}`. `itemId:0` means automatic ordinary inventory potion. Thresholds are integers 1..99. Combined policy is `either` or `both`.

Catalog JSON: `{metadata:{...},items:[{id,name,hp,mp,hpAmount?,mpAmount?,hpPercent?,mpPercent?,cooldownMs,group,level,automatic,rank,valuable?,classes?,note?}]}`. hp/mp are booleans. IDs are positive integers. group is a string. rank higher means preferred automatic selection. automatic excludes valuable consumables. Only catalog items appear in selectors; owned amounts come from the current inventory.

Engine: `new PotionEngine({catalog,settings,now,send})`; `update(snapshotPatch)`, `tick()`, `setSettings(settings)`, `observeUse(itemId)`, `cooldown(itemId,milliseconds)`, `inventoryChanged(items)`, `reset()`, `getState()`. `send(item,stack,snapshot)` returns true only if handed to Toolbox. No call except `tick()` sends an item. Engine keeps pending, reservations and backoff. Inventory snapshot records id/dbid/amount; dbid is never renderer-facing.

Final review additions: `observerItems` maps 120 other shared-cooldown items without permitting their consumption. Inventory changes release a request as unconfirmed; intervening/nested external use makes acknowledgements ambiguous. Same-character reset preserves cooldowns. The runtime holds inventory readiness through all containers of a batch, restarts its one timer after Toolbox clears intervals on logout, and supplies `blockedReason` for unavailable packet support. Controllers publish only durable commits to engines sharing the exact settings object, and unregister on module teardown.

Snapshot: `{connected:false,loading:true,alive:false,inCombat:false,mounted:false,trading:false,inventoryReady:false,hp:null,maxHp:null,mp:null,maxMp:null,level:0,class:null,loc:null,w:null,items:[]}`. Valid loc is finite x/y/z. Resources are finite nonnegative numbers and max values positive. All character-local values are reset across login/logout/loading. getState is JSON-safe and supplies `{status,reason,live:{connected,hp,maxHp,mp,maxMp,hpPercent,mpPercent,inCombat},channels:{hp:{itemId,name,owned,readyInMs},mp:{...}},potions:[{id,name,hp,mp,owned,automatic,valuable,note}],pending,lastAction}`.

Controller: `createController({mod,engine,store})` returns `{getState(),saveSettings({settings,revision})}`. State includes `{version,settings,defaults,revision,live,...engineState}`. Save returns `{ok,conflict?,error?,state}`. Apply via engine.setSettings only after validated persistent write. No timer or item-use call belongs in the controller. `createGui(mod,controller)` returns `{show(),destructor()}`.

## Implementation and verification

1. Audit actual client items and installed Toolbox protocol; write compact evidence and catalog.
2. Test and implement settings validation and deterministic engine: thresholds, inventory selection, combined policy, shared/manual cooldowns, confirmation, backoff and reset.
3. Implement/test adapter against exact packet fields and lifecycle events. Never send a real potion during verification.
4. Implement/test local GUI, persistence and dirty/conflict behavior; inspect rendered screenshots.
5. Integrate command entry point, docs and metadata. Independent review; fix findings.
6. Verify source and extracted release, manifest hashes and installer fixtures. Deliver with honest limits: live-game potion consumption has not been tested.
