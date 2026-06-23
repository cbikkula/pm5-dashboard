"""Top-of-window app header — title, connection status, connect button."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QWidget

from .. import theme


class _ConnectionDot(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._color = QColor(theme.COLOR_STATUS_DISCONNECTED)
        self.setFixedSize(14, 14)

    def set_color(self, color: str) -> None:
        self._color = QColor(color)
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(self._color.lighter(130))
        painter.drawEllipse(1, 1, 12, 12)
        halo = QColor(self._color)
        halo.setAlpha(70)
        painter.setBrush(halo)
        painter.drawEllipse(-2, -2, 18, 18)


class StatusHeader(QFrame):
    connect_clicked = Signal()
    disconnect_clicked = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setProperty("role", "panel")
        self.setFixedHeight(68)

        title = QLabel("PM5 DASHBOARD")
        title.setStyleSheet(
            f"color: {theme.COLOR_TEXT_PRIMARY}; font-size: 17px; "
            f"font-weight: 700; letter-spacing: 6px;"
        )

        subtitle = QLabel("Concept2 ergometer monitor")
        subtitle.setStyleSheet(
            f"color: {theme.COLOR_TEXT_MUTED}; font-size: 10px; letter-spacing: 2px;")

        self._dot = _ConnectionDot(self)
        self._status_label = QLabel("Not connected")
        self._status_label.setStyleSheet(
            f"color: {theme.COLOR_TEXT_SECONDARY}; font-size: 13px; font-weight: 600;")

        self._mode_label = QLabel("")
        self._mode_label.setStyleSheet(
            f"color: {theme.COLOR_TEXT_MUTED}; font-size: 11px; letter-spacing: 2px;")

        self._connect_btn = QPushButton("Connect")
        self._connect_btn.setProperty("accent", "true")
        self._connect_btn.clicked.connect(self._on_connect_clicked)

        left = QHBoxLayout()
        left.setSpacing(14)
        left_block = QWidget()
        left_v = QHBoxLayout(left_block)
        left_v.setContentsMargins(0, 0, 0, 0)
        left_v.setSpacing(12)
        left_v.addWidget(title)
        left_v.addWidget(subtitle)

        right_block = QWidget()
        right_v = QHBoxLayout(right_block)
        right_v.setContentsMargins(0, 0, 0, 0)
        right_v.setSpacing(12)
        right_v.addWidget(self._dot, 0, Qt.AlignmentFlag.AlignVCenter)
        right_v.addWidget(self._status_label, 0, Qt.AlignmentFlag.AlignVCenter)
        right_v.addWidget(self._mode_label, 0, Qt.AlignmentFlag.AlignVCenter)
        right_v.addSpacing(14)
        right_v.addWidget(self._connect_btn)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(22, 10, 22, 10)
        layout.addWidget(left_block, 0, Qt.AlignmentFlag.AlignVCenter)
        layout.addStretch(1)
        layout.addWidget(right_block, 0, Qt.AlignmentFlag.AlignVCenter)

        self.set_state("disconnected")

    # ------------------------------------------------------------------
    def set_state(self, state: str, detail: str = "") -> None:
        if state == "disconnected":
            self._dot.set_color(theme.COLOR_STATUS_DISCONNECTED)
            self._status_label.setText(detail or "Not connected")
            self._mode_label.setText("")
            self._connect_btn.setText("Connect")
            self._connect_btn.setEnabled(True)
        elif state == "connecting":
            self._dot.set_color(theme.COLOR_STATUS_CONNECTING)
            self._status_label.setText(detail or "Connecting…")
            self._mode_label.setText("")
            self._connect_btn.setText("Cancel")
            self._connect_btn.setEnabled(True)
        elif state == "connected-ble":
            self._dot.set_color(theme.COLOR_STATUS_CONNECTED)
            self._status_label.setText(detail or "Connected")
            self._mode_label.setText("BLUETOOTH")
            self._connect_btn.setText("Disconnect")
            self._connect_btn.setEnabled(True)
        elif state == "connected-usb":
            self._dot.set_color(theme.COLOR_STATUS_CONNECTED)
            self._status_label.setText(detail or "Connected")
            self._mode_label.setText("USB")
            self._connect_btn.setText("Disconnect")
            self._connect_btn.setEnabled(True)
        elif state == "error":
            self._dot.set_color(theme.COLOR_STATUS_ERROR)
            self._status_label.setText(detail or "Error")
            self._connect_btn.setText("Connect")
            self._connect_btn.setEnabled(True)

        self._state = state

    def _on_connect_clicked(self) -> None:
        if getattr(self, "_state", "disconnected") in ("connected-ble", "connected-usb"):
            self.disconnect_clicked.emit()
        else:
            self.connect_clicked.emit()
