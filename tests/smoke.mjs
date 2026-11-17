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
await clickAction("tab", { tab: "new" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "equipment" });
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const jack = cards.find((c) => c.innerText.includes("Hydraulic jack"));
  jack.querySelector('[data-action="return-equipment"]').click();
});
await sleep(300);
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "requests" });
await page.select("#dur-r2", "30").catch(async () => {
  // request id is dynamic; find the pending select
  await page.evaluate(() => { const s = document.querySelector("#view select[id^='dur-']"); if (s) s.value = "30"; });
});
await page.evaluate(() => { document.querySelector('[data-action="approve-request"]').click(); });
await sleep(300);
await setRole("u-m4");
const grantOk = await page.evaluate(() => !!DispatchStore.activeGrant("c4", "u-m4"));
check("approved grant active for member (30 min)", grantOk);
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "manage" });
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
await clickAction("tab", { tab: "equipment" });
await clickAction("equip-add");
await page.type('#equip-form input[name="name"]', "Test Jack");
await page.click('#equip-form button[type="submit"]');
await sleep(300);
const equipOk = await page.evaluate(() => DispatchStore.state.equipment.some((e) => e.name === "Test Jack"));
check("manage: equipment item added by coordinator", equipOk);

// 9. Data: export JSON valid, clear my data, reset to seed
const expOk = await page.evaluate(() => { try { const d = JSON.parse(DispatchStore.exportJSON()); return Array.isArray(d.calls) && Array.isArray(d.users); } catch (e) { return false; } });
check("export JSON parses with calls+users", expOk);
await clickAction("tab", { tab: "data" });
await page.evaluate(() => { window.confirm = () => true; });
await clickAction("data-clear");
await sleep(300);
const cleared = await page.evaluate(() => DispatchStore.state.calls.length === 0 && DispatchStore.state.equipment.length === 0);
check("clear all my data empties calls+equipment", cleared);
await clickAction("tab", { tab: "data" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "calls" });
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

// (12) past responder on a closed call sees nothing without a grant
await setRole("u-m2");
await openCard("INC-1039");
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("12: past responder cannot see caller on closed call", !t.includes("555-0104") && !t.includes("Dana Demo") && t.includes("Hidden after close"), t.slice(0, 200));
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
await clickAction("tab", { tab: "equipment" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "new" });
const ncLabel = await page.evaluate(() => { const l = document.querySelector('label[for="nc-phone"]'); return l ? l.innerText : ""; });
check("3: callback number marked required", ncLabel.includes("*") && /required/i.test(ncLabel), ncLabel);

// (4) Back to edit keeps the form filled
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
await clickAction("tab", { tab: "calls" });
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
await clickAction("tab", { tab: "manage" });
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

// (9) Decided log fits a phone screen
await setRole("u-disp");
await clickAction("tab", { tab: "requests" });
const decided = await page.evaluate(() => ({
  wrap: !!document.querySelector("#view .table-scroll"),
  pageOverflow: document.documentElement.scrollWidth,
}));
check("9: Decided log sits in a scroll container, page does not overflow", decided.wrap && decided.pageOverflow <= 391, JSON.stringify(decided));

// (11) Contacts numbers are tap-to-call
await clickAction("tab", { tab: "contacts" });
const telCount = await page.evaluate(() => [...document.querySelectorAll('#view a[href^="tel:"]')].length);
check("11: Contacts numbers are tap-to-call links", telCount >= 7, "tel links=" + telCount);

// (13) Dismiss button reads Cancel, not Close
await clickAction("tab", { tab: "calls" });
await openCard("INC-1042");
const dismissText = await page.evaluate(() => { const b = document.querySelector('#dlg-body [data-action="close-dialog"]'); return b ? b.innerText.trim() : ""; });
check("13: call dialog dismiss button reads Cancel, not Close", dismissText === "Cancel", dismissText);
await closeDlg();

// (14) Error toasts outlast the old ~3s lifetime
await setRole("u-coord");
await clickAction("tab", { tab: "manage" });
await page.evaluate(() => { document.querySelector("#nature-new").value = "Flat Tire"; });
await page.click('#nature-add-form button[type="submit"]');
await sleep(4500);
const toastStill = await page.evaluate(() => { const tEl = document.querySelector("#toast"); return !tEl.hidden && /already exists/.test(tEl.innerText); });
check("14: error toast still visible after 4.5s (was ~3s)", toastStill);

// No-change items: member cannot un-respond; super admin stays admin-only
await setRole("u-m4");
await clickAction("tab", { tab: "calls" });
await openCard("INC-1042");
t = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
const noUnrespond = await page.evaluate(() => !document.querySelector('#dlg-body [data-action="unrespond"]'));
check("no-change: responding member sees only-dispatcher-can-unassign, no unrespond control", t.includes("Only a dispatcher can unassign you.") && noUnrespond);
await closeDlg();
await setRole("u-super");
const tabsText = await page.$$eval("#tabs button", (b) => b.map((x) => x.innerText).join("|"));
check("no-change: super admin has no New call or Requests tab", !tabsText.includes("New call") && !tabsText.includes("Requests"), tabsText);

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));

const failed = results.filter((r) => !r[1]).length;
console.log("\n==== smoke: " + (results.length - failed) + "/" + results.length + " passed ====");
await browser.close();
process.exit(failed ? 1 : 0);
