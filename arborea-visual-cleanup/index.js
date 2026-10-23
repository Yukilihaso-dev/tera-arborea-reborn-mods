'use strict';
const fs = require('fs');
const path = require('path');
const {getClientState} = require('./lib/client-state');
const {applyCameraShakePolicy, bindCameraShakePolicy} = require('./lib/camera-shake');
const {installSelectedAssets} = require('./lib/asset-selection');
const {installLobbyVideoSettings} = require('./lib/lobby-video-settings');
const {createHandEffect} = require('./lib/hand-effect');
const {createHandEffects} = require('./lib/hand-effects');
const {createRemoteHandEffects} = require('./lib/remote-hand-effects');

class ClientMod {
    constructor(mod, moduleRoot = __dirname) {
        this.state = getClientState(mod.clientInterface, moduleRoot);
        this.log = typeof mod.log === 'function' ? mod.log.bind(mod) : null;
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
        let lobbyManifest;
        try {
            lobbyManifest = JSON.parse(fs.readFileSync(path.join(this.state.moduleRoot, 'assets/lobby-video-settings-v2/manifest.json'), 'utf8'));
        } catch (_) {}
        const assetMessage = this.describeAssetOutcome();
        if (assetMessage && this.log) this.log(assetMessage);
        this.lobbyVideoSettingsResult = await installLobbyVideoSettings(installer, this.state, lobbyManifest);
        if (!this.lobbyVideoSettingsResult.applied && this.log) {
            this.log(`Character-selection video settings skipped: ${this.lobbyVideoSettingsResult.reason}`);
        }
        return this.assetResult;
    }

    // Explains why shader changes were or were not installed, so a silent
    // "nothing happened" can be diagnosed from the log. Returns null when no
    // shader option is enabled and there is nothing to report.
    describeAssetOutcome() {
        const {settings, clientEligible, assetEligible} = this.state;
        if (this.assetResult && this.assetResult.applied) {
            return `Shader changes installed: ${this.assetResult.features.join(', ')}.`;
        }
        if (!settings.hideFlyingDashBlur && !settings.hideNostrumFlash && !settings.hideVignette) return null;
        if (!clientEligible) {
            return 'Shader changes skipped: this client build does not match the supported baseline.';
        }
        if (!assetEligible) {
            return 'Shader changes skipped: PostProcess.gpk does not match the expected original (modified by another mod or patch?).';
        }
        return 'Shader changes skipped: the module asset files could not be validated or installed.';
    }
}

class NetworkMod {
    constructor(mod, moduleRoot = __dirname) {
        this.state = getClientState(mod.clientInterface, moduleRoot);
        this.disposeCamera = bindCameraShakePolicy(mod, this.state.clientEligible && this.state.settings.disableScreenShake);
        this.handEffect = createHandEffect(mod, this.state);
        this.handEffects = createHandEffects(mod, this.state, this.handEffect);
        this.remoteHandEffects = createRemoteHandEffects(mod, this.state, this.handEffect);
    }

    destructor() {
        this.disposeCamera();
        this.handEffects.dispose();
        this.remoteHandEffects.dispose();
        this.handEffect.dispose();
    }
}

module.exports = {ClientMod, NetworkMod};
