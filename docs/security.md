# Security model

How access control works in the multi-coach club system — and how I tried to break it before shipping.

The short version: **there is no server.** PM5 Dashboard runs on Firebase's free Spark plan, which has no Cloud Functions, so there is nowhere to run server-side authorization logic. The [Firestore Security Rules](../firestore.rules) are the *only* enforcement point. They are the backend. Everything below is about making 220 lines of rules airtight, because a signed-in user can send any write they want and the rule is all that stands between them and other people's data.

---

## Threat model

**Who the attacker is.** Any authenticated user. Google sign-in is easy to obtain, so "is signed in" proves almost nothing. The interesting attacker is a *legitimate club member* — a coach or athlete who has real access and tries to exceed it (read another club, promote themselves, forge history, delete things they shouldn't).

**What they can do.** Talk directly to Firestore with the public web SDK and craft arbitrary reads/writes — they are not limited to what the UI offers. So **client-side checks are UX, not security.** The app mirrors the rules in a `fbCan()` permission engine purely so the interface doesn't offer actions the server will reject; it is never the thing that stops them.

**What we're protecting.** Club data (roster, lineups, equipment), the membership graph (who has what role), invite tokens, and an audit trail that has to be trustworthy.

**The hard constraint.** No Cloud Functions ⇒ no server-side validation, no atomic counters, no privileged admin code path. Every rule is evaluated statelessly against the single document being written, plus a small number of `get()`/`exists()` lookups. If a check can't be expressed that way, it can't be enforced at all.

---

## Design decisions

### Members ≠ athletes
A **member** (`clubs/{id}/members/{uid}`) is a login with a role. An **athlete** (`clubs/{id}/athletes/{athleteId}`) is a rowable roster entry that exists whether or not a real person ever logs in. A member may be *linked* to an athlete (so they become seatable in lineups and can mark their own availability) — but **linking is owner/admin-only and happens after approval.** A joiner can never self-link, because self-linking would let an athlete impersonate any roster entry and write that athlete's availability.

### Roles, capped
`owner → admin → coach → athlete`. Coaches manage the roster + lineups (subcollections). Admins additionally manage the club doc, members, and invites. Only the **owner** can mint admins or transfer ownership. Crucially, **admins cannot escalate**: the rule forbids an admin from setting any member's role to `admin` or `owner`, or touching the owner's row.

### Athletes as a subcollection
The roster originally lived as an array inside the club doc. But the club doc is owner/admin-writable only, which would lock coaches out of roster editing. Moving athletes into their own subcollection (write = coach+) fixed that. This migration is also a worked example of the kind of refactor that's only safe because every entity had a stable `id` from day one.

### The Firebase web API key is *public by design*
The `apiKey` in the client is not a secret. A Firebase **web** key only identifies the project; it grants no data access. Security comes from the rules + Auth authorized domains + per-user identity, **not** from hiding the key — Google's own docs say it is safe to commit. It is kept out of the repo (a gitignored `firebase-config.js`) only to avoid secret-scanner noise and keep the source clean, not because exposure would compromise anything. Reasoning about *why* a flagged "secret" isn't one is itself part of the security work.

---

## How the rules enforce it

A few of the load-bearing rules, in plain language (see [`firestore.rules`](../firestore.rules) for the exact source):

**Joining a club** is the most attacked write. A user may create **only their own** member row, and only as `pending`, and only if they present a valid `inviteCode` whose role matches the role they're requesting. The rule `get()`s the invite doc and checks it exists, isn't revoked, isn't expired, and matches — *on the write itself*. This is the only place invite validity can be enforced without a server.

```
allow create: if signedIn() && uid() == memberUid && (
  // (a) the club creator bootstraps their own owner/active row
  (isOwner(clubId) && role == 'owner' && status == 'active')
  ||
  // (b) an invite-validated pending join — never owner, never self-linked
  (status == 'pending' && role != 'owner' && linkedAthleteId == null
   && validJoinInvite(clubId, inviteCode, role))
);
```

**Invites are bearer tokens.** The doc id *is* an unguessable code. A holder can `get` an invite **only while it is valid** — the rule hides revoked/expired invites, so a leaked-then-revoked code can't seed a join. `list` is owner/admin-only, so codes can't be enumerated. Creation is role-capped (an admin can't mint an admin invite; nobody mints an owner invite).

**The audit log is append-only and un-forgeable.** A member may `create` an entry only with `actorUid == their own uid` and `createdAt == request.time` (the server clock) — so history can't be backdated or attributed to someone else. `update` and `delete` are denied to **everyone, including the owner.** History you can edit isn't history.

**Availability** can be written by coaches+ for anyone, or by an athlete for *only* their own linked athlete — and the update/delete rules check the *existing* document's owner (`resource.data`), not just the incoming value, so you can't overwrite someone else's row by supplying your own id in the payload.

**Workout assignments** *(v1.13)* use the same access shape as lineups: any **active** member may read, only **coach+** may write. Suspended/removed members fail `isActiveMember` and lose access; non-members are denied. Athletes never get write access, so they can view but never create/edit/delete an assignment. Two deliberate boundaries: (1) **athlete-relevance is filtered client-side, not at the rules layer** — like lineups, every active member can technically read all of their club's assignments, and `athleteSeesAssignment()` narrows the *display* to the ones that target them; tightening this to per-doc rules would need each assignment to re-`get()` the athlete's lineups/teams, which Spark-plan rules can't do cheaply. (2) The **private `coachNote` is not protected by rules** — it's a field on a doc all members can read, so confidentiality is enforced by the client only stripping it in `formatAssignmentAthlete()`. A determined athlete reading raw Firestore could see it; for genuinely private coach notes, a paid plan + a callable that returns an athlete-safe projection would be the fix.

---

## Adversarial reviews

I didn't trust myself to write these correctly the first time, so the rules and the client were each put through a deliberate try-to-break-it pass. Two separate reviews, two separate scopes — listed here so the claims are auditable rather than vibes.

### Review 1 — the rules (5 root-cause holes, all closed)
After writing the rules, I attacked them as a malicious member. Five real holes, each a rule that looked right but allowed something it shouldn't:

| # | Hole | Fix |
|---|------|-----|
| 1 | **Join wasn't invite-validated** — any signed-in user could self-create a member row | `validJoinInvite()` re-reads + checks the invite on the join write |
| 2 | **Self-chosen athlete link** — a joiner could set `linkedAthleteId` to any athlete | `linkedAthleteId == null` required at join; linking is admin-only, post-approval |
| 3 | **Availability null-trap + no existing-doc check** — a member could edit others' availability | split create/update/delete; verify `resource.data.athleteId` (the existing owner) |
| 4 | **Audit backdating** — `createdAt` was client-supplied | pinned to `request.time` |
| 5 | **Revoked invites still readable** — a revoked code could still seed a join | `get` hides revoked/expired invites |

A sixth fix followed during implementation: the club **owner-bootstrap** path (the creator writing their own `owner` row right after creating the club) had to be explicitly allowed, since the generic join rule forbids `role == 'owner'`.

### Review 2 — the client (5 dimensions, 12 bugs found + fixed)
The rules being correct doesn't make the *client* correct — a client can still corrupt data, leak state between users, or offer actions that silently fail. Before release I reviewed the v1.11.0 client across five dimensions and fixed every confirmed finding:

- **Rule/client mismatch** — e.g. an admin's club-doc write that dropped the immutable `ownerId` before the first snapshot hydrated it (rejected by the rules); a legacy owner with no member row who couldn't append audit entries.
- **Data migration** — the roster move from club-doc array to subcollection: a legacy club lost its whole roster on first load (an empty subcollection snapshot clobbered the in-memory roster); and a single shared echo-suppression flag silently swallowed the *next* club-doc edit.
- **Subscription lifecycle / races** — signing in as a different account without signing out leaked the previous user's club, listeners, and `isOwner` flag.
- **Permission engine** — an in-list lineup delete that only rewrote the club doc, so the lineup resurrected from its untouched subcollection doc; coaches shown per-row Edit buttons on equipment they can't write.
- **Join / invite flow** — an existing owner who clicked their *own* invite link would overwrite their membership row and self-demote to a pending athlete.

Twelve confirmed bugs in total — three of them data-loss-critical — each verified against the code and then re-verified after the fix. Several are exactly the class of bug that "works fine when I test it normally" would never surface; they only appear under a second user, an account switch, or an upgrade from old data.

---

## What I'd still do with a real budget

The Spark-plan constraints leave a few soft edges I'd close with a paid plan + Cloud Functions: an **atomic invite-use counter** (`maxUses` is currently best-effort, since rules can't transactionally decrement), server-side **cascade delete** (today the client deletes subcollections doc-by-doc; append-only audit logs intentionally orphan rather than delete), and moving role changes behind a privileged callable so the role ladder can't be probed from the client at all. None of these are holes — they're the difference between "secure" and "secure *and* abuse-resistant at scale."

---

*The rules are the product. If they're wrong, nothing above them matters.*
