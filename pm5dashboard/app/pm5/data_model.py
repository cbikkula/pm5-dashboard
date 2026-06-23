"""Immutable-ish snapshot of the rowing state shown in the UI.

The BLE client emits per-characteristic updates, the USB client emits
scalar updates, and the StateController (in state_controller.py) folds
both into a single `RowingState` that the widgets consume. Keeping all
the fields in one dataclass makes it straightforward to add new metrics
later without touching every widget.

Units: as reported by the PM5 (seconds, metres, lbs-force, watts, bpm).
The UI layer is responsible for formatting for display (pace as m:ss,
drive length in decimeters, etc).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class RowingState:
    # --- Three "hero" metrics -----------------------------------------
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

    # --- Derived metric -----------------------------------------------
    @property
    def ratio(self) -> Optional[float]:
        """Drive-to-recovery ratio, expressed as recovery / drive.

        This is the value Concept2 displays as the "ratio" metric on the
        PM5 (a 2.5:1 ratio means recovery is 2.5× as long as the drive).
        Returns None if either half of the stroke hasn't been measured
        yet.
        """
        if self.drive_time_s and self.drive_time_s > 0 and self.recovery_time_s:
            return self.recovery_time_s / self.drive_time_s
        return None
