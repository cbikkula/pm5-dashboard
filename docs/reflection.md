# Project reflection

A short, honest writeup of what I learned building PM5 Dashboard, what surprised me, and what I'd do differently if I started over.

## What I set out to do

I wanted real-time analytics from my Concept2 PM5 that the on-board monitor doesn't show — force-curve comparison, peak-force timing, HR drift — on a device I could actually use at school. ErgData and RowPro either lock those metrics behind paid tiers or won't install on a locked-down laptop. So I built it.

## What I learned

### Binary protocols teach you to read specs carefully

I spent an embarrassing amount of time chasing a bug where stroke rate, pace, and watts were all reading garbage. I'd skipped past the first three bytes of the General Status 1 BLE characteristic — they're an elapsed-time field, and once I aligned the rest of the layout against that, everything snapped into place. Lesson: when you're parsing a binary blob and the values look *almost* right, the bug is probably an offset error, not a logic error. Read the spec one more time before debugging.

### Browser APIs go further than you think

Going in, I assumed I'd need a "real" app to talk to Bluetooth hardware. Then I found Web Bluetooth — Chrome has had it for years. The same browser running on a $200 laptop talks to a PM5 over BLE, draws a 60-fps force curve on a canvas, signs me into Google for cloud sync, and installs as a home-screen icon on Android. **No installer, no app store, no backend.** That changed how I think about what's a "real" app. The web platform isn't a fallback anymore; for the right problem it's the best target.

### The hardest part wasn't BLE — it was layout

Parsing the protocol took a weekend. Designing a screen where a rower can *actually* read the numbers mid-stroke took months. Iterations:
- v1: tiny numbers, lots of metrics, looked like a dashboard you'd see on a NASA wall. Useless mid-row.
- v2: bigger numbers, fewer metrics, but every preset looked the same.
- v3: tier system. Each preset declares primary/secondary/passive tiers, the CSS scales typography by tier, the body class makes Race mode *feel* different from Heart Rate mode. Now a glance during a hard piece tells me what I actually need.

The technical depth is in the protocol; the product depth is in the UI hierarchy.

### State management without a framework was the right call

I almost reached for React when the file hit 5000 lines. I'm glad I didn't. A single `state` object + a `render()` function + plain DOM manipulation is harder to lose track of than I feared. The app is now one HTML file you can read top to bottom. Anyone — including me, six months from now — can open `index.html`, search for a metric name, and find the entire chain from BLE byte to on-screen pixel.

That tradeoff stops working at some scale, but I haven't hit it yet.

## What surprised me

- **Surge.sh exists.** $0/mo static hosting with one CLI command. I deploy to three mirror subdomains because I can.
- **The PM5 is more capable than its screen.** The monitor shows ~10 metrics; the BLE port exposes ~40. Most of what RowPro charges for is already in the wire.
- **Real-time canvas drawing is easy.** A quadratic-Bézier midpoint smoothing pass + DPR-aware scaling is ~30 lines of code and produces a curve that looks indistinguishable from the PM5's own.
- **Service workers are deeply weird.** Cache invalidation is the famous joke. I've bumped my cache version 19 times and I still hold my breath on every deploy.

## What I'd do differently

1. **Write the Python desktop version first, but only as a prototype.** The Python version did help me get the BLE protocol right in a debugger-friendly environment, but I sunk too much time polishing the Qt UI before realizing I needed the web version anyway. Sketch in Python; ship in the web.
2. **Set up git from day one.** The early commits in this repo don't reflect the early development — I didn't init the repo until much later. I lost the history of how the architecture evolved. Future projects: `git init` is the first command.
3. **Test on a phone earlier.** I built the layout for a 1440×900 laptop and only checked phone layouts after I'd shipped 6 versions. The card sizing system had to be retrofitted to be responsive. Mobile-first would've saved a rebuild.
4. **Plan multi-user from the start.** The data model in v1 assumed one user with one club. When I started thinking about Phase 2 (multiple coaches sharing lineups), every entity needed a stable ID and a foreign-key strategy. Doable but it was a big refactor. Future projects: stable IDs everywhere, even if there's only one user today.

## Security engineering — the part I'm proudest of

The multi-coach club system (v1.10.0–v1.11.x) taught me more than any other piece of this project. On Firebase's free plan there are no Cloud Functions, so there is **nowhere to put server-side logic** — the Firestore Security Rules are the *only* enforcement point. That constraint forces a different way of thinking: every access decision has to be expressible as a stateless rule evaluated against the document being written, and you have to assume the client is hostile. A signed-in user can craft any write they want; the rule is all that stands between them and the data.

I designed the rules first, then deliberately tried to break them. That adversarial pass found five real root-cause holes (a join that didn't validate its invite, a self-chosen athlete link, an availability null-trap, audit backdating, and revoked invites still being readable) — each one a case where I'd written a rule that *looked* right but allowed something it shouldn't. Closing them, then reviewing the client implementation across five more dimensions and fixing the bugs that surfaced, is documented in [`security.md`](security.md). The lesson that stuck: **"it works when I use it normally" and "it's secure" are completely different claims**, and only the second one matters once other people's data is involved.

## What's next

Real-time presence, workout assignment, and a read-only viewer role with signed session-sharing URLs. Eventually a Trusted Web Activity build for the Play Store. And maybe — if I get there — a multi-erg sync mode for team winter training, where 8 ergs paired to one coach screen produces a real-time crew synchronization view. That last one feels like it could be genuinely useful to coaches in a way nothing else on the market is.

---

*Charan Bikkula — June 2026.*
