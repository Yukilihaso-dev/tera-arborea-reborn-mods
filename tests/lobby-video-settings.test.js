'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {getClientState} = require('../arborea-visual-cleanup/lib/client-state');
const {ClientMod} = require('../arborea-visual-cleanup');

const moduleRoot = path.resolve(__dirname, '../arborea-visual-cleanup');
const clientRoot = process.env.ARBOREA_TEST_CLIENT_ROOT || 'C:/Program Files (x86)/ArboreaReborn_Launcher/TERA';
const sourceDirectory = 'S1Game/CookedPC/Art_Data/Packages/S1UI/';
const pins = [
    ['S1UI_SystemOption.gpk', 'ddc84364bcadd34732f3edd703f6e1d2b332c83135ea4fed71a97e0af436b434'],
    ['S1UI_SelectCharacter.gpk', 'ca207539deb01d8cb0938eb47958d96efddf9aacb4e7972f7df3c48ddb5bf1a2'],
];
const hasClient = pins.every(([name]) => fs.existsSync(path.join(clientRoot, sourceDirectory, name)));
const realClient = {skip: !hasClient && 'requires the pinned local Arborea client'};

function digest(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(value));
}

function fixture(t) {
    const scratch = path.resolve(__dirname, '../../lobby-runtime-tests');
    fs.mkdirSync(scratch, {recursive: true});
    const root = fs.mkdtempSync(path.join(scratch, 'case-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const gameRoot = path.join(root, 'game');
    const localModuleRoot = path.join(root, 'mod');
    const settings = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'config.json'), 'utf8'));
    const baseline = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'baseline.json'), 'utf8'));
    fs.mkdirSync(path.join(gameRoot, 'Binaries'), {recursive: true});
    fs.writeFileSync(path.join(gameRoot, 'Binaries/ReleaseRevision.txt'), baseline.revision);
    writeJson(path.join(localModuleRoot, 'config.json'), settings);
    writeJson(path.join(localModuleRoot, 'baseline.json'), baseline);
    const postprocess = path.join(gameRoot, baseline.source);
    fs.mkdirSync(path.dirname(postprocess), {recursive: true});
    fs.copyFileSync(path.join(clientRoot, baseline.source), postprocess);
    const manifest = {version: 2, packages: pins.map(([name, sourceSha256]) => {
        const source = sourceDirectory + name;
        const sourceFile = path.join(gameRoot, source);
        fs.mkdirSync(path.dirname(sourceFile), {recursive: true});
        fs.copyFileSync(path.join(clientRoot, source), sourceFile);
        assert.equal(digest(sourceFile), sourceSha256, 'real client fixture fingerprint changed');
        const file = 'assets/lobby-video-settings-v2/' + name;
        const output = path.join(localModuleRoot, file);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        // Runtime tests use real package bytes; AVM1 patch semantics are tested by the builder suite.
        fs.copyFileSync(sourceFile, output);
        return {source, sourceSha256, file, sha256: digest(output), destination: name};
    })};
    writeJson(path.join(localModuleRoot, 'assets/lobby-video-settings-v2/manifest.json'), manifest);
    const client = {info: {path: path.join(gameRoot, 'Binaries'), majorPatchVersion: 100, minorPatchVersion: 2}};
    const state = {settings: {...settings, applyVideoSettingsAtCharacterSelectV2: true}, baseline,
        gameRoot, moduleRoot: localModuleRoot, clientEligible: true, assetEligible: true};
    const calls = [];
    const installer = {gpk: async (file, destination) => calls.push({file, destination})};
    return {root, gameRoot, moduleRoot: localModuleRoot, settings, baseline, manifest, client, state, calls, installer};
}

function api() {
    const file = path.join(moduleRoot, 'lib/lobby-video-settings.js');
    assert.equal(fs.existsSync(file), true, 'lobby video settings runtime is not implemented');
    const value = require(file).installLobbyVideoSettings;
    assert.equal(typeof value, 'function');
    return value;
}

function installExistingAsset(f) {
    const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'assets/manifest.json'), 'utf8'));
    const entry = manifest.variants['flyingDashBlur+nostrumFlash+vignette'];
    const output = path.join(f.moduleRoot, entry.file);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.copyFileSync(path.join(moduleRoot, entry.file), output);
    writeJson(path.join(f.moduleRoot, 'assets/manifest.json'), manifest);
}

function installRetiredManifest(f) {
    const manifest = {version: 1, packages: f.manifest.packages.map(entry => {
        const retired = {...entry, file: 'assets/lobby-video-settings/' + entry.destination};
        const output = path.join(f.moduleRoot, retired.file);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.copyFileSync(path.join(f.moduleRoot, entry.file), output);
        return retired;
    })};
    writeJson(path.join(f.moduleRoot, 'assets/lobby-video-settings/manifest.json'), manifest);
    return manifest;
}

test('both pinned packages preflight before SystemOption installs ahead of SelectCharacter', realClient, async t => {
    const f = fixture(t);
    f.manifest.packages.reverse();
    f.state.assetEligible = false;
    const result = await api()(f.installer, f.state, f.manifest);
    assert.equal(result.applied, true);
    assert.deepEqual(f.calls.map(call => call.destination), ['S1UI_SystemOption.gpk', 'S1UI_SelectCharacter.gpk']);
    assert.deepEqual(f.calls.map(call => call.file), [
        'assets/lobby-video-settings-v2/S1UI_SystemOption.gpk',
        'assets/lobby-video-settings-v2/S1UI_SelectCharacter.gpk',
    ]);
    assert.deepEqual(result.installed, ['S1UI_SystemOption.gpk', 'S1UI_SelectCharacter.gpk']);
});

for (const [label, index, field] of [
    ['first stock source', 0, 'source'], ['second stock source', 1, 'source'],
    ['first generated asset', 0, 'file'], ['second generated asset', 1, 'file'],
]) {
    test(`${label} mismatch prevents either UI installation`, realClient, async t => {
        const f = fixture(t);
        const entry = f.manifest.packages[index];
        const file = path.join(field === 'source' ? f.gameRoot : f.moduleRoot, entry[field]);
        fs.appendFileSync(file, Buffer.from([0]));
        const result = await api()(f.installer, f.state, f.manifest);
        assert.equal(result.applied, false);
        assert.match(result.reason, /fingerprint|hash/i);
        assert.deepEqual(f.calls, []);
    });
}

for (const [label, change] of [
    ['withdrawn v1 version', m => { m.version = 1; }],
    ['unsupported version', m => { m.version = 3; }],
    ['missing package', m => { m.packages.pop(); }],
    ['extra package', m => { m.packages.push({...m.packages[0]}); }],
    ['duplicate destination', m => { m.packages[1] = {...m.packages[0]}; }],
    ['unknown source', m => { m.packages[0].source = sourceDirectory + 'Other.gpk'; }],
    ['wrong pinned source hash', m => { m.packages[0].sourceSha256 = '0'.repeat(64); }],
    ['traversing source', m => { m.packages[0].source = '../S1UI_SystemOption.gpk'; }],
    ['wrong destination', m => { m.packages[0].destination = 'Other.gpk'; }],
    ['traversing output', m => { m.packages[0].file = '../S1UI_SystemOption.gpk'; }],
    ['absolute output', m => { m.packages[0].file = path.resolve('S1UI_SystemOption.gpk'); }],
    ['output outside UI asset directory', m => { m.packages[0].file = 'assets/other/S1UI_SystemOption.gpk'; }],
    ['withdrawn v1 output path', m => { m.packages[0].file = 'assets/lobby-video-settings/S1UI_SystemOption.gpk'; }],
    ['malformed output hash', m => { m.packages[0].sha256 = 'invalid'; }],
]) {
    test(`${label} manifest is rejected before installation`, realClient, async t => {
        const f = fixture(t);
        change(f.manifest);
        const result = await api()(f.installer, f.state, f.manifest);
        assert.equal(result.applied, false);
        assert.match(result.reason, /manifest|path|fingerprint|hash/i);
        assert.deepEqual(f.calls, []);
    });
}

test('disabled option skips both UI packages even with an unreadable manifest', realClient, async t => {
    const f = fixture(t);
    f.state.settings.applyVideoSettingsAtCharacterSelect = true;
    f.state.settings.applyVideoSettingsAtCharacterSelectV2 = false;
    const result = await api()(f.installer, f.state, null);
    assert.equal(result.applied, false);
    assert.match(result.reason, /disabled|off/i);
    assert.deepEqual(f.calls, []);
});

test('unsupported client skips UI without relying on PostProcess eligibility', realClient, async t => {
    const f = fixture(t);
    f.state.clientEligible = false;
    const result = await api()(f.installer, f.state, f.manifest);
    assert.equal(result.applied, false);
    assert.match(result.reason, /unsupported|client/i);
    assert.deepEqual(f.calls, []);
});

for (const failingDestination of ['S1UI_SystemOption.gpk', 'S1UI_SelectCharacter.gpk']) {
    test(`${failingDestination} installer failure never reports the pair installed`, realClient, async t => {
        const f = fixture(t);
        f.installer.gpk = async (file, destination) => {
            f.calls.push({file, destination});
            if (destination === failingDestination) throw new Error('fixture installation failure');
        };
        const result = await api()(f.installer, f.state, f.manifest);
        assert.equal(result.applied, false);
        assert.match(result.reason, /install/i);
        const expected = failingDestination === 'S1UI_SystemOption.gpk' ? [] : ['S1UI_SystemOption.gpk'];
        assert.deepEqual(result.installed, expected);
        assert.equal(f.calls.length, expected.length + 1);
    });
}

test('legacy config with a retained true flag defaults v2 off and installs neither UI package', realClient, async t => {
    const f = fixture(t);
    f.settings.applyVideoSettingsAtCharacterSelect = true;
    delete f.settings.applyVideoSettingsAtCharacterSelectV2;
    writeJson(path.join(f.moduleRoot, 'config.json'), f.settings);
    const state = getClientState(f.client, f.moduleRoot);
    assert.equal(state.settings.applyVideoSettingsAtCharacterSelect, false);
    assert.equal(state.settings.applyVideoSettingsAtCharacterSelectV2, false);
    for (const name of ['hideHandGlow', 'hideNostrumFlash', 'hideFlyingDashBlur', 'disableScreenShake', 'hideVignette']) {
        assert.equal(state.settings[name], f.settings[name]);
    }
    assert.equal(Object.isFrozen(state.settings), true);
    const result = await api()(f.installer, state, f.manifest);
    assert.equal(result.applied, false);
    assert.deepEqual(f.calls, []);
});

test('shipped config installs existing cleanup without either UI override', realClient, async t => {
    const f = fixture(t);
    assert.equal(f.settings.applyVideoSettingsAtCharacterSelectV2, false);
    installExistingAsset(f);
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});

test('missing vignette keeps its existing default and explicit old flags remain unchanged', realClient, t => {
    const f = fixture(t);
    const saved = {...f.settings, hideHandGlow: false, hideNostrumFlash: true,
        hideFlyingDashBlur: false, disableScreenShake: false};
    delete saved.hideVignette;
    delete saved.applyVideoSettingsAtCharacterSelect;
    delete saved.applyVideoSettingsAtCharacterSelectV2;
    writeJson(path.join(f.moduleRoot, 'config.json'), saved);
    const state = getClientState(f.client, f.moduleRoot);
    assert.equal(state.settings.hideVignette, true);
    assert.equal(state.settings.applyVideoSettingsAtCharacterSelect, false);
    assert.equal(state.settings.applyVideoSettingsAtCharacterSelectV2, false);
    assert.equal(state.settings.hideHandGlow, false);
    assert.equal(state.settings.hideNostrumFlash, true);
    assert.equal(state.settings.hideFlyingDashBlur, false);
    assert.equal(state.settings.disableScreenShake, false);
});

test('explicit v2 false overrides retained v1 true without disabling existing cleanup', realClient, async t => {
    const f = fixture(t);
    installExistingAsset(f);
    installRetiredManifest(f);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings,
        applyVideoSettingsAtCharacterSelect: true, applyVideoSettingsAtCharacterSelectV2: false});
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.state.settings.applyVideoSettingsAtCharacterSelect, false);
    assert.equal(instance.state.settings.applyVideoSettingsAtCharacterSelectV2, false);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});

test('retained v1 true without a v2 flag cannot enable UI through ClientMod', realClient, async t => {
    const f = fixture(t);
    installExistingAsset(f);
    installRetiredManifest(f);
    const saved = {...f.settings, applyVideoSettingsAtCharacterSelect: true};
    delete saved.applyVideoSettingsAtCharacterSelectV2;
    writeJson(path.join(f.moduleRoot, 'config.json'), saved);
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});

for (const value of [null, 0, 'false', 'true', {}, []]) {
    test(`nonboolean v2 ${JSON.stringify(value)} fails closed and preserves cleanup`, realClient, async t => {
        const f = fixture(t);
        installExistingAsset(f);
        writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings,
            applyVideoSettingsAtCharacterSelect: true, applyVideoSettingsAtCharacterSelectV2: value});
        const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
        assert.equal((await instance.install(f.installer)).applied, true);
        assert.equal(instance.state.settings.applyVideoSettingsAtCharacterSelectV2, false);
        assert.equal(instance.lobbyVideoSettingsResult.applied, false);
        assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
    });
}

for (const value of [null, 0, 'false', 'true', {}, []]) {
    test(`malformed retired v1 ${JSON.stringify(value)} is ignored without disabling cleanup`, realClient, async t => {
        const f = fixture(t);
        installExistingAsset(f);
        writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings, applyVideoSettingsAtCharacterSelect: value});
        const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
        assert.equal((await instance.install(f.installer)).applied, true);
        assert.equal(instance.state.settings.applyVideoSettingsAtCharacterSelect, false);
        assert.equal(instance.lobbyVideoSettingsResult.applied, false);
        assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
    });
}

test('direct runtime invocation requires literal v2 true even with retained v1 true', realClient, async t => {
    const f = fixture(t);
    const retiredManifest = installRetiredManifest(f);
    for (const value of [undefined, null, 0, 'true', {}, []]) {
        f.state.settings.applyVideoSettingsAtCharacterSelect = true;
        f.state.settings.applyVideoSettingsAtCharacterSelectV2 = value;
        for (const manifest of [f.manifest, retiredManifest]) {
            const result = await api()(f.installer, f.state, manifest);
            assert.equal(result.applied, false);
            assert.match(result.reason, /disabled|off/i);
            assert.deepEqual(f.calls, []);
        }
    }
});

test('v2 opt-in never falls back to a complete withdrawn v1 manifest', realClient, async t => {
    const f = fixture(t);
    installExistingAsset(f);
    installRetiredManifest(f);
    fs.unlinkSync(path.join(f.moduleRoot, 'assets/lobby-video-settings-v2/manifest.json'));
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings,
        applyVideoSettingsAtCharacterSelect: true, applyVideoSettingsAtCharacterSelectV2: true});
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.match(instance.lobbyVideoSettingsResult.reason, /manifest/i);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});

test('fresh v2 true validates the pair and installs after existing cleanup', realClient, async t => {
    const f = fixture(t);
    installExistingAsset(f);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings,
        applyVideoSettingsAtCharacterSelectV2: true});
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, true);
    assert.deepEqual(f.calls.map(call => call.destination), [
        'PostProcess.gpk', 'S1UI_SystemOption.gpk', 'S1UI_SelectCharacter.gpk',
    ]);
});

test('entrypoint installs UI independently when PostProcess source is ineligible', realClient, async t => {
    const f = fixture(t);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings, applyVideoSettingsAtCharacterSelectV2: true});
    installExistingAsset(f);
    fs.appendFileSync(path.join(f.gameRoot, f.baseline.source), Buffer.from([0]));
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    const result = await instance.install(f.installer);
    assert.equal(result.applied, false);
    assert.equal(instance.lobbyVideoSettingsResult.applied, true);
    assert.deepEqual(f.calls.map(call => call.destination), ['S1UI_SystemOption.gpk', 'S1UI_SelectCharacter.gpk']);
});

test('entrypoint keeps existing cleanup when UI preflight skips and reports the reason', realClient, async t => {
    const f = fixture(t);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings, applyVideoSettingsAtCharacterSelectV2: true});
    installExistingAsset(f);
    fs.appendFileSync(path.join(f.gameRoot, f.manifest.packages[1].source), Buffer.from([0]));
    const messages = [];
    const instance = new ClientMod({clientInterface: f.client, log: message => messages.push(message)}, f.moduleRoot);
    const result = await instance.install(f.installer);
    assert.equal(result.applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.match(instance.lobbyVideoSettingsResult.reason, /fingerprint|hash/i);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
    assert.equal(messages.some(message => /character.selection.*skip/i.test(message)), true);
});

test('entrypoint off switch preserves existing cleanup and installs neither UI package', realClient, async t => {
    const f = fixture(t);
    installExistingAsset(f);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings, applyVideoSettingsAtCharacterSelectV2: false});
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    const result = await instance.install(f.installer);
    assert.equal(result.applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});

test('missing UI manifest cannot stop existing cleanup installation', realClient, async t => {
    const f = fixture(t);
    writeJson(path.join(f.moduleRoot, 'config.json'), {...f.settings, applyVideoSettingsAtCharacterSelectV2: true});
    installExistingAsset(f);
    fs.unlinkSync(path.join(f.moduleRoot, 'assets/lobby-video-settings-v2/manifest.json'));
    const instance = new ClientMod({clientInterface: f.client}, f.moduleRoot);
    assert.equal((await instance.install(f.installer)).applied, true);
    assert.equal(instance.lobbyVideoSettingsResult.applied, false);
    assert.match(instance.lobbyVideoSettingsResult.reason, /manifest/i);
    assert.deepEqual(f.calls.map(call => call.destination), ['PostProcess.gpk']);
});
