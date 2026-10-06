# 403Changer Loader core (`core.dll`)

Source of the `core.dll` that `Pengu Loader/` ships, rebuilt from the open
source **Pengu Loader v1.1.6** (MIT) core and UI, with 403Changer's contract
and branding.

```
core/     C++ hook (CEF, IFEO bootstrap `#6000`). Needs the cef headers (see below).
plugins/  Vite + SolidJS preload/UI, built into core/…/preload.g.h.
core/cef/ NOT committed. scripts/build_pengu_core.py clones PenguLoader/cef-headers (branch 5359).
```

## What 403Changer changed

* `config.ini` is read from `%LOCALAPPDATA%\403Changer\config.ini`
  (the old `%LOCALAPPDATA%\Rose\config.ini` is still accepted), through the
  Windows INI API so the ANSI code page written by 403Changer is read right.
  * `[General] disabled=1` -> nothing is hooked.
  * `[General] loaderpath=<dir>` -> loader folder (plugins, datastore); else the DLL's own folder.
* `core.log` is written to `%LOCALAPPDATA%\403Changer\core.log` (rotated at 512 KB).
  The folder is never created from inside the League process.
* Version info, UI texts and links say 403Changer; the in-client "new Pengu release" prompt is off.

## Build

Requirements: Windows, Visual Studio 2022 (MSVC v143, "Desktop development with C++"),
Node 18+ with `pnpm`, git.

```
python scripts/build_pengu_core.py
```

The script builds `plugins/` (pnpm), clones the cef headers, builds `core.dll` (x64 Release)
and writes it to `native/pengu/out/core.dll`. It does **not** replace
`Pengu Loader/core.dll`: test the new DLL first, then copy it over yourself
(`--install` does the copy and keeps `core.dll.bak`).
