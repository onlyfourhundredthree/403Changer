#!/usr/bin/env python3
"""Check a built core.dll without running it.

The IFEO entry 403Changer writes is `rundll32 "<core.dll>", #6000`, so the
bootstrap must stay at ordinal 6000, and the hook finds its settings through
strings compiled into the DLL. Both are verified here.

Usage: python scripts/verify_core_dll.py [path/to/core.dll]
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

DEFAULT_DLL = Path(__file__).resolve().parents[1] / "native" / "pengu" / "out" / "core.dll"

REQUIRED_ORDINALS = {
    5000: "_GetCefVersion",
    6000: "_BootstrapEntry (the IFEO debugger entry point)",
}
# Compiled-in literals, not runtime paths: the log path is joined from two of
# these at runtime, so it never appears whole in the binary.
REQUIRED_STRINGS = [
    ("\\403Changer\\config.ini", "the config the hook reads"),
    ("\\Rose\\config.ini", "the old config, still read so existing installs keep working"),
    ("\\403Changer", "the data folder the log path is built from"),
    ("\\core.log", "the log file name"),
    ("403Changer Loader", "the version resource compiled in"),
]
# Only the first EXPORTS block of res/module.def ends up in the DLL (the linker
# takes one), so these d3d9 names are the proxy surface that must be there.
REQUIRED_EXPORT_NAMES = ["Direct3DCreate9", "Direct3DCreate9Ex", "D3DPERF_BeginEvent"]


def _sections(data: bytes, pe: int, section_count: int, opt_size: int):
    table = pe + 24 + opt_size
    for i in range(section_count):
        entry = table + i * 40
        rva, raw_size, raw_offset = struct.unpack_from("<III", data, entry + 12)
        yield rva, raw_size, raw_offset


def _rva_to_offset(sections, rva: int) -> int | None:
    for sec_rva, raw_size, raw_offset in sections:
        if sec_rva <= rva < sec_rva + raw_size:
            return rva - sec_rva + raw_offset
    return None


def read_exports(data: bytes) -> tuple[set[int], set[str]]:
    """Return (ordinals that resolve to code, exported names)."""
    if data[:2] != b"MZ":
        raise ValueError("not a PE file")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE file")

    section_count = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    if magic != 0x20B:
        raise ValueError(f"expected a 64-bit DLL, got optional header magic 0x{magic:x}")

    sections = list(_sections(data, pe, section_count, opt_size))
    export_rva = struct.unpack_from("<I", data, pe + 24 + 112)[0]
    if not export_rva:
        raise ValueError("the DLL exports nothing")

    base_off = _rva_to_offset(sections, export_rva)
    if base_off is None:
        raise ValueError("the export directory is outside every section")

    ordinal_base, func_count, name_count = struct.unpack_from("<III", data, base_off + 16)
    func_rva, names_rva, name_ordinals_rva = struct.unpack_from("<III", data, base_off + 28)

    functions_off = _rva_to_offset(sections, func_rva)
    ordinals = set()
    for i in range(func_count):
        if struct.unpack_from("<I", data, functions_off + i * 4)[0]:
            ordinals.add(ordinal_base + i)

    names: set[str] = set()
    if name_count:
        names_off = _rva_to_offset(sections, names_rva)
        for i in range(name_count):
            name_rva = struct.unpack_from("<I", data, names_off + i * 4)[0]
            off = _rva_to_offset(sections, name_rva)
            if off is not None:
                names.add(data[off:data.index(b"\0", off)].decode("ascii", "replace"))
    _ = name_ordinals_rva
    return ordinals, names


def main() -> int:
    dll = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DLL
    if not dll.is_file():
        print(f"[FAIL] {dll} does not exist")
        return 1

    data = dll.read_bytes()
    print(f"file    : {dll} ({len(data):,} bytes)")

    problems: list[str] = []
    try:
        ordinals, names = read_exports(data)
    except ValueError as exc:
        print(f"[FAIL] {exc}")
        return 1

    print(f"exports : {len(ordinals)} ordinals, {len(names)} named")
    for ordinal, what in REQUIRED_ORDINALS.items():
        ok = ordinal in ordinals
        print(f"  {'OK  ' if ok else 'FAIL'} ordinal #{ordinal} - {what}")
        if not ok:
            problems.append(f"ordinal #{ordinal} is missing")

    for name in REQUIRED_EXPORT_NAMES:
        ok = name in names
        print(f"  {'OK  ' if ok else 'FAIL'} export {name}")
        if not ok:
            problems.append(f"export {name} is missing")

    text = data.decode("utf-16-le", "ignore")
    print("strings :")
    for needle, why in REQUIRED_STRINGS:
        ok = needle in text
        print(f"  {'OK  ' if ok else 'FAIL'} {needle:<26} {why}")
        if not ok:
            problems.append(f"the string {needle} is missing")

    leftovers = [s for s in ("\\Rose\\core.log", "Rose Loader") if s in text]
    if leftovers:
        print(f"  note  still mentions: {', '.join(leftovers)}")

    if problems:
        print("\n[FAIL] " + "; ".join(problems))
        return 1
    print("\n[OK] core.dll looks right")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
