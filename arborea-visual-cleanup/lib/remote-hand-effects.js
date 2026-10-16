'use strict';

function createRemoteHandEffects(mod, state, clearer) {
    const active = !!(state.clientEligible && state.settings.hideHandGlow &&
        typeof mod.toClient === 'function' && typeof mod.setTimeout === 'function' &&
        typeof mod.clearTimeout === 'function' && typeof clearer?.clear === 'function');
    const players = new Map(), identities = new Map(), hooks = [], missing = [];
    let disposed = false, generation = 0, ownerId = null, requests = 0;
    const validId = id => typeof id === 'bigint' && id > 0n && id <= 0xffffffffffffffffn;
    function identity(event) {
        const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
        return uint32(event.serverId) && uint32(event.playerId) ? `${event.serverId}:${event.playerId}` : null;
    }

    function cancelActor(actor) {
        for (const batch of Object.values(actor.batches)) {
            for (const timer of batch) mod.clearTimeout(timer);
            batch.clear();
        }
        actor.deadlines.clear();
        actor.transitionReason = null;
    }
    function removeActor(actor) {
        cancelActor(actor);
        if (players.get(actor.id) === actor) players.delete(actor.id);
        if (actor.identity !== null && identities.get(actor.identity) === actor) identities.delete(actor.identity);
    }
    function reset() {
        generation++;
        for (const actor of players.values()) cancelActor(actor);
        players.clear();
        identities.clear();
        ownerId = null;
    }
    function syncOwner() {
        const id = mod.game.me?.gameId;
        if (!mod.game.isIngame || !validId(id)) {
            if (ownerId !== null || players.size) reset();
            return null;
        }
        if (ownerId !== id) {reset(); ownerId = id;}
        return id;
    }
    function ready() {
        return mod.game.isIngame && !mod.game.isInLoadingScreen && validId(ownerId);
    }
    function schedule(actor, kind, reason) {
        if (disposed || !active || !syncOwner() || players.get(actor.id) !== actor || !actor.alive || !ready()) return;
        const batch = actor.batches[kind];
        let delays = kind === 'transition' ? [50, 500, 1500, 3000, 6000] : [50, 500];
        if (batch.size) {
            if (kind !== 'transition' || actor.transitionReason === reason) return;
            const first = [...batch].reduce((a, b) => actor.deadlines.get(a) <= actor.deadlines.get(b) ? a : b);
            for (const timer of batch) if (timer !== first) {
                mod.clearTimeout(timer); batch.delete(timer); actor.deadlines.delete(timer);
            }
            delays = [50, 1500, 3000, 6000];
        }
        if (kind === 'transition') actor.transitionReason = reason;
        const epoch = generation, owner = ownerId;
        for (const delay of delays) {
            const timer = mod.setTimeout(() => {
                if (!batch.has(timer)) return;
                batch.delete(timer); actor.deadlines.delete(timer);
                if (kind === 'transition' && !batch.size) actor.transitionReason = null;
                if (disposed || !syncOwner() || epoch !== generation || owner !== ownerId ||
                    players.get(actor.id) !== actor || !actor.alive || !ready()) return;
                try {
                    if (clearer.clear(actor.id).sent) requests = Math.min(Number.MAX_SAFE_INTEGER, requests + 1);
                } catch (_) {}
            }, delay);
            batch.add(timer); actor.deadlines.set(timer, Date.now() + delay);
        }
    }
    function settleAll(reason) {
        if (disposed || !active || !syncOwner() || !ready()) return;
        for (const actor of players.values()) schedule(actor, 'transition', reason);
    }
    function observe(name, version, callback, fake = null) {
        let hook;
        try {
            hook = mod.tryHook(name, version, {order: 100000000, filter: {fake, modified: null, silenced: false}}, event => {
                if (disposed || event.$silenced === true || !syncOwner()) return;
                callback(event);
            });
        } catch (_) {}
        if (hook) hooks.push(hook); else missing.push(name);
    }
    function knownActor(id) {return validId(id) && id !== ownerId ? players.get(id) : undefined;}
    const onEnter = () => settleAll('enter-game');
    const onLoaded = () => settleAll('loading-complete');

    if (active) {
        observe('S_SPAWN_USER', 16, event => {
            if (!validId(event.gameId) || event.gameId === ownerId || typeof event.alive !== 'boolean') return;
            const old = players.get(event.gameId);
            if (old) removeActor(old);
            const key = identity(event), previous = key === null ? null : identities.get(key);
            if (previous) removeActor(previous);
            if (players.size >= 1024) return;
            const actor = {id: event.gameId, alive: event.alive, identity: key,
                batches: {activation: new Set(), transition: new Set()}, deadlines: new Map(), transitionReason: null};
            players.set(actor.id, actor);
            if (key !== null) identities.set(key, actor);
            schedule(actor, 'transition', 'player-spawn');
        });
        observe('S_DESPAWN_USER', 3, event => {
            const actor = knownActor(event.gameId);
            if (actor) removeActor(actor);
        });
        observe('S_CREATURE_LIFE', 3, event => {
            const actor = knownActor(event.gameId);
            if (!actor || typeof event.alive !== 'boolean') return;
            actor.alive = event.alive;
            if (actor.alive) schedule(actor, 'transition', 'player-resurrection');
            else cancelActor(actor);
        });
        observe('S_PLAY_EFFECT', 1, event => {
            const actor = knownActor(event.gameId);
            if (actor && event.id === 116081901) schedule(actor, 'activation', 'played-effect');
        });
        for (const [name, version] of [['S_ABNORMALITY_BEGIN', 4], ['S_ABNORMALITY_REFRESH', 2]]) {
            observe(name, version, event => {
                const actor = knownActor(event.target);
                if (actor && event.id === 900008) schedule(actor, 'activation', 'hand-buff');
            });
        }
        for (const name of ['S_PARTY_MEMBER_ABNORMAL_ADD', 'S_PARTY_MEMBER_ABNORMAL_REFRESH']) {
            observe(name, 3, event => {
                if (event.id !== 900008) return;
                const key = identity(event), actor = key === null ? null : identities.get(key);
                if (actor && players.get(actor.id) === actor) schedule(actor, 'activation', 'hand-buff');
            });
        }
        observe('C_LOAD_TOPO_FIN', 1, event => {
            if (event.$fake === false) settleAll('client-load-finish');
        }, false);
        mod.game.on('enter_game', onEnter);
        mod.game.on('leave_loading_screen', onLoaded);
        mod.game.on('enter_loading_screen', reset);
        mod.game.on('leave_game', reset);
    }
    return {
        status() {
            let pending = 0;
            for (const actor of players.values()) pending += actor.batches.activation.size + actor.batches.transition.size;
            return {active: active && !disposed, players: players.size, pending, requests, missing: [...missing]};
        },
        dispose() {
            if (disposed) return;
            disposed = true; reset();
            for (const hook of hooks) mod.unhook(hook);
            if (active) {
                mod.game.removeListener('enter_game', onEnter);
                mod.game.removeListener('leave_loading_screen', onLoaded);
                mod.game.removeListener('enter_loading_screen', reset);
                mod.game.removeListener('leave_game', reset);
            }
        }
    };
}

module.exports = {createRemoteHandEffects};
