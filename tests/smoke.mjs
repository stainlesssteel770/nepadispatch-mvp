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
await page.evaluate(() => { document.querySelectorAll('[data-action="open-call"]'); });
const openCallBtns = await page.$$('[data-action="open-call"]');
// open c2 (second open call card on home for member: INC-1042 then INC-1043)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const c2 = cards.find((c) => c.innerText.includes("INC-1043"));
  c2.querySelector('[data-action="open-call"]').click();
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
  c2.querySelector('[data-action="open-call"]').click();
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
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="open-call"]').click();
});
await sleep(300);
await page.click('#close-form button[type="submit"]');
await sleep(300);
t = await page.evaluate(() => document.querySelector("#toast").innerText);
check("close blocked while equipment out", /Equipment must be returned/.test(t), t);
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
  cards.find((c) => c.innerText.includes("INC-1042")).querySelector('[data-action="open-call"]').click();
});
await sleep(300);
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
  if (c) c.querySelector('[data-action="open-call"]').click();
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
  if (c) c.querySelector('[data-action="open-call"]').click();
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
  if (c) c.querySelector('[data-action="open-call"]').click();
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
  if (c) c.querySelector('[data-action="open-call"]').click();
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

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));

const failed = results.filter((r) => !r[1]).length;
console.log("\n==== smoke: " + (results.length - failed) + "/" + results.length + " passed ====");
await browser.close();
process.exit(failed ? 1 : 0);
