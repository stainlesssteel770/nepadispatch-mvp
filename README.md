# Dispatch App MVP — Static Prototype

Mobile-first volunteer roadside-assistance dispatch app (Chaverim-style),
built as plain HTML/CSS/JS with **no build step**, for single-phone testing
on GitHub Pages.

> **Test prototype on your own device — do not enter real live-dispatch
> caller or member data. Test data only.** The fake seed data is the
> starting point; anything you add is stored only in your own browser.
> Nothing in this app is shared with anyone, and there are no network
> calls, no server, and no real notifications.

## What it is

- `index.html` + `styles.css` + `app.js` + `seed.js` — the whole app.
- All state lives in `localStorage` under keys starting `dispatch-mvp-`,
  behind a single `Store` object in `app.js`. A later backend (e.g.
  Firebase) replaces the Store without touching UI code.
- Fake seed data: invented members, callers (555-xxxx numbers),
  addresses, equipment, and fleet. No real personal data.

## Run it locally

```sh
cd dispatch-mvp
python3 -m http.server 8123
# open http://127.0.0.1:8123/
```

Or open `index.html` directly in a browser (everything is local files;
no network needed).

## Install it on your phone (PWA)

The app is installable: on Android Chrome, open the live site
(https://stainlesssteel770.github.io/nepadispatch-mvp/) and use
"Install app" (or Add to Home screen) — it opens standalone, remembers
your last-used role, and relaunches offline (the app shell is cached on
the phone; your data lives in the browser's localStorage). On iPhone,
use Safari → Share → Add to Home Screen. The install flow itself has
only been verified in headless Chrome so far — a real phone is the
proof that it works there.

## Use it

- **Signed in as** (in the hamburger menu, top right): switch between the fake users to test
  each role — super admin, coordinator, dispatcher, members (one is
  also the inventory manager). Pages and buttons a role cannot use are
  hidden, not shown disabled.
- **Home**: what needs your attention — your calls, open calls needing
  a response, backup-needed calls.
- **New call** (dispatcher/coordinator): nature, address (typeahead from
  saved addresses, history suggestions offered — never auto-selected),
  vehicle, caller name/phone, notes, optional coordinates / Google Maps
  link. You review a one-page summary, then **Put out call** or
  **Save as draft**.
- **Calls**: open a call to respond with an ETA (typed, or “Use my
  location” with a manual fallback), request/clear backup, use equipment,
  create a loan, close with one of the seven outcomes, reopen, or use
  the Interstate placeholder button (visible, sends nothing).
- **Caller privacy**: a member sees the caller name/phone only while
  responding to that call, or with an approved grant. Otherwise it is
  hidden. A member can request the callback number (or name + phone
  after a call closes); any dispatcher approves it for 15 min, 30 min,
  1 hr, or forever. Requests and grants are logged (Requests tab).
- **Equipment**: one active checkout per item; equipment must be
  returned before a call can close. Loans use a “loan agreed” checkbox,
  no signing.
- **Manage** (coordinator and above): add/edit members, add/edit/
  reorder/delete call natures, add/edit/delete saved addresses plus
  the exclude-from-suggestions control, add/rename/deactivate fleet
  vehicles. Equipment add/edit is on the Equipment tab (inventory
  manager and above).
- **My data**: export your data as JSON, import a JSON file, **Reset to
  fake seed data**, or **Clear all my data** (blank slate — calls,
  equipment, addresses, fleet, loans and requests gone; members stay
  so you can sign in). Your own data persists across reloads.

## Decided rules implemented

See `PROJECT_HANDOFF.md` for the full list. Headlines: no member
unrespond (only a dispatcher can unassign); responding is
self-assigning and a responding member can call the caller back;
alerts go to everyone in the org except super admin; close outcomes
are Received, OnTheWay, NeedsCoordinator, Interstate, NotCorrected,
Corrected, Cancelled; reopening restores responses, assignments and
equipment as they were; waiver signing is out; one person in one org.

## What this prototype does NOT prove

This is a static site. Role checks, caller-privacy hiding, the
one-checkout rule, and duplicate-submit protection all run in the
browser only. They are **simulated, not server-enforced**: anyone with
the page data could read a hidden number, and two phones do not see
each other. That is why it is for single-phone testing only. The
multi-phone expansion (Firebase) is a later stage and must re-implement
these rules on the server. Passing the smoke tests here does not mean
the app is safe for live dispatch.

## Tests

`tests/smoke.mjs` — 284 browser checks (headless Chrome via
puppeteer-core). It needs `puppeteer-core` installed and Chrome
available; set `CHROME_PATH` to your Chrome binary. Run from the repo
root while serving the directory (see “Run it locally”):

```sh
node tests/smoke.mjs
```

Last run: 2026-11-18, 201/201 passed at 390×844 (mobile viewport).
See `PROJECT_HANDOFF.md` for exactly what was and was not tested.

## Repo (intended)

`stainlesssteel770/nepadispatch-mvp` on GitHub Pages. GitHub was not
connected when this prototype was built, so nothing has been pushed
and no repo has been created. To publish: connect GitHub, create the
private repo, push this tree, enable Pages.
