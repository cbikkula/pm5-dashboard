"""USB HID fallback client for the PM5, speaking CSAFE over `hidapi`.

Scope and trade-offs
--------------------
The PM5's BLE service is the richest official data path: it streams per-
stroke Force Curve samples and a dedicated Stroke Data characteristic
that carries Drive Length, Drive Time and Stroke Recovery Time (the
three raw numbers we need for the "hero" metrics).

Over USB, the PM5 is a CSAFE HID device. CSAFE exposes scalar fitness
metrics (time, distance, pace, cadence, HR, power, calories) via
well-defined standard commands. The per-stroke force samples and the
drive/recovery timings are only reachable via PM-vendor-extension CSAFE
frames whose correct end-to-end implementation is significantly more
involved than the rest of this app combined. Rather than ship half of
that extension or fake the hero metrics, the USB path here deliberately
supports only the scalar metrics:

    ✓ elapsed time, distance, stroke rate, pace, heart rate, power,
      calories
    ✗ force curve, drive length, drive-to-recovery ratio

When the user connects over USB the UI shows the three hero metrics as
"BLE only" and keeps every other panel live. Users wanting the full
experience should connect via Bluetooth; that path is fully supported.

This module is independent of BLE and can be used on machines without
Bluetooth at all.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import List, Optional

from PySide6.QtCore import QObject, QTimer, Signal

from . import uuids as _uuids

try:
    import hid  # type: ignore[import-not-found]
    HID_AVAILABLE = True
except Exception:  # noqa: BLE001
    hid = None  # type: ignore[assignment]
    HID_AVAILABLE = False

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CSAFE framing and command codes
# ---------------------------------------------------------------------------
CSAFE_EXT_FRAME_START_BYTE = 0xF0
CSAFE_STD_FRAME_START_BYTE = 0xF1
CSAFE_FRAME_END_BYTE       = 0xF2
CSAFE_FRAME_STUFF_BYTE     = 0xF3

# Subset of standard CSAFE "long get" commands we use.
CSAFE_GETTIME     = 0xA0  # returns HH:MM:SS
CSAFE_GETHORIZ    = 0xA1  # returns horizontal distance + units
CSAFE_GETCALS     = 0xA3  # returns calories
CSAFE_GETPACE     = 0xA6  # returns pace + units
CSAFE_GETCADENCE  = 0xA7  # returns cadence (stroke rate)
CSAFE_GETHRCUR    = 0xB0  # returns current heart rate
CSAFE_GETPOWER    = 0xB4  # returns current power
CSAFE_GOREADY     = 0x87  # transition to "ready" state (short cmd)
CSAFE_GOINUSE     = 0x85  # transition to "in-use" state (short cmd)

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
    """Apply CSAFE byte-stuffing to the body of a frame."""
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


def _make_frame(commands: List[List[int]]) -> bytes:
    """Pack a list of CSAFE command payloads into a framed byte string."""
    body: List[int] = []
    for cmd in commands:
        body.extend(cmd)
    checksum = 0
    for b in body:
        checksum ^= b
    body.append(checksum)
    stuffed = _byte_stuff(body)
    frame = [CSAFE_STD_FRAME_START_BYTE] + stuffed + [CSAFE_FRAME_END_BYTE]
    return bytes(frame)


def _parse_frame(raw: bytes) -> List[int]:
    """Strip HID padding, framing bytes and return the un-stuffed payload."""
    # Drop trailing zeros — HID reports are always 64 bytes.
    data = list(raw)
    # Trim any leading HID report id echo (0x00 / 0x01) that might appear.
    while data and data[0] not in (CSAFE_STD_FRAME_START_BYTE,
                                    CSAFE_EXT_FRAME_START_BYTE):
        data.pop(0)
        if not data:
            return []
    if data[0] not in (CSAFE_STD_FRAME_START_BYTE, CSAFE_EXT_FRAME_START_BYTE):
        return []
    # Find the end byte.
    try:
        end_idx = data.index(CSAFE_FRAME_END_BYTE, 1)
    except ValueError:
        return []
    body = _byte_unstuff(data[1:end_idx])
    if not body:
        return []
    # Last byte is the checksum; drop it.
    return body[:-1]


def _parse_cmd_responses(body: List[int]) -> dict:
    """Turn a response body into {command_code: [payload bytes]}.

    A CSAFE response frame body starts with a "prior frame status" byte
    (always < 0x80 — not a command code). We skip any such leading
    bytes, then pull out command responses as [cmd][len][data...].
    """
    out: dict = {}
    i = 0
    # Skip leading status byte(s). Real command codes are >= 0x80.
    while i < len(body) and body[i] < 0x80:
        i += 1
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


# ---------------------------------------------------------------------------
# Device detection & client
# ---------------------------------------------------------------------------
def enumerate_pm5_usb() -> List[UsbDevice]:
    if not HID_AVAILABLE:
        return []
    out: List[UsbDevice] = []
    try:
        for info in hid.enumerate(_uuids.USB_VID_CONCEPT2, 0):
            pid = info.get("product_id", 0)
            if pid not in _uuids.USB_PIDS_PM5:
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
    """Polling USB client that feeds the same signal shape as the BLE client.

    Only scalar metrics are provided; see the module docstring for the
    explicit list of what's supported over USB.
    """

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
        self._active_name: str = ""
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
        # Best-effort: tell the PM to enter in-use state so it will
        # respond to stat commands.
        try:
            self._write_frame(_make_frame([[CSAFE_GOINUSE]]))
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

    # ------------------------------------------------------------------
    # Polling & framing
    # ------------------------------------------------------------------
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
        # Strip leading report id if present.
        if data and data[0] == HID_REPORT_ID:
            data = data[1:]
        return _parse_frame(data)

    def _poll_once(self) -> None:
        if self._dev is None:
            return
        try:
            frame = _make_frame([
                [CSAFE_GETTIME],
                [CSAFE_GETHORIZ],
                [CSAFE_GETCADENCE],
                [CSAFE_GETPACE],
                [CSAFE_GETHRCUR],
                [CSAFE_GETPOWER],
                [CSAFE_GETCALS],
            ])
            self._write_frame(frame)
            body = self._read_frame(timeout_ms=40)
            if not body:
                return
            resp = _parse_cmd_responses(body)
            self._emit_status_from_csafe(resp)
        except Exception as exc:  # noqa: BLE001
            log.debug("CSAFE poll error: %s", exc)

    def _emit_status_from_csafe(self, resp: dict) -> None:
        # Keep conservative: emit only fields we can read this cycle.
        status: dict = {}
        status1: dict = {}
        status2: dict = {}

        time_bytes = resp.get(CSAFE_GETTIME, [])
        if len(time_bytes) >= 3:
            h, m, s = time_bytes[0], time_bytes[1], time_bytes[2]
            status["elapsed_time_s"] = h * 3600 + m * 60 + s

        horiz = resp.get(CSAFE_GETHORIZ, [])
        if len(horiz) >= 3:
            # Low, Mid, High bytes + units byte
            dist = horiz[0] | (horiz[1] << 8) | (horiz[2] << 16)
            status["distance_m"] = float(dist)

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
