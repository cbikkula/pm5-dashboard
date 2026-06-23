"""Scan-and-connect dialog.

Presents Bluetooth and USB devices in a single list so the user can
pick whichever is available without needing to know the difference.
"""
from __future__ import annotations

import asyncio
from typing import List, Optional, Tuple, Union

from PySide6.QtCore import Qt, QSize
from PySide6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
)

from ...pm5.ble_client import DiscoveredDevice, PM5BleClient
from ...pm5.usb_client import PM5UsbClient, UsbDevice


DeviceEntry = Tuple[str, Union[DiscoveredDevice, UsbDevice]]  # ("ble"|"usb", device)


class ConnectDialog(QDialog):
    def __init__(self, ble: PM5BleClient, usb: PM5UsbClient, parent=None) -> None:
        super().__init__(parent)
        self._ble = ble
        self._usb = usb
        self._scan_task: Optional[asyncio.Task] = None
        self._selected: Optional[DeviceEntry] = None

        self.setWindowTitle("Connect to PM5")
        self.setModal(True)
        self.resize(560, 430)

        title = QLabel("Select a PM5 monitor")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")

        self._subtitle = QLabel("Looking for nearby PM5s…")
        self._subtitle.setStyleSheet("color: #9ba7bd; font-size: 12px;")

        self._list = QListWidget()
        self._list.setIconSize(QSize(16, 16))
        self._list.itemDoubleClicked.connect(self._on_double_clicked)
        self._list.itemSelectionChanged.connect(self._on_selection_changed)

        self._rescan_btn = QPushButton("Rescan")
        self._rescan_btn.clicked.connect(self._start_scan)

        self._connect_btn = QPushButton("Connect")
        self._connect_btn.setProperty("accent", "true")
        self._connect_btn.setEnabled(False)
        self._connect_btn.clicked.connect(self._accept)

        self._cancel_btn = QPushButton("Cancel")
        self._cancel_btn.clicked.connect(self.reject)

        buttons = QHBoxLayout()
        buttons.addWidget(self._rescan_btn)
        buttons.addStretch(1)
        buttons.addWidget(self._cancel_btn)
        buttons.addWidget(self._connect_btn)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 22)
        layout.setSpacing(10)
        layout.addWidget(title)
        layout.addWidget(self._subtitle)
        layout.addSpacing(6)
        layout.addWidget(self._list, 1)
        layout.addLayout(buttons)

        # Auto-start scan when dialog opens
        self._start_scan()

    # ------------------------------------------------------------------
    def selected(self) -> Optional[DeviceEntry]:
        return self._selected

    def _start_scan(self) -> None:
        if self._scan_task and not self._scan_task.done():
            return
        self._list.clear()
        self._subtitle.setText("Looking for nearby PM5s…")
        self._rescan_btn.setEnabled(False)
        self._connect_btn.setEnabled(False)
        self._scan_task = asyncio.ensure_future(self._run_scan())

    async def _run_scan(self) -> None:
        try:
            # BLE scan runs in the background; USB enumeration is instant.
            usb_devices = await self._usb.scan()
            self._populate_usb(usb_devices)

            ble_task = asyncio.create_task(self._ble.scan(timeout=8.0))
            ble_devices: List[DiscoveredDevice] = await ble_task
            self._populate_ble(ble_devices)

            count = len(usb_devices) + len(ble_devices)
            if count == 0:
                self._subtitle.setText(
                    "No PM5 detected. Wake the monitor by rowing a stroke, "
                    "enable Bluetooth, or plug in the USB cable, then click "
                    "Rescan.")
            else:
                plural = "monitor" if count == 1 else "monitors"
                self._subtitle.setText(f"Found {count} {plural} — pick one to connect.")
        except Exception as exc:  # noqa: BLE001
            self._subtitle.setText(f"Scan failed: {exc}")
        finally:
            self._rescan_btn.setEnabled(True)

    def _populate_usb(self, devices: List[UsbDevice]) -> None:
        for dev in devices:
            item = QListWidgetItem(f"[USB]  {dev.label()}")
            item.setData(Qt.ItemDataRole.UserRole, ("usb", dev))
            self._list.addItem(item)

    def _populate_ble(self, devices: List[DiscoveredDevice]) -> None:
        for dev in devices:
            item = QListWidgetItem(f"[BLE]  {dev.label()}")
            item.setData(Qt.ItemDataRole.UserRole, ("ble", dev))
            self._list.addItem(item)

    # ------------------------------------------------------------------
    def _on_selection_changed(self) -> None:
        item = self._list.currentItem()
        self._connect_btn.setEnabled(item is not None)

    def _on_double_clicked(self, _item) -> None:
        self._accept()

    def _accept(self) -> None:
        item = self._list.currentItem()
        if item is None:
            return
        entry = item.data(Qt.ItemDataRole.UserRole)
        if entry:
            self._selected = entry
            self.accept()
