# Arborea Auto Potions

Automatic HP and MP potions for Arborea Reborn, with a local English settings window.

1. Close TERA and TERA Toolbox completely.
2. Place the `arborea-auto-potions` folder from the ZIP directly inside Toolbox's `mods` folder. Alternatively use the included install launcher beside its ZIP and checksum.
3. Restart Toolbox and TERA. In game type `pot gui` in the Toolbox command channel (normally `/8 pot gui`).
4. Set the HP and MP thresholds, choose a primary potion and optional ordered backup potions for each resource, turn on automatic potions, then Save.

New installations start paused. Defaults: HP below 50%, MP below 30%, combat only. Each channel can be disabled separately. **Automatic** chooses the highest-ranked ready ordinary verified potion you own and can use at your level. It can fall back to a ready ordinary potion with a different cooldown group. It never automatically chooses the catalog's valuable, combined, or regeneration-only options. An explicit primary selection uses only that primary and its configured backups. The dropdown shows current stock; selecting a potion does not buy or create any.

Version 1.1 adds up to seven ordered backups per HP/MP channel. After another low-resource event, the next owned and eligible potion whose cooldown group is ready can be used, even while the primary is cooling down. The primary regains priority when ready. Add backups in the GUI, use Up/Down to order them and Save. Potions in the same cooldown group remain unavailable together. Inventory, level, combined-resource policy and request confirmation still apply; no listed backup means the old explicit-single-potion behavior is preserved.

Combined HP+MP potions can be explicitly selected. Choose whether they trigger when **either** enabled resource is low or when **both** are low. The both rule needs both channels enabled. Potions use the real inventory stack and consume one item. Opening, refreshing, or saving the window never directly sends an item request; enabled automation checks periodically during eligible gameplay.

Automation pauses while loading, dead, mounted, trading, or missing current HP/MP, inventory, character, or position information. Shared item cooldowns and manual/other-mod use are observed. One request is outstanding at a time, with spacing and bounded retries. A sent request is not displayed as a successful heal. Current client cooldowns provide a conservative fallback when server confirmation is missing.

Commands: `pot gui`, `pot on`, `pot off`, `pot status`. `pot off` pauses immediately; if saving fails it reports that the pause applies only to the current session. GUI draft edits must be saved to take effect. If another command changes settings while you edit, discard/reload your draft before saving again.

The curated item catalog comes from the supplied Arborea **TW** DataCenter, SHA256 `dd7a17e93eebca37d830e05325d20e172e8a0eaf66760654be392935610efb79`. Different private-server client builds may need a new catalog. Obsolete classic item IDs are deliberately excluded.

Separate mod: no Skill Prediction changes are needed. Avoid enabling a second automatic HP/MP potion module alongside it. Tested with packet mocks and the installed Toolbox packet parser plus a real browser GUI; live-game potion consumption has not been tested. Runtime observation never suppresses manual inputs or incoming packets.

Source is included. GPL-3.0-only. GUI and atomic persistence patterns adapted from the user's Arborea Prediction project; `tera-mod-ui` is a Toolbox runtime dependency and is not bundled.
