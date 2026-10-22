# 1.2.1 experimental tester build

**Automatic settings are disabled by default.** This branch distributes the reviewed tester package; the stable `main` branch is unchanged.

[**Download the tester ZIP**](https://raw.githubusercontent.com/Yukilihaso-dev/tera-arborea-reborn-mods/tester-1.2.1-experimental/tester-builds/1.2.1-experimental/Arborea-Automatic-Settings-1.2.1-experimental.zip)

- [Tester instructions](https://github.com/Yukilihaso-dev/tera-arborea-reborn-mods/blob/tester-1.2.1-experimental/tester-builds/1.2.1-experimental/Arborea-Automatic-Settings-1.2.1-Tester-Guide.txt)
- [Source snapshot](https://raw.githubusercontent.com/Yukilihaso-dev/tera-arborea-reborn-mods/tester-1.2.1-experimental/tester-builds/1.2.1-experimental/Arborea-Automatic-Settings-1.2.1-Source.zip)
- [Offline verification](https://github.com/Yukilihaso-dev/tera-arborea-reborn-mods/blob/tester-1.2.1-experimental/tester-builds/1.2.1-experimental/Arborea-Automatic-Settings-1.2.1-Verification.json)
- [SHA-256 checksums](https://github.com/Yukilihaso-dev/tera-arborea-reborn-mods/blob/tester-1.2.1-experimental/tester-builds/1.2.1-experimental/SHA256SUMS.txt)

Keep `applyVideoSettingsAtCharacterSelectV2` false for the first baseline check. Only the tester should deliberately change the new flag to literal `true`, after following the guide and fully restarting Toolbox and TERA. The retired `applyVideoSettingsAtCharacterSelect` flag cannot enable this version.

The readiness check requires the expected controls and complete saved values. Added Open, Apply and Close requests run in separate guarded UI steps with manual interaction and screen-change cancellation. The temporary Settings window may remain visible or stay open after cancellation.

All 101 offline tests passed. **Native crash resolution and rendered behavior remain unverified.** The original 1.2.0 experiment stays withdrawn; do not run its enable installer. This package was not installed or enabled on Julia's PC.

Follow the guide to preserve the tester's five existing cleanup settings and use one clean module folder. The source ZIP contains the reviewed code from local build commit `bb3343eb60fafe6a1c926a5865641459a5f106f6`.
