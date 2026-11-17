# PROJECT_HANDOFF.md — Dispatch App MVP (static prototype)

## Status

Built 2026-11-17 as a static GitHub Pages prototype (Stage 0 + core
call lifecycle) in `~/workspace/dispatch-mvp/`. Pushed to
stainlesssteel770/nepadispatch-mvp (commit a63d3850) and live at
https://stainlesssteel770.github.io/nepadispatch-mvp/ (repo public,
Pages built). No Firebase.

Polish pass 2026-11-17 (same day): visual redesign to the dark-navy reference card plus the one-tap Correct button. PUSHED 2026-11-17 (commit 7d4fcbcc) and live-verified — live app.js and styles.css byte-match local (md5), `closeCorrect` present. See "Polish pass — 2026-11-17" below.

Card-tap fix 2026-11-17 (same day, not yet pushed — parent pushes after verifying): the whole call card is now tappable, and the first action-bar segment is Add member instead of Open. See "Card-tap fix — 2026-11-17" below.

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
- `tests/smoke.mjs` — 36 headless-browser checks (puppeteer-core).

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
390×844 mobile viewport, served over local HTTP. **36/36 passed**
on 2026-11-17 after the card-tap fix (was 28/28 after the polish
pass, 23/23 before it): home render + warning; role switcher; caller hidden for a non-responding
member; caller visible with tap-to-call after responding; new call
with own data through the summary step; duplicate submit returns the
existing record; close blocked while equipment is out, then succeeds
after return; backup request/clear; draft put out; hidden-data
request → 30-min approval → member sees caller on the closed call;
manage adds (nature, address, vehicle, equipment); JSON export
parses; clear-all-my-data empties calls + equipment; reset-to-seed
restores the seed; state persists across reload; **one-tap Correct:
button shown to dispatcher on the 2 open calls, one tap closes
INC-1043 as Corrected with confirmation, Correct on INC-1042 (jack
out) leaves the call open with the return-equipment message, Correct
hidden for members (0 buttons)**; **whole-card tap: tapping the card
body (address) opens the call detail; Add member shown to dispatcher
on the 2 open calls; picker opens and assigning adds a responder with
ETA "—" plus a log entry and a responder pill; Backup tap on a card
does NOT open the dialog; Add member hidden for members (0 buttons);
tapping the tap-to-call number on a card does NOT open the dialog**;
no page errors. `node --check` clean on `app.js` and `seed.js`.

Two failures appeared on the first post-polish run and were fixed,
both in the new work, not in the old flows: (1) the redesigned card
had dropped the caller *name* (number only) — restored, so roles
allowed to see the caller see name + phone on the card; (2) the
smoke test clicked the card's bell button while the call dialog was
open, so the click landed on the modal overlay — the test now clicks
the backup buttons inside the dialog. No app behaviour was changed
for (2) beyond the dialog-reopen guard (see below).

Test-run note: `tests/smoke.mjs` imports `puppeteer-core`, which is
not installed in this repo. For the 2026-11-17 run it was resolved
via a temporary symlink
`node_modules/puppeteer-core -> ~/workspace/steady/tests/node_modules/puppeteer-core`,
removed afterwards to keep the tree clean. Re-create that symlink
(or `npm install puppeteer-core`) before running the suite again.

## Polish pass — 2026-11-17 (visual redesign + Correct button)

Owner feedback: "very good first prototype, but it looks very ugly"
and a one-click button on each call to close it out as Corrected
was missing. Design model: the owner's reference screenshot of the
other app's call card (layout only — its address, phone number and
vehicle were NOT copied into seed data). Guiding principle from the
owner: smooth and sleek, simple and easy to use.

Visual changes (`styles.css`, plus `callCard()` in `app.js`):
- Call cards are dark navy with a blue right edge (red if urgent,
  amber if backup needed), large bold address top-left with a pin
  icon, incident + time top-right, icon-led rows for what/vehicle
  (vehicle in caps), caller name + tap-to-call number, and notes.
- Responders are white pill chips with blue text; "No one yet" is a
  dim pill. Status pills are distinct per status (open blue, draft
  grey, closed green, urgent red, backup amber).
- Bottom action bar on each card, thumb-sized icon segments with
  short labels: Add (person+ icon — dispatcher/coordinator assigns a
  member from a picker; open calls only), Backup (bell — requests
  backup, or clears it when already needed), Correct (green
  checkmark, dispatcher/coordinator only), Call (phone — tap-to-call,
  only when the role may see the caller), Maps (opens the address in
  Google Maps, new tab; uses the call's saved Maps link when one
  exists). All icons are inline SVG — no network, no emoji. The old
  "Open" segment is gone — tapping anywhere on the card body opens
  the call detail instead (see "Card-tap fix" below).
- Smooth and sleek throughout: generous rounded corners (18px
  cards, pill tabs/buttons), soft shadows, consistent spacing,
  subtle 0.15s transitions on taps and tab changes, sticky navy
  header, 44px+ tap targets, focus outlines. No new screens, no
  extra options — if a flourish fought simplicity, simplicity won.
- The "PROTOTYPE — FAKE DATA ONLY" warning is unchanged.

One-tap Correct (`Store.closeCorrect()`, one line over
`closeCall(id, "Corrected")`):
- On each OPEN call card, a prominent green "✓ Correct" segment in
  the action bar. Visible ONLY to dispatcher and coordinator
  (`Store.can("close")`); hidden for members, inventory manager
  (member role) and super admin, per hide-don't-disable.
- One tap closes the call with outcome Corrected — no dialog, no
  extra steps. Shows "Call closed as Corrected." and the call moves
  to closed; reopen stays available if it was a mistake.
- Equipment-out case: if equipment is still out on the call, the
  tap does NOT close it — the toast shows "Equipment must be
  returned before closing: <item names>" (the decided
  return-before-close rule, enforced by the same `closeCall`).
- The full close dialogue (all 7 outcomes) is unchanged for other
  outcomes.

Behaviour change to note (dialog vs card actions): backup,
unassign and equipment-checkout handlers used to re-open the call
dialog after every tap. Card-bar taps now only refresh the dialog
if it is already open, so tapping the bell on a card stays on the
list instead of popping the dialog open. Dialog-originated taps
behave exactly as before. No decided rule changed; every existing
test selector/ID is stable (the card's "Open call" action kept its
`data-action="open-call"`).

## Card-tap fix — 2026-11-17 (whole card tappable + Add member)

Owner report from his phone: tapping a call card did nothing — the
only way into a call was the small "Open" segment, and its person+
icon read as "add member" (as in his reference screenshot), so the
one way in didn't even look like the way in. The smoke tests only
ever clicked that small button, which is why they missed it.

Changes (`app.js` `callCard()` + click handler, `styles.css`):
- The whole card is tappable: the card `<article>` itself carries
  `data-action="open-call"`, so tapping the address, info rows,
  pills or badges opens the call detail exactly as the old Open
  segment did. Taps on action-bar buttons/links keep their own
  behaviour: the delegated click handler takes the closest
  `[data-action]` (a bar button wins over the card), and taps on a
  link inside the card (tap-to-call number, Call/Maps segments) are
  explicitly ignored for opening — the link proceeds instead.
  Affordance: a chevron at the right of the card header, pointer
  cursor, a slight press state, and a focus outline; Enter/Space on
  a focused card also opens it.
- First action-bar segment is now **Add member** (person+ icon,
  dispatcher/coordinator only, open calls only, hide-don't-disable),
  matching the reference screenshot. Tapping it opens a picker
  listing members/coordinators not already responding to the call;
  picking one calls the new `Store.assign(callId, userId)` — open
  calls only, dispatcher/coordinator only (enforced in the Store
  method via a new `can("assign")` permission), no duplicate
  assignment, responder recorded with ETA "—" (dispatcher-assigned,
  ETA unknown), assignment logged. Undo is the existing dispatcher
  unassign in the call detail. This replaces the old "Open" segment
  entirely — the card tap is now the way in. The My-history "Open
  call" button (a plain button, not a card) is unchanged.

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
