'use strict';
const {inside, sha256} = require('./client-state');

function selectAssetVariant(settings, manifest) {
    const features = [];
    if (settings.hideFlyingDashBlur) features.push('flyingDashBlur');
    if (settings.hideNostrumFlash) features.push('nostrumFlash');
    if (!features.length) return null;
    const entry = manifest.variants?.[features.join('+')];
    if (!entry || JSON.stringify(entry.features) !== JSON.stringify(features)) throw new Error('Invalid asset variant');
    return entry;
}

async function installSelectedAssets(installer, state, manifest) {
    try {
        const entry = selectAssetVariant(state.settings, manifest);
        if (!entry || !state.clientEligible || !state.assetEligible || manifest.sourceSha256 !== state.baseline.sha256) {
            return {applied: false, features: []};
        }
        if (sha256(inside(state.moduleRoot, entry.file)) !== entry.sha256) throw new Error('Asset fingerprint mismatch');
        await installer.gpk(entry.file, 'PostProcess.gpk');
        return {applied: true, features: [...entry.features]};
    } catch (_) {
        return {applied: false, features: []};
    }
}

module.exports = {selectAssetVariant, installSelectedAssets};
