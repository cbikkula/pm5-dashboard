"""PM5 Dashboard — single-file version.

A Windows desktop app that connects to a Concept2 PM5 performance monitor
and displays a live, athletic-looking workout dashboard focused on three
hero metrics: Force Curve (centre), Drive Length (right), Ratio (left).

This is the identical code as the multi-file `app/` package, flattened
into one file for easy sharing, reading and editing. The multi-file
version is the preferred day-to-day structure; this single-file copy
exists for quick deployment and study.

Run:
    pip install PySide6 qasync bleak pyqtgraph numpy hidapi
    python pm5dashboard.py

Units come from the PM5 as reported (seconds, metres, lbs-force, watts,
bpm). No mock data is generated anywhere — unavailable fields render
as "—".
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Union

import numpy as np
import pyqtgraph as pg
import qasync
from PySide6.QtCore import QObject, QRectF, QSize, QTimer, Qt, Signal
from PySide6.QtGui import (
    QBrush, QCloseEvent, QColor, QFont, QLinearGradient, QPainter, QPalette, QPen,
)
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QFrame, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMainWindow, QPushButton, QScrollArea, QSizePolicy, QTableWidget,
    QTableWidgetItem, QVBoxLayout, QWidget,
)

try:
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError
    BLEAK_AVAILABLE = True
except Exception:  # noqa: BLE001
    BleakClient = None        # type: ignore[assignment]
    BleakScanner = None       # type: ignore[assignment]
    BleakError = Exception    # type: ignore[assignment]
    BLEAK_AVAILABLE = False

try:
    import hid  # type: ignore[import-not-found]
    HID_AVAILABLE = True
except Exception:  # noqa: BLE001
    hid = None  # type: ignore[assignment]
    HID_AVAILABLE = False

log = logging.getLogger("pm5dashboard")
__app_name__ = "PM5 Dashboard"


# =====================================================================
# SECTION 1 — PM5 BLE UUIDs and USB constants
# =====================================================================
SERVICE_ROWING           = "ce060030-43e5-11e4-916c-0800200c9a66"
CHAR_GENERAL_STATUS      = "ce060031-43e5-11e4-916c-0800200c9a66"
CHAR_GENERAL_STATUS_1    = "ce060032-43e5-11e4-916c-0800200c9a66"
CHAR_GENERAL_STATUS_2    = "ce060033-43e5-11e4-916c-0800200c9a66"
CHAR_RATE_CONTROL        = "ce060034-43e5-11e4-916c-0800200c9a66"
CHAR_STROKE_DATA         = "ce060035-43e5-11e4-916c-0800200c9a66"
CHAR_FORCE_CURVE         = "ce06003d-43e5-11e4-916c-0800200c9a66"

RATE_1S    = 0
RATE_500MS = 1
RATE_250MS = 2
RATE_100MS = 3

USB_VID_CONCEPT2 = 0x17A4
USB_PIDS_PM5 = (0x0001, 0x0002, 0x0003, 0x0004)


# =====================================================================
# SECTION 2 — Byte-level parsers for PM5 BLE characteristics
# =====================================================================
def _u8(data: bytes, offset: int) -> int:
    return data[offset]


def _u16le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset + 2], "little", signed=False)


def _u24le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset + 3], "little", signed=False)


def parse_general_status(data: bytes) -> dict:
    if len(data) < 19:
        return {}
    return {
        "elapsed_time_s":    _u24le(data, 0) * 0.01,
        "distance_m":        _u24le(data, 3) * 0.1,
        "workout_type":      _u8(data, 6),
        "interval_type":     _u8(data, 7),
        "workout_state":     _u8(data, 8),
        "rowing_state":      _u8(data, 9),
        "stroke_state":      _u8(data, 10),
        "total_work_dist_m": _u24le(data, 11),
        "workout_duration":  _u24le(data, 14),
        "duration_type":     _u8(data, 17),
        "drag_factor":       _u8(data, 18),
    }


def parse_general_status_1(data: bytes) -> dict:
    if len(data) < 13:
        return {}
    return {
        "speed_m_s":        _u16le(data, 0) * 0.001,
        "stroke_rate":      _u8(data, 2),
        "heart_rate":       _u8(data, 3),
        "current_pace_s":   _u16le(data, 4) * 0.01,
        "average_pace_s":   _u16le(data, 6) * 0.01,
        "rest_distance_m":  _u16le(data, 8),
        "rest_time_s":      _u24le(data, 10) * 0.01,
    }


def parse_general_status_2(data: bytes) -> dict:
    if len(data) < 11:
        return {}
    out = {
        "interval_count":     _u8(data, 0),
        "average_power_w":    _u16le(data, 1),
        "total_calories":     _u16le(data, 3),
        "split_avg_pace_s":   _u16le(data, 5) * 0.01,
        "split_avg_power_w":  _u16le(data, 7),
        "split_avg_calories": _u16le(data, 9),
    }
    if len(data) >= 14:
        out["last_split_time_s"] = _u24le(data, 11) * 0.01
    if len(data) >= 17:
        out["last_split_dist_m"] = _u24le(data, 14)
    return out


def parse_stroke_data(data: bytes) -> dict:
    """0x0035 — drive length, drive time, recovery time + per-stroke forces.

    This is the characteristic that feeds the three hero metrics.
    """
    if len(data) < 19:
        return {}
    out = {
        "elapsed_time_s":    _u24le(data, 0) * 0.01,
        "distance_m":        _u24le(data, 3) * 0.1,
        "drive_length_m":    _u8(data, 6) * 0.01,
        "drive_time_s":      _u16le(data, 7) * 0.01,
        "recovery_time_s":   _u16le(data, 9) * 0.01,
        "stroke_distance_m": _u16le(data, 11) * 0.01,
        "peak_force_lbs":    _u16le(data, 13) * 0.1,
        "average_force_lbs": _u16le(data, 15) * 0.1,
        "work_per_stroke_j": _u16le(data, 17) * 0.1,
    }
    if len(data) >= 20:
        out["stroke_count"] = _u8(data, 19)
    return out


def parse_force_curve(data: bytes) -> Tuple[int, List[float]]:
    """0x003D — per-stroke force samples, streamed across multiple packets.

    Packet layout:
        byte 0: bits 7..4 = number of samples in this packet
                bits 3..0 = sequence number (0 == start of stroke)
        bytes 1..: little-endian uint16 samples, 0.1 lbf resolution.

    Returns (sequence_number, samples_in_lbs). Returns (-1, []) on empty.
    Some firmwares use 1-byte samples — we detect that by payload size.
    """
    if not data:
        return (-1, [])
    header = data[0]
    count = (header >> 4) & 0x0F
    sequence = header & 0x0F
    payload = data[1:]
    samples: List[float] = []
    if count > 0 and count * 2 <= len(payload):
        for i in range(count):
            raw = int.from_bytes(payload[i * 2: i * 2 + 2], "little")
            samples.append(raw * 0.1)
    elif count > 0:
        for i in range(min(count, len(payload))):
            samples.append(float(payload[i]))
    return (sequence, samples)


# =====================================================================
# SECTION 3 — RowingState (single source of truth for the UI)
# =====================================================================
@dataclass
class RowingState:
    # --- Three hero metrics -------------------------------------------
    drive_length_m: Optional[float] = None
    drive_time_s: Optional[float] = None
    recovery_time_s: Optional[float] = None
    force_curve: List[float] = field(default_factory=list)
    previous_force_curve: List[float] = field(default_factory=list)
    live_force_curve: List[float] = field(default_factory=list)

    # --- Secondary metrics --------------------------------------------
    stroke_rate: Optional[int] = None
    pace_s_per_500m: Optional[float] = None
    average_pace_s: Optional[float] = None
    watts: Optional[int] = None
    heart_rate: Optional[int] = None
    elapsed_time_s: Optional[float] = None
    distance_m: Optional[float] = None
    calories: Optional[int] = None
    drag_factor: Optional[int] = None
    stroke_count: Optional[int] = None
    peak_force_lbs: Optional[float] = None
    average_force_lbs: Optional[float] = None
    work_per_stroke_j: Optional[float] = None
    split_avg_pace_s: Optional[float] = None
    split_avg_power_w: Optional[int] = None
    last_split_time_s: Optional[float] = None
    last_split_dist_m: Optional[float] = None
    interval_count: Optional[int] = None
    rest_time_s: Optional[float] = None
    stroke_state: Optional[int] = None
    rowing_state: Optional[int] = None

    # Workout programming (from PM5 general status)
    workout_type: Optional[int] = None
    workout_state: Optional[int] = None
    workout_duration: Optional[int] = None
    workout_duration_type: Optional[int] = None
    total_work_dist_m: Optional[int] = None

    # User-set local workout. Overridden by any PM5-programmed workout
    # that's active. `local_plan` takes precedence over the simple
    # single-distance / single-time fields when present.
    local_target_dist_m: Optional[float] = None
    local_target_time_s: Optional[float] = None
    local_plan: Optional["WorkoutPlan"] = None

    # Per-interval progress capture — populated by the WorkoutTracker
    # as the user rows through `local_plan`.
    plan_current_idx: int = 0
    plan_start_time_s: Optional[float] = None
    plan_start_dist_m: Optional[float] = None
    plan_results: List["IntervalResult"] = field(default_factory=list)

    @property
    def ratio(self) -> Optional[float]:
        """Drive-to-recovery ratio (recovery_time / drive_time).

        This is the Concept2 "ratio" metric — a value of 2.5 means the
        recovery took 2.5× as long as the drive. Returns None when
        either half of the stroke hasn't been measured yet.
        """
        if self.drive_time_s and self.drive_time_s > 0 and self.recovery_time_s:
            return self.recovery_time_s / self.drive_time_s
        return None


# ---------------------------------------------------------------------
# Workout planning types
# ---------------------------------------------------------------------
@dataclass
class Interval:
    """One leg of a user-programmed workout.

    kind:
      - "distance" — `value` in metres
      - "time"     — `value` in seconds
    target_pace_s_per_500m: optional pace target (s/500m)
    target_watts: optional wattage target
    target_spm: optional stroke-rate target
    rest_s: rest following this interval, in seconds (0 = no rest)
    """
    kind: str = "distance"
    value: float = 0.0
    target_pace_s_per_500m: Optional[float] = None
    target_watts: Optional[int] = None
    target_spm: Optional[int] = None
    rest_s: float = 0.0

    def describe(self) -> str:
        if self.kind == "distance":
            body = f"{int(self.value)} m"
        elif self.kind == "time":
            body = fmt_time(self.value)
        else:
            body = f"{self.value} ?"
        if self.rest_s:
            body += f"  ·  rest {fmt_time(self.rest_s)}"
        return body


@dataclass
class WorkoutPlan:
    title: str = ""
    description: str = ""
    time_cap_s: Optional[float] = None
    intervals: List[Interval] = field(default_factory=list)

    def total_distance_m(self) -> float:
        return sum(i.value for i in self.intervals if i.kind == "distance")

    def total_time_s(self) -> float:
        return sum(i.value for i in self.intervals if i.kind == "time")

    def total_rest_s(self) -> float:
        return sum(i.rest_s for i in self.intervals)

    def homogeneous_unit(self) -> Optional[str]:
        """Return "distance" or "time" if every interval is that kind."""
        kinds = {i.kind for i in self.intervals}
        if len(kinds) == 1:
            return kinds.pop()
        return None

    def summary_line(self) -> str:
        n = len(self.intervals)
        if n == 0:
            return "(empty plan)"
        unit = self.homogeneous_unit()
        if unit and n > 1:
            identical = len({(i.value, i.rest_s) for i in self.intervals}) == 1
            if identical:
                first = self.intervals[0]
                return f"{n} × {first.describe()}"
        if n == 1:
            return self.intervals[0].describe()
        return f"{n} intervals"


@dataclass
class IntervalResult:
    """Stats captured when the user finishes one planned interval."""
    interval_idx: int = 0
    label: str = ""
    elapsed_s: float = 0.0
    distance_m: float = 0.0
    pace_s_per_500m: Optional[float] = None
    watts: Optional[int] = None
    stroke_rate: Optional[int] = None
    heart_rate: Optional[int] = None
    rest_s: float = 0.0
    drive_length_m: Optional[float] = None
    peak_force_lbs: Optional[float] = None


# =====================================================================
# SECTION 4 — BLE client (primary path)
# =====================================================================
@dataclass
class DiscoveredDevice:
    address: str
    name: str
    rssi: Optional[int] = None

    def label(self) -> str:
        rssi = f"  [{self.rssi} dBm]" if self.rssi is not None else ""
        return f"{self.name}  —  {self.address}{rssi}"


class PM5BleClient(QObject):
    """Bleak-based BLE client, Qt-signal-friendly.

    Notes on signal naming: we use `device_connected` / `device_disconnected`
    rather than `connected` / `disconnected` because PySide6's signal
    dispatch clashes when a QObject has *any* Signal alongside a method
    called `connect` (our API exposes `connect_device` / `disconnect_device`
    for the same reason).
    """

    scan_started = Signal()
    scan_finished = Signal(list)
    connecting = Signal(str)
    device_connected = Signal(str, str)
    device_disconnected = Signal(str)
    error = Signal(str)

    general_status = Signal(dict)
    general_status_1 = Signal(dict)
    general_status_2 = Signal(dict)
    stroke_data = Signal(dict)
    force_sample = Signal(float)
    stroke_started = Signal()
    stroke_ended = Signal(list)

    _KNOWN_PREFIXES = ("PM5", "Concept2", "PM ", "CII")

    def __init__(self) -> None:
        super().__init__()
        self._client: Optional[BleakClient] = None
        self._active_address = ""
        self._active_name = ""
        self._current_curve: List[float] = []
        self._last_seq: Optional[int] = None

    # --- scan ---------------------------------------------------------
    async def scan(self, timeout: float = 8.0) -> List[DiscoveredDevice]:
        if not BLEAK_AVAILABLE:
            self.error.emit("Bluetooth support is not available "
                            "(bleak failed to import)")
            self.scan_finished.emit([])
            return []
        self.scan_started.emit()
        found: List[DiscoveredDevice] = []
        try:
            devices = await BleakScanner.discover(timeout=timeout)
        except BleakError as exc:
            self.error.emit(f"Bluetooth scan failed: {exc}")
            self.scan_finished.emit([])
            return []
        except Exception as exc:  # noqa: BLE001
            self.error.emit(f"Bluetooth scan error: {exc}")
            self.scan_finished.emit([])
            return []
        for dev in devices:
            name = (dev.name or "").strip()
            if not name:
                continue
            if self._matches_pm5(name):
                found.append(DiscoveredDevice(
                    address=dev.address, name=name,
                    rssi=getattr(dev, "rssi", None),
                ))
        self.scan_finished.emit(found)
        return found

    @classmethod
    def _matches_pm5(cls, name: str) -> bool:
        if "pm5" in name.lower():
            return True
        return any(name.startswith(p) for p in cls._KNOWN_PREFIXES)

    # --- connect ------------------------------------------------------
    async def connect_device(self, address: str, name: str = "") -> bool:
        if not BLEAK_AVAILABLE:
            self.error.emit("Bluetooth support is not available")
            return False
        await self.disconnect_device()
        self._active_address = address
        self._active_name = name or address
        self.connecting.emit(address)
        try:
            self._client = BleakClient(address, disconnected_callback=self._handle_disconnect)
            await self._client.connect(timeout=20.0)
        except asyncio.TimeoutError:
            self.error.emit("Connection timed out — is the PM5 awake and in range?")
            self._client = None
            return False
        except BleakError as exc:
            self.error.emit(f"Bluetooth connection failed: {exc}")
            self._client = None
            return False
        except Exception as exc:  # noqa: BLE001
            self.error.emit(f"Unexpected error while connecting: {exc}")
            self._client = None
            return False

        if self._client is None or not self._client.is_connected:
            self.error.emit("Could not establish a Bluetooth session with the PM5")
            self._client = None
            return False

        try:
            await self._configure_session()
        except Exception as exc:  # noqa: BLE001
            self.error.emit(f"PM5 connected but data subscription failed: {exc}")
            await self._safe_disconnect()
            return False

        self.device_connected.emit(address, self._active_name)
        return True

    async def disconnect_device(self) -> None:
        await self._safe_disconnect()

    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    async def _safe_disconnect(self) -> None:
        client = self._client
        self._client = None
        if client is None:
            return
        try:
            if client.is_connected:
                await client.disconnect()
        except Exception as exc:  # noqa: BLE001
            log.info("Ignoring error during disconnect: %s", exc)

    def _handle_disconnect(self, _client) -> None:
        if self._client is not None:
            self._client = None
            self.device_disconnected.emit("PM5 disconnected")

    # --- session ------------------------------------------------------
    async def _configure_session(self) -> None:
        # Best-effort: ask for 250 ms sample rate. Some firmwares refuse
        # the write, which is fine — we fall back to their default.
        try:
            await self._client.write_gatt_char(
                CHAR_RATE_CONTROL, bytes([RATE_250MS]), response=True,
            )
        except Exception as exc:  # noqa: BLE001
            log.info("Could not set sample rate (non-fatal): %s", exc)

        subs = [
            (CHAR_GENERAL_STATUS,   self._on_general_status),
            (CHAR_GENERAL_STATUS_1, self._on_general_status_1),
            (CHAR_GENERAL_STATUS_2, self._on_general_status_2),
            (CHAR_STROKE_DATA,      self._on_stroke_data),
            (CHAR_FORCE_CURVE,      self._on_force_curve),
        ]
        failures = 0
        for uuid, cb in subs:
            try:
                await self._client.start_notify(uuid, cb)
            except Exception as exc:  # noqa: BLE001
                log.warning("Subscription failed for %s: %s", uuid, exc)
                failures += 1
        if failures == len(subs):
            raise RuntimeError("No PM5 characteristics could be subscribed")

    # --- notification handlers ----------------------------------------
    def _on_general_status(self, _s, data: bytearray) -> None:
        d = parse_general_status(bytes(data))
        if d:
            self.general_status.emit(d)

    def _on_general_status_1(self, _s, data: bytearray) -> None:
        d = parse_general_status_1(bytes(data))
        if d:
            self.general_status_1.emit(d)

    def _on_general_status_2(self, _s, data: bytearray) -> None:
        d = parse_general_status_2(bytes(data))
        if d:
            self.general_status_2.emit(d)

    def _on_stroke_data(self, _s, data: bytearray) -> None:
        d = parse_stroke_data(bytes(data))
        if not d:
            return
        self.stroke_data.emit(d)
        # Authoritative end-of-stroke: flush the accumulated curve.
        if self._current_curve:
            self.stroke_ended.emit(list(self._current_curve))
            self._current_curve = []
            self._last_seq = None

    def _on_force_curve(self, _s, data: bytearray) -> None:
        seq, samples = parse_force_curve(bytes(data))
        if seq < 0:
            return
        if seq == 0:
            if self._current_curve:
                self.stroke_ended.emit(list(self._current_curve))
            self._current_curve = []
            self.stroke_started.emit()
        self._last_seq = seq
        for s in samples:
            self._current_curve.append(s)
            self.force_sample.emit(s)


# =====================================================================
# SECTION 5 — USB HID fallback (CSAFE over hidapi)
# =====================================================================
# CSAFE framing bytes and command codes. Only the standard long-get
# commands for scalar metrics are implemented here — the force curve
# and drive/recovery timings require PM-vendor-extension CSAFE frames
# that are intentionally out of scope (see module docstring).
CSAFE_EXT_FRAME_START_BYTE = 0xF0
CSAFE_STD_FRAME_START_BYTE = 0xF1
CSAFE_FRAME_END_BYTE       = 0xF2
CSAFE_FRAME_STUFF_BYTE     = 0xF3

CSAFE_GETTIME    = 0xA0
CSAFE_GETHORIZ   = 0xA1
CSAFE_GETCALS    = 0xA3
CSAFE_GETPACE    = 0xA6
CSAFE_GETCADENCE = 0xA7
CSAFE_GETHRCUR   = 0xB0
CSAFE_GETPOWER   = 0xB4
CSAFE_GOINUSE    = 0x85

HID_REPORT_SIZE = 64
HID_REPORT_ID   = 0x01


@dataclass
class UsbDevice:
    path: bytes
    vendor_id: int
    product_id: int
    serial: str
    product: str

    def label(self) -> str:
        return f"{self.product or 'PM5'}  —  S/N {self.serial or '?'}  (USB)"


def _byte_stuff(frame: List[int]) -> List[int]:
    out: List[int] = []
    for b in frame:
        if b in (CSAFE_EXT_FRAME_START_BYTE, CSAFE_STD_FRAME_START_BYTE,
                 CSAFE_FRAME_END_BYTE, CSAFE_FRAME_STUFF_BYTE):
            out.append(CSAFE_FRAME_STUFF_BYTE)
            out.append(b & 0x03)
        else:
            out.append(b)
    return out


def _byte_unstuff(frame: List[int]) -> List[int]:
    out: List[int] = []
    i = 0
    while i < len(frame):
        b = frame[i]
        if b == CSAFE_FRAME_STUFF_BYTE and i + 1 < len(frame):
            nxt = frame[i + 1]
            out.append(CSAFE_EXT_FRAME_START_BYTE | (nxt & 0x03))
            i += 2
        else:
            out.append(b)
            i += 1
    return out


def _make_csafe_frame(commands: List[List[int]]) -> bytes:
    body: List[int] = []
    for cmd in commands:
        body.extend(cmd)
    checksum = 0
    for b in body:
        checksum ^= b
    body.append(checksum)
    stuffed = _byte_stuff(body)
    return bytes([CSAFE_STD_FRAME_START_BYTE] + stuffed + [CSAFE_FRAME_END_BYTE])


def _parse_csafe_frame(raw: bytes) -> List[int]:
    data = list(raw)
    while data and data[0] not in (CSAFE_STD_FRAME_START_BYTE,
                                    CSAFE_EXT_FRAME_START_BYTE):
        data.pop(0)
        if not data:
            return []
    try:
        end_idx = data.index(CSAFE_FRAME_END_BYTE, 1)
    except ValueError:
        return []
    body = _byte_unstuff(data[1:end_idx])
    if not body:
        return []
    return body[:-1]  # drop checksum


def _parse_cmd_responses(body: List[int]) -> dict:
    out: dict = {}
    i = 0
    while i < len(body) and body[i] < 0x80:
        i += 1  # skip leading status byte(s)
    while i < len(body):
        cmd = body[i]
        i += 1
        if i >= len(body):
            break
        length = body[i]
        i += 1
        if length > len(body) - i:
            break
        out[cmd] = body[i:i + length]
        i += length
    return out


def enumerate_pm5_usb() -> List[UsbDevice]:
    if not HID_AVAILABLE:
        return []
    out: List[UsbDevice] = []
    try:
        for info in hid.enumerate(USB_VID_CONCEPT2, 0):
            pid = info.get("product_id", 0)
            if pid not in USB_PIDS_PM5:
                continue
            out.append(UsbDevice(
                path=info.get("path", b""),
                vendor_id=info.get("vendor_id", 0),
                product_id=pid,
                serial=info.get("serial_number", "") or "",
                product=info.get("product_string", "PM5") or "PM5",
            ))
    except Exception as exc:  # noqa: BLE001
        log.warning("hid.enumerate failed: %s", exc)
    return out


class PM5UsbClient(QObject):
    scan_finished = Signal(list)
    connecting = Signal(str)
    device_connected = Signal(str, str)
    device_disconnected = Signal(str)
    error = Signal(str)

    general_status = Signal(dict)
    general_status_1 = Signal(dict)
    general_status_2 = Signal(dict)

    def __init__(self) -> None:
        super().__init__()
        self._dev = None
        self._active_path: Optional[bytes] = None
        self._active_name = ""
        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(250)
        self._poll_timer.timeout.connect(self._poll_once)

    def is_connected(self) -> bool:
        return self._dev is not None

    async def scan(self) -> List[UsbDevice]:
        devices = enumerate_pm5_usb()
        self.scan_finished.emit(devices)
        return devices

    async def connect_device(self, device: UsbDevice) -> bool:
        if not HID_AVAILABLE:
            self.error.emit("USB support not available (hidapi failed to load)")
            return False
        self.connecting.emit(device.serial or device.product)
        try:
            dev = hid.device()
            dev.open_path(device.path)
            dev.set_nonblocking(True)
        except Exception as exc:  # noqa: BLE001
            self.error.emit(f"USB open failed: {exc}")
            return False
        self._dev = dev
        self._active_path = device.path
        self._active_name = device.product or "PM5 (USB)"
        try:
            self._write_frame(_make_csafe_frame([[CSAFE_GOINUSE]]))
            await asyncio.sleep(0.05)
            self._read_frame(timeout_ms=50)
        except Exception as exc:  # noqa: BLE001
            log.debug("Ignoring CSAFE_GOINUSE error: %s", exc)
        self._poll_timer.start()
        self.device_connected.emit(device.serial or "", self._active_name)
        return True

    async def disconnect_device(self) -> None:
        self._poll_timer.stop()
        dev = self._dev
        self._dev = None
        if dev is not None:
            try:
                dev.close()
            except Exception:  # noqa: BLE001
                pass
        self.device_disconnected.emit("USB disconnected")

    # --- framing / IO -------------------------------------------------
    def _write_frame(self, frame: bytes) -> None:
        if self._dev is None:
            return
        report = bytes([HID_REPORT_ID]) + frame
        if len(report) < HID_REPORT_SIZE + 1:
            report += bytes(HID_REPORT_SIZE + 1 - len(report))
        else:
            report = report[: HID_REPORT_SIZE + 1]
        self._dev.write(report)

    def _read_frame(self, timeout_ms: int = 50) -> List[int]:
        if self._dev is None:
            return []
        try:
            raw = self._dev.read(HID_REPORT_SIZE + 1, timeout_ms)
        except Exception as exc:  # noqa: BLE001
            log.debug("USB read failed: %s", exc)
            return []
        if not raw:
            return []
        data = bytes(raw)
        if data and data[0] == HID_REPORT_ID:
            data = data[1:]
        return _parse_csafe_frame(data)

    def _poll_once(self) -> None:
        if self._dev is None:
            return
        try:
            frame = _make_csafe_frame([
                [CSAFE_GETTIME], [CSAFE_GETHORIZ], [CSAFE_GETCADENCE],
                [CSAFE_GETPACE], [CSAFE_GETHRCUR], [CSAFE_GETPOWER],
                [CSAFE_GETCALS],
            ])
            self._write_frame(frame)
            body = self._read_frame(timeout_ms=40)
            if not body:
                return
            self._emit_status_from_csafe(_parse_cmd_responses(body))
        except Exception as exc:  # noqa: BLE001
            log.debug("CSAFE poll error: %s", exc)

    def _emit_status_from_csafe(self, resp: dict) -> None:
        status: dict = {}
        status1: dict = {}
        status2: dict = {}
        t = resp.get(CSAFE_GETTIME, [])
        if len(t) >= 3:
            status["elapsed_time_s"] = t[0] * 3600 + t[1] * 60 + t[2]
        horiz = resp.get(CSAFE_GETHORIZ, [])
        if len(horiz) >= 3:
            status["distance_m"] = float(horiz[0] | (horiz[1] << 8) | (horiz[2] << 16))
        cadence = resp.get(CSAFE_GETCADENCE, [])
        if len(cadence) >= 2:
            status1["stroke_rate"] = cadence[0] | (cadence[1] << 8)
        pace = resp.get(CSAFE_GETPACE, [])
        if len(pace) >= 2:
            raw = pace[0] | (pace[1] << 8)
            if raw > 0:
                status1["current_pace_s"] = float(raw)
        hr = resp.get(CSAFE_GETHRCUR, [])
        if len(hr) >= 2:
            status1["heart_rate"] = hr[0] | (hr[1] << 8)
        power = resp.get(CSAFE_GETPOWER, [])
        if len(power) >= 2:
            status2["average_power_w"] = power[0] | (power[1] << 8)
        cals = resp.get(CSAFE_GETCALS, [])
        if len(cals) >= 2:
            status2["total_calories"] = cals[0] | (cals[1] << 8)
        if status:
            self.general_status.emit(status)
        if status1:
            self.general_status_1.emit(status1)
        if status2:
            self.general_status_2.emit(status2)


# =====================================================================
# SECTION 6 — StateController: folds BLE + USB into one RowingState
# =====================================================================
class StateController(QObject):
    state_changed = Signal(object)
    stroke_ended = Signal(object)
    connection_state_changed = Signal(str)
    message = Signal(str, str)

    def __init__(self, ble: PM5BleClient, usb: PM5UsbClient) -> None:
        super().__init__()
        self._ble = ble
        self._usb = usb
        self._state = RowingState()
        self._connection_mode = ""
        self._emit_timer = QTimer(self)
        self._emit_timer.setInterval(16)
        self._emit_timer.setSingleShot(True)
        self._emit_timer.timeout.connect(self._flush_state)
        self._dirty = False
        self._wire_ble()
        self._wire_usb()

    @property
    def state(self) -> RowingState:
        return self._state

    def connection_mode(self) -> str:
        return self._connection_mode

    def reset(self) -> None:
        self._state = RowingState()
        self._mark_dirty()

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

    def _apply_general_status(self, d: dict) -> None:
        s = self._state
        if "elapsed_time_s" in d: s.elapsed_time_s = d["elapsed_time_s"]
        if "distance_m" in d: s.distance_m = d["distance_m"]
        if "drag_factor" in d: s.drag_factor = d["drag_factor"] or s.drag_factor
        if "rowing_state" in d: s.rowing_state = d["rowing_state"]
        if "stroke_state" in d: s.stroke_state = d["stroke_state"]
        if "workout_type" in d: s.workout_type = d["workout_type"]
        if "workout_state" in d: s.workout_state = d["workout_state"]
        if "workout_duration" in d: s.workout_duration = d["workout_duration"]
        if "duration_type" in d: s.workout_duration_type = d["duration_type"]
        if "total_work_dist_m" in d: s.total_work_dist_m = d["total_work_dist_m"] or None
        self._mark_dirty()

    def _apply_general_status_1(self, d: dict) -> None:
        s = self._state
        if "stroke_rate" in d: s.stroke_rate = d["stroke_rate"] or None
        if "heart_rate" in d: s.heart_rate = d["heart_rate"] or None
        if "current_pace_s" in d: s.pace_s_per_500m = d["current_pace_s"] or None
        if "average_pace_s" in d: s.average_pace_s = d["average_pace_s"] or None
        if "rest_time_s" in d: s.rest_time_s = d["rest_time_s"] or None
        self._mark_dirty()

    def _apply_general_status_2(self, d: dict) -> None:
        s = self._state
        if "average_power_w" in d: s.watts = d["average_power_w"] or None
        if "total_calories" in d: s.calories = d["total_calories"] or None
        if "split_avg_pace_s" in d: s.split_avg_pace_s = d["split_avg_pace_s"] or None
        if "split_avg_power_w" in d: s.split_avg_power_w = d["split_avg_power_w"] or None
        if "last_split_time_s" in d: s.last_split_time_s = d["last_split_time_s"] or None
        if "last_split_dist_m" in d: s.last_split_dist_m = d["last_split_dist_m"] or None
        if "interval_count" in d: s.interval_count = d["interval_count"]
        self._mark_dirty()

    def _apply_stroke_data(self, d: dict) -> None:
        s = self._state
        if "drive_length_m" in d: s.drive_length_m = d["drive_length_m"] or None
        if "drive_time_s" in d: s.drive_time_s = d["drive_time_s"] or None
        if "recovery_time_s" in d: s.recovery_time_s = d["recovery_time_s"] or None
        if "peak_force_lbs" in d: s.peak_force_lbs = d["peak_force_lbs"] or None
        if "average_force_lbs" in d: s.average_force_lbs = d["average_force_lbs"] or None
        if "work_per_stroke_j" in d: s.work_per_stroke_j = d["work_per_stroke_j"] or None
        if "stroke_count" in d: s.stroke_count = d["stroke_count"] or None
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

    def _mark_dirty(self) -> None:
        self._dirty = True
        if not self._emit_timer.isActive():
            self._emit_timer.start()

    def _flush_state(self) -> None:
        if not self._dirty:
            return
        self._dirty = False
        # Advance the local plan tracker (no-op if no plan is set). This
        # may append to plan_results when the user crosses an interval
        # boundary.
        _advance_plan_tracker(self._state)
        self.state_changed.emit(self._state)


# =====================================================================
# SECTION 7 — Theme, formatting helpers
# =====================================================================
COLOR_BG_BASE       = "#0b0d12"
COLOR_BG_PANEL      = "#131722"
COLOR_BG_PANEL_HI   = "#1a1f2e"
COLOR_BG_CARD       = "#161b28"
COLOR_BORDER        = "#222838"
COLOR_BORDER_BRIGHT = "#2c3550"
COLOR_TEXT_PRIMARY   = "#e8ecf3"
COLOR_TEXT_SECONDARY = "#9ba7bd"
COLOR_TEXT_MUTED     = "#6b7793"
COLOR_ACCENT   = "#4cc2ff"  # cyan — force curve
COLOR_ACCENT_2 = "#ff8f3c"  # amber — drive length
COLOR_ACCENT_3 = "#56f9b3"  # mint — ratio
COLOR_ACCENT_WARN    = "#ff6b6b"
COLOR_STATUS_CONNECTED    = "#56f9b3"
COLOR_STATUS_CONNECTING   = "#ffcc55"
COLOR_STATUS_DISCONNECTED = "#6b7793"
COLOR_STATUS_ERROR        = "#ff6b6b"
COLOR_CURVE_CURRENT  = "#4cc2ff"

STYLESHEET = f"""
* {{
    font-family: "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif;
    color: {COLOR_TEXT_PRIMARY};
}}
QWidget#AppRoot {{ background-color: {COLOR_BG_BASE}; }}
QFrame[role="panel"] {{
    background-color: {COLOR_BG_PANEL};
    border: 1px solid {COLOR_BORDER};
    border-radius: 14px;
}}
QFrame[role="card"] {{
    background-color: {COLOR_BG_CARD};
    border: 1px solid {COLOR_BORDER};
    border-radius: 10px;
}}
QFrame[role="hero"] {{
    background-color: {COLOR_BG_PANEL};
    border: 1px solid {COLOR_BORDER_BRIGHT};
    border-radius: 16px;
}}
QLabel[role="card-label"] {{
    color: {COLOR_TEXT_MUTED}; font-size: 10px;
    font-weight: 600; letter-spacing: 1.5px;
}}
QLabel[role="card-value"] {{
    color: {COLOR_TEXT_PRIMARY}; font-size: 24px; font-weight: 600;
}}
QLabel[role="card-unit"] {{
    color: {COLOR_TEXT_SECONDARY}; font-size: 11px; font-weight: 500;
}}
QLabel[role="hero-value"] {{
    color: {COLOR_TEXT_PRIMARY}; font-size: 96px; font-weight: 700;
}}
QLabel[role="hero-label"] {{
    color: {COLOR_TEXT_MUTED}; font-size: 12px;
    font-weight: 700; letter-spacing: 3px;
}}
QLabel[role="hero-unit"] {{
    color: {COLOR_TEXT_SECONDARY}; font-size: 16px; font-weight: 500;
}}
QLabel[role="ratio-sub"] {{ color: {COLOR_TEXT_SECONDARY}; font-size: 13px; }}
QLabel[role="status"] {{ color: {COLOR_TEXT_SECONDARY}; font-size: 13px; }}
QLabel[role="title-big"] {{
    color: {COLOR_TEXT_PRIMARY}; font-size: 16px;
    font-weight: 700; letter-spacing: 2px;
}}
QPushButton {{
    background-color: {COLOR_BG_PANEL_HI};
    color: {COLOR_TEXT_PRIMARY};
    border: 1px solid {COLOR_BORDER_BRIGHT};
    border-radius: 8px; padding: 7px 18px;
    font-size: 13px; font-weight: 600;
}}
QPushButton:hover {{ background-color: #222a40; border-color: {COLOR_ACCENT}; }}
QPushButton:pressed {{ background-color: #1a2030; }}
QPushButton:disabled {{ color: {COLOR_TEXT_MUTED}; border-color: {COLOR_BORDER}; }}
QPushButton[accent="true"] {{
    background-color: {COLOR_ACCENT}; color: #0b0d12;
    border: 1px solid {COLOR_ACCENT};
}}
QPushButton[accent="true"]:hover {{ background-color: #6cd2ff; }}
QPushButton[accent="true"]:disabled {{
    background-color: #2c3550; color: {COLOR_TEXT_MUTED};
    border-color: {COLOR_BORDER};
}}
QListWidget {{
    background-color: {COLOR_BG_BASE};
    border: 1px solid {COLOR_BORDER};
    border-radius: 8px; padding: 4px; outline: 0;
}}
QListWidget::item {{ padding: 8px 10px; border-radius: 6px; color: {COLOR_TEXT_PRIMARY}; }}
QListWidget::item:selected {{ background-color: #1e2a42; color: {COLOR_TEXT_PRIMARY}; }}
QListWidget::item:hover:!selected {{ background-color: #161d2e; }}
QDialog {{ background-color: {COLOR_BG_BASE}; }}
QToolTip {{
    background-color: {COLOR_BG_PANEL_HI}; color: {COLOR_TEXT_PRIMARY};
    border: 1px solid {COLOR_BORDER_BRIGHT}; padding: 6px 8px;
}}
QScrollBar:vertical {{ background: {COLOR_BG_BASE}; width: 10px; margin: 0; }}
QScrollBar::handle:vertical {{
    background: {COLOR_BORDER_BRIGHT}; border-radius: 4px; min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{ background: #3a466a; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
"""


def fmt_time(seconds: Optional[float]) -> str:
    if seconds is None or seconds < 0:
        return "—"
    seconds = float(seconds)
    if seconds >= 3600:
        h = int(seconds // 3600); m = int((seconds % 3600) // 60); s = seconds % 60
        return f"{h}:{m:02d}:{s:04.1f}"
    m = int(seconds // 60); s = seconds - (m * 60)
    return f"{m}:{s:04.1f}" if m else f"{s:0.1f}"


def fmt_pace(pace_s: Optional[float]) -> str:
    if pace_s is None or pace_s <= 0 or pace_s > 3600:
        return "—"
    m = int(pace_s // 60); s = pace_s - (m * 60)
    return f"{m}:{s:04.1f}"


def fmt_distance(metres: Optional[float]) -> str:
    if metres is None or metres < 0:
        return "—"
    if metres >= 1000:
        return f"{metres / 1000:,.2f}"
    return f"{metres:,.0f}"


def fmt_int(value: Optional[float]) -> str:
    if value is None:
        return "—"
    try:
        return f"{int(round(value)):,}"
    except (ValueError, TypeError):
        return "—"


def fmt_float(value: Optional[float], digits: int = 1) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


# =====================================================================
# SECTION 8 — Widgets
# =====================================================================
class MetricCard(QFrame):
    def __init__(self, label: str, unit: str = "", parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "card")
        self.setMinimumWidth(150)
        self.setMinimumHeight(88)
        self._label = QLabel(label.upper())
        self._label.setProperty("role", "card-label")
        self._value = QLabel("—")
        self._value.setProperty("role", "card-value")
        self._value.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self._unit = QLabel(unit)
        self._unit.setProperty("role", "card-unit")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(16, 12, 16, 12)
        lay.setSpacing(2)
        lay.addWidget(self._label)
        lay.addWidget(self._value)
        lay.addWidget(self._unit)

    def set_value(self, value: Optional[str]) -> None:
        self._value.setText(value if value is not None else "—")

    def set_unit(self, unit: str) -> None:
        self._unit.setText(unit)


class ForceCurveWidget(QFrame):
    # Aspect ratio of the PM5's native force-curve graphic (≈ 2.5:1).
    PLOT_ASPECT = 2.5
    # Extra vertical space for the title row and the widget's own margins.
    _HEADER_PX = 54
    _V_MARGIN_PX = 32
    _H_MARGIN_PX = 40

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")
        pg.setConfigOptions(antialias=True, useOpenGL=False)
        title = QLabel("FORCE CURVE")
        title.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; letter-spacing: 4px; font-weight: 700;"
        )
        self._hint = QLabel("waiting for first stroke…")
        self._hint.setProperty("role", "ratio-sub")
        self._hint.setAlignment(Qt.AlignmentFlag.AlignRight)
        header = QVBoxLayout()
        header.setSpacing(2)
        header.addWidget(title)
        header.addWidget(self._hint)
        self._plot = pg.PlotWidget()
        self._plot.setBackground(QColor(COLOR_BG_PANEL))
        self._plot.setMouseEnabled(x=False, y=False)
        self._plot.setMenuEnabled(False)
        self._plot.hideButtons()
        self._plot.showGrid(x=True, y=True, alpha=0.08)
        axis_pen = pg.mkPen(QColor(COLOR_BORDER_BRIGHT))
        text_pen = pg.mkPen(QColor(COLOR_TEXT_MUTED))
        font = QFont(); font.setPointSize(9)
        for axis in (self._plot.getAxis("left"), self._plot.getAxis("bottom")):
            axis.setPen(axis_pen)
            axis.setTextPen(text_pen)
            axis.setStyle(tickFont=font, tickLength=-6, tickTextOffset=8)
        self._plot.getAxis("left").setLabel(
            "Force", units="lbf",
            **{"color": COLOR_TEXT_MUTED, "font-size": "10pt"},
        )
        self._plot.getAxis("bottom").setLabel(
            "Stroke progress",
            **{"color": COLOR_TEXT_MUTED, "font-size": "10pt"},
        )
        self._prev_curve = self._plot.plot(
            [], [],
            pen=pg.mkPen(QColor(76, 194, 255, 85), width=2),
        )
        self._curr_curve = self._plot.plot(
            [], [],
            pen=pg.mkPen(QColor(COLOR_CURVE_CURRENT), width=3, cosmetic=True),
            fillLevel=0.0, fillBrush=QBrush(QColor(76, 194, 255, 40)),
        )
        self._plot.setXRange(0, 40, padding=0.02)
        self._plot.setYRange(0, 220, padding=0.02)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 16, 20, 16)
        lay.setSpacing(8)
        lay.addLayout(header)
        lay.addWidget(self._plot, 1)

    def resizeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        super().resizeEvent(event)
        # Cap our total height so the bottom border of the panel sits
        # right under the "Stroke progress" axis label — no dead space
        # below the graph.
        inner_w = max(0, self.width() - self._H_MARGIN_PX)
        if inner_w <= 0:
            return
        target = int(inner_w / self.PLOT_ASPECT) + self._HEADER_PX + self._V_MARGIN_PX
        if target != self.maximumHeight():
            self.setMaximumHeight(target)

    def set_hint(self, text: str) -> None:
        self._hint.setText(text)

    def update_curves(self, live: List[float], previous: List[float]) -> None:
        if live:
            xs = np.arange(len(live), dtype=np.float32)
            ys = np.asarray(live, dtype=np.float32)
            self._curr_curve.setData(xs, ys)
            y_peak = float(ys.max()) if len(ys) else 0.0
            self._plot.setXRange(0, max(40, len(live) + 4), padding=0.02)
            self._plot.setYRange(0, max(220.0, y_peak * 1.15), padding=0.02)
        else:
            self._curr_curve.setData([], [])
        if previous:
            xs = np.arange(len(previous), dtype=np.float32)
            self._prev_curve.setData(xs, np.asarray(previous, dtype=np.float32))
        else:
            self._prev_curve.setData([], [])


class _DriveLengthBar(QWidget):
    IDEAL_MIN = 1.30
    IDEAL_MAX = 1.55

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._value: Optional[float] = None
        self.setMinimumHeight(22)
        self.setMaximumHeight(22)

    def set_value(self, value: Optional[float]) -> None:
        self._value = value
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(1.5, 3.5, -1.5, -3.5)
        r = rect.height() / 2
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(COLOR_BG_CARD))
        p.drawRoundedRect(rect, r, r)
        ix1 = rect.left() + rect.width() * (self.IDEAL_MIN / 2.5)
        ix2 = rect.left() + rect.width() * (self.IDEAL_MAX / 2.5)
        p.setBrush(QColor(255, 143, 60, 55))
        p.drawRoundedRect(QRectF(ix1, rect.top(), ix2 - ix1, rect.height()), r, r)
        if self._value and self._value > 0:
            pct = min(self._value / 2.5, 1.0)
            grad = QLinearGradient(rect.left(), 0, rect.right(), 0)
            grad.setColorAt(0.0, QColor(255, 143, 60, 210))
            grad.setColorAt(1.0, QColor(255, 196, 120, 230))
            p.setBrush(grad)
            p.drawRoundedRect(
                QRectF(rect.left(), rect.top(), rect.width() * pct, rect.height()),
                r, r,
            )
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(COLOR_BORDER_BRIGHT), 1))
        p.drawRoundedRect(rect, r, r)


class DriveLengthWidget(QFrame):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")
        label = QLabel("DRIVE LENGTH")
        label.setProperty("role", "hero-label")
        self._value = QLabel("—")
        self._value.setProperty("role", "hero-value")
        self._value.setStyleSheet(f"color: {COLOR_ACCENT_2};")
        self._unit = QLabel("m")
        self._unit.setProperty("role", "hero-unit")
        self._unit.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY};")
        self._secondary = QLabel("— cm")
        self._secondary.setProperty("role", "ratio-sub")
        self._bar = _DriveLengthBar(self)
        self._scale = QLabel("0.0 m                                   2.5 m")
        self._scale.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; font-size: 10px; letter-spacing: 1.5px;"
        )
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 16, 20, 18)
        lay.setSpacing(4)
        lay.addWidget(label); lay.addStretch(1)
        lay.addWidget(self._value); lay.addWidget(self._unit)
        lay.addSpacing(4); lay.addWidget(self._secondary); lay.addStretch(1)
        lay.addWidget(self._bar); lay.addWidget(self._scale)

    def set_value(self, metres: Optional[float], available: bool = True) -> None:
        if not available:
            self._value.setText("—")
            self._secondary.setText("Bluetooth only")
            self._bar.set_value(None)
            return
        if metres is None or metres <= 0:
            self._value.setText("—")
            self._secondary.setText("awaiting stroke")
            self._bar.set_value(None)
            return
        self._value.setText(f"{metres:.2f}")
        self._secondary.setText(f"{metres * 100:.0f} cm")
        self._bar.set_value(metres)


class _RatioBar(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._drive: Optional[float] = None
        self._recovery: Optional[float] = None
        self.setMinimumHeight(34)
        self.setMaximumHeight(34)

    def set_times(self, drive_s: Optional[float], recovery_s: Optional[float]) -> None:
        self._drive = drive_s
        self._recovery = recovery_s
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(1, 8, -1, -8)
        r = rect.height() / 2
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(COLOR_BG_CARD))
        p.drawRoundedRect(rect, r, r)
        drive = self._drive or 0.0
        recovery = self._recovery or 0.0
        total = drive + recovery
        if total > 0:
            split_x = rect.left() + rect.width() * (drive / total)
            p.setBrush(QColor(86, 249, 179, 220))
            p.drawRoundedRect(
                QRectF(rect.left(), rect.top(), split_x - rect.left(), rect.height()),
                r, r,
            )
            p.setBrush(QColor(76, 194, 255, 190))
            p.drawRoundedRect(
                QRectF(split_x, rect.top(), rect.right() - split_x, rect.height()),
                r, r,
            )
            p.setPen(QPen(QColor(11, 13, 18, 200), 2))
            p.drawLine(split_x, rect.top() + 2, split_x, rect.bottom() - 2)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(COLOR_BORDER_BRIGHT), 1))
        p.drawRoundedRect(rect, r, r)
        p.setPen(QPen(QColor(COLOR_TEXT_MUTED)))
        lr = QRectF(self.rect())
        lr.setTop(rect.bottom() + 2); lr.setHeight(14)
        p.drawText(QRectF(lr.left() + 4, lr.top(), lr.width() / 2 - 4, lr.height()),
                   int(Qt.AlignmentFlag.AlignLeft), "DRIVE")
        p.drawText(QRectF(lr.left() + lr.width() / 2, lr.top(),
                          lr.width() / 2 - 4, lr.height()),
                   int(Qt.AlignmentFlag.AlignRight), "RECOVERY")


class RatioWidget(QFrame):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")
        label = QLabel("RATIO")
        label.setProperty("role", "hero-label")
        self._value = QLabel("—")
        self._value.setProperty("role", "hero-value")
        self._value.setStyleSheet(f"color: {COLOR_ACCENT_3};")
        self._unit = QLabel(": 1")
        self._unit.setProperty("role", "hero-unit")
        self._unit.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY};")
        self._sub = QLabel("drive vs recovery")
        self._sub.setProperty("role", "ratio-sub")
        self._times = QLabel("drive — · recovery —")
        self._times.setProperty("role", "ratio-sub")
        self._bar = _RatioBar(self)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 16, 20, 18)
        lay.setSpacing(4)
        lay.addWidget(label); lay.addStretch(1)
        lay.addWidget(self._value); lay.addWidget(self._unit)
        lay.addSpacing(4); lay.addWidget(self._sub); lay.addWidget(self._times)
        lay.addStretch(1); lay.addWidget(self._bar); lay.addSpacing(14)

    def set_ratio(self, ratio: Optional[float],
                  drive_s: Optional[float], recovery_s: Optional[float],
                  available: bool = True) -> None:
        if not available:
            self._value.setText("—")
            self._sub.setText("Bluetooth only")
            self._times.setText("")
            self._bar.set_times(None, None)
            return
        if ratio is None or ratio <= 0:
            self._value.setText("—")
            self._sub.setText("awaiting stroke")
            self._times.setText("drive — · recovery —")
            self._bar.set_times(None, None)
            return
        self._value.setText(f"{ratio:.1f}")
        self._sub.setText(self._describe(ratio))
        d_txt = f"{drive_s:.2f}s" if drive_s else "—"
        r_txt = f"{recovery_s:.2f}s" if recovery_s else "—"
        self._times.setText(f"drive {d_txt}  ·  recovery {r_txt}")
        self._bar.set_times(drive_s, recovery_s)

    @staticmethod
    def _describe(ratio: float) -> str:
        if ratio < 1.2:  return "rushing recovery — longer recovery advised"
        if ratio < 1.8:  return "short ratio"
        if ratio <= 2.6: return "in the usual coaching band"
        if ratio <= 3.2: return "long ratio"
        return "very long recovery"


class _ConnectionDot(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._color = QColor(COLOR_STATUS_DISCONNECTED)
        self.setFixedSize(14, 14)

    def set_color(self, color: str) -> None:
        self._color = QColor(color)
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(self._color.lighter(130))
        p.drawEllipse(1, 1, 12, 12)
        halo = QColor(self._color); halo.setAlpha(70)
        p.setBrush(halo)
        p.drawEllipse(-2, -2, 18, 18)


class StatusHeader(QFrame):
    connect_clicked = Signal()
    disconnect_clicked = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "panel")
        self.setFixedHeight(68)

        title = QLabel("PM5 DASHBOARD")
        title.setStyleSheet(
            f"color: {COLOR_TEXT_PRIMARY}; font-size: 17px;"
            f" font-weight: 700; letter-spacing: 6px;"
        )
        subtitle = QLabel("Concept2 ergometer monitor")
        subtitle.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; font-size: 10px; letter-spacing: 2px;"
        )
        self._dot = _ConnectionDot(self)
        self._status_label = QLabel("Not connected")
        self._status_label.setStyleSheet(
            f"color: {COLOR_TEXT_SECONDARY}; font-size: 13px; font-weight: 600;"
        )
        self._mode_label = QLabel("")
        self._mode_label.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; font-size: 11px; letter-spacing: 2px;"
        )
        self._connect_btn = QPushButton("Connect")
        self._connect_btn.setProperty("accent", "true")
        self._connect_btn.clicked.connect(self._on_btn_clicked)

        left_block = QWidget()
        lv = QHBoxLayout(left_block)
        lv.setContentsMargins(0, 0, 0, 0); lv.setSpacing(12)
        lv.addWidget(title); lv.addWidget(subtitle)

        right_block = QWidget()
        rv = QHBoxLayout(right_block)
        rv.setContentsMargins(0, 0, 0, 0); rv.setSpacing(12)
        rv.addWidget(self._dot, 0, Qt.AlignmentFlag.AlignVCenter)
        rv.addWidget(self._status_label, 0, Qt.AlignmentFlag.AlignVCenter)
        rv.addWidget(self._mode_label, 0, Qt.AlignmentFlag.AlignVCenter)
        rv.addSpacing(14); rv.addWidget(self._connect_btn)

        lay = QHBoxLayout(self)
        lay.setContentsMargins(22, 10, 22, 10)
        lay.addWidget(left_block, 0, Qt.AlignmentFlag.AlignVCenter)
        lay.addStretch(1)
        lay.addWidget(right_block, 0, Qt.AlignmentFlag.AlignVCenter)

        self.set_state("disconnected")

    def set_state(self, state: str, detail: str = "") -> None:
        self._state = state
        if state == "disconnected":
            self._dot.set_color(COLOR_STATUS_DISCONNECTED)
            self._status_label.setText(detail or "Not connected")
            self._mode_label.setText("")
            self._connect_btn.setText("Connect")
        elif state == "connecting":
            self._dot.set_color(COLOR_STATUS_CONNECTING)
            self._status_label.setText(detail or "Connecting…")
            self._mode_label.setText("")
            self._connect_btn.setText("Cancel")
        elif state == "connected-ble":
            self._dot.set_color(COLOR_STATUS_CONNECTED)
            self._status_label.setText(detail or "Connected")
            self._mode_label.setText("BLUETOOTH")
            self._connect_btn.setText("Disconnect")
        elif state == "connected-usb":
            self._dot.set_color(COLOR_STATUS_CONNECTED)
            self._status_label.setText(detail or "Connected")
            self._mode_label.setText("USB")
            self._connect_btn.setText("Disconnect")
        elif state == "error":
            self._dot.set_color(COLOR_STATUS_ERROR)
            self._status_label.setText(detail or "Error")
            self._connect_btn.setText("Connect")
        self._connect_btn.setEnabled(True)

    def _on_btn_clicked(self) -> None:
        if getattr(self, "_state", "disconnected") in ("connected-ble", "connected-usb"):
            self.disconnect_clicked.emit()
        else:
            self.connect_clicked.emit()


# =====================================================================
# SECTION 8b — Workout panel + target dialog
# =====================================================================
# PM5 workout type codes (from the Concept2 BLE spec — general status byte 6).
WTYPE_JUST_ROW_NO_SPLITS = 0
WTYPE_JUST_ROW_SPLITS    = 1
WTYPE_FIXED_DIST_NS      = 2
WTYPE_FIXED_DIST_SPLITS  = 3
WTYPE_FIXED_TIME_NS      = 4
WTYPE_FIXED_TIME_SPLITS  = 5
WTYPE_FIXED_TIME_INTERVAL     = 6
WTYPE_FIXED_DIST_INTERVAL     = 7
WTYPE_VARIABLE_INTERVAL       = 8
WTYPE_VARIABLE_UNDEFINED_REST = 9
WTYPE_FIXED_CAL               = 10
WTYPE_FIXED_WATTMIN           = 11
WTYPE_FIXED_CAL_INTERVAL      = 12

_DIST_WORKOUTS = {WTYPE_FIXED_DIST_NS, WTYPE_FIXED_DIST_SPLITS,
                  WTYPE_FIXED_DIST_INTERVAL}
_TIME_WORKOUTS = {WTYPE_FIXED_TIME_NS, WTYPE_FIXED_TIME_SPLITS,
                  WTYPE_FIXED_TIME_INTERVAL}
_INTERVAL_WORKOUTS = {WTYPE_FIXED_TIME_INTERVAL, WTYPE_FIXED_DIST_INTERVAL,
                      WTYPE_VARIABLE_INTERVAL, WTYPE_VARIABLE_UNDEFINED_REST,
                      WTYPE_FIXED_CAL_INTERVAL}


def _programmed_target(state: RowingState):
    """Returns (target_dist_m, target_time_s, description, is_interval, source)
    for the current workout target. `source` is "erg", "plan", "simple", or
    "none".
    """
    wt = state.workout_type
    dur = state.workout_duration or 0
    if wt in _DIST_WORKOUTS and dur > 0:
        return (float(dur), None, f"Fixed distance — {int(dur):,} m", False, "erg")
    if wt in _TIME_WORKOUTS and dur > 0:
        return (None, dur / 100.0,
                f"Fixed time — {fmt_time(dur / 100.0)}", False, "erg")
    if wt in _INTERVAL_WORKOUTS:
        return (None, None, "Interval workout (from erg)", True, "erg")
    if wt == WTYPE_FIXED_CAL and dur > 0:
        return (None, None, f"Fixed calories — {int(dur)}", False, "erg")

    # --- Local plan --------------------------------------------------
    plan = state.local_plan
    if plan and plan.intervals:
        unit = plan.homogeneous_unit()
        desc = plan.title or plan.summary_line()
        if unit == "distance":
            return (plan.total_distance_m(), None, desc, len(plan.intervals) > 1, "plan")
        if unit == "time":
            return (None, plan.total_time_s(), desc, len(plan.intervals) > 1, "plan")
        # Mixed kinds: no scalar progress, still track per-interval.
        return (None, None, desc, True, "plan")

    # --- Simple single target ---------------------------------------
    if state.local_target_dist_m:
        return (state.local_target_dist_m, None,
                f"Target distance — {int(state.local_target_dist_m):,} m", False, "simple")
    if state.local_target_time_s:
        return (None, state.local_target_time_s,
                f"Target time — {fmt_time(state.local_target_time_s)}", False, "simple")
    return (None, None, None, False, "none")


def _advance_plan_tracker(state: RowingState) -> bool:
    """Advance `plan_current_idx` if the current interval's quota is met.
    Appends to `plan_results` at each boundary. Returns True if an interval
    just completed.
    """
    plan = state.local_plan
    if not plan or not plan.intervals:
        return False
    if state.plan_current_idx >= len(plan.intervals):
        return False
    iv = plan.intervals[state.plan_current_idx]
    elapsed = state.elapsed_time_s or 0.0
    dist = state.distance_m or 0.0
    if state.plan_start_time_s is None:
        state.plan_start_time_s = elapsed
        state.plan_start_dist_m = dist
        return False

    leg_elapsed = elapsed - (state.plan_start_time_s or 0)
    leg_distance = dist - (state.plan_start_dist_m or 0)

    completed = False
    if iv.kind == "distance" and leg_distance >= iv.value and iv.value > 0:
        completed = True
    elif iv.kind == "time" and leg_elapsed >= iv.value and iv.value > 0:
        completed = True

    if completed:
        state.plan_results.append(IntervalResult(
            interval_idx=state.plan_current_idx + 1,
            label=iv.describe(),
            elapsed_s=leg_elapsed,
            distance_m=leg_distance,
            pace_s_per_500m=state.split_avg_pace_s or state.pace_s_per_500m,
            watts=state.split_avg_power_w or state.watts,
            stroke_rate=state.stroke_rate,
            heart_rate=state.heart_rate,
            rest_s=iv.rest_s,
            drive_length_m=state.drive_length_m,
            peak_force_lbs=state.peak_force_lbs,
        ))
        state.plan_current_idx += 1
        state.plan_start_time_s = elapsed
        state.plan_start_dist_m = dist
    return completed


class _WorkoutProgressBar(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._fraction: float = 0.0
        self.setMinimumHeight(14)
        self.setMaximumHeight(14)

    def set_fraction(self, fraction: float) -> None:
        self._fraction = max(0.0, min(1.0, fraction))
        self.update()

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        r = rect.height() / 2
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(COLOR_BG_CARD))
        p.drawRoundedRect(rect, r, r)
        if self._fraction > 0:
            grad = QLinearGradient(rect.left(), 0, rect.right(), 0)
            grad.setColorAt(0.0, QColor(76, 194, 255, 220))
            grad.setColorAt(1.0, QColor(86, 249, 179, 220))
            p.setBrush(grad)
            p.drawRoundedRect(
                QRectF(rect.left(), rect.top(),
                       rect.width() * self._fraction, rect.height()),
                r, r,
            )
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(COLOR_BORDER_BRIGHT), 1))
        p.drawRoundedRect(rect, r, r)


def _parse_time_input(text: str) -> Optional[float]:
    """Parse a time entered as 'mm:ss' or decimal minutes. Returns seconds
    or None if empty/unparseable."""
    text = text.strip()
    if not text:
        return None
    try:
        if ":" in text:
            m, s = text.split(":", 1)
            return int(m) * 60 + float(s)
        return float(text) * 60
    except ValueError:
        return None


def _parse_distance_input(text: str) -> Optional[float]:
    text = text.strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


_BUILDER_LINE_EDIT_STYLE = None  # populated below after theme constants are defined


def _builder_input_style() -> str:
    return (
        f"QLineEdit, QComboBox {{ background: {COLOR_BG_BASE}; "
        f"color: {COLOR_TEXT_PRIMARY}; "
        f"border: 1px solid {COLOR_BORDER_BRIGHT}; "
        f"border-radius: 8px; padding: 6px 10px; font-size: 13px; }} "
        f"QLineEdit:focus, QComboBox:focus {{ border-color: {COLOR_ACCENT}; }}"
        f"QComboBox::drop-down {{ border: 0; width: 16px; }}"
    )


class _IntervalRow(QWidget):
    removed = Signal(object)

    KIND_LABELS = [("Distance", "distance"), ("Time", "time")]

    def __init__(self, index: int = 1, kind: str = "distance",
                 value: str = "", intensity: str = "",
                 spm: str = "", rest: str = "", parent=None) -> None:
        super().__init__(parent)
        style = _builder_input_style()

        self._idx = QLabel(str(index))
        self._idx.setFixedWidth(22)
        self._idx.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._idx.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; font-size: 12px; font-weight: 600;"
        )

        self._type = QComboBox()
        for label, code in self.KIND_LABELS:
            self._type.addItem(label, code)
        idx = next((i for i, (_, c) in enumerate(self.KIND_LABELS) if c == kind), 0)
        self._type.setCurrentIndex(idx)
        self._type.setFixedWidth(110)
        self._type.setStyleSheet(style)

        self._value = QLineEdit(value)
        self._value.setPlaceholderText("500  or  2:00")
        self._value.setStyleSheet(style)

        self._intensity = QLineEdit(intensity)
        self._intensity.setPlaceholderText("pace e.g. 1:45  or  power 250w")
        self._intensity.setStyleSheet(style)

        self._spm = QLineEdit(spm)
        self._spm.setPlaceholderText("—")
        self._spm.setStyleSheet(style)
        self._spm.setFixedWidth(70)

        self._rest = QLineEdit(rest)
        self._rest.setPlaceholderText("0:00")
        self._rest.setStyleSheet(style)
        self._rest.setFixedWidth(90)

        self._remove = QPushButton("✕")
        self._remove.setFixedSize(28, 28)
        self._remove.setToolTip("Remove interval")
        self._remove.clicked.connect(lambda: self.removed.emit(self))

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(8)
        lay.addWidget(self._idx)
        lay.addWidget(self._type)
        lay.addWidget(self._value, 2)
        lay.addWidget(self._intensity, 3)
        lay.addWidget(self._spm)
        lay.addWidget(self._rest)
        lay.addWidget(self._remove)

    def set_index(self, idx: int) -> None:
        self._idx.setText(str(idx))

    def to_interval(self) -> Optional[Interval]:
        kind = self._type.currentData()
        v_text = self._value.text().strip()
        if not v_text:
            return None
        # Parse value by kind; accept "500" / "500m" for distance,
        # "2:00" / "120" / "120s" for time.
        value = 0.0
        if kind == "distance":
            clean = v_text.rstrip(" mM").replace(",", "")
            try:
                value = float(clean)
            except ValueError:
                return None
        elif kind == "time":
            t = _parse_time_input(v_text)
            if t is None:
                return None
            value = t
        if value <= 0:
            return None

        # Intensity: accept "1:45" (pace) or "250w" (watts)
        intensity_txt = self._intensity.text().strip().lower()
        target_pace = None
        target_watts = None
        if intensity_txt.endswith("w"):
            try:
                target_watts = int(intensity_txt.rstrip("w").strip())
            except ValueError:
                pass
        elif ":" in intensity_txt:
            target_pace = _parse_time_input(intensity_txt)
        elif intensity_txt:
            try:
                target_watts = int(intensity_txt)
            except ValueError:
                pass

        spm_txt = self._spm.text().strip()
        target_spm = None
        if spm_txt:
            try:
                target_spm = int(spm_txt)
            except ValueError:
                pass

        rest_txt = self._rest.text().strip()
        rest_s = _parse_time_input(rest_txt) or 0.0

        return Interval(
            kind=kind, value=value,
            target_pace_s_per_500m=target_pace,
            target_watts=target_watts,
            target_spm=target_spm,
            rest_s=rest_s,
        )


class WorkoutBuilderDialog(QDialog):
    """Full workout programmer — title, time cap, intervals table."""

    def __init__(self, state: RowingState, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("New workout")
        self.setModal(True)
        self.resize(720, 620)
        self._result: Optional[WorkoutPlan] = None
        self._clear_requested = False
        self._rows: List[_IntervalRow] = []

        style = _builder_input_style()

        # ----- Header ------------------------------------------------
        header = QLabel("NEW WORKOUT")
        header.setStyleSheet(
            f"color: {COLOR_TEXT_PRIMARY}; font-size: 16px;"
            f" font-weight: 700; letter-spacing: 3px;"
        )
        from datetime import date
        date_label = QLabel(date.today().strftime("%a, %b %d"))
        date_label.setStyleSheet(
            f"color: {COLOR_TEXT_SECONDARY}; font-size: 12px;"
        )

        self._time_cap_cb = QCheckBox("Time cap")
        self._time_cap_cb.setStyleSheet(
            f"color: {COLOR_TEXT_PRIMARY}; font-size: 13px;"
        )
        self._time_cap_input = QLineEdit()
        self._time_cap_input.setPlaceholderText("mm:ss")
        self._time_cap_input.setFixedWidth(90)
        self._time_cap_input.setStyleSheet(style)
        self._time_cap_input.setEnabled(False)
        self._time_cap_cb.toggled.connect(self._time_cap_input.setEnabled)

        plan = state.local_plan
        if plan and plan.time_cap_s:
            self._time_cap_cb.setChecked(True)
            m = int(plan.time_cap_s // 60); s = int(plan.time_cap_s - m * 60)
            self._time_cap_input.setText(f"{m}:{s:02d}")

        # ----- Title + description ----------------------------------
        title_lbl = QLabel("Title")
        title_lbl.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 11px;"
                                 f" font-weight: 700; letter-spacing: 1.5px;")
        self._title = QLineEdit(plan.title if plan else "")
        self._title.setPlaceholderText("Workout title  (e.g. 5×500 race pace)")
        self._title.setStyleSheet(style)

        desc_lbl = QLabel("Description")
        desc_lbl.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 11px;"
                                f" font-weight: 700; letter-spacing: 1.5px;")
        self._desc = QLineEdit(plan.description if plan else "")
        self._desc.setPlaceholderText("Optional — notes, target, context")
        self._desc.setStyleSheet(style)

        # ----- Intervals table header -------------------------------
        head_row = QWidget()
        head_lay = QHBoxLayout(head_row)
        head_lay.setContentsMargins(0, 0, 0, 0)
        head_lay.setSpacing(8)
        for text, width, stretch in [
            ("#", 22, 0),
            ("TYPE", 110, 0),
            ("INTERVAL", 0, 2),
            ("INTENSITY", 0, 3),
            ("SPM", 70, 0),
            ("REST", 90, 0),
            ("", 28, 0),
        ]:
            lbl = QLabel(text)
            lbl.setStyleSheet(
                f"color: {COLOR_TEXT_MUTED}; font-size: 10px;"
                f" font-weight: 700; letter-spacing: 1.5px;"
            )
            if width:
                lbl.setFixedWidth(width)
            if text == "#":
                lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            head_lay.addWidget(lbl, stretch)

        # ----- Intervals list (in a scroll area) --------------------
        self._rows_container = QWidget()
        self._rows_layout = QVBoxLayout(self._rows_container)
        self._rows_layout.setContentsMargins(0, 0, 0, 0)
        self._rows_layout.setSpacing(6)
        self._rows_layout.addStretch(1)  # keep rows pinned to top

        scroll = QScrollArea()
        scroll.setWidget(self._rows_container)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet(
            f"QScrollArea {{ background: {COLOR_BG_BASE}; "
            f"border: 1px solid {COLOR_BORDER}; border-radius: 10px; }}"
        )
        scroll.setMinimumHeight(240)

        # Populate rows from existing plan or add one empty row
        if plan and plan.intervals:
            for iv in plan.intervals:
                self._add_row_from_interval(iv)
        else:
            self._add_empty_row()

        # + NEW INTERVAL ---------------------------------------------
        new_btn = QPushButton("+  New interval")
        new_btn.clicked.connect(self._add_empty_row)

        # ----- Footer buttons ---------------------------------------
        clear_btn = QPushButton("Clear plan")
        clear_btn.clicked.connect(self._clear)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        save_btn = QPushButton("Save")
        save_btn.setProperty("accent", "true")
        save_btn.clicked.connect(self._save)

        btn_row = QHBoxLayout()
        btn_row.addWidget(clear_btn)
        btn_row.addStretch(1)
        btn_row.addWidget(cancel_btn)
        btn_row.addWidget(save_btn)

        # ----- Compose ----------------------------------------------
        top_row = QHBoxLayout()
        top_row.addWidget(header)
        top_row.addSpacing(14)
        top_row.addWidget(date_label)
        top_row.addStretch(1)
        top_row.addWidget(self._time_cap_cb)
        top_row.addWidget(self._time_cap_input)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 20, 22, 20)
        lay.setSpacing(8)
        lay.addLayout(top_row)
        lay.addSpacing(6)
        lay.addWidget(title_lbl)
        lay.addWidget(self._title)
        lay.addWidget(desc_lbl)
        lay.addWidget(self._desc)
        lay.addSpacing(10)
        lay.addWidget(head_row)
        lay.addWidget(scroll, 1)
        lay.addWidget(new_btn, 0, Qt.AlignmentFlag.AlignLeft)
        lay.addSpacing(6)
        lay.addLayout(btn_row)

    # ------------------------------------------------------------------
    def _add_empty_row(self) -> None:
        self._add_row_from_interval(Interval(kind="distance", value=0.0))

    def _add_row_from_interval(self, iv: Interval) -> None:
        value = ""
        if iv.kind == "distance" and iv.value:
            value = str(int(iv.value))
        elif iv.kind == "time" and iv.value:
            m = int(iv.value // 60); s = int(iv.value - m * 60)
            value = f"{m}:{s:02d}"

        intensity = ""
        if iv.target_pace_s_per_500m:
            m = int(iv.target_pace_s_per_500m // 60)
            s = iv.target_pace_s_per_500m - m * 60
            intensity = f"{m}:{s:04.1f}"
        elif iv.target_watts:
            intensity = f"{iv.target_watts}w"

        spm = str(iv.target_spm) if iv.target_spm else ""
        rest = ""
        if iv.rest_s:
            m = int(iv.rest_s // 60); s = int(iv.rest_s - m * 60)
            rest = f"{m}:{s:02d}"

        row = _IntervalRow(
            index=len(self._rows) + 1, kind=iv.kind,
            value=value, intensity=intensity, spm=spm, rest=rest,
        )
        row.removed.connect(self._remove_row)
        self._rows.append(row)
        # insert before the stretch at the end
        self._rows_layout.insertWidget(self._rows_layout.count() - 1, row)

    def _remove_row(self, row: _IntervalRow) -> None:
        if row in self._rows:
            self._rows.remove(row)
            row.setParent(None)
            row.deleteLater()
            for i, r in enumerate(self._rows, start=1):
                r.set_index(i)

    def _clear(self) -> None:
        self._clear_requested = True
        self.accept()

    def _save(self) -> None:
        intervals: List[Interval] = []
        for row in self._rows:
            iv = row.to_interval()
            if iv is not None:
                intervals.append(iv)
        if not intervals:
            self._clear_requested = True
            self.accept()
            return
        time_cap = None
        if self._time_cap_cb.isChecked():
            time_cap = _parse_time_input(self._time_cap_input.text())
        self._result = WorkoutPlan(
            title=self._title.text().strip(),
            description=self._desc.text().strip(),
            time_cap_s=time_cap,
            intervals=intervals,
        )
        self.accept()

    def plan_result(self) -> Tuple[Optional[WorkoutPlan], bool]:
        """Returns (new_plan, clear_requested). If clear_requested is True,
        the existing plan should be discarded."""
        return (self._result, self._clear_requested)


class WorkoutPanel(QFrame):
    target_requested = Signal()
    summary_requested = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "panel")
        self.setMinimumHeight(140)
        self.setMaximumHeight(190)

        title = QLabel("WORKOUT")
        title.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 11px; "
                             f"font-weight: 700; letter-spacing: 3px;")

        self._desc = QLabel("Just rowing")
        self._desc.setStyleSheet(f"color: {COLOR_TEXT_PRIMARY}; "
                                  f"font-size: 20px; font-weight: 600;")

        self._mode = QLabel("")
        self._mode.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY}; "
                                  f"font-size: 11px; letter-spacing: 1.5px;")

        self._summary_btn = QPushButton("Summary")
        self._summary_btn.clicked.connect(self.summary_requested.emit)
        self._summary_btn.setEnabled(False)

        self._set_btn = QPushButton("Program")
        self._set_btn.setProperty("accent", "true")
        self._set_btn.clicked.connect(self.target_requested.emit)

        self._start = QLabel("0")
        self._start.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 12px;")
        self._end = QLabel("—")
        self._end.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 12px;")
        self._bar = _WorkoutProgressBar()

        self._current = QLabel("—")
        self._current.setStyleSheet(f"color: {COLOR_TEXT_PRIMARY}; "
                                     f"font-size: 16px; font-weight: 600;")
        self._remaining = QLabel("")
        self._remaining.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY}; "
                                       f"font-size: 12px;")
        self._interval = QLabel("")
        self._interval.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY}; "
                                      f"font-size: 12px;")

        desc_col = QVBoxLayout()
        desc_col.setSpacing(1)
        desc_col.addWidget(title)
        desc_col.addWidget(self._desc)
        desc_col.addWidget(self._mode)

        btn_col = QVBoxLayout()
        btn_col.setSpacing(4)
        btn_col.addWidget(self._set_btn)
        btn_col.addWidget(self._summary_btn)

        top_row = QHBoxLayout()
        top_row.addLayout(desc_col, 1)
        top_row.addLayout(btn_col, 0)

        bar_row = QHBoxLayout()
        bar_row.setSpacing(10)
        bar_row.addWidget(self._start, 0)
        bar_row.addWidget(self._bar, 1)
        bar_row.addWidget(self._end, 0)

        stats_row = QHBoxLayout()
        stats_row.addWidget(self._current)
        stats_row.addStretch(1)
        stats_row.addWidget(self._remaining)
        stats_row.addSpacing(18)
        stats_row.addWidget(self._interval)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 14, 20, 14)
        lay.setSpacing(8)
        lay.addLayout(top_row)
        lay.addLayout(bar_row)
        lay.addLayout(stats_row)

    def update_from_state(self, state: RowingState) -> None:
        target_dist, target_time, description, is_interval, source = \
            _programmed_target(state)

        self._summary_btn.setEnabled(bool(state.plan_results))

        if description is None:
            self._desc.setText("Just rowing")
            self._mode.setText("no plan — click Program to build one")
            self._bar.set_fraction(0.0)
            self._start.setText("—")
            self._end.setText("—")
            self._current.setText("—")
            self._remaining.setText("")
            self._interval.setText("")
            return

        source_label = {
            "erg":    "FROM ERG",
            "plan":   "LOCAL PLAN",
            "simple": "LOCAL TARGET",
        }.get(source, "")
        self._mode.setText(source_label)
        self._desc.setText(description)

        if target_dist:
            current = state.distance_m or 0.0
            frac = min(current / target_dist, 1.0)
            self._bar.set_fraction(frac)
            self._start.setText("0 m")
            self._end.setText(f"{int(target_dist):,} m")
            self._current.setText(f"{int(current):,} m")
            self._remaining.setText(f"{int(max(0.0, target_dist - current)):,} m to go")
        elif target_time:
            current = state.elapsed_time_s or 0.0
            frac = min(current / target_time, 1.0)
            self._bar.set_fraction(frac)
            self._start.setText("0:00")
            self._end.setText(fmt_time(target_time))
            self._current.setText(fmt_time(current))
            self._remaining.setText(f"{fmt_time(max(0.0, target_time - current))} to go")
        else:
            self._bar.set_fraction(0.0)
            self._start.setText("")
            self._end.setText("")
            self._current.setText(f"{int(state.distance_m or 0):,} m  ·  "
                                   f"{fmt_time(state.elapsed_time_s)}")
            self._remaining.setText("")

        # Interval indicator.
        plan = state.local_plan
        if source == "plan" and plan:
            n_total = len(plan.intervals)
            n_now = min(state.plan_current_idx + 1, n_total)
            self._interval.setText(f"INTERVAL {n_now} OF {n_total}")
        elif state.interval_count:
            self._interval.setText(f"INTERVAL {state.interval_count}")
        else:
            self._interval.setText("")


# =====================================================================
# SECTION 8c — Workout summary dialog (customizable columns)
# =====================================================================
# Available summary columns: (internal id, header label, extractor fn, fmt)
_SUMMARY_COLUMNS = [
    ("label",    "Interval",   lambda r: r.label,        str),
    ("time",     "Time",       lambda r: r.elapsed_s,    fmt_time),
    ("meters",   "Meters",     lambda r: r.distance_m,   lambda v: f"{int(v):,}" if v else "—"),
    ("pace",     "Pace /500",  lambda r: r.pace_s_per_500m, fmt_pace),
    ("watts",    "Watts",      lambda r: r.watts,        fmt_int),
    ("rate",     "Rate",       lambda r: r.stroke_rate,  fmt_int),
    ("hr",       "HR",         lambda r: r.heart_rate,   fmt_int),
    ("drive",    "Drv Len (m)", lambda r: r.drive_length_m, lambda v: f"{v:.2f}" if v else "—"),
    ("peak",     "Peak Force", lambda r: r.peak_force_lbs, lambda v: f"{v:.1f}" if v else "—"),
    ("rest",     "Rest",       lambda r: r.rest_s,       lambda v: fmt_time(v) if v else "—"),
]
_DEFAULT_COLUMN_KEYS = ("label", "time", "meters", "watts", "rate", "hr", "rest")


class SummaryDialog(QDialog):
    def __init__(self, plan: Optional[WorkoutPlan],
                 results: List[IntervalResult],
                 active_keys: Optional[List[str]] = None,
                 parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Workout summary")
        self.setModal(True)
        self.resize(860, 560)
        self._active_keys: List[str] = list(active_keys or _DEFAULT_COLUMN_KEYS)
        self._results = list(results)
        self._plan = plan

        title_txt = (plan.title if plan and plan.title else "Workout summary")
        header = QLabel(title_txt)
        header.setStyleSheet(
            f"color: {COLOR_TEXT_PRIMARY}; font-size: 18px; font-weight: 700;"
        )
        if plan and plan.description:
            sub = QLabel(plan.description)
            sub.setStyleSheet(f"color: {COLOR_TEXT_SECONDARY}; font-size: 12px;")
            sub.setWordWrap(True)
        else:
            sub = None

        # ----- Column picker -----------------------------------------
        picker = QFrame()
        picker.setProperty("role", "card")
        picker_lay = QHBoxLayout(picker)
        picker_lay.setContentsMargins(12, 8, 12, 8)
        picker_lay.setSpacing(14)
        pick_label = QLabel("COLUMNS")
        pick_label.setStyleSheet(
            f"color: {COLOR_TEXT_MUTED}; font-size: 11px;"
            f" font-weight: 700; letter-spacing: 1.5px;"
        )
        picker_lay.addWidget(pick_label)

        self._col_checks: dict = {}
        for key, label, _, _ in _SUMMARY_COLUMNS:
            cb = QCheckBox(label)
            cb.setStyleSheet(f"color: {COLOR_TEXT_PRIMARY}; font-size: 12px;")
            cb.setChecked(key in self._active_keys)
            cb.stateChanged.connect(lambda _s, k=key: self._toggle_column(k))
            self._col_checks[key] = cb
            picker_lay.addWidget(cb)
        picker_lay.addStretch(1)

        # ----- Table -------------------------------------------------
        self._table = QTableWidget()
        self._table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self._table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self._table.setAlternatingRowColors(True)
        self._table.setStyleSheet(
            f"QTableWidget {{ background: {COLOR_BG_BASE}; "
            f"color: {COLOR_TEXT_PRIMARY}; "
            f"border: 1px solid {COLOR_BORDER}; "
            f"gridline-color: {COLOR_BORDER}; }} "
            f"QTableWidget::item {{ padding: 6px 8px; }} "
            f"QTableWidget::item:selected {{ background: #1e2a42; }} "
            f"QHeaderView::section {{ background: {COLOR_BG_PANEL_HI}; "
            f"color: {COLOR_TEXT_MUTED}; padding: 6px 8px; "
            f"border: 0; border-right: 1px solid {COLOR_BORDER}; "
            f"font-size: 11px; font-weight: 700; letter-spacing: 1px; }} "
        )
        self._table.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch
        )
        self._table.verticalHeader().setVisible(False)

        close_btn = QPushButton("Close")
        close_btn.setProperty("accent", "true")
        close_btn.clicked.connect(self.accept)

        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        btn_row.addWidget(close_btn)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 20, 22, 20)
        lay.setSpacing(10)
        lay.addWidget(header)
        if sub:
            lay.addWidget(sub)
        lay.addWidget(picker)
        lay.addWidget(self._table, 1)
        lay.addLayout(btn_row)

        self._populate_table()

    def active_keys(self) -> List[str]:
        return list(self._active_keys)

    def _toggle_column(self, key: str) -> None:
        if self._col_checks[key].isChecked():
            if key not in self._active_keys:
                # Insert in the canonical order so the table stays tidy
                canonical = [k for (k, *_r) in _SUMMARY_COLUMNS]
                new = [k for k in canonical if k in self._active_keys or k == key]
                self._active_keys = new
        else:
            if key in self._active_keys and len(self._active_keys) > 1:
                self._active_keys.remove(key)
            else:
                # Prevent clearing the last column — re-check it.
                self._col_checks[key].blockSignals(True)
                self._col_checks[key].setChecked(True)
                self._col_checks[key].blockSignals(False)
                return
        self._populate_table()

    def _populate_table(self) -> None:
        cols = [c for c in _SUMMARY_COLUMNS if c[0] in self._active_keys]
        rows = self._results
        totals = self._compute_totals()

        self._table.setColumnCount(len(cols))
        self._table.setRowCount(len(rows) + (1 if rows else 0))
        self._table.setHorizontalHeaderLabels([c[1] for c in cols])

        for r_idx, result in enumerate(rows):
            for c_idx, (_, _, extractor, formatter) in enumerate(cols):
                val = extractor(result)
                text = formatter(val) if val not in (None, "") else "—"
                item = QTableWidgetItem(str(text))
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter
                                      if c_idx > 0 else Qt.AlignmentFlag.AlignLeft
                                      | Qt.AlignmentFlag.AlignVCenter)
                self._table.setItem(r_idx, c_idx, item)

        # Totals row
        if rows:
            totals_row = len(rows)
            for c_idx, (key, _, _, formatter) in enumerate(cols):
                if key == "label":
                    text = "TOTAL"
                elif key in totals:
                    v = totals[key]
                    text = formatter(v) if v else "—"
                else:
                    text = ""
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter
                                      if c_idx > 0 else Qt.AlignmentFlag.AlignLeft
                                      | Qt.AlignmentFlag.AlignVCenter)
                f = item.font(); f.setBold(True); item.setFont(f)
                self._table.setItem(totals_row, c_idx, item)

    def _compute_totals(self) -> dict:
        t = {"time": 0.0, "meters": 0.0, "rest": 0.0}
        n = 0
        watts_sum = 0; rate_sum = 0; hr_sum = 0; watts_n = 0; rate_n = 0; hr_n = 0
        for r in self._results:
            t["time"] += r.elapsed_s or 0
            t["meters"] += r.distance_m or 0
            t["rest"] += r.rest_s or 0
            if r.watts: watts_sum += r.watts; watts_n += 1
            if r.stroke_rate: rate_sum += r.stroke_rate; rate_n += 1
            if r.heart_rate: hr_sum += r.heart_rate; hr_n += 1
            n += 1
        if watts_n: t["watts"] = watts_sum / watts_n
        if rate_n: t["rate"] = rate_sum / rate_n
        if hr_n: t["hr"] = hr_sum / hr_n
        return t


# =====================================================================
# SECTION 9 — Connect dialog
# =====================================================================
DeviceEntry = Tuple[str, Union[DiscoveredDevice, UsbDevice]]


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
        self._list.itemSelectionChanged.connect(self._on_sel_changed)

        self._rescan_btn = QPushButton("Rescan")
        self._rescan_btn.clicked.connect(self._start_scan)
        self._connect_btn = QPushButton("Connect")
        self._connect_btn.setProperty("accent", "true")
        self._connect_btn.setEnabled(False)
        self._connect_btn.clicked.connect(self._accept)
        self._cancel_btn = QPushButton("Cancel")
        self._cancel_btn.clicked.connect(self.reject)

        btns = QHBoxLayout()
        btns.addWidget(self._rescan_btn); btns.addStretch(1)
        btns.addWidget(self._cancel_btn); btns.addWidget(self._connect_btn)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 22, 24, 22); lay.setSpacing(10)
        lay.addWidget(title); lay.addWidget(self._subtitle); lay.addSpacing(6)
        lay.addWidget(self._list, 1); lay.addLayout(btns)

        self._start_scan()

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
            usb_devices = await self._usb.scan()
            for d in usb_devices:
                item = QListWidgetItem(f"[USB]  {d.label()}")
                item.setData(Qt.ItemDataRole.UserRole, ("usb", d))
                self._list.addItem(item)
            ble_devices = await self._ble.scan(timeout=8.0)
            for d in ble_devices:
                item = QListWidgetItem(f"[BLE]  {d.label()}")
                item.setData(Qt.ItemDataRole.UserRole, ("ble", d))
                self._list.addItem(item)
            total = len(usb_devices) + len(ble_devices)
            if total == 0:
                self._subtitle.setText(
                    "No PM5 detected. Wake the monitor by pulling the handle, "
                    "enable Bluetooth, or plug in the USB cable, then Rescan."
                )
            else:
                plural = "monitor" if total == 1 else "monitors"
                self._subtitle.setText(f"Found {total} {plural} — pick one to connect.")
        except Exception as exc:  # noqa: BLE001
            self._subtitle.setText(f"Scan failed: {exc}")
        finally:
            self._rescan_btn.setEnabled(True)

    def _on_sel_changed(self) -> None:
        self._connect_btn.setEnabled(self._list.currentItem() is not None)

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


# =====================================================================
# SECTION 10 — Main window
# =====================================================================
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

        root = QWidget(); root.setObjectName("AppRoot")
        self.setCentralWidget(root)

        self._header = StatusHeader()
        self._header.connect_clicked.connect(self._on_connect_clicked)
        self._header.disconnect_clicked.connect(self._on_disconnect_clicked)

        # Widgets stretch proportionally with the window. Minimums keep
        # them readable; no maximums, so full-screen / ultrawide fills
        # the available space instead of leaving dead bands on the sides.
        self._ratio = RatioWidget()
        self._ratio.setMinimumWidth(330)
        self._ratio.setMinimumHeight(360)
        self._force_curve = ForceCurveWidget()
        self._drive_len = DriveLengthWidget()
        self._drive_len.setMinimumWidth(330)
        self._drive_len.setMinimumHeight(360)

        self._card_stroke_rate = MetricCard("Stroke Rate", "per min")
        self._card_pace = MetricCard("Pace", "/ 500 m")
        self._card_watts = MetricCard("Power", "watts")
        self._card_distance = MetricCard("Distance", "metres")
        self._card_heart_rate = MetricCard("Heart Rate", "bpm")
        self._card_intervals = MetricCard("Intervals", "count")

        left_col = QVBoxLayout(); left_col.setSpacing(12)
        left_col.addWidget(self._ratio, 2)
        for c in (self._card_stroke_rate, self._card_pace, self._card_watts):
            left_col.addWidget(c, 1)
        right_col = QVBoxLayout(); right_col.setSpacing(12)
        right_col.addWidget(self._drive_len, 2)
        for c in (self._card_distance, self._card_heart_rate, self._card_intervals):
            right_col.addWidget(c, 1)

        # Workout panel sits below the force curve, in the centre column.
        self._workout = WorkoutPanel()
        self._workout.target_requested.connect(self._on_set_target_clicked)
        self._workout.summary_requested.connect(self._on_summary_clicked)
        # Remember the user's summary-column preferences across sessions
        # of the summary dialog.
        self._summary_cols: List[str] = list(_DEFAULT_COLUMN_KEYS)

        center_col = QVBoxLayout(); center_col.setSpacing(12)
        center_col.addWidget(self._force_curve, 0)
        center_col.addWidget(self._workout, 0)
        center_col.addStretch(1)

        # Stretch factors 2 : 3 : 2 give the force curve roughly 40% of the
        # horizontal space at any window width, with the side columns
        # getting the remaining 60% split evenly. Minimum widths on the
        # side widgets keep things readable at narrow window sizes.
        content = QHBoxLayout(); content.setSpacing(16)
        content.addLayout(left_col, 2)
        content.addLayout(center_col, 3)
        content.addLayout(right_col, 2)

        # "Workout overview" strip along the bottom.
        self._card_elapsed = MetricCard("Elapsed", "time")
        self._card_drag = MetricCard("Drag Factor", "")
        self._card_rest = MetricCard("Rest", "time")
        self._card_avg_split = MetricCard("Avg Split", "/ 500 m")
        self._card_avg_watts = MetricCard("Avg Watts", "watts")
        bottom_strip = QHBoxLayout(); bottom_strip.setSpacing(12)
        for c in (
            self._card_elapsed, self._card_drag,
            self._card_rest, self._card_avg_split, self._card_avg_watts,
        ):
            bottom_strip.addWidget(c, 1)
        bottom_frame = QFrame(); bottom_frame.setProperty("role", "panel")
        bl = QVBoxLayout(bottom_frame); bl.setContentsMargins(14, 12, 14, 12)
        bl.addLayout(bottom_strip)

        self._toast = QLabel(""); self._toast.setProperty("role", "status")
        self._toast.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._toast.setWordWrap(True); self._toast.setMinimumHeight(26)
        self._toast_clear = QTimer(self)
        self._toast_clear.setSingleShot(True)
        self._toast_clear.timeout.connect(lambda: self._toast.setText(""))

        lay = QVBoxLayout(root)
        lay.setContentsMargins(16, 16, 16, 10); lay.setSpacing(12)
        lay.addWidget(self._header)
        lay.addLayout(content, 1)
        lay.addWidget(bottom_frame)
        lay.addWidget(self._toast)

        self._controller.state_changed.connect(self._on_state_changed)
        self._controller.connection_state_changed.connect(self._on_conn_state)
        self._controller.message.connect(self._on_message)
        self._on_state_changed(self._controller.state)
        self._on_conn_state("disconnected")

    def _hero_metrics_available(self) -> bool:
        return self._controller.connection_mode() in ("", "ble")

    def _on_state_changed(self, state: RowingState) -> None:
        ble = self._hero_metrics_available()
        # During a stroke the live buffer is the bright "current" trace;
        # between strokes the just-completed stroke is promoted to it.
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

        self._card_stroke_rate.set_value(fmt_int(state.stroke_rate))
        self._card_pace.set_value(fmt_pace(state.pace_s_per_500m))
        self._card_watts.set_value(fmt_int(state.watts))
        self._card_distance.set_value(fmt_distance(state.distance_m))
        self._card_distance.set_unit("km" if (state.distance_m or 0) >= 1000 else "metres")
        self._card_heart_rate.set_value(fmt_int(state.heart_rate))
        self._card_intervals.set_value(fmt_int(state.interval_count))
        self._card_elapsed.set_value(fmt_time(state.elapsed_time_s))
        self._card_drag.set_value(fmt_int(state.drag_factor))
        self._card_rest.set_value(fmt_time(state.rest_time_s))
        self._card_avg_split.set_value(fmt_pace(state.split_avg_pace_s))
        self._card_avg_watts.set_value(fmt_int(state.watts))

        self._workout.update_from_state(state)

    def _on_conn_state(self, state: str) -> None:
        self._header.set_state(state)

    def _on_message(self, level: str, text: str) -> None:
        colour = {
            "error": COLOR_ACCENT_WARN,
            "warn": COLOR_STATUS_CONNECTING,
            "info": COLOR_TEXT_SECONDARY,
        }.get(level, COLOR_TEXT_SECONDARY)
        self._toast.setStyleSheet(f"color: {colour}; font-size: 12px;")
        self._toast.setText(text)
        self._toast_clear.start(6000 if level != "error" else 10000)

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

    def _on_set_target_clicked(self) -> None:
        s = self._controller.state
        dlg = WorkoutBuilderDialog(s, parent=self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        plan, clear = dlg.plan_result()
        # A new plan invalidates any prior tracking state. Simple
        # distance/time single-targets are cleared too — the builder is
        # now the single source of truth for local workouts.
        s.local_target_dist_m = None
        s.local_target_time_s = None
        s.plan_current_idx = 0
        s.plan_start_time_s = None
        s.plan_start_dist_m = None
        s.plan_results = []
        if clear:
            s.local_plan = None
        elif plan:
            s.local_plan = plan
        self._workout.update_from_state(s)

    def _on_summary_clicked(self) -> None:
        s = self._controller.state
        dlg = SummaryDialog(
            s.local_plan, s.plan_results,
            active_keys=self._summary_cols, parent=self,
        )
        dlg.exec()
        # Persist the user's column selection for next time.
        self._summary_cols = dlg.active_keys()

    async def _do_connect(
        self, kind: str, device: Union[DiscoveredDevice, UsbDevice],
    ) -> None:
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

    def closeEvent(self, event: QCloseEvent) -> None:  # type: ignore[override]
        asyncio.ensure_future(self._do_disconnect())
        super().closeEvent(event)


# =====================================================================
# SECTION 11 — App entry point
# =====================================================================
def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-30s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("bleak").setLevel(logging.WARNING)


def _apply_palette(app: QApplication) -> None:
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.Base, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.Text, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.Button, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.ToolTipText, QColor(COLOR_TEXT_PRIMARY))
    app.setPalette(palette)


def main() -> int:
    _configure_logging()

    app = QApplication(sys.argv)
    app.setApplicationName(__app_name__)
    app.setOrganizationName("PM5 Dashboard")
    app.setStyle("Fusion")
    _apply_palette(app)
    app.setStyleSheet(STYLESHEET)

    loop = qasync.QEventLoop(app)
    asyncio.set_event_loop(loop)

    quit_event = asyncio.Event()
    app.aboutToQuit.connect(quit_event.set)

    ble = PM5BleClient()
    usb = PM5UsbClient()
    controller = StateController(ble, usb)

    window = MainWindow(ble, usb, controller)
    window.show()

    if sys.platform != "win32":
        try:
            loop.add_signal_handler(signal.SIGINT, app.quit)
            loop.add_signal_handler(signal.SIGTERM, app.quit)
        except NotImplementedError:
            pass

    with loop:
        loop.run_until_complete(quit_event.wait())
    return 0


if __name__ == "__main__":
    sys.exit(main())
