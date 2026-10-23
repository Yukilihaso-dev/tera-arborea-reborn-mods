#!/usr/bin/env node
'use strict';
// Regenerates the "files" section of arborea-visual-cleanup/manifest.json,
// which the Tera Toolbox auto-updater uses to decide what to download.
//
//   node build-manifest.js           rewrite the manifest
//   node build-manifest.js --check   exit 1 if the manifest is out of date
//
// Run it after every change to the module, before committing a release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleDir = path.join(__dirname, 'arborea-visual-cleanup');
const manifestPath = path.join(moduleDir, 'manifest.json');
// Never shipped by the updater: the manifest itself, and the user's own settings.
const excludedAtRoot = new Set(['manifest.json', 'config.json']);

function listFiles(dir, prefix = '') {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return listFiles(path.join(dir, entry.name), relative);
        return entry.isFile() && !excludedAtRoot.has(relative) ? [relative] : [];
    });
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
const files = {};
for (const relative of listFiles(moduleDir).sort()) files[relative] = sha256(path.join(moduleDir, relative));

// Keep any other keys (such as "defs") untouched; only "files" is regenerated.
const {files: _old, ...rest} = manifest;
let text = JSON.stringify({...rest, files}, null, 2)
    // Keep short numeric arrays such as "S_SPAWN_ME": [3] on one line.
    .replace(/\[\n\s*(\d+(?:,\n\s*\d+)*)\n\s*\]/g, (_, inner) => `[${inner.replace(/,\n\s*/g, ', ')}]`) + '\n';

if (process.argv.includes('--check')) {
    const current = fs.readFileSync(manifestPath, 'utf8');
    if (current !== text) {
        console.error('manifest.json is out of date. Run: node build-manifest.js');
        process.exit(1);
    }
    console.log(`manifest.json is up to date (${Object.keys(files).length} files).`);
} else {
    fs.writeFileSync(manifestPath, text);
    console.log(`Wrote manifest.json with ${Object.keys(files).length} files.`);
}
