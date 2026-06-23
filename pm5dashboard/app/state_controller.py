"""Folds BLE/USB signal streams into a single RowingState snapshot.

Both clients emit the same-shaped `general_status` / `general_status_1`
/ `general_status_2` / `stroke_data` dicts. The controller owns a single
`RowingState` instance, applies each update in place, and re-emits a
`state_changed` signal that UI widgets subscribe to. Widgets therefore
don't care which transport the data came from — they only know about
`RowingState`.

The controller also owns the live force-curve buffer and previous-
stroke history so widgets can render smooth curves without doing their
own book-keeping.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from PySide6.QtCore import QObject, QTimer, Signal

from .pm5.ble_client import PM5BleClient
from .pm5.data_model import RowingState
from .pm5.usb_client import PM5UsbClient

log = logging.getLogger(__name__)


class StateController(QObject):
    state_changed = Signal(object)          # RowingState
    stroke_ended = Signal(object)           # RowingState (with updated curve)
    connection_state_changed = Signal(str)  # "disconnected" | "connecting" | "connected-ble" | "connected-usb"
    message = Signal(str, str)              # level, text — "info" | "warn" | "error"

    def __init__(self, ble: PM5BleClient, usb: PM5UsbClient) -> None:
        super().__init__()
        self._ble = ble
        self._usb = usb
        self._state = RowingState()
        self._connection_mode: str = ""  # "ble" or "usb"

        # Publish coalesced state updates at ~60Hz so incoming bursts of
        # notifications don't cause redundant widget refreshes.
        self._emit_timer = QTimer(self)
        self._emit_timer.setInterval(16)
        self._emit_timer.setSingleShot(True)
        self._emit_timer.timeout.connect(self._flush_state)
        self._dirty = False

        self._wire_ble()
        self._wire_usb()

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------
    @property
    def state(self) -> RowingState:
        return self._state

    def reset(self) -> None:
        self._state = RowingState()
        self._mark_dirty()

    # ------------------------------------------------------------------
    # Wiring
    # ------------------------------------------------------------------
    def _wire_ble(self) -> None:
        self._ble.device_connected.connect(self._on_ble_connected)
        self._ble.device_disconnected.connect(self._on_disconnected)
        self._ble.connecting.connect(lambda *_: self.connection_state_changed.emit("connecting"))
        self._ble.error.connect(lambda msg: self.message.emit("error", msg))

        self._ble.general_status.connect(self._apply_general_status)
        self._ble.general_status_1.connect(self._apply_general_status_1)
        self._ble.general_status_2.connect(self._apply_general_status_2)
        self._ble.stroke_data.connect(self._apply_stroke_data)
        self._ble.force_sample.connect(self._apply_force_sample)
        self._ble.stroke_ended.connect(self._apply_stroke_ended)
        self._ble.stroke_started.connect(self._apply_stroke_started)

    def _wire_usb(self) -> None:
        self._usb.device_connected.connect(self._on_usb_connected)
        self._usb.device_disconnected.connect(self._on_disconnected)
        self._usb.connecting.connect(lambda *_: self.connection_state_changed.emit("connecting"))
        self._usb.error.connect(lambda msg: self.message.emit("error", msg))

        self._usb.general_status.connect(self._apply_general_status)
        self._usb.general_status_1.connect(self._apply_general_status_1)
        self._usb.general_status_2.connect(self._apply_general_status_2)

    # ------------------------------------------------------------------
    # Connection state
    # ------------------------------------------------------------------
    def _on_ble_connected(self, _address: str, name: str) -> None:
        self._connection_mode = "ble"
        self.connection_state_changed.emit("connected-ble")
        self.message.emit("info", f"Connected to {name} over Bluetooth")

    def _on_usb_connected(self, _serial: str, name: str) -> None:
        self._connection_mode = "usb"
        self.connection_state_changed.emit("connected-usb")
        self.message.emit("info",
                          f"Connected to {name} over USB  —  Force Curve, "
                          "Drive Length and Ratio require Bluetooth")

    def _on_disconnected(self, reason: str) -> None:
        self._connection_mode = ""
        self.connection_state_changed.emit("disconnected")
        self.message.emit("warn", reason)

    def connection_mode(self) -> str:
        return self._connection_mode

    # ------------------------------------------------------------------
    # Apply updates to the rowing state
    # ------------------------------------------------------------------
    def _apply_general_status(self, d: dict) -> None:
        s = self._state
        if "elapsed_time_s" in d:
            s.elapsed_time_s = d["elapsed_time_s"]
        if "distance_m" in d:
            s.distance_m = d["distance_m"]
        if "drag_factor" in d:
            s.drag_factor = d["drag_factor"] or s.drag_factor
        if "rowing_state" in d:
            s.rowing_state = d["rowing_state"]
        if "stroke_state" in d:
            s.stroke_state = d["stroke_state"]
        self._mark_dirty()

    def _apply_general_status_1(self, d: dict) -> None:
        s = self._state
        if "stroke_rate" in d:
            s.stroke_rate = d["stroke_rate"] or None
        if "heart_rate" in d:
            s.heart_rate = d["heart_rate"] or None
        if "current_pace_s" in d:
            s.pace_s_per_500m = d["current_pace_s"] or None
        if "average_pace_s" in d:
            s.average_pace_s = d["average_pace_s"] or None
        if "rest_time_s" in d:
            s.rest_time_s = d["rest_time_s"] or None
        self._mark_dirty()

    def _apply_general_status_2(self, d: dict) -> None:
        s = self._state
        if "average_power_w" in d:
            s.watts = d["average_power_w"] or None
        if "total_calories" in d:
            s.calories = d["total_calories"] or None
        if "split_avg_pace_s" in d:
            s.split_avg_pace_s = d["split_avg_pace_s"] or None
        if "split_avg_power_w" in d:
            s.split_avg_power_w = d["split_avg_power_w"] or None
        if "last_split_time_s" in d:
            s.last_split_time_s = d["last_split_time_s"] or None
        if "last_split_dist_m" in d:
            s.last_split_dist_m = d["last_split_dist_m"] or None
        if "interval_count" in d:
            s.interval_count = d["interval_count"]
        self._mark_dirty()

    def _apply_stroke_data(self, d: dict) -> None:
        s = self._state
        if "drive_length_m" in d:
            s.drive_length_m = d["drive_length_m"] or None
        if "drive_time_s" in d:
            s.drive_time_s = d["drive_time_s"] or None
        if "recovery_time_s" in d:
            s.recovery_time_s = d["recovery_time_s"] or None
        if "peak_force_lbs" in d:
            s.peak_force_lbs = d["peak_force_lbs"] or None
        if "average_force_lbs" in d:
            s.average_force_lbs = d["average_force_lbs"] or None
        if "work_per_stroke_j" in d:
            s.work_per_stroke_j = d["work_per_stroke_j"] or None
        if "stroke_count" in d:
            s.stroke_count = d["stroke_count"] or None
        self._mark_dirty()

    def _apply_stroke_started(self) -> None:
        self._state.live_force_curve = []
        self._mark_dirty()

    def _apply_force_sample(self, sample: float) -> None:
        self._state.live_force_curve.append(sample)
        self._mark_dirty()

    def _apply_stroke_ended(self, curve: List[float]) -> None:
        self._state.previous_force_curve = self._state.force_curve
        self._state.force_curve = list(curve)
        self._state.live_force_curve = []
        self._flush_state()
        self.stroke_ended.emit(self._state)

    # ------------------------------------------------------------------
    # Throttled emit
    # ------------------------------------------------------------------
    def _mark_dirty(self) -> None:
        self._dirty = True
        if not self._emit_timer.isActive():
            self._emit_timer.start()

    def _flush_state(self) -> None:
        if not self._dirty:
            return
        self._dirty = False
        self.state_changed.emit(self._state)
