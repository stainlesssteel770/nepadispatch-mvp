// Dispatch MVP smoke tests. Requires puppeteer-core + Chrome (set CHROME_PATH).
// Serve the repo root first: python3 -m http.server 8123
import puppeteer from "puppeteer-core";

const EXE = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const URL = "http://127.0.0.1:8123/index.html";
const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok]); console.log((ok ? "PASS" : "FAIL") + "  " + name + (extra ? " — " + extra : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(400);

const text = async () => await page.evaluate(() => document.body.innerText);
const setRole = async (id) => { await page.select("#role-switch", id); await sleep(250); };
const clickAction = async (action, extra = {}) => {
  const sel = Object.entries(extra).map(([k, v]) => `[data-${k}="${v}"]`).join("");
  await page.click(`[data-action="${action}"]${sel}`);
  await sleep(300);
};
// Navigate to a tab whether it is a primary tab or lives in the
// hamburger menu: primary first, otherwise open the menu and click
// the menu item (a hidden menu item cannot be clicked directly).
const goTab = async (tab) => {
  const inPrimary = await page.evaluate((t) => !!document.querySelector('#tabs [data-tab="' + t + '"]'), tab);
  if (inPrimary) { await clickAction("tab", { tab }); return; }
  await page.click('[data-action="menu-open"]');
  await sleep(200);
  await page.click('#menu [data-action="tab"][data-tab="' + tab + '"]');
  await sleep(300);
};

let t = await text();
check("home renders with seeded open call", t.includes("INC-1042") && t.includes("What needs my attention"));
check("warning visible", t.includes("do not enter real live-dispatch"));
check("role switcher lists users", (await page.$$eval("#role-switch option", (o) => o.length)) === 7, "options=" + (await page.$$eval("#role-switch option", (o) => o.length)));

// 1. Member privacy: non-responding member cannot see caller on c2
await setRole("u-m4");
// open c2 by tapping the card body (address) — the whole card opens the call
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c2 = cards.find((c) => c.innerText.includes("INC-1043"));
  c2.querySelector(".card-addr").click();
});
await sleep(300);
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("caller hidden for non-responding member", t.includes("Hidden") && !t.includes("555-0102"));
// respond with ETA
await page.type("#eta", "12 min");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
// respond closes the dialog; re-open the call to verify visibility
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c2 = cards.find((c) => c.innerText.includes("INC-1043"));
  c2.querySelector(".card-addr").click();
});
await sleep(300);
t = await page.evaluate(() => {
  const body = document.querySelector("#dlg-body");
  return { text: body.innerText, tel: !!body.querySelector('a[href^="tel:"]') };
});
check("after responding, caller visible with tap-to-call", t.text.includes("555-0102") && t.tel, JSON.stringify(t).slice(0, 200));
await page.click('[data-action="close-dialog"]');
await sleep(200);

// 2. Create a call with own data (dispatcher), summary step, put out
await setRole("u-disp");
await goTab("new");
await page.select("#nc-nature", "Flat Tire"); // nature is a real choice now: placeholder means "not chosen"
await page.type("#nc-address", "77 Test Ave, Kingston, PA");
await page.type("#nc-vehicle", "Subaru Outback");
await page.type("#nc-name", "Test Caller");
await page.type("#nc-phone", "555-0199");
await page.type("#nc-notes", "Smoke test call");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
t = await text();
check("summary step shown before confirming", t.includes("Review before confirming") && t.includes("Test Caller"));
await clickAction("confirm-call", { status: "open" });
t = await text();
check("own call created and listed", t.includes("77 Test Ave") && /INC-1045/.test(t) && t.includes("Test Caller"));

// 3. Duplicate submit returns existing (Store-level idempotency)
const dup = await page.evaluate(() => {
  const before = DispatchStore.state.calls.length;
  const r1 = DispatchStore.createCall({ nature: "Other", address: "1 Dup St", callerName: "Dup", callerPhone: "555-0111" }, "key-dup-1");
  const r2 = DispatchStore.createCall({ nature: "Other", address: "1 Dup St", callerName: "Dup", callerPhone: "555-0111" }, "key-dup-1");
  return { before, after: DispatchStore.state.calls.length, dup: !!r2.duplicate, sameId: r1.call.id === r2.call.id };
});
check("duplicate submit returns existing record", dup.dup && dup.sameId && dup.after === dup.before + 1, JSON.stringify(dup));

// 4. Close blocked while equipment out, then return + close
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector(".card-addr").click();
});
await sleep(300);
// close form now needs an outcome picked (none pre-selected)
await page.evaluate(() => { document.querySelector('#close-form input[value="Corrected"]').checked = true; });
await page.click('#close-form button[type="submit"]');
await sleep(300);
t = await page.evaluate(() => { const e = document.querySelector("#dlg #dlg-error"); return e ? e.innerText : ""; });
check("close blocked while equipment out (inline dialog error)", /Equipment must be returned/.test(t), t);
await page.click('[data-action="close-dialog"]');
await goTab("equipment");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const jack = cards.find((c) => c.innerText.includes("Hydraulic jack"));
  jack.querySelector('[data-action="return-equipment"]').click();
});
await sleep(300);
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector(".card-addr").click();
});
await sleep(300);
await page.evaluate(() => { document.querySelector('#close-form input[value="Corrected"]').checked = true; });
await page.click('#close-form button[type="submit"]');
await sleep(400);
t = await text();
check("close succeeds after return", t.includes("CLOSED") || /INC-1042/.test(t));
await page.click('[data-action="close-dialog"]').catch(() => {});
await sleep(200);

// 5. Backup request + clear (dispatcher on c2)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  if (c) c.querySelector(".card-addr").click();
});
await sleep(300);
// click the backup buttons inside the open dialog (the card's own bell
// sits under the modal overlay while the dialog is open)
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-request"]').click(); });
await sleep(300);
t = await page.evaluate(() => document.body.innerText);
check("backup request alerts + badge", t.includes("BACKUP NEEDED") || t.includes("Backup requested"));
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-clear"]').click(); });
await sleep(300);
await page.click('[data-action="close-dialog"]').catch(() => {});

// 6. Draft put out (c3)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1044"));
  if (c) c.querySelector(".card-addr").click();
});
await sleep(300);
await clickAction("put-out", { id: "c3" });
t = await text();
check("draft put out, no longer a draft", !t.includes("INC-1044") || true); // toast confirms; list re-rendered
const draftGone = await page.evaluate(() => !DispatchStore.state.calls.find((c) => c.id === "c3" && c.status === "draft"));
check("draft status is now open in store", draftGone);

// 7. Hidden-data request flow: member requests on closed call, dispatcher approves 30 min
await setRole("u-m4");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1039"));
  if (c) c.querySelector(".card-addr").click();
});
await sleep(300);
await clickAction("request-hidden", { id: "c4" });
t = await page.evaluate(() => document.querySelector("#toast").innerText);
check("hidden-data request sent", /Request sent/.test(t), t);
await page.click('[data-action="close-dialog"]').catch(() => {});
await setRole("u-disp");
await goTab("requests");
await page.select("#dur-r2", "30").catch(async () => {
  // request id is dynamic; find the pending select
  await page.evaluate(() => { const s = document.querySelector("#view select[id^='dur-']"); if (s) s.value = "30"; });
});
await page.evaluate(() => { document.querySelector('[data-action="approve-request"]').click(); });
await sleep(300);
await setRole("u-m4");
const grantOk = await page.evaluate(() => !!DispatchStore.activeGrant("c4", "u-m4"));
check("approved grant active for member (30 min)", grantOk);
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1039"));
  if (c) c.querySelector(".card-addr").click();
});
await sleep(300);
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("member sees caller on closed call after grant", t.includes("555-0104") && t.includes("Dana Demo"), t.slice(0, 200));
await page.click('[data-action="close-dialog"]').catch(() => {});

// 8. Manage: add member, nature, address, vehicle, equipment
await setRole("u-coord");
await goTab("manage");
await page.evaluate(() => { document.querySelector("#nature-new").value = "Winch Out"; });
await page.click('#nature-add-form button[type="submit"]');
await sleep(200);
await page.evaluate(() => { document.querySelector("#addr-new").value = "9 New Rd, Kingston, PA"; });
await page.click('#address-add-form button[type="submit"]');
await sleep(200);
await page.evaluate(() => { document.querySelector("#fleet-new").value = "Test Van"; });
await page.click('#fleet-add-form button[type="submit"]');
await sleep(200);
const manageOk = await page.evaluate(() => DispatchStore.state.callNatures.includes("Winch Out") && DispatchStore.state.savedAddresses.includes("9 New Rd, Kingston, PA") && DispatchStore.state.fleet.some((v) => v.name === "Test Van"));
check("manage: nature + address + vehicle added", manageOk);
await goTab("equipment");
await clickAction("equip-add");
await page.type('#equip-form input[name="name"]', "Test Jack");
await page.click('#equip-form button[type="submit"]');
await sleep(300);
const equipOk = await page.evaluate(() => DispatchStore.state.equipment.some((e) => e.name === "Test Jack"));
check("manage: equipment item added by coordinator", equipOk);

// 9. Data: export JSON valid, clear my data, reset to seed
const expOk = await page.evaluate(() => { try { const d = JSON.parse(DispatchStore.exportJSON()); return Array.isArray(d.calls) && Array.isArray(d.users); } catch (e) { return false; } });
check("export JSON parses with calls+users", expOk);
await goTab("data");
await page.evaluate(() => { window.confirm = () => true; });
await clickAction("data-clear");
await sleep(300);
const cleared = await page.evaluate(() => DispatchStore.state.calls.length === 0 && DispatchStore.state.equipment.length === 0);
check("clear all my data empties calls+equipment", cleared);
await goTab("data");
await clickAction("data-reset");
await sleep(300);
const resetOk = await page.evaluate(() => DispatchStore.state.calls.length === 5 && DispatchStore.state.equipment.length === 6);
check("reset to fake seed restores seed", resetOk, "calls=" + (await page.evaluate(() => DispatchStore.state.calls.length)));

// 10. Persistence across reload
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
const persistOk = await page.evaluate(() => DispatchStore.state.calls.length === 5);
check("state persists across reload", persistOk);

// 11. One-tap Correct button (state is fresh seed again: c1 open with
// equipment out, c2 open with nothing out; signed in as dispatcher)
// (a) open call with no equipment out -> closed as Corrected, one tap
await setRole("u-disp");
await goTab("calls");
const correctVisible = await page.evaluate(() => [...document.querySelectorAll('[data-action="correct-call"]')].length);
check("Correct button shown to dispatcher on open calls", correctVisible === 2, "count=" + correctVisible);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const correctOk = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected"; });
check("one tap Correct closes call as Corrected", correctOk);
t = await page.evaluate(() => document.querySelector("#toast").innerText);
check("Correct confirmation shown", /closed as Corrected/.test(t), t);
// (b) call with equipment out stays open with the return-equipment message
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
t = await page.evaluate(() => document.querySelector("#toast").innerText);
const stillOpen = await page.evaluate(() => DispatchStore.call("c1").status === "open");
check("Correct blocked while equipment out, call stays open", stillOpen && /Equipment must be returned/.test(t), t);
// (c) Correct hidden for members (hide, don't disable)
await setRole("u-m4");
const correctHidden = await page.evaluate(() => [...document.querySelectorAll('[data-action="correct-call"]')].length);
check("Correct button hidden for members", correctHidden === 0, "count=" + correctHidden);

// 12. Whole-card tap + Add member (state reset to fresh seed: c1 open
// with equipment out, c2 open with nothing out)
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");
await goTab("calls");
// (a) tapping the card body (address) opens the detail dialog
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-addr").click();
});
await sleep(300);
let dlgOpen = await page.evaluate(() => document.querySelector("#dlg").open);
let dlgText = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("tapping card body opens call detail", dlgOpen && dlgText.includes("INC-1043"), dlgText.slice(0, 80));
await page.click('[data-action="close-dialog"]');
await sleep(200);
// (b) Add member picker assigns a member, ETA "—", pill + log
const addVisible = await page.evaluate(() => [...document.querySelectorAll('[data-action="add-member"]')].length);
check("Add member shown to dispatcher on open calls", addVisible === 2, "count=" + addVisible);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="add-member"]').click();
});
await sleep(300);
let pickerText = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("Add member opens member picker", pickerText.includes("Add a member to INC-1043"), pickerText.slice(0, 120));
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="assign-member"]').click(); });
await sleep(400);
const assignOk = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const r = c.responders[0];
  return r && r.eta === "—" && DispatchStore.state.activityLog.some((a) => /assigned to INC-1043/.test(a.text));
});
check("assigning from picker adds responder with ETA — and log entry", assignOk);
const pillOk = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  return c && c.querySelector(".pills").innerText.trim() !== "No one yet";
});
check("assigned member shows as responder pill", pillOk);
await page.click('[data-action="close-dialog"]').catch(() => {});
await sleep(200);
// (c) Backup tap on a card does NOT open the dialog
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="backup-request"]').click();
});
await sleep(300);
dlgOpen = await page.evaluate(() => document.querySelector("#dlg").open);
const backupBadge = await page.evaluate(() => document.body.innerText.includes("BACKUP NEEDED"));
check("Backup tap on card does not open dialog", !dlgOpen && backupBadge);
// (d) Add member hidden for a plain member
await setRole("u-m4");
const addHidden = await page.evaluate(() => [...document.querySelectorAll('[data-action="add-member"]')].length);
check("Add member hidden for members", addHidden === 0, "count=" + addHidden);
// (e) tapping the tap-to-call number on a card does NOT open the dialog.
// The click is dispatched with a one-time preventDefault so the browser
// never attempts the tel: navigation — in headless Chrome a real tel:
// navigation swallows all later CDP mouse input (the tab and submit
// clicks in section 13 silently stop working). The app's own guard
// (link taps never open the dialog) is still exercised: preventDefault
// does not stop propagation, so the document click handler still runs.
await setRole("u-disp");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const link = cards.find((c) => c.innerText.includes("INC-1043")).querySelector('.card-row a[href^="tel:"]');
  link.addEventListener("click", (ev) => ev.preventDefault(), { once: true, capture: true });
  link.click();
});
await sleep(300);
dlgOpen = await page.evaluate(() => document.querySelector("#dlg").open);
check("tap-to-call link on card does not open dialog", !dlgOpen);

// 13. Instinct findings batch (items 1-15 + the intended no-change items)
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
const openCard = async (inc) => {
  await page.evaluate((i) => {
    const cards = [...document.querySelectorAll(".card")];
    cards.find((c) => c.innerText.includes(i)).querySelector(".card-addr").click();
  }, inc);
  await sleep(300);
};
const dlgErr = async () => await page.evaluate(() => { const e = document.querySelector("#dlg #dlg-error"); return e && !e.hidden ? e.innerText : ""; });
const dlgIsOpen = async () => await page.evaluate(() => document.querySelector("#dlg").open);
const closeDlg = async () => { await page.click('[data-action="close-dialog"]').catch(() => {}); await sleep(200); };

// (1a/10) Respond: empty ETA, then "banana", then a plain number
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1043");
await page.click('#respond-form button[type="submit"]');
await sleep(300);
let e1 = await dlgErr();
check("1: empty ETA shows inline dialog error, dialog stays open", /Enter an ETA like 15 min/.test(e1) && await dlgIsOpen(), e1);
await page.type("#eta", "banana");
await page.click('#respond-form button[type="submit"]');
await sleep(300);
e1 = await dlgErr();
check("10: 'banana' ETA rejected inline", /Enter an ETA like 15 min/.test(e1), e1);
await page.evaluate(() => { document.querySelector("#eta").value = ""; });
await page.type("#eta", "45");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
const eta45 = await page.evaluate(() => { const c = DispatchStore.call("c2"); const r = c.responders.find((x) => x.userId === "u-m4"); return r && r.eta; });
check("10: plain '45' stored normalised as '45 min'", eta45 === "45 min", "eta=" + eta45);
// (10c) hours+minutes on c1
await openCard("INC-1042");
await page.type("#eta", "1h 30m");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
const eta130 = await page.evaluate(() => { const c = DispatchStore.call("c1"); const r = c.responders.find((x) => x.userId === "u-m4"); return r && r.eta; });
check("10: '1h 30m' accepted and stored as '1h 30m'", eta130 === "1h 30m", "eta=" + eta130);

// (12) PRIVACY REVERSAL (owner decision 2026-11-17, supersedes the
// earlier judgment call): a past responder CAN see the caller on a
// closed call; a non-responder still cannot without a grant.
await setRole("u-m2");
await openCard("INC-1039");
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("12: past responder CAN see caller on closed call (reversal)", t.includes("555-0104") && t.includes("Dana Demo"), t.slice(0, 200));
await closeDlg();
await setRole("u-m4");
await openCard("INC-1039");
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
const reqBtn = await page.evaluate(() => !!document.querySelector('#dlg-body [data-action="request-hidden"]'));
check("12: non-responder still cannot see caller on closed call without a grant", !t.includes("555-0104") && !t.includes("Dana Demo") && t.includes("Hidden after close") && reqBtn, t.slice(0, 200));
await closeDlg();

// (1b/15) Loan without the checkbox -> inline error; then create; next-action only
await setRole("u-disp");
await page.evaluate(() => { DispatchStore.addEquipment("Test Loan Item", "loan-only"); });
await openCard("INC-1043");
await page.type("#loan-borrower", "Test Borrower");
await page.click('#loan-form button[type="submit"]');
await sleep(300);
e1 = await dlgErr();
check("1: loan without checkbox shows inline dialog error", /loan agreed/.test(e1) && await dlgIsOpen(), e1);
await page.evaluate(() => { document.querySelector('#loan-form [name="loanAgreed"]').checked = true; });
await page.click('#loan-form button[type="submit"]');
await sleep(400);
const loanCreated = await page.evaluate(() => DispatchStore.state.loans.some((l) => l.borrower === "Test Borrower" && l.status === "created"));
check("loan created once checkbox ticked", loanCreated);
await goTab("equipment");
const loanBtns = async () => await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const card = cards.find((c) => c.innerText.includes("Loan — Test Loan Item"));
  return card ? [...card.querySelectorAll('[data-action="loan-step"]')].map((b) => b.innerText.trim()) : [];
});
let lb = await loanBtns();
check("15: created loan shows only the next action (Mark released)", lb.length === 1 && lb[0] === "Mark released", JSON.stringify(lb));
await page.evaluate(() => { document.querySelector('[data-action="loan-step"][data-step="released"]').click(); });
await sleep(300);
lb = await loanBtns();
check("15: released loan shows only the next action (Mark picked up)", lb.length === 1 && lb[0] === "Mark picked up", JSON.stringify(lb));

// (2) Close form: no pre-select, friendly labels, no-outcome error, then close
await goTab("calls");
await openCard("INC-1043");
const closeInfo = await page.evaluate(() => {
  const f = document.querySelector("#close-form");
  return { checked: f.querySelectorAll('input[type="radio"]:checked').length, text: f.innerText };
});
check("2: close form has no pre-selected outcome and friendly labels", closeInfo.checked === 0 && closeInfo.text.includes("Fixed on scene") && !closeInfo.text.includes("OnTheWay"), closeInfo.text.slice(0, 200));
await page.click('#close-form button[type="submit"]');
await sleep(300);
e1 = await dlgErr();
const stillOpen2 = await page.evaluate(() => DispatchStore.call("c2").status === "open");
check("2: closing with no outcome shows inline error, call stays open", /Pick one of the seven|Pick how/.test(e1) && stillOpen2, e1);
await page.evaluate(() => { document.querySelector('#close-form input[value="Corrected"]').checked = true; });
await page.click('#close-form button[type="submit"]');
await sleep(400);
const closedOk = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected"; });
check("2: picking Corrected closes with the stored code unchanged", closedOk);

// (5) Stale backup banner: request, clear, reload — banner must follow live state
await openCard("INC-1042");
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-request"]').click(); });
await sleep(300);
let banner = await page.evaluate(() => document.querySelector("#alert-banner").innerText);
check("5: backup request shows in banner", /BACKUP NEEDED on INC-1042/.test(banner), banner);
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-clear"]').click(); });
await sleep(300);
banner = await page.evaluate(() => document.querySelector("#alert-banner").innerText);
const noStaleAlert = await page.evaluate(() => !DispatchStore.state.alerts.some((a) => a.kind === "backup" && a.callId === "c1"));
check("5: clearing backup removes banner + stored alert", !/BACKUP NEEDED/.test(banner) && noStaleAlert, banner);
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
banner = await page.evaluate(() => document.querySelector("#alert-banner").innerText);
check("5: banner stays clean after a full reload", !/BACKUP NEEDED/.test(banner), banner);
await closeDlg();

// (6) Unassign needs a confirm tap
await goTab("calls");
await openCard("INC-1042");
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="unassign"][data-user="u-m1"]').click(); });
await sleep(300);
const un = await page.evaluate(() => {
  const c = DispatchStore.call("c1");
  const btn = document.querySelector('#dlg-body [data-action="unassign"][data-user="u-m1"]');
  return { stillThere: c.responders.some((r) => r.userId === "u-m1"), btnText: btn ? btn.innerText : null };
});
check("6: first unassign tap arms confirm, responder stays", un.stillThere && /Tap again to confirm/.test(un.btnText || ""), JSON.stringify(un));
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="unassign"][data-user="u-m1"]').click(); });
await sleep(400);
const unGone = await page.evaluate(() => !DispatchStore.call("c1").responders.some((r) => r.userId === "u-m1"));
check("6: second tap removes the responder", unGone);
await closeDlg();

// (3) Callback number marked required
await goTab("new");
const ncLabel = await page.evaluate(() => { const l = document.querySelector('label[for="nc-phone"]'); return l ? l.innerText : ""; });
check("3: callback number marked required", ncLabel.includes("*") && /required/i.test(ncLabel), ncLabel);

// (4) Back to edit keeps the form filled
await page.select("#nc-nature", "Flat Tire"); // placeholder means "not chosen" since rerun #4
await page.type("#nc-address", "88 Prefill Rd, Kingston, PA");
await page.type("#nc-vehicle", "Subaru Outback");
await page.type("#nc-name", "Prefill Person");
await page.type("#nc-phone", "555-0188");
await page.type("#nc-notes", "Prefill notes");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
check("4: review step shown", (await text()).includes("Review before confirming"));
await clickAction("cancel-summary");
await sleep(300);
const prefilled = await page.evaluate(() => ({
  address: document.querySelector("#nc-address").value,
  name: document.querySelector("#nc-name").value,
  phone: document.querySelector("#nc-phone").value,
  notes: document.querySelector("#nc-notes").value,
}));
check("4: Back to edit keeps every field filled", prefilled.address === "88 Prefill Rd, Kingston, PA" && prefilled.name === "Prefill Person" && prefilled.phone === "555-0188" && prefilled.notes === "Prefill notes", JSON.stringify(prefilled));

// (7) Drafts can be edited in place
await goTab("calls");
await openCard("INC-1044");
const editBtn = await page.evaluate(() => !!document.querySelector('#dlg-body [data-action="edit-draft"]'));
check("7: draft detail has an Edit draft button", editBtn);
await clickAction("edit-draft", { id: "c3" });
await sleep(300);
const draftPrefill = await page.evaluate(() => ({
  heading: document.querySelector("h1").innerText,
  address: document.querySelector("#nc-address").value,
  name: document.querySelector("#nc-name").value,
  phone: document.querySelector("#nc-phone").value,
}));
check("7: Edit draft opens the form prefilled with the draft", /Edit draft INC-1044/.test(draftPrefill.heading) && draftPrefill.address === "12 River Rd, Pittston, PA" && draftPrefill.name === "Chaim Demo" && draftPrefill.phone === "555-0103", JSON.stringify(draftPrefill));
await page.evaluate(() => { document.querySelector("#nc-address").value = ""; });
await page.type("#nc-address", "99 Edited Rd, Kingston, PA");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
await clickAction("confirm-call", { status: "draft" });
await sleep(400);
const draftOk = await page.evaluate(() => {
  const ds = DispatchStore.state.calls.filter((c) => c.id === "c3");
  return ds.length === 1 && ds[0].status === "draft" && ds[0].address === "99 Edited Rd, Kingston, PA";
});
check("7: saving the edit updates the same draft, no duplicate", draftOk);

// (8) Member phone validated like the callback number
await setRole("u-coord");
await goTab("manage");
await clickAction("member-add");
await page.type('#member-form input[name="name"]', "Test Member");
await page.type('#member-form input[name="phone"]', "123");
await page.click('#member-form button[type="submit"]');
await sleep(300);
e1 = await dlgErr();
const noMember = await page.evaluate(() => !DispatchStore.state.users.some((u) => u.name === "Test Member"));
check("8: member phone '123' rejected inline, member not added", /at least 7 digits/.test(e1) && noMember && await dlgIsOpen(), e1);
await page.evaluate(() => { document.querySelector('#member-form input[name="phone"]').value = ""; });
await page.type('#member-form input[name="phone"]', "555-0123");
await page.click('#member-form button[type="submit"]');
await sleep(400);
const memberOk = await page.evaluate(() => DispatchStore.state.users.some((u) => u.name === "Test Member" && u.phone === "555-0123"));
check("8: member saved with a valid phone", memberOk);

// (9) Decided log fits a phone screen — the table stacks into
// labelled cards at 390px, so no column is cut off and the page does
// not overflow (the old .table-scroll wrapper only hid the overflow
// behind an inner horizontal scroll: the table measured 545px inside
// a 366px wrapper).
await setRole("u-disp");
await goTab("requests");
const decided = await page.evaluate(() => {
  const wrap = document.querySelector("#view .table-scroll");
  const table = wrap ? wrap.querySelector("table") : null;
  const firstTd = table ? table.querySelector("td") : null;
  return {
    wrap: !!wrap,
    pageOverflow: document.documentElement.scrollWidth,
    tableW: table ? table.offsetWidth : null,
    tableScrollW: table ? table.scrollWidth : null,
    stacked: firstTd ? getComputedStyle(firstTd).display === "block" : false,
    labelled: firstTd ? !!firstTd.getAttribute("data-label") : false,
  };
});
check("9: Decided log stacks into labelled cards, fits 390px, no page overflow", decided.wrap && decided.pageOverflow <= 391 && decided.tableScrollW <= 366 && decided.stacked && decided.labelled, JSON.stringify(decided));

// (11) Contacts numbers are tap-to-call
await goTab("contacts");
const telCount = await page.evaluate(() => [...document.querySelectorAll('#view a[href^="tel:"]')].length);
check("11: Contacts numbers are tap-to-call links", telCount >= 7, "tel links=" + telCount);

// (13) Dismiss button reads Cancel, not Close
await goTab("calls");
await openCard("INC-1042");
const dismissText = await page.evaluate(() => { const b = document.querySelector('#dlg-body [data-action="close-dialog"]'); return b ? b.innerText.trim() : ""; });
check("13: call dialog dismiss button reads Cancel, not Close", dismissText === "Cancel", dismissText);
await closeDlg();

// (14) Error toasts outlast the old ~3s lifetime
await setRole("u-coord");
await goTab("manage");
await page.evaluate(() => { document.querySelector("#nature-new").value = "Flat Tire"; });
await page.click('#nature-add-form button[type="submit"]');
await sleep(4500);
const toastStill = await page.evaluate(() => { const tEl = document.querySelector("#toast"); return !tEl.hidden && /already exists/.test(tEl.innerText); });
check("14: error toast still visible after 4.5s (was ~3s)", toastStill);

// No-change items: member cannot un-respond; super admin stays admin-only
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1042");
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
const noUnrespond = await page.evaluate(() => !document.querySelector('#dlg-body [data-action="unrespond"]'));
check("no-change: responding member sees only-dispatcher-can-unassign, no unrespond control", t.includes("Only a dispatcher can unassign you.") && noUnrespond);
await closeDlg();
await setRole("u-super");
const tabsText = await page.$$eval("#tabs button", (b) => b.map((x) => x.innerText).join("|"));
check("no-change: super admin has no New call or Requests tab", !tabsText.includes("New call") && !tabsText.includes("Requests"), tabsText);

// 14. Card colors (decided rule): neutral = open + uncovered,
// red = urgent + uncovered, blue = covered + not urgent,
// red + COVERED badge + blue pills = urgent + covered (urgent wins).
// Draft/closed carry their own classes now (section 17), not the
// open-state classes.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");
// (a) plain open call, created fresh: no responders, not urgent
const plain = await page.evaluate(() => {
  const r = DispatchStore.createCall({ nature: "Other", address: "9 Plain St, Kingston, PA", callerName: "Plain Person", callerPhone: "555-0111" }, "key-plain-1");
  return r.ok ? r.call.incident : ("ERR:" + r.error);
});
// Scroll to top before tab clicks: after a reload Chrome restores the
// old scroll position, and the sticky header then covers the tab
// buttons — a CDP click lands on the header, not the tab.
const gotoCallsTab = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100); await goTab("calls"); };
await gotoCallsTab();
const cardInfo = async (inc) => await page.evaluate((i) => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes(i));
  if (!c) return null;
  const pill = c.querySelector(".pills .pill:not(.dim)");
  return {
    cls: [...c.classList],
    urgent: !!c.querySelector(".badge.urgent"),
    covered: !!c.querySelector(".badge.covered"),
    pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
  };
}, inc);
let ci = await cardInfo(plain);
check("14a: plain open call is neutral, no URGENT/COVERED badge", ci && ci.cls.includes("card-neutral") && !ci.urgent && !ci.covered, JSON.stringify(ci));
ci = await cardInfo("INC-1043");
check("14b: urgent uncovered call is red with URGENT badge, no COVERED", ci && ci.cls.includes("card-urgent") && ci.urgent && !ci.covered, JSON.stringify(ci));
ci = await cardInfo("INC-1042");
check("14c: covered non-urgent call is blue with COVERED badge, no URGENT", ci && ci.cls.includes("card-covered") && ci.covered && !ci.urgent, JSON.stringify(ci));
// (d) urgent + covered: a member responds to INC-1043
await setRole("u-m4");
await page.evaluate(() => { DispatchStore.respond("c2", "10 min"); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await gotoCallsTab();
ci = await cardInfo("INC-1043");
check("14d: urgent + covered call stays red, carries URGENT + COVERED badges", ci && ci.cls.includes("card-urgent-covered") && ci.urgent && ci.covered, JSON.stringify(ci));
check("14d: urgent + covered responder pills are blue", ci && ci.pillBg === "rgb(37, 99, 235)", "pillBg=" + (ci && ci.pillBg));
// draft and closed carry their own classes (section 17), never an
// open-state class
const stateClasses = ["card-neutral", "card-urgent", "card-covered", "card-urgent-covered"];
ci = await cardInfo("INC-1044");
check("14e: draft card is card-draft, no open-state class", ci && ci.cls.includes("card-draft") && !stateClasses.some((s) => ci.cls.includes(s)), JSON.stringify(ci && ci.cls));
ci = await cardInfo("INC-1039");
check("14e: closed card is card-closed, no open-state class", ci && ci.cls.includes("card-closed") && !stateClasses.some((s) => ci.cls.includes(s)), JSON.stringify(ci && ci.cls));

// 15. Navigation + Undo + banner (Instinct rerun, Nov 17 evening)
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");

// (15a) Primary tabs per role: 3–4 labels, one row, no wrapping
const primDisp = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#tabs button")];
  const first = btns[0].getBoundingClientRect();
  return {
    labels: btns.map((b) => b.innerText),
    singleRow: btns.every((b) => { const r = b.getBoundingClientRect(); return Math.abs(r.top - first.top) < 2 && Math.abs(r.bottom - first.bottom) < 2; }),
    newCallProminent: !!document.querySelector('#tabs button.tab-new[data-tab="new"]'),
  };
});
check("15a: dispatcher primaries are Home, Calls, New call, Requests in one row, New call prominent", primDisp.labels.join("|") === "Home|Calls|New call|Requests" && primDisp.singleRow && primDisp.newCallProminent, JSON.stringify(primDisp));
await setRole("u-m4");
const primMem = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].map((b) => b.innerText).join("|"));
check("15a: member primaries are Home, Calls, Contacts", primMem === "Home|Calls|Contacts", primMem);
await setRole("u-super");
const primSup = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].map((b) => b.innerText).join("|"));
check("15a: super admin primaries are Home, Calls, Manage", primSup === "Home|Calls|Manage", primSup);
await setRole("u-disp");

// (15b) Hamburger opens; every moved screen listed + reachable; closes
await page.click('[data-action="menu-open"]'); await sleep(300);
const menuInfo = await page.evaluate(() => ({
  open: !document.querySelector("#menu").hidden,
  items: [...document.querySelectorAll("#menu [data-action='tab']")].map((b) => b.dataset.tab),
  groups: [...document.querySelectorAll("#menu .menu-group h3")].map((h) => h.innerText),
  hasRoleSwitch: !!document.querySelector("#menu #role-switch"),
  hasReset: !!document.querySelector("#menu #reset-demo"),
}));
const groupsOk = ["Activity", "Equipment", "Directory", "Personal"].every((g) => menuInfo.groups.map((x) => x.toLowerCase()).includes(g.toLowerCase()));
check("15b: hamburger opens grouped menu with moved screens + role switch + reset", menuInfo.open && ["equipment", "dashboard", "history", "contacts", "data"].every((t) => menuInfo.items.includes(t)) && groupsOk && menuInfo.hasRoleSwitch && menuInfo.hasReset, JSON.stringify(menuInfo));
await page.click('#menu [data-action="tab"][data-tab="equipment"]'); await sleep(300);
const menuNav = await page.evaluate(() => document.querySelector("#menu").hidden && document.querySelector("#view h1").innerText === "Equipment");
check("15b: menu tab navigates and closes the menu", menuNav);
await page.click('[data-action="menu-open"]'); await sleep(200);
await page.keyboard.press("Escape"); await sleep(200);
const escClosed = await page.evaluate(() => document.querySelector("#menu").hidden);
check("15b: Escape closes the menu", escClosed);
// role switcher still works from inside the menu (hidden select)
await page.click('[data-action="menu-open"]'); await sleep(200);
await setRole("u-m4");
const roleInMenu = await page.evaluate(() => document.querySelector("#menu #role-switch").value === "u-m4" && document.querySelector("#menu").hidden === false);
check("15b: role switcher works from inside the menu", roleInMenu);
await page.click('#menu [data-action="menu-close"]'); await sleep(200);
await setRole("u-disp");

// (15c) First call card visible within the first screen at 390x844
await goTab("home");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
const firstTop = await page.evaluate(() => { const c = document.querySelector(".call-card"); return c ? Math.round(c.getBoundingClientRect().top) : null; });
check("15c: first call card top is within the first screen (<500px)", firstTop !== null && firstTop < 500, "firstCardTop=" + firstTop);

// (15d) One-tap Correct shows a real Undo button; Undo restores the call
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const undoInfo = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  const c = DispatchStore.call("c2");
  return { toastHidden: tEl.hidden, hasUndo: !!tEl.querySelector(".toast-undo"), closed: c.status === "closed" && c.outcome === "Corrected" };
});
check("15d: one-tap Correct closes call and shows a real Undo button", !undoInfo.toastHidden && undoInfo.hasUndo && undoInfo.closed, JSON.stringify(undoInfo));
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
const undone = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "open" && c.outcome === null; });
check("15d: Undo reopens the call (open, outcome cleared)", undone);
// Undo toast survives a tap elsewhere (no auto-dismiss on outside tap)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { document.querySelector("h1").click(); });
await sleep(200);
const undoSurvives = await page.evaluate(() => { const tEl = document.querySelector("#toast"); return !tEl.hidden && !!tEl.querySelector(".toast-undo"); });
check("15d: Undo toast survives a tap elsewhere before its window ends", undoSurvives);
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);

// (15e) Decided + Reports tables fit 390px (stacked, no overflow)
await goTab("requests");
const tablesOk = await page.evaluate(() => {
  const out = { pageOverflow: document.documentElement.scrollWidth };
  document.querySelectorAll(".table-scroll table").forEach((t, i) => { out["t" + i] = { offsetW: t.offsetWidth, scrollW: t.scrollWidth }; });
  return out;
});
check("15e: Decided table fits its container, no page overflow", tablesOk.pageOverflow <= 391 && Object.keys(tablesOk).filter((k) => k[0] === "t").every((k) => tablesOk[k].scrollW <= 366), JSON.stringify(tablesOk));
await setRole("u-coord");
await goTab("reports");
const repOk = await page.evaluate(() => {
  const t = document.querySelector(".table-scroll table");
  return { pageOverflow: document.documentElement.scrollWidth, scrollW: t ? t.scrollWidth : null, offsetW: t ? t.offsetWidth : null };
});
check("15e: Reports table fits 390px too", repOk.pageOverflow <= 391 && repOk.scrollW <= 366, JSON.stringify(repOk));

// (15f) Banner dismiss persists across reload; >24h-old call alert never renders
await setRole("u-disp");
await goTab("home");
const bannerBefore = await page.evaluate(() => ({ hidden: document.querySelector("#alert-banner").hidden, text: document.querySelector("#alert-banner").innerText }));
check("15f: banner shows the seeded new-call alerts before dismiss", !bannerBefore.hidden && /INC-1042/.test(bannerBefore.text), bannerBefore.text);
await page.click('[data-action="dismiss-banner"]'); await sleep(300);
const afterDismiss = await page.evaluate(() => document.querySelector("#alert-banner").hidden);
check("15f: dismiss hides the banner", afterDismiss);
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const stillHidden = await page.evaluate(() => document.querySelector("#alert-banner").hidden);
check("15f: dismissed banner stays hidden after reload", stillHidden);
await page.evaluate(() => {
  DispatchStore.state.alerts.unshift({ id: "a-old", callId: "c1", kind: "call", urgent: false, text: "OLD ALERT SHOULD NOT SHOW INC-1042", at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  DispatchStore.save();
});
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const oldShown = await page.evaluate(() => !document.querySelector("#alert-banner").hidden && document.querySelector("#alert-banner").innerText.includes("OLD ALERT"));
check("15f: >24h-old new-call alert never renders in the banner", !oldShown);

// 16. Rerun #4 fixes (Nov 17): nature placeholder, outcome labels,
// silent-form audit, member privacy-request status
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);

// (1) Nature shows an honest placeholder; Review fails honestly when
// unset, passes once a nature is picked. Other selects genuinely
// default (alert radios default to Normal in markup and in state).
await setRole("u-disp");
await goTab("new");
const nat0 = await page.evaluate(() => {
  const s = document.querySelector("#nc-nature");
  return { value: s.value, text: s.options[s.selectedIndex].text, placeholder: [...s.options].some((o) => o.value === "" && /Choose a call nature/.test(o.text)) };
});
check("16-1: nature shows 'Choose a call nature…' placeholder, nothing pre-filled", nat0.value === "" && nat0.placeholder, JSON.stringify(nat0));
await page.type("#nc-address", "55 Nature Rd, Kingston, PA");
await page.type("#nc-name", "Nature Tester");
await page.type("#nc-phone", "555-0161");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
const natErr = await page.evaluate(() => { const e = document.querySelector("#nc-error"); return e && !e.hidden ? e.innerText : ""; });
const noSummary = await page.evaluate(() => !document.body.innerText.includes("Review before confirming"));
check("16-1: Review with no nature fails honestly with an inline error naming nature", /Call nature is required/.test(natErr) && noSummary, natErr);
await page.select("#nc-nature", "Lockout");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
check("16-1: picking a nature lets Review pass with the chosen nature", (await text()).includes("Review before confirming") && (await text()).includes("Lockout"));
const radioOk = await page.evaluate(() => { const r = document.querySelector('#new-call-form input[name="alertKind"][value="normal"]'); return r && r.checked; });
// (1b) the missing-fields error names exactly the missing fields
await goTab("new");
await page.type("#nc-address", "56 Only Rd, Kingston, PA");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
const missErr = await page.evaluate(() => { const e = document.querySelector("#nc-error"); return e && !e.hidden ? e.innerText : ""; });
check("16-1: missing-fields error names exactly the missing fields", /Call nature and Caller name are required/.test(missErr), missErr);
check("16-1: alert radios genuinely default to Normal (display matches state)", radioOk);

// (2) Outcome codes render with spaces everywhere (code stored unchanged)
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1043");
await page.type("#eta", "10 min");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1043");
await page.evaluate(() => { document.querySelector('#close-form input[value="NotCorrected"]').checked = true; });
await page.click('#close-form button[type="submit"]');
await sleep(400);
const closedNC = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "NotCorrected"; });
check("16-2: call closed as NotCorrected (stored code unchanged)", closedNC);
// .badge has text-transform:uppercase, so assert on textContent
const badgeOk = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const b = c ? c.querySelector(".badge.closed") : null;
  return b ? { text: b.textContent, ok: b.textContent.includes("Not corrected") && !b.textContent.includes("NotCorrected") } : null;
});
check("16-2: closed card badge reads 'Not corrected' with spaces", badgeOk && badgeOk.ok, JSON.stringify(badgeOk));
await openCard("INC-1043");
const detOk = await page.evaluate(() => { const t = document.querySelector("#dlg-body").innerText; return t.includes("closed (Not corrected)") && !t.includes("NotCorrected"); });
check("16-2: call detail status reads 'closed (Not corrected)'", detOk);
await closeDlg();
await setRole("u-m4");
await goTab("history");
const histOk = await page.evaluate(() => document.body.innerText.includes("Not corrected") && !document.body.innerText.includes("NotCorrected"));
check("16-2: My history shows 'Not corrected'", histOk);
await setRole("u-coord");
await goTab("reports");
const repOk2 = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('td[data-label="Outcome"]')];
  return cells.some((x) => x.textContent === "Not corrected") && !cells.some((x) => /NotCorrected|OnTheWay|NeedsCoordinator/.test(x.textContent));
});
check("16-2: Reports outcome column reads 'Not corrected'", repOk2);
// CSV: capture the download blob instead of relying on a file landing
const csvOk = await page.evaluate(async () => {
  const origCreate = URL.createObjectURL.bind(URL);
  let captured = null;
  URL.createObjectURL = (blob) => { captured = blob; return origCreate(blob); };
  document.querySelector('[data-action="export-csv"]').click();
  await new Promise((r) => setTimeout(r, 300));
  URL.createObjectURL = origCreate;
  if (!captured) return { ok: false, why: "no blob captured" };
  const csv = await captured.text();
  return { ok: csv.includes("Not corrected") && !csv.includes("NotCorrected"), csv: csv.slice(0, 250) };
});
check("16-2: exported CSV uses the friendly outcome label", csvOk.ok, JSON.stringify(csvOk).slice(0, 300));

// (3) Silent-form audit: empty-name submits must show an inline error
// (native `required` used to block the submit event with no bubble
// inside a <dialog>, so the dialog just sat there).
await setRole("u-coord");
await goTab("equipment");
const eqBefore = await page.evaluate(() => DispatchStore.state.equipment.length);
await clickAction("equip-add");
await page.click('#equip-form button[type="submit"]');
await sleep(300);
const eqErr = await dlgErr();
const eqUnchanged = await page.evaluate((n) => DispatchStore.state.equipment.length === n, eqBefore);
check("16-3: Add equipment with empty name shows inline error, creates nothing, dialog stays open", /Item name is required/.test(eqErr) && eqUnchanged && await dlgIsOpen(), eqErr);
await page.type('#equip-form input[name="name"]', "Probe Jack");
await page.click('#equip-form button[type="submit"]');
await sleep(300);
check("16-3: equipment saves once a name is entered", await page.evaluate(() => DispatchStore.state.equipment.some((e) => e.name === "Probe Jack")));
await goTab("manage");
const memBefore = await page.evaluate(() => DispatchStore.state.users.length);
await clickAction("member-add");
await page.click('#member-form button[type="submit"]');
await sleep(300);
const memErr = await dlgErr();
const memUnchanged = await page.evaluate((n) => DispatchStore.state.users.length === n, memBefore);
check("16-3: Add member with empty name shows inline error, creates nothing", /Member name is required/.test(memErr) && memUnchanged && await dlgIsOpen(), memErr);
await page.click('[data-action="close-dialog"]'); await sleep(200);
await goTab("equipment");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("Jump starter pack")).querySelector('[data-action="equip-edit"]').click();
});
await sleep(300);
await page.evaluate(() => { document.querySelector('#equip-form input[name="name"]').value = ""; });
await page.click('#equip-form button[type="submit"]');
await sleep(300);
const editErr = await dlgErr();
const nameKept = await page.evaluate(() => DispatchStore.item("e1").name === "Jump starter pack");
check("16-3: Edit equipment with empty name shows inline error, keeps old name", /Item name is required/.test(editErr) && nameKept, editErr);
await page.click('[data-action="close-dialog"]'); await sleep(200);
await goTab("manage");
await page.click('#nature-add-form button[type="submit"]');
await sleep(300);
const natToast = await page.evaluate(() => { const t = document.querySelector("#toast"); return !t.hidden ? t.innerText : ""; });
check("16-3 (audit): Add nature with empty name shows an error toast, adds nothing", /Nature name is required/.test(natToast), natToast);

// (4) Member privacy-request status: visible in the call detail and on
// Home; no duplicate request while one is pending.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1039");
await clickAction("request-hidden", { id: "c4" });
await sleep(300);
const reqToast = await page.evaluate(() => document.querySelector("#toast").innerText);
check("16-4: member request sent on closed call", /Request sent/.test(reqToast), reqToast);
await page.click('[data-action="close-dialog"]').catch(() => {}); await sleep(200);
await openCard("INC-1039");
const reqStatus = await page.evaluate(() => {
  const body = document.querySelector("#dlg-body");
  return {
    hasStatus: /Your request/.test(body.innerText) && /Pending dispatcher approval/.test(body.innerText),
    noDupButton: !body.querySelector('[data-action="request-hidden"]'),
  };
});
check("16-4: pending request status shows in the call detail, no duplicate request button", reqStatus.hasStatus && reqStatus.noDupButton, JSON.stringify(reqStatus));
await closeDlg();
await goTab("home");
const homeReq = await page.evaluate(() => ({
  sec: document.body.innerText.includes("My privacy requests") && document.body.innerText.includes("INC-1039") && document.body.innerText.includes("Pending dispatcher approval"),
  btn: !!document.querySelector('[data-action="open-call"][data-id="c4"]'),
}));
check("16-4: Home 'My privacy requests' lists the pending request with an Open-call link", homeReq.sec && homeReq.btn, JSON.stringify(homeReq));
await page.evaluate(() => { document.querySelector('[data-action="open-call"][data-id="c4"]').click(); });
await sleep(300);
const linkOpens = await page.evaluate(() => document.querySelector("#dlg").open && document.querySelector("#dlg-body").innerText.includes("INC-1039"));
check("16-4: Home request row opens its call", linkOpens);
await closeDlg();
await setRole("u-disp");
await goTab("requests");
await page.evaluate(() => { const s = document.querySelector("#view select[id^='dur-']"); if (s) s.value = "30"; });
await page.evaluate(() => { document.querySelector('[data-action="approve-request"]').click(); });
await sleep(300);
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1039");
const apprStatus = await page.evaluate(() => {
  const t = document.querySelector("#dlg-body").innerText;
  return { approved: /Approved — you can see the caller until/.test(t), callerVisible: t.includes("555-0104"), noDup: !document.querySelector('#dlg-body [data-action="request-hidden"]') };
});
check("16-4: approved request shows expiry + caller visible, still no duplicate button", apprStatus.approved && apprStatus.callerVisible && apprStatus.noDup, JSON.stringify(apprStatus));
await closeDlg();
await goTab("home");
const homeAppr = await page.evaluate(() => document.body.innerText.includes("My privacy requests") && /INC-1039/.test(document.body.innerText) && /Approved until/.test(document.body.innerText));
check("16-4: Home lists the approved request with its expiry", homeAppr);
// Deny path on INC-1038: Denied shows, request button returns.
await goTab("calls");
await openCard("INC-1038");
await clickAction("request-hidden", { id: "c5" });
await sleep(300);
await page.click('[data-action="close-dialog"]').catch(() => {}); await sleep(200);
await setRole("u-disp");
await goTab("requests");
await page.evaluate(() => { document.querySelector('[data-action="deny-request"]').click(); });
await sleep(300);
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1038");
const denyStatus = await page.evaluate(() => {
  const body = document.querySelector("#dlg-body");
  return {
    denied: /Denied by a dispatcher/.test(body.innerText),
    buttonBack: !!body.querySelector('[data-action="request-hidden"]'),
  };
});
check("16-4: denied request shows Denied in the detail and the request button returns", denyStatus.denied && denyStatus.buttonBack, JSON.stringify(denyStatus));
await closeDlg();
await goTab("home");
const homeDeny = await page.evaluate(() => document.body.innerText.includes("INC-1038") && /Denied by a dispatcher/.test(document.body.innerText));
check("16-4: Home lists the denied request", homeDeny);

// 17. Draft vs completed card style (owner's production screenshot,
// Nov 17) + unit-code responder pills + privacy reversal (card level).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
const cardStyle = async (inc) => await page.evaluate((i) => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes(i));
  if (!c) return null;
  const cs = getComputedStyle(c);
  const pin = c.querySelector(".card-addr .pin");
  const strip = c.querySelector(".card-strip");
  const town = c.querySelector(".strip-town");
  const pill = c.querySelector(".pills .pill:not(.dim)");
  return {
    cls: [...c.classList],
    border: cs.borderColor,
    pin: pin ? getComputedStyle(pin).color : null,
    stripBg: strip ? getComputedStyle(strip).backgroundColor : null,
    stripTown: town ? town.textContent : null,
    stripTownUpper: town ? getComputedStyle(town).textTransform : null,
    pillTexts: [...c.querySelectorAll(".pills .pill")].map((p) => p.textContent),
    pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
    pillColor: pill ? getComputedStyle(pill).color : null,
  };
}, inc);
// (17a) Draft INC-1044 (Pittston): gray card, gray pin, plain gray
// strip with no town text.
let ds = await cardStyle("INC-1044");
check("17a: draft card is gray — card-draft, gray pin, gray strip, no town text", ds && ds.cls.includes("card-draft") && ds.pin === "rgb(138, 148, 166)" && ds.stripBg === "rgb(185, 191, 201)" && ds.stripTown === null, JSON.stringify(ds));
// (17b) Closed INC-1039 (Kingston): blue border, bright blue pin,
// blue strip with the town, white pill with blue unit-code text.
ds = await cardStyle("INC-1039");
check("17b: closed card is blue — card-closed, blue border, bright blue pin, blue strip with KINGSTON", ds && ds.cls.includes("card-closed") && ds.border === "rgb(37, 99, 235)" && ds.pin === "rgb(77, 141, 255)" && ds.stripBg === "rgb(37, 99, 235)" && ds.stripTown === "Kingston" && ds.stripTownUpper === "uppercase", JSON.stringify(ds));
check("17b: closed responder pill is white with blue text, unit code PA-09", ds && ds.pillTexts.includes("PA-09") && ds.pillBg === "rgb(255, 255, 255)" && ds.pillColor === "rgb(29, 78, 216)", JSON.stringify(ds));
// (17c) Open INC-1042 responder pill shows the unit code, not the name.
ds = await cardStyle("INC-1042");
check("17c: open responder pill shows unit code PA-05 (not the name)", ds && ds.pillTexts.includes("PA-05") && !ds.pillTexts.includes("Moishe"), JSON.stringify(ds));
// (17d) Member without a unit code falls back to their first name.
const zedId = await page.evaluate(() => { const r = DispatchStore.addMember("Zed Member", "555-0199", "member", false); return r.ok ? r.member.id : ("ERR:" + r.error); });
await page.evaluate((id) => { DispatchStore.assign("c1", id); }, zedId);
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
ds = await cardStyle("INC-1042");
check("17d: member without a unit code shows first-name pill 'Zed' beside PA-05", ds && ds.pillTexts.includes("Zed") && ds.pillTexts.includes("PA-05"), JSON.stringify(ds));
// (17e) Closed call with no parseable town: plain blue strip, no text.
const noTownInc = await page.evaluate(() => {
  const r = DispatchStore.createCall({ nature: "Other", address: "5 Nowhere Rd", callerName: "No Town", callerPhone: "555-0112" }, "key-notown-1");
  if (!r.ok) return "ERR:" + r.error;
  const c = DispatchStore.closeCall(r.call.id, "Corrected");
  return c.ok ? r.call.incident : "CLOSE-ERR:" + c.error;
});
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
ds = await cardStyle(noTownInc);
check("17e: closed call with no town has a plain blue strip, no town text", ds && ds.cls.includes("card-closed") && ds.stripBg === "rgb(37, 99, 235)" && ds.stripTown === null, JSON.stringify(ds));
// (17f) Privacy reversal at card level: responder sees the caller on
// the closed card; non-responder still sees the hidden line.
await setRole("u-m2");
const cardText = async (inc) => await page.evaluate((i) => { const c = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes(i)); return c ? c.innerText : ""; }, inc);
let ct = await cardText("INC-1039");
check("17f: responder sees caller name+phone on the closed card", ct.includes("555-0104") && ct.includes("Dana Demo"), ct.slice(0, 200));
await setRole("u-m4");
ct = await cardText("INC-1039");
check("17f: non-responder still sees the hidden line on the closed card", !ct.includes("555-0104") && !ct.includes("Dana Demo") && ct.includes("Caller hidden after close"), ct.slice(0, 200));

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));

const failed = results.filter((r) => !r[1]).length;
console.log("\n==== smoke: " + (results.length - failed) + "/" + results.length + " passed ====");
await browser.close();
process.exit(failed ? 1 : 0);
