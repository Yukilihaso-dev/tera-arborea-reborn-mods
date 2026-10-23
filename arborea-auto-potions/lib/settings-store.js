'use strict'
// Adapted from Arborea Prediction's local settings store, GPL-3.0-only.
const fs = require('fs')
const path = require('path')
const {randomBytes} = require('crypto')

function createSettingsStore(directory, {fsImpl = fs, settingsVersion = 1} = {}) {
  if(typeof directory !== 'string' || !directory.trim()) throw TypeError('A settings directory is required.')
  const folder = path.resolve(directory), target = path.join(folder, 'settings.json')
  const backup = path.join(folder, 'settings.json.bak')
  function regular(file) {
    try {
      const stat = fsImpl.lstatSync(file)
      if(!stat.isFile() || stat.isSymbolicLink()) throw Error('Settings destination is not a regular file.')
      return true
    } catch(error) { if(error.code === 'ENOENT') return false; throw error }
  }
  return {save(settings) {
    let fd, temporary, backupTemporary, ownTemporary = false, ownBackup = false
    try {
      const text = JSON.stringify({version:settingsVersion, data:settings}, null, 2) + '\n'
      fsImpl.mkdirSync(folder, {recursive:true})
      const exists = regular(target); regular(backup)
      const nonce = `${process.pid}-${randomBytes(12).toString('hex')}`
      temporary = path.join(folder, `.settings-${nonce}.tmp`)
      backupTemporary = path.join(folder, `.settings-backup-${nonce}.tmp`)
      fd = fsImpl.openSync(temporary, 'wx', 0o600); ownTemporary = true
      fsImpl.writeFileSync(fd, text, 'utf8'); fsImpl.fsyncSync(fd); fsImpl.closeSync(fd); fd = undefined
      if(exists) {
        fd = fsImpl.openSync(backupTemporary, 'wx', 0o600); ownBackup = true
        fsImpl.closeSync(fd); fd = undefined
        fsImpl.copyFileSync(target, backupTemporary)
        fd = fsImpl.openSync(backupTemporary, 'r+'); fsImpl.fsyncSync(fd); fsImpl.closeSync(fd); fd = undefined
        fsImpl.renameSync(backupTemporary, backup); ownBackup = false
      }
      fsImpl.renameSync(temporary, target); ownTemporary = false
      return {ok:true}
    } catch(error) { return {ok:false, error:String(error?.message || error).slice(0,512)} }
    finally {
      if(fd !== undefined) try { fsImpl.closeSync(fd) } catch {}
      if(ownTemporary) try { fsImpl.unlinkSync(temporary) } catch {}
      if(ownBackup) try { fsImpl.unlinkSync(backupTemporary) } catch {}
    }
  }}
}
module.exports = {createSettingsStore}
