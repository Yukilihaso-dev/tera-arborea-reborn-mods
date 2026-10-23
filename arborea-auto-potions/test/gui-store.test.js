'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function directory(t) {
  // Keep rename checks on the workspace filesystem: Windows sandbox profile
  // temp directories can reject otherwise valid atomic replacements.
  const base = path.resolve(__dirname, '../..')
  const dir = fs.mkdtempSync(path.join(base, 'arborea-potions-store-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base)
    assert.ok(path.basename(dir).startsWith('arborea-potions-store-'))
    fs.rmSync(dir, {recursive:true,force:true})
  })
  return dir
}
test('atomic store writes Toolbox wrapper and preserves the previous settings as backup', t => {
  const {createSettingsStore} = require('../lib/settings-store')
  const dir = directory(t), store = createSettingsStore(dir)
  assert.deepEqual(store.save({enabled:false}), {ok:true})
  assert.deepEqual(store.save({enabled:true}), {ok:true})
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'settings.json'))), {version:1,data:{enabled:true}})
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'settings.json.bak'))), {version:1,data:{enabled:false}})
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json','settings.json.bak'])
})
test('failed atomic replacement leaves old target intact and removes owned temporary files', t => {
  const {createSettingsStore} = require('../lib/settings-store')
  const dir = directory(t), target = path.join(dir,'settings.json')
  fs.writeFileSync(target, 'original settings')
  const io = {...fs, renameSync(from, to) { if(to === target) throw Error('blocked replacement'); return fs.renameSync(from,to) }}
  const result = createSettingsStore(dir, {fsImpl:io}).save({enabled:true})
  assert.equal(result.ok, false)
  assert.match(result.error, /blocked replacement/)
  assert.equal(fs.readFileSync(target,'utf8'), 'original settings')
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json','settings.json.bak'])
})
test('non-file settings targets are rejected without changing their contents', t => {
  const {createSettingsStore} = require('../lib/settings-store')
  const dir = directory(t)
  fs.mkdirSync(path.join(dir,'settings.json'))
  const result = createSettingsStore(dir).save({enabled:true})
  assert.equal(result.ok, false)
  assert.equal(fs.statSync(path.join(dir,'settings.json')).isDirectory(), true)
})
