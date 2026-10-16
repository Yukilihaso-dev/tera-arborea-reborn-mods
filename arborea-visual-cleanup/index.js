'use strict';
const fs = require('fs');
const path = require('path');
const {getClientState} = require('./lib/client-state');
const {applyCameraShakePolicy, bindCameraShakePolicy} = require('./lib/camera-shake');
const {installSelectedAssets} = require('./lib/asset-selection');
const {createHandEffect} = require('./lib/hand-effect');
const {createHandEffects} = require('./lib/hand-effects');

class ClientMod {
    constructor(mod, moduleRoot = __dirname) {
        this.state = getClientState(mod.clientInterface, moduleRoot);
        if (this.state.clientEligible) {
            this.cameraResult = applyCameraShakePolicy(mod.clientInterface, this.state.settings.disableScreenShake);
        }
    }

    async install(installer) {
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(this.state.moduleRoot, 'assets/manifest.json'), 'utf8'));
            this.assetResult = await installSelectedAssets(installer, this.state, manifest);
        } catch (_) {
            this.assetResult = {applied: false, features: []};
        }
        return this.assetResult;
    }
}

class NetworkMod {
    constructor(mod, moduleRoot = __dirname) {
        this.state = getClientState(mod.clientInterface, moduleRoot);
        this.disposeCamera = bindCameraShakePolicy(mod, this.state.clientEligible && this.state.settings.disableScreenShake);
        this.handEffect = createHandEffect(mod, this.state);
        this.handEffects = createHandEffects(mod, this.state, this.handEffect);
    }

    destructor() {
        this.disposeCamera();
        this.handEffects.dispose();
        this.handEffect.dispose();
    }
}

module.exports = {ClientMod, NetworkMod};
