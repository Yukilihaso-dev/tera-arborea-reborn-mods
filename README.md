# Tera Arborea Reborn Mods

Mods for Tera (Arborea Reborn) built as Tera Toolbox modules.

## Mods

- [arborea-visual-cleanup](#arborea-visual-cleanup)
- [arborea-auto-potions](#arborea-auto-potions)

Both update themselves through Tera Toolbox (see Updating).

## arborea-visual-cleanup

Removes distracting visual effects from the game client:

- hand glow
- blue nostrum flashes
- flying dash blur
- screen vignette
- camera shake

It also applies your saved video settings at character select. The game otherwise loads a default preset there, so the effects above would still show until you confirmed the video settings by hand.

### Installation

Copy the `arborea-visual-cleanup` folder into your Tera Toolbox `mods` directory and restart Tera Toolbox.

### Updating

The module updates itself through Tera Toolbox. `module.json` points at this repository's `main` branch, and `manifest.json` lists every file with its SHA-256 hash, so Toolbox only downloads files that changed. `config.json` is left out of the manifest, so your own settings are never overwritten.

Publishing a release (maintainers): bump `version` in the module's `module.json`, run `node build-manifest.js`, then commit and push to `main`.

### Configuration

Edit `arborea-visual-cleanup/config.json` and restart the client. All options are booleans: `hideHandGlow`, `hideNostrumFlash`, `hideFlyingDashBlur`, `disableScreenShake`, `hideVignette` and `applyVideoSettingsAtCharacterSelect` (all `true` by default). Set `applyVideoSettingsAtCharacterSelect` to `false` to leave the character-select screen untouched.

### Supported client

The shader and UI changes are verified by SHA-256 fingerprint against one exact client build, recorded in `baseline.json` (Arborea Reborn #2.1.6-1, Live-100.02). On any other build, or if one of the game files was already modified by something else, the module leaves the game files alone.

### How the character-select fix works

Two UI packages (`S1UI_SystemOption.gpk`, `S1UI_SelectCharacter.gpk`) are replaced through Tera Toolbox. They are stored in the game's own compressed package format; an uncompressed repack crashes the client. The character-select screen opens the options window and confirms it, which makes the game apply your real settings.
## arborea-auto-potions

Inventory-aware HP and MP auto potions with a local GUI and the current Arborea item catalog. See [its README](arborea-auto-potions/README.md).

Install by copying the rborea-auto-potions folder into your Tera Toolbox mods directory. It updates itself the same way as the visual cleanup mod; your settings.json is never overwritten. Run 
ode build-manifest.js before publishing a release of either mod.
