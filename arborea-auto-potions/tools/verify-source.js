'use strict'
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process')
const {createHash}=require('crypto')
const root=path.resolve(__dirname,'..')
let syntax=0,hashes=0
function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(['.git','node_modules'].includes(entry.name))continue
    const file=path.join(directory,entry.name)
    if(entry.isSymbolicLink())throw Error('Unexpected source symlink: '+file)
    if(entry.isDirectory())walk(file)
    else if(entry.name.endsWith('.js')){
      const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'})
      if(result.status!==0)throw Error(result.stderr||'Syntax verification failed')
      syntax++
    }
  }
}
walk(root)
if(process.argv.includes('--manifest')){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))
  for(const [relative,expected] of Object.entries(manifest.files)){
    const file=path.resolve(root,relative)
    if(!file.startsWith(root+path.sep))throw Error('Manifest path escaped module')
    const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if(actual!==expected)throw Error('Manifest mismatch: '+relative)
    hashes++
  }
}
console.log(JSON.stringify({syntaxChecks:syntax,manifestHashes:hashes,ok:true}))
