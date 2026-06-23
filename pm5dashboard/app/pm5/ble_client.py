"""PM5 BLE client built on Bleak and integrated with Qt via qasync.

The client runs entirely on the asyncio loop that qasync installs as the
Qt event loop, so notification callbacks can emit Qt signals directly
without needing `QMetaObject.invokeMethod` or a cross-thread queue.

Separation of concerns:
  * `PM5BleClient` owns the BLE lifecycle (scan → connect → subscribe).
  * Parsers in `protocol.py` turn raw bytes into dicts.
  * The StateController turns dicts into `RowingState` updates.
  * UI widgets read only from `RowingState`.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import List, Optional

from PySide6.QtCore import QObject, Signal

try:
    from bleak import BleakClient, BleakScanner
    from bleak.backends.device import BLEDevice  # noqa: F401 (type hint)
    from bleak.exc import BleakError
    BLEAK_AVAILABLE = True
except Exception:  # noqa: BLE001
    BleakClient = None        # type: ignore[assignment]
    BleakScanner = None       # type: ignore[assignment]
    BleakError = Exception    # type: ignore[assignment]
    BLEAK_AVAILABLE = False

from . import protocol, uuids

log = logging.getLogger(__name__)


@dataclass
class DiscoveredDevice:
    address: str
    name: str
    rssi: Optional[int] = None

    def label(self) -> str:
        rssi = f"  [{self.rssi} dBm]" if self.rssi is not None else ""
        return f"{self.name}  —  {self.address}{rssi}"


class PM5BleClient(QObject):
    """Qt-friendly wrapper around a Bleak BLE connection to a PM5."""

    # --- Connection lifecycle signals ----------------------------------
    scan_started = Signal()
    scan_finished = Signal(list)           # List[DiscoveredDevice]
    connecting = Signal(str)               # address
    device_connected = Signal(str, str)    # address, friendly name
    device_disconnected = Signal(str)      # reason
    error = Signal(str)                    # human-readable message

    # --- Streaming data signals ----------------------------------------
    general_status = Signal(dict)
    general_status_1 = Signal(dict)
    general_status_2 = Signal(dict)
    stroke_data = Signal(dict)
    force_sample = Signal(float)           # one sample, lbs
    stroke_started = Signal()
    stroke_ended = Signal(list)            # list of samples, lbs

    # Names advertised by PM5s. Not all firmwares advertise "PM5" — some
    # advertise as "Concept2 PM5 …" or a custom workout name. We match
    # broadly and let the user pick from the scan results.
    _KNOWN_PREFIXES = ("PM5", "Concept2", "PM ", "CII")

    def __init__(self) -> None:
        super().__init__()
        self._client: Optional[BleakClient] = None
        self._active_address: str = ""
        self._active_name: str = ""

        # Force-curve reassembly
        self._current_curve: List[float] = []
        self._last_seq: Optional[int] = None

    # ==================================================================
    # Scanning
    # ==================================================================
    async def scan(self, timeout: float = 8.0) -> List[DiscoveredDevice]:
        if not BLEAK_AVAILABLE:
            self.error.emit("Bluetooth support is not available "
                            "(bleak library failed to import)")
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
                    address=dev.address,
                    name=name,
                    rssi=getattr(dev, "rssi", None),
                ))
        self.scan_finished.emit(found)
        return found

    @classmethod
    def _matches_pm5(cls, name: str) -> bool:
        lname = name.lower()
        if "pm5" in lname:
            return True
        return any(name.startswith(p) for p in cls._KNOWN_PREFIXES)

    # ==================================================================
    # Connection
    # ==================================================================
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
        # Invoked by Bleak when the device drops off unexpectedly.
        if self._client is not None:
            self._client = None
            self.device_disconnected.emit("PM5 disconnected")

    # ==================================================================
    # Session setup
    # ==================================================================
    async def _configure_session(self) -> None:
        # Request a ~250ms sample rate on status characteristics. This
        # is best-effort: some firmwares refuse writes to this handle.
        try:
            await self._client.write_gatt_char(
                uuids.CHAR_RATE_CONTROL,
                bytes([uuids.RATE_250MS]),
                response=True,
            )
        except Exception as exc:  # noqa: BLE001
            log.info("Could not set sample rate (non-fatal): %s", exc)

        subs = [
            (uuids.CHAR_GENERAL_STATUS,   self._on_general_status),
            (uuids.CHAR_GENERAL_STATUS_1, self._on_general_status_1),
            (uuids.CHAR_GENERAL_STATUS_2, self._on_general_status_2),
            (uuids.CHAR_STROKE_DATA,      self._on_stroke_data),
            (uuids.CHAR_FORCE_CURVE,      self._on_force_curve),
        ]
        failures: List[str] = []
        for uuid, cb in subs:
            try:
                await self._client.start_notify(uuid, cb)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{uuid}: {exc}")
                log.warning("Subscription failed for %s: %s", uuid, exc)
        if len(failures) == len(subs):
            raise RuntimeError("No PM5 characteristics could be subscribed")

    # ==================================================================
    # Notification handlers — these run on the qasync loop (= Qt loop)
    # ==================================================================
    def _on_general_status(self, _sender, data: bytearray) -> None:
        d = protocol.parse_general_status(bytes(data))
        if d:
            self.general_status.emit(d)

    def _on_general_status_1(self, _sender, data: bytearray) -> None:
        d = protocol.parse_general_status_1(bytes(data))
        if d:
            self.general_status_1.emit(d)

    def _on_general_status_2(self, _sender, data: bytearray) -> None:
        d = protocol.parse_general_status_2(bytes(data))
        if d:
            self.general_status_2.emit(d)

    def _on_stroke_data(self, _sender, data: bytearray) -> None:
        d = protocol.parse_stroke_data(bytes(data))
        if not d:
            return
        self.stroke_data.emit(d)
        # Stroke data arrives after the force-curve packets for a stroke
        # have finished streaming, so this is the authoritative "stroke
        # ended" marker. Flush the accumulated curve now.
        if self._current_curve:
            self.stroke_ended.emit(list(self._current_curve))
            self._current_curve = []
            self._last_seq = None

    def _on_force_curve(self, _sender, data: bytearray) -> None:
        seq, samples = protocol.parse_force_curve(bytes(data))
        if seq < 0:
            return
        if seq == 0:
            # New stroke — if stroke_data didn't already flush for us
            # (e.g. first-ever stroke), start fresh.
            if self._current_curve:
                self.stroke_ended.emit(list(self._current_curve))
            self._current_curve = []
            self.stroke_started.emit()
        self._last_seq = seq
        for s in samples:
            self._current_curve.append(s)
            self.force_sample.emit(s)
