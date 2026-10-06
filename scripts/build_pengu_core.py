#!/usr/bin/env python3
"""Build 403Changer's Pengu Loader core.dll from native/pengu (Windows only).

Steps: pnpm build of native/pengu/plugins -> clone the CEF headers ->
MSBuild native/pengu/core (x64 Release) -> native/pengu/out/core.dll.

Usage:
    python scripts/build_pengu_core.py            build only
    python scripts/build_pengu_core.py --install  also copy the result over
                                                  "Pengu Loader/core.dll" (keeps core.dll.bak)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PENGU = ROOT / "native" / "pengu"
PLUGINS = PENGU / "plugins"
CORE_PROJECT = PENGU / "core" / "core.vcxproj"
CEF_DIR = PENGU / "core" / "cef"
BIN_DIR = PENGU / "bin"
OUT_DIR = PENGU / "out"
RUNTIME_DLL = ROOT / "Pengu Loader" / "core.dll"
CEF_HEADERS_URL = "https://github.com/PenguLoader/cef-headers.git"
CEF_HEADERS_BRANCH = "5359"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("> " + " ".join(cmd))
    result = subprocess.run(cmd, cwd=cwd, check=False)
    if result.returncode != 0:
        raise SystemExit(f"[ERROR] command failed ({result.returncode}): {' '.join(cmd)}")


def find_msbuild() -> list[str]:
    configured = os.environ.get("MSBUILD_EXE")
    if configured and Path(configured).exists():
        return [configured]
    found = shutil.which("msbuild")
    if found:
        return [found]
    vswhere = Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
    if vswhere.exists():
        result = subprocess.run(
            [str(vswhere), "-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild",
             "-find", r"MSBuild\**\Bin\MSBuild.exe"],
            capture_output=True, text=True, check=False,
        )
        for line in result.stdout.splitlines():
            if line.strip() and Path(line.strip()).exists():
                return [line.strip()]
    raise SystemExit("[ERROR] MSBuild not found. Install Visual Studio 2022 with 'Desktop development with C++'.")


def pnpm_command() -> list[str]:
    found = shutil.which("pnpm")
    if found:
        return [found]
    corepack = shutil.which("corepack")
    if corepack:
        return [corepack, "pnpm"]
    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "pnpm"]
    raise SystemExit("[ERROR] pnpm (or Node with corepack/npx) not found.")


def build_ui() -> None:
    print("\n== Building the preload/UI bundle (plugins) ==")
    pnpm = pnpm_command()
    run(pnpm + ["install", "--frozen-lockfile"], cwd=PLUGINS)
    run(pnpm + ["build"], cwd=PLUGINS)
    header = PLUGINS / "dist" / "preload.g.h"
    if not header.is_file():
        raise SystemExit(f"[ERROR] {header} was not generated.")


def fetch_cef_headers() -> None:
    if (CEF_DIR / "include").is_dir() and (CEF_DIR / "lib").is_dir():
        print("\n== CEF headers already present ==")
        return
    print("\n== Cloning the CEF headers ==")
    if CEF_DIR.exists():
        shutil.rmtree(CEF_DIR)
    run(["git", "clone", "--depth", "1", "--branch", CEF_HEADERS_BRANCH, CEF_HEADERS_URL, str(CEF_DIR)])


def build_core() -> Path:
    print("\n== Building core.dll (x64 Release) ==")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    solution_dir = str(PENGU) + os.sep
    run(find_msbuild() + [
        str(CORE_PROJECT),
        "/p:Configuration=Release",
        "/p:Platform=x64",
        f"/p:SolutionDir={solution_dir}",
        "/m",
        "/v:minimal",
    ])
    built = BIN_DIR / "core.dll"
    if not built.is_file():
        raise SystemExit(f"[ERROR] {built} was not produced.")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / "core.dll"
    shutil.copy2(built, target)
    return target


def install(dll: Path) -> None:
    if RUNTIME_DLL.exists():
        backup = RUNTIME_DLL.with_suffix(".dll.bak")
        shutil.copy2(RUNTIME_DLL, backup)
        print(f"[OK] Backup: {backup}")
    shutil.copy2(dll, RUNTIME_DLL)
    print(f"[OK] Installed: {RUNTIME_DLL}")
    print("     Close League and the loader window first if the copy failed; restart 403Changer afterwards.")


def main() -> int:
    if sys.platform != "win32":
        print("[ERROR] The core.dll build needs Windows and MSVC.")
        return 1
    build_ui()
    fetch_cef_headers()
    dll = build_core()
    print(f"\n[OK] Built {dll}")
    if "--install" in sys.argv[1:]:
        install(dll)
    else:
        print("     Test it, then run again with --install (or copy it to 'Pengu Loader/core.dll').")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
