# Ordered HP and MP potion backups — 1.1

Each HP/MP channel has its existing `itemId` primary and a new ordered
`fallbackItemIds` array. The GUI supports up to seven distinct backup items.
The first owned, level-eligible item with a ready cooldown group and an allowed
combined-resource policy is selected. Cooling-down, empty or ineligible items
are skipped. The primary resumes priority as soon as it is ready.

For explicit primary selection, only the primary and configured backups are
candidates. Automatic primary selection keeps the existing ordinary-potion
ranking, then appends explicitly listed backups. Valuable, combined or
regeneration items require explicit configuration. A listed regeneration
potion restores its catalog amount over time; it is not an instant full refill.

The requested scenario is covered for both resources: one potion is confirmed,
then the resource drops again two seconds later, and a second potion with a
different cooldown group is selected. Tests use HP `6553` followed by `116`
and MP `6563` followed by `130`. The supplied client defines `6553` as 34,000 HP,
10 seconds, group 66; `116` as 50% HP, 30 seconds, group 3. MP `6563` has a
10-second cooldown in group 67, while regeneration potion `130` has a 30-second
cooldown in group 44. The user's illustrative 40,000 HP/8-second potion values
are not substituted for the actual catalog.

Different item IDs do not necessarily mean independent cooldowns. MP `6563`
and `209208` share group 67. The GUI shows stock, group and remaining wait for
configured items and indicates shared groups. No cooldowns or item stats are
changed. Manual item use and server item-cooldown messages feed the same locks.

Only one item request can be outstanding. A subsequent choice still waits for
confirmation or inventory consumption, respects the existing global spacing,
and observes bounded failure backoff. Loading, death, mounting and missing
state continue to pause automation. GUI actions themselves send no item request.

Older settings are normalized to empty backup arrays. Existing thresholds,
enabled/paused state, primary items and combined policy are preserved. New
installs remain paused. The installer retains a complete backup and restores
it if replacement fails. Invalid lists, duplicated IDs, unsupported items,
unknown fields and accessor properties are rejected.

Verification uses controlled packet sequences, actual runtime integration,
browser GUI checks and the installed Toolbox packet parser. Live potion
consumption and server-specific effects remain to be tested in game.
