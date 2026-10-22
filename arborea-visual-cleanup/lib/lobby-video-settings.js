'use strict';
const {inside, sha256} = require('./client-state');

const packages = [
    {destination: 'S1UI_SystemOption.gpk', sourceSha256: 'ddc84364bcadd34732f3edd703f6e1d2b332c83135ea4fed71a97e0af436b434'},
    {destination: 'S1UI_SelectCharacter.gpk', sourceSha256: 'ca207539deb01d8cb0938eb47958d96efddf9aacb4e7972f7df3c48ddb5bf1a2'},
];
const sourceDirectory = 'S1Game/CookedPC/Art_Data/Packages/S1UI/';
const assetDirectory = 'assets/lobby-video-settings-v2/';

async function installLobbyVideoSettings(installer, state, manifest) {
    const installed = [];
    const skip = reason => ({applied: false, installed, reason});
    if (state.settings.applyVideoSettingsAtCharacterSelectV2 !== true) return skip('Character-selection video settings v2 are disabled.');
    if (!state.clientEligible) return skip('Unsupported client build for character-selection video settings.');

    let selected;
    try {
        if (!manifest || manifest.version !== 2 || !Array.isArray(manifest.packages)
                || manifest.packages.length !== 2
                || Object.keys(manifest).sort().join(',') !== 'packages,version') {
            return skip('Invalid character-selection video settings manifest.');
        }
        selected = packages.map(pin => {
            const entries = manifest.packages.filter(entry => entry && entry.destination === pin.destination);
            if (entries.length !== 1) throw new Error('Invalid UI package manifest destinations.');
            const entry = entries[0];
            if (Object.keys(entry).sort().join(',') !== 'destination,file,sha256,source,sourceSha256'
                    || entry.source !== sourceDirectory + pin.destination
                    || entry.sourceSha256 !== pin.sourceSha256
                    || entry.file !== assetDirectory + pin.destination
                    || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
                throw new Error('Invalid UI package manifest paths or fingerprints.');
            }
            return entry;
        });
        // Validate the complete pair before allowing the auto-open package to install.
        for (const entry of selected) {
            if (sha256(inside(state.gameRoot, entry.source)) !== entry.sourceSha256) {
                return skip(`UI source fingerprint mismatch: ${entry.destination}`);
            }
            if (sha256(inside(state.moduleRoot, entry.file)) !== entry.sha256) {
                return skip(`UI asset fingerprint mismatch: ${entry.destination}`);
            }
        }
    } catch (_) {
        return skip('UI manifest, package path, or fingerprint could not be validated.');
    }

    try {
        // SystemOption is inert alone; never install the auto-open SelectCharacter first.
        for (const entry of selected) {
            await installer.gpk(entry.file, entry.destination);
            installed.push(entry.destination);
        }
    } catch (_) {
        return skip('Character-selection video settings package installation failed.');
    }
    return {applied: true, installed};
}

module.exports = {installLobbyVideoSettings};
