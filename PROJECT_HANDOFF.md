# PROJECT_HANDOFF.md — Dispatch App MVP (static prototype)

## Status

Built 2026-11-17 as a static GitHub Pages prototype (Stage 0 + core
call lifecycle) in `~/workspace/dispatch-mvp/`. No code has been pushed,
no GitHub repo created, no deployment, no Firebase. GitHub was not
connected at build time.

## Architecture

Plain HTML/CSS/JS, no build step, no framework, no network calls.

- `index.html` — shell (header, role switcher, alert banner, visible
  test-data warning, tabs, a single `<dialog>`).
- `styles.css` — mobile-first styles, 390px-first layout.
- `seed.js` — fake seed data only (`window.DISPATCH_SEED`): 7 fake
  users, 5 fake calls (2 open, 1 draft, 2 closed), 6 equipment items,
  1 loan, 3 vehicles, 4 saved addresses, 1 excluded address.
- `app.js` — two parts:
  - **Store**: the only object that touches `localStorage` (keys
    prefixed `dispatch-mvp-`). All rules live here as methods with
    validation (`createCall`, `respond`, `unassign`, `requestBackup`,
    `closeCall`, `reopenCall`, `requestHidden`/`approveHidden`,
    `checkoutEquipment`/`returnEquipment`, `createLoan`/`advanceLoan`,
    and the manage methods). A later backend (Firebase) replaces
    this object without touching UI code.
  - **UI**: tab rendering per role, call detail dialog, forms. All
    persistence goes through Store; UI never touches localStorage
    directly.
- `tests/smoke.mjs` — 23 headless-browser checks (puppeteer-core).

## Data model (Store.state)

- `org`: one demo org, “Chaverim of NEPA (Demo Org)”.
- `users[]`: `{id, name, role, phone, inventoryManager}`. Roles:
  super-admin, coordinator, dispatcher, member.
- `calls[]`: `{id, incident, nature, status (open|draft|closed),
  address, vehicle, callerName, callerPhone, notes, coordinates,
  mapsLink, urgent, notify, createdAt, closedAt, outcome,
  responders[{userId, eta, at}], backupNeeded, equipmentOut[], idemKey}`.
- `equipment[]`: `{id, name, kind (call-only|loan-only),
  status (in-stock|out-on-call|out-on-loan), callId, checkedOutBy}`.
- `loans[]`: `{id, itemId, callId, borrower, loanAgreed, status
  (created|released|picked-up|returned|closed), createdAt}`.
- `fleet[]`: `{id, name, active}`.
- `savedAddresses[]`, `excludedAddresses[]`, `callNatures[]`.
- `hiddenRequests[]`: `{id, callId, requesterId, fields, status
  (pending|approved|denied), durationMinutes, approvedBy, approvedAt,
  expiresAt}`.
- `alerts[]` (in-app only), `activityLog[]`, `currentUserId`,
  `usedKeys[]` (idempotency), `nextIncident`.

## State diagrams (as built)

Call: Draft →(dispatcher: put out)→ Open →(member: respond with ETA,
self-assigning)→ Responding →(dispatcher: close with 1 of 7 outcomes)→
Closed →(dispatcher: reopen)→ Open, with responders/assignments/
equipment restored as they were. Backup-needed is a flag on an open
call, requestable by members on the call or dispatcher, clearable by
either. No member unrespond exists.

Equipment: In stock →(checkout on an open call)→ Out on call →(return)→
In stock. Loan: Created (loan-agreed checkbox) → Released → Picked up →
Returned → Closed. One active checkout per item, checked in the Store.

Hidden data: member requests name+phone (callback-number-only while a
call is open) → any dispatcher approves with a duration (15 min /
30 min / 1 hr / forever) → grant is active until expiry → access ends.
Requests and grants are logged and visible to the coordinator.

## Permission matrix (as built)

| Action | Super admin | Coordinator | Dispatcher | Member | Inventory mgr |
|---|---|---|---|---|---|
| Manage org / members / natures / fleet / addresses / reports | Y | Y (own org) | N | N | N |
| Create / put out / close / reopen / unassign calls | N | Y | Y | N | N |
| Approve hidden-data requests | N | Y* | Y | N | N |
| Respond to calls (with ETA) | N | Y | N | Y | (as member) |
| See caller name + phone | N | Y | Y | Only while responding, or with an unexpired grant | (as member) |
| Request callback number / hidden data | N | — | — | Y (approval needed) | (as member) |
| Request / clear backup | N | Y | Y | Y if on the call | (as member) |
| Use equipment on a call | N | Y | Y | Y if on the call | (as member) |
| Manage inventory directly (add/edit items) | Y | Y | N | N | Y |
| Contacts directory, own history, personal dashboard | Y | Y | Y | Y | Y |
| Org dashboard | Y | Y | N | N | N |
| Reset / clear / import data | Y | Y | N | N | N |

\* Coordinator “can do everything” per the owner’s decisions, so
coordinator is treated as dispatcher + org admin throughout.

## Decision log (complete — owner answers 2026-11-15, Q1–27 + follow-ups)

Hidden data = caller name + phone only, both requestable; any
dispatcher approves; grant duration picked from 15 min / 30 min /
1 hr / forever; requests/grants logged for the coordinator.
Responding is self-assigning — a responding member CAN get the
callback number and phone the caller back. No member unrespond —
only a dispatcher can unassign. Alerts to all of the org EXCEPT super
admin. Coordinator can do everything; super admin is purely
administrative. Call natures managed by coordinator and above;
members/fleet/saved addresses by coordinator. Per-nature minimum
fields not important for MVP. Dispatchers CAN initiate backup.
Equipment must be returned before a call can close. Reopening
restores responses/assignments/equipment as they were. Equipment
steps by member on the call, dispatcher, or inventory manager;
inventory manager can be a regular member. Drafts managed by
dispatcher and above; putting a draft out sends the normal alert.
Close outcomes: Received, OnTheWay, NeedsCoordinator, Interstate,
NotCorrected, Corrected, Cancelled. Interstate button is a
placeholder only (visible, sends nothing). Dashboard period 1 month;
“covered” = responded then the call closed; personal dashboard per
member + org dashboard for coordinators. Reports coordinator and
above. Hide-don’t-disable UI; near one-screen member home.
Acceptance criteria A1–A19 confirmed. Waiver signing OUT of v1.
One person in one org. Original Nov 14–15 testing notes: none from
the owner; prompt for Instinct written at
`~/workspace/your_files/dispatch-mvp-prompt-for-instinct.md`.
GitHub: stainlesssteel770 / nepadispatch-mvp — not connected at
build time.

**Added 2026-11-17 (owner requirement):** fake seed data stays the
starting point, but the owner can also input his own data and test
the full call cycle with it. Everything seeded is addable, editable,
and deletable in the UI by the roles allowed to manage it: members
(add/edit, coordinator+), call natures (add/edit/reorder/delete,
coordinator+), saved addresses (add/edit/delete + exclude control,
coordinator+), equipment (add/edit, inventory manager+), fleet
(add/rename/deactivate, coordinator+). Own data persists in
localStorage, with “Reset to fake seed data”, “Clear all my data”
(blank slate), and JSON export/import on the My data tab.

## What was built

- Role switcher with 7 fake users; tabs and actions hidden per role.
- Calls list, create-call form with typeahead + history suggestions
  (offered, never auto-selected; excluded addresses drive no history
  suggestions), one-page review summary before confirming, draft vs
  put-out, alert options (normal / urgent / don’t notify), in-app
  alert banner.
- Respond with ETA (typed or location-prefill with manual fallback),
  dispatcher unassign, backup request/clear, close dialogue with the
  7 outcomes (blocked while equipment is out), reopen, Interstate
  placeholder.
- Caller-privacy hiding, callback-number request, post-close
  hidden-data request with duration dropdown, approval log.
- Equipment use-on-call + return, loan flow with “loan agreed”
  checkbox and step buttons, inventory add/edit.
- Contacts directory, member call history, personal + org dashboards
  (1 month, “covered” = responded then closed, ABOVE/BELOW average
  label), basic report with CSV export.
- Manage tab, My data tab (export/import/reset/clear), Reset demo
  data in the header.
- Visible test-data warning in the app and README.

## What was tested

Smoke suite `tests/smoke.mjs`, headless Chrome (puppeteer-core),
390×844 mobile viewport, served over local HTTP. **23/23 passed**
on 2026-11-17: home render + warning; role switcher; caller hidden
for a non-responding member; caller visible with tap-to-call after
responding; new call with own data through the summary step; duplicate
submit returns the existing record; close blocked while equipment is
out, then succeeds after return; backup request/clear; draft put out;
hidden-data request → 30-min approval → member sees caller on the
closed call; manage adds (nature, address, vehicle, equipment);
JSON export parses; clear-all-my-data empties calls + equipment;
reset-to-seed restores the seed; state persists across reload; no
page errors. `node --check` clean on `app.js` and `seed.js`.

## What was NOT tested

- Real phones, real browsers other than headless Chrome, desktop
  widths, or touch interaction beyond the mobile viewport.
- Location prefill (geolocation) — the button exists and falls back
  to manual ETA, but no live location was exercised in the smoke run.
- CSV download contents beyond generating the file (not opened).
- JSON import round-trip through the file picker (import code path
  exercised only by code review, not by the browser run).
- Any multi-user or cross-device behaviour — by design, there is
  none in this prototype.
- Urgent-alert sound/vibration and OS do-not-disturb bypass — not
  implemented beyond the urgent banner/badge in this static build.
- Server-side enforcement of any rule — impossible in a static
  site; see README.

## Known limits / next stage

- Single-device only: each browser has its own localStorage copy.
- Privacy and concurrency rules are UI-only simulations.
- Next stage (owner-approved direction): multi-phone expansion via
  Firebase — replace the Store with Firebase (auth, Firestore, and
  server-side rules), keeping the UI and data model. Before that:
  connect GitHub, create `stainlesssteel770/nepadispatch-mvp`,
  push this tree, enable Pages, and test on the owner’s phone.
