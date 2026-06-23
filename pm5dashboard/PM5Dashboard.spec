# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for building PM5Dashboard.exe as a single Windows binary.

import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files


def _collect(pkg: str):
    """collect_submodules is strict about missing packages — we have a
    couple of optional ones (winrt on non-Windows dev machines) that we
    don't want to hard-require."""
    try:
        return collect_submodules(pkg)
    except Exception:
        return []


hiddenimports: list = []
hiddenimports += _collect("bleak")
hiddenimports += _collect("bleak.backends")
hiddenimports += _collect("winrt")
hiddenimports += _collect("qasync")
hiddenimports += [
    "pyqtgraph.graphicsItems.GraphicsWidget",
    "pyqtgraph.graphicsItems.PlotCurveItem",
    "pyqtgraph.graphicsItems.FillBetweenItem",
    "hid",
]

datas: list = []
datas += collect_data_files("pyqtgraph")

a = Analysis(
    ["pm5dashboard.py"],
    pathex=[os.getcwd()],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PyQt6"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="PM5Dashboard",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
