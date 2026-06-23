"""Application entry point.

We install a qasync event loop so Qt and asyncio share a single thread:
Bleak's notification callbacks land on the Qt main loop directly and
can emit signals without any cross-thread dispatch.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys

import qasync
from PySide6.QtGui import QPalette, QColor
from PySide6.QtWidgets import QApplication

from . import __app_name__
from .pm5.ble_client import PM5BleClient
from .pm5.usb_client import PM5UsbClient
from .state_controller import StateController
from .ui.main_window import MainWindow
from .ui.theme import STYLESHEET, COLOR_BG_BASE, COLOR_TEXT_PRIMARY


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-30s %(message)s",
        datefmt="%H:%M:%S",
    )
    # Bleak is chatty by default; quiet it down.
    logging.getLogger("bleak").setLevel(logging.WARNING)


def _apply_palette(app: QApplication) -> None:
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.Base, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.Text, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.Button, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(COLOR_TEXT_PRIMARY))
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(COLOR_BG_BASE))
    palette.setColor(QPalette.ColorRole.ToolTipText, QColor(COLOR_TEXT_PRIMARY))
    app.setPalette(palette)


def main() -> int:
    _configure_logging()

    app = QApplication(sys.argv)
    app.setApplicationName(__app_name__)
    app.setOrganizationName("PM5 Dashboard")
    app.setStyle("Fusion")
    _apply_palette(app)
    app.setStyleSheet(STYLESHEET)

    loop = qasync.QEventLoop(app)
    asyncio.set_event_loop(loop)

    # A future that resolves when Qt wants to quit — this is how we
    # bridge Qt's "last window closed" signal back into asyncio's
    # run_until_complete loop.
    quit_event = asyncio.Event()
    app.aboutToQuit.connect(quit_event.set)

    ble = PM5BleClient()
    usb = PM5UsbClient()
    controller = StateController(ble, usb)

    window = MainWindow(ble, usb, controller)
    window.show()

    # Allow Ctrl+C to terminate when run from a console on platforms
    # that support signal handlers in asyncio.
    if sys.platform != "win32":
        try:
            loop.add_signal_handler(signal.SIGINT, app.quit)
            loop.add_signal_handler(signal.SIGTERM, app.quit)
        except NotImplementedError:
            pass

    with loop:
        loop.run_until_complete(quit_event.wait())
    return 0


if __name__ == "__main__":
    sys.exit(main())
