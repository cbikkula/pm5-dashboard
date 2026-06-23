"""Hero widget — Drive Length.

Shows the measured drive length in metres (with a secondary centimetre
readout for precision) and a horizontal bar indicating where the
current stroke sits relative to the PM5's 0-to-2.5m scale.
"""
from __future__ import annotations

from typing import Optional

from PySide6.QtCore import Qt, QRectF
from PySide6.QtGui import QColor, QPainter, QPen, QLinearGradient
from PySide6.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget

from .. import theme


class _DriveLengthBar(QWidget):
    """A slim horizontal bar that marks drive length on a 0-2.5m scale."""

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
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

        rect = QRectF(self.rect()).adjusted(1.5, 3.5, -1.5, -3.5)

        # Background track
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(theme.COLOR_BG_CARD))
        painter.drawRoundedRect(rect, rect.height() / 2, rect.height() / 2)

        # Ideal-range highlight (muted amber tint)
        ideal_x1 = rect.left() + rect.width() * (self.IDEAL_MIN / 2.5)
        ideal_x2 = rect.left() + rect.width() * (self.IDEAL_MAX / 2.5)
        ideal_rect = QRectF(ideal_x1, rect.top(),
                             ideal_x2 - ideal_x1, rect.height())
        painter.setBrush(QColor(255, 143, 60, 55))
        painter.drawRoundedRect(ideal_rect,
                                 rect.height() / 2, rect.height() / 2)

        # Value fill
        if self._value and self._value > 0:
            pct = min(self._value / 2.5, 1.0)
            fill_rect = QRectF(rect.left(), rect.top(),
                                rect.width() * pct, rect.height())
            grad = QLinearGradient(rect.left(), 0, rect.right(), 0)
            grad.setColorAt(0.0, QColor(255, 143, 60, 210))
            grad.setColorAt(1.0, QColor(255, 196, 120, 230))
            painter.setBrush(grad)
            painter.drawRoundedRect(fill_rect,
                                     rect.height() / 2, rect.height() / 2)

        # Border
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setPen(QPen(QColor(theme.COLOR_BORDER_BRIGHT), 1))
        painter.drawRoundedRect(rect, rect.height() / 2, rect.height() / 2)


class DriveLengthWidget(QFrame):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")

        label = QLabel("DRIVE LENGTH")
        label.setProperty("role", "hero-label")

        self._value = QLabel("—")
        self._value.setProperty("role", "hero-value")
        self._value.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self._value.setStyleSheet(f"color: {theme.COLOR_ACCENT_2};")

        self._unit = QLabel("m")
        self._unit.setProperty("role", "hero-unit")
        self._unit.setStyleSheet(f"color: {theme.COLOR_TEXT_SECONDARY};")

        self._secondary = QLabel("— cm")
        self._secondary.setProperty("role", "ratio-sub")

        self._bar = _DriveLengthBar(self)

        self._scale = QLabel("0.0 m                                   2.5 m")
        self._scale.setStyleSheet(f"color: {theme.COLOR_TEXT_MUTED}; "
                                   f"font-size: 10px; letter-spacing: 1.5px;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 18)
        layout.setSpacing(4)
        layout.addWidget(label)
        layout.addStretch(1)
        layout.addWidget(self._value)
        layout.addWidget(self._unit)
        layout.addSpacing(4)
        layout.addWidget(self._secondary)
        layout.addStretch(1)
        layout.addWidget(self._bar)
        layout.addWidget(self._scale)

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
