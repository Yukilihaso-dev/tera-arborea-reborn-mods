# Potion catalog evidence

Audit date: 2026-10-08. The catalog contains 31 reviewed potion IDs, of which 13 are eligible for automatic inventory selection. A separate 120-item observation list tracks shared cooldowns without making those items selectable. Being present in a client file does not establish current server availability or prove which datacenter the running client uses.

## Source and reproducibility

The user supplied `DataCenter_Final_TW.dat`, 62,728,619 bytes, SHA-256 `dd7a17e93eebca37d830e05325d20e172e8a0eaf66760654be392935610efb79`. Extraction with novadrop-dc 2.2.14 reported revision 387463 and file version 6. The `.DEV` and `TERA` copies matched; the running client's datacenter selection was not verified. This is an audit of this exact TW asset, not a claim that every TERA region has the same items.

The extraction tool and format are documented by their maintainers: [Novadrop source](https://github.com/vezel-dev/novadrop), [dc tool](https://docs.vezel.dev/novadrop/tools/dc), [datacenter format](https://docs.vezel.dev/novadrop/game/data-center-format), and [version 2.2.14](https://www.nuget.org/packages/novadrop-dc/2.2.14). The public asset decryption parameters came from the [tera-api example environment](https://raw.githubusercontent.com/justkeepquiet/tera-api/master/.env.example).

`tools/generate-potion-catalog.py` takes the original datacenter and an externally extracted XML directory. It verifies the original file's size/hash, reparses the XML, checks every selected item's restrictions and actual recovery effects, then either checks or writes `data/potions.json`. It requires Python 3.11 or newer; Python and the original assets are not runtime dependencies of the mod.

```text
python tools/generate-potion-catalog.py --xml-dir PATH_TO_EXTRACTED_TW --datacenter PATH_TO_DataCenter_Final_TW.dat
```

Add `--write` to regenerate the catalog. The default is verification without writes. No game or Toolbox files are modified. Raw XML and the datacenter are deliberately absent from the release.

The independent generation pass read 113,397 ItemData rows and 10,764 unique template-9999 SkillData IDs. 568 items had positive direct recovery or a directly linked HP/MP recovery abnormality; this includes obsolete items, food, buffs and unnamed entries. The 31-item allowlist is deliberately narrower. The scan does not claim complete coverage of hypothetical recovery reached through other effect types or recursive buff links.

## Automatic selection

All automatic entries are self-targeted, immediate, single-resource recovery with `combatItemType=DISPOSAL`, `category=combat`, zero HP/MP skill costs and no detected class, race, gender, user-status or territory restriction. Ranks express a fixed preference among eligible owned items. They do not estimate effective healing or account for overheal.

| IDs | Effect from linked SkillData | Minimum levels | Item cooldown/group |
| --- | --- | --- | --- |
| 6550 / 6551 / 6552 / 6553 | 2,500 / 7,520 / 14,500 / 34,000 HP | 1 / 32 / 58 / 65 | 6 / 10 / 10 / 10 seconds; group 66 |
| 116 | 50% maximum HP | 1; no explicit minimum | 30 seconds; group 3 |
| 209205 / 209206 | 80,000 / 120,000 HP | 1 / 1 | 10 seconds; group 66 |
| 6560 / 6561 / 6562 / 6563 | 205 / 420 / 800 / 1,300 MP | 1 / 32 / 58 / 65 | 6 / 10 / 10 / 10 seconds; group 67 |
| 209207 / 209208 | 3,000 / 5,000 MP | 1 / 1 | 10 seconds; group 67 |

These correspond respectively to skill IDs `60221410..60221413`, `60060100`, `60950593..60950594`, `60221420..60221423`, and `60950595..60950596` in template 9999. Amounts come from the self-targeted `HpDiff` or `MpDiff`, not name matching. Health Potion 116 uses `HpDiff=0.5`, with the percentage interpretation corroborated by its item text. The fixed rank places it between the 34,000 and 80,000 HP choices; this is a consumption preference, not a claim that 50% equals a fixed HP amount.

The newer Solutions 209205–209208 have ordinary immediate effects and no special use restriction in these records. Their untradable status alone is not evidence that they must be protected, so they are included in automatic selection. Item 209207's tooltip says HP, but its linked skill has `MpDiff=3000`; the catalog correctly identifies it as MP.

The first three HP Potables describe an additional 50% while stunned or knocked down, and MP Potables describe an additional 80% for robe wearers. The catalog exposes the base values and a note. These conditional bonuses are not included in amounts or simulated as an extra unconditional effect.

## Explicit choices

| IDs | Verified effect | Cooldown/group | Selection policy |
| --- | --- | --- | --- |
| 114 | 50% maximum HP, skill 60060100 | 30 seconds / 3 | Valkyon supply variant; explicit |
| 3 / 28 | Full HP, `HpDiff=1`, skill 60410300 | 30 seconds / 3 | Protected full-recovery consumables |
| 4 / 29 | Full MP, skill 60410400 → abnormality 1660 | 30 seconds / 44 | Protected full-recovery consumables |
| 7219 / 88802 | 60% maximum HP and MP, skill 60060200 → abnormality 1511 | 30 seconds / 3 | Protected combined consumables; visible either/both policy |
| 111 / 112 / 80095 / 139002 | 5% maximum HP per second for 15 seconds, up to 75%; skill 60010100 → abnormality 1490 | 30 seconds / 3 | Regeneration; explicit |
| 193027 | Same HP regeneration as above | 30 seconds / raw group 0 | Regeneration; explicit |
| 130 / 139003 / 155850 | MP regeneration for 15 seconds, skill 60390100 → abnormalities 1530 and 1531 | 30 seconds / 44 | Regeneration; explicit |
| 193028 | Same MP regeneration skill | 30 seconds / raw group 0 | Regeneration; explicit |
| 437 | 187 HP per second for 10 seconds, skill 60220452 → abnormality 2517 | 60 seconds / raw group 0 | Expedition supply; explicit; level 20 |
| 438 | Immediate 619 MP, skill 60220252 | 60 seconds / raw group 0 | Expedition supply; explicit; level 20 |

All other listed explicit choices have effective minimum level 1 and no class restriction in ItemData. A missing `requiredLevel` is normalized to 1. `valuable:true` protects the full-recovery and combined consumables; it is a spending preference, not a market-price estimate. Regeneration and special supply variants are also explicit-only, without asserting that every such item is expensive.

Recovery abnormalities use type 51 (HP) or 52 (MP), method 2 (flat amount) or 3 (fraction of maximum). Abnormality 1511 contains one 0.6 effect for each resource with a 1,000 ms lifetime and one-second tick interval; 1660 contains MP fraction 1 under the same timing. Their item texts describe instant/full recovery. The mod does not predict the server's precise application tick or fabricate success from a resource change.

Abnormalities 1530 and 1531 both have kind 9610 and a 15,000 ms lifetime: 216 and 386 MP per one-second tick respectively. Skill 60390100 links both. Item 130's text associates 386 with robe wearers, but these skill/abnormality nodes do not themselves contain that condition. Some supply/MP-Potion texts instead claim percentage regeneration. Consequently the catalog does not sum both branches, assign a guaranteed regeneration total, invent a class restriction, or expose an instant `mpAmount` for these entries.

## Cooldowns and restrictions

`cooldownMs` is `ItemData.coolTime * 1000`; the source field is in seconds. Its corresponding template-9999 skill's `Precondition.coolTime` is zero for every included item, so reading only skill cooldowns would incorrectly mark these potions as cooldown-free. A nonzero `coolTimeGroup` is preserved as a string so a manual or automatic use can reserve the shared family. Raw group zero is represented as `item:<id>` rather than putting all unrelated group-zero consumables in one shared family. Actual server cooldown notifications remain authoritative.

The separate top-level `observerItems` contains every other ItemData ID whose nonzero `coolTimeGroup` matches a selectable potion: 120 additional IDs in groups 3, 44, 66 and 67. Each entry contains only `id`, `group` and `cooldownMs`, taken directly from ItemData. None duplicates a selectable ID. For example, observing item 1 or 26 must reserve group 3 even though that item is absent from the potion picker. No recovery or usability claim is made for these observation records: they can include food, event items and obsolete definitions. They must never enter inventory selection or the GUI's potion list. A raw zero-second base cooldown remains zero, but an actual positive server cooldown for that ID must still lock its shared group. Generation reparses all ItemData files; `metadata.observerSourceCounts` records the source files and counts, alongside the original datacenter hash.

`requiredEquipmentType=NO_COMBAT` describes the item's equipment type; it does not mean “cannot be used in combat.” The selected items all have `combatItemType=DISPOSAL` and no `requiredUserStatus`. By contrast some excluded food/bandages have `requiredUserStatus=NORMAL;RELAX`. No unsupported combat-only/out-of-combat interpretation is silently added. Server-side restrictions and situations absent from the client records remain possible; server rejection must be handled by the runtime.

Each catalog item's `metadata.evidence` record includes the exact extracted ItemData, StrSheet_Item and SkillData file/node reference, raw seconds/group, minimum level, and linked abnormality IDs. `metadata.abnormalityEvidence` retains only the six small recovery definitions needed for this allowlist, with exact numeric method/type/value/tick fields. It does not include the proprietary sheets.

## Deliberate exclusions

- Old Healing/Mana Potion ranks 6000–6031, 6298/6299 and 6478/6479 are marked unusable and have `combatItemType=NO_COMBAT`. Historical internet lists of those IDs are inappropriate here.
- Event-only 201222, 201238, 206771, 206772, 207289 and 207462 require an active event according to their text. The mod cannot verify that condition, so these do not appear even as explicit choices.
- Veteran potions 9310/9311 and Training Elixir 602178 have `useOnlyTerritory=true`; unsupported territory eligibility excludes them.
- Healing Potion 602606 loses its effect when attacked. It is excluded from this dungeon-oriented emergency potion catalog.
- Food, bandages, nostrums/battle solutions, mixed combat buffs, test items, unnamed entries, recipes and pet licenses are excluded. A name containing “potion” or an incidental MP regeneration effect is insufficient.

No real potion was consumed during this audit or verification. The catalog establishes source identity and recovery classification; live game effectiveness, stack consumption, server overrides and restrictions require a separately observed game session.
