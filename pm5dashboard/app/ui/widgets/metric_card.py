"""Small secondary-metric card widget.

Used for the minor stats (stroke rate, pace, HR, distance, etc.) that
sit in the side panels around the three hero panels.
"""
from __future__ import annotations

from typing import Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QLabel, QVBoxLayout


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

        self._unit_text = unit
        self._unit = QLabel(unit)
        self._unit.setProperty("role", "card-unit")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(2)
        layout.addWidget(self._label)
        layout.addWidget(self._value)
        layout.addWidget(self._unit)

    def set_value(self, value: Optional[str]) -> None:
        self._value.setText(value if value is not None else "—")

    def set_unit(self, unit: str) -> None:
        self._unit_text = unit
        self._unit.setText(unit)
