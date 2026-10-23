'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sessions = new WeakMap();
const settingNames = ['hideHandGlow', 'hideNostrumFlash', 'hideFlyingDashBlur', 'disableScreenShake', 'hideVignette'];

function readJson(root, name) {
    return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
}

function inside(root, relative) {
    const resolved = path.resolve(root, relative);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel) || path.isAbsolute(relative)) {
        throw new Error('Invalid asset path');
    }
    return resolved;
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

function getClientState(clientInterface, moduleRoot) {
    if (sessions.has(clientInterface)) return sessions.get(clientInterface);
    const saved = readJson(moduleRoot, 'config.json');
    const settings = {};
    for (const name of settingNames) {
        const value = name === 'hideVignette' && saved[name] === undefined ? true : saved[name];
        if (typeof value !== 'boolean') throw new Error(`Invalid setting: ${name}`);
        settings[name] = value;
    }
    // On by default; set to false in config.json to leave the character-select screen untouched.
    settings.applyVideoSettingsAtCharacterSelect = saved.applyVideoSettingsAtCharacterSelect === undefined ? true : saved.applyVideoSettingsAtCharacterSelect === true;
    const baseline = readJson(moduleRoot, 'baseline.json');
    const info = clientInterface.info;
    if (!info || typeof info.path !== 'string') throw new Error('Client path unavailable');
    const gameRoot = path.resolve(info.path, '..');
    let clientEligible = false, assetEligible = false;
    try {
        const revision = fs.readFileSync(path.join(gameRoot, 'Binaries/ReleaseRevision.txt'), 'utf8').replace(/\r\n/g, '\n').trim();
        clientEligible = info.majorPatchVersion === baseline.major && info.minorPatchVersion === baseline.minor && revision === baseline.revision;
        if (clientEligible) assetEligible = sha256(inside(gameRoot, baseline.source)) === baseline.sha256;
    } catch (_) {}
    const state = freeze({settings, baseline, gameRoot, moduleRoot, clientEligible, assetEligible});
    sessions.set(clientInterface, state);
    return state;
}

module.exports = {getClientState, inside, sha256};
