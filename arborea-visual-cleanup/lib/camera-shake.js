'use strict';
function applyCameraShakePolicy(clientInterface, disabled) {
    if (!disabled) return {applied:false,reason:'Camera-shake control is off; restart restores the original policy.'};
    if (typeof clientInterface.configureCameraShake !== 'function') return {applied:false,reason:'Camera-shake API unavailable.'};
    try {clientInterface.configureCameraShake(false);return {applied:true,reason:'Camera-shake suppression requested from the client.'};}
    catch(e) {return {applied:false,reason:`Camera-shake request failed: ${e.message}`};}
}
function bindCameraShakePolicy(mod, disabled, onResult = () => {}) {
    const apply = () => onResult(applyCameraShakePolicy(mod.clientInterface,disabled));
    apply();
    if (!disabled) return () => {};
    mod.game.on('enter_game',apply);
    mod.game.on('leave_loading_screen',apply);
    return () => {mod.game.removeListener('enter_game',apply);mod.game.removeListener('leave_loading_screen',apply);};
}
module.exports={applyCameraShakePolicy,bindCameraShakePolicy};
