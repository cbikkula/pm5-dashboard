"""Top-level main window composition.

Layout overview:
    +------------------------------------------------------------------+
    | StatusHeader (title + connection status + connect button)        |
    +--------------+------------------------------+-------------------+
    |  RATIO       |                              |  DRIVE LENGTH     |
    |  (hero)      |       FORCE CURVE            |  (hero)           |
    |              |       (dominant centre)      |                   |
    |  — cards —   |                              |  — cards —        |
    +--------------+------------------------------+-------------------+
    |  Bottom strip: elapsed · drag · stroke # · peak force · split   |
    +------------------------------------------------------------------+
    |  Toast bar (info/warn/error messages)                            |
    +------------------------------------------------------------------+
"""
from __future__ import annotations

import asyncio
from typing import Optional, Union

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import (
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QVBoxLayout,
    QWidget,
)

from .. import __app_name__
from ..pm5.ble_client import DiscoveredDevice, PM5BleClient
from ..pm5.data_model import RowingState
from ..pm5.usb_client import PM5UsbClient, UsbDevice
from ..state_controller import StateController
from . import format as fmt
from . import theme
from .dialogs.connect_dialog import ConnectDialog
from .widgets.drive_length import DriveLengthWidget
from .widgets.force_curve import ForceCurveWidget
from .widgets.metric_card import MetricCard
from .widgets.ratio import RatioWidget
from .widgets.status_header import StatusHeader


class MainWindow(QMainWindow):
    def __init__(self, ble: PM5BleClient, usb: PM5UsbClient,
                 controller: StateController) -> None:
        super().__init__()
        self._ble = ble
        self._usb = usb
        self._controller = controller
        self._active_task: Optional[asyncio.Task] = None

        self.setWindowTitle(__app_name__)
        self.setMinimumSize(1180, 760)
        self.resize(1380, 840)

        root = QWidget()
        root.setObjectName("AppRoot")
        self.setCentralWidget(root)

        # ----- Header -------------------------------------------------
        self._header = StatusHeader()
        self._header.connect_clicked.connect(self._on_connect_clicked)
        self._header.disconnect_clicked.connect(self._on_disconnect_clicked)

        # ----- Hero panels -------------------------------------------
        # Widgets stretch proportionally with the window — no max widths
        # so full-screen fills the space. Minimums keep narrow windows
        # readable.
        self._ratio = RatioWidget()
        self._ratio.setMinimumWidth(330)
        self._ratio.setMinimumHeight(360)

        self._force_curve = ForceCurveWidget()

        self._drive_len = DriveLengthWidget()
        self._drive_len.setMinimumWidth(330)
        self._drive_len.setMinimumHeight(360)

        # ----- Secondary metric cards --------------------------------
        self._card_stroke_rate = MetricCard("Stroke Rate", "per min")
        self._card_pace = MetricCard("Pace", "/ 500 m")
        self._card_watts = MetricCard("Power", "watts")
        self._card_distance = MetricCard("Distance", "metres")
        self._card_heart_rate = MetricCard("Heart Rate", "bpm")
        self._card_intervals = MetricCard("Intervals", "count")

        # Left column under Ratio
        left_col = QVBoxLayout()
        left_col.setSpacing(12)
        left_col.addWidget(self._ratio, 2)
        left_col.addWidget(self._card_stroke_rate, 1)
        left_col.addWidget(self._card_pace, 1)
        left_col.addWidget(self._card_watts, 1)

        # Right column under Drive Length
        right_col = QVBoxLayout()
        right_col.setSpacing(12)
        right_col.addWidget(self._drive_len, 2)
        right_col.addWidget(self._card_distance, 1)
        right_col.addWidget(self._card_heart_rate, 1)
        right_col.addWidget(self._card_intervals, 1)

        # Center column: force curve at top, stretch below absorbs the
        # extra vertical space so the side columns aren't forced to
        # shrink down to the aspect-locked curve's height.
        center_col = QVBoxLayout()
        center_col.setSpacing(0)
        center_col.addWidget(self._force_curve, 0)
        center_col.addStretch(1)

        # Stretch factors 2:3:2 — force curve ~40%, side columns ~30% each.
        content = QHBoxLayout()
        content.setSpacing(16)
        content.addLayout(left_col, 2)
        content.addLayout(center_col, 3)
        content.addLayout(right_col, 2)

        # ----- Workout overview strip -------------------------------
        self._card_elapsed = MetricCard("Elapsed", "time")
        self._card_drag = MetricCard("Drag Factor", "")
        self._card_rest = MetricCard("Rest", "time")
        self._card_avg_split = MetricCard("Avg Split", "/ 500 m")
        self._card_avg_watts = MetricCard("Avg Watts", "watts")

        bottom_strip = QHBoxLayout()
        bottom_strip.setSpacing(12)
        for c in (
            self._card_elapsed, self._card_drag,
            self._card_rest, self._card_avg_split, self._card_avg_watts,
        ):
            bottom_strip.addWidget(c, 1)

        bottom_frame = QFrame()
        bottom_frame.setProperty("role", "panel")
        bl = QVBoxLayout(bottom_frame)
        bl.setContentsMargins(14, 12, 14, 12)
        bl.addLayout(bottom_strip)

        # ----- Toast / message bar ----------------------------------
        self._toast = QLabel("")
        self._toast.setProperty("role", "status")
        self._toast.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._toast.setWordWrap(True)
        self._toast.setMinimumHeight(26)

        self._toast_clear = QTimer(self)
        self._toast_clear.setSingleShot(True)
        self._toast_clear.timeout.connect(lambda: self._toast.setText(""))

        # ----- Assemble ---------------------------------------------
        layout = QVBoxLayout(root)
        layout.setContentsMargins(16, 16, 16, 10)
        layout.setSpacing(12)
        layout.addWidget(self._header)
        layout.addLayout(content, 1)
        layout.addWidget(bottom_frame)
        layout.addWidget(self._toast)

        # ----- Wire controller --------------------------------------
        self._controller.state_changed.connect(self._on_state_changed)
        self._controller.connection_state_changed.connect(self._on_conn_state)
        self._controller.message.connect(self._on_message)

        # Initial paint
        self._on_state_changed(self._controller.state)
        self._on_conn_state("disconnected")

    # ==================================================================
    # Update state → widgets
    # ==================================================================
    def _hero_metrics_available(self) -> bool:
        return self._controller.connection_mode() in ("", "ble")

    def _on_state_changed(self, state: RowingState) -> None:
        ble = self._hero_metrics_available()

        # During a stroke, the live buffer is the bright "current" trace
        # and the last-completed stroke is the muted reference. Between
        # strokes we promote the last-completed stroke to "current" so
        # there's always a curve visible as long as we've ever had one.
        if state.live_force_curve:
            bright = state.live_force_curve
            muted = state.force_curve
        else:
            bright = state.force_curve
            muted = state.previous_force_curve
        self._force_curve.update_curves(bright, muted)
        if not ble:
            self._force_curve.set_hint("Force Curve requires Bluetooth")
        elif state.stroke_count:
            self._force_curve.set_hint(f"{state.stroke_count} strokes")
        elif state.force_curve:
            self._force_curve.set_hint("live")
        else:
            self._force_curve.set_hint("waiting for first stroke…")

        self._drive_len.set_value(state.drive_length_m, available=ble)
        self._ratio.set_ratio(
            state.ratio, state.drive_time_s, state.recovery_time_s,
            available=ble,
        )

        # Secondary cards
        self._card_stroke_rate.set_value(fmt.fmt_int(state.stroke_rate))
        self._card_pace.set_value(fmt.fmt_pace(state.pace_s_per_500m))
        self._card_watts.set_value(fmt.fmt_int(state.watts))
        self._card_distance.set_value(fmt.fmt_distance(state.distance_m))
        self._card_distance.set_unit(
            "km" if (state.distance_m or 0) >= 1000 else "metres")
        self._card_heart_rate.set_value(fmt.fmt_int(state.heart_rate))
        self._card_intervals.set_value(fmt.fmt_int(state.interval_count))

        self._card_elapsed.set_value(fmt.fmt_time(state.elapsed_time_s))
        self._card_drag.set_value(fmt.fmt_int(state.drag_factor))
        self._card_rest.set_value(fmt.fmt_time(state.rest_time_s))
        self._card_avg_split.set_value(fmt.fmt_pace(state.split_avg_pace_s))
        self._card_avg_watts.set_value(fmt.fmt_int(state.watts))

    def _on_conn_state(self, state: str) -> None:
        self._header.set_state(state)

    def _on_message(self, level: str, text: str) -> None:
        colour = {
            "error": theme.COLOR_ACCENT_WARN,
            "warn": theme.COLOR_STATUS_CONNECTING,
            "info": theme.COLOR_TEXT_SECONDARY,
        }.get(level, theme.COLOR_TEXT_SECONDARY)
        self._toast.setStyleSheet(f"color: {colour}; font-size: 12px;")
        self._toast.setText(text)
        self._toast_clear.start(6000 if level != "error" else 10000)

    # ==================================================================
    # Connect / disconnect buttons
    # ==================================================================
    def _on_connect_clicked(self) -> None:
        dlg = ConnectDialog(self._ble, self._usb, parent=self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        entry = dlg.selected()
        if not entry:
            return
        kind, device = entry
        self._active_task = asyncio.ensure_future(self._do_connect(kind, device))

    def _on_disconnect_clicked(self) -> None:
        self._active_task = asyncio.ensure_future(self._do_disconnect())

    async def _do_connect(
        self,
        kind: str,
        device: Union[DiscoveredDevice, UsbDevice],
    ) -> None:
        # Ensure any existing session is cleanly torn down first.
        await self._ble.disconnect_device()
        await self._usb.disconnect_device()
        self._controller.reset()
        if kind == "ble":
            assert isinstance(device, DiscoveredDevice)
            await self._ble.connect_device(device.address, device.name)
        else:
            assert isinstance(device, UsbDevice)
            await self._usb.connect_device(device)

    async def _do_disconnect(self) -> None:
        await self._ble.disconnect_device()
        await self._usb.disconnect_device()

    # ==================================================================
    # Window lifecycle
    # ==================================================================
    def closeEvent(self, event: QCloseEvent) -> None:  # type: ignore[override]
        # Fire-and-forget clean-up — we have to return from closeEvent
        # synchronously, but the event loop stays up briefly during app
        # teardown which is enough for bleak's disconnect to run.
        asyncio.ensure_future(self._do_disconnect())
        super().closeEvent(event)
