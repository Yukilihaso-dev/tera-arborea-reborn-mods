#!/usr/bin/env node
'use strict';
// Regenerates the "files" section of each module's manifest.json,
// which the Tera Toolbox auto-updater uses to decide what to download.
//
//   node build-manifest.js           rewrite the manifests
//   node build-manifest.js --check   exit 1 if any manifest is out of date
//
// Run it after every change to a module, before committing a release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const modules = ['arborea-visual-cleanup', 'arborea-auto-potions'];
// Never shipped by the updater: the manifest itself, the user's own settings, and docs/licence files that are not needed to run.
const excludedAtRoot = new Set(['manifest.json', 'config.json', 'settings.json', 'settings.json.bak', 'README.md', 'LICENSE']);

function listFiles(dir, prefix = '') {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(path.join(dir, entry.name), relative);
        return entry.isFile() && !excludedAtRoot.has(relative) ? [relative] : [];
    });
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let stale = false;
for (const name of modules) {
    const moduleDir = path.join(__dirname, name);
    const manifestPath = path.join(moduleDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    const files = {};
    for (const relative of listFiles(moduleDir).sort()) files[relative] = sha256(path.join(moduleDir, relative));

    // Keep any other keys (such as "defs") untouched; only "files" is regenerated.
    const {files: _old, ...rest} = manifest;
    const text = JSON.stringify({...rest, files}, null, 2)
        // Keep short numeric arrays such as "S_SPAWN_ME": [3] on one line.
        .replace(/\[\n\s*(\d+(?:,\n\s*\d+)*)\n\s*\]/g, (_, inner) => `[${inner.replace(/,\n\s*/g, ', ')}]`) + '\n';

    if (process.argv.includes('--check')) {
        if (fs.readFileSync(manifestPath, 'utf8') !== text) {
            console.error(`${name}/manifest.json is out of date. Run: node build-manifest.js`);
            stale = true;
        } else {
            console.log(`${name}/manifest.json is up to date (${Object.keys(files).length} files).`);
        }
    } else {
        fs.writeFileSync(manifestPath, text);
        console.log(`Wrote ${name}/manifest.json with ${Object.keys(files).length} files.`);
    }
}
if (stale) process.exit(1);