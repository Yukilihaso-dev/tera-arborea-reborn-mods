"""Rebuild/check the reviewed catalog from the user's extracted TW data.

No game/Toolbox writes or network access. XML and the original data file are
external inputs, deliberately absent from the distributed mod.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SHA256 = 'dd7a17e93eebca37d830e05325d20e172e8a0eaf66760654be392935610efb79'
SIZE = 62728619
SELECTED = {3, 4, 28, 29, 111, 112, 114, 116, 130, 437, 438,
            6550, 6551, 6552, 6553, 6560, 6561, 6562, 6563, 7219,
            80095, 88802, 139002, 139003, 155850, 193027, 193028,
            209205, 209206, 209207, 209208}
AUTO_RANK = {6550: 10, 6551: 20, 6552: 30, 6553: 40, 116: 50,
             209205: 60, 209206: 70, 6560: 10, 6561: 20, 6562: 30,
             6563: 40, 209207: 60, 209208: 70}
PROTECTED = {3, 4, 28, 29, 7219, 88802}
EXCLUDED = {
    'obsolete': {'ids': list(range(6000, 6032)) + [6298, 6299, 6478, 6479],
                 'reason': 'NO_COMBAT item type and obsolete tooltip; linked recovery does not make the item usable.'},
    'eventOnly': {'ids': [201222, 201238, 206771, 206772, 207289, 207462],
                  'reason': 'Event-only tooltip; active event eligibility is not available to this mod.'},
    'territoryOnly': {'ids': [9310, 9311, 602178],
                     'reason': 'useOnlyTerritory=true; territory eligibility is not implemented.'},
    'interruptible': {'ids': [602606], 'reason': 'Healing effect is removed when attacked.'},
    'otherCategories': {'reason': 'Foods, bandages, battle solutions/nostrums, mixed buffs, test items, unnamed items, recipes and pet licenses are outside the reviewed potion allowlist.'}
}


def local_tag(node):
    return node.tag.rsplit('}', 1)[-1]


def num(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0


def read_table(root, table):
    for path in sorted((root / table).glob('*.xml')):
        for node in ET.parse(path).getroot():
            yield path, node


def source(root, path, node):
    return str(path.relative_to(root)).replace('\\', '/') + '#' + local_tag(node) + '[id=' + node.get('id') + ']'


def build(root):
    names = {int(n.get('id')): (p, n.attrib) for p, n in read_table(root, 'StrSheet_Item') if int(n.get('id')) in SELECTED}
    abnormalities = {n.get('id'): (p, n) for p, n in read_table(root, 'Abnormality')}
    skills = {}
    for path in sorted((root / 'SkillData').glob('*.xml')):
        with path.open('rb') as stream:
            _, header = next(ET.iterparse(stream, events=('start',)))
        if header.get('templateId') != '9999':
            continue
        for node in ET.parse(path).getroot():
            key = node.get('id')
            assert key not in skills, 'Duplicate template9999 skill: ' + key
            effects, links = [], []
            for area in node.findall('./{*}TargetingList/{*}Targeting/{*}AreaList/{*}Area'):
                for effect in area.findall('./{*}Effect/*'):
                    kind = local_tag(effect)
                    if kind in ('HpDiff', 'MpDiff') and num(effect.get('value')):
                        effects.append({'resource': 'hp' if kind == 'HpDiff' else 'mp',
                                        'value': num(effect.get('value')), 'mode': 'direct', 'target': area.get('type')})
                    elif kind.startswith('AbnormalityOn'):
                        links.append(int(effect.get('id')))
                        _, abnormal = abnormalities.get(effect.get('id'), (None, None))
                        if abnormal is None:
                            effects.append({'unsupported': int(effect.get('id'))})
                            continue
                        for child in abnormal:
                            effects.append({'resource': {'51': 'hp', '52': 'mp'}.get(child.get('type')),
                                            'type': int(child.get('type')), 'method': int(child.get('method')),
                                            'value': num(child.get('value')), 'mode': 'abnormality',
                                            'abnormalityId': int(effect.get('id')), 'target': area.get('type'),
                                            'tickSeconds': num(child.get('tickInterval')), 'durationMs': int(abnormal.get('time'))})
            skills[key] = (path, node, effects, sorted(set(links)))

    items, evidence, cooldown_records = [], {}, {}
    count = recovery_count = 0
    for path in sorted((root / 'ItemData').glob('*.xml')):
        for _, node in ET.iterparse(path, events=('end',)):
            if local_tag(node) != 'Item':
                continue
            count += 1
            key = int(node.get('id'))
            raw_group = node.get('coolTimeGroup')
            if raw_group and raw_group != '0':
                assert key not in cooldown_records, f'Duplicate ItemData ID: {key}'
                cooldown_records[key] = ({'id': key, 'group': raw_group,
                                          'cooldownMs': int(node.get('coolTime', '0')) * 1000},
                                         str(path.relative_to(root)).replace('\\', '/'))
            skill = skills.get(node.get('linkSkillId'))
            if skill and any(e.get('resource') and e.get('value', 0) > 0 and
                             (e['mode'] == 'direct' or e.get('method') in (2, 3)) for e in skill[2]):
                recovery_count += 1
            if key not in SELECTED:
                node.clear()
                continue
            assert skill, f'{key}: missing skill'
            skill_path, skill_node, effects, links = skill
            name_path, text = names[key]
            tooltip = text.get('toolTip', '')
            assert node.get('combatItemType') == 'DISPOSAL' and node.get('category') == 'combat', key
            assert not re.search(r'no longer usable|only be used during the event|removed when attacked', tooltip, re.I), key
            assert node.get('useOnlyTerritory') == 'false', key
            for restriction in ('requiredClass', 'requiredRace', 'requiredGender', 'requiredMaxLevel', 'requiredUserStatus'):
                assert not node.get(restriction), (key, restriction, node.get(restriction))
            assert skill_node.get('type') == 'notimeline' and skill_node.find('./{*}Action/{*}StageList') is None, key
            precondition = skill_node.find('./{*}Precondition')
            assert precondition is not None and num(precondition.get('coolTime')) == 0, key
            for cost in skill_node.findall('./{*}Precondition/{*}Cost') + skill_node.findall('./{*}TargetingList/{*}Targeting/{*}Cost'):
                assert all(num(cost.get(resource)) == 0 for resource in ('hp', 'mp', 'st')), key
            assert effects and all(e.get('resource') in ('hp', 'mp') and e.get('value', 0) > 0 and e.get('target') == 'me' and
                                   (e['mode'] == 'direct' or e.get('method') in (2, 3)) for e in effects), (key, effects)
            raw_group = node.get('coolTimeGroup')
            entry = {'id': key, 'name': text['string'], 'hp': any(e['resource'] == 'hp' for e in effects),
                     'mp': any(e['resource'] == 'mp' for e in effects), 'cooldownMs': int(node.get('coolTime')) * 1000,
                     'group': raw_group if raw_group != '0' else f'item:{key}',
                     'level': int(node.get('requiredLevel', '1')), 'automatic': key in AUTO_RANK,
                     'rank': AUTO_RANK.get(key, 0), 'valuable': key in PROTECTED}
            skill_id = int(node.get('linkSkillId'))
            if skill_id == 60010100:
                note = 'Regenerates 5% maximum HP per second for 15 seconds (up to 75%); not an instant heal.'
            elif skill_id == 60390100:
                note = 'Regenerates MP over 15 seconds; data has 216/386 MP per second variants. Amount follows game rules. Not instant.'
            elif skill_id == 60220452:
                note = 'Regenerates 187 HP per second for 10 seconds; expedition supply, explicit selection only.'
            else:
                for effect in effects:
                    value = effect['value']
                    percent = effect.get('method') == 3 or (effect['mode'] == 'direct' and value <= 1)
                    field = effect['resource'] + ('Percent' if percent else 'Amount')
                    assert field not in entry, (key, field)
                    entry[field] = round(value * 100, 6) if percent else int(value)
                if skill_id == 60060200:
                    note = 'Restores 60% maximum HP and MP. Combined and protected: choose either-resource or both-resources policy.'
                elif skill_id in (60410300, 60410400):
                    note = 'Full resource recovery; protected consumable, explicit selection only.'
                elif key == 114:
                    note = 'Restores 50% maximum HP; Valkyon variant, explicit selection only.'
                elif key == 116:
                    note = 'Restores 50% maximum HP. Automatic preference is between the 34,000 and 80,000 HP potions.'
                elif key in (6550, 6551, 6552):
                    note = 'Instant base HP recovery. Tooltip also describes a 50% bonus while stunned or knocked down.'
                elif key in (6560, 6561, 6562, 6563):
                    note = 'Instant base MP recovery. Tooltip describes an additional 80% for robe wearers; the base amount is shown.'
                elif key == 209207:
                    note = 'Instant 3,000 MP: verified MpDiff; the item tooltip incorrectly says HP.'
                elif key == 438:
                    note = 'Instant 619 MP; expedition supply, explicit selection only.'
                else:
                    note = 'Instant resource recovery.'
            entry['note'] = note
            assert entry['cooldownMs'] > 0 and entry['level'] >= 1
            if entry['automatic']:
                assert not entry['valuable'] and not (entry['hp'] and entry['mp']) and all(e['mode'] == 'direct' for e in effects), key
            evidence[str(key)] = {'item': source(root, path, node),
                                  'name': str(name_path.relative_to(root)).replace('\\', '/') + f'#String[id={key}]',
                                  'skill': source(root, skill_path, skill_node), 'templateId': 9999,
                                  'coolTimeSeconds': int(node.get('coolTime')), 'coolTimeGroup': raw_group,
                                  'requiredLevel': node.get('requiredLevel'), 'abnormalityIds': links}
            items.append(entry)
            node.clear()
    assert len(items) == len(SELECTED) and {item['id'] for item in items} == SELECTED
    shared_groups = {item['group'] for item in items if not item['group'].startswith('item:')}
    observer_items = sorted((record for key, (record, _) in cooldown_records.items()
                             if key not in SELECTED and record['group'] in shared_groups), key=lambda record: record['id'])
    assert len(observer_items) == len({item['id'] for item in observer_items})
    assert all(item['cooldownMs'] >= 0 and item['id'] not in SELECTED for item in observer_items)
    observer_sources = Counter(cooldown_records[item['id']][1] for item in observer_items)
    relevant_abnormalities = sorted({a for value in evidence.values() for a in value['abnormalityIds']})
    abnormal_evidence = {}
    for key in relevant_abnormalities:
        path, node = abnormalities[str(key)]
        abnormal_evidence[str(key)] = {'source': source(root, path, node), 'kind': int(node.get('kind')),
                                      'durationMs': int(node.get('time')),
                                      'effects': [{k: child.get(k) for k in ('type', 'method', 'value', 'tickInterval')} for child in node]}
    return {'metadata': {'schemaVersion': 1, 'auditDate': '2026-10-08', 'datacenterFile': 'DataCenter_Final_TW.dat',
                         'datacenterSha256': SHA256, 'datacenterSizeBytes': SIZE, 'parsedRevision': 387463,
                         'extractor': 'novadrop-dc 2.2.14', 'liveClientDatacenterSelection': 'not verified',
                         'sourceCounts': {'itemRows': count, 'template9999SkillIds': len(skills),
                                          'directOrLinkedRecoveryCandidates': recovery_count, 'reviewedCatalogItems': len(items),
                                          'observerOnlyItems': len(observer_items)},
                         'observerPolicy': 'All other ItemData IDs sharing a selected nonzero cooldown group, without names or recovery claims. Observation only: never selectable or automatically used. Zero base cooldown does not suppress an actual positive server cooldown.',
                         'observerSourceCounts': dict(sorted(observer_sources.items())),
                         'cooldownSource': 'ItemData.coolTime seconds * 1000; nonzero coolTimeGroup shared; zero normalized to item:<id>. Server cooldowns remain authoritative.',
                         'rankPolicy': 'Fixed preference tiers, higher first. Health Potion 116 sits between 34,000 and 80,000 HP; ranks are not a prediction of effective healing.',
                         'valuePolicy': 'valuable marks protected full-recovery and combined consumables, not a market-price estimate. Other non-automatic entries are special supplies or regeneration.',
                         'amountPolicy': 'Amounts are base immediate recovery. Percent fields use 0..100 units. Regeneration is described only in note; conditional branches are never summed.',
                         'restrictions': 'Selected items have no requiredClass/race/gender/user-status/max-level restrictions and are not territory-only. NO_COMBAT in requiredEquipmentType is not an out-of-combat rule.',
                         'exclusions': EXCLUDED, 'evidence': evidence, 'abnormalityEvidence': abnormal_evidence},
            'items': sorted(items, key=lambda item: item['id']), 'observerItems': observer_items}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xml-dir', type=Path, required=True)
    parser.add_argument('--datacenter', type=Path, required=True)
    parser.add_argument('--write', action='store_true', help='Write data/potions.json; otherwise verify without writing.')
    args = parser.parse_args()
    assert args.datacenter.stat().st_size == SIZE, 'Unexpected datacenter size'
    with args.datacenter.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == SHA256, 'Unexpected datacenter hash'
    result = build(args.xml_dir)
    out = Path(__file__).resolve().parents[1] / 'data' / 'potions.json'
    if args.write:
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    else:
        assert out.is_file(), 'Catalog missing'
        assert json.loads(out.read_text(encoding='utf-8')) == result, 'Catalog differs from verified generation'
    print(json.dumps({'mode': 'write' if args.write else 'verify', 'items': len(result['items']),
                      'automatic': sum(item['automatic'] for item in result['items']),
                      'sourceCounts': result['metadata']['sourceCounts']}))


if __name__ == '__main__':
    main()
