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

### Configuration

Edit `arborea-visual-cleanup/config.json` and restart the client. All options are booleans.

| Option | Default | Effect |
| --- | --- | --- |
| `hideHandGlow` | `true` | Removes the hand glow effect on you and on other players. |
| `hideNostrumFlash` | `true` | Removes the blue flash post-process effect. |
| `hideFlyingDashBlur` | `true` | Removes the flying dash blur. |
| `hideVignette` | `true` | Removes the screen vignette. |
| `disableScreenShake` | `true` | Asks the client to turn off camera shake. |
| `applyVideoSettingsAtCharacterSelectV2` | `false` | Experimental: installs patched UI packages for the video settings at character selection. |
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

### Troubleshooting

- **Nothing changes:** check the Tera Toolbox log for a "skipped" message. It almost always means the client build or `PostProcess.gpk` does not match the baseline.
- **Module fails to load:** a value in `config.json` is missing or is not `true`/`false`.
- **Changed a setting but nothing happened:** the module is not reloadable, so restart Tera Toolbox and the client.
