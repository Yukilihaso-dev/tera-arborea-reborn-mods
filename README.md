# Tera Arborea Reborn Mods

Mods for Tera (Arborea Reborn) built as Tera Toolbox modules.

## arborea-visual-cleanup

Removes distracting visual effects from the game client:

- hand glow
- blue nostrum flashes
- flying dash blur
- screen vignette
- camera shake

It can also optionally apply video settings automatically at character selection.

### Installation

Copy the `arborea-visual-cleanup` folder into your Tera Toolbox `mods` directory and restart Tera Toolbox.

### Updating

The module updates itself through Tera Toolbox. `module.json` points at this repository's `main` branch, and `manifest.json` lists every file with its SHA-256 hash, so Toolbox only downloads files that changed. `config.json` is deliberately left out of the manifest, so your own settings are never overwritten.

The first time, install this version by hand (see Installation); after that, updates arrive automatically whenever Tera Toolbox starts and finds a newer release on `main`.

Publishing a release (maintainers):

1. Change the code and bump `version` in `arborea-visual-cleanup/module.json`.
2. Run `node build-manifest.js` (use `node build-manifest.js --check` to verify). If you skip this, the hashes no longer match and the update fails.
3. Commit and push to `main`. The updater only sees what is on `main`.

If a new release adds a required option to `config.json`, give it a default in `lib/client-state.js` as well, because existing users keep their old `config.json` and a missing required option stops the module from loading.

### Configuration

Edit `arborea-visual-cleanup/config.json` and restart the client. All options are booleans.

| Option | Default | Effect |
| --- | --- | --- |
| `hideHandGlow` | `true` | Removes the hand glow effect on you and on other players. |
| `hideNostrumFlash` | `true` | Removes the blue flash post-process effect. |
| `hideFlyingDashBlur` | `true` | Removes the flying dash blur. |
| `hideVignette` | `true` | Removes the screen vignette. |
| `disableScreenShake` | `true` | Asks the client to turn off camera shake. |
| `applyVideoSettingsAtCharacterSelectV2` | `true` | Installs patched UI packages so your saved video settings are applied at character selection (see below). Set to `false` to leave the original UI files untouched. |
| `applyVideoSettingsAtCharacterSelect` | n/a | Retired. It is ignored and always treated as off. |

A missing `hideVignette` falls back to `true`. Every other cleanup option must be present and must be a boolean, otherwise the module refuses to load.

### Supported client

The shader and UI changes are verified by SHA-256 fingerprint against one exact client build, recorded in `baseline.json`:

- Arborea Reborn #2.1.6-1 (LIVE), Live-100.02

On any other build, or if `PostProcess.gpk` has already been modified by something else, the module leaves the game files alone and writes the reason to the Tera Toolbox log, for example:

```
Shader changes skipped: this client build does not match the supported baseline.
```

### How it works

- **Shader changes** (`assets/`): a patched `PostProcess.gpk` is installed. One variant per combination of `hideFlyingDashBlur`, `hideNostrumFlash` and `hideVignette` is shipped, and the matching one is chosen from `assets/manifest.json`.
- **Hand glow** (`lib/hand-effects.js`, `lib/remote-hand-effects.js`): handled at runtime rather than by a file patch. The module sends `S_REMOVE_EFFECT` to the client shortly after the effect is triggered (buffs, played effects, spawns, resurrection, loading screens). Remote players are tracked individually, up to 1024 at a time.
- **Camera shake** (`lib/camera-shake.js`): re-applied on entering the game and after each loading screen.
- **Character-selection video settings** (`lib/lobby-video-settings.js`): replaces `S1UI_SystemOption.gpk` and `S1UI_SelectCharacter.gpk` only when both source files and both replacements match their expected fingerprints.

### Character select looks different from in-game

The game loads a default preset at character selection instead of your saved video settings, so effects such as the vignette can still show there until you open the video settings and confirm them without changing anything. Because players pass through character select very often, the module works around this by installing patched UI packages that are intended to apply your saved settings at that screen (`applyVideoSettingsAtCharacterSelectV2`, enabled by default). This only installs when the client build and both original UI packages match their expected fingerprints.

### Troubleshooting

- **Nothing changes:** check the Tera Toolbox log for a "skipped" message. It almost always means the client build or `PostProcess.gpk` does not match the baseline.
- **Module fails to load:** a value in `config.json` is missing or is not `true`/`false`.
- **Changed a setting but nothing happened:** the module is not reloadable, so restart Tera Toolbox and the client.
