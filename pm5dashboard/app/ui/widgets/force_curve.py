"""Live Force Curve plot — the centrepiece of the dashboard.

Two traces are drawn:
  * the *current* stroke as an anti-aliased filled curve in the accent
    colour;
  * the *previous* stroke in a muted tone as a reference.

We use pyqtgraph for its efficient batched drawing — it can redraw a
curve every frame without measurably touching the main thread.
"""
from __future__ import annotations

from typing import List

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import Qt
from PySide6.QtGui import QBrush, QColor, QFont
from PySide6.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget

from .. import theme


class ForceCurveWidget(QFrame):
    # The PM5's native force curve is rendered in a ≈ 2.5:1 (W:H)
    # rectangle. Locking to that ratio keeps the curve's shape faithful
    # to what the erg shows. We enforce the ratio by capping the
    # widget's maximum height based on its current width, so the bottom
    # border of the panel sits right under the "Stroke progress" axis
    # label — no dead space below the graph.
    PLOT_ASPECT = 2.5
    _HEADER_PX = 54
    _V_MARGIN_PX = 32
    _H_MARGIN_PX = 40

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "hero")

        pg.setConfigOptions(antialias=True, useOpenGL=False)

        title = QLabel("FORCE CURVE")
        title.setProperty("role", "title-big")
        title.setStyleSheet(
            f"color: {theme.COLOR_TEXT_MUTED}; "
            f"letter-spacing: 4px; font-weight: 700;"
        )

        self._hint = QLabel("waiting for first stroke…")
        self._hint.setProperty("role", "ratio-sub")
        self._hint.setAlignment(Qt.AlignmentFlag.AlignRight)

        header = QVBoxLayout()
        header.setSpacing(2)
        header.addWidget(title)
        header.addWidget(self._hint)

        self._plot = pg.PlotWidget()
        self._plot.setBackground(QColor(theme.COLOR_BG_PANEL))
        self._plot.setMouseEnabled(x=False, y=False)
        self._plot.setMenuEnabled(False)
        self._plot.hideButtons()
        self._plot.showGrid(x=True, y=True, alpha=0.08)

        left_axis = self._plot.getAxis("left")
        bottom_axis = self._plot.getAxis("bottom")
        axis_pen = pg.mkPen(QColor(theme.COLOR_BORDER_BRIGHT))
        text_pen = pg.mkPen(QColor(theme.COLOR_TEXT_MUTED))
        font = QFont()
        font.setPointSize(9)
        for axis in (left_axis, bottom_axis):
            axis.setPen(axis_pen)
            axis.setTextPen(text_pen)
            axis.setStyle(tickFont=font, tickLength=-6, tickTextOffset=8)
        left_axis.setLabel(
            "Force", units="lbf",
            **{"color": theme.COLOR_TEXT_MUTED, "font-size": "10pt"},
        )
        bottom_axis.setLabel(
            "Stroke progress",
            **{"color": theme.COLOR_TEXT_MUTED, "font-size": "10pt"},
        )

        # Previous stroke — muted reference, drawn behind the live trace.
        self._prev_curve = self._plot.plot(
            [], [],
            pen=pg.mkPen(QColor(76, 194, 255, 85), width=2, style=Qt.PenStyle.SolidLine),
            name="previous",
        )

        # Current stroke — bright cyan with a soft fill underneath.
        self._curr_curve = self._plot.plot(
            [], [],
            pen=pg.mkPen(QColor(theme.COLOR_CURVE_CURRENT), width=3, cosmetic=True),
            fillLevel=0.0,
            fillBrush=QBrush(QColor(76, 194, 255, 40)),
            name="current",
        )

        self._plot.setXRange(0, 40, padding=0.02)
        self._plot.setYRange(0, 220, padding=0.02)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(8)
        layout.addLayout(header)
        layout.addWidget(self._plot, 1)

    def resizeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        super().resizeEvent(event)
        inner_w = max(0, self.width() - self._H_MARGIN_PX)
        if inner_w <= 0:
            return
        target = int(inner_w / self.PLOT_ASPECT) + self._HEADER_PX + self._V_MARGIN_PX
        if target != self.maximumHeight():
            self.setMaximumHeight(target)

    # ------------------------------------------------------------------
    def set_hint(self, text: str) -> None:
        self._hint.setText(text)

    def update_curves(self, live: List[float], previous: List[float]) -> None:
        if live:
            xs = np.arange(len(live), dtype=np.float32)
            ys = np.asarray(live, dtype=np.float32)
            self._curr_curve.setData(xs, ys)
            x_max = max(40, len(live) + 4)
            y_peak = float(ys.max()) if len(ys) else 0.0
            y_max = max(220.0, y_peak * 1.15)
            self._plot.setXRange(0, x_max, padding=0.02)
            self._plot.setYRange(0, y_max, padding=0.02)
        else:
            self._curr_curve.setData([], [])

        if previous:
            xs = np.arange(len(previous), dtype=np.float32)
            self._prev_curve.setData(xs, np.asarray(previous, dtype=np.float32))
        else:
            self._prev_curve.setData([], [])
