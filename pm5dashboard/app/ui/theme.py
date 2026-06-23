"""Central colour / typography definitions and the app-wide stylesheet."""
from __future__ import annotations

from PySide6.QtGui import QColor


# ---------------------------------------------------------------------------
# Palette — dark, clean, athletic
# ---------------------------------------------------------------------------
COLOR_BG_BASE       = "#0b0d12"
COLOR_BG_PANEL      = "#131722"
COLOR_BG_PANEL_HI   = "#1a1f2e"
COLOR_BG_CARD       = "#161b28"
COLOR_BORDER        = "#222838"
COLOR_BORDER_BRIGHT = "#2c3550"

COLOR_TEXT_PRIMARY   = "#e8ecf3"
COLOR_TEXT_SECONDARY = "#9ba7bd"
COLOR_TEXT_MUTED     = "#6b7793"

COLOR_ACCENT         = "#4cc2ff"   # cyan — force curve, primary accent
COLOR_ACCENT_2       = "#ff8f3c"   # amber — drive length
COLOR_ACCENT_3       = "#56f9b3"   # mint — ratio
COLOR_ACCENT_WARN    = "#ff6b6b"

COLOR_CURVE_CURRENT  = "#4cc2ff"
COLOR_CURVE_PREVIOUS = "#4cc2ff55"  # 33% alpha
COLOR_CURVE_FILL     = "#4cc2ff22"

COLOR_STATUS_CONNECTED    = "#56f9b3"
COLOR_STATUS_CONNECTING   = "#ffcc55"
COLOR_STATUS_DISCONNECTED = "#6b7793"
COLOR_STATUS_ERROR        = "#ff6b6b"


def qcolor(name: str, alpha: int = 255) -> QColor:
    c = QColor(name)
    c.setAlpha(alpha)
    return c


# ---------------------------------------------------------------------------
# Global stylesheet (Qt Style Sheets dialect, keep CSS simple)
# ---------------------------------------------------------------------------
STYLESHEET = f"""
* {{
    font-family: "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif;
    color: {COLOR_TEXT_PRIMARY};
}}

QWidget#AppRoot {{
    background-color: {COLOR_BG_BASE};
}}

QFrame[role="panel"] {{
    background-color: {COLOR_BG_PANEL};
    border: 1px solid {COLOR_BORDER};
    border-radius: 14px;
}}

QFrame[role="card"] {{
    background-color: {COLOR_BG_CARD};
    border: 1px solid {COLOR_BORDER};
    border-radius: 10px;
}}

QFrame[role="hero"] {{
    background-color: {COLOR_BG_PANEL};
    border: 1px solid {COLOR_BORDER_BRIGHT};
    border-radius: 16px;
}}

QLabel[role="title"] {{
    color: {COLOR_TEXT_MUTED};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
}}

QLabel[role="card-label"] {{
    color: {COLOR_TEXT_MUTED};
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.5px;
}}

QLabel[role="card-value"] {{
    color: {COLOR_TEXT_PRIMARY};
    font-size: 24px;
    font-weight: 600;
}}

QLabel[role="card-unit"] {{
    color: {COLOR_TEXT_SECONDARY};
    font-size: 11px;
    font-weight: 500;
}}

QLabel[role="hero-value"] {{
    color: {COLOR_TEXT_PRIMARY};
    font-size: 96px;
    font-weight: 700;
}}

QLabel[role="hero-label"] {{
    color: {COLOR_TEXT_MUTED};
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 3px;
}}

QLabel[role="hero-unit"] {{
    color: {COLOR_TEXT_SECONDARY};
    font-size: 16px;
    font-weight: 500;
}}

QLabel[role="ratio-sub"] {{
    color: {COLOR_TEXT_SECONDARY};
    font-size: 13px;
}}

QLabel[role="status"] {{
    color: {COLOR_TEXT_SECONDARY};
    font-size: 13px;
}}

QLabel[role="title-big"] {{
    color: {COLOR_TEXT_PRIMARY};
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
}}

QPushButton {{
    background-color: {COLOR_BG_PANEL_HI};
    color: {COLOR_TEXT_PRIMARY};
    border: 1px solid {COLOR_BORDER_BRIGHT};
    border-radius: 8px;
    padding: 7px 18px;
    font-size: 13px;
    font-weight: 600;
}}
QPushButton:hover {{
    background-color: #222a40;
    border-color: {COLOR_ACCENT};
}}
QPushButton:pressed {{
    background-color: #1a2030;
}}
QPushButton:disabled {{
    color: {COLOR_TEXT_MUTED};
    border-color: {COLOR_BORDER};
}}

QPushButton[accent="true"] {{
    background-color: {COLOR_ACCENT};
    color: #0b0d12;
    border: 1px solid {COLOR_ACCENT};
}}
QPushButton[accent="true"]:hover {{
    background-color: #6cd2ff;
}}
QPushButton[accent="true"]:disabled {{
    background-color: #2c3550;
    color: {COLOR_TEXT_MUTED};
    border-color: {COLOR_BORDER};
}}

QListWidget {{
    background-color: {COLOR_BG_BASE};
    border: 1px solid {COLOR_BORDER};
    border-radius: 8px;
    padding: 4px;
    outline: 0;
}}
QListWidget::item {{
    padding: 8px 10px;
    border-radius: 6px;
    color: {COLOR_TEXT_PRIMARY};
}}
QListWidget::item:selected {{
    background-color: #1e2a42;
    color: {COLOR_TEXT_PRIMARY};
}}
QListWidget::item:hover:!selected {{
    background-color: #161d2e;
}}

QDialog {{
    background-color: {COLOR_BG_BASE};
}}

QToolTip {{
    background-color: {COLOR_BG_PANEL_HI};
    color: {COLOR_TEXT_PRIMARY};
    border: 1px solid {COLOR_BORDER_BRIGHT};
    padding: 6px 8px;
}}

QScrollBar:vertical {{
    background: {COLOR_BG_BASE};
    width: 10px;
    margin: 0;
}}
QScrollBar::handle:vertical {{
    background: {COLOR_BORDER_BRIGHT};
    border-radius: 4px;
    min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{
    background: #3a466a;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0;
}}
"""
