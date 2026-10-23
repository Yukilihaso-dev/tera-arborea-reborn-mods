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

It does not touch the character-select or server-select screens.

### Installation

Copy the `arborea-visual-cleanup` folder into your Tera Toolbox `mods` directory and restart Tera Toolbox.

### Updating

The module updates itself through Tera Toolbox. `module.json` points at this repository's `main` branch, and `manifest.json` lists every file with its SHA-256 hash, so Toolbox only downloads files that changed. `config.json` is left out of the manifest, so your own settings are never overwritten.

Publishing a release (maintainers): bump `version` in the module's `module.json`, run `node build-manifest.js`, then commit and push to `main`.

### Configuration

Edit `arborea-visual-cleanup/config.json` and restart the client. All options are booleans: `hideHandGlow`, `hideNostrumFlash`, `hideFlyingDashBlur`, `disableScreenShake` and `hideVignette` (all `true` by default).

### Supported client

The shader changes are verified by SHA-256 fingerprint against one exact client build, recorded in `baseline.json` (Arborea Reborn #2.1.6-1, Live-100.02). On any other build, or if `PostProcess.gpk` was already modified by something else, the module leaves the game files alone.
## arborea-auto-potions

Inventory-aware HP and MP auto potions with a local GUI and the current Arborea item catalog. See [its README](arborea-auto-potions/README.md).

Install by copying the rborea-auto-potions folder into your Tera Toolbox mods directory. It updates itself the same way as the visual cleanup mod; your settings.json is never overwritten. Run 
ode build-manifest.js before publishing a release of either mod.
