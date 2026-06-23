# PM5 Dashboard

A Windows desktop app that connects to a Concept2 PM5 performance monitor
and displays a live, athletic-looking workout dashboard focused on three
hero metrics:

1. **Force Curve** (centre, dominant)
2. **Drive Length** (right hero panel)
3. **Ratio** (left hero panel, drive-to-recovery)

Every other scalar the PM5 exposes — stroke rate, pace/500m, power,
heart rate, distance, calories, drag factor, split pace, stroke count,
peak/average force, work per stroke, elapsed time — is shown in muted
side/bottom cards so it's available at a glance without competing with
the three focus metrics.

## Architecture

```
app/
├── main.py                 # QApplication + qasync event loop setup
├── state_controller.py     # Fold BLE+USB streams into one RowingState
├── pm5/
│   ├── uuids.py            # PM5 BLE UUIDs and USB VID/PIDs
│   ├── protocol.py         # Byte-level parsers for PM5 characteristics
│   ├── data_model.py       # RowingState dataclass (single source of truth)
│   ├── ble_client.py       # Bleak-based BLE client (primary path)
│   └── usb_client.py       # CSAFE-over-HID USB client (fallback)
└── ui/
    ├── main_window.py      # Layout & state-to-widget binding
    ├── theme.py            # Palette + global stylesheet
    ├── format.py           # fmt_time / fmt_pace / fmt_distance helpers
    ├── dialogs/
    │   └── connect_dialog.py   # Device scan + pick + connect dialog
    └── widgets/
        ├── force_curve.py      # pyqtgraph-based live curve (hero)
        ├── drive_length.py     # big readout + 0-2.5m bar (hero)
        ├── ratio.py            # big N.N:1 + drive/recovery bar (hero)
        ├── metric_card.py      # small secondary-stat card
        └── status_header.py    # top bar with connection state + button
```

The PM5 communication layer (`app/pm5/*`) is entirely independent of Qt
signals you use from the UI — it just emits them. The UI layer knows
nothing about Bleak, hidapi, or characteristic UUIDs: it only binds to
`StateController.state_changed` and renders the current `RowingState`.

Qt's event loop is run by **qasync** on top of asyncio, so Bleak's
native coroutines and Qt's GUI run on the same thread without any
cross-thread signalling headaches.

## Connection paths

- **Bluetooth (primary):** full feature set, including the three hero
  metrics. Uses the Concept2 PM Bluetooth Smart Interface Definition
  (service `ce060030-…`, stroke data characteristic `ce060035-…`, force
  curve characteristic `ce06003d-…`).
- **USB (fallback, scalar-only):** the app detects a PM5 on USB and
  speaks CSAFE over HID to read elapsed time, distance, stroke rate,
  pace, power, heart rate and calories. Force curve, drive length and
  ratio are displayed as *Bluetooth only* in USB mode — see
  `app/pm5/usb_client.py` for the rationale (force samples and drive/
  recovery timing require vendor-extension CSAFE frames whose full
  implementation is deliberately out of scope for this build).

When the user opens the connect dialog, both Bluetooth and USB devices
appear in one list. Bluetooth is preferred if the same erg shows up
both ways.

## Install (development / running from source)

Prerequisites:

- Windows 10 or 11 with a working Bluetooth LE radio (any built-in
  laptop radio from the last ~8 years is fine).
- Python 3.11 or 3.12 (`py -3.11 --version` to check). 3.10 also works.
- A Concept2 PM5 monitor. Wake it up by giving the handle a pull — the
  PM5's Bluetooth radio sleeps when idle.

```powershell
cd C:\code\musicapp\pm5dashboard
py -3.11 -m venv .venv
.venv\Scripts\pip install -U pip
.venv\Scripts\pip install -r requirements.txt
```

## Run from source

```powershell
cd C:\code\musicapp\pm5dashboard
run.bat
```

or equivalently:

```powershell
.venv\Scripts\python -m app
```

The app opens with a blank dashboard. Click **Connect**, pick your PM5
from the scan list, and start rowing. Metrics update in real time; the
Force Curve trace draws the current stroke in bright cyan with the
previous stroke faded behind it.

## Build a standalone .exe

From the project root:

```powershell
cd C:\code\musicapp\pm5dashboard
build_exe.bat
```

The script runs PyInstaller against `PM5Dashboard.spec` and drops a
single self-contained executable at `dist\PM5Dashboard.exe`. Double-
click it, no installer required. First launch is a few seconds slower
as PyInstaller's bootloader unpacks its bundle to a temp directory.

If you prefer to invoke PyInstaller manually:

```powershell
.venv\Scripts\pyinstaller --clean --noconfirm PM5Dashboard.spec
```

## Permissions / troubleshooting

- **No PM5 shows up in the Bluetooth scan:** the PM5 goes to sleep when
  idle. Pull the handle once or press the Menu button to wake it, then
  click Rescan. On Windows 11, make sure the app has been allowed to
  use Bluetooth the first time it scans (you'll see a system prompt).
- **USB device not detected:** the PM5 enumerates as a HID device under
  VID `0x17A4`. Make sure the cable is plugged into the PM5's USB port
  (not a PM5 charging port — rowers plug into the top of the monitor).
- **"Bluetooth support is not available":** bleak's WinRT backend
  failed to load. Usually a mismatched Python architecture — `bleak`
  needs 64-bit Python on 64-bit Windows.
- **App freezes briefly on Connect:** the initial BLE scan runs for up
  to 8 seconds. This is deliberate — BLE advertisements are sparse and
  we want to give the PM5 a fair chance to be seen.

## PM5 protocol notes and assumptions

The parsers in `app/pm5/protocol.py` follow the Concept2 PM Bluetooth
Smart Interface Definition. A few practical notes:

- **Stroke Data characteristic (0x0035)** is parsed at byte offsets
  matching the 20-byte payload documented by Concept2. Some early PM5
  firmware revisions shipped a 19-byte layout; the parser tolerates
  both (the stroke count in the last byte is optional).
- **Force Curve characteristic (0x003D)** is treated as streaming
  per-stroke notifications. The header byte encodes the sample count
  in the high nibble and the sequence number in the low nibble. We
  assume little-endian uint16 samples at 0.1 lbf resolution; if the
  payload is too short for that assumption we fall back to 1-byte
  samples.
- **Stroke-ended detection:** the spec doesn't send an explicit "end
  of stroke" marker on the force curve characteristic; the next
  stroke's seq=0 packet marks the boundary. We also use the arrival
  of the Stroke Data notification as an authoritative end-of-stroke
  signal to flush the accumulated curve, because the Stroke Data
  characteristic only fires after the force samples have finished
  streaming.
- **Ratio** is computed as `recovery_time_s / drive_time_s` — the
  traditional Concept2 drive-to-recovery ratio (a ratio of 2.5:1 means
  the recovery took 2.5× as long as the drive).
- **Sample rate:** on connect we write `2` (250 ms) to the rate control
  characteristic `0x0034`. This is best-effort — a few firmwares refuse
  the write, in which case we fall through to whatever the PM5's
  default rate is.
- **USB/CSAFE:** over USB we speak standard CSAFE long commands
  (`0xA0` GETTIME, `0xA1` GETHORIZ, `0xA3` GETCALS, `0xA6` GETPACE,
  `0xA7` GETCADENCE, `0xB0` GETHRCUR, `0xB4` GETPOWER). Force samples,
  drive length and drive/recovery timing require PM-extension frames
  and are intentionally not implemented on the USB path.
- No mock/fake data is generated anywhere in the application. When a
  datum isn't available the UI shows `—` and never fabricates a value.

## License

Provided as-is for personal use. Concept2 and PM5 are trademarks of
Concept2, Inc.; this project is not affiliated with or endorsed by
Concept2.
