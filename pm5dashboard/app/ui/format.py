"""Small formatting helpers for turning PM5 raw numbers into display text."""
from __future__ import annotations

from typing import Optional


def fmt_time(seconds: Optional[float]) -> str:
    if seconds is None or seconds < 0:
        return "—"
    seconds = float(seconds)
    if seconds >= 3600:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:04.1f}"
    m = int(seconds // 60)
    s = seconds - (m * 60)
    return f"{m}:{s:04.1f}" if m else f"{s:0.1f}"


def fmt_pace(pace_s: Optional[float]) -> str:
    if pace_s is None or pace_s <= 0 or pace_s > 3600:
        return "—"
    m = int(pace_s // 60)
    s = pace_s - (m * 60)
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
    if value is None:
        return "—"
    return f"{value:.{digits}f}"
