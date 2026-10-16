'use strict';
const RESOURCE = 'FX_O_HotFix_160819.PS.O_1001_PS';

function createHandEffect(mod, state) {
    let disposed = false;
    function clear(targetId) {
        const game = mod.game;
        if (disposed || !state.clientEligible || !game?.isIngame || game.isInLoadingScreen) return {sent: false};
        const selfId = game.me?.gameId;
        if (typeof selfId !== 'bigint' || selfId <= 0n || selfId > 0xffffffffffffffffn) return {sent: false};
        const gameId = targetId === undefined ? selfId : targetId;
        if (typeof gameId !== 'bigint' || gameId <= 0n || gameId > 0xffffffffffffffffn || typeof mod.toClient !== 'function') return {sent: false};
        try {
            return {sent: mod.toClient('S_REMOVE_EFFECT', 1, {gameId, name: RESOURCE}) !== false};
        } catch (_) {
            return {sent: false};
        }
    }
    return {clear, dispose() {disposed = true;}};
}

module.exports = {createHandEffect};
