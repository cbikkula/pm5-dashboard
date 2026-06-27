# Club system — Firestore schema (v1.11.0)

The membership/security model. Locked before implementation per design review. Security is enforced entirely by [`firestore.rules`](../firestore.rules) (Spark plan → no Cloud Functions).

## Core principle: members ≠ athletes

- **Members** = people with login + access + a role. Live in `clubs/{clubId}/members/{uid}`.
- **Athletes** = rowable roster entries (seatable in lineups). Live in `clubs/{clubId}/athletes/{athleteId}`.
- A member may *link* to an athlete (`linkedAthleteId`) when they also row. A coach can be both; a parent-admin is a member with no athlete. A coach-typed athlete exists before anyone logs in, and is linked to a real user **only on explicit admin confirmation** (no name-based auto-merge).

## Collections

### `users/{uid}`
```
clubIds: [clubId, …]   // clubs this user belongs to (for "my clubs" lookup)
```
Access: self only (read + write).

### `clubs/{clubId}`
```
ownerId:   uid
name:      string
subtitle:  string
teams:     [{ id, name, notes }]
squads:    [{ id, teamId, name, notes }]
shells:    [{ id, name, boatClass, weight, notes }]
oarSets:   [{ id, name, type, boatClass, notes }]
settings:  { … }       // visibility/privacy prefs (future)
createdAt, updatedAt, version
```
Access: read = active members · update = owner/admin (ownerId immutable except by owner) · delete = owner only.

### `clubs/{clubId}/members/{memberUid}`
```
role:            owner | admin | coach | athlete
status:          pending | active | suspended | removed
linkedAthleteId: athleteId | null   // set ONLY by owner/admin, after approval
canBeSeated:     bool               // derived: true iff linkedAthleteId != null
name:            string             // display
inviteCode:      string             // the invite the join was made with (proof; validated by rules at create)
joinedAt, invitedBy
```
Access: read = active members or self · **create** has exactly two legitimate paths: (a) the club **owner bootstraps** their own `owner`/`active` row right after creating the club doc (only the real `ownerId` satisfies `isOwner()`, and only for their own uid); (b) a **join** = self-create as `pending`, with **`linkedAthleteId` must be null**, carrying a valid `inviteCode` whose role == the requested role (rules `get()` the invite and check exists/not-revoked/not-expired/role-match — the only enforcement point on Spark) · approve/role-change/suspend/link = owner/admin (admins can't touch owner, can't mint admins, can't set owner) · remove = owner/admin.

### `clubs/{clubId}/athletes/{athleteId}`
```
name, side, weightClass
teams: [teamId], squads: [squadId]
defaultAvailability: available | absent | injured | limited | land-training | race-only
linkedUid: uid | null
```
Access: read = active members · write = owner/admin/coach.

### `clubs/{clubId}/lineups/{lineupId}`
(Existing Phase-1 lineup shape.) Access: read = active members · write = owner/admin/coach.

### `clubs/{clubId}/availability/{entryId}`
```
date:      string (or practiceId)
athleteId: athleteId
status:    absent | injured | limited | land-training | race-only
byUid:     uid
```
Per-date override of the athlete's `defaultAvailability`. Access: read = active members · write = owner/admin/coach **OR** an athlete writing only their own (`athleteId == member.linkedAthleteId`).

### `clubs/{clubId}/invites/{code}`
```
role:       athlete | coach | admin    // never owner
createdBy:  uid
createdAt, expiresAt
revoked:    bool
maxUses:    number | null   // best-effort (no atomic counter without Functions)
uses:       number
```
The doc **id is the join code** — an unguessable bearer token. Access: `get` by exact code = any signed-in user (to read role/clubId/validity) · `list` = owner/admin only (no enumeration) · create/revoke = owner/admin, role-capped (admins can't mint admin invites; nobody mints owner).

### `clubs/{clubId}/auditLogs/{logId}` — append-only
```
actorUid, action, targetType, targetId, before, after, createdAt
```
Access: read = owner/admin · create = any active member (actorUid == self) · **update/delete = denied to everyone, including the owner.**

## Join flow
```
owner/admin mints invite (role, expiry, maxUses)
        │  shares link  …/?join=<code>   or the code itself
        ▼
user opens link → signs in → reads invite (get by code) → validates (not expired/revoked)
        ▼
user self-creates members/{uid} as status:'pending', role:<invite.role>
        ▼
owner/admin sees pending request → APPROVE (status → 'active') or decline (delete)
        ▼
active member — gains read access; coach/admin gain write per role
```

## What v1.11.0 ships
Role model · these rules · invite links/codes · pending join requests · approve/decline · members panel · remove/suspend · audit log · lineup/equipment writes restricted to owner/admin/coach · athlete read-only lineup view + own-availability write.

**Deferred:** Viewer role · workout assignment · email invites · CSV import · presence.
