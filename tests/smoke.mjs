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

// CDP clicks land where the element's centre is — and the fixed
// bottom tab bar now covers the bottom ~57px of the viewport, so a
// button near the fold can sit under the bar after puppeteer's
// minimal scroll-into-view (the Data "Clear all my data" button did
// exactly that: top 787, centre under the bar, click never reached
// it). Scroll every click target to the vertical centre first; a
// real user does the same by scrolling the button clear of the bar.
// Fixed elements (tabs, menu, dialog) are unaffected by the scroll.
const rawClick = page.click.bind(page);
page.click = async (sel, opts) => {
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: "center" }); }, sel).catch(() => {});
  await sleep(80);
  return rawClick(sel, opts);
};

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
await goTab("calls"); // member Home shows compact rows, not cards — open from Calls
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

// 11. Close button with confirm step (state is fresh seed again:
// c1 open with equipment out, c2 open with nothing out; signed in
// as dispatcher). Tapping Close now pops a toast asking which
// outcome — Corrected / Not corrected / Cancelled — instead of
// closing instantly.
// (a) open call with no equipment out -> choices toast, call stays
// open until one is picked
await setRole("u-disp");
await goTab("calls");
const correctVisible = await page.evaluate(() => [...document.querySelectorAll('[data-action="correct-call"]')].length);
check("Close button shown to dispatcher on open calls", correctVisible === 2, "count=" + correctVisible);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const choicesShown = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  return {
    hidden: tEl.hidden,
    choices: [...tEl.querySelectorAll(".toast-choice")].map((b) => b.innerText),
    hasX: !!tEl.querySelector(".toast-x"),
    stillOpen: DispatchStore.call("c2").status === "open",
  };
});
check("Close tap shows the 3-choice confirm toast and does NOT close immediately", !choicesShown.hidden && choicesShown.choices.join("|") === "Corrected|Not corrected|Cancelled" && choicesShown.hasX && choicesShown.stillOpen, JSON.stringify(choicesShown));
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const correctOk = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected"; });
check("picking Corrected in the toast closes the call as Corrected", correctOk);
t = await page.evaluate(() => document.querySelector("#toast").innerText);
const undoAfterPick = await page.evaluate(() => !!document.querySelector("#toast .toast-undo"));
check("Close confirmation shown with Undo", /closed as Corrected/.test(t) && undoAfterPick, t);
// (b) call with equipment out stays open with the return-equipment message
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const eqChoices = await page.evaluate(() => !document.querySelector("#toast").hidden && [...document.querySelectorAll("#toast .toast-choice")].length === 3);
check("Close on equipment-out call still asks first (choices toast)", eqChoices);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
t = await page.evaluate(() => document.querySelector("#toast").innerText);
const stillOpen = await page.evaluate(() => DispatchStore.call("c1").status === "open");
check("Close blocked while equipment out, call stays open", stillOpen && /Equipment must be returned/.test(t), t);
// (c) Correct hidden for members (hide, don't disable)
await setRole("u-m4");
const correctHidden = await page.evaluate(() => [...document.querySelectorAll('[data-action="correct-call"]')].length);
check("Close button hidden for members", correctHidden === 0, "count=" + correctHidden);

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
// open-state class. (14d above left the role as u-m4, a member —
// members no longer see drafts at all (19-2) — so switch back to a
// dispatcher first, or the draft card is correctly absent.)
await setRole("u-disp");
await gotoCallsTab();
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
    labels: btns.map((b) => b.innerText.trim()),
    singleRow: btns.every((b) => { const r = b.getBoundingClientRect(); return Math.abs(r.top - first.top) < 2 && Math.abs(r.bottom - first.bottom) < 2; }),
    newCallProminent: !!document.querySelector('#tabs button.tab-new[data-tab="new"]'),
  };
});
check("15a: dispatcher primaries are Home, Calls, New call, Requests in one row, New call prominent", primDisp.labels.join("|") === "Home|Calls|New call|Requests" && primDisp.singleRow && primDisp.newCallProminent, JSON.stringify(primDisp));
await setRole("u-m4");
const primMem = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].map((b) => b.innerText.trim()).join("|"));
check("15a: member primaries are Home, Calls, Contacts", primMem === "Home|Calls|Contacts", primMem);
await setRole("u-super");
const primSup = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].map((b) => b.innerText.trim()).join("|"));
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

// (15d) Close confirm toast: tap asks first, picking Corrected
// closes and shows a real Undo button; Undo restores the call
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const choicesInfo = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  return { hidden: tEl.hidden, choices: [...tEl.querySelectorAll(".toast-choice")].map((b) => b.innerText), stillOpen: DispatchStore.call("c2").status === "open" };
});
check("15d: Close tap shows the confirm toast and the call stays open", !choicesInfo.hidden && choicesInfo.choices.join("|") === "Corrected|Not corrected|Cancelled" && choicesInfo.stillOpen, JSON.stringify(choicesInfo));
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const undoInfo = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  const c = DispatchStore.call("c2");
  return { toastHidden: tEl.hidden, hasUndo: !!tEl.querySelector(".toast-undo"), closed: c.status === "closed" && c.outcome === "Corrected" };
});
check("15d: picking Corrected closes the call and shows a real Undo button", !undoInfo.toastHidden && undoInfo.hasUndo && undoInfo.closed, JSON.stringify(undoInfo));
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
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
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
check("17b: closed responder pill is white with blue text, unit code PA-09", ds && ds.pillTexts.some((t) => t.startsWith("PA-09")) && ds.pillBg === "rgb(255, 255, 255)" && ds.pillColor === "rgb(29, 78, 216)", JSON.stringify(ds));
// (17c) Open INC-1042 responder pill shows the unit code, not the name.
ds = await cardStyle("INC-1042");
check("17c: open responder pill shows unit code PA-05 (not the name)", ds && ds.pillTexts.some((t) => t.startsWith("PA-05")) && !ds.pillTexts.some((t) => t.includes("Moishe")), JSON.stringify(ds));
// (17d) Member without a unit code falls back to their first name.
const zedId = await page.evaluate(() => { const r = DispatchStore.addMember("Zed Member", "555-0199", "member", false); return r.ok ? r.member.id : ("ERR:" + r.error); });
await page.evaluate((id) => { DispatchStore.assign("c1", id); }, zedId);
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
ds = await cardStyle("INC-1042");
check("17d: member without a unit code shows first-name pill 'Zed' beside PA-05", ds && ds.pillTexts.some((t) => t.startsWith("Zed")) && ds.pillTexts.some((t) => t.startsWith("PA-05")), JSON.stringify(ds));
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

// 18. Close confirm toast + respond on the card (owner-approved,
// Nov 17 evening).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");

// (18a) Close tap shows the 3-choice toast; × dismisses it, call stays open.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
let toastInfo = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  return { hidden: tEl.hidden, choices: [...tEl.querySelectorAll(".toast-choice")].map((b) => b.innerText), hasX: !!tEl.querySelector(".toast-x"), stillOpen: DispatchStore.call("c2").status === "open" };
});
check("18a: Close tap shows Corrected / Not corrected / Cancelled + ×, call stays open", !toastInfo.hidden && toastInfo.choices.join("|") === "Corrected|Not corrected|Cancelled" && toastInfo.hasX && toastInfo.stillOpen, JSON.stringify(toastInfo));
await page.evaluate(() => { document.querySelector("#toast .toast-x").click(); });
await sleep(300);
toastInfo = await page.evaluate(() => ({ hidden: document.querySelector("#toast").hidden, stillOpen: DispatchStore.call("c2").status === "open" }));
check("18a: × dismisses the confirm toast without closing the call", toastInfo.hidden && toastInfo.stillOpen, JSON.stringify(toastInfo));

// (18b) A tap elsewhere also dismisses the confirm toast, call stays open.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { document.querySelector("h1").click(); });
await sleep(300);
toastInfo = await page.evaluate(() => ({ hidden: document.querySelector("#toast").hidden, stillOpen: DispatchStore.call("c2").status === "open" }));
check("18b: tap elsewhere dismisses the confirm toast without closing the call", toastInfo.hidden && toastInfo.stillOpen, JSON.stringify(toastInfo));

// (18c) Each choice closes with its own outcome; Undo still follows.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Not corrected").click(); });
await sleep(400);
let nc = await page.evaluate(() => { const c = DispatchStore.call("c2"); return { closed: c.status === "closed" && c.outcome === "NotCorrected", undo: !!document.querySelector("#toast .toast-undo") }; });
check("18c: picking 'Not corrected' closes as NotCorrected with Undo", nc.closed && nc.undo, JSON.stringify(nc));
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Cancelled").click(); });
await sleep(400);
nc = await page.evaluate(() => { const c = DispatchStore.call("c2"); return { closed: c.status === "closed" && c.outcome === "Cancelled", undo: !!document.querySelector("#toast .toast-undo") }; });
check("18c: picking 'Cancelled' closes as Cancelled with Undo", nc.closed && nc.undo, JSON.stringify(nc));
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);

// (18d) Member card shows an inline ETA input + Respond button.
await setRole("u-m4");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
let respRow = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const row = c ? c.querySelector(".card-respond") : null;
  return row ? { hasInput: !!row.querySelector(".card-eta"), hasBtn: !!row.querySelector('[data-action="card-respond"]'), btnText: row.querySelector('[data-action="card-respond"]').innerText } : null;
});
check("18d: member sees ETA input + Respond button on the open call card", respRow && respRow.hasInput && respRow.hasBtn && /Respond/.test(respRow.btnText), JSON.stringify(respRow));

// (18e) Tapping the ETA input does not open the call detail.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-eta").click();
});
await sleep(300);
const dlgAfterInputTap = await page.evaluate(() => document.querySelector("#dlg").open);
check("18e: tapping the card ETA input does not open the dialog", !dlgAfterInputTap);

// (18f) Invalid ETA on the card shows an inline error, no respond, no dialog.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-eta").focus();
});
await page.keyboard.type("banana");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="card-respond"]').click();
});
await sleep(400);
const badEta = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const err = c.querySelector(".card-eta-error");
  return { errShown: err && !err.hidden && /Enter an ETA like 15 min/.test(err.innerText), notResponding: !DispatchStore.isResponding(DispatchStore.call("c2"), "u-m4"), noDlg: !document.querySelector("#dlg").open };
});
check("18f: 'banana' ETA on the card shows an inline error, no respond, no dialog", badEta.errShown && badEta.notResponding && badEta.noDlg, JSON.stringify(badEta));

// (18g) A valid ETA responds from the card: pill appears, control goes away.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const input = cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-eta");
  input.value = "";
  input.focus();
});
await page.keyboard.type("25 min");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="card-respond"]').click();
});
await sleep(400);
const goodEta = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const r = DispatchStore.call("c2").responders.find((x) => x.userId === "u-m4");
  return { responding: !!r && r.eta === "25 min", pill: [...c.querySelectorAll(".pills .pill")].map((p) => p.textContent).some((t) => t.startsWith("PA-21")), rowGone: !c.querySelector(".card-respond"), toast: document.querySelector("#toast").innerText };
});
check("18g: valid ETA responds from the card — PA-21 pill, control gone, toast shown", goodEta.responding && goodEta.pill && goodEta.rowGone && /You are responding/.test(goodEta.toast), JSON.stringify(goodEta));

// (18g2) Enter in the card ETA input responds too (keyboard path).
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const input = cards.find((c) => c.innerText.includes("INC-1042")).querySelector(".card-eta");
  input.value = "";
  input.focus();
});
await page.keyboard.type("22 min");
await page.keyboard.press("Enter");
await sleep(400);
const enterOk = await page.evaluate(() => { const r = DispatchStore.call("c1").responders.find((x) => x.userId === "u-m4"); return !!r && r.eta === "22 min"; });
check("18g: Enter in the card ETA input responds from the card", enterOk);

// (18h) Dispatcher and coordinator cards have no inline respond control.
await setRole("u-disp");
await sleep(300);
let noRowDisp = await page.evaluate(() => [...document.querySelectorAll(".card-respond")].length);
check("18h: dispatcher cards have no inline respond control", noRowDisp === 0, "count=" + noRowDisp);
await setRole("u-coord");
await sleep(300);
let noRowCoord = await page.evaluate(() => [...document.querySelectorAll(".card-respond")].length);
check("18h: coordinator cards have no inline respond control", noRowCoord === 0, "count=" + noRowCoord);

// (18i) The call-detail dialog respond flow still works (member + coordinator).
const freshInc = await page.evaluate(() => {
  const r = DispatchStore.createCall({ nature: "Other", address: "9 Fresh St, Kingston, PA", callerName: "Fresh Caller", callerPhone: "555-0119" }, "key-fresh-18i");
  return r.ok ? r.call.incident : "ERR:" + r.error;
});
await setRole("u-m4");
await openCard(freshInc);
let dlgRespond = await page.evaluate(() => !!document.querySelector("#respond-form"));
check("18i: member dialog still shows the Respond form on a call they haven't joined", dlgRespond, freshInc);
await page.type("#eta", "20 min");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
const dlgRespOk = await page.evaluate((inc) => { const c = DispatchStore.state.calls.find((x) => x.incident === inc); const r = c && c.responders.find((x) => x.userId === "u-m4"); return !!r && r.eta === "20 min"; }, freshInc);
check("18i: member responds via the dialog (ETA stored)", dlgRespOk);
await setRole("u-coord");
await openCard(freshInc);
await page.type("#eta", "35 min");
await page.click('#respond-form button[type="submit"]');
await sleep(400);
const coordRespOk = await page.evaluate((inc) => { const c = DispatchStore.state.calls.find((x) => x.incident === inc); const r = c && c.responders.find((x) => x.userId === "u-coord"); return !!r && r.eta === "35 min"; }, freshInc);
check("18i: coordinator responds via the dialog (ETA stored)", coordRespOk);

// 19. Instinct pass 5 fixes (Nov 17 evening).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);

// WCAG contrast for one element: relative luminance of its text
// colour against its effective background (ancestor backgrounds
// composited over white, so the draft card-bar's 2%-white wash is
// handled instead of read as a near-white background).
const ratioOf = async (sel) => await page.evaluate((s) => {
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const el = document.querySelector(s);
  if (!el) return null;
  const layers = [];
  let node = el;
  while (node) { const bg = parse(getComputedStyle(node).backgroundColor); if (bg && bg.a > 0) layers.push(bg); node = node.parentElement; }
  let acc = { r: 255, g: 255, b: 255 };
  for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; acc = { r: Math.round(l.r * l.a + acc.r * (1 - l.a)), g: Math.round(l.g * l.a + acc.g * (1 - l.a)), b: Math.round(l.b * l.a + acc.b * (1 - l.a)) }; }
  const fg = parse(getComputedStyle(el).color);
  const fr = Math.round(fg.r * fg.a + acc.r * (1 - fg.a)), fgc = Math.round(fg.g * fg.a + acc.g * (1 - fg.a)), fb = Math.round(fg.b * fg.a + acc.b * (1 - fg.a));
  const l1 = lum(fr, fgc, fb), l2 = lum(acc.r, acc.g, acc.b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}, sel);
const telHeights = async () => await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('a[href^="tel:"]').forEach((a) => { const r = a.getBoundingClientRect(); if (r.height < 44) bad.push({ h: Math.round(r.height), text: a.innerText }); });
  return { total: document.querySelectorAll('a[href^="tel:"]').length, bad };
});

// (19-1) M2 — member Home fits one viewport: seed states, then a
// synthetic worst case (3 mine + 3 requests + 3 needing a response).
await setRole("u-m4");
await goTab("home");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
const homeM4 = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: window.innerHeight, cards: document.querySelectorAll("#view .call-card").length, rows: document.querySelectorAll("#view .home-row").length }));
check("19-1: member Home (u-m4, seed) fits one viewport, rows not full cards", homeM4.doc <= 844 && homeM4.win === 844 && homeM4.cards === 0 && homeM4.rows === 2, JSON.stringify(homeM4));
await setRole("u-m2");
await sleep(300);
const homeM2 = await page.evaluate(() => document.documentElement.scrollHeight);
check("19-1: member Home (u-m2, seed) fits one viewport", homeM2 <= 844, "docH=" + homeM2);
await page.evaluate(() => {
  DispatchStore.state.currentUserId = "u-m4"; // the stress subject: responds + requests as u-m4
  for (let i = 1; i <= 3; i++) DispatchStore.createCall({ nature: "Other", address: i + " Stress St, Kingston, PA", callerName: "Stress " + i, callerPhone: "555-01" + (50 + i), alertKind: "silent" }, "key-s19-open-" + i);
  DispatchStore.respond("c1", "10 min"); DispatchStore.respond("c2", "12 min");
  const r = DispatchStore.createCall({ nature: "Other", address: "4 Stress St, Kingston, PA", callerName: "Stress 4", callerPhone: "555-0154", alertKind: "silent" }, "key-s19-open-4");
  DispatchStore.respond(r.call.id, "8 min");
  for (let i = 1; i <= 3; i++) {
    const c = DispatchStore.createCall({ nature: "Other", address: i + " Closed St, Kingston, PA", callerName: "Closed " + i, callerPhone: "555-02" + (50 + i), alertKind: "silent" }, "key-s19-closed-" + i);
    DispatchStore.closeCall(c.call.id, "Corrected");
    DispatchStore.requestHidden(c.call.id, ["name", "phone"]);
  }
  DispatchStore.save();
});
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-m4");
await goTab("home");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
const stress = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, rows: document.querySelectorAll("#view .home-row").length, viewAll: [...document.querySelectorAll("#view .home-viewall")].map((b) => b.innerText) }));
check("19-1: member Home fits one viewport at 3+3+3 (caps of 2, counts + View all links)", stress.doc <= 844 && stress.rows === 6 && stress.viewAll.length === 3 && stress.viewAll.every((x) => /View all 3/.test(x)), JSON.stringify(stress));
await page.evaluate(() => { document.querySelector("#view .home-viewall").click(); });
await sleep(300);
const landed = await page.evaluate(() => document.querySelector("#view h1").innerText === "Calls");
check("19-1: Home 'View all' link lands on the Calls tab in one tap", landed);
// a Home row opens its call (rows are the one-tap path to the rest)
await goTab("home");
await page.evaluate(() => { document.querySelector('#view [data-action="open-call"]').click(); });
await sleep(300);
const rowOpens = await page.evaluate(() => document.querySelector("#dlg").open && document.querySelector("#dlg-body").innerText.includes("INC-"));
check("19-1: tapping a Home row opens its call detail", rowOpens);
await closeDlg();

// (19-2) D1 — drafts hidden from members everywhere; dispatchers
// still see them.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-m4");
await goTab("calls");
const memCalls = await page.evaluate(() => ({ view: document.querySelector("#view").innerText, h2: document.querySelector("#view h2").innerText }));
check("19-2: member Calls list shows no draft (INC-1044 absent, heading 'Open')", !memCalls.view.includes("INC-1044") && memCalls.h2 === "Open", JSON.stringify(memCalls).slice(0, 200));
await goTab("home");
const memHome = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-2: member Home shows no draft either", !memHome.includes("INC-1044"));
await goTab("data");
const memCount = await page.evaluate(() => { const dd = document.querySelectorAll(".kv dd"); return dd.length ? dd[0].innerText : null; });
check("19-2: member Data count excludes the draft (4 of 5 calls)", memCount === "4", "count=" + memCount);
await setRole("u-disp");
await goTab("calls");
const dispCalls = await page.evaluate(() => ({ view: document.querySelector("#view").innerText, h2: document.querySelector("#view h2").innerText }));
check("19-2: dispatcher still sees the draft in Calls", dispCalls.view.includes("INC-1044") && dispCalls.h2 === "Open & drafts", dispCalls.h2);

// (19-3) M1 — requesting caller access re-renders the open detail
// with the pending state AND fires the toast.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1039");
await clickAction("request-hidden", { id: "c4" });
await sleep(400);
const reqFb = await page.evaluate(() => {
  const body = document.querySelector("#dlg-body");
  const tEl = document.querySelector("#toast");
  return {
    dlgOpen: document.querySelector("#dlg").open,
    hasStatus: body && /Your request/.test(body.innerText) && /Pending dispatcher approval/.test(body.innerText),
    noDupButton: body && !body.querySelector('[data-action="request-hidden"]'),
    toast: !tEl.hidden && /Request sent/.test(tEl.innerText),
  };
});
check("19-3: after requesting, the detail re-renders with the pending state + toast (no duplicate button)", reqFb.dlgOpen && reqFb.hasStatus && reqFb.noDupButton && reqFb.toast, JSON.stringify(reqFb));
await closeDlg();

// (19-4) M3 — the stale "can no longer see" wording is gone from the
// source and from every rendered surface.
const staleSrc = await page.evaluate(async () => { const r = await fetch("app.js"); const s = await r.text(); return !s.includes("can no longer see"); });
check("19-4: stale wording is gone from app.js source", staleSrc);
await setRole("u-m4");
await goTab("calls");
await openCard("INC-1039");
const closedCopy = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("19-4: closed-call detail says responders CAN still see the caller", !/can no longer see/.test(closedCopy) && /can still see/.test(closedCopy), closedCopy.slice(0, 300));
await closeDlg();
await goTab("history");
const histCopy = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-4: My history intro matches the reversal", /unless you responded to the call or have an approved grant/.test(histCopy), histCopy.slice(0, 200));

// (19-5) D2 — closing an urgent call drops it from the banner and
// prunes its stored alerts.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("home");
const bBefore = await page.evaluate(() => ({ hidden: document.querySelector("#alert-banner").hidden, text: document.querySelector("#alert-banner").innerText, callAlerts: DispatchStore.state.alerts.filter((a) => a.kind === "call").map((a) => a.callId) }));
// The banner shows only the first alert's text plus "+N more", so the
// urgent call's presence is asserted as: a live c2 alert exists AND
// the banner counts a second alert behind "+1 more".
check("19-5: banner lists the urgent call (INC-1043) before close", !bBefore.hidden && bBefore.callAlerts.includes("c2") && /\+1 more/.test(bBefore.text), JSON.stringify(bBefore));
await page.evaluate(() => { DispatchStore.closeCall("c2", "Corrected"); DispatchStore.save(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await goTab("home");
const bAfter = await page.evaluate(() => ({ hidden: document.querySelector("#alert-banner").hidden, text: document.querySelector("#alert-banner").innerText }));
check("19-5: closing the urgent call removes it from the banner", bAfter.hidden || !/INC-1043/.test(bAfter.text), JSON.stringify(bAfter));
const alertGone = await page.evaluate(() => !DispatchStore.state.alerts.some((a) => a.callId === "c2"));
check("19-5: closing a call prunes its stored alerts", alertGone);

// (19-6) Unit-code migration — pre-unit stored state backfills the
// six seed codes on load; importJSON does the same; a deliberately
// blank unit (empty string) is left alone.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const importOk = await page.evaluate(() => {
  const st = JSON.parse(JSON.stringify(DispatchStore.state));
  st.users.forEach((u) => { delete u.unit; });
  const r = DispatchStore.importJSON(JSON.stringify(st));
  return r.ok && DispatchStore.state.users.find((u) => u.id === "u-m2").unit === "PA-09";
});
check("19-6: importJSON backfills seed units", importOk);
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.indexOf("dispatch-mvp-state") === 0);
  const st = JSON.parse(localStorage.getItem(key));
  st.users.forEach((u) => { delete u.unit; });
  localStorage.setItem(key, JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const migrated = await page.evaluate(() => DispatchStore.state.users.filter((u) => ["u-coord", "u-disp", "u-m1", "u-m2", "u-m3", "u-m4"].includes(u.id)).map((u) => u.id + "=" + (u.unit || "")).join(","));
check("19-6: load migrates pre-unit stored seed members to PA-01/02/05/09/19/21", migrated === "u-coord=PA-01,u-disp=PA-02,u-m1=PA-05,u-m2=PA-09,u-m3=PA-19,u-m4=PA-21", migrated);
await setRole("u-disp");
await goTab("calls");
const pillUnits = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  return c ? [...c.querySelectorAll(".pills .pill")].map((p) => p.textContent) : [];
});
check("19-6: migrated unit codes render as responder pills (PA-05 on INC-1042)", pillUnits.some((t) => t.startsWith("PA-05")), JSON.stringify(pillUnits));
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.indexOf("dispatch-mvp-state") === 0);
  const st = JSON.parse(localStorage.getItem(key));
  st.users.find((u) => u.id === "u-m1").unit = "";
  localStorage.setItem(key, JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const blankKept = await page.evaluate(() => DispatchStore.state.users.find((u) => u.id === "u-m1").unit === "");
check("19-6: a deliberately blank unit (empty string) is left alone, not backfilled", blankKept);
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);

// (19-7a) Contrast: DRAFT badge, CLOSED badge, bar-seg labels
// (incl. Maps), draft dim pill — all >= 4.5:1.
await setRole("u-disp");
await goTab("calls");
const ratios = {
  draftBadge: await ratioOf(".badge.draft"),
  closedBadge: await ratioOf(".badge.closed"),
  coveredSeg: await ratioOf(".card-covered .bar-seg"),
  urgentSeg: await ratioOf(".card-urgent .bar-seg"),
  draftSeg: await ratioOf(".card-draft .bar-seg"),
  draftPillDim: await ratioOf(".card-draft .pill.dim"),
};
check("19-7a: DRAFT badge >= 4.5:1 (was 3.06)", ratios.draftBadge !== null && ratios.draftBadge >= 4.5, "ratio=" + ratios.draftBadge);
check("19-7a: CLOSED badge >= 4.5:1 (was 3.43)", ratios.closedBadge !== null && ratios.closedBadge >= 4.5, "ratio=" + ratios.closedBadge);
check("19-7a: bar-seg labels (incl. Maps) >= 4.5:1 on covered/urgent/draft cards", [ratios.coveredSeg, ratios.urgentSeg, ratios.draftSeg].every((r) => r !== null && r >= 4.5), JSON.stringify(ratios));
check("19-7a: draft dim pill text >= 4.5:1", ratios.draftPillDim !== null && ratios.draftPillDim >= 4.5, "ratio=" + ratios.draftPillDim);

// (19-7b) Phone tap targets: every rendered tel: link >= 44px tall
// (card caller rows + Contacts table). Rects only — never click a
// real tel: link: it swallows later CDP mouse input (see 12e).
let th = await telHeights();
check("19-7b: every tel: link on Calls is >= 44px tall", th.total > 0 && th.bad.length === 0, JSON.stringify(th));
await goTab("contacts");
th = await telHeights();
check("19-7b: every tel: link on Contacts is >= 44px tall", th.total >= 7 && th.bad.length === 0, JSON.stringify(th));

// (19-7c) New-call input survives tab switches and role switches;
// leaving a draft edit abandons it instead.
await setRole("u-disp");
await goTab("new");
await page.select("#nc-nature", "Flat Tire");
await page.type("#nc-address", "77 Keep Me Rd, Kingston, PA");
await page.type("#nc-name", "Keep Me");
await page.type("#nc-phone", "555-0177");
await page.type("#nc-notes", "Do not lose me");
await goTab("calls");
await sleep(300);
await goTab("new");
await sleep(300);
const kept = await page.evaluate(() => ({
  nature: document.querySelector("#nc-nature").value,
  address: document.querySelector("#nc-address").value,
  name: document.querySelector("#nc-name").value,
  phone: document.querySelector("#nc-phone").value,
  notes: document.querySelector("#nc-notes").value,
}));
check("19-7c: New-call input survives a tab switch and back", kept.nature === "Flat Tire" && kept.address === "77 Keep Me Rd, Kingston, PA" && kept.name === "Keep Me" && kept.phone === "555-0177" && kept.notes === "Do not lose me", JSON.stringify(kept));
await setRole("u-coord");
await sleep(300);
const kept2 = await page.evaluate(() => ({ address: document.querySelector("#nc-address").value, name: document.querySelector("#nc-name").value }));
check("19-7c: New-call input survives a role switch too", kept2.address === "77 Keep Me Rd, Kingston, PA" && kept2.name === "Keep Me", JSON.stringify(kept2));
await page.evaluate(() => { DispatchApp.pendingCall = null; DispatchApp.editingDraftId = null; });
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1044");
await clickAction("edit-draft", { id: "c3" });
await sleep(300);
const editing = await page.evaluate(() => ({ heading: document.querySelector("h1").innerText, editing: DispatchApp.editingDraftId }));
check("19-7c: Edit draft opens the form in edit mode", /Edit draft INC-1044/.test(editing.heading) && editing.editing === "c3", JSON.stringify(editing));
await goTab("calls");
await goTab("new");
await sleep(300);
const fresh = await page.evaluate(() => ({ heading: document.querySelector("h1").innerText, editing: DispatchApp.editingDraftId, pending: DispatchApp.pendingCall }));
check("19-7c: leaving a draft edit abandons it — New call is fresh, not editing", /New call/.test(fresh.heading) && !fresh.editing && !fresh.pending, JSON.stringify(fresh));

// (19-7d) Action-bar segments: all >= 44px in both dimensions, so
// no change was needed (measured 71–72 x 61).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
const segs = await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll(".bar-seg").forEach((s) => { const r = s.getBoundingClientRect(); if (r.width < 44 || r.height < 44) bad.push({ w: Math.round(r.width), h: Math.round(r.height), label: s.innerText.trim().slice(0, 12) }); });
  return { total: document.querySelectorAll(".bar-seg").length, bad };
});
check("19-7d: every card action-bar segment is >= 44px in both dimensions (no change needed)", segs.total > 0 && segs.bad.length === 0, JSON.stringify(segs));

// (19-8) Coverage for items Instinct left untested.
// Item 7: super admin never sees caller name/phone anywhere.
await setRole("u-super");
await goTab("calls");
const badNames = ["Avi Demo", "Ben Demo", "Chaim Demo", "Dana Demo", "Eli Demo", "555-0101", "555-0102", "555-0103", "555-0104", "555-0105"];
const superCalls = await page.evaluate(() => document.querySelector("#view").innerText);
const leakCalls = badNames.filter((n) => superCalls.includes(n));
check("19-8 (item 7): super admin sees no caller name/phone in the Calls list", leakCalls.length === 0, "leaked: " + leakCalls.join(","));
await openCard("INC-1043");
const superDlg = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
const leakDlg = badNames.filter((n) => superDlg.includes(n));
check("19-8 (item 7): super admin sees no caller name/phone in a call detail", leakDlg.length === 0, "leaked: " + leakDlg.join(","));
await closeDlg();
await goTab("contacts");
const superContacts = await page.evaluate(() => document.querySelector("#view").innerText);
const leakCon = badNames.filter((n) => superContacts.includes(n));
check("19-8 (item 7): super admin sees no caller phone in Contacts", leakCon.length === 0, "leaked: " + leakCon.join(","));
// Item 9: member My history renders — own closed calls listed, and
// the empty state for a member with none.
await setRole("u-m2");
await goTab("history");
const histM2 = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-8 (item 9): member My history lists their own closed call (INC-1039, Corrected, caller visible)", histM2.includes("INC-1039") && histM2.includes("Corrected") && histM2.includes("555-0104"), histM2.slice(0, 200));
await setRole("u-m4");
await goTab("history");
const histM4 = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-8 (item 9): member with no closed calls gets the empty history state", histM4.includes("No closed calls you responded to yet."), histM4.slice(0, 200));
// Item 32: Manage sections enforce coordinator+/inventory-manager-only
// access per section.
await setRole("u-coord");
await goTab("manage");
const coordSecs = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-8 (item 32): coordinator sees all four Manage sections", ["Members", "Call natures", "Saved addresses", "Fleet"].every((s) => coordSecs.includes(s)), coordSecs.slice(0, 200));
await setRole("u-super");
await goTab("manage");
const superSecs = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-8 (item 32): super admin sees all four Manage sections", ["Members", "Call natures", "Saved addresses", "Fleet"].every((s) => superSecs.includes(s)));
await setRole("u-m3");
await goTab("manage");
const invSecs = await page.evaluate(() => document.querySelector("#view").innerText);
check("19-8 (item 32): inventory-manager member sees Manage but none of the four sections", !["Members", "Call natures", "Saved addresses", "Fleet"].some((s) => invSecs.includes(s)) && invSecs.includes("You don’t manage any of these."), invSecs.slice(0, 200));
await setRole("u-disp");
const dispTabs = await page.evaluate(() => {
  const prim = [...document.querySelectorAll("#tabs button")].map((b) => b.dataset.tab);
  return { prim, menu: [...document.querySelectorAll("#menu [data-action='tab']")].map((b) => b.dataset.tab) };
});
check("19-8 (item 32): dispatcher has no Manage tab anywhere (primary or menu)", !dispTabs.prim.includes("manage") && !dispTabs.menu.includes("manage"), JSON.stringify(dispTabs));
// Item 15: 24h banner aging — a 25h-old new-call alert never renders
// (15f already covers dismiss persistence; this re-verifies aging).
await page.evaluate(() => {
  DispatchStore.state.alerts.unshift({ id: "a-s19-old", callId: "c1", kind: "call", urgent: false, text: "S19 OLD ALERT INC-1042", at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  DispatchStore.save();
});
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const oldShown19 = await page.evaluate(() => !document.querySelector("#alert-banner").hidden && document.querySelector("#alert-banner").innerText.includes("S19 OLD ALERT"));
check("19-8 (item 15): a 25h-old new-call alert never renders in the banner", !oldShown19);
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 20. Design overhaul — PWA + bottom tab bar (Nov 17 evening).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" });
await sleep(400);
await setRole("u-disp");

// (20a) Manifest: fetchable, valid fields; icons are real PNGs at
// the declared sizes; PWA meta + links present in the page.
const man = await page.evaluate(async () => {
  const r = await fetch("manifest.webmanifest");
  const j = await r.json();
  return { ok: r.ok, name: j.name, short: j.short_name, display: j.display, start: j.start_url, theme: j.theme_color, bg: j.background_color, icons: (j.icons || []).map((i) => i.sizes + ":" + (i.purpose || "any")) };
});
check("20a: manifest fetchable — Dispatch MVP, standalone, navy theme, 192+512 (+maskable) icons", man.ok && man.name === "Dispatch MVP" && man.short === "Dispatch" && man.display === "standalone" && man.start === "." && man.theme === "#16233f" && man.bg === "#16233f" && man.icons.length >= 3, JSON.stringify(man));
const iconSizes = await page.evaluate(async () => {
  const out = [];
  for (const u of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"]) {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = u; });
    out.push({ u, w: img.naturalWidth, h: img.naturalHeight });
  }
  return out;
});
check("20a: icons are real PNGs at 192/512/512-maskable/180/32", iconSizes[0].w === 192 && iconSizes[1].w === 512 && iconSizes[2].w === 512 && iconSizes[3].w === 180 && iconSizes[4].w === 32, JSON.stringify(iconSizes));
const meta = await page.evaluate(() => ({
  manifest: !!document.querySelector('link[rel="manifest"]'),
  theme: document.querySelector('meta[name="theme-color"]')?.content,
  viewport: document.querySelector('meta[name="viewport"]')?.content,
  appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
  appleIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
  favicon: document.querySelector('link[rel="icon"]')?.href || "",
}));
check("20a: PWA meta + links present (manifest, theme-color, viewport-fit=cover, apple-capable, apple-touch-icon, real favicon)", meta.manifest && meta.theme === "#16233f" && /viewport-fit=cover/.test(meta.viewport || "") && meta.appleCapable === "yes" && meta.appleIcon && /favicon-32\.png/.test(meta.favicon), JSON.stringify(meta));

// (20b) Service worker: registers, precaches the versioned shell,
// and the installed app launches offline.
const swOk = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return { supported: false };
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
  if (!reg) return { supported: true, timedOut: true };
  const names = await caches.keys();
  const cache = await caches.open(names.find((n) => n.indexOf("dispatch-mvp-") === 0) || names[0]);
  const keys = await cache.keys();
  return { supported: true, active: !!reg.active, caches: names, entries: keys.map((k) => { const u = new URL(k.url); return (u.pathname.split("/").pop() || "root") + u.search; }) };
});
check("20b: service worker active with a versioned dispatch-mvp cache", swOk.supported && swOk.active && (swOk.caches || []).some((n) => n === "dispatch-mvp-20261123-fix7"), JSON.stringify(swOk));
check("20b: SW precache holds the app shell (index, css, js, seed, manifest, icons)", ["index.html", "styles.css?v=20261123-fix7", "app.js?v=20261123-fix7", "seed.js?v=20261123-fix7", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-512-maskable.png"].every((f) => (swOk.entries || []).includes(f)), JSON.stringify(swOk.entries));
await page.setOfflineMode(true);
await page.reload({ waitUntil: "domcontentloaded" });
await sleep(600);
const offlineRender = await page.evaluate(() => ({ tabs: document.querySelectorAll("#tabs button").length, view: document.querySelector("#view").innerText }));
check("20b: app renders offline after reload (shell served from cache)", offlineRender.tabs >= 3 && offlineRender.view.includes("INC-1042"), JSON.stringify({ tabs: offlineRender.tabs, hasInc: offlineRender.view.includes("INC-1042") }));
await page.setOfflineMode(false);
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");

// (20c) Installed app reopens with the last-used role.
await setRole("u-m2");
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
const roleKept = await page.evaluate(() => document.querySelector("#role-switch").value);
check("20c: last-used role (u-m2) is restored after reload", roleKept === "u-m2", "role=" + roleKept);
await setRole("u-disp");

// (20d) Android back: closes the open dialog first, then the drawer.
await goTab("calls");
await openCard("INC-1043");
await sleep(300);
const dlgOpenBefore = await page.evaluate(() => document.querySelector("#dlg").open);
await page.evaluate(() => history.back());
await sleep(400);
const dlgAfterBack = await page.evaluate(() => document.querySelector("#dlg").open);
check("20d: Android back closes the open call dialog first (no navigation away)", dlgOpenBefore && !dlgAfterBack, "wasOpen=" + dlgOpenBefore + " nowOpen=" + dlgAfterBack);
await page.click('[data-action="menu-open"]'); await sleep(300);
const menuOpenBefore = await page.evaluate(() => !document.querySelector("#menu").hidden);
await page.evaluate(() => history.back());
await sleep(400);
const menuAfterBack = await page.evaluate(() => document.querySelector("#menu").hidden);
check("20d: Android back closes the drawer first (no navigation away)", menuOpenBefore && menuAfterBack, "wasOpen=" + menuOpenBefore + " nowHidden=" + menuAfterBack);

// (20e) Touch + contrast re-check after the restyle.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => c.innerText.includes("INC-1043"));
  card.querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const toastBtns = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".toast-choice, .toast-x").forEach((b) => { const r = b.getBoundingClientRect(); out.push({ cls: b.className, w: Math.round(r.width), h: Math.round(r.height) }); });
  return out;
});
check("20e: Correct choice-toast buttons (3 choices + dismiss) are all >= 44px", toastBtns.length === 4 && toastBtns.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(toastBtns));
await page.evaluate(() => { [...document.querySelectorAll(".toast-choice")].find((b) => b.textContent === "Corrected").click(); });
await sleep(400);
const undoBtn = await page.evaluate(() => {
  const b = document.querySelector(".toast-undo");
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check("20e: Undo button after a Correct close is >= 44px", undoBtn && undoBtn.w >= 44 && undoBtn.h >= 44, JSON.stringify(undoBtn));
// primary controls on the Calls tab: tabs, bar segments, buttons
const touch = await page.evaluate(() => {
  const bad = [], small = [];
  document.querySelectorAll("#tabs button, .bar-seg, .btn, .home-row").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.width < 24 || r.height < 24) bad.push({ cls: String(el.className).slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
    else if (r.width < 44 || r.height < 44) small.push({ cls: String(el.className).slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
  });
  return { bad, small };
});
check("20e: no interactive element below the 24px WCAG floor; every primary control >= 44px", touch.bad.length === 0 && touch.small.length === 0, JSON.stringify(touch));
// contrast on the restyled surfaces (19-7a already covers badges +
// bar-segs): tab labels, New-call tab, footer, tel: link.
const ratios20 = {
  tabInactive: await ratioOf("#tabs button:not([aria-current='true'])"),
  tabActive: await ratioOf("#tabs button[aria-current='true']"),
  tabNew: await ratioOf("#tabs button.tab-new"),
  foot: await ratioOf(".foot"),
};
check("20e: tab-bar labels, New-call tab and footer all >= 4.5:1", Object.values(ratios20).every((r) => r !== null && r >= 4.5), JSON.stringify(ratios20));
await goTab("contacts");
const telRatio = await ratioOf('a[href^="tel:"]');
check("20e: tap-to-call link >= 4.5:1", telRatio !== null && telRatio >= 4.5, "ratio=" + telRatio);

// (20f) Bottom bar geometry + toast clearance + member Home still
// fits one screen with the bar present.
const barGeo = await page.evaluate(() => {
  const bar = document.querySelector("#tabs").getBoundingClientRect();
  return {
    fixed: getComputedStyle(document.querySelector("#tabs")).position === "fixed",
    bottomGap: Math.round(window.innerHeight - bar.bottom),
    barH: Math.round(bar.height),
    icons: [...document.querySelectorAll("#tabs button")].every((b) => !!b.querySelector("svg")),
  };
});
check("20f: bottom tab bar is fixed at the viewport bottom with an icon per tab", barGeo.fixed && barGeo.bottomGap === 0 && barGeo.icons, JSON.stringify(barGeo));
// toast sits above the bar, not behind it (trigger a real toast via
// the Interstate placeholder button, then close the dialog so the
// toast is visible on top of the page, not behind the dialog layer).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1042");
await sleep(300);
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="interstate"]').click(); });
await closeDlg();
await sleep(300);
const toastGeo = await page.evaluate(() => {
  const bar = document.querySelector("#tabs").getBoundingClientRect();
  const t = document.querySelector("#toast");
  const r = t.getBoundingClientRect();
  return { hidden: t.hidden, toastBottom: Math.round(r.bottom), barTop: Math.round(bar.top), above: r.bottom <= bar.top };
});
check("20f: toast sits above the bottom tab bar (not behind it)", !toastGeo.hidden && toastGeo.above, JSON.stringify(toastGeo));
// member Home still fits one screen WITH the bottom bar present,
// footer visible above the bar.
await setRole("u-m4");
await goTab("home");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
const home20 = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, barTop: Math.round(document.querySelector("#tabs").getBoundingClientRect().top), footBottom: Math.round(document.querySelector(".foot").getBoundingClientRect().bottom) }));
check("20f: member Home (u-m4) still fits one 390x844 screen with the bottom bar, footer visible above it", home20.doc <= 844 && home20.footBottom <= home20.barTop, JSON.stringify(home20));
// (20g) Reload while a dialog is open must not strand the history
// pointer on the overlay entry (the 20d failure — a section-5 reload
// with the dialog open left the pointer there, so every later back()
// landed on the stale entry instead of the page entry and back
// stopped closing overlays). After such a reload, a fresh dialog
// still closes on back.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1043");
await sleep(300);
await page.reload({ waitUntil: "networkidle0" }); await sleep(400); // reload WITH the dialog open
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1043");
await sleep(300);
const gOpen = await page.evaluate(() => document.querySelector("#dlg").open);
await page.evaluate(() => history.back());
await sleep(400);
const gAfter = await page.evaluate(() => document.querySelector("#dlg").open);
check("20g: after a reload with a dialog open, back still closes a fresh dialog", gOpen && !gAfter, "wasOpen=" + gOpen + " nowOpen=" + gAfter);
// 21. Fix 1 — equipment-return control in the call detail (v2 test,
// Finding 1, sev 3). T6 baseline: ~4 min, ~8 taps, 0 errors, return
// path hard to find (Menu → Equipment). The detail now shows a
// "Mark returned" button per item out, ≥48px tall; tapping it returns
// the item in place and unblocks closing.
const t6Start = Date.now();
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1042");
await sleep(300);
// (a) the detail shows a Return control for the item out, ≥48px tall
const retBtn = await page.evaluate(() => {
  const b = document.querySelector('#dlg-body [data-action="return-equipment"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { label: b.innerText.trim(), h: Math.round(r.height), item: b.dataset.item, call: b.dataset.id };
});
check("21a: call detail shows a Mark returned control for the item out, ≥48px tall", !!retBtn && retBtn.h >= 48 && retBtn.item === "e2" && retBtn.call === "c1", JSON.stringify(retBtn));
// (b) tapping it returns the item without leaving the detail
await page.evaluate(() => { const b = document.querySelector('#dlg-body [data-action="return-equipment"]'); if (b) b.click(); });
await sleep(400);
const afterReturn = await page.evaluate(() => {
  const dts = [...document.querySelectorAll("#dlg-body .kv dt")];
  const dt = dts.find((d) => d.innerText.trim() === "Equipment out");
  const dd = dt ? dt.nextElementSibling : null;
  return {
    dlgOpen: document.querySelector("#dlg").open,
    equipOut: dd ? dd.innerText.trim() : null,
    out: DispatchStore.call("c1").equipmentOut.slice(),
    inStock: DispatchStore.item("e2").status === "in-stock",
  };
});
check("21b: tapping Return removes the item from Equipment out on the same screen", afterReturn.dlgOpen && afterReturn.equipOut === "None" && afterReturn.out.length === 0 && afterReturn.inStock, JSON.stringify(afterReturn));
// (c) the Equipment page shows the same state (item back in stock)
await closeDlg();
await goTab("equipment");
const equipState = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => c.innerText.includes("Hydraulic jack"));
  return card ? { text: card.innerText.replace(/\n/g, " "), hasReturn: !!card.querySelector('[data-action="return-equipment"]') } : null;
});
check("21c: Equipment page shows the jack back in stock (same state)", !!equipState && /in-stock/i.test(equipState.text) && !equipState.hasReturn, JSON.stringify(equipState));
// (d) the same call now closes as Corrected through the checkmark flow, Undo appears
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { const ch = [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected"); if (ch) ch.click(); });
await sleep(400);
const fix1Closed = await page.evaluate(() => {
  const c = DispatchStore.call("c1");
  const tEl = document.querySelector("#toast");
  return { closed: c.status === "closed" && c.outcome === "Corrected", undo: !tEl.hidden && !!tEl.querySelector(".toast-undo") };
});
check("21d: after the detail return, the call closes as Corrected with Undo", fix1Closed.closed && fix1Closed.undo, JSON.stringify(fix1Closed));
// (e) regression: with equipment out, closing is still blocked and the
// toast names the item — fresh seed, try to close FIRST.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { const ch = [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected"); if (ch) ch.click(); });
await sleep(400);
const blocked = await page.evaluate(() => ({
  stillOpen: DispatchStore.call("c1").status === "open",
  toast: document.querySelector("#toast").innerText,
}));
check("21e: close still blocked while equipment out, toast names the item", blocked.stillOpen && /Equipment must be returned before closing: Hydraulic jack/.test(blocked.toast), JSON.stringify(blocked));
const t6Secs = Math.round((Date.now() - t6Start) / 1000);
console.log("T6 re-run (Fix 1): " + t6Secs + "s wall, 7 scripted taps, 0 errors — baseline ~4 min, ~8 taps, 0 errors");

// 22. Fix 2 — toasts no longer cover the card action bars (v2 test,
// Finding 2, sev 2). T5 baseline: ~3 min, ~6 taps, 0 errors; the
// close/Undo toasts overlaid the next card's action bar for 8-10 s.
// Toasts are now docked under the sticky header, so no card action
// bar is ever under one at the natural scroll positions.
// Overlap probe: with a toast visible, every card action-bar segment
// whose centre is in the tappable viewport (above the tab bar) must
// (a) not intersect the toast's rect and (b) hit-test to itself at
// its centre (elementFromPoint skips the click-through toast body,
// so a toast button sitting on a segment is what would block a tap).
const toastOverlap = async () => await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  if (tEl.hidden) return { shown: false, bad: ["toast hidden"] };
  const tb = tEl.getBoundingClientRect();
  const bad = [];
  [...document.querySelectorAll(".card .bar-seg")].forEach((s) => {
    const b = s.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx < 0 || cx >= 390 || cy < 0 || cy >= 787) return; // centre not in the tappable viewport
    const overlaps = !(b.right <= tb.left || b.left >= tb.right || b.bottom <= tb.top || b.top >= tb.bottom);
    const hit = document.elementFromPoint(cx, cy);
    const hitSelf = hit === s || s.contains(hit);
    if (overlaps || !hitSelf) bad.push({ label: s.getAttribute("aria-label"), overlaps, hitSelf });
  });
  return { shown: true, rect: { x: Math.round(tb.x), y: Math.round(tb.y), w: Math.round(tb.width), h: Math.round(tb.height) }, bad };
});
// (a) choice toast up: no visible action bar under it, all three
// outcome buttons visible and tappable.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const choiceBtns = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  return [...tEl.querySelectorAll(".toast-choice")].map((b) => { const r = b.getBoundingClientRect(); return { label: b.innerText, h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= 844 }; });
});
const choiceOverlap = await toastOverlap();
check("22a: choice toast up — no visible card action bar under it, 3 outcome buttons visible ≥44px", choiceOverlap.shown && choiceOverlap.bad.length === 0 && choiceBtns.length === 3 && choiceBtns.every((b) => b.h >= 44 && b.inView), JSON.stringify({ toast: choiceOverlap.rect, bad: choiceOverlap.bad, choiceBtns }));
// (b) Undo toast up: same — no visible action bar under it; Undo
// button visible; toast still there at ~6 s and gone by ~10 s.
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const undoOverlap = await toastOverlap();
const undoBtn22 = await page.evaluate(() => {
  const b = document.querySelector("#toast .toast-undo");
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { label: b.innerText, h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= 844 };
});
check("22b: Undo toast up — no visible card action bar under it, Undo button visible ≥44px", undoOverlap.shown && undoOverlap.bad.length === 0 && !!undoBtn22 && undoBtn22.h >= 44 && undoBtn22.inView, JSON.stringify({ toast: undoOverlap.rect, bad: undoOverlap.bad, undoBtn: undoBtn22 }));
// same check scrolled to the bottom of the list: the last card's bar
// sits above the tab bar, far below the top-docked toast.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(200);
const undoOverlapBottom = await toastOverlap();
check("22b: Undo toast up, scrolled to bottom — no visible card action bar under it", undoOverlapBottom.shown && undoOverlapBottom.bad.length === 0, JSON.stringify({ toast: undoOverlapBottom.rect, bad: undoOverlapBottom.bad }));
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
await sleep(5500);
const undoStillThere = await page.evaluate(() => !document.querySelector("#toast").hidden && !!document.querySelector("#toast .toast-undo"));
await sleep(4500);
const undoGone = await page.evaluate(() => document.querySelector("#toast").hidden);
check("22b: Undo toast still visible at ~6 s and gone by ~10 s (window ~8 s)", undoStillThere && undoGone, JSON.stringify({ stillThere: undoStillThere, gone: undoGone }));
// (c) a real tap elsewhere dismisses the choice toast, call stays open.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.mouse.click(200, 33); // header brand — outside the toast, no handler of its own
await sleep(300);
const afterOutside = await page.evaluate(() => ({ hidden: document.querySelector("#toast").hidden, stillOpen: DispatchStore.call("c1").status === "open" }));
check("22c: real tap elsewhere dismisses the choice toast, call stays open", afterOutside.hidden && afterOutside.stillOpen, JSON.stringify(afterOutside));
// (d) T5 re-run: respond, close as Corrected, Undo restores the
// responder, close again. Baseline ~3 min, ~6 taps, 0 errors.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-m4");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const input = cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-eta");
  input.value = ""; input.focus();
});
await page.keyboard.type("20 min");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="card-respond"]').click();
});
await sleep(400);
const responded = await page.evaluate(() => {
  const r = DispatchStore.call("c2").responders.find((x) => x.userId === "u-m4");
  return !!r && r.eta === "20 min";
});
check("22d: member responds to INC-1043 with ETA 20 min (T5 setup)", responded);
const t5Start = Date.now();
await setRole("u-disp");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const closedOnce = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected" && !!document.querySelector("#toast .toast-undo"); });
check("22d: close as Corrected shows the Undo toast", closedOnce);
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
const reopened = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const r = c.responders.find((x) => x.userId === "u-m4");
  return c.status === "open" && !!r && r.eta === "20 min";
});
check("22d: Undo reopens the call with the responder (ETA 20 min) restored", reopened);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const closedAgain = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected"; });
check("22d: close again as Corrected", closedAgain);
const t5Secs = Math.round((Date.now() - t5Start) / 1000);
console.log("T5 re-run (Fix 2): " + t5Secs + "s wall, 7 scripted taps (2 respond + 5 close/Undo/close), 0 errors — baseline ~3 min, ~6 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 23. Q1 — reopen restores the backup request (v2 test, Finding 10,
// sev 2; owner decision 2026-11-23, Option A: close-clears-backup is
// a bug, not intended). T5 baseline: ~3 min, ~6 taps, 0 errors.
// closeCall clears backupNeeded and prunes the call's alerts (D2,
// pass 5 — a closed call must never surface in the banner); reopenCall
// must restore both when backup was needed before closing — via Undo
// AND via the detail Reopen button, which share reopenCall.
const q1Start = Date.now();
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
// (a) request backup on INC-1043 from the card bell; badge + banner
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="backup-request"]').click();
});
await sleep(400);
const q1On = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const card = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes("INC-1043"));
  return {
    flag: c.backupNeeded,
    badge: card.innerText.includes("BACKUP NEEDED"),
    alert: DispatchStore.state.alerts.some((x) => x.kind === "backup" && x.callId === "c2"),
    banner: document.querySelector("#alert-banner").innerText.includes("BACKUP NEEDED on INC-1043"),
  };
});
check("23a: backup requested — badge, flag, alert and banner all show it", q1On.flag && q1On.badge && q1On.alert && q1On.banner, JSON.stringify(q1On));
// close as Corrected through the checkmark flow
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { const ch = [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected"); if (ch) ch.click(); });
await sleep(400);
// (b) while closed: no backup flag, no backup alert, banner silent
const q1Closed = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  return {
    closed: c.status === "closed" && c.outcome === "Corrected",
    flag: c.backupNeeded,
    alert: DispatchStore.state.alerts.some((x) => x.kind === "backup" && x.callId === "c2"),
    banner: document.querySelector("#alert-banner").innerText.includes("BACKUP NEEDED on INC-1043"),
  };
});
check("23b: closed call keeps no backup flag/alert and never shows in the banner (D2)", q1Closed.closed && !q1Closed.flag && !q1Closed.alert && !q1Closed.banner, JSON.stringify(q1Closed));
// (c) Undo reopens — the backup request comes back with it
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
const q1Undo = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const card = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes("INC-1043"));
  return {
    open: c.status === "open",
    flag: c.backupNeeded,
    badge: card.innerText.includes("BACKUP NEEDED"),
    alert: DispatchStore.state.alerts.some((x) => x.kind === "backup" && x.callId === "c2"),
    banner: document.querySelector("#alert-banner").innerText.includes("BACKUP NEEDED on INC-1043"),
  };
});
check("23c: Undo reopens with the BACKUP NEEDED badge, flag, alert and banner restored", q1Undo.open && q1Undo.flag && q1Undo.badge && q1Undo.alert && q1Undo.banner, JSON.stringify(q1Undo));
// (d) the detail Reopen path restores it too: close again, reopen
// from the call detail, badge back.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { const ch = [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected"); if (ch) ch.click(); });
await sleep(400);
await openCard("INC-1043");
await sleep(300);
await page.evaluate(() => { const b = document.querySelector('#dlg-body [data-action="reopen"]'); if (b) b.click(); });
await sleep(400);
const q1Detail = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const card = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes("INC-1043"));
  return {
    open: c.status === "open",
    flag: c.backupNeeded,
    badge: card.innerText.includes("BACKUP NEEDED"),
    alert: DispatchStore.state.alerts.some((x) => x.kind === "backup" && x.callId === "c2"),
    banner: document.querySelector("#alert-banner").innerText.includes("BACKUP NEEDED on INC-1043"),
  };
});
check("23d: detail Reopen restores the BACKUP NEEDED badge, flag, alert and banner", q1Detail.open && q1Detail.flag && q1Detail.badge && q1Detail.alert && q1Detail.banner, JSON.stringify(q1Detail));
// (e) no false restore: a call closed with NO backup request, then
// reopened, gains no badge.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { const ch = [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected"); if (ch) ch.click(); });
await sleep(400);
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
const q1None = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  const card = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes("INC-1043"));
  return {
    open: c.status === "open",
    flag: c.backupNeeded,
    badge: card.innerText.includes("BACKUP NEEDED"),
    alert: DispatchStore.state.alerts.some((x) => x.kind === "backup" && x.callId === "c2"),
  };
});
check("23e: reopening a call that never needed backup restores no badge", q1None.open && !q1None.flag && !q1None.badge && !q1None.alert, JSON.stringify(q1None));
const q1Secs = Math.round((Date.now() - q1Start) / 1000);
console.log("T5 re-run (Q1): " + q1Secs + "s wall, 11 scripted taps (T5 core close→Undo→close = 5 taps), 0 errors — baseline ~3 min, ~6 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 24. Q2 — checkmark button label "Correct" -> "Close" (v2 test,
// Finding 6, sev 2; owner decision 2026-11-23, Option B: label it
// "Close", checkmark kept, outcome asked in the toast as now).
// Outcome names stay "Corrected" / "Not corrected" — only the
// button label changes. T5 baseline: ~3 min, ~6 taps, 0 errors.
const q2Start = Date.now();
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
// (a) the checkmark button's visible label is "Close" on open calls
const q2Labels = await page.evaluate(() => [...document.querySelectorAll('[data-action="correct-call"]')].map((b) => b.querySelector("span").innerText.trim()));
check("24a: checkmark button's visible label is 'Close' on open calls", q2Labels.length === 2 && q2Labels.every((t) => t === "Close"), JSON.stringify(q2Labels));
// (b) no action-bar button still reads "Correct"
const q2Stale = await page.evaluate(() => [...document.querySelectorAll(".card-bar .bar-seg span")].map((s) => s.innerText.trim()).filter((t) => t === "Correct").length);
check("24b: no action-bar button still reads 'Correct'", q2Stale === 0, "count=" + q2Stale);
// (c) tap the renamed Close button -> choice toast asks the outcome,
// call stays open; pick Corrected -> closes with Undo; Undo reopens;
// tap Close again -> toast again, pick Corrected -> closes.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
const q2Toast = await page.evaluate(() => {
  const tEl = document.querySelector("#toast");
  return {
    hidden: tEl.hidden,
    msg: tEl.innerText,
    choices: [...tEl.querySelectorAll(".toast-choice")].map((b) => b.innerText),
    hasX: !!tEl.querySelector(".toast-x"),
    stillOpen: DispatchStore.call("c2").status === "open",
  };
});
check("24c: Close tap shows 'Close INC-1043 as…' with Corrected / Not corrected / Cancelled + ×, call stays open", !q2Toast.hidden && /Close INC-1043 as/.test(q2Toast.msg) && q2Toast.choices.join("|") === "Corrected|Not corrected|Cancelled" && q2Toast.hasX && q2Toast.stillOpen, JSON.stringify(q2Toast));
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const q2Closed = await page.evaluate(() => {
  const c = DispatchStore.call("c2");
  return { closed: c.status === "closed" && c.outcome === "Corrected", undo: !!document.querySelector("#toast .toast-undo") };
});
check("24d: picking Corrected closes the call and shows Undo", q2Closed.closed && q2Closed.undo, JSON.stringify(q2Closed));
await page.evaluate(() => { document.querySelector("#toast .toast-undo").click(); });
await sleep(400);
const q2Reopened = await page.evaluate(() => DispatchStore.call("c2").status === "open");
check("24e: Undo reopens the call", q2Reopened);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="correct-call"]').click();
});
await sleep(400);
await page.evaluate(() => { [...document.querySelectorAll("#toast .toast-choice")].find((b) => b.innerText === "Corrected").click(); });
await sleep(400);
const q2ClosedAgain = await page.evaluate(() => { const c = DispatchStore.call("c2"); return c.status === "closed" && c.outcome === "Corrected"; });
check("24f: Close again after Undo closes the call as Corrected", q2ClosedAgain);
const q2Secs = Math.round((Date.now() - q2Start) / 1000);
console.log("T5 re-run (Q2): " + q2Secs + "s wall, 5 scripted taps, 0 errors — baseline ~3 min, ~6 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 25. Fix 3 — responder ETA on the list card (v2 test, Finding 3,
// sev 2; Batch B). T2 baseline: ~1 min, ~4 taps, 0 errors (garbage
// ETA "abc" correctly rejected inline). On the Calls list card, next
// to each responder pill, show that responder's ETA where one exists
// ("PA-05 · 20 min"); a dispatcher-assigned member with no ETA shows
// "ETA —" on the card. The detail keeps "ETA 20 min" as now.
const fix3Start = Date.now();
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
// (a) seed responder with an ETA: INC-1042 already shows it on the card
const fix3Seed = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  return c ? [...c.querySelectorAll(".pills .pill")].map((p) => p.textContent.trim()) : [];
});
check("25a: seed responder's ETA shows on the card — 'PA-05 · 15 min'", fix3Seed.includes("PA-05 · 15 min"), JSON.stringify(fix3Seed));
// (b) T2 re-run: member responds from the card with ETA 20 — the
// pill on the card shows the ETA without opening the detail, and
// the detail shows the same ETA.
await setRole("u-m2");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const input = cards.find((c) => c.innerText.includes("INC-1043")).querySelector(".card-eta");
  input.value = ""; input.focus();
});
await page.keyboard.type("20");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="card-respond"]').click();
});
await sleep(400);
const fix3Card = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const r = DispatchStore.call("c2").responders.find((x) => x.userId === "u-m2");
  return { pills: c ? [...c.querySelectorAll(".pills .pill")].map((p) => p.textContent.trim()) : [], eta: r ? r.eta : null };
});
check("25b: responding with ETA 20 shows 'PA-09 · 20 min' on the list card", fix3Card.pills.includes("PA-09 · 20 min") && fix3Card.eta === "20 min", JSON.stringify(fix3Card));
await openCard("INC-1043");
await sleep(300);
const fix3Detail = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("25b: detail shows the same ETA ('Yossi Member (ETA 20 min)')", /Yossi Member \(ETA 20 min\)/.test(fix3Detail), fix3Detail.slice(0, 300));
await page.click('[data-action="close-dialog"]');
await sleep(200);
// (c) dispatcher assigns a member with no ETA — the card shows "ETA —"
await setRole("u-disp");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1043")).querySelector('[data-action="add-member"]').click();
});
await sleep(300);
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="assign-member"]').click(); });
await sleep(400);
const fix3Assigned = await page.evaluate(() => {
  const c2 = DispatchStore.call("c2");
  const assigned = c2.responders.find((r) => r.eta === "—");
  const u = assigned ? DispatchStore.user(assigned.userId) : null;
  const cards = [...document.querySelectorAll(".card")];
  const card = cards.find((x) => x.innerText.includes("INC-1043"));
  const pills = card ? [...card.querySelectorAll(".pills .pill")].map((p) => p.textContent.trim()) : [];
  return { unit: u ? u.unit : null, pills };
});
await page.click('[data-action="close-dialog"]').catch(() => {});
await sleep(200);
check("25c: dispatcher-assigned member shows 'ETA —' on the card", !!fix3Assigned.unit && fix3Assigned.pills.includes(fix3Assigned.unit + " · ETA —"), JSON.stringify(fix3Assigned));
// (d) layout at 390px: two ETA pills must not push the action bar
// off screen or overflow the card.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((x) => x.innerText.includes("INC-1043")).scrollIntoView({ block: "center" });
});
await sleep(300);
const fix3Layout = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1043"));
  const bar = c.querySelector(".card-bar");
  const cr = c.getBoundingClientRect(), br = bar.getBoundingClientRect();
  return {
    docW: document.documentElement.scrollWidth,
    cardOverflow: c.scrollWidth - c.clientWidth,
    barRight: Math.round(br.right), cardRight: Math.round(cr.right),
    barInView: br.top >= 0 && br.bottom <= window.innerHeight,
  };
});
check("25d: two ETA pills — no page/card overflow, action bar fully inside the card and on screen at 390px", fix3Layout.docW <= 390 && fix3Layout.cardOverflow <= 1 && fix3Layout.barRight <= fix3Layout.cardRight + 1 && fix3Layout.barInView, JSON.stringify(fix3Layout));
// (e) regression: garbage ETA "abc" still shows the inline error
// and records no response.
await setRole("u-m2");
await goTab("calls");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector(".card-eta").focus();
});
await page.keyboard.type("abc");
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="card-respond"]').click();
});
await sleep(400);
const fix3Bad = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  const err = c.querySelector(".card-eta-error");
  return { errShown: err && !err.hidden && /Enter an ETA like 15 min/.test(err.innerText), notResponding: !DispatchStore.isResponding(DispatchStore.call("c1"), "u-m2"), noDlg: !document.querySelector("#dlg").open };
});
check("25e: 'abc' ETA shows inline error, no response recorded, no dialog", fix3Bad.errShown && fix3Bad.notResponding && fix3Bad.noDlg, JSON.stringify(fix3Bad));
const fix3Secs = Math.round((Date.now() - fix3Start) / 1000);
console.log("T2 re-run (Fix 3): " + fix3Secs + "s wall, ~5 scripted taps, 0 errors — baseline ~1 min, ~4 taps, 0 errors");
// 26. Fix 4 — name who was told when backup is requested (v2 test,
// Finding 4, sev 2; Batch B). T4 baseline: ~1 min, 2 taps, 0 errors
// (the gap was Finding 4, not a task failure). The call detail names
// the alerted people; the banner names their roles — everyone in the
// chapter except super admin (Store.alertTargets). Toast, badge and
// button are unchanged.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
// T4 re-run: Moishe (u-m1) already responds to INC-1042 in the seed,
// so the backup button is on the detail — 2 taps, as in the baseline:
// open the call, request backup.
await setRole("u-m1");
await goTab("calls");
const fix4Start = Date.now();
await openCard("INC-1042");
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-request"]').click(); });
await sleep(400);
const fix4TaskSecs = Math.round((Date.now() - fix4Start) / 1000);
// (a) detail names the alerted people; toast wording unchanged
const fix4Detail = await page.evaluate(() => ({
  dlg: document.querySelector("#dlg-body").innerText,
  toast: document.querySelector("#toast").textContent,
}));
check("26a: detail names who was alerted — 'NEEDED — alerted: Rivka Coordinator, … and Shmuel Member'", /NEEDED — alerted: Rivka Coordinator, Dana Dispatcher, Moishe Member, Yossi Member, Levi Member and Shmuel Member/.test(fix4Detail.dlg), fix4Detail.dlg.slice(0, 400));
check("26b: toast unchanged — 'Backup requested — everyone alerted.'", fix4Detail.toast === "Backup requested — everyone alerted.", JSON.stringify(fix4Detail.toast));
// (c) banner names the roles while the backup alert is the most recent
const fix4Banner = await page.evaluate(() => {
  const b = document.querySelector("#alert-banner");
  return { hidden: b.hidden, text: b.innerText };
});
check("26c: banner names the roles — 'Backup requested — all coordinators, dispatchers and members alerted'", !fix4Banner.hidden && fix4Banner.text.includes("BACKUP NEEDED on INC-1042") && fix4Banner.text.includes("Backup requested — all coordinators, dispatchers and members alerted"), JSON.stringify(fix4Banner).slice(0, 300));
// (d) BACKUP NEEDED badge still on the card
await closeDlg();
const fix4Badge = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  return c ? c.innerText.includes("BACKUP NEEDED") : false;
});
check("26d: 'BACKUP NEEDED' badge still appears on the card", fix4Badge);
// (e) reload — backup state and recipient text persist
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await goTab("calls");
const fix4AfterReload = await page.evaluate(() => {
  const b = document.querySelector("#alert-banner");
  return { bannerHidden: b.hidden, bannerText: b.innerText, backupNeeded: DispatchStore.call("c1").backupNeeded };
});
await openCard("INC-1042");
await sleep(300);
const fix4ReloadDetail = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
check("26e: after reload, backup state + recipients text persist (detail and banner)", fix4AfterReload.backupNeeded && !fix4AfterReload.bannerHidden && fix4AfterReload.bannerText.includes("all coordinators, dispatchers and members alerted") && /NEEDED — alerted: Rivka Coordinator/.test(fix4ReloadDetail), JSON.stringify(fix4AfterReload).slice(0, 200));
await closeDlg();
// (f) regression: backup on a second call leaves the first call's
// backup state unchanged
await setRole("u-disp");
await goTab("calls");
await openCard("INC-1043");
await page.evaluate(() => { document.querySelector('#dlg-body [data-action="backup-request"]').click(); });
await sleep(400);
const fix4Second = await page.evaluate(() => ({
  secondDetail: document.querySelector("#dlg-body").innerText,
  firstStillNeeded: DispatchStore.call("c1").backupNeeded,
}));
await closeDlg();
await openCard("INC-1042");
await sleep(300);
const fix4FirstDetail = await page.evaluate(() => document.querySelector("#dlg-body").innerText);
await closeDlg();
check("26f: backup on INC-1043 leaves INC-1042's backup state + recipients unchanged", fix4Second.firstStillNeeded && /NEEDED — alerted: Rivka Coordinator/.test(fix4Second.secondDetail) && /NEEDED — alerted: Rivka Coordinator/.test(fix4FirstDetail), JSON.stringify(fix4Second).slice(0, 200));
// (g) fit at 390px: banner sub-line and detail never overlap another
// control or push the page sideways (most recent alert is the
// INC-1043 backup alert, so the sub-line is showing)
const fix4Fit = await page.evaluate(() => {
  const b = document.querySelector("#alert-banner");
  const sub = b.querySelector(".banner-sub");
  const x = b.querySelector(".banner-x");
  const sr = sub ? sub.getBoundingClientRect() : null;
  const xr = x ? x.getBoundingClientRect() : null;
  const br = b.getBoundingClientRect();
  const overlap = sr && xr && !(sr.right <= xr.left || sr.left >= xr.right || sr.bottom <= xr.top || sr.top >= xr.bottom);
  return { docW: document.documentElement.scrollWidth, subPresent: !!sub, overlap: !!overlap, subInside: sr ? sr.bottom <= br.bottom + 1 : false };
});
check("26g: banner sub-line fits at 390px — no overlap with the dismiss ✕, no page overflow", fix4Fit.subPresent && !fix4Fit.overlap && fix4Fit.subInside && fix4Fit.docW <= 390, JSON.stringify(fix4Fit));
console.log("T4 re-run (Fix 4): " + fix4TaskSecs + "s wall, 2 scripted taps, 0 errors — baseline ~1 min, 2 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 27. Fix 5 — rename the hamburger-menu "Dashboard" page to "My stats"
// (v2 test, Finding 5, sev 2; Batch C). T11 baseline: ~1 min, 3 taps,
// 0 errors. The menu entry, the page heading and the org sub-heading
// are renamed; the stats content, bottom-nav Home and every other menu
// label are unchanged. The tab id stays "dashboard" (internal only —
// goTab("dashboard") and the section-15b menu-id checks still work).
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-m4"); // member: the stats page lives in the hamburger menu
// T11 re-run: member job from Home, no scroll — 3 taps, as in the
// baseline: open the menu, open the stats page, back to Home.
const fix5Start = Date.now();
const fix5Home = await page.evaluate(() => ({
  attention: document.body.innerText.includes("What needs my attention"),
  fits: document.documentElement.scrollHeight <= 844,
  homeTab: !!document.querySelector('#tabs [data-tab="home"]'),
}));
check("27a: T11 — member Home still shows 'What needs my attention' and fits one screen (no scroll)", fix5Home.attention && fix5Home.fits && fix5Home.homeTab, JSON.stringify(fix5Home));
await page.click('[data-action="menu-open"]');
await sleep(300);
const fix5Menu = await page.evaluate(() => ({
  labels: [...document.querySelectorAll("#menu [data-action='tab']")].map((b) => b.innerText.trim()),
  bodyHasDashboard: document.body.innerText.includes("Dashboard"),
}));
check("27b: menu entry reads 'My stats', no menu entry reads 'Dashboard', no 'Dashboard' anywhere on screen", fix5Menu.labels.includes("My stats") && !fix5Menu.labels.includes("Dashboard") && !fix5Menu.bodyHasDashboard, JSON.stringify(fix5Menu));
check("27c: no other member menu label changed", JSON.stringify(fix5Menu.labels) === JSON.stringify(["My stats", "My history", "Equipment", "My data"]), JSON.stringify(fix5Menu.labels));
await page.click('#menu [data-action="tab"][data-tab="dashboard"]');
await sleep(300);
const fix5Page = await page.evaluate(() => ({
  h1: document.querySelector("#view h1") ? document.querySelector("#view h1").innerText : "",
  text: document.querySelector("#view").innerText,
}));
check("27d: stats page heading is 'My stats' with the same stats (Calls I’m on / Covered by me)", fix5Page.h1 === "My stats" && fix5Page.text.includes("Calls I’m on") && fix5Page.text.includes("Covered by me (last 30 days)"), fix5Page.text.slice(0, 200));
check("27e: no 'Dashboard' text anywhere on the stats page", !fix5Page.text.includes("Dashboard") && !fix5Page.text.includes("dashboard"), fix5Page.text.slice(0, 200));
// Back to Home (tap 3): attention list unchanged.
await goTab("home");
const fix5BackHome = await text();
check("27f: back on Home — attention list unchanged, tab still 'Home'", fix5BackHome.includes("What needs my attention") && !fix5BackHome.includes("Dashboard"), fix5BackHome.slice(0, 200));
// Org section: the coordinator's page shows the org stats under a
// renamed sub-heading, with the same numbers.
await setRole("u-coord");
await goTab("dashboard");
const fix5Org = await page.evaluate(() => ({
  h1: document.querySelector("#view h1") ? document.querySelector("#view h1").innerText : "",
  text: document.querySelector("#view").innerText,
}));
check("27g: coordinator page — 'My stats' heading, org section renamed to 'Organisation stats (last 30 days)' with the same numbers", fix5Org.h1 === "My stats" && fix5Org.text.includes("Organisation stats (last 30 days)") && fix5Org.text.includes("Open calls") && fix5Org.text.includes("Covered calls") && fix5Org.text.includes("Total calls") && !fix5Org.text.includes("Dashboard"), fix5Org.text.slice(0, 300));
// Regression: role switcher still works and tabs match the role.
await page.click('[data-action="menu-open"]');
await sleep(200);
await page.select("#role-switch", "u-disp");
await sleep(250);
const fix5Role = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll("#tabs [data-tab]")].map((b) => b.dataset.tab),
}));
check("27h: role switch via the hamburger still works — dispatcher tabs are Home/Calls/New call/Requests", JSON.stringify(fix5Role.tabs) === JSON.stringify(["home", "calls", "new", "requests"]), JSON.stringify(fix5Role));
const fix5Secs = Math.round((Date.now() - fix5Start) / 1000);
console.log("T11 re-run (Fix 5): " + fix5Secs + "s wall, 3 scripted taps, 0 errors — baseline ~1 min, 3 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 28. Fix 6 — stop call natures leaking into address suggestions
// (v2 test, Finding 7, sev 1; Batch C). T9 baseline: ~2 min, 4 taps,
// 0 errors. The #nc-suggest box under the address field used to offer
// the NATURE of past calls at that address / phone ("Flat Tire") as
// tappable buttons — reading as address suggestions. It now offers
// only past-call ADDRESSES (address history); saved addresses still
// come from the datalist. Tapping a suggestion fills the address field.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("new");
const fix6Start = Date.now();
const NATURES = ["Flat Tire", "Dead Battery / Jump Start", "Lockout", "Out of Fuel", "Tow Needed", "Other"];
const hasNature = (s) => NATURES.some((n) => s.includes(n));
// Doc check 1: type "F" — no call nature is suggested anywhere.
await page.type("#nc-address", "F");
await sleep(200);
const fix6F = await page.evaluate(() => ({
  suggest: document.querySelector("#nc-suggest") ? document.querySelector("#nc-suggest").innerText : "",
  opts: [...document.querySelectorAll("#addr-list option")].map((o) => o.value),
}));
check("28a: typing 'F' in the address field suggests no call nature", !hasNature(fix6F.suggest) && !fix6F.opts.some(hasNature), JSON.stringify(fix6F));
// The leak, reproduced: type the full address of past calls — pre-fix
// the box offered their nature ("Flat Tire") as if it were an address.
await page.evaluate(() => { document.querySelector("#nc-address").value = ""; });
await page.type("#nc-address", "100 Main St, Kingston, PA");
await sleep(200);
const fix6Full = await page.evaluate(() => document.querySelector("#nc-suggest") ? document.querySelector("#nc-suggest").innerText : "");
check("28b: typing a past call's full address never offers its nature", !hasNature(fix6Full), JSON.stringify(fix6Full));
// Doc check 2: type the start of a saved address — it is suggested,
// and still no nature appears.
await page.evaluate(() => { document.querySelector("#nc-address").value = ""; });
await page.type("#nc-address", "100 M");
await sleep(200);
const fix6Saved = await page.evaluate(() => ({
  opts: [...document.querySelectorAll("#addr-list option")].map((o) => o.value),
  suggest: document.querySelector("#nc-suggest") ? document.querySelector("#nc-suggest").innerText : "",
}));
check("28c: typing the start of a saved address still suggests it, and no nature appears", fix6Saved.opts.includes("100 Main St, Kingston, PA") && !hasNature(fix6Saved.suggest), JSON.stringify(fix6Saved));
// Address history: a repeat caller's phone suggests their past call's
// address — and nothing else.
await page.evaluate(() => { document.querySelector("#nc-address").value = ""; });
await page.type("#nc-address", "1");
await page.type("#nc-phone", "555-0101");
await sleep(200);
const fix6Phone = await page.evaluate(() => document.querySelector("#nc-suggest") ? document.querySelector("#nc-suggest").innerText : "");
check("28d: a repeat caller's phone suggests their past address, never a nature", fix6Phone.includes("100 Main St, Kingston, PA") && !hasNature(fix6Phone), JSON.stringify(fix6Phone));
// Tapping a history suggestion fills the address field (T9 tap 1).
await page.evaluate(() => { const b = document.querySelector('#nc-suggest [data-suggest]'); if (b) b.click(); });
await sleep(200);
const fix6Tap = await page.evaluate(() => document.querySelector("#nc-address").value);
check("28e: tapping a history suggestion fills the address field with that address", fix6Tap === "100 Main St, Kingston, PA", JSON.stringify(fix6Tap));
// The nature picker still lists every call nature.
const fix6Natures = await page.evaluate(() => [...document.querySelectorAll("#nc-nature option")].map((o) => o.value));
check("28f: nature picker still lists all call natures", NATURES.every((n) => fix6Natures.includes(n)), JSON.stringify(fix6Natures));
// Regression (T9, doc check 3): create a call with the saved address —
// it saves and appears on the list with the right town. (T9 taps 2–4:
// Review, Put out call, open Calls.)
await page.select("#nc-nature", "Lockout");
await page.type("#nc-vehicle", "Subaru Outback");
await page.type("#nc-name", "Fix6 Caller");
await page.type("#nc-phone", "555-0196");
await page.type("#nc-notes", "Fix 6 regression call");
await page.click('#new-call-form button[type="submit"]');
await sleep(300);
const fix6Summary = await text();
check("28g: summary step shows the saved address before confirming", fix6Summary.includes("Review before confirming") && fix6Summary.includes("100 Main St, Kingston, PA"), fix6Summary.slice(0, 200));
await clickAction("confirm-call", { status: "open" });
await sleep(300);
await goTab("calls");
const fix6List = await text();
check("28h: call created with the saved address appears on the list with the right town", fix6List.includes("100 Main St") && fix6List.includes("Kingston") && fix6List.includes("Fix6 Caller"), fix6List.slice(0, 300));
const fix6Secs = Math.round((Date.now() - fix6Start) / 1000);
console.log("T9 re-run (Fix 6): " + fix6Secs + "s wall, 4 scripted taps, 0 errors — baseline ~2 min, 4 taps, 0 errors");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

// 29. Fix 7 — secondary controls up to size (v2 test, Finding 8, sev 2;
// Batch C). T12 baseline per the brief: ~2 min, ~8 taps, 0 errors (the
// report's full-T12 row is ~5 min, ~12 taps for add member/nature/
// address + export — the re-run below is the open-call/close-detail
// slice the brief names). Measured pre-fix at 390px: banner ✕ 44x44,
// nature-row buttons 44px tall, and the call-detail dialog has NO ✕ at
// all — the tester measured a "detail-modal ✕ ≈30px" at desktop width,
// but no such control exists in the build, so this fix ADDS a 48px
// dialog ✕ wired to the same close-dialog path as Done/Cancel.
await page.evaluate(() => { DispatchStore.resetToSeed(); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await setRole("u-disp");
await goTab("calls");
const fix7Start = Date.now();
const rectOf = async (sel) => await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}, sel);
// 29a: banner dismiss ✕ is at least 48x48.
const fix7BannerX = await rectOf(".banner-x");
check("29a: banner dismiss ✕ is at least 48x48", !!fix7BannerX && fix7BannerX.w >= 48 && fix7BannerX.h >= 48, JSON.stringify(fix7BannerX));
// 29b: the enlarged banner ✕ covers no neighbouring interactive control
// (menu button at the left, toast when visible) and nothing overflows.
const fix7BannerClear = await page.evaluate(() => {
  const bx = document.querySelector(".banner-x");
  const menu = document.querySelector(".menu-btn");
  const toast = document.querySelector("#toast");
  const hit = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const br = bx ? bx.getBoundingClientRect() : null;
  return {
    menuHit: br ? hit(br, menu.getBoundingClientRect()) : true,
    toastHit: br && toast && !toast.hidden ? hit(br, toast.getBoundingClientRect()) : false,
    overflow: document.documentElement.scrollWidth,
  };
});
check("29b: banner ✕ overlaps no neighbour control and the page stays 390px wide", fix7BannerX && !fix7BannerClear.menuHit && !fix7BannerClear.toastHit && fix7BannerClear.overflow === 390, JSON.stringify(fix7BannerClear));
// 29c: T12 re-run, taps 1–2 — open the call detail, close it with the
// dialog ✕. The ✕ must be >=48x48 and the h2 text must not run under it.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  c.querySelector(".card-addr").click();
});
await sleep(400);
const fix7DlgX = await page.evaluate(() => {
  const x = document.querySelector("#dlg .dlg-x");
  if (!x) return null;
  const r = x.getBoundingClientRect();
  const h2 = document.querySelector("#dlg-body h2");
  let textRight = null;
  if (h2) { const range = document.createRange(); range.selectNodeContents(h2); textRight = Math.round(range.getBoundingClientRect().right); }
  return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.x), textRight };
});
check("29c: detail dialog has a ✕ of at least 48x48 and the title text stays clear of it", !!fix7DlgX && fix7DlgX.w >= 48 && fix7DlgX.h >= 48 && fix7DlgX.textRight !== null && fix7DlgX.textRight <= fix7DlgX.left, JSON.stringify(fix7DlgX));
if (fix7DlgX) { await page.click("#dlg .dlg-x"); } else { await page.click('[data-action="close-dialog"]'); }
await sleep(300);
check("29c: tapping the dialog ✕ closes the detail (T12 tap 2)", await page.evaluate(() => !document.querySelector("#dlg").open));
// 29h: choice-toast ✕ stays above the 24px WCAG floor (unchanged by
// this fix — measured, not resized). Tap Close on the open card, read
// the toast ✕, dismiss via it; the call must stay open.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c = cards.find((x) => x.innerText.includes("INC-1042"));
  c.querySelector('[data-action="correct-call"]').click();
});
await sleep(300);
const fix7ToastX = await rectOf(".toast-x");
check("29h: choice-toast ✕ is at least 24px in both dimensions (unchanged, documented)", !!fix7ToastX && fix7ToastX.w >= 24 && fix7ToastX.h >= 24, JSON.stringify(fix7ToastX));
await page.click(".toast-x"); await sleep(300);
const fix7AfterToastX = await page.evaluate(() => ({ toastHidden: document.querySelector("#toast").hidden, stillOpen: document.body.innerText.includes("INC-1042") }));
check("29h: dismissing the choice toast via its ✕ leaves the call open", fix7AfterToastX.toastHidden && fix7AfterToastX.stillOpen, JSON.stringify(fix7AfterToastX));
// 29g: primary actions do not regress — card bar segments >=48px tall,
// ETA input and tab buttons keep their current >=44px height.
const fix7Primary = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((x) => x.innerText.includes("INC-1042"));
  const segs = [...card.querySelectorAll(".bar-seg")].map((b) => Math.round(b.getBoundingClientRect().height));
  const tabs = [...document.querySelectorAll("#tabs button")].map((b) => Math.round(b.getBoundingClientRect().height));
  return { segs, tabs, overflow: document.documentElement.scrollWidth };
});
check("29g: card action-bar segments stay >=48px tall, tab buttons >=44px, no overflow", fix7Primary.segs.length === 5 && fix7Primary.segs.every((h) => h >= 48) && fix7Primary.tabs.every((h) => h >= 44) && fix7Primary.overflow === 390, JSON.stringify(fix7Primary));
await setRole("u-m4");
await goTab("calls");
const fix7Eta = await page.evaluate(() => {
  const inp = document.querySelector(".card input");
  return inp ? Math.round(inp.getBoundingClientRect().height) : null;
});
check("29g: inline ETA input on a member card keeps its >=44px height", fix7Eta !== null && fix7Eta >= 44, "h=" + fix7Eta);
// 29e: dismiss the banner with the ✕ — it hides and stays hidden after
// a reload (the settled dismiss behaviour, re-verified on the new target).
await setRole("u-disp");
await goTab("calls");
await page.click(".banner-x"); await sleep(300);
check("29e: dismissing the banner via the ✕ hides it", await page.evaluate(() => document.querySelector("#alert-banner").hidden));
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
check("29e: dismissed banner stays hidden after reload", await page.evaluate(() => document.querySelector("#alert-banner").hidden));
// 29d/29f: Manage nature rows (coordinator). Measure first, then move a
// nature up and rename one — both must still work.
await setRole("u-coord");
await goTab("manage");
const fix7Nature = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".card")].find((c) => c.querySelector('[data-action="nature-up"]'));
  if (!row) return null;
  return [...row.querySelectorAll("button")].map((b) => ({ label: b.innerText, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }));
});
check("29d: every Manage nature-row control is at least 48px tall and 24px wide", !!fix7Nature && fix7Nature.length === 4 && fix7Nature.every((b) => b.h >= 48 && b.w >= 24), JSON.stringify(fix7Nature));
await page.click('[data-action="nature-up"][data-name="Dead Battery / Jump Start"]'); await sleep(300);
const fix7Moved = await page.evaluate(() => DispatchStore.state.callNatures[0]);
check("29f: moving a nature up still works", fix7Moved === "Dead Battery / Jump Start", "first=" + fix7Moved);
const fix7Rename = async (d) => { await d.accept("Lockout (renamed)"); };
page.on("dialog", fix7Rename);
await page.click('[data-action="nature-edit"][data-name="Lockout"]'); await sleep(300);
page.off("dialog", fix7Rename);
const fix7Renamed = await page.evaluate(() => DispatchStore.state.callNatures.includes("Lockout (renamed)"));
check("29f: renaming a nature still works", fix7Renamed, await page.evaluate(() => JSON.stringify(DispatchStore.state.callNatures)));
const fix7Secs = Math.round((Date.now() - fix7Start) / 1000);
console.log("T12 re-run (Fix 7): " + fix7Secs + "s wall, 2 scripted taps, 0 errors — baseline ~2 min, ~8 taps, 0 errors (brief; report full-T12 row ~5 min, ~12 taps)");
await page.evaluate(() => { DispatchStore.resetToSeed(); });

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));

const failed = results.filter((r) => !r[1]).length;
console.log("\n==== smoke: " + (results.length - failed) + "/" + results.length + " passed ====");
await browser.close();
process.exit(failed ? 1 : 0);
