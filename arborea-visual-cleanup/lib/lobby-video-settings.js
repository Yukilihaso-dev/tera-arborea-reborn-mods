'use strict';
const {inside, sha256} = require('./client-state');

// Both UI packages are pinned to the exact client files they were built from and to their own fingerprint.
const packages = [
    {destination: 'S1UI_SystemOption.gpk', sourceSha256: 'ddc84364bcadd34732f3edd703f6e1d2b332c83135ea4fed71a97e0af436b434', sha256: 'fbd3d7df58cb4760f430242878a6aef39ed8444255a0aad86a454c549ff8e570'},
    {destination: 'S1UI_SelectCharacter.gpk', sourceSha256: 'ca207539deb01d8cb0938eb47958d96efddf9aacb4e7972f7df3c48ddb5bf1a2', sha256: '96fc11c951c6020a4d85de659108d496f7d943a499f922b3e3336bf879ac8f58'},
];
const sourceDirectory = 'S1Game/CookedPC/Art_Data/Packages/S1UI/';
const assetDirectory = 'assets/lobby-video-settings/';

async function installLobbyVideoSettings(installer, state) {
    const installed = [];
    const skip = reason => ({applied: false, installed, reason});
    if (state.settings.applyVideoSettingsAtCharacterSelect !== true) return skip('disabled');
    if (!state.clientEligible) return skip('unsupported client build');

    try {
        // Validate the complete pair before installing anything.
        for (const pkg of packages) {
            if (sha256(inside(state.gameRoot, sourceDirectory + pkg.destination)) !== pkg.sourceSha256) return skip('client file mismatch: ' + pkg.destination);
            if (sha256(inside(state.moduleRoot, assetDirectory + pkg.destination)) !== pkg.sha256) return skip('asset mismatch: ' + pkg.destination);
        }
        // SystemOption is inert alone; the SelectCharacter package that opens it goes in last.
        for (const pkg of packages) {
            await installer.gpk(assetDirectory + pkg.destination, pkg.destination);
            installed.push(pkg.destination);
        }
    } catch (_) {
        return skip('installation failed');
    }
    return {applied: true, installed};
}

module.exports = {installLobbyVideoSettings};