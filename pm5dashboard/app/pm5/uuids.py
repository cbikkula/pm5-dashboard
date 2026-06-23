"""Concept2 PM5 Bluetooth Low Energy GATT UUIDs.

All UUIDs share the base form `ce06XXXX-43e5-11e4-916c-0800200c9a66` where
`XXXX` identifies the service or characteristic. Values come from the
Concept2 PM Bluetooth Smart Interface Definition document (the public
PM5 BLE specification).
"""

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------
SERVICE_DEVICE_DISCOVERY = "ce060000-43e5-11e4-916c-0800200c9a66"
SERVICE_DEVICE_INFO      = "ce060010-43e5-11e4-916c-0800200c9a66"
SERVICE_CONTROL          = "ce060020-43e5-11e4-916c-0800200c9a66"
SERVICE_ROWING           = "ce060030-43e5-11e4-916c-0800200c9a66"

# ---------------------------------------------------------------------------
# Device Information characteristics
# ---------------------------------------------------------------------------
CHAR_MODULE_NUMBER = "ce060011-43e5-11e4-916c-0800200c9a66"
CHAR_SERIAL_NUMBER = "ce060012-43e5-11e4-916c-0800200c9a66"
CHAR_HARDWARE_REV  = "ce060013-43e5-11e4-916c-0800200c9a66"
CHAR_FIRMWARE_REV  = "ce060014-43e5-11e4-916c-0800200c9a66"
CHAR_MANUFACTURER  = "ce060015-43e5-11e4-916c-0800200c9a66"

# ---------------------------------------------------------------------------
# Rowing service characteristics
# ---------------------------------------------------------------------------
CHAR_GENERAL_STATUS   = "ce060031-43e5-11e4-916c-0800200c9a66"  # elapsed, distance, state, drag
CHAR_GENERAL_STATUS_1 = "ce060032-43e5-11e4-916c-0800200c9a66"  # speed, SR, HR, pace
CHAR_GENERAL_STATUS_2 = "ce060033-43e5-11e4-916c-0800200c9a66"  # power, calories, splits
CHAR_RATE_CONTROL     = "ce060034-43e5-11e4-916c-0800200c9a66"  # writable: update rate
CHAR_STROKE_DATA      = "ce060035-43e5-11e4-916c-0800200c9a66"  # stroke timings + per-stroke forces
CHAR_STROKE_DATA_1    = "ce060036-43e5-11e4-916c-0800200c9a66"  # additional stroke metrics
CHAR_SPLIT_DATA       = "ce060037-43e5-11e4-916c-0800200c9a66"
CHAR_SPLIT_DATA_1     = "ce060038-43e5-11e4-916c-0800200c9a66"
CHAR_END_WORKOUT      = "ce060039-43e5-11e4-916c-0800200c9a66"
CHAR_END_WORKOUT_1    = "ce06003a-43e5-11e4-916c-0800200c9a66"
CHAR_HEART_RATE_BELT  = "ce06003b-43e5-11e4-916c-0800200c9a66"
CHAR_FORCE_CURVE      = "ce06003d-43e5-11e4-916c-0800200c9a66"  # per-stroke force samples
CHAR_MULTIPLEXED      = "ce060080-43e5-11e4-916c-0800200c9a66"

# ---------------------------------------------------------------------------
# Sample-rate codes for CHAR_RATE_CONTROL
# ---------------------------------------------------------------------------
RATE_1S    = 0
RATE_500MS = 1
RATE_250MS = 2
RATE_100MS = 3

# Concept2's USB HID vendor ID, plus the PIDs of the PM5 family.
USB_VID_CONCEPT2 = 0x17A4
USB_PIDS_PM5 = (0x0001, 0x0002, 0x0003, 0x0004)
