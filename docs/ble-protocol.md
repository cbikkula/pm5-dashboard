# Parsing the PM5 BLE protocol

The Concept2 PM5 monitor publishes erg data over BLE GATT. This is my working notes on the byte layouts, derived from Concept2's official "PM5 Communication Interface Definition" spec (revision 1.30 at the time of writing) and confirmed against live captures.

The official spec is on the [Concept2 Developers page](https://www.concept2.com/service/monitors/pm5/developers). The numbers below are my parser implementation, not the spec verbatim.

## Service & characteristics

Everything lives under one service:

```
0xCE060030-43E5-11E4-916C-0800200C9A66   PM5 ERG data service
```

The characteristics I subscribe to:

| Name              | UUID (last 4 hex) | Purpose                              |
|-------------------|-------------------|--------------------------------------|
| General Status 1  | `0032`            | Elapsed time, distance, drag, state  |
| General Status 2  | `0033`            | Stroke rate, HR, pace, watts, splits |
| Stroke Data       | `0035`            | Drive length, drive time, work/stroke, peak/avg force |
| Force Curve       | `003D`            | Per-stroke sample buffer             |

All four are NOTIFY characteristics — once you write `0x0100` to the CCCD descriptor, the PM5 pushes new packets whenever the data updates.

## General Status 1 (`0032`)

17 bytes, little-endian. Layout:

| Offset | Size | Field                  | Notes |
|:------:|:----:|------------------------|-------|
| 0      | 3    | Elapsed time           | 0.01 s units (u24) |
| 3      | 3    | Distance               | 0.1 m units (u24) |
| 6      | 1    | Workout type           | enum |
| 7      | 1    | Interval type          | enum |
| 8      | 1    | Workout state          | enum (10 = WORKOUT_END, 11 = TERMINATE) |
| 9      | 1    | Rowing state           | |
| 10     | 1    | Stroke state           | 0–4 |
| 11     | 3    | Total work distance    | u24 |
| 14     | 3    | Workout duration       | u24 |
| 17     | 1    | Workout duration type  | enum |

**My off-by-3 bug:** my first cut at this parser put stroke rate, pace, and watts at offsets 0–2 because I forgot the 3-byte elapsed-time prefix. The whole stroke characteristic was reading garbage. Took me too long to figure out — the values *looked* almost reasonable, just always shifted by ~3 seconds of accumulated time.

## General Status 2 (`0033`)

20 bytes, little-endian. The same 3-byte elapsed-time prefix:

| Offset | Size | Field                  | Notes |
|:------:|:----:|------------------------|-------|
| 0      | 3    | Elapsed time           | 0.01 s units (same as GS1) |
| 3      | 1    | Speed                  | 0.001 m/s? |
| 4      | 1    | Stroke rate            | strokes / min |
| 5      | 1    | Heart rate             | bpm — 255 means "no strap" |
| 6      | 2    | Current pace           | 0.01 s per 500m (u16) |
| 8      | 2    | Average pace           | u16 |
| 10     | 2    | Rest distance          | u16 |
| 12     | 3    | Rest time              | 0.01 s units (u24) |
| 15     | 1    | Erg machine type       | |
| …      |      |                        | |

The HR-no-strap value of 255 needs an explicit filter — early versions of my code happily displayed "Heart Rate: 255 bpm" when no strap was paired. I now also bound-check `30 ≤ hr ≤ 240` because some flaky straps emit garbage spikes.

## Stroke Data (`0035`)

Fires once per stroke (on the recovery / catch transition). 20 bytes:

| Offset | Size | Field                   | Notes |
|:------:|:----:|-------------------------|-------|
| 0      | 3    | Elapsed time            | When this stroke ended |
| 3      | 3    | Distance                | 0.1 m units |
| 6      | 1    | Drive length            | 0.01 m units → metres |
| 7      | 1    | Drive time              | 0.01 s units |
| 8      | 2    | Stroke recovery time    | u16 |
| 10     | 2    | Stroke distance         | u16, 0.01 m per stroke |
| 12     | 2    | Peak force              | u16, 0.1 lbf |
| 14     | 2    | Average force           | u16, 0.1 lbf |
| 16     | 2    | Work / stroke           | u16, 0.1 J |
| 18     | 2    | Stroke count            | u16 |

**My drive_time bug:** the spec says drive time is 1 byte (0.01 s units, so 0–2.55 s — plenty of range for any human stroke). My first implementation read it as 2 bytes, which silently consumed the next field and shifted everything downstream. Fixed by counting bytes against the official 20-byte payload total.

## Force Curve (`003D`)

This is where it gets fun. Force curve packets are **fragmented**:

- The first byte is the **sequence number** (or, in the original spec, a "packet number" — same thing).
- Subsequent bytes are 8-bit force samples (lbf, no unit conversion).
- Sequence 0 marks the start of a new stroke's curve.
- Sequence 1, 2, … continue the same curve.

In my parser, when seq === 0 arrives AND there's buffered samples from a previous stroke, that previous stroke is complete — I commit it (rotate into `state.forceCurve`, update the best/avg buffers) and start fresh.

```js
function applyForceCurvePacket(d) {
  const { seq, samples } = parseForceCurve(d);
  if (seq < 0) return;
  if (seq === 0) {
    if (_curCurve.length) {
      commitCompletedStroke(_curCurve);
      state.previousForceCurve = state.forceCurve;
      state.forceCurve = _curCurve.slice();
    }
    _curCurve = [];
    state.liveForceCurve = [];
  }
  for (const s of samples) {
    _curCurve.push(s);
    state.liveForceCurve.push(s);
  }
}
```

Stroke lengths vary widely — typical strokes give me 24–40 samples, sprint efforts can be shorter. The renderer handles variable-length curves natively; the best/avg overlay buffers normalize to a fixed 64 samples (see [architecture.md](architecture.md)).

## What's not in the parser

The spec defines a bunch more characteristics I don't bother with: handshake / device info, workout setup, force curve scaling factors, additional split data. For a real-time dashboard the four characteristics above cover everything I need. Adding more would just clutter the renderer with metrics nobody reads mid-stroke.
