/* Dispatch MVP — static prototype app.
   Single Store object abstracts all persistence (localStorage, keys
   prefixed "dispatch-mvp-") so a later backend (e.g. Firebase) can
   replace the Store without touching UI code.
   SIMULATION WARNING: validation and role checks here run in the
   browser only. A static site cannot truly enforce privacy or
   concurrency — it can only hide things in the UI. Do not treat this
   prototype as proof of server-side enforcement. */
(function () {
"use strict";

var LS_KEY = "dispatch-mvp-state-v1";
var OUTCOMES = ["Received", "OnTheWay", "NeedsCoordinator", "Interstate", "NotCorrected", "Corrected", "Cancelled"];
var DURATIONS = [15, 30, 60, null]; // minutes; null = forever

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid(prefix) { return prefix + "-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function nowISO() { return new Date().toISOString(); }
function fmtDT(s) { if (!s) return "—"; var d = new Date(s); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}); }
// Join ["a", "b", "c"] as "a, b and c" (one item: "a"; two: "a and b").
function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}
function $(sel) { return document.querySelector(sel); }
// Toasts: success/info hide after ~3.5s; errors (toastErr) stay 8s and
// dismiss on tap, so validation feedback is never missed. The toast
// body is click-through (pointer-events: none in CSS); only buttons
// inside a toast are tappable.
var toastTimer = null;
var toastOutsideHandler = null;
// Shared teardown for every toast kind: clear the timer and drop the
// outside-tap dismiss listener (only the choice toast registers one).
function clearToastState() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (toastOutsideHandler) { document.removeEventListener("click", toastOutsideHandler, true); toastOutsideHandler = null; }
}
function hideToast() {
  var t = $("#toast");
  clearToastState();
  t.hidden = true; t.classList.remove("error", "choices"); t.innerHTML = "";
}
function toast(msg, ms, isErr) {
  var t = $("#toast");
  clearToastState();
  t.classList.remove("choices"); t.innerHTML = "";
  t.textContent = msg; t.classList.toggle("error", !!isErr); t.hidden = false;
  toastTimer = setTimeout(function () { t.hidden = true; t.classList.remove("error"); }, ms || 3500);
}
function toastErr(msg) { toast(msg, 8000, true); }
// Toast with a real action button (e.g. Undo after a Correct close).
// The button is a real <button> inside the toast, not plain text;
// tapping it runs the action. Tapping anywhere else does NOT
// dismiss the toast before its window ends — only tapping the toast
// itself or the timer does.
function toastAction(msg, label, fn, ms) {
  var t = $("#toast");
  clearToastState();
  t.classList.remove("choices"); t.innerHTML = "";
  var span = document.createElement("span");
  span.textContent = msg;
  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "toast-undo"; btn.textContent = label;
  btn.addEventListener("click", function (ev) { ev.stopPropagation(); fn(); });
  t.appendChild(span); t.appendChild(btn);
  t.classList.remove("error"); t.hidden = false;
  toastTimer = setTimeout(function () { t.hidden = true; }, ms || 8000);
}
// Choice toast (Correct confirm step, owner decision 2026-11-17):
// asks the user to pick one of several outcomes. Tapping a choice
// hides the toast and runs onPick with the choice's value. The ×
// dismisses with no action, and so does a tap anywhere else — the
// outside listener is registered a tick after the toast opens, so
// the tap that opened it cannot dismiss it in the same bubble. The
// toast also auto-dismisses after ~15s.
function toastChoices(msg, choices, onPick, ms) {
  var t = $("#toast");
  clearToastState();
  t.classList.remove("error"); t.classList.add("choices"); t.innerHTML = "";
  var span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  var row = document.createElement("div");
  row.className = "toast-choices";
  choices.forEach(function (ch) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "toast-choice"; b.textContent = ch.label;
    b.addEventListener("click", function (ev) { ev.stopPropagation(); hideToast(); onPick(ch.value); });
    row.appendChild(b);
  });
  t.appendChild(row);
  var x = document.createElement("button");
  x.type = "button"; x.className = "toast-x"; x.setAttribute("aria-label", "Dismiss without choosing"); x.textContent = "✕";
  x.addEventListener("click", function (ev) { ev.stopPropagation(); hideToast(); });
  t.appendChild(x);
  t.hidden = false;
  toastTimer = setTimeout(hideToast, ms || 15000);
  setTimeout(function () {
    toastOutsideHandler = function (ev) {
      if (ev.target.closest && ev.target.closest("#toast")) return;
      hideToast();
    };
    document.addEventListener("click", toastOutsideHandler, true);
  }, 0);
}
// Close chosen from the Correct confirm toast: the same closeCall
// path as the close dialog (equipment-out still blocks), then the
// Undo toast as the safety net.
function closeFromToast(callId, outcome) {
  var r = Store.closeCall(callId, outcome);
  if (r.ok) {
    toastAction("Call closed as " + outcomeLabel(outcome) + ".", "Undo", function () {
      var rr = Store.reopenCall(callId);
      if (rr.ok) { render(); toast("Call reopened — it is open again."); }
      else { toastErr(rr.error); render(); }
    }, 8000);
  } else showError(r.error);
  render();
}
// Respond from a card's inline ETA control (members only): the same
// Store.respond path and parseETA rules as the dialog form. An
// invalid ETA shows an inline error on the card, never a silent
// failure; on success the card re-renders with the member's pill
// and the control gone.
function respondFromCard(callId) {
  var input = document.querySelector('.card-eta[data-call="' + callId + '"]');
  var row = input ? input.closest(".card-respond") : null;
  var errBox = row ? row.querySelector(".card-eta-error") : null;
  var r = Store.respond(callId, input ? input.value : "");
  if (r.ok) {
    toast("You are responding — you can now see the caller’s number and call them back.");
    render();
  } else if (errBox) {
    errBox.textContent = r.error; errBox.hidden = false;
  } else {
    showError(r.error);
  }
}
// Error shown while a dialog is open: the dialog is a native <dialog>
// (top layer — no z-index can put a toast above it), so the error
// renders as an inline line inside the dialog instead. `scope` (a form
// in the dialog) targets that form's own error slot; without it, the
// first error slot in the dialog is used. Falls back to a toast when
// no dialog is open.
function dlgError(msg, scope) {
  var box = null;
  if (scope && scope.querySelector) box = scope.querySelector("#dlg-error");
  if (!box) box = document.querySelector("#dlg #dlg-error");
  if (box) { box.textContent = msg; box.hidden = false; return true; }
  toastErr(msg); return false;
}
function showError(msg, scope) {
  var d = $("#dlg");
  if (d && d.open) return dlgError(msg, scope);
  toastErr(msg);
}
// ETA parsing: accept minutes ("15", "15 min", "15m") or hours+minutes
// ("1h", "1h 30m"); anything else is rejected. Returns the normalised
// string ("15 min", "1h 30m") or null.
function parseETA(input) {
  var s = String(input || "").trim().toLowerCase();
  var m = s.match(/^(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*(?:m(?:in(?:utes?|s)?)?)?)?$/);
  if (!m) return null;
  var h = m[1] ? parseInt(m[1], 10) : 0;
  var min = m[2] ? parseInt(m[2], 10) : 0;
  if (h <= 0 && min <= 0) return null;
  if (h > 0 && min > 0) return h + "h " + min + "m";
  if (h > 0) return h + "h";
  return min + " min";
}

// Required call fields, named exactly when missing so an error can
// never blame a field the user already filled.
function missingCallFields(data) {
  var missing = [];
  if (!data.nature) missing.push("Call nature");
  if (!data.address) missing.push("Address");
  if (!data.callerName) missing.push("Caller name");
  return missing;
}
function callRequiredError(data) {
  var m = missingCallFields(data);
  if (!m.length) return null;
  if (m.length === 1) return m[0] + " is required.";
  if (m.length === 2) return m[0] + " and " + m[1] + " are required.";
  return m[0] + ", " + m[1] + " and " + m[2] + " are required.";
}

function freshSeed() {
  var s = clone(window.DISPATCH_SEED);
  s.currentUserId = "u-disp";
  s.usedKeys = [];
  s.nextIncident = 1045;
  s.dismissedAlerts = [];
  // Seeded alerts carry fixed Nov-17 timestamps in seed.js, but the
  // banner hides "call" alerts older than 24h — so a demo reset days
  // later would open with an empty banner and the suite's banner
  // checks (which expect the seeded alerts visible) would fail.
  // Shift every seeded alert forward so the newest lands on now,
  // preserving their relative spacing.
  var latest = 0;
  (s.alerts || []).forEach(function (a) { var t = new Date(a.at).getTime(); if (isFinite(t) && t > latest) latest = t; });
  if (latest) {
    var shift = Date.now() - latest;
    (s.alerts || []).forEach(function (a) { a.at = new Date(new Date(a.at).getTime() + shift).toISOString(); });
  }
  return s;
}

/* ---------------- Store ---------------- */
// Unit codes for the known seed members (seed.js). Used by the
// load-time migration for stored state saved before the unit field
// existed (pass 5): a stored record with NO `unit` property at all
// gets its seed code; a stored empty string (deliberately cleared)
// is left alone, and owner-entered members (other ids) are never
// touched. Returns true when anything changed.
var SEED_UNITS = { "u-coord": "PA-01", "u-disp": "PA-02", "u-m1": "PA-05", "u-m2": "PA-09", "u-m3": "PA-19", "u-m4": "PA-21" };
function backfillSeedUnits(state) {
  var changed = false;
  (state.users || []).forEach(function (u) {
    if (u.unit === undefined && SEED_UNITS[u.id]) { u.unit = SEED_UNITS[u.id]; changed = true; }
  });
  return changed;
}
var Store = {
  state: null,
  load: function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        this.state = JSON.parse(raw);
        // Normalise state saved before dismissedAlerts existed.
        if (!Array.isArray(this.state.dismissedAlerts)) this.state.dismissedAlerts = [];
        // Repair persisted state: drop backup alerts whose call no
        // longer needs backup (e.g. cleared before this fix shipped).
        var self = this;
        this.state.alerts = (this.state.alerts || []).filter(function (a) {
          if (a.kind !== "backup") return true;
          var c = self.call(a.callId);
          return c && c.status === "open" && c.backupNeeded;
        });
        // Backfill unit codes for seed members whose stored records
        // predate the unit field (pass 5): a stored record with NO
        // `unit` property gets its seed code; a stored empty string
        // (deliberately cleared) is left alone.
        if (backfillSeedUnits(this.state)) this.save();
        return;
      }
    } catch (e) { /* corrupted storage: fall through to seed */ }
    this.state = freshSeed();
    this.save();
  },
  save: function () { try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); } catch (e) { toastErr("Could not save (storage full or blocked)."); } },
  resetToSeed: function () { this.state = freshSeed(); this.save(); },
  // Clear all user-entered data: blank slate (calls, equipment, fleet,
  // addresses, loans, requests, alerts all gone). Users stay so the
  // role switcher still works; call natures reset to the seed list.
  clearMyData: function () {
    var s = this.state;
    s.calls = []; s.equipment = []; s.fleet = []; s.loans = [];
    s.savedAddresses = []; s.excludedAddresses = [];
    s.hiddenRequests = []; s.alerts = []; s.activityLog = [];
    s.dismissedAlerts = [];
    s.usedKeys = []; s.nextIncident = 1001;
    s.callNatures = clone(window.DISPATCH_SEED.callNatures);
    this.save();
  },
  exportJSON: function () { return JSON.stringify(this.state, null, 2); },
  importJSON: function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "That file is not valid JSON." }; }
    if (!data || !Array.isArray(data.users) || !Array.isArray(data.calls) || !Array.isArray(data.equipment)) {
      return { ok: false, error: "That file does not look like Dispatch MVP data (missing users, calls or equipment)." };
    }
    if (!data.currentUserId || !data.users.some(function (u) { return u.id === data.currentUserId; })) {
      data.currentUserId = data.users.length ? data.users[0].id : "u-disp";
    }
    data.usedKeys = data.usedKeys || [];
    backfillSeedUnits(data); // same pre-unit migration as Store.load
    this.state = data; this.save();
    return { ok: true };
  },
  log: function (text) { this.state.activityLog.unshift({ at: nowISO(), text: text }); },
  user: function (id) { return this.state.users.find(function (u) { return u.id === id; }); },
  me: function () { return this.user(this.state.currentUserId) || this.state.users[0]; },
  call: function (id) { return this.state.calls.find(function (c) { return c.id === id; }); },
  item: function (id) { return this.state.equipment.find(function (e) { return e.id === id; }); },

  /* ----- permissions (decided rules; UI-enforced only in this prototype) ----- */
  can: function (action) {
    var me = this.me();
    var r = me.role, inv = !!me.inventoryManager;
    switch (action) {
      case "create-call": case "put-out": case "close": case "reopen": case "unassign": case "assign":
      case "approve-hidden": case "backup": return r === "dispatcher" || r === "coordinator";
      case "respond": return r === "member" || r === "coordinator";
      case "manage-members": case "manage-natures": case "manage-fleet":
      case "manage-addresses": case "reports": case "org-dashboard":
        return r === "coordinator" || r === "super-admin";
      case "manage-inventory": return inv || r === "coordinator" || r === "super-admin";
      case "data-reset": case "data-import": return r === "coordinator" || r === "super-admin";
      default: return false;
    }
  },
  isResponding: function (call, userId) { return call.responders.some(function (x) { return x.userId === userId; }); },
  activeGrant: function (callId, userId) {
    var now = Date.now();
    return this.state.hiddenRequests.find(function (g) {
      return g.callId === callId && g.requesterId === userId && g.status === "approved" &&
        (!g.expiresAt || new Date(g.expiresAt).getTime() > now);
    }) || null;
  },
  // Caller name/phone visible to: dispatcher/coordinator always; a
  // member who responded to the call — open OR closed (OWNER REVERSAL
  // 2026-11-17: supersedes the 2026-11-17 judgment call that hid the
  // caller from past responders on closed calls); anyone else only
  // with an unexpired approved grant. Super admin (admin-only) does
  // NOT see caller details.
  canSeeCaller: function (call, userId) {
    var me = this.user(userId); if (!me) return false;
    if (me.role === "dispatcher" || me.role === "coordinator") return true;
    if (me.role === "member" && this.isResponding(call, userId)) return true;
    if (this.activeGrant(call.id, userId)) return true;
    return false;
  },
  alertTargets: function () { return this.state.users.filter(function (u) { return u.role !== "super-admin"; }); },
  // Fix 4 (v2 test, Finding 4): who a backup request actually alerts —
  // everyone in the chapter except super admin (alertTargets). The call
  // detail names the people; the banner names their roles instead
  // (names don't fit the one-line banner). Both are computed from
  // alertTargets, so the wording can never drift from who is actually
  // alerted.
  backupRecipientNames: function () {
    return this.alertTargets().map(function (u) { return u.name; });
  },
  backupRecipientRoles: function () {
    var roles = [];
    this.alertTargets().forEach(function (u) { if (roles.indexOf(u.role) === -1) roles.push(u.role); });
    return roles;
  },

  /* ----- calls ----- */
  createCall: function (data, idemKey) {
    if (idemKey && this.state.usedKeys.indexOf(idemKey) !== -1) {
      var existing = this.state.calls.find(function (c) { return c.idemKey === idemKey; });
      if (existing) return { ok: true, duplicate: true, call: existing };
    }
    if (!data.nature || !data.address || !data.callerName) { var e1 = callRequiredError(data); return { ok: false, error: e1 }; }
    var digits = (data.callerPhone || "").replace(/\D/g, "");
    if (digits.length < 7) return { ok: false, error: "Enter a valid callback number (at least 7 digits)." };
    var call = {
      id: uid("c"), incident: "INC-" + (this.state.nextIncident++),
      nature: data.nature, status: data.status || "open",
      address: data.address, vehicle: data.vehicle || "",
      callerName: data.callerName, callerPhone: data.callerPhone,
      notes: data.notes || "", coordinates: data.coordinates || "", mapsLink: data.mapsLink || "",
      urgent: !!data.urgent, notify: data.notify !== false,
      createdAt: nowISO(), closedAt: null, outcome: null,
      responders: [], backupNeeded: false, equipmentOut: [], idemKey: idemKey || null
    };
    this.state.calls.unshift(call);
    if (idemKey) this.state.usedKeys.push(idemKey);
    if (data.saveAddress && this.state.savedAddresses.indexOf(data.address) === -1) this.state.savedAddresses.push(data.address);
    this.log(call.incident + " created by " + this.me().name + (call.status === "draft" ? " (draft)" : ""));
    if (call.status === "open" && call.notify) {
      this.state.alerts.unshift({ id: uid("a"), callId: call.id, kind: "call", urgent: call.urgent,
        text: (call.urgent ? "URGENT call " : "New call ") + call.incident + ": " + call.nature + " at " + call.address, at: nowISO() });
    }
    this.save();
    return { ok: true, call: call };
  },
  putOutDraft: function (callId) {
    var c = this.call(callId); if (!c || c.status !== "draft") return { ok: false, error: "That call is not a draft." };
    c.status = "open";
    if (c.notify) this.state.alerts.unshift({ id: uid("a"), callId: c.id, kind: "call", urgent: c.urgent,
      text: "New call " + c.incident + ": " + c.nature + " at " + c.address, at: nowISO() });
    this.log(c.incident + " put out by " + this.me().name); this.save();
    return { ok: true };
  },
  deleteDraft: function (callId) {
    var i = this.state.calls.findIndex(function (c) { return c.id === callId && c.status === "draft"; });
    if (i === -1) return { ok: false, error: "Only a draft can be deleted." };
    var inc = this.state.calls[i].incident;
    this.state.calls.splice(i, 1);
    this.log(inc + " draft deleted by " + this.me().name); this.save();
    return { ok: true };
  },
  // Edit a draft in place (same validation as createCall). Status can
  // stay "draft" or move to "open" (put out — sends the normal alert).
  // Never creates a second call.
  updateDraft: function (callId, data, status) {
    var c = this.call(callId);
    if (!c || c.status !== "draft") return { ok: false, error: "Only a draft can be edited." };
    var e2 = callRequiredError(data);
    if (e2) return { ok: false, error: e2 };
    var digits = (data.callerPhone || "").replace(/\D/g, "");
    if (digits.length < 7) return { ok: false, error: "Enter a valid callback number (at least 7 digits)." };
    c.nature = data.nature; c.address = data.address; c.vehicle = data.vehicle || "";
    c.callerName = data.callerName; c.callerPhone = data.callerPhone;
    c.notes = data.notes || ""; c.coordinates = data.coordinates || ""; c.mapsLink = data.mapsLink || "";
    c.urgent = !!data.urgent; c.notify = data.notify !== false;
    if (data.saveAddress && this.state.savedAddresses.indexOf(data.address) === -1) this.state.savedAddresses.push(data.address);
    if (status === "open") {
      c.status = "open";
      if (c.notify) this.state.alerts.unshift({ id: uid("a"), callId: c.id, kind: "call", urgent: c.urgent,
        text: "New call " + c.incident + ": " + c.nature + " at " + c.address, at: nowISO() });
      this.log(c.incident + " edited and put out by " + this.me().name);
    } else {
      this.log(c.incident + " draft edited by " + this.me().name);
    }
    this.save();
    return { ok: true, call: c };
  },
  respond: function (callId, eta) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    if (c.status !== "open") return { ok: false, error: "Only an open call can be responded to." };
    var parsed = parseETA(eta);
    if (!parsed) return { ok: false, error: "Enter an ETA like 15 min or 1h 30m." };
    if (this.isResponding(c, this.me().id)) return { ok: false, error: "You are already responding to this call." };
    c.responders.push({ userId: this.me().id, eta: parsed, at: nowISO() });
    this.log(this.me().name + " responded to " + c.incident + " (ETA " + parsed + ")"); this.save();
    return { ok: true };
  },
  unassign: function (callId, userId) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    var i = c.responders.findIndex(function (r) { return r.userId === userId; });
    if (i === -1) return { ok: false, error: "That member is not responding to this call." };
    c.responders.splice(i, 1);
    this.log(this.user(userId).name + " unassigned from " + c.incident + " by " + this.me().name); this.save();
    return { ok: true };
  },
  // Dispatcher/coordinator assigns a member to an open call (the card's
  // "Add" segment). No duplicate assignment; ETA is "—" — dispatcher-
  // assigned, ETA unknown. Undo is the existing unassign (dispatcher).
  assign: function (callId, userId) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    if (c.status !== "open") return { ok: false, error: "Only an open call can have a member assigned." };
    if (!this.can("assign")) return { ok: false, error: "Only a dispatcher or coordinator can assign a member." };
    var u = this.user(userId); if (!u) return { ok: false, error: "Member not found." };
    if (u.role !== "member" && u.role !== "coordinator") return { ok: false, error: "Only members and coordinators can be assigned to a call." };
    if (this.isResponding(c, userId)) return { ok: false, error: u.name + " is already responding to this call." };
    c.responders.push({ userId: userId, eta: "—", at: nowISO() });
    this.log(u.name + " assigned to " + c.incident + " by " + this.me().name + " (ETA —)"); this.save();
    return { ok: true };
  },
  requestBackup: function (callId) {
    var c = this.call(callId); if (!c || c.status !== "open") return { ok: false, error: "Only an open call can need backup." };
    if (c.backupNeeded) return { ok: false, error: "Backup is already requested on this call." };
    c.backupNeeded = true;
    // Drop any stale backup alert for this call before adding the new one.
    this.state.alerts = this.state.alerts.filter(function (a) { return !(a.kind === "backup" && a.callId === c.id); });
    this.state.alerts.unshift({ id: uid("a"), callId: c.id, kind: "backup", urgent: c.urgent,
      text: "BACKUP NEEDED on " + c.incident + ": " + c.nature + " at " + c.address, at: nowISO() });
    this.log("Backup requested on " + c.incident + " by " + this.me().name); this.save();
    return { ok: true };
  },
  clearBackup: function (callId) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    c.backupNeeded = false;
    // Clearing backup removes the matching alert — the banner must
    // never keep saying BACKUP NEEDED after the call says Not needed.
    this.state.alerts = this.state.alerts.filter(function (a) { return !(a.kind === "backup" && a.callId === callId); });
    this.log("Backup cleared on " + c.incident + " by " + this.me().name); this.save();
    return { ok: true };
  },
  closeCall: function (callId, outcome) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    if (c.status !== "open") return { ok: false, error: "Only an open call can be closed." };
    if (OUTCOMES.indexOf(outcome) === -1) return { ok: false, error: "Pick one of the seven close outcomes." };
    if (c.equipmentOut.length) {
      var names = c.equipmentOut.map(function (id) { var it = Store.item(id); return it ? it.name : id; }).join(", ");
      return { ok: false, error: "Equipment must be returned before closing: " + names };
    }
    c.status = "closed"; c.outcome = outcome; c.closedAt = nowISO();
    // Q1 (owner decision 2026-11-23, Option A): stash whether backup
    // was needed so reopenCall can restore it — closing itself still
    // clears the flag and the alerts (D2, pass 5).
    c.backupWasNeeded = c.backupNeeded; c.backupNeeded = false;
    // Closing clears the call's alerts: its backup alert AND its
    // new-call notification — the banner must never keep surfacing a
    // call that is already closed (D2, pass 5).
    this.state.alerts = this.state.alerts.filter(function (a) { return a.callId !== callId; });
    this.log(c.incident + " closed as " + outcomeLabel(outcome) + " by " + this.me().name); this.save();
    return { ok: true };
  },
  reopenCall: function (callId) {
    var c = this.call(callId); if (!c || c.status !== "closed") return { ok: false, error: "Only a closed call can be reopened." };
    c.status = "open"; c.outcome = null; c.closedAt = null; // responders, assignments and equipment stay as they were
    // Q1 (owner decision 2026-11-23, Option A): reopening restores the
    // backup request too. closeCall stashed it in backupWasNeeded; the
    // flag is set back and the backup alert is re-created (same shape
    // as requestBackup) so the banner shows it again. The banner only
    // renders a backup alert while its call is open and needs backup,
    // so a closed call still never surfaces there (D2 untouched).
    if (c.backupWasNeeded) {
      c.backupWasNeeded = false;
      c.backupNeeded = true;
      this.state.alerts = this.state.alerts.filter(function (a) { return !(a.kind === "backup" && a.callId === c.id); });
      this.state.alerts.unshift({ id: uid("a"), callId: c.id, kind: "backup", urgent: c.urgent,
        text: "BACKUP NEEDED on " + c.incident + ": " + c.nature + " at " + c.address, at: nowISO() });
      this.log("Backup request restored on " + c.incident + " on reopen by " + this.me().name);
    }
    this.log(c.incident + " reopened by " + this.me().name); this.save();
    return { ok: true };
  },
  // One-tap close as Corrected (the brief's one-tap "correct" option).
  // Same rules as closeCall: equipment out blocks it.
  closeCorrect: function (callId) {
    return this.closeCall(callId, "Corrected");
  },
  requestHidden: function (callId, fields) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    var existing = this.state.hiddenRequests.find(function (r) { return r.callId === callId && r.requesterId === Store.me().id && r.status === "pending"; });
    if (existing) return { ok: false, error: "You already have a pending request for this call." };
    var req = { id: uid("r"), callId: callId, requesterId: this.me().id, fields: fields, status: "pending",
      durationMinutes: null, approvedBy: null, approvedAt: null, expiresAt: null };
    this.state.hiddenRequests.unshift(req);
    this.log(this.me().name + " requested hidden data (" + fields.join(", ") + ") for " + c.incident); this.save();
    return { ok: true, req: req };
  },
  approveHidden: function (reqId, durationMinutes) {
    var r = this.state.hiddenRequests.find(function (x) { return x.id === reqId; });
    if (!r || r.status !== "pending") return { ok: false, error: "That request is not pending." };
    r.status = "approved"; r.approvedBy = this.me().id; r.approvedAt = nowISO();
    r.durationMinutes = durationMinutes;
    r.expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
    var c = this.call(r.callId);
    this.log("Hidden-data request for " + (c ? c.incident : r.callId) + " approved by " + this.me().name +
      " (" + (durationMinutes ? durationMinutes + " min" : "forever") + ")"); this.save();
    return { ok: true };
  },
  denyHidden: function (reqId) {
    var r = this.state.hiddenRequests.find(function (x) { return x.id === reqId; });
    if (!r || r.status !== "pending") return { ok: false, error: "That request is not pending." };
    r.status = "denied"; this.save(); return { ok: true };
  },

  /* ----- equipment & loans ----- */
  checkoutEquipment: function (itemId, callId) {
    var it = this.item(itemId); var c = this.call(callId);
    if (!it || !c) return { ok: false, error: "Item or call not found." };
    if (it.status !== "in-stock") return { ok: false, error: it.name + " is not in stock (one active checkout per item)." };
    if (c.status !== "open") return { ok: false, error: "Equipment can only be used on an open call." };
    if (it.kind === "loan-only") return { ok: false, error: it.name + " is loan-only — use the loan flow, not a call checkout." };
    it.status = "out-on-call"; it.callId = c.id; it.checkedOutBy = this.me().id;
    c.equipmentOut.push(it.id);
    this.log(it.name + " checked out on " + c.incident + " by " + this.me().name); this.save();
    return { ok: true };
  },
  returnEquipment: function (itemId) {
    var it = this.item(itemId); if (!it) return { ok: false, error: "Item not found." };
    if (it.status === "in-stock") return { ok: false, error: it.name + " is already in stock." };
    var c = it.callId ? this.call(it.callId) : null;
    if (c) { var i = c.equipmentOut.indexOf(it.id); if (i !== -1) c.equipmentOut.splice(i, 1); }
    it.status = "in-stock"; it.callId = null; it.checkedOutBy = null;
    this.log(it.name + " returned by " + this.me().name); this.save();
    return { ok: true };
  },
  createLoan: function (itemId, callId, borrower, loanAgreed) {
    var it = this.item(itemId); var c = this.call(callId);
    if (!it || !c) return { ok: false, error: "Item or call not found." };
    if (!loanAgreed) return { ok: false, error: "Tick the “loan agreed” checkbox — a loan needs the borrower to agree." };
    if (!borrower || !borrower.trim()) return { ok: false, error: "Enter the borrower's name." };
    if (it.status !== "in-stock") return { ok: false, error: it.name + " is not in stock (one active checkout per item)." };
    if (it.kind !== "loan-only" && it.kind !== "call-only") return { ok: false, error: "Unknown item kind." };
    it.status = "out-on-loan"; it.callId = c.id; it.checkedOutBy = this.me().id;
    var loan = { id: uid("l"), itemId: it.id, callId: c.id, borrower: borrower.trim(), loanAgreed: true, status: "created", createdAt: nowISO() };
    this.state.loans.unshift(loan);
    this.log("Loan of " + it.name + " to " + borrower.trim() + " created on " + c.incident); this.save();
    return { ok: true, loan: loan };
  },
  advanceLoan: function (loanId, step) {
    var loan = this.state.loans.find(function (l) { return l.id === loanId; });
    if (!loan) return { ok: false, error: "Loan not found." };
    var order = ["created", "released", "picked-up", "returned", "closed"];
    if (order.indexOf(step) === -1) return { ok: false, error: "Unknown loan step." };
    loan.status = step;
    if (step === "returned" || step === "closed") { var r = this.returnEquipment(loan.itemId); if (!r.ok && step === "closed") { /* item already returned */ } }
    this.log("Loan " + loan.id.slice(0, 8) + " moved to " + step + " by " + this.me().name); this.save();
    return { ok: true };
  },

  /* ----- manage: members, natures, addresses, fleet, equipment ----- */
  addMember: function (name, phone, role, inventoryManager, unit) {
    if (!name || !name.trim()) return { ok: false, error: "Member name is required." };
    if (["super-admin", "coordinator", "dispatcher", "member"].indexOf(role) === -1) return { ok: false, error: "Pick a valid role." };
    if (phone && phone.trim() && phone.replace(/\D/g, "").length < 7) return { ok: false, error: "Enter a valid phone number (at least 7 digits)." };
    var m = { id: uid("u"), name: name.trim(), phone: phone || "", role: role, inventoryManager: !!inventoryManager, unit: (unit || "").trim() };
    this.state.users.push(m); this.log("Member added: " + m.name + " (" + role + ")"); this.save();
    return { ok: true, member: m };
  },
  editMember: function (id, name, phone, role, inventoryManager, unit) {
    var m = this.user(id); if (!m) return { ok: false, error: "Member not found." };
    if (!name || !name.trim()) return { ok: false, error: "Member name is required." };
    if (phone && phone.trim() && phone.replace(/\D/g, "").length < 7) return { ok: false, error: "Enter a valid phone number (at least 7 digits)." };
    m.name = name.trim(); m.phone = phone || ""; m.role = role; m.inventoryManager = !!inventoryManager; m.unit = (unit || "").trim();
    this.log("Member edited: " + m.name); this.save(); return { ok: true };
  },
  addNature: function (name) {
    if (!name || !name.trim()) return { ok: false, error: "Nature name is required." };
    if (this.state.callNatures.indexOf(name.trim()) !== -1) return { ok: false, error: "That call nature already exists." };
    this.state.callNatures.push(name.trim()); this.save(); return { ok: true };
  },
  editNature: function (oldName, newName) {
    var i = this.state.callNatures.indexOf(oldName);
    if (i === -1 || !newName || !newName.trim()) return { ok: false, error: "Nature not found or new name empty." };
    this.state.callNatures[i] = newName.trim(); this.save(); return { ok: true };
  },
  deleteNature: function (name) {
    if (this.state.calls.some(function (c) { return c.nature === name; })) return { ok: false, error: "Cannot delete “" + name + "” — it is used by an existing call." };
    var i = this.state.callNatures.indexOf(name); if (i === -1) return { ok: false, error: "Nature not found." };
    this.state.callNatures.splice(i, 1); this.save(); return { ok: true };
  },
  moveNature: function (name, dir) {
    var i = this.state.callNatures.indexOf(name); var j = i + dir;
    if (i === -1 || j < 0 || j >= this.state.callNatures.length) return { ok: false, error: "Cannot move that nature further." };
    var t = this.state.callNatures[i]; this.state.callNatures[i] = this.state.callNatures[j]; this.state.callNatures[j] = t;
    this.save(); return { ok: true };
  },
  addAddress: function (addr) {
    if (!addr || !addr.trim()) return { ok: false, error: "Address is required." };
    if (this.state.savedAddresses.indexOf(addr.trim()) !== -1) return { ok: false, error: "That address is already saved." };
    this.state.savedAddresses.push(addr.trim()); this.save(); return { ok: true };
  },
  editAddress: function (oldAddr, newAddr) {
    var i = this.state.savedAddresses.indexOf(oldAddr);
    if (i === -1 || !newAddr || !newAddr.trim()) return { ok: false, error: "Address not found or new address empty." };
    this.state.savedAddresses[i] = newAddr.trim(); this.save(); return { ok: true };
  },
  deleteAddress: function (addr) {
    var i = this.state.savedAddresses.indexOf(addr); if (i === -1) return { ok: false, error: "Address not found." };
    this.state.savedAddresses.splice(i, 1); this.save(); return { ok: true };
  },
  excludeAddress: function (addr) {
    if (this.state.excludedAddresses.indexOf(addr) === -1) this.state.excludedAddresses.push(addr);
    this.save(); return { ok: true };
  },
  unexcludeAddress: function (addr) {
    var i = this.state.excludedAddresses.indexOf(addr); if (i !== -1) this.state.excludedAddresses.splice(i, 1);
    this.save(); return { ok: true };
  },
  addVehicle: function (name) {
    if (!name || !name.trim()) return { ok: false, error: "Vehicle name is required." };
    var v = { id: uid("v"), name: name.trim(), active: true };
    this.state.fleet.push(v); this.save(); return { ok: true, vehicle: v };
  },
  renameVehicle: function (id, name) {
    var v = this.state.fleet.find(function (x) { return x.id === id; });
    if (!v || !name || !name.trim()) return { ok: false, error: "Vehicle not found or name empty." };
    v.name = name.trim(); this.save(); return { ok: true };
  },
  toggleVehicle: function (id) {
    var v = this.state.fleet.find(function (x) { return x.id === id; });
    if (!v) return { ok: false, error: "Vehicle not found." };
    v.active = !v.active; this.save(); return { ok: true };
  },
  addEquipment: function (name, kind) {
    if (!name || !name.trim()) return { ok: false, error: "Item name is required." };
    if (kind !== "call-only" && kind !== "loan-only") return { ok: false, error: "Pick call-only or loan-only." };
    var it = { id: uid("e"), name: name.trim(), kind: kind, status: "in-stock", callId: null, checkedOutBy: null };
    this.state.equipment.push(it); this.save(); return { ok: true, item: it };
  },
  editEquipment: function (id, name, kind) {
    var it = this.item(id); if (!it) return { ok: false, error: "Item not found." };
    if (!name || !name.trim()) return { ok: false, error: "Item name is required." };
    it.name = name.trim(); it.kind = kind; this.save(); return { ok: true };
  },

  /* ----- history suggestions (offered, never auto-selected) ----- */
  // History suggestions from past calls at the same address or from the
  // same phone number. Excluded addresses drive NO history suggestions.
  historySuggestions: function (address, phone) {
    var s = this.state;
    if (address && s.excludedAddresses.indexOf(address) !== -1) return [];
    var out = [];
    s.calls.forEach(function (c) {
      if (c.status === "draft") return;
      var byAddr = address && c.address === address && s.excludedAddresses.indexOf(c.address) === -1;
      var byPhone = phone && c.callerPhone && c.callerPhone.replace(/\D/g, "") === phone.replace(/\D/g, "");
      if (byAddr || byPhone) {
        if (out.indexOf(c.nature) === -1) out.push(c.nature);
      }
    });
    return out;
  }
};

/* ---------------- UI ---------------- */
var App = { tab: "home", pendingCall: null, idemKey: null, editingDraftId: null, bannerAlertIds: [] };

function roleLabel(r) { return {"super-admin":"Super admin","coordinator":"Coordinator","dispatcher":"Dispatcher","member":"Member"}[r] || r; }
function userName(id) { var u = Store.user(id); return u ? esc(u.name) : "—"; }
// Inline SVG icons (no network, no emoji). Used on call cards.
function svg(paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"; }
var ICONS = {
  pin: svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  phone: svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  clip: svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'),
  userPlus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'),
  bell: svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  chev: svg('<polyline points="9 18 15 12 9 6"/>'),
  route: svg('<polygon points="3 11 22 2 13 21 11 13 3 11"/>'),
  home: svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  list: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  inbox: svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  chart: svg('<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  database: svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>')
};
// Bottom tab bar icons (icons + labels). Keys are tab ids.
var TAB_ICON = { home: "home", calls: "list", new: "plus", requests: "inbox", contacts: "users", manage: "gear", equipment: "wrench", dashboard: "chart", reports: "file", history: "clock", data: "database" };
// Call card, reference layout: big address + incident/time on top,
// icon-led rows (what / phone / notes), responder pills, then a
// 5-icon action bar — Add, Backup, Close, Call, Maps. Only the
// actions the signed-in role may use are shown (hide, don't disable).
// Town for a call card's side strip (closed cards): the part of the
// address before the state ("100 Main St, Kingston, PA" -> "Kingston").
// Returns "" when no town is parseable — the strip then renders plain.
function townOf(address) {
  var parts = String(address || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (parts.length < 2) return "";
  var last = parts[parts.length - 1];
  var town = /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last) ? parts[parts.length - 2] : last;
  if (!town || /^\d/.test(town)) return ""; // a street address is not a town
  return town;
}
// Responder pill label: the member's unit code when they have one
// (owner decision 2026-11-17), otherwise their first name.
function responderLabel(u) {
  if (!u) return "?";
  if (u.unit && u.unit.trim()) return u.unit.trim();
  return u.name.split(" ")[0];
}

// Card colour (open calls only): neutral = open and uncovered,
// red = urgent and uncovered, blue = covered and not urgent,
// red + COVERED badge + blue pills = urgent and covered (urgent wins,
// the blue signal says others are already responding).
// Draft cards are muted gray with a plain gray side strip, no colour.
// Closed cards are blue: blue border, bright blue icons, a bright blue
// side strip carrying the town vertically, white pills with blue text
// (owner's production screenshot, 2026-11-17).
// The whole card is tappable: tapping anywhere on the card body opens
// the call detail (the card itself carries data-action="open-call");
// taps on action-bar buttons/links keep their own behaviour — the
// document click handler ignores link taps that bubble to the card.
function callCard(c) {
  var me = Store.me();
  var isOpen = c.status === "open";
  var responding = Store.isResponding(c, me.id);
  var canSee = Store.canSeeCaller(c, me.id);
  var covered = isOpen && c.responders.length > 0;
  var badges = [];
  if (c.urgent) badges.push('<span class="badge urgent">URGENT</span>');
  if (covered) badges.push('<span class="badge covered">COVERED</span>');
  if (c.backupNeeded) badges.push('<span class="badge backup">BACKUP NEEDED</span>');
  if (c.status === "draft") badges.push('<span class="badge draft">DRAFT</span>');
  if (c.status === "closed") badges.push('<span class="badge closed">CLOSED — ' + esc(outcomeLabel(c.outcome)) + '</span>');
  var time = new Date(c.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // Fix 3 (2026-11-23, v2 Finding 3): the responder's ETA rides on
  // the pill — "PA-05 · 20 min". Dispatcher-assigned members have
  // no ETA (r.eta is "—"), so the absence is explicit: "PA-05 · ETA —".
  // A responder record without an eta field (legacy stored state)
  // reads the same way.
  var pills = c.responders.length
    ? c.responders.map(function (r) {
        var u = Store.user(r.userId);
        var etaText = (r.eta && r.eta !== "—") ? r.eta : "ETA —";
        return '<span class="pill">' + esc(responderLabel(u)) + " · " + esc(etaText) + "</span>";
      }).join("")
    : '<span class="pill dim">No one yet</span>';
  var mapsUrl = c.mapsLink || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.address));
  var bar = '<div class="card-bar">';
  if (isOpen && Store.can("assign")) {
    bar += '<button class="bar-seg" data-action="add-member" data-id="' + c.id + '" aria-label="Add a member to this call">' + ICONS.userPlus + "<span>Add</span></button>";
  }
  if (isOpen && (Store.can("backup") || responding)) {
    bar += c.backupNeeded
      ? '<button class="bar-seg" data-action="backup-clear" data-id="' + c.id + '" aria-label="Clear backup needed">' + ICONS.bell + "<span>Backup ✓</span></button>"
      : '<button class="bar-seg" data-action="backup-request" data-id="' + c.id + '" aria-label="Request backup">' + ICONS.bell + "<span>Backup</span></button>";
  }
  if (isOpen && Store.can("close")) {
    bar += '<button class="bar-seg act-correct" data-action="correct-call" data-id="' + c.id + '" aria-label="Close this call as Corrected">' + ICONS.check + "<span>Close</span></button>";
  }
  if (canSee) {
    bar += '<a class="bar-seg" href="tel:' + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + '" aria-label="Call the caller back">' + ICONS.phone + "<span>Call</span></a>";
  }
  bar += '<a class="bar-seg" href="' + esc(mapsUrl) + '" target="_blank" rel="noopener" aria-label="Open address in Maps">' + ICONS.route + "<span>Maps</span></a></div>";
  var stateClass = "";
  if (isOpen) {
    if (c.urgent) stateClass = covered ? " card-urgent-covered" : " card-urgent";
    else stateClass = covered ? " card-covered" : " card-neutral";
  } else if (c.status === "draft") stateClass = " card-draft";
  else if (c.status === "closed") stateClass = " card-closed";
  // Side strip (draft/closed only, per the production screenshot):
  // draft = plain light-gray strip, no text; closed = bright blue
  // strip carrying the town vertically (bottom-to-top), plain blue
  // when no town is parseable from the address.
  var strip = "";
  if (c.status === "draft") strip = '<span class="card-strip strip-draft" aria-hidden="true"></span>';
  else if (c.status === "closed") {
    var town = townOf(c.address);
    strip = '<span class="card-strip strip-closed" aria-hidden="true">' + (town ? '<span class="strip-town">' + esc(town) + "</span>" : "") + "</span>";
  }
  // Inline respond control (members only, open call, not already
  // responding): ETA input + Respond button right on the card, no
  // extra screen. Dispatcher/coordinator cards don't get it — they
  // assign, and their respond path stays in the call detail.
  var respondRow = "";
  if (isOpen && me.role === "member" && !responding) {
    respondRow = '<div class="card-respond">' +
      '<label class="card-respond-label" for="eta-' + c.id + '">ETA (min)</label>' +
      '<input type="text" class="card-eta" id="eta-' + c.id + '" data-call="' + c.id + '" placeholder="e.g. 15 min" autocomplete="off">' +
      '<button type="button" class="btn small card-respond-btn" data-action="card-respond" data-id="' + c.id + '">Respond</button>' +
      '<div class="card-eta-error" role="alert" hidden></div>' +
      "</div>";
  }
  return '<article class="card call-card' + stateClass + (c.backupNeeded ? " backup" : "") + '" data-action="open-call" data-id="' + c.id + '" tabindex="0" role="button" aria-label="Open ' + esc(c.incident) + ' — ' + esc(c.nature) + '">' + strip +
    '<div class="card-head"><div class="card-addr"><span class="pin">' + ICONS.pin + "</span>" + esc(c.address) + '</div>' +
    '<div class="card-inc">' + esc(c.incident) + '<span class="time">' + esc(time) + "</span></div>" +
    '<span class="card-chev" aria-hidden="true">' + ICONS.chev + "</span></div>" +
    (badges.length ? '<div class="badges">' + badges.join(" ") + "</div>" : "") +
    '<div class="card-row"><span class="ic">' + ICONS.info + '</span><span class="val"><strong>' + esc(c.nature) + "</strong>" +
    (c.vehicle ? ' · <span class="veh">' + esc(c.vehicle) + "</span>" : "") + "</span></div>" +
    (canSee
      ? '<div class="card-row"><span class="ic">' + ICONS.phone + '</span><span class="val"><strong>' + esc(c.callerName) + '</strong> — <a href="tel:' + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + '">' + esc(c.callerPhone) + "</a></span></div>"
      : '<div class="card-row"><span class="ic">' + ICONS.phone + '</span><span class="val dim">' + (c.status === "closed"
          ? "Caller hidden after close — an approved grant is needed to see it."
          : "Caller hidden — visible only while you are responding to this call, or with an approved grant.") + "</span></div>") +
    (c.notes ? '<div class="card-row"><span class="ic">' + ICONS.clip + '</span><span class="val note">' + esc(c.notes) + "</span></div>" : "") +
    '<div class="pills">' + pills + "</div>" + respondRow + bar +
    "</article>";
}

/* ----- navigation: app-first. Only 3–4 primary tabs per role, in a
   single row; everything else lives in the hamburger side menu,
   grouped. The role switcher is a demo/test control — it lives at
   the bottom of the menu, not in the header. */
function allTabs() {
  var me = Store.me();
  var tabs = [["home", "Home"], ["calls", "Calls"]];
  if (Store.can("create-call")) tabs.push(["new", "New call"]);
  tabs.push(["equipment", "Equipment"]);
  if (Store.can("manage-inventory") || Store.can("manage-members")) tabs.push(["manage", "Manage"]);
  tabs.push(["contacts", "Contacts"]);
  tabs.push(["dashboard", "Dashboard"]);
  if (Store.can("reports")) tabs.push(["reports", "Reports"]);
  if (Store.can("approve-hidden")) tabs.push(["requests", "Requests"]);
  tabs.push(["history", "My history"]);
  tabs.push(["data", "My data"]);
  return tabs;
}

function primaryTabs() {
  var me = Store.me();
  if (me.role === "dispatcher" || me.role === "coordinator") return [["home", "Home"], ["calls", "Calls"], ["new", "New call"], ["requests", "Requests"]];
  if (me.role === "super-admin") return [["home", "Home"], ["calls", "Calls"], ["manage", "Manage"]];
  return [["home", "Home"], ["calls", "Calls"], ["contacts", "Contacts"]]; // member (incl. inventory-manager member)
}

function menuGroups() {
  var prim = primaryTabs().map(function (t) { return t[0]; });
  var rest = allTabs().filter(function (t) { return prim.indexOf(t[0]) === -1; });
  var GROUP = { dashboard: "Activity", history: "Activity", reports: "Activity", equipment: "Equipment", contacts: "Directory", manage: "Directory", data: "Personal" };
  var ORDER = ["Activity", "Equipment", "Directory", "Personal"];
  var groups = {};
  rest.forEach(function (t) { var g = GROUP[t[0]] || "More"; (groups[g] = groups[g] || []).push(t); });
  return ORDER.filter(function (g) { return groups[g]; }).map(function (g) { return { heading: g, items: groups[g] }; });
}

function renderMenu() {
  var b = $("#menu-body");
  b.innerHTML = menuGroups().map(function (g) {
    return '<div class="menu-group"><h3>' + esc(g.heading) + "</h3>" +
      g.items.map(function (t) {
        return '<button type="button" class="menu-item" data-action="tab" data-tab="' + t[0] + '"' + (App.tab === t[0] ? ' aria-current="true"' : "") + ">" + esc(t[1]) + "</button>";
      }).join("") + "</div>";
  }).join("");
}

function openMenu() {
  var wasHidden = $("#menu").hidden;
  renderMenu();
  $("#menu").hidden = false; $("#menu-backdrop").hidden = false;
  var b = document.querySelector('[data-action="menu-open"]');
  if (b) b.setAttribute("aria-expanded", "true");
  if (wasHidden) pushOverlayState();
}
function closeMenu() {
  if (!$("#menu").hidden) syncOverlayHistory("menu");
  $("#menu").hidden = true; $("#menu-backdrop").hidden = true;
  var b = document.querySelector('[data-action="menu-open"]');
  if (b) b.setAttribute("aria-expanded", "false");
}

// Android back button: opening the call dialog or the drawer pushes
// one history entry, so back closes the overlay first instead of
// leaving the app. The entry is consumed by the back press itself —
// the popstate handler clears the flag before closing, so no second
// back() fires. A programmatic close (button, Escape, backdrop) pops
// the entry via history.back() instead, so one back press is never
// eaten. The dialog's close event is the single cleanup point for
// dialog closes (Esc closes natively and still fires it).
//
// Two timing facts shape this code (both verified in Chrome, Nov 17):
// (1) The dialog `close` event fires on a LATER TASK, not
// synchronously with d.close() — a close listener has NOT run when
// close() returns. A fast close-then-reopen therefore lands in
// syncOverlayHistory with the NEW dialog already open; popping
// history then would eat the new overlay's entry and the popstate
// would close it (this crashed the section-6 put-out check twice).
// So sync bails out whenever an overlay other than the one being
// closed is open — the entry already on the stack backs the new
// overlay instead, and the new overlay's own close pops it.
// (2) A popstate caused by our own back() can likewise arrive after
// a newer overlay opened; the timestamp guard below leaves that
// overlay open (it is not the one the back press was for).
var overlayPushed = false;
var overlayOpenedAt = 0; // when the current overlay's entry was pushed
var ownBackAt = 0;       // when syncOverlayHistory last called history.back()
function pushOverlayState() {
  if (overlayPushed) return;
  try { history.pushState({ dispatchOverlay: true }, ""); overlayPushed = true; overlayOpenedAt = Date.now(); } catch (e) { /* file:// or no history */ }
}
function syncOverlayHistory(closing) {
  if (!overlayPushed) return;
  var d = $("#dlg");
  var m = $("#menu");
  // A newer dialog opened after this one closed (see (1) above).
  if (d && d.open) return;
  // A newer menu opened after this dialog closed — but not the menu
  // being closed by closeMenu itself, which is the current overlay.
  if (closing !== "menu" && m && !m.hidden) return;
  overlayPushed = false;
  ownBackAt = Date.now();
  try { history.back(); } catch (e) { /* ignore */ }
}
window.addEventListener("popstate", function (ev) {
  // Landing ON an overlay entry means the back press was overtaken
  // by a newer overlay opening after the close that queued it — the
  // new overlay stays open and the flag stays set.
  if (ev.state && ev.state.dispatchOverlay) { ownBackAt = 0; return; }
  var d = $("#dlg");
  var m = $("#menu");
  var overlayOpen = (d && d.open) || (m && !m.hidden);
  // A popstate from our own back() arriving after a newer overlay
  // opened (see (2) above) is not for that overlay — leave it open.
  if (overlayOpen && ownBackAt && overlayOpenedAt > ownBackAt) { ownBackAt = 0; return; }
  ownBackAt = 0;
  overlayPushed = false; // the back press left the overlay entry
  if (d && d.open) { closeDialog(); return; }
  if (m && !m.hidden) { closeMenu(); }
});

function render() {
  var me = Store.me();
  var sel = $("#role-switch");
  sel.innerHTML = Store.state.users.map(function (u) {
    return '<option value="' + u.id + '"' + (u.id === me.id ? " selected" : "") + ">" + esc(u.name) + " — " + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</option>";
  }).join("");
  var tabs = primaryTabs();
  var all = allTabs();
  if (!all.some(function (t) { return t[0] === App.tab; })) App.tab = "home";
  $("#tabs").innerHTML = tabs.map(function (t) {
    // Bottom tab bar (icons + labels, fixed, thumb-reach): the same
    // primary tabs per role as before — the top tab row is gone.
    return '<button data-action="tab" data-tab="' + t[0] + '"' + (App.tab === t[0] ? ' aria-current="true"' : "") + (t[0] === "new" ? ' class="tab-new"' : "") + '><span class="tab-ic" aria-hidden="true">' + ICONS[TAB_ICON[t[0]] || "list"] + '</span><span class="tab-label">' + esc(t[1]) + "</span></button>";
  }).join("");
  renderMenu();
  // In-app alert banner (all org members except super admin).
  // The banner is derived from live state: a backup alert only shows
  // while its call is still open and still needs backup — a stale
  // backup alert never renders, even if one survives in storage.
  // Two more rules (Instinct rerun): a "call" (new-call) alert older
  // than 24 hours never renders, and the banner has a dismiss (×)
  // that hides it — dismissed alert ids are persisted, so a reload
  // does not resurrect them (the log/activity data is untouched).
  // The banner shows the most recent live alert as one compact line
  // (plus a "+N more" count); dismiss hides every live alert shown.
  var banner = $("#alert-banner");
  var DAY = 24 * 3600 * 1000;
  var dismissed = Store.state.dismissedAlerts || [];
  if (me.role === "super-admin") { banner.hidden = true; App.bannerAlertIds = []; }
  else {
    var visible = Store.state.alerts.filter(function (a) {
      if (dismissed.indexOf(a.id) !== -1) return false;
      if (a.kind === "call") {
        if (Date.now() - new Date(a.at).getTime() > DAY) return false;
        // A new-call alert is a live claim about an open call: once
        // the call closes, the alert must stop surfacing (D2, pass 5).
        var cc = Store.call(a.callId);
        return cc && cc.status === "open";
      }
      if (a.kind !== "backup") return true;
      var c = Store.call(a.callId);
      return c && c.status === "open" && c.backupNeeded;
    });
    App.bannerAlertIds = visible.map(function (a) { return a.id; });
    if (visible.length) {
      banner.hidden = false;
      banner.className = "alert-banner" + (visible.some(function (a) { return a.urgent; }) ? " urgent" : "");
      banner.innerHTML = '<button type="button" class="banner-x" data-action="dismiss-banner" aria-label="Dismiss announcements">✕</button>' +
        '<div class="banner-line">' + esc(visible[0].text) + (visible.length > 1 ? ' <span class="muted">+' + (visible.length - 1) + " more</span>" : "") + "</div>" +
        // Fix 4 (v2 test, Finding 4): when the most recent live alert
        // is a backup request, name who was told — the roles, from
        // alertTargets (names don't fit the one-line banner; the full
        // names are on the call detail). A backup alert for another
        // call is not the line shown, so no sub-line for it.
        (visible[0].kind === "backup" ? '<div class="banner-sub">Backup requested — all ' + esc(joinAnd(Store.backupRecipientRoles().map(function (r) { return r + "s"; }))) + " alerted</div>" : "");
    } else banner.hidden = true;
  }
  var v = $("#view");
  var fn = { home: viewHome, calls: viewCalls, new: viewNewCall, equipment: viewEquipment, manage: viewManage,
    contacts: viewContacts, dashboard: viewDashboard, reports: viewReports, requests: viewRequests,
    history: viewHistory, data: viewData }[App.tab] || viewHome;
  v.innerHTML = fn();
}

// Member Home is ONE screen (decided, pass 5 M2): compact one-line
// rows instead of full cards, capped at 2 per section with a count +
// "View all N in Calls" link in the section heading for the rest.
// The backup-needed signal folds into the row meta (no separate
// attention strip — the same call is already a row). Full cards —
// and the inline respond control — stay on the Calls tab. Other
// roles keep the full-card home below. The signed-in line is dropped
// here: identity is already in the header role switcher.
function homeRow(c, meta, metaCls) {
  return '<button type="button" class="home-row" data-action="open-call" data-id="' + c.id + '">' +
    '<span class="home-row-text"><strong>' + esc(c.incident) + " — " + esc(c.nature) + "</strong>" +
    '<span class="muted">' + esc(c.address) + "</span></span>" +
    (meta ? '<span class="home-row-meta' + (metaCls ? " " + metaCls : "") + '">' + esc(meta) + "</span>" : "") +
    '<span class="home-row-chev" aria-hidden="true">›</span></button>';
}
function homeReqRow(r) {
  var rc = Store.call(r.callId);
  var st;
  if (r.status === "pending") st = "Pending dispatcher approval";
  else if (r.status === "approved") {
    st = (r.expiresAt && new Date(r.expiresAt).getTime() <= Date.now())
      ? "Approved — grant expired " + fmtDT(r.expiresAt)
      : "Approved" + (r.expiresAt ? " until " + fmtDT(r.expiresAt) : " (forever)");
  } else st = "Denied by a dispatcher";
  return '<button type="button" class="home-row" data-action="open-call" data-id="' + r.callId + '">' +
    '<span class="home-row-text"><strong>' + esc(rc ? rc.incident : r.callId) + (rc ? " — " + esc(rc.nature) : "") + "</strong>" +
    '<span class="muted">Fields: ' + esc(r.fields.join(", ")) + " · " + esc(st) + "</span></span>" +
    '<span class="home-row-chev" aria-hidden="true">›</span></button>';
}
// Section heading with the count and, when capped, a one-tap link to
// the full list. The link rides inside the heading so it costs no
// extra vertical space — the one-screen budget has none to spare.
function homeHead(title, total, shown) {
  var h = "<h2><span>" + title + (total ? " · " + total : "") + "</span>";
  if (total > shown) h += '<button type="button" class="home-viewall" data-action="tab" data-tab="calls">View all ' + total + " →</button>";
  return h + "</h2>";
}
function viewHomeMember(me, mine, needMe, backup) {
  var myReqs = Store.state.hiddenRequests.filter(function (r) { return r.requesterId === me.id; });
  var h = '<div class="home-compact"><h1>What needs my attention</h1>';
  h += homeHead("My calls right now", mine.length, 2);
  if (mine.length) {
    h += mine.slice(0, 2).map(function (c) {
      var r = c.responders.find(function (x) { return x.userId === me.id; });
      var meta = r ? "ETA " + r.eta : "";
      if (c.backupNeeded) meta += (meta ? " · " : "") + "BACKUP";
      return homeRow(c, meta, c.backupNeeded ? "backup" : "");
    }).join("");
  } else h += '<p class="empty">You are not responding to any call right now.</p>';
  if (myReqs.length) {
    h += homeHead("My privacy requests", myReqs.length, 2) + myReqs.slice(0, 2).map(homeReqRow).join("");
  }
  h += homeHead("Open calls needing a response", needMe.length, 2);
  if (needMe.length) {
    h += needMe.slice(0, 2).map(function (c) {
      var meta = c.urgent ? "URGENT" : "";
      if (c.backupNeeded) meta += (meta ? " · " : "") + "BACKUP";
      return homeRow(c, meta, c.urgent ? "urgent" : (c.backupNeeded ? "backup" : ""));
    }).join("");
  } else h += '<p class="empty">No open calls need a response right now.</p>';
  return h + "</div>";
}

function viewHome() {
  var me = Store.me();
  var open = Store.state.calls.filter(function (c) { return c.status === "open"; });
  var mine = open.filter(function (c) { return Store.isResponding(c, me.id); });
  var needMe = open.filter(function (c) { return !Store.isResponding(c, me.id); });
  var backup = open.filter(function (c) { return c.backupNeeded; });
  if (me.role === "member") return viewHomeMember(me, mine, needMe, backup);
  var h = "<h1>What needs my attention</h1>";
  h += '<p class="muted">Signed in as <strong>' + esc(me.name) + "</strong> (" + roleLabel(me.role) + (me.inventoryManager ? " + inventory manager" : "") + ").</p>";
  if (backup.length) h += '<div class="attention"><strong>Backup needed:</strong> ' + backup.map(function (c) { return esc(c.incident) + " — " + esc(c.nature); }).join("; ") + "</div>";
  if (mine.length) h += "<h2>My calls right now</h2>" + mine.map(callCard).join("");
  else h += '<p class="empty">You are not responding to any call right now.</p>';
  // My privacy requests (item 4b): the signed-in member's own
  // hidden-data requests, with status and a link back to each call —
  // so a request is still visible after its toast fades.
  var myReqs = Store.state.hiddenRequests.filter(function (r) { return r.requesterId === me.id; });
  if (myReqs.length) {
    h += "<h2>My privacy requests</h2>" + myReqs.map(function (r) {
      var rc = Store.call(r.callId);
      var st;
      if (r.status === "pending") st = "Pending dispatcher approval";
      else if (r.status === "approved") {
        st = (r.expiresAt && new Date(r.expiresAt).getTime() <= Date.now())
          ? "Approved — grant expired " + fmtDT(r.expiresAt)
          : "Approved" + (r.expiresAt ? " until " + fmtDT(r.expiresAt) : " (forever)");
      } else st = "Denied by a dispatcher";
      return '<article class="card light"><h3>' + esc(rc ? rc.incident : r.callId) + (rc ? " — " + esc(rc.nature) : "") + "</h3>" +
        '<p class="muted">Fields: ' + esc(r.fields.join(", ")) + " · " + esc(st) + "</p>" +
        (rc ? '<button class="btn small" data-action="open-call" data-id="' + rc.id + '">Open call</button>' : "") + "</article>";
    }).join("");
  }
  if (needMe.length && (me.role === "member" || me.role === "coordinator")) {
    h += "<h2>Open calls needing a response</h2>" + needMe.map(callCard).join("");
  } else if (me.role === "dispatcher" || me.role === "coordinator") {
    h += "<h2>Open calls</h2>" + (open.length ? open.map(callCard).join("") : '<p class="empty">No open calls.</p>');
  } else if (me.role === "super-admin") {
    h += "<h2>Open calls</h2>" + (open.length ? open.map(callCard).join("") : '<p class="empty">No open calls.</p>');
  }
  return h;
}

function viewCalls() {
  var h = "<h1>Calls</h1><p class=\"muted\">List only — no map view in this version.</p>";
  // Drafts are dispatcher+ only (decided, D1 pass 5): members never
  // see them — not in this list, not in counts, not anywhere.
  var isMember = Store.me().role === "member";
  var open = Store.state.calls.filter(function (c) { return isMember ? c.status === "open" : c.status !== "closed"; });
  var closed = Store.state.calls.filter(function (c) { return c.status === "closed"; });
  h += "<h2>" + (isMember ? "Open" : "Open &amp; drafts") + "</h2>" + (open.length ? open.map(callCard).join("") : '<p class="empty">No open calls.</p>');
  h += "<h2>Closed</h2>" + (closed.length ? closed.map(callCard).join("") : '<p class="empty">No closed calls yet.</p>');
  return h;
}

function viewNewCall() {
  var s = Store.state;
  // Prefill from a pending call (Back to edit, or editing a draft) so
  // nothing has to be retyped.
  var d = App.pendingCall || {};
  var editing = App.editingDraftId ? Store.call(App.editingDraftId) : null;
  // The nature field shows an honest placeholder until the user picks
  // one: a native <select> with no option marked selected displays its
  // FIRST option ("Flat Tire") as if chosen, while nothing was ever
  // set — so a user who never touched the dropdown could be blamed
  // for a "nature required" error on a value the screen showed as
  // filled. No field may display a value that doesn't count.
  var opts = '<option value="" disabled' + (d.nature ? "" : " selected") + ">Choose a call nature…</option>" +
    s.callNatures.map(function (n) { return '<option value="' + esc(n) + '"' + (d.nature === n ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
  var alertKind = d.alertKind || "normal";
  var h = "<h1>" + (editing ? "Edit draft " + esc(editing.incident) : "New call") + "</h1>";
  h += '<form id="new-call-form">' +
    '<label for="nc-nature">Call nature</label><select id="nc-nature" name="nature">' + opts + "</select>" +
    '<label for="nc-address">Address</label><input type="text" id="nc-address" name="address" list="addr-list" placeholder="Start typing an address…" autocomplete="off" value="' + esc(d.address || "") + '">' +
    '<datalist id="addr-list">' + s.savedAddresses.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("") + "</datalist>" +
    '<div id="nc-suggest"></div>' +
    '<label for="nc-vehicle">Vehicle (car type)</label><input type="text" id="nc-vehicle" name="vehicle" placeholder="e.g. Honda Accord" value="' + esc(d.vehicle || "") + '">' +
    '<label for="nc-name">Caller name</label><input type="text" id="nc-name" name="callerName" value="' + esc(d.callerName || "") + '">' +
    '<label for="nc-phone">Callback number <span class="req">*</span> <span class="req-hint">(required)</span></label><input type="tel" id="nc-phone" name="callerPhone" placeholder="555-0100" value="' + esc(d.callerPhone || "") + '">' +
    '<label for="nc-notes">Notes</label><textarea id="nc-notes" name="notes">' + esc(d.notes || "") + "</textarea>" +
    '<label for="nc-coords">Coordinates (optional)</label><input type="text" id="nc-coords" name="coordinates" placeholder="e.g. 41.2743, -75.8835" value="' + esc(d.coordinates || "") + '">' +
    '<label for="nc-maps">Google Maps link (optional — paste a link)</label><input type="text" id="nc-maps" name="mapsLink" placeholder="https://maps.google.com/…" value="' + esc(d.mapsLink || "") + '">' +
    '<fieldset><legend>Alert</legend>' +
    '<label><input type="radio" name="alertKind" value="normal"' + (alertKind === "normal" ? " checked" : "") + '> Normal — alert everyone in the org</label>' +
    '<label><input type="radio" name="alertKind" value="urgent"' + (alertKind === "urgent" ? " checked" : "") + '> Urgent — different sound/vibration, bypasses the app’s own night mute (in this prototype: shown as urgent)</label>' +
    '<label><input type="radio" name="alertKind" value="none"' + (alertKind === "none" ? " checked" : "") + '> Don’t notify — create silently</label></fieldset>' +
    '<label><input type="checkbox" id="nc-save-addr"' + (d.saveAddress ? " checked" : "") + '> Save this address for next time</label>' +
    '<label><input type="checkbox" id="nc-exclude-addr"> Exclude this address from history suggestions</label>' +
    '<div id="nc-error" class="dlg-error" role="alert" hidden></div>' +
    '<div><button class="btn" type="submit">Review call</button></div>' +
    "</form><div id=\"nc-summary\"></div>";
  return h;
}

function newCallSummary(data) {
  var h = "<h2>Review before confirming</h2><div class=\"card\"><dl class=\"kv\">" +
    "<dt>Nature</dt><dd>" + esc(data.nature) + "</dd>" +
    "<dt>Address</dt><dd>" + esc(data.address) + "</dd>" +
    "<dt>Vehicle</dt><dd>" + esc(data.vehicle || "—") + "</dd>" +
    "<dt>Caller</dt><dd>" + esc(data.callerName) + " — " + esc(data.callerPhone) + "</dd>" +
    "<dt>Notes</dt><dd>" + esc(data.notes || "—") + "</dd>" +
    "<dt>Coordinates</dt><dd>" + esc(data.coordinates || "—") + "</dd>" +
    "<dt>Maps link</dt><dd>" + esc(data.mapsLink || "—") + "</dd>" +
    "<dt>Alert</dt><dd>" + esc(data.alertKind) + "</dd></dl></div>" +
    '<button class="btn" data-action="confirm-call" data-status="open">Put out call</button>' +
    '<button class="btn secondary" data-action="confirm-call" data-status="draft">Save as draft (no notifications)</button>' +
    '<button class="btn secondary" data-action="cancel-summary">Back to edit</button>';
  return h;
}

/* ----- add-member picker (dispatcher/coordinator assigns a member) ----- */
function assignPickerHTML(c) {
  var eligible = Store.state.users.filter(function (u) {
    return (u.role === "member" || u.role === "coordinator") && !Store.isResponding(c, u.id);
  });
  var h = "<h2>Add a member to " + esc(c.incident) + "</h2>";
  h += "<p class=\"muted\">Pick a member to assign to this call. They show as a responder with no ETA (“—”). Use Unassign in the call detail to undo.</p>";
  if (!eligible.length) h += "<p>Everyone who can respond is already on this call.</p>";
  eligible.forEach(function (u) {
    h += '<button class="btn" data-action="assign-member" data-id="' + c.id + '" data-user="' + u.id + '">' + esc(u.name) + " — " + roleLabel(u.role) + "</button>";
  });
  h += '<div><button class="btn secondary" data-action="close-dialog">Done</button></div>';
  return h;
}

/* ----- call detail dialog ----- */
function openDialog(html) {
  $("#dlg-body").innerHTML = html;
  var d = $("#dlg");
  if (!d.open) { d.showModal(); pushOverlayState(); }
}
function closeDialog() { var d = $("#dlg"); if (d.open) d.close(); }
// Friendly close-outcome labels (stored codes stay the OUTCOMES values).
// Nothing is pre-selected — closing requires picking one.
var OUTCOME_LABELS = {
  Received: ["Received", "Help was given and the caller was taken care of"],
  OnTheWay: ["On the way", "Help was on the way when the call ended"],
  NeedsCoordinator: ["Needs coordinator", "Passed to a coordinator to follow up"],
  Interstate: ["Interstate", "Out-of-area / interstate call"],
  NotCorrected: ["Not corrected", "Could not be fixed on scene"],
  Corrected: ["Corrected", "Fixed on scene — caller is good to go"],
  Cancelled: ["Cancelled", "Caller cancelled before help arrived"]
};

// Display label for a stored outcome code (codes stay in the store;
// only the display uses friendly text with spaces). Defined here,
// next to OUTCOME_LABELS; callCard() above may call it because it only
// runs after the whole script has loaded.
function outcomeLabel(code) { var L = OUTCOME_LABELS[code]; return L ? L[0] : (code || ""); }

function callDetailHTML(c) {
  var me = Store.me();
  var canSee = Store.canSeeCaller(c, me.id);
  var responding = Store.isResponding(c, me.id);
  var grant = Store.activeGrant(c.id, me.id);
  // The signed-in member's own request for this call, if any: prefer
  // a pending one, then an active approved grant, then the most recent
  // decided one. Shown as a status line below (item 4a) so a member
  // can see where their request stands after the toast fades.
  var myReq = null;
  if (me.role === "member" || me.role === "coordinator") {
    var myReqs = Store.state.hiddenRequests.filter(function (r) { return r.callId === c.id && r.requesterId === me.id; });
    var nowMs = Date.now();
    myReq = myReqs.find(function (r) { return r.status === "pending"; }) ||
      myReqs.find(function (r) { return r.status === "approved" && (!r.expiresAt || new Date(r.expiresAt).getTime() > nowMs); }) ||
      (myReqs.length ? myReqs[0] : null);
  }
  var h = "<h2>" + esc(c.incident) + " — " + esc(c.nature) + "</h2>";
  h += '<dl class="kv"><dt>Status</dt><dd>' + esc(c.status) + (c.outcome ? " (" + esc(outcomeLabel(c.outcome)) + ")" : "") + "</dd>" +
    "<dt>Address</dt><dd>" + esc(c.address) + "</dd>" +
    "<dt>Vehicle</dt><dd>" + esc(c.vehicle || "—") + "</dd>" +
    "<dt>Coordinates</dt><dd>" + esc(c.coordinates || "—") + "</dd>" +
    "<dt>Maps link</dt><dd>" + (c.mapsLink ? '<a href="' + esc(c.mapsLink) + '" target="_blank" rel="noopener">' + esc(c.mapsLink) + "</a>" : "—") + "</dd>" +
    "<dt>Notes</dt><dd>" + esc(c.notes || "—") + "</dd>";
  if (canSee) {
    h += "<dt>Caller</dt><dd>" + esc(c.callerName) + " — <a href=\"tel:" + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + "\">" + esc(c.callerPhone) + "</a> (tap to call back)</dd>";
  } else if (c.status === "closed") {
    // Responders CAN still see the caller on a closed call (owner
    // reversal 2026-11-17); only non-responders need a grant.
    h += "<dt>Caller</dt><dd class=\"muted\">Hidden after close. Request caller name + phone from a dispatcher (approval needed) — members who responded to this call can still see it.</dd>";
  } else {
    h += "<dt>Caller</dt><dd class=\"muted\">Hidden. Visible only while you are responding to this call, or with an approved grant.</dd>";
  }
  if (myReq) {
    var reqText;
    if (myReq.status === "pending") reqText = "Pending dispatcher approval.";
    else if (myReq.status === "approved") {
      if (myReq.expiresAt && new Date(myReq.expiresAt).getTime() <= Date.now()) reqText = "Approved grant expired " + fmtDT(myReq.expiresAt) + " — you can request again.";
      else reqText = "Approved — you can see the caller until " + (myReq.expiresAt ? fmtDT(myReq.expiresAt) : "forever") + ".";
    } else reqText = "Denied by a dispatcher — you can request again.";
    h += "<dt>Your request</dt><dd>" + reqText + "</dd>";
  }
  h += "<dt>Responding</dt><dd>" + (c.responders.length ? c.responders.map(function (r) { return userName(r.userId) + " (ETA " + esc(r.eta) + ")"; }).join(", ") : "No one yet") + "</dd>";
  h += "<dt>Backup</dt><dd>" + (c.backupNeeded ? "NEEDED — alerted: " + esc(joinAnd(Store.backupRecipientNames())) : "Not needed") + "</dd>";
  // Equipment out (Fix 1, v2 test): one row per item, with a Return
  // control for dispatcher/coordinator right here — no more hunting
  // through Menu → Equipment to do what the block toast just asked
  // for. Hidden for other roles (hide, don't disable). The button
  // carries the call id so the handler can re-render this dialog.
  var equipOutHTML;
  if (!c.equipmentOut.length) equipOutHTML = "None";
  else {
    equipOutHTML = c.equipmentOut.map(function (id) {
      var it = Store.item(id);
      var name = it ? esc(it.name) : esc(id);
      var btn = (c.status === "open" && Store.can("close"))
        ? '<button class="btn small equip-return" data-action="return-equipment" data-item="' + id + '" data-id="' + c.id + '">Mark returned</button>'
        : "";
      return '<span class="equip-out-row"><span>' + name + "</span>" + btn + "</span>";
    }).join("");
  }
  h += "<dt>Equipment out</dt><dd>" + equipOutHTML + "</dd></dl>";

  if (c.status === "open") {
    if ((me.role === "member" || me.role === "coordinator") && !responding) {
      h += '<h3>Respond</h3><form id="respond-form" data-call="' + c.id + '">' +
        '<label for="eta">ETA (required — e.g. 15 min or 1h 30m)</label><input type="text" id="eta" name="eta" placeholder="e.g. 15 min">' +
        '<button class="btn secondary" type="button" data-action="eta-location">Use my location to prefill ETA</button>' +
        '<div id="eta-note" class="muted"></div>' +
        '<div id="dlg-error" class="dlg-error" role="alert" hidden></div>' +
        '<div><button class="btn" type="submit">Respond to this call</button></div></form>';
    }
    if (responding) h += "<p>You are responding to this call. Only a dispatcher can unassign you.</p>";
    if (Store.can("backup") || responding) {
      h += c.backupNeeded
        ? '<button class="btn" data-action="backup-clear" data-id="' + c.id + '">Clear backup-needed</button>'
        : '<button class="btn" data-action="backup-request" data-id="' + c.id + '">Request backup</button>';
    }
    if (Store.can("unassign")) {
      c.responders.forEach(function (r) {
        h += '<button class="btn secondary" data-action="unassign" data-id="' + c.id + '" data-user="' + r.userId + '">Unassign ' + userName(r.userId) + "</button>";
      });
    }
    // No duplicate request while one is pending (or an active grant
    // already covers the caller): the button is hidden, not just
    // rejected on tap.
    if ((me.role === "member" || me.role === "coordinator") && !responding && !canSee && !(myReq && myReq.status === "pending")) {
      h += '<button class="btn secondary" data-action="request-callback" data-id="' + c.id + '">Request callback number (dispatcher approval needed)</button>';
    }
    if (responding || Store.can("create-call")) {
      h += "<h3>Equipment on this call</h3>";
      Store.state.equipment.filter(function (e) { return e.kind === "call-only" && e.status === "in-stock"; }).forEach(function (e) {
        h += '<button class="btn secondary" data-action="checkout" data-item="' + e.id + '" data-id="' + c.id + '">Use ' + esc(e.name) + "</button>";
      });
      var loanable = Store.state.equipment.filter(function (e) { return e.kind === "loan-only" && e.status === "in-stock"; });
      if (loanable.length) {
        h += '<form id="loan-form" data-call="' + c.id + '"><label for="loan-item">Loan an item to the caller</label><select id="loan-item" name="itemId">' +
          loanable.map(function (e) { return '<option value="' + e.id + '">' + esc(e.name) + "</option>"; }).join("") + "</select>" +
          '<label for="loan-borrower">Borrower name</label><input type="text" id="loan-borrower" name="borrower">' +
          '<label><input type="checkbox" name="loanAgreed"> Loan agreed (checkbox — no signing in this version)</label>' +
          '<div id="dlg-error" class="dlg-error" role="alert" hidden></div>' +
          '<div><button class="btn secondary" type="submit">Create loan</button></div></form>';
      }
    }
    if (Store.can("close")) {
      h += "<h3>Close this call</h3><form id=\"close-form\" data-call=\"" + c.id + "\">" +
        OUTCOMES.map(function (o) { var L = OUTCOME_LABELS[o]; return '<label><input type="radio" name="outcome" value="' + o + '"> <strong>' + L[0] + "</strong> — <span class=\"muted\">" + L[1] + "</span></label>"; }).join("") +
        '<div id="dlg-error" class="dlg-error" role="alert" hidden></div>' +
        '<div><button class="btn danger" type="submit">Close call</button></div></form>';
    }
    h += '<button class="btn secondary" data-action="interstate">Interstate (placeholder — sends nothing)</button>';
  }
  if (c.status === "draft" && Store.can("create-call")) {
    h += '<button class="btn" data-action="edit-draft" data-id="' + c.id + '">Edit draft</button>' +
      '<button class="btn" data-action="put-out" data-id="' + c.id + '">Put out this draft</button>' +
      '<button class="btn danger" data-action="delete-draft" data-id="' + c.id + '">Delete draft</button>';
  }
  if (c.status === "closed") {
    if (Store.can("reopen")) h += '<button class="btn" data-action="reopen" data-id="' + c.id + '">Reopen call (responses, assignments and equipment stay as they were)</button>';
    if (me.role === "member" && !(myReq && myReq.status === "pending") && !grant) h += '<button class="btn secondary" data-action="request-hidden" data-id="' + c.id + '">Request caller name + phone (dispatcher approval needed)</button>';
  }
  h += '<div><button class="btn secondary" data-action="close-dialog">Cancel</button></div>';
  return h;
}

/* ----- equipment, loans, contacts, dashboard, reports, history ----- */
function viewEquipment() {
  var me = Store.me();
  var canManage = Store.can("manage-inventory");
  var h = "<h1>Equipment</h1>";
  h += '<p class="muted">One active checkout per item. Equipment is used only through a call; loans use the “loan agreed” checkbox, no signing. ' +
    (canManage ? "You can add and edit items." : "You can use items on calls you are responding to; managing inventory needs the inventory-manager role.") + "</p>";
  if (canManage) h += '<button class="btn" data-action="equip-add">Add equipment item</button>';
  h += Store.state.equipment.map(function (e) {
    var onCall = e.callId ? Store.call(e.callId) : null;
    return '<article class="card"><h3>' + esc(e.name) + ' <span class="badge">' + esc(e.kind) + '</span> <span class="badge">' + esc(e.status) + "</span></h3>" +
      '<p class="muted">' + (onCall ? "On " + esc(onCall.incident) + (e.checkedOutBy ? " — checked out by " + userName(e.checkedOutBy) : "") : "In stock") + "</p>" +
      (e.status !== "in-stock" ? '<button class="btn small" data-action="return-equipment" data-item="' + e.id + '">Mark returned</button>' : "") +
      (canManage ? '<button class="btn small secondary" data-action="equip-edit" data-item="' + e.id + '">Edit</button>' : "") +
      "</article>";
  }).join("") || '<p class="empty">No equipment yet — add some.</p>';
  h += "<h2>Loans</h2>";
  // Only the NEXT action for the loan's current state, with a hint so
  // the state is clear — never the full lifecycle button row.
  var LOAN_NEXT = {
    "created": ["released", "Mark released", "Next: release the item to the borrower."],
    "released": ["picked-up", "Mark picked up", "Next: borrower picks the item up."],
    "picked-up": ["returned", "Mark returned", "Next: item is returned."],
    "returned": ["closed", "Close loan", "Next: close the loan."]
  };
  h += Store.state.loans.length ? Store.state.loans.map(function (l) {
    var it = Store.item(l.itemId);
    var next = LOAN_NEXT[l.status];
    return '<article class="card"><h3>Loan — ' + esc(it ? it.name : l.itemId) + ' to ' + esc(l.borrower) + ' <span class="badge">' + esc(l.status) + "</span></h3>" +
      '<p class="muted">Loan agreed: ' + (l.loanAgreed ? "yes" : "no") + " · Created " + fmtDT(l.createdAt) + "</p>" +
      '<p class="muted">' + (next ? next[2] : "Closed — nothing left to do.") + "</p>" +
      (next ? '<button class="btn small secondary" data-action="loan-step" data-id="' + l.id + '" data-step="' + next[0] + '">' + next[1] + "</button>" : "") +
      "</article>";
  }).join("") : '<p class="empty">No loans yet.</p>';
  return h;
}

function telLink(phone) {
  var digits = String(phone || "").replace(/[^0-9+]/g, "");
  if (!digits) return "—";
  return '<a href="tel:' + esc(digits) + '">' + esc(phone) + "</a>";
}

function viewContacts() {
  return "<h1>Contacts</h1><p class=\"muted\">Members see other members’ names and phone numbers.</p>" +
    '<div class="table-scroll"><table><tr><th>Name</th><th>Role</th><th>Phone</th></tr>' +
    Store.state.users.map(function (u) { return "<tr><td>" + esc(u.name) + "</td><td>" + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</td><td>" + telLink(u.phone) + "</td></tr>"; }).join("") + "</table></div>";
}

function viewDashboard() {
  var me = Store.me();
  var now = Date.now(), month = 30 * 24 * 3600 * 1000;
  var inMonth = function (c) { return new Date(c.createdAt).getTime() > now - month; };
  var myCalls = Store.state.calls.filter(function (c) { return Store.isResponding(c, me.id); });
  var myCovered = Store.state.calls.filter(function (c) { return c.status === "closed" && inMonth(c) && Store.isResponding(c, me.id); }).length;
  var h = "<h1>Dashboard</h1><h2>My dashboard</h2><dl class=\"kv\">" +
    "<dt>Calls I’m on</dt><dd>" + myCalls.length + "</dd>" +
    "<dt>Covered by me (last 30 days)</dt><dd>" + myCovered + " — covered means I responded and the call then closed</dd></dl>";
  if (Store.can("org-dashboard")) {
    var callsM = Store.state.calls.filter(inMonth);
    var coveredM = callsM.filter(function (c) { return c.status === "closed" && c.responders.length; }).length;
    var openM = callsM.filter(function (c) { return c.status === "open"; }).length;
    var prevCovered = Store.state.calls.filter(function (c) { var t = new Date(c.createdAt).getTime(); return c.status === "closed" && c.responders.length && t <= now - month && t > now - 2 * month; }).length;
    var cmp = coveredM > prevCovered ? "ABOVE average" : (coveredM < prevCovered ? "BELOW average" : "AT average");
    h += "<h2>Organisation dashboard (last 30 days)</h2><dl class=\"kv\">" +
      "<dt>Open calls</dt><dd>" + openM + "</dd>" +
      "<dt>Covered calls</dt><dd>" + coveredM + " (" + cmp + " — previous 30 days: " + prevCovered + ")</dd>" +
      "<dt>Total calls</dt><dd>" + callsM.length + "</dd></dl>";
  }
  return h;
}

function viewReports() {
  var closed = Store.state.calls.filter(function (c) { return c.status === "closed"; });
  var h = "<h1>Calls / incidents report</h1><p class=\"muted\">Coordinator and above only. Basic report in this version.</p>" +
    '<button class="btn" data-action="export-csv">Download CSV</button>' +
    '<div class="table-scroll"><table class="stack-narrow"><thead><tr><th>Incident</th><th>Date</th><th>Nature</th><th>Address</th><th>Outcome</th><th>Responders</th></tr></thead><tbody>' +
    closed.map(function (c) { return "<tr><td data-label=\"Incident\">" + esc(c.incident) + "</td><td data-label=\"Date\">" + fmtDT(c.closedAt) + "</td><td data-label=\"Nature\">" + esc(c.nature) + "</td><td data-label=\"Address\">" + esc(c.address) + "</td><td data-label=\"Outcome\">" + esc(outcomeLabel(c.outcome)) + "</td><td data-label=\"Responders\">" + c.responders.map(function (r) { return userName(r.userId); }).join(", ") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  return h;
}

function viewRequests() {
  var h = "<h1>Hidden-data requests</h1><p class=\"muted\">A member may request the caller name + phone without responding, or after a call closes. Any dispatcher approves; the grant lasts 15 min, 30 min, 1 hr, or forever. Requests and grants are logged and visible to the coordinator.</p>";
  var pend = Store.state.hiddenRequests.filter(function (r) { return r.status === "pending"; });
  var done = Store.state.hiddenRequests.filter(function (r) { return r.status !== "pending"; });
  h += "<h2>Pending</h2>" + (pend.length ? pend.map(function (r) {
    var c = Store.call(r.callId);
    return '<article class="card"><h3>' + userName(r.requesterId) + " — " + esc(c ? c.incident : r.callId) + "</h3>" +
      '<p>Fields: ' + esc(r.fields.join(", ")) + "</p>" +
      '<label>Grant duration <select id="dur-' + r.id + '"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="">Forever</option></select></label>' +
      '<button class="btn" data-action="approve-request" data-id="' + r.id + '">Approve</button>' +
      '<button class="btn danger" data-action="deny-request" data-id="' + r.id + '">Deny</button></article>';
  }).join("") : '<p class="empty">No pending requests.</p>');
  h += "<h2>Decided (log)</h2>" + (done.length ? '<div class="table-scroll"><table class="stack-narrow"><thead><tr><th>Who</th><th>Call</th><th>Fields</th><th>Status</th><th>Duration</th><th>Approved by</th><th>Expires</th></tr></thead><tbody>' +
    done.map(function (r) { var c = Store.call(r.callId); return "<tr><td data-label=\"Who\">" + userName(r.requesterId) + "</td><td data-label=\"Call\">" + esc(c ? c.incident : r.callId) + "</td><td data-label=\"Fields\">" + esc(r.fields.join(", ")) + "</td><td data-label=\"Status\">" + esc(r.status) + "</td><td data-label=\"Duration\">" + (r.durationMinutes ? r.durationMinutes + " min" : (r.status === "approved" ? "forever" : "—")) + "</td><td data-label=\"Approved by\">" + (r.approvedBy ? userName(r.approvedBy) : "—") + "</td><td data-label=\"Expires\">" + (r.expiresAt ? fmtDT(r.expiresAt) : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="empty">Nothing yet.</p>');
  h += "<h2>Activity log</h2><ul>" + Store.state.activityLog.slice(0, 30).map(function (a) { return "<li>" + fmtDT(a.at) + " — " + esc(a.text) + "</li>"; }).join("") + "</ul>";
  return h;
}

function viewHistory() {
  var me = Store.me();
  var mine = Store.state.calls.filter(function (c) { return c.status === "closed" && Store.isResponding(c, me.id); });
  var h = "<h1>My call history</h1><p class=\"muted\">Your own past calls. Caller name and number stay hidden after close unless you responded to the call or have an approved grant.</p>";
  h += mine.length ? mine.map(function (c) {
    return '<article class="card"><h3>' + esc(c.incident) + " — " + esc(c.nature) + "</h3>" +
      "<dl class=\"kv\"><dt>Date</dt><dd>" + fmtDT(c.closedAt) + "</dd><dt>Outcome</dt><dd>" + esc(outcomeLabel(c.outcome)) + "</dd>" +
      "<dt>Caller</dt><dd>" + (Store.canSeeCaller(c, me.id) ? esc(c.callerName) + " — " + telLink(c.callerPhone) : "Hidden after close") + "</dd></dl>" +
      '<button class="btn small" data-action="open-call" data-id="' + c.id + '">Open call</button></article>';
  }).join("") : '<p class="empty">No closed calls you responded to yet.</p>';
  return h;
}

/* ----- Manage tab ----- */
function viewManage() {
  var s = Store.state;
  var h = "<h1>Manage</h1><p class=\"muted\">Only the roles allowed to manage each thing see its section.</p>";
  if (Store.can("manage-members")) {
    h += "<h2>Members</h2><button class=\"btn\" data-action=\"member-add\">Add member</button>" +
      '<div class="table-scroll"><table><tr><th>Name</th><th>Role</th><th>Phone</th><th></th></tr>' +
      s.users.map(function (u) { return "<tr><td>" + esc(u.name) + "</td><td>" + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</td><td>" + telLink(u.phone) + "</td><td><button class=\"btn small secondary\" data-action=\"member-edit\" data-id=\"" + u.id + "\">Edit</button></td></tr>"; }).join("") + "</table></div>";
  }
  if (Store.can("manage-natures")) {
    h += "<h2>Call natures</h2><form id=\"nature-add-form\"><label for=\"nature-new\">Add a call nature</label><input type=\"text\" id=\"nature-new\" name=\"name\"><div><button class=\"btn\" type=\"submit\">Add nature</button></div></form>" +
      s.callNatures.map(function (n, i) {
        return '<div class="card">' + esc(n) +
          ' <button class="btn small secondary" data-action="nature-up" data-name="' + esc(n) + '">↑</button>' +
          ' <button class="btn small secondary" data-action="nature-down" data-name="' + esc(n) + '">↓</button>' +
          ' <button class="btn small secondary" data-action="nature-edit" data-name="' + esc(n) + '">Rename</button>' +
          ' <button class="btn small danger" data-action="nature-delete" data-name="' + esc(n) + '">Delete</button></div>';
      }).join("");
  }
  if (Store.can("manage-addresses")) {
    h += "<h2>Saved addresses</h2><form id=\"address-add-form\"><label for=\"addr-new\">Add a saved address</label><input type=\"text\" id=\"addr-new\" name=\"address\"><div><button class=\"btn\" type=\"submit\">Add address</button></div></form>" +
      s.savedAddresses.map(function (a) {
        return '<div class="card">' + esc(a) +
          ' <button class="btn small secondary" data-action="address-edit" data-addr="' + esc(a) + '">Edit</button>' +
          ' <button class="btn small danger" data-action="address-delete" data-addr="' + esc(a) + '">Delete</button>' +
          ' <button class="btn small secondary" data-action="exclude-address" data-addr="' + esc(a) + '">Exclude from history suggestions</button></div>';
      }).join("") || '<p class="empty">No saved addresses yet.</p>';
    h += "<h3>Excluded from history suggestions</h3><p class=\"muted\">Excluded addresses keep their call records, stop being suggested from a caller’s phone-number history, and drive no history-based suggestions for any caller. Normal typeahead while typing is unaffected.</p>" +
      (s.excludedAddresses.length ? s.excludedAddresses.map(function (a) {
        return '<div class="card">' + esc(a) + ' <button class="btn small secondary" data-action="unexclude-address" data-addr="' + esc(a) + '">Remove exclusion</button></div>';
      }).join("") : '<p class="empty">None excluded.</p>');
  }
  if (Store.can("manage-fleet")) {
    h += "<h2>Fleet</h2><form id=\"fleet-add-form\"><label for=\"fleet-new\">Add a vehicle</label><input type=\"text\" id=\"fleet-new\" name=\"name\"><div><button class=\"btn\" type=\"submit\">Add vehicle</button></div></form>" +
      s.fleet.map(function (v) {
        return '<div class="card">' + esc(v.name) + ' <span class="badge">' + (v.active ? "active" : "inactive") + "</span>" +
          ' <button class="btn small secondary" data-action="fleet-edit" data-id="' + v.id + '">Rename</button>' +
          ' <button class="btn small secondary" data-action="fleet-toggle" data-id="' + v.id + '">' + (v.active ? "Deactivate" : "Reactivate") + "</button></div>";
      }).join("") || '<p class="empty">No vehicles yet.</p>';
  }
  if (!Store.can("manage-members") && !Store.can("manage-natures") && !Store.can("manage-addresses") && !Store.can("manage-fleet")) {
    h += "<p>You don’t manage any of these. Inventory management lives on the Equipment tab.</p>";
  }
  return h;
}

/* ----- My data tab ----- */
function viewData() {
  var me = Store.me();
  var canReset = Store.can("data-reset");
  return "<h1>My data</h1>" +
    '<div class="attention"><strong>Test data only.</strong> This prototype runs on your own device with fake seed data. Do not enter real live-dispatch caller or member data here — use invented test data only. Nothing in this app is shared with anyone.</div>' +
    "<h2>Your data vs the fake seed</h2><p>Everything you add or change in this app is stored in your browser (localStorage, keys starting <code>dispatch-mvp-</code>) and survives reloads. The fake seed is only the starting point.</p>" +
    '<button class="btn" data-action="data-export">Export my data (JSON download)</button>' +
    (canReset
      ? '<form id="import-form"><label for="import-file">Import data from a JSON file (replaces everything)</label><input type="file" id="import-file" name="file" accept=".json,application/json"><div><button class="btn" type="submit">Import</button></div></form>' +
        '<button class="btn secondary" data-action="data-reset">Reset to fake seed data</button>' +
        '<button class="btn danger" data-action="data-clear">Clear all my data (blank slate — calls, equipment, addresses, fleet, loans and requests all gone; members stay so you can sign in)</button>'
      : '<p class="muted">Reset, clear and import need a coordinator or super admin.</p>') +
    "<h2>What’s stored right now</h2><dl class=\"kv\">" +
    "<dt>Calls</dt><dd>" + (me.role === "member" ? Store.state.calls.filter(function (c) { return c.status !== "draft"; }).length : Store.state.calls.length) + "</dd><dt>Members</dt><dd>" + Store.state.users.length + "</dd>" +
    "<dt>Call natures</dt><dd>" + Store.state.callNatures.length + "</dd><dt>Saved addresses</dt><dd>" + Store.state.savedAddresses.length + "</dd>" +
    "<dt>Equipment items</dt><dd>" + Store.state.equipment.length + "</dd><dt>Vehicles</dt><dd>" + Store.state.fleet.length + "</dd>" +
    "<dt>Loans</dt><dd>" + Store.state.loans.length + "</dd></dl>";
}

/* ----- dialogs for editing ----- */
function memberFormHTML(m) {
  m = m || { id: "", name: "", phone: "", role: "member", inventoryManager: false, unit: "" };
  // novalidate: native `required` blocks the submit event and Chrome
  // shows no validation bubble inside a <dialog>, so an empty name
  // failed silently (dialog stayed open, no error, no item). JS
  // validation + the inline error slot below handles it instead.
  return "<h2>" + (m.id ? "Edit member" : "Add member") + "</h2><form id=\"member-form\" data-id=\"" + m.id + "\" novalidate>" +
    '<label>Name <input type="text" name="name" value="' + esc(m.name) + '"></label>' +
    '<label>Phone <input type="tel" name="phone" value="' + esc(m.phone) + '" placeholder="At least 7 digits, if entered"></label>' +
    '<label>Unit code <input type="text" name="unit" value="' + esc(m.unit || "") + '" placeholder="Optional — e.g. PA-01 (shown on responder pills)"></label>' +
    '<label>Role <select name="role">' + ["super-admin", "coordinator", "dispatcher", "member"].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + roleLabel(r) + "</option>"; }).join("") + "</select></label>" +
    '<label><input type="checkbox" name="inventoryManager"' + (m.inventoryManager ? " checked" : "") + "> Inventory manager (add-on — keeps member abilities, adds inventory)</label>" +
    '<div id="dlg-error" class="dlg-error" role="alert" hidden></div>' +
    '<div><button class="btn" type="submit">Save member</button> <button class="btn secondary" type="button" data-action="close-dialog">Cancel</button></div></form>';
}
function equipFormHTML(it) {
  it = it || { id: "", name: "", kind: "call-only" };
  // novalidate: see memberFormHTML — native `required` fails silently
  // inside a <dialog> (submit never fires, no bubble shown).
  return "<h2>" + (it.id ? "Edit equipment" : "Add equipment") + "</h2><form id=\"equip-form\" data-id=\"" + it.id + "\" novalidate>" +
    '<label>Item name <input type="text" name="name" value="' + esc(it.name) + '"></label>' +
    '<label>Kind <select name="kind"><option value="call-only"' + (it.kind === "call-only" ? " selected" : "") + '>Call-only</option><option value="loan-only"' + (it.kind === "loan-only" ? " selected" : "") + '>Loan-only</option></select></label>' +
    '<div id="dlg-error" class="dlg-error" role="alert" hidden></div>' +
    '<div><button class="btn" type="submit">Save item</button> <button class="btn secondary" type="button" data-action="close-dialog">Cancel</button></div></form>';
}

// Preserve an in-progress New call form across tab switches (and role
// switches, which also re-render): capture the typed values into
// App.pendingCall when leaving the tab, so returning prefills them
// (viewNewCall already prefills from pendingCall). A draft edit is
// abandoned instead — a manual trip to New call must never silently
// keep editing a draft.
function captureNewCallDraft() {
  if (App.tab !== "new") return;
  if (App.editingDraftId) { App.editingDraftId = null; App.pendingCall = null; return; }
  // The Review summary is showing (submit set idemKey; only confirm
  // or Back-to-edit clears it): leaving now abandons the review, and
  // a manual trip back to New call starts a fresh form — the old rule
  // (16-1 depends on it). Only an in-progress FORM is preserved.
  if (App.idemKey) { App.pendingCall = null; App.idemKey = null; return; }
  var f = document.querySelector("#new-call-form");
  if (!f) return;
  var fd = new FormData(f);
  var data = {
    nature: fd.get("nature") || "", address: (fd.get("address") || "").trim(), vehicle: (fd.get("vehicle") || "").trim(),
    callerName: (fd.get("callerName") || "").trim(), callerPhone: (fd.get("callerPhone") || "").trim(),
    notes: (fd.get("notes") || "").trim(), coordinates: (fd.get("coordinates") || "").trim(),
    mapsLink: (fd.get("mapsLink") || "").trim(), alertKind: fd.get("alertKind") || "normal",
    saveAddress: !!document.querySelector("#nc-save-addr") && document.querySelector("#nc-save-addr").checked
  };
  var hasAny = ["nature", "address", "vehicle", "callerName", "callerPhone", "notes", "coordinates", "mapsLink"].some(function (k) { return data[k]; });
  App.pendingCall = hasAny ? data : null;
}

/* ----- events ----- */
function download(filename, text, type) {
  var blob = new Blob([text], { type: type || "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var a = el.dataset.action, id = el.dataset.id;
  var c, r;
  // Card-body taps open the call; taps on links inside the card (the
  // tap-to-call number, the Call/Maps bar segments) keep their own
  // behaviour instead of opening the dialog.
  if (a === "open-call" && e.target.closest("a")) return;
  // Taps inside the card's inline respond row (ETA input / error
  // text) must not open the call — only the Respond button acts.
  if (a === "open-call" && e.target.closest(".card-respond")) return;
  switch (a) {
    case "menu-open": openMenu(); break;
    case "menu-close": closeMenu(); break;
    case "dismiss-banner": {
      // Dismiss every live alert currently shown; the ids are
      // persisted, so a reload does not resurrect them. The log and
      // activity data are untouched.
      Store.state.dismissedAlerts = Store.state.dismissedAlerts || [];
      (App.bannerAlertIds || []).forEach(function (aid) { if (Store.state.dismissedAlerts.indexOf(aid) === -1) Store.state.dismissedAlerts.push(aid); });
      Store.save(); render(); break;
    }
    case "tab":
      closeMenu();
      // Leaving the New call tab preserves what was typed (a draft
      // edit is abandoned instead — a manual trip to New call must
      // never silently keep editing a draft). Also covers re-tapping
      // the New call tab while on it.
      if (App.tab === "new") captureNewCallDraft();
      App.tab = el.dataset.tab;
      render(); break;
    case "close-dialog": closeDialog(); break;
    case "open-call": c = Store.call(id); if (c) {
      // Drafts are dispatcher+ only (D1): a member must never open
      // one, even if its id is reached some other way.
      if (c.status === "draft" && Store.me().role === "member") { showError("Drafts are only visible to dispatchers and coordinators."); break; }
      openDialog(callDetailHTML(c));
    } break;
    case "add-member": c = Store.call(id); if (c && Store.can("assign")) openDialog(assignPickerHTML(c)); break;
    case "assign-member": r = Store.assign(id, el.dataset.user); if (r.ok) toast("Member assigned to the call."); else showError(r.error); render(); if (r.ok) { c = Store.call(id); if (c) openDialog(assignPickerHTML(c)); } break;
    case "interstate": toast("Interstate button is a placeholder in this prototype — it sends nothing."); break;
    case "backup-request": r = Store.requestBackup(id); if (r.ok) toast("Backup requested — everyone alerted."); else showError(r.error); render(); if (r.ok && $("#dlg").open) { c = Store.call(id); if (c) openDialog(callDetailHTML(c)); } break;
    case "backup-clear": r = Store.clearBackup(id); if (r.ok) toast("Backup cleared."); else showError(r.error); render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    case "unassign": {
      // Two-tap in-app confirm (no native confirm): first tap arms the
      // button, second tap removes the responder.
      if (el.dataset.confirm !== "1") {
        el.dataset.confirm = "1";
        el.textContent = "Tap again to confirm unassign";
        break;
      }
      r = Store.unassign(id, el.dataset.user);
      if (r.ok) toast("Member unassigned."); else showError(r.error);
      render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    }
    case "edit-draft": {
      c = Store.call(id);
      if (c && c.status === "draft" && Store.can("create-call")) {
        App.pendingCall = { nature: c.nature, address: c.address, vehicle: c.vehicle, callerName: c.callerName,
          callerPhone: c.callerPhone, notes: c.notes, coordinates: c.coordinates, mapsLink: c.mapsLink,
          alertKind: c.urgent ? "urgent" : (c.notify ? "normal" : "none"), saveAddress: false };
        App.editingDraftId = c.id; App.idemKey = null;
        App.tab = "new"; closeDialog(); render();
      }
      break;
    }
    case "put-out": r = Store.putOutDraft(id); if (r.ok) { toast("Draft put out — alert sent."); closeDialog(); } else showError(r.error); render(); break;
    case "delete-draft":
      if (confirm("Delete this draft call?")) { r = Store.deleteDraft(id); if (r.ok) toast("Draft deleted."); else toastErr(r.error); closeDialog(); render(); }
      break;
    case "reopen": r = Store.reopenCall(id); if (r.ok) { toast("Call reopened — responses, assignments and equipment stay as they were."); closeDialog(); } else showError(r.error); render(); break;
    case "correct-call": {
      // Confirm step (owner decision 2026-11-17): the checkmark no
      // longer closes instantly. A toast asks which outcome —
      // Corrected / Not corrected / Cancelled — with an × (or a tap
      // elsewhere) to dismiss without choosing. Picking one closes
      // through the same closeCall path (equipment-out still
      // blocks); the Undo toast still follows a successful close.
      c = Store.call(id);
      if (c && Store.can("close")) {
        toastChoices("Close " + c.incident + " as…", [
          { label: "Corrected", value: "Corrected" },
          { label: "Not corrected", value: "NotCorrected" },
          { label: "Cancelled", value: "Cancelled" }
        ], function (outcome) { closeFromToast(id, outcome); });
      }
      break;
    }
    case "card-respond": respondFromCard(id); break;
    // After a request, the open dialog re-renders so the member sees
    // their pending state right away (the "Your request" row) — plus
    // the toast. Without the re-render the detail showed nothing
    // (M1, pass 5): the button looked unchanged and the toast sat
    // behind the dialog overlay.
    case "request-callback": r = Store.requestHidden(id, ["phone"]); if (r.ok) { toast("Request sent — a dispatcher must approve it."); c = Store.call(id); if (c && $("#dlg").open) openDialog(callDetailHTML(c)); } else showError(r.error); break;
    case "request-hidden": r = Store.requestHidden(id, ["name", "phone"]); if (r.ok) { toast("Request sent — a dispatcher must approve it."); c = Store.call(id); if (c && $("#dlg").open) openDialog(callDetailHTML(c)); } else showError(r.error); break;
    case "approve-request": {
      var dur = $("#dur-" + id); var mins = dur && dur.value ? parseInt(dur.value, 10) : null;
      r = Store.approveHidden(id, mins); if (r.ok) toast("Request approved."); else toastErr(r.error); render(); break;
    }
    case "deny-request": r = Store.denyHidden(id); if (r.ok) toast("Request denied."); else toastErr(r.error); render(); break;
    case "checkout": r = Store.checkoutEquipment(el.dataset.item, id); if (r.ok) toast("Equipment checked out on this call."); else showError(r.error); render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    // Return from the call detail (Fix 1) re-renders the open dialog
    // so the "Equipment out" list updates on the same screen — same
    // pattern as checkout/backup. The Equipment page button carries
    // no data-id, so Store.call(undefined) is falsy and nothing extra
    // happens there.
    case "return-equipment": r = Store.returnEquipment(el.dataset.item); if (r.ok) toast("Equipment returned to stock."); else toastErr(r.error); render(); c = Store.call(el.dataset.id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    case "loan-step": r = Store.advanceLoan(id, el.dataset.step); if (r.ok) toast("Loan marked " + el.dataset.step + "."); else toastErr(r.error); render(); break;
    case "eta-location": {
      var note = $("#eta-note"), etaInput = $("#eta");
      if (!navigator.geolocation) { note.textContent = "Location is not available in this browser — type your ETA manually."; break; }
      note.textContent = "Getting your location…";
      navigator.geolocation.getCurrentPosition(function () {
        etaInput.value = "10 min"; note.textContent = "Prefilled from your location (demo estimate: 10 min). Edit it if needed.";
      }, function () { note.textContent = "Location denied or failed — type your ETA manually."; }, { timeout: 8000 });
      break;
    }
    case "confirm-call": {
      if (el.disabled) break; el.disabled = true;
      var data = App.pendingCall; if (!data) { toastErr("Nothing to confirm — fill in the call first."); break; }
      var payload = {
        nature: data.nature, address: data.address, vehicle: data.vehicle, callerName: data.callerName,
        callerPhone: data.callerPhone, notes: data.notes, coordinates: data.coordinates, mapsLink: data.mapsLink,
        urgent: data.alertKind === "urgent", notify: data.alertKind !== "none", saveAddress: data.saveAddress
      };
      if (App.editingDraftId) {
        // Editing a draft: save back to the same draft, never a new call.
        r = Store.updateDraft(App.editingDraftId, payload, el.dataset.status);
        if (r.ok) toast(r.call.status === "draft" ? "Draft saved." : "Draft put out — everyone alerted.");
        else toastErr(r.error);
      } else {
        payload.status = el.dataset.status;
        r = Store.createCall(payload, App.idemKey);
        if (r.ok && r.duplicate) toast("That call was already saved — duplicate ignored.");
        else if (r.ok) toast(r.call.status === "draft" ? "Draft saved — no notifications sent." : "Call put out — everyone alerted.");
        else toastErr(r.error);
      }
      if (r.ok) { App.pendingCall = null; App.idemKey = null; App.editingDraftId = null; App.tab = "calls"; closeDialog(); render(); }
      else el.disabled = false; // let the user fix it and confirm again
      break;
    }
    case "cancel-summary": App.idemKey = null; render(); break; // pendingCall is kept — Back to edit prefills the form
    case "member-add": if (Store.can("manage-members")) openDialog(memberFormHTML(null)); break;
    case "member-edit": { var m = Store.user(id); if (m) openDialog(memberFormHTML(m)); break; }
    case "equip-add": if (Store.can("manage-inventory")) openDialog(equipFormHTML(null)); break;
    case "equip-edit": { var it = Store.item(el.dataset.item); if (it) openDialog(equipFormHTML(it)); break; }
    case "nature-up": r = Store.moveNature(el.dataset.name, -1); if (r.ok) render(); else toastErr(r.error); break;
    case "nature-down": r = Store.moveNature(el.dataset.name, 1); if (r.ok) render(); else toastErr(r.error); break;
    case "nature-edit": {
      var nn = prompt("Rename call nature:", el.dataset.name);
      if (nn !== null) { r = Store.editNature(el.dataset.name, nn); if (r.ok) toast("Nature renamed."); else toastErr(r.error); render(); }
      break;
    }
    case "nature-delete":
      if (confirm("Delete call nature “" + el.dataset.name + "”?")) { r = Store.deleteNature(el.dataset.name); if (r.ok) toast("Nature deleted."); else toastErr(r.error); render(); }
      break;
    case "address-edit": {
      var na = prompt("Edit saved address:", el.dataset.addr);
      if (na !== null) { r = Store.editAddress(el.dataset.addr, na); if (r.ok) toast("Address updated."); else toastErr(r.error); render(); }
      break;
    }
    case "address-delete":
      if (confirm("Delete saved address “" + el.dataset.addr + "”?")) { r = Store.deleteAddress(el.dataset.addr); if (r.ok) toast("Address deleted."); else toastErr(r.error); render(); }
      break;
    case "exclude-address": Store.excludeAddress(el.dataset.addr); toast("Address excluded from history suggestions (records kept)."); render(); break;
    case "unexclude-address": Store.unexcludeAddress(el.dataset.addr); toast("Exclusion removed."); render(); break;
    case "fleet-edit": {
      var nv = prompt("Rename vehicle:", (Store.state.fleet.find(function (v) { return v.id === id; }) || {}).name || "");
      if (nv !== null) { r = Store.renameVehicle(id, nv); if (r.ok) toast("Vehicle renamed."); else toastErr(r.error); render(); }
      break;
    }
    case "fleet-toggle": r = Store.toggleVehicle(id); if (r.ok) toast("Vehicle updated."); else toastErr(r.error); render(); break;
    case "data-export": download("dispatch-mvp-data.json", Store.exportJSON()); toast("Data exported as JSON."); break;
    case "data-reset":
      if (confirm("Reset everything to the fake seed data? Your own entered data will be lost.")) { Store.resetToSeed(); App.tab = "home"; toast("Reset to fake seed data."); render(); }
      break;
    case "data-clear":
      if (confirm("Clear ALL your data? Calls, equipment, addresses, fleet, loans and requests will be gone. Members stay so you can sign in.")) { Store.clearMyData(); App.tab = "home"; toast("All your data cleared — blank slate."); render(); }
      break;
    case "export-csv": {
      var rows = [["Incident", "Date closed", "Nature", "Address", "Outcome", "Responders"]];
      Store.state.calls.filter(function (x) { return x.status === "closed"; }).forEach(function (x) {
        rows.push([x.incident, x.closedAt || "", x.nature, x.address, outcomeLabel(x.outcome), x.responders.map(function (rr) { var u = Store.user(rr.userId); return u ? u.name : ""; }).join("; ")]);
      });
      var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
      download("dispatch-mvp-report.csv", csv, "text/csv"); toast("Report downloaded as CSV."); break;
    }
  }
});

/* Keyboard: Enter/Space on a focused call card opens it, like a tap.
   Escape closes the side menu. */
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { var m = $("#menu"); if (m && !m.hidden) closeMenu(); return; }
  // Enter in a card's inline ETA input responds, like tapping Respond.
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("card-eta")) {
    e.preventDefault();
    respondFromCard(e.target.dataset.call);
    return;
  }
  if ((e.key !== "Enter" && e.key !== " ") || !e.target.classList || !e.target.classList.contains("call-card")) return;
  e.preventDefault();
  var c = Store.call(e.target.dataset.id);
  if (c && !(c.status === "draft" && Store.me().role === "member")) openDialog(callDetailHTML(c));
});

/* ----- forms ----- */
document.addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, fd = new FormData(f);
  var r;
  if (f.id === "new-call-form") {
    var data = {
      nature: fd.get("nature"), address: (fd.get("address") || "").trim(), vehicle: (fd.get("vehicle") || "").trim(),
      callerName: (fd.get("callerName") || "").trim(), callerPhone: (fd.get("callerPhone") || "").trim(),
      notes: (fd.get("notes") || "").trim(), coordinates: (fd.get("coordinates") || "").trim(),
      mapsLink: (fd.get("mapsLink") || "").trim(), alertKind: fd.get("alertKind") || "normal",
      saveAddress: !!$("#nc-save-addr") && $("#nc-save-addr").checked
    };
    var exEl = $("#nc-exclude-addr");
    if (exEl && exEl.checked && data.address) Store.excludeAddress(data.address);
    // Validation errors show inline in the form (this form lives on
    // the main page, not in a dialog) and name exactly the fields
    // that are missing — never the combined "nature, address and
    // caller name are required" that blamed a filled-looking field.
    var ncErr = document.querySelector("#nc-error");
    var showNcErr = function (msg) { if (ncErr) { ncErr.textContent = msg; ncErr.hidden = false; } else toastErr(msg); };
    var reqErr = callRequiredError(data);
    if (reqErr) { showNcErr(reqErr); return; }
    var digits = data.callerPhone.replace(/\D/g, "");
    if (digits.length < 7) { showNcErr("Enter a valid callback number (at least 7 digits)."); return; }
    if (ncErr) ncErr.hidden = true;
    App.pendingCall = data; App.idemKey = uid("key");
    $("#nc-summary").innerHTML = newCallSummary(data);
    $("#nc-summary").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (f.id === "respond-form") {
    r = Store.respond(f.dataset.call, fd.get("eta"));
    if (r.ok) { toast("You are responding — you can now see the caller’s number and call them back."); closeDialog(); render(); }
    else dlgError(r.error, f);
    return;
  }
  if (f.id === "close-form") {
    r = Store.closeCall(f.dataset.call, fd.get("outcome"));
    if (r.ok) { toast("Call closed."); closeDialog(); render(); }
    else dlgError(r.error, f);
    return;
  }
  if (f.id === "loan-form") {
    r = Store.createLoan(fd.get("itemId"), f.dataset.call, fd.get("borrower"), !!f.querySelector('[name="loanAgreed"]').checked);
    if (r.ok) { toast("Loan created."); closeDialog(); render(); }
    else dlgError(r.error, f);
    return;
  }
  if (f.id === "member-form") {
    var mid = f.dataset.id;
    r = mid ? Store.editMember(mid, fd.get("name"), fd.get("phone"), fd.get("role"), !!f.querySelector('[name="inventoryManager"]').checked, fd.get("unit"))
            : Store.addMember(fd.get("name"), fd.get("phone"), fd.get("role"), !!f.querySelector('[name="inventoryManager"]').checked, fd.get("unit"));
    if (r.ok) { toast("Member saved."); closeDialog(); render(); }
    else dlgError(r.error, f);
    return;
  }
  if (f.id === "equip-form") {
    var eid = f.dataset.id;
    r = eid ? Store.editEquipment(eid, fd.get("name"), fd.get("kind")) : Store.addEquipment(fd.get("name"), fd.get("kind"));
    if (r.ok) { toast("Equipment saved."); closeDialog(); render(); }
    else dlgError(r.error, f);
    return;
  }
  if (f.id === "nature-add-form") { r = Store.addNature(fd.get("name")); if (r.ok) { toast("Nature added."); render(); } else toastErr(r.error); return; }
  if (f.id === "address-add-form") { r = Store.addAddress(fd.get("address")); if (r.ok) { toast("Address saved."); render(); } else toastErr(r.error); return; }
  if (f.id === "fleet-add-form") { r = Store.addVehicle(fd.get("name")); if (r.ok) { toast("Vehicle added."); render(); } else toastErr(r.error); return; }
  if (f.id === "import-form") {
    var file = f.querySelector("#import-file").files[0];
    if (!file) { toastErr("Pick a JSON file to import first."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var res = Store.importJSON(reader.result);
      if (res.ok) { toast("Data imported."); render(); }
      else toastErr(res.error);
    };
    reader.readAsText(file);
    return;
  }
});

/* address typeahead + history suggestions (offered, never auto-selected) */
document.addEventListener("input", function (e) {
  if (e.target.id !== "nc-address" && e.target.id !== "nc-phone") return;
  var addr = ($("#nc-address") || {}).value || "";
  var phone = ($("#nc-phone") || {}).value || "";
  var box = $("#nc-suggest"); if (!box) return;
  var sugg = Store.historySuggestions(addr, phone);
  if (!sugg.length || !addr) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="suggest">From past calls here: ' + sugg.map(function (n) {
    return '<button type="button" class="btn small secondary" data-suggest="' + esc(n) + '">' + esc(n) + "</button>";
  }).join("") + ' <span class="muted">(suggestion only — tap to use, or ignore)</span></div>';
});
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-suggest]");
  if (!b) return;
  var sel = $("#nc-nature"); if (sel) sel.value = b.dataset.suggest;
  toast("Suggestion applied: " + b.dataset.suggest);
});

/* ----- init ----- */
// A reload while the dialog or the drawer was open leaves the history
// pointer ON that overlay's entry (the overlay itself is gone — fresh
// page, nothing open). Strip the overlay state from the current entry
// so the push/back discipline above starts clean: without this, the
// stale entry sits under every later push and a back press lands on
// it instead of the page entry, so back stops closing overlays (the
// 20d failure — a section-5 reload with the dialog open stranded the
// pointer, and every later back() hit the stale entry). replaceState
// touches only the current entry; entries further down are plain
// already, so a back press from any later overlay lands on a plain
// entry and closes it.
try {
  if (history.state && history.state.dispatchOverlay) history.replaceState(null, "");
} catch (e) { /* file:// or no history */ }
// Service worker (PWA app shell): register only when supported and
// not on file:// — service workers need a secure origin. A failed
// registration is silent; the app works exactly as before without
// it. The last-used role is already persisted (Store.state.
// currentUserId is saved on every role switch and restored by
// Store.load), so an installed app reopens with the same role.
if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(function () { /* offline shell is best-effort */ });
}
// Dialog close (any cause: button, Escape, programmatic) pops the
// history entry the open pushed, so Android back is never eaten.
$("#dlg").addEventListener("close", function () { syncOverlayHistory("dialog"); });
// The toast body is click-through (pointer-events: none in CSS) so a
// transient toast never swallows a tap meant for a button underneath
// it; only the Undo button inside a toast is tappable. Toasts hide
// on their timer (3.5s, 8s for errors).
$("#role-switch").addEventListener("change", function (e) {
  captureNewCallDraft(); // keep typed New-call values across the re-render
  Store.state.currentUserId = e.target.value; Store.save(); render();
});
$("#reset-demo").addEventListener("click", function () {
  if (confirm("Reset everything to the fake seed data? Your own entered data will be lost.")) { Store.resetToSeed(); App.tab = "home"; toast("Reset to fake seed data."); render(); }
});

Store.load();
render();
// Exposed for automated smoke tests and debugging only.
window.DispatchStore = Store;
window.DispatchApp = App;
})();
