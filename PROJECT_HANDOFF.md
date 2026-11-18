# PROJECT_HANDOFF.md — Dispatch App MVP (static prototype)

## Status

Built 2026-11-17 as a static GitHub Pages prototype (Stage 0 + core
call lifecycle) in `~/workspace/dispatch-mvp/`. Pushed to
stainlesssteel770/nepadispatch-mvp (commit a63d3850) and live at
https://stainlesssteel770.github.io/nepadispatch-mvp/ (repo public,
Pages built). No Firebase.

Polish pass 2026-11-17 (same day): visual redesign to the dark-navy reference card plus the one-tap Correct button. PUSHED 2026-11-17 (commit 7d4fcbcc) and live-verified — live app.js and styles.css byte-match local (md5), `closeCorrect` present. See "Polish pass — 2026-11-17" below.

Card-tap fix 2026-11-17 (same day): the whole call card is now tappable, and the first action-bar segment is Add member instead of Open. PUSHED 2026-11-17 (commit 485ad9bf) and live-verified — live app.js and styles.css byte-match local (md5). See "Card-tap fix — 2026-11-17" below.

Instinct findings batch 2026-11-17 (same day): 15 fixes from Instinct's phone-width test of the live v2 prototype (full matrix at https://files.instinct.com/sqo0sywvcdn8-nepadispatch-mvp-ui-test-findings). PUSHED 2026-11-17 (commit da2e3419) and live-verified — live app.js and styles.css byte-match local (md5), `parseETA` present. See "Instinct findings batch — 2026-11-17" below.

Card colors 2026-11-17 (same day): the owner's decision on the open question — urgent stays visually urgent, but the card also shows others are responding. Rule for open calls: neutral (white) when uncovered and not urgent, red when urgent and uncovered, blue when covered and not urgent, red + blue COVERED badge + blue responder pills when urgent and covered (urgent wins). PUSHED 2026-11-17 (commit 156405fa) and live-verified — live app.js and styles.css byte-match local (md5). See "Card colors — 2026-11-17" below.

Navigation + undo + banner 2026-11-17 (same day, evening): Instinct's rerun of the live v=20261117-colors prototype (phone-size desktop Chrome, fake data only) re-verified all previous fixes and raised four new items — app-first navigation (first screen was ~480/844px of chrome), one-tap Correct with no undo, the Decided table still 585px wide, and announcement entries that never aged out. NOT YET PUSHED — parent pushes after verifying. See "Navigation + undo + banner — 2026-11-17" below.

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
- `tests/smoke.mjs` — 67 headless-browser checks (puppeteer-core).

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
After a call closes, even past responders need an unexpired grant to
see the caller (decided 2026-11-17, Instinct findings batch).
Requests and grants are logged and visible to the coordinator.

## Permission matrix (as built)

| Action | Super admin | Coordinator | Dispatcher | Member | Inventory mgr |
|---|---|---|---|---|---|
| Manage org / members / natures / fleet / addresses / reports | Y | Y (own org) | N | N | N |
| Create / put out / close / reopen / unassign calls | N | Y | Y | N | N |
| Approve hidden-data requests | N | Y* | Y | N | N |
| Respond to calls (with ETA) | N | Y | N | Y | (as member) |
| See caller name + phone | N | Y | Y | Only while responding to an OPEN call, or with an unexpired grant; never on a closed call without a grant | (as member) |
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

**Added 2026-11-17 (Instinct findings batch, item 12 — judgment call, reversible on the owner's word):** after a call closes, NOBODY sees the caller name+phone without an unexpired dispatcher-approved grant — including past responders. This follows the decided rule that caller data is requestable post-close via a grant; the prototype previously let a past responder keep seeing the caller on a closed call. Dispatcher/coordinator access is unchanged. If the owner wants past responders to keep seeing it, this is a one-line change in `Store.canSeeCaller`.

**Added 2026-11-17 (owner clarification, Instinct rerun):** ETAs are not really ever adjusted — whatever is put in is what goes. So NO ETA-editing feature is needed at all (neither member nor dispatcher editing). Member un-respond stays dispatcher-only, as decided. The rerun's "member can't un-respond/correct ETA" item is therefore fully settled, not open.

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
390×844 mobile viewport, served over local HTTP. **91/91 passed**
on 2026-11-17 after the navigation + undo + banner change (was
74/74 after the card-colors change, 67/67 after the Instinct
findings batch, 36/36 after the card-tap fix, 28/28 after the polish
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
**Instinct batch (section 13): empty ETA and "banana" ETA rejected
with an inline dialog error, "45" stored as "45 min", "1h 30m"
stored as "1h 30m"; past responder cannot see the caller on closed
INC-1039; loan without the checkbox shows the inline error, then
creates; created loan shows only "Mark released", released loan only
"Mark picked up"; close form has no pre-selected outcome and friendly
labels ("Fixed on scene", no raw "OnTheWay"), closing with none
picked shows the inline error and the call stays open, picking
Corrected closes with the stored code; backup banner shows on
request, clears from the banner and the stored alerts on clear, and
stays clean after a full reload; first unassign tap only arms the
confirm ("Tap again to confirm unassign"), second tap removes the
responder; callback number is marked "* (required)"; Back to edit
keeps every field filled; Edit draft opens the form prefilled and
saving updates the same draft with no duplicate; member phone "123"
rejected inline and the member is not added, a valid phone saves;
Decided log sits in a scroll container with no page overflow
(scrollWidth 390); Contacts shows 8 tap-to-call links; the dialog
dismiss button reads "Cancel"; the duplicate-nature error toast is
still visible after 4.5s; a responding member sees
"Only a dispatcher can unassign you." with no unrespond control, and
super admin has no New call or Requests tab**; no page errors.
`node --check` clean on `app.js` and `seed.js`.

Test-harness note (found debugging section 13): in headless Chrome,
a real `tel:` navigation swallows all later CDP mouse input — the
tab and submit clicks in section 13 silently stopped working after
section 12's tap-to-call click, even though the click landed on the
right element (verified via elementFromPoint) and JS-dispatched
clicks still worked. The app is not at fault. Section 12(e) now
dispatches the tap-to-call click with a one-time preventDefault so
the browser never attempts the tel: navigation; the app's link guard
is still exercised. Never add a real tel: click back into the suite
without re-checking the clicks after it.

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

## Instinct findings batch — 2026-11-17 (items 1–15)

Instinct tested the live v2 prototype at phone width (fake data
only; full matrix at
https://files.instinct.com/sqo0sywvcdn8-nepadispatch-mvp-ui-test-findings)
and sent 17 findings. 15 are fixed here; 2 were confirmed intended
(see "Left as intended" below). All fixes are in `app.js`,
`styles.css`, and `tests/smoke.mjs` (new section 13, one check per
item). Smoke suite is now **74/74** (section 14 covers the four card-color states).

1. **Error toasts hidden behind dialogs.** The call dialog is a
   native `<dialog>` (top layer — no z-index can put a toast above
   it), so errors raised while a dialog is open now render INLINE
   inside the dialog: each dialog form has a `#dlg-error` slot near
   its submit button, shown by `dlgError(msg, form)`; `showError`
   picks the inline slot when a dialog is open and falls back to a
   toast otherwise. Toasts remain only for page-level feedback.
   Fixed for respond (no ETA), loan (no checkbox), close-form,
   member and equipment forms, and dialog click actions
   (backup/unassign/checkout/assign/request).
2. **Close form.** The 7 outcome radios now show friendly labels
   with a one-line description each ("Corrected — Fixed on scene,
   caller is good to go", "On the way", "Needs coordinator",
   "Interstate", "Not corrected", "Received", "Cancelled") via
   `OUTCOME_LABELS`; the stored outcome codes are unchanged. No
   radio is pre-selected — closing requires picking one; submitting
   with none picked shows the inline error and the call stays open.
   The one-tap Correct button is unchanged.
3. **Callback number required but unmarked.** The New call field is
   now labelled "Callback number * (required)". The 7-digit
   validation is unchanged.
4. **Back to edit lost the form.** The New call form now prefills
   from `App.pendingCall`, so Back to edit returns to a filled form.
   A manual trip to the New call tab still starts fresh (and clears
   any in-progress draft edit).
5. **Stale alert banner.** Root cause fixed two ways: clearing
   backup now removes the matching backup alert from the stored
   alerts (same on close and on re-request, which first drops any
   stale one), AND the banner only renders alerts that are still
   true for live state (a backup alert shows only while its call is
   open and still needs backup). `Store.load` also prunes stale
   backup alerts from persisted state. The only other alert kind is
   "call" (a past event notification, not a live-state claim), so
   no other kind has this staleness pattern.
6. **Unassign needs confirmation.** In-app two-tap confirm (no
   native confirm): the first tap arms the button ("Tap again to
   confirm unassign"), the second tap removes the responder.
7. **Drafts can be edited.** New `Store.updateDraft(callId, data,
   status)` — same validation as createCall, edits the draft in
   place, never creates a duplicate; "Save as draft" keeps it a
   draft, "Put out call" puts it out with the normal alert. The
   call detail has an "Edit draft" button (dispatcher/coordinator)
   that opens the New call form prefilled with the draft's data.
8. **Member phone not validated.** `addMember`/`editMember` now
   apply the same 7+ digit rule as the callback number (a phone
   that is entered must have at least 7 digits; empty stays
   allowed), surfaced through the inline dialog error.
9. **Decided log too wide.** The Requests "Decided" table (and the
   Reports, Contacts, and Manage member tables, same pattern) is
   wrapped in a `.table-scroll` horizontal-scroll container; no
   column is lost and the page no longer overflows at 390px
   (scrollWidth 390).
10. **ETA accepts anything.** New `parseETA`: accepts a number of
    minutes ("15", "15 min", "15m") or hours+minutes ("1h",
    "1h 30m"); anything else ("banana", "soon") is rejected with
    the inline error "Enter an ETA like 15 min or 1h 30m". The
    ETA is stored and displayed normalised ("45 min", "1h 30m").
    `Store.respond` enforces this; dispatcher-assigned members
    still show ETA "—".
11. **Contacts numbers not tappable.** Every member phone on
    Contacts (and the Manage members table and My-history caller
    line) is now a `tel:` link via `telLink()`.
12. **Privacy on closed calls (judgment call, recorded decision).**
    `Store.canSeeCaller` now returns false for a CLOSED call
    unless the viewer has an unexpired approved grant — including
    past responders. Dispatcher/coordinator access is unchanged.
    The closed-call copy says so ("Hidden after close"). Recorded
    in the Decision log above; reversible on the owner's word (one
    line in `canSeeCaller`).
13. **Three "Close" names in one dialog.** The dismiss button in
    the call detail now reads "Cancel". The "Close this call"
    heading and the "Close call" action are unchanged.
14. **Toasts vanish too fast.** `toast(msg)` keeps the 3.5s
    lifetime for success/info; `toastErr(msg)` stays 8 seconds,
    is styled red, and any toast dismisses on tap. All error paths
    now use `toastErr` / `showError` / `dlgError`.
15. **Loan cards show every lifecycle button.** Each loan card now
    shows only the NEXT action for its state (Created → Mark
    released, Released → Mark picked up, Picked up → Mark
    returned, Returned → Close loan, Closed → none) with a small
    "Next: …" hint. `Store.advanceLoan` itself is unchanged.

Left as intended (verified, no change):
- A member cannot un-respond or correct their own ETA; only a
  dispatcher can unassign (the dialog says so; smoke-checked).
- Super admin has no New call or Requests tab — super admin is
  purely administrative by decision (smoke-checked).
- Not in this batch (deferred): member withdraw/correct-own-response,
  and replacing the remaining native confirm/prompt dialogs
  (reset/clear/import/delete/nature/address/fleet renames) — those
  were blocked in Instinct's testing and are still untested on a
  device.

## Card colors — 2026-11-17 (urgent wins, covered still shows)

Owner decision resolving the open question from Instinct's findings:
an urgent call must stay visually urgent, but the card must also show
that others are already responding. Decided rule, for OPEN calls
("covered" = currently has ≥1 responder):

- Open, not urgent, no responders: NEUTRAL card (white, dark text).
- Open, urgent, no responders: RED card (deep red, white text).
- Open, covered, not urgent: BLUE card (strong blue, white text).
- Open, urgent AND covered: the card STAYS RED (urgent wins — it
  must still read as urgent at a glance) AND gains a blue COVERED
  badge plus solid-blue responder pills, so covered is unmistakable.
- Draft and closed cards: unchanged — they keep the plain dark
  treatment from the polish pass.

Implemented in `callCard()` (`app.js`): the state is derived from
`c.urgent` and `c.responders.length` into distinct classes
(`card-neutral` / `card-urgent` / `card-covered` /
`card-urgent-covered`) plus a `.badge.covered` (blue; white-on-blue
on the blue card). The URGENT badge stays on all urgent cards; the
chevron, action bar, tap-to-open behaviour, and backup edge are
unchanged. No decided rule changed.

Tested in `tests/smoke.mjs` section 14 (7 new checks, 74/74 total
passed in headless Chrome at 390×844): plain open call is neutral
with no badges; urgent uncovered is red with URGENT and no COVERED;
covered non-urgent is blue with COVERED and no URGENT; urgent +
covered stays red with both badges and blue pills (computed
`rgb(37, 99, 235)`); draft and closed cards carry no state class.

Harness note: after a `page.reload()` Chrome restores the old scroll
position, and the sticky header then covers the tab buttons — a CDP
click lands on the header, not the tab (same family as the
toast-UNDO/tab-bar tap-interception lessons). Section 14 scrolls to
the top (`window.scrollTo(0, 0)`) before tab clicks. This is a test
harness artifact, not an app bug: a real user scrolls the tabs back
into view before tapping.

## Navigation + undo + banner — 2026-11-17 (NOT YET PUSHED)

Instinct's rerun (fresh on v=20261117-colors, phone-size desktop
Chrome, fake data only; matrix at
https://files.instinct.com/sqo0sywvcdn8-nepadispatch-mvp-ui-test-findings)
re-verified all previous fixes and raised four new items, all fixed
here. Card colors unchanged (urgent wins — already decided by the
owner). Asset version bumped to `?v=20261117-nav`.

### 1. App-first navigation

Before: first call card top 781px (header 162px, tabs 160px wrapping
3 rows, banner 122px with two alerts) — ~480/844px of chrome before
any call. After (measured in the smoke run, 390×844): header 65px,
warn strip 61px, tabs 60px, banner 45px (one line), **first card top
420px**.

- Compact header: one slim row — brand + hamburger button. The role
  switcher moved OUT of the header into the side menu (it is a
  test/demo control, not a daily control). The "PROTOTYPE — FAKE
  DATA ONLY" tag stays visible but small. (Probe catch: the tag's
  min-content width of 198px overflowed the one-row header and pushed
  the page to 402px wide; removing `white-space: nowrap` from `.tag`
  lets it wrap — page back to 390px.)
- Primary tabs, 3–4 per role, one non-wrapping row at 390px
  (`primaryTabs()` in `app.js`): Member — Home, Calls, Contacts;
  Dispatcher — Home, Calls, New call, Requests; Coordinator — Home,
  Calls, New call, Requests; Super admin — Home, Calls, Manage.
  Inventory-manager members keep the member primaries; their Manage
  access lives in the menu. New call is prominent for
  dispatchers/coordinators (filled green `.tab-new` style).
- Hamburger side menu: slide-in drawer from the left with a close
  button, a backdrop tap to close, and Escape to close
  (`openMenu()`/`closeMenu()`). Everything else grouped with small
  headings — Activity (Dashboard, My history, Reports where the
  role has it), Equipment (Equipment), Directory (Contacts where not
  already a primary, Manage where the role has it), Personal (My
  data) — plus the role switcher ("Signed in as" select) and Reset
  demo data at the bottom. Nothing deleted, only moved; menu tab
  clicks use the same `App.tab` + render path as the primary tabs.
- Announcement strip: only renders when a live alert exists, one
  compact line (ellipsis + "+N more" count) with a dismiss (×)
  button (see §4).
- Home's "What needs my attention" / "My calls right now" sections
  unchanged.

### 2. One-tap Correct undo window

One-tap Correct stays one-tap (owner's explicit one-click ask), but
after a Correct close the confirmation toast now carries a real
"Undo" button for ~8s (`toastAction()`, `closeCorrect` passes
`undo: "correct-call"` with the call id). Tapping Undo reopens the
call via the existing reopen path (responses/assignments/equipment
restored as they were). The toast does NOT disappear on the first
tap elsewhere before the window ends — `toast()` only auto-hides a
toast when it has no action, and the undo toast is on its own
8-second timer. The Undo button is a real `<button>` in the toast
(`.toast-undo`), not plain toast text. The full 7-outcome close
dialogue is unchanged (choice + confirm step, no undo needed there).

Related fix found while running the suite: the toast body itself
used to swallow taps — after data-clear, the "All your data cleared"
toast sat over the Reset button's center and the test's reset click
landed on the toast (confirmed with `elementFromPoint`). The toast
body is now click-through (`pointer-events: none` on `.toast`;
`pointer-events: auto` only on `.toast-undo`), so a transient toast
can never eat a tap meant for a button underneath it. Tap-to-dismiss
for plain toasts is gone (the timer already dismisses them); the
Undo button stays tappable.

### 3. Decided table root cause — it was never the wrapper

The rerun measured the Requests "Decided" table at 585px in a 390px
view. The previous batch's `.table-scroll` wrapper WAS applied to
this table — and it did contain the page overflow (page scrollWidth
was 390) — but the table itself still rendered 545px wide inside
its 366px wrapper (Reports was 525px), so the right columns were
only reachable via an undiscoverable inner horizontal scroll. The
root cause is the tables' content: 6–7 columns of unbreakable text
(IDs, phone numbers, dates) at their min-content widths simply do
not fit 366px, and no wrapper can shrink a table below its
min-content width. A second bug surfaced during the probe: the
tables had no `<thead>` — the header row was an implicit-tbody
`<tr>` whose `th` cells rendered at min-content width and pushed the
page to 402px; adding an explicit `<thead>` fixed that.

Fix (real, measured): the two wide tables (Decided log, Reports)
render with class `stack-narrow` + `data-label` attributes on every
`<td>` and explicit `<thead>`/`<tbody>`, and a ≤560px media query
stacks them into labelled cards (thead hidden, rows become cards,
labels via `td::before { content: attr(data-label) }`). After the
fix both tables measure 366px (fit container) and page scrollWidth
is 390 everywhere. Contacts and Manage tables already fit at 366px
and were left alone.

### 4. Announcements age out / dismiss

- Dismiss: the banner's (×) button hides it; dismissed alert ids
  persist in `state.dismissedAlerts` (new field, normalized in
  `Store.load`, cleared by `clearMyData`, seeded empty) so a reload
  does not resurrect them. The underlying log/activity data is
  untouched. Live-state alerts (e.g. backup-needed while
  `backupNeeded` is true) are never dismissible this way — they keep
  their existing live-state filtering.
- Age-out: "call" (new-call notification) alerts older than 24h
  never render in the banner. Live-state alerts are unaffected by
  the 24h rule while still true.
- The banner now shows the most recent live alert as one compact
  line (ellipsis + "+N more").

### Tests

New `tests/smoke.mjs` section 15 (17 checks; **91/91 total** in
headless Chrome at 390×844): (a) primary tabs per role — dispatcher
Home/Calls/New call/Requests in one row with New call prominent,
member Home/Calls/Contacts, super admin Home/Calls/Manage; (b)
hamburger opens with grouped moved screens + role switch + reset,
menu tab navigates and closes the menu, Escape closes it, role
switch works from inside the menu; (c) first call card top 420px
(<500px); (d) one-tap Correct shows a real Undo button, Undo
reopens the call, Undo toast survives a tap elsewhere; (e) Decided
and Reports tables fit 390px (page scrollWidth 390, tables 366px);
(f) banner dismiss persists across reload, >24h-old "call" alert
never renders.

Harness notes from this batch (all test-side, not app bugs):
- `goTab()` helper: clicks a primary tab if present, else opens the
  menu and clicks the menu item. All 26 existing `clickAction("tab")`
  calls were retargeted through it.
- The `#menu-backdrop` also carries `data-action="menu-close"`, so a
  bare `page.click('[data-action="menu-close"]')` clicks the
  full-screen backdrop's center — which the drawer covers — instead
  of the close button. The test now uses `#menu
  [data-action="menu-close"]`.
- The `window.confirm = () => true` override is needed for the
  data-clear/reset checks (native confirm auto-dismisses as false
  in headless Chrome).

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
