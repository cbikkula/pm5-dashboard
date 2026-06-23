"""Parsers for PM5 BLE characteristic payloads.

Layouts are derived from the Concept2 PM Bluetooth Smart Interface
Definition. Multi-byte values are little-endian. All parsers are
defensive about short payloads — firmware revisions have shipped with
slightly different lengths and we'd rather display most of the data than
refuse to display any of it.
"""
from __future__ import annotations

from typing import List, Tuple


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------
def u8(data: bytes, offset: int) -> int:
    return data[offset]


def u16le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset + 2], "little", signed=False)


def u24le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset + 3], "little", signed=False)


# ---------------------------------------------------------------------------
# Characteristic parsers
# ---------------------------------------------------------------------------
def parse_general_status(data: bytes) -> dict:
    """0x0031 — elapsed time, distance, workout state, drag factor."""
    if len(data) < 19:
        return {}
    return {
        "elapsed_time_s":    u24le(data, 0) * 0.01,
        "distance_m":        u24le(data, 3) * 0.1,
        "workout_type":      u8(data, 6),
        "interval_type":     u8(data, 7),
        "workout_state":     u8(data, 8),
        "rowing_state":      u8(data, 9),
        "stroke_state":      u8(data, 10),
        "total_work_dist_m": u24le(data, 11),
        "workout_duration":  u24le(data, 14),
        "duration_type":     u8(data, 17),
        "drag_factor":       u8(data, 18),
    }


def parse_general_status_1(data: bytes) -> dict:
    """0x0032 — speed, stroke rate, heart rate, pace."""
    if len(data) < 13:
        return {}
    result = {
        "speed_m_s":        u16le(data, 0) * 0.001,
        "stroke_rate":      u8(data, 2),
        "heart_rate":       u8(data, 3),
        "current_pace_s":   u16le(data, 4) * 0.01,
        "average_pace_s":   u16le(data, 6) * 0.01,
        "rest_distance_m":  u16le(data, 8),
        "rest_time_s":      u24le(data, 10) * 0.01,
    }
    if len(data) > 13:
        result["erg_machine_type"] = u8(data, 13)
    return result


def parse_general_status_2(data: bytes) -> dict:
    """0x0033 — interval, power, calories, split averages."""
    if len(data) < 11:
        return {}
    out = {
        "interval_count":     u8(data, 0),
        "average_power_w":    u16le(data, 1),
        "total_calories":     u16le(data, 3),
        "split_avg_pace_s":   u16le(data, 5) * 0.01,
        "split_avg_power_w":  u16le(data, 7),
        "split_avg_calories": u16le(data, 9),
    }
    if len(data) >= 14:
        out["last_split_time_s"] = u24le(data, 11) * 0.01
    if len(data) >= 17:
        out["last_split_dist_m"] = u24le(data, 14)
    return out


def parse_stroke_data(data: bytes) -> dict:
    """0x0035 — stroke timings and per-stroke force summary.

    Emits once per stroke, right after the force curve samples finish
    streaming. Drive length, drive time and recovery time all come from
    this characteristic.
    """
    if len(data) < 19:
        return {}
    out = {
        "elapsed_time_s":    u24le(data, 0) * 0.01,
        "distance_m":        u24le(data, 3) * 0.1,
        "drive_length_m":    u8(data, 6) * 0.01,
        "drive_time_s":      u16le(data, 7) * 0.01,
        "recovery_time_s":   u16le(data, 9) * 0.01,
        "stroke_distance_m": u16le(data, 11) * 0.01,
        "peak_force_lbs":    u16le(data, 13) * 0.1,
        "average_force_lbs": u16le(data, 15) * 0.1,
        "work_per_stroke_j": u16le(data, 17) * 0.1,
    }
    if len(data) >= 20:
        out["stroke_count"] = u8(data, 19)
    return out


def parse_force_curve(data: bytes) -> Tuple[int, List[float]]:
    """0x003D — Force Curve Data.

    Packet layout:
        byte 0: bits 7..4 = number of samples in this packet
                bits 3..0 = sequence number (0 == start of stroke)
        bytes 1..: little-endian uint16 samples, resolution 0.1 lbf

    A stroke is split across multiple notifications with monotonically
    increasing sequence numbers (wrapping at 15). We emit each packet's
    samples as-is and let the client assemble the full stroke.

    Some firmware revisions use 1-byte samples instead of 2-byte samples;
    we detect this by checking whether the declared sample count fits in
    the payload at 2 bytes each.

    Returns (sequence_number, list_of_samples_in_lbs_force). Returns
    (-1, []) when the payload is empty.
    """
    if not data:
        return (-1, [])
    header = data[0]
    count = (header >> 4) & 0x0F
    sequence = header & 0x0F
    payload = data[1:]
    samples: List[float] = []

    # Prefer 2-byte samples (modern firmware); fall back to 1-byte
    # samples if the payload is too short to contain 2-byte samples.
    if count > 0 and count * 2 <= len(payload):
        for i in range(count):
            raw = int.from_bytes(payload[i * 2: i * 2 + 2], "little")
            samples.append(raw * 0.1)
    elif count > 0:
        for i in range(min(count, len(payload))):
            samples.append(float(payload[i]))
    return (sequence, samples)


def parse_heart_rate_belt(data: bytes) -> dict:
    """0x003B — external heart-rate belt info."""
    if len(data) < 6:
        return {}
    return {
        "manufacturer_id": u16le(data, 0),
        "device_type":     u8(data, 2),
        "belt_id":         u24le(data, 3),
    }


# ---------------------------------------------------------------------------
# State enumerations (from the PM5 spec)
# ---------------------------------------------------------------------------
STROKE_STATE_WAITING  = 0
STROKE_STATE_RECOVERY = 1
STROKE_STATE_DRIVING  = 2
STROKE_STATE_DWELLING = 3
STROKE_STATE_RECOVERY2 = 4

ROWING_STATE_INACTIVE = 0
ROWING_STATE_ACTIVE   = 1

WORKOUT_STATE_WAITING_TO_BEGIN = 0
WORKOUT_STATE_WORKOUT_ROW      = 1
WORKOUT_STATE_COUNTDOWN_PAUSE  = 2
WORKOUT_STATE_INTERVAL_REST    = 3
WORKOUT_STATE_WORKOUT_END      = 10
WORKOUT_STATE_TERMINATE        = 11
WORKOUT_STATE_REBOOT           = 13
