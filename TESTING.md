# Experimental automatic settings v2

Version 1.2.1 is a new tester build, disabled by default. The original 1.2.0 experiment remains withdrawn after a tester reported a character-selection crash on the matching Arborea client. Its exact native fault has not been established. Do not run the old enable installer.

The retired `applyVideoSettingsAtCharacterSelect` option is ignored even when retained as `true` or malformed. Only literal `true` in the separate `applyVideoSettingsAtCharacterSelectV2` option can request v2 UI packages. Missing, false or malformed new options keep automation off without disabling ordinary cleanup. Version 1 manifests and the old asset directory are rejected.

## Offline checks

From the repository root:

```powershell
node --test tests/*.test.js
python -B -m unittest discover -s tests -p 'test_*.py' -v
python -B -m unittest discover -s arborea-visual-cleanup/tests -p 'test_*.py' -v
```

The builder requires the exact stock client fingerprints in `tools/lobby_video_settings.py`. It writes only outside the client tree. From `arborea-visual-cleanup`:

```powershell
python -B tools/build_lobby_video.py --client-root 'C:/Program Files (x86)/ArboreaReborn_Launcher/TERA' --output assets/lobby-video-settings-v2
```

Rebuilding must reproduce both package hashes and the v2 manifest. Independent scans check action/function extents and branches, original constant pools, non-action resources, package exports and restoration of original actions after stripping additions.

The original 40-entry video option index includes ten obsolete entries with no physical target controls. V2 pins that complete index and a separate fixed schema of 29 real controls plus FS, including nested SR/RN/CL combos and all three FS radios. It never derives required coverage from whichever controls happen to exist. Tests must reject each missing expected control, empty/partial trees, incomplete snapshots, malformed effective saved tokens and mismatches against the original serializer. The original serializer remains unchanged.

The constructor installs local state only. Native show/data callbacks finish their stock work and record state; they do not execute the added Open/Apply/Close operations inline. Later owned UI steps require current generation/selection, expected controls, complete saved data and no manual takeover. Stages are consumed before requests. Apply and Close occur in separate steps; stale data, reentry, cancellation, timeout and unload must not cause duplicate requests or native cleanup calls. Original delegates and stock frame handlers remain intact. The shared token contains only scalar status/generation data.

The temporary Settings window remains visible to avoid relying on advancement of hidden clips. A cancelled attempt may leave normal Settings open for manual use. A timeout only cancels; elapsed time is never a readiness condition.

The AVM1 evaluator is a model, not native Scaleform or TERA. It substitutes rendering, native submission and engine lifetime behavior. Passing interpreter or packaging tests does not demonstrate in-game crash freedom, establish a native host scheduling boundary or confirm the rendered graphics result. A later AS frame can still execute inside the same native Advance call. Original stock flows also close inline; this investigation does not claim every inline close is illegal.

## Tester sequence and recovery

1. Close TERA and Toolbox completely. Preserve the tester's old module and config outside Toolbox's `mods` directory. Use one clean `arborea-visual-cleanup` folder, rather than overlaying or retaining a renamed second module in `mods`.
2. Transfer only the tester's five original cleanup booleans into the new config: `hideHandGlow`, `hideNostrumFlash`, `hideFlyingDashBlur`, `disableScreenShake`, `hideVignette`. The packaged config is a local all-true cleanup snapshot; preserve differing choices. Keep both experimental flags false for the first check.
3. Verify old modified `S1UI_SystemOption.gpk` and `S1UI_SelectCharacter.gpk` are absent from Toolbox's managed override folder before the disabled baseline. Its cleanup is best effort. Preserve unrelated overrides and all original source game packages.
4. With the v2 flag false, start both applications and check ordinary cleanup/character selection. The module should request only its existing PostProcess asset, or none if those cleanup effects are disabled.
5. Only the tester deliberately sets `applyVideoSettingsAtCharacterSelectV2` to `true`, fully restarts both applications, and checks the automatic attempt. Saved values should load, apply once, and the temporary visible dialog should close on a later step. Manual interaction, missing data or a changed screen may cancel and leave normal Settings open.
6. For any failure, stop the test, set v2 false, close both applications and verify the modified UI pair is absent before restarting. Full rollback is the preserved prepatch 1.1.1 module, restored cleanly with the tester's five cleanup values. Use the original Options > Video > Apply workflow.

No logs from Julia's PC are required. No local game test, automatic opt-in or deployment is performed as part of this build. The module uses Toolbox overrides rather than overwriting source game packages; local source hashes are checked separately from the external tester's uninspected filesystem.
