"""Hero widget — drive-to-recovery ratio.

The ratio is rendered as a large "N.N:1" readout plus a horizontal
balance bar that visually splits drive vs recovery time. The balance
bar is the quick-glance cue during a workout: a short left-hand drive
segment and a long right-hand recovery segment is what most coaches
aim for (typical target 1:2 through 1:2.5).
"""
from __future__ import annotations

from typing import Optional

from PySide6.QtCore import Qt, QRectF
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget

from .. import theme


class _RatioBar(QWidget):
    """Horizontal split bar showing drive vs recovery proportion."""

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
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

        rect = QRectF(self.rect()).adjusted(1, 8, -1, -8)
        radius = rect.height() / 2

        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(theme.COLOR_BG_CARD))
        painter.drawRoundedRect(rect, radius, radius)

        drive = self._drive or 0.0
        recovery = self._recovery or 0.0
        total = drive + recovery
        if total > 0:
            drive_frac = drive / total
            split_x = rect.left() + rect.width() * drive_frac
            drive_rect = QRectF(rect.left(), rect.top(),
                                 split_x - rect.left(), rect.height())
            rec_rect = QRectF(split_x, rect.top(),
                               rect.right() - split_x, rect.height())

            painter.setBrush(QColor(86, 249, 179, 220))  # mint — drive
            painter.drawRoundedRect(drive_rect, radius, radius)
            painter.setBrush(QColor(76, 194, 255, 190))  # cyan — recovery
            painter.drawRoundedRect(rec_rect, radius, radius)

            # Subtle divider
            painter.setPen(QPen(QColor(11, 13, 18, 200), 2))
            painter.drawLine(split_x, rect.top() + 2, split_x, rect.bottom() - 2)

        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setPen(QPen(QColor(theme.COLOR_BORDER_BRIGHT), 1))
        painter.drawRoundedRect(rect, radius, radius)

        # Labels
        label_pen = QPen(QColor(theme.COLOR_TEXT_MUTED))
        painter.setPen(label_pen)
        label_rect = QRectF(self.rect())
        label_rect.setTop(rect.bottom() + 2)
        label_rect.setHeight(14)
        painter.drawText(QRectF(label_rect.left() + 4, label_rect.top(),
                                  label_rect.width() / 2 - 4, label_rect.height()),
                          int(Qt.AlignmentFlag.AlignLeft),
                          "DRIVE")
        painter.drawText(QRectF(label_rect.left() + label_rect.width() / 2,
                                  label_rect.top(),
                                  label_rect.width() / 2 - 4, label_rect.height()),
                          int(Qt.AlignmentFlag.AlignRight),
                          "RECOVERY")


class RatioWidget(QFrame):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")

        label = QLabel("RATIO")
        label.setProperty("role", "hero-label")

        self._value = QLabel("—")
        self._value.setProperty("role", "hero-value")
        self._value.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self._value.setStyleSheet(f"color: {theme.COLOR_ACCENT_3};")

        self._unit = QLabel(": 1")
        self._unit.setProperty("role", "hero-unit")
        self._unit.setStyleSheet(f"color: {theme.COLOR_TEXT_SECONDARY};")

        self._sub = QLabel("drive vs recovery")
        self._sub.setProperty("role", "ratio-sub")

        self._times = QLabel("drive — · recovery —")
        self._times.setProperty("role", "ratio-sub")

        self._bar = _RatioBar(self)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 18)
        layout.setSpacing(4)
        layout.addWidget(label)
        layout.addStretch(1)
        layout.addWidget(self._value)
        layout.addWidget(self._unit)
        layout.addSpacing(4)
        layout.addWidget(self._sub)
        layout.addWidget(self._times)
        layout.addStretch(1)
        layout.addWidget(self._bar)
        layout.addSpacing(14)  # room for the DRIVE/RECOVERY caption text

    def set_ratio(self, ratio: Optional[float],
                   drive_s: Optional[float],
                   recovery_s: Optional[float],
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
        quality = self._describe(ratio)
        self._sub.setText(quality)
        d_txt = f"{drive_s:.2f}s" if drive_s else "—"
        r_txt = f"{recovery_s:.2f}s" if recovery_s else "—"
        self._times.setText(f"drive {d_txt}  ·  recovery {r_txt}")
        self._bar.set_times(drive_s, recovery_s)

    @staticmethod
    def _describe(ratio: float) -> str:
        # Very rough coaching hint, kept deliberately neutral.
        if ratio < 1.2:
            return "rushing recovery — longer recovery advised"
        if ratio < 1.8:
            return "short ratio"
        if ratio <= 2.6:
            return "in the usual coaching band"
        if ratio <= 3.2:
            return "long ratio"
        return "very long recovery"
