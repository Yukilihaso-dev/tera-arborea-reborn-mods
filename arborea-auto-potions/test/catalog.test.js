'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const catalog=require('../data/potions.json')
test('catalog is pinned to the supplied current TW DataCenter and carries independently audited counts',()=>{
  assert.equal(catalog.metadata.datacenterSha256,'dd7a17e93eebca37d830e05325d20e172e8a0eaf66760654be392935610efb79')
  assert.equal(catalog.metadata.sourceCounts.itemRows,113397)
  assert.equal(catalog.metadata.sourceCounts.reviewedCatalogItems,catalog.items.length)
})
test('every selectable potion has usable resource flags, independent identity and proven bounded cooldown',()=>{
  const ids=new Set()
  for(const i of catalog.items){
    assert.ok(Number.isSafeInteger(i.id)&&i.id>0);assert.ok(!ids.has(i.id));ids.add(i.id)
    assert.equal(typeof i.hp,'boolean');assert.equal(typeof i.mp,'boolean');assert.ok(i.hp||i.mp)
    assert.ok(i.name.trim());assert.ok(Number.isInteger(i.level)&&i.level>=1)
    assert.ok(Number.isInteger(i.cooldownMs)&&i.cooldownMs>0&&i.cooldownMs<=3600000)
    assert.ok(typeof i.group==='string'&&i.group!=='0');assert.equal(typeof i.automatic,'boolean')
    if(i.automatic){assert.equal(i.valuable,false);assert.ok(i.hpAmount>0||i.mpAmount>0||i.hpPercent>0||i.mpPercent>0)}
  }
})
test('current Solutions and level-tier Potables are automatic with their actual HP/MP shared groups',()=>{
  for(const id of [6550,6551,6552,6553,209205,209206]){const i=catalog.items.find(i=>i.id===id);assert.ok(i.automatic);assert.equal(i.group,'66');assert.ok(i.hp);assert.equal(i.mp,false)}
  for(const id of [6560,6561,6562,6563,209207,209208]){const i=catalog.items.find(i=>i.id===id);assert.ok(i.automatic);assert.equal(i.group,'67');assert.ok(i.mp);assert.equal(i.hp,false)}
  assert.equal(catalog.items.find(i=>i.id===209206).hpAmount,120000)
  assert.equal(catalog.items.find(i=>i.id===209208).mpAmount,5000)
})
test('obsolete, event and restricted exclusions cannot reenter the selector or automatic allowlist',()=>{
  for(const exclusion of Object.values(catalog.metadata.exclusions))for(const id of exclusion.ids||[])assert.ok(!catalog.items.some(i=>i.id===id),`Excluded ${id}`)
  for(const i of catalog.items.filter(i=>i.hp&&i.mp))assert.equal(i.automatic,false)
  for(const i of catalog.items.filter(i=>i.valuable))assert.equal(i.automatic,false)
})
test('observer-only IDs cover shared groups without allowing non-potions to be consumed',()=>{
  const selectable=new Set(catalog.items.map(i=>i.id)),groups=new Set(catalog.items.map(i=>i.group)),seen=new Set()
  assert.equal(catalog.observerItems.length,120)
  for(const i of catalog.observerItems){
    assert.ok(!selectable.has(i.id)&&!seen.has(i.id));seen.add(i.id)
    assert.deepEqual(Object.keys(i).sort(),['cooldownMs','group','id'])
    assert.ok(groups.has(i.group));assert.ok(Number.isInteger(i.cooldownMs)&&i.cooldownMs>=0)
  }
  assert.equal(catalog.observerItems.find(i=>i.id===1).group,'3')
})
