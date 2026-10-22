# Arborea Visual Cleanup

Removes nostrum hand glow from you and other players, blue screen flashes, flying mount dash blur, vignette and camera shake.

Place `arborea-visual-cleanup` in your Toolbox `mods` folder, then restart Toolbox and TERA.

Use the normal `TeraToolbox.exe` launcher, which requests the permissions its package loader needs.

Edit `config.json` to turn each control on or off. Restart both applications after changing settings. No commands are needed.

## Experimental automatic settings v2

Version 1.2.1 is a new tester build. Automatic application is **off by default**. A tester reported an immediate character-selection crash with the old 1.2.0 experiment; its exact native cause remains unproven. Do not use that old ZIP or installer.

This version ignores the old `applyVideoSettingsAtCharacterSelect` flag. The separate `applyVideoSettingsAtCharacterSelectV2` flag requires literal `true`; missing or malformed values leave automation off. It accepts only the new v2 package manifest. Changing a config requires fully restarting TERA and Toolbox.

For the first check, keep the new flag `false`. Ordinary cleanup should work and neither modified UI package should be requested. Only the tester should then deliberately set the new flag to `true` and restart both applications. The exact client revision and stock package fingerprints must match; unsupported clients skip the automatic feature.

The temporary Settings window stays visible while the saved values load. The patch requires the expected controls and complete saved values before applying them, then requests close on a later UI step. Missing data, a changed selection, manual interaction or timeout cancels the attempt. Cancellation can leave the normal Settings window open for manual use. No timeout is treated as proof of readiness.

The constructor and incoming show/data callbacks no longer issue the added Open/Apply/Close operations directly. Later UI steps still run within Scaleform, so this ordering change does not establish a safe native engine boundary or prove the crash resolved. This build has not been tested in the game on Julia's PC.

When replacing a module, close both applications, back up the old module OUTSIDE Toolbox's `mods` directory and use a clean `arborea-visual-cleanup` folder. Transfer only your existing `hideHandGlow`, `hideNostrumFlash`, `hideFlyingDashBlur`, `disableScreenShake` and `hideVignette` booleans into the new config. Leave both experimental flags `false` for the first check. Do not retain a second module inside `mods` or run the old enable installer.

The module uses Toolbox overrides rather than overwriting original game packages. Managed-cache cleanup is best effort: verify old modified `S1UI_SystemOption.gpk` and `S1UI_SelectCharacter.gpk` overrides are absent before the fresh disabled check. Preserve unrelated overrides and all stock source packages.

If the tester encounters trouble, set the v2 flag to `false`, close both applications and verify the two modified UI overrides are absent before restarting. The preserved prepatch 1.1.1 module provides complete rollback; use the original Options > Video > Apply workflow. See [verification and recovery guidance](../TESTING.md).

To uninstall, delete the mod folder and restart both applications.
