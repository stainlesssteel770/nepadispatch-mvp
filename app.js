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
function $(sel) { return document.querySelector(sel); }
function toast(msg) { var t = $("#toast"); t.textContent = msg; t.hidden = false; setTimeout(function () { t.hidden = true; }, 3500); }

function freshSeed() {
  var s = clone(window.DISPATCH_SEED);
  s.currentUserId = "u-disp";
  s.usedKeys = [];
  s.nextIncident = 1045;
  return s;
}

/* ---------------- Store ---------------- */
var Store = {
  state: null,
  load: function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { this.state = JSON.parse(raw); return; }
    } catch (e) { /* corrupted storage: fall through to seed */ }
    this.state = freshSeed();
    this.save();
  },
  save: function () { try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); } catch (e) { toast("Could not save (storage full or blocked)."); } },
  resetToSeed: function () { this.state = freshSeed(); this.save(); },
  // Clear all user-entered data: blank slate (calls, equipment, fleet,
  // addresses, loans, requests, alerts all gone). Users stay so the
  // role switcher still works; call natures reset to the seed list.
  clearMyData: function () {
    var s = this.state;
    s.calls = []; s.equipment = []; s.fleet = []; s.loans = [];
    s.savedAddresses = []; s.excludedAddresses = [];
    s.hiddenRequests = []; s.alerts = []; s.activityLog = [];
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
  // Caller name/phone visible to: dispatcher/coordinator always; a member
  // only while responding to that call, or with an unexpired approved grant.
  // Super admin (admin-only) does NOT see caller details.
  canSeeCaller: function (call, userId) {
    var me = this.user(userId); if (!me) return false;
    if (me.role === "dispatcher" || me.role === "coordinator") return true;
    if (me.role === "member" && this.isResponding(call, userId)) return true;
    if (this.activeGrant(call.id, userId)) return true;
    return false;
  },
  alertTargets: function () { return this.state.users.filter(function (u) { return u.role !== "super-admin"; }); },

  /* ----- calls ----- */
  createCall: function (data, idemKey) {
    if (idemKey && this.state.usedKeys.indexOf(idemKey) !== -1) {
      var existing = this.state.calls.find(function (c) { return c.idemKey === idemKey; });
      if (existing) return { ok: true, duplicate: true, call: existing };
    }
    if (!data.nature || !data.address || !data.callerName) return { ok: false, error: "Call nature, address and caller name are required." };
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
  respond: function (callId, eta) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    if (c.status !== "open") return { ok: false, error: "Only an open call can be responded to." };
    if (!eta || !eta.trim()) return { ok: false, error: "Enter an ETA first — responding needs an ETA." };
    if (this.isResponding(c, this.me().id)) return { ok: false, error: "You are already responding to this call." };
    c.responders.push({ userId: this.me().id, eta: eta.trim(), at: nowISO() });
    this.log(this.me().name + " responded to " + c.incident + " (ETA " + eta.trim() + ")"); this.save();
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
    this.state.alerts.unshift({ id: uid("a"), callId: c.id, kind: "backup", urgent: c.urgent,
      text: "BACKUP NEEDED on " + c.incident + ": " + c.nature + " at " + c.address, at: nowISO() });
    this.log("Backup requested on " + c.incident + " by " + this.me().name); this.save();
    return { ok: true };
  },
  clearBackup: function (callId) {
    var c = this.call(callId); if (!c) return { ok: false, error: "Call not found." };
    c.backupNeeded = false;
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
    c.status = "closed"; c.outcome = outcome; c.closedAt = nowISO(); c.backupNeeded = false;
    this.log(c.incident + " closed as " + outcome + " by " + this.me().name); this.save();
    return { ok: true };
  },
  reopenCall: function (callId) {
    var c = this.call(callId); if (!c || c.status !== "closed") return { ok: false, error: "Only a closed call can be reopened." };
    c.status = "open"; c.outcome = null; c.closedAt = null; // responders, assignments and equipment stay as they were
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
  addMember: function (name, phone, role, inventoryManager) {
    if (!name || !name.trim()) return { ok: false, error: "Member name is required." };
    if (["super-admin", "coordinator", "dispatcher", "member"].indexOf(role) === -1) return { ok: false, error: "Pick a valid role." };
    var m = { id: uid("u"), name: name.trim(), phone: phone || "", role: role, inventoryManager: !!inventoryManager };
    this.state.users.push(m); this.log("Member added: " + m.name + " (" + role + ")"); this.save();
    return { ok: true, member: m };
  },
  editMember: function (id, name, phone, role, inventoryManager) {
    var m = this.user(id); if (!m) return { ok: false, error: "Member not found." };
    if (!name || !name.trim()) return { ok: false, error: "Member name is required." };
    m.name = name.trim(); m.phone = phone || ""; m.role = role; m.inventoryManager = !!inventoryManager;
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
var App = { tab: "home", pendingCall: null, idemKey: null };

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
  route: svg('<polygon points="3 11 22 2 13 21 11 13 3 11"/>')
};
// Call card, reference layout: big address + incident/time on top,
// icon-led rows (what / phone / notes), responder pills, then a
// 5-icon action bar — Add, Backup, Correct, Call, Maps. Only the
// actions the signed-in role may use are shown (hide, don't disable).
// The whole card is tappable: tapping anywhere on the card body opens
// the call detail (the card itself carries data-action="open-call");
// taps on action-bar buttons/links keep their own behaviour — the
// document click handler ignores link taps that bubble to the card.
function callCard(c) {
  var me = Store.me();
  var isOpen = c.status === "open";
  var responding = Store.isResponding(c, me.id);
  var canSee = Store.canSeeCaller(c, me.id);
  var badges = [];
  if (c.urgent) badges.push('<span class="badge urgent">URGENT</span>');
  if (c.backupNeeded) badges.push('<span class="badge backup">BACKUP NEEDED</span>');
  if (c.status === "draft") badges.push('<span class="badge draft">DRAFT</span>');
  if (c.status === "closed") badges.push('<span class="badge closed">CLOSED — ' + esc(c.outcome || "") + '</span>');
  var time = new Date(c.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  var pills = c.responders.length
    ? c.responders.map(function (r) { var u = Store.user(r.userId); return '<span class="pill">' + esc(u ? u.name.split(" ")[0] : "?") + "</span>"; }).join("")
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
    bar += '<button class="bar-seg act-correct" data-action="correct-call" data-id="' + c.id + '" aria-label="Close this call as Corrected">' + ICONS.check + "<span>Correct</span></button>";
  }
  if (canSee) {
    bar += '<a class="bar-seg" href="tel:' + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + '" aria-label="Call the caller back">' + ICONS.phone + "<span>Call</span></a>";
  }
  bar += '<a class="bar-seg" href="' + esc(mapsUrl) + '" target="_blank" rel="noopener" aria-label="Open address in Maps">' + ICONS.route + "<span>Maps</span></a></div>";
  return '<article class="card call-card' + (c.urgent && isOpen ? " urgent" : "") + (c.backupNeeded ? " backup" : "") + '" data-action="open-call" data-id="' + c.id + '" tabindex="0" role="button" aria-label="Open ' + esc(c.incident) + ' — ' + esc(c.nature) + '">' +
    '<div class="card-head"><div class="card-addr"><span class="pin">' + ICONS.pin + "</span>" + esc(c.address) + '</div>' +
    '<div class="card-inc">' + esc(c.incident) + '<span class="time">' + esc(time) + "</span></div>" +
    '<span class="card-chev" aria-hidden="true">' + ICONS.chev + "</span></div>" +
    (badges.length ? '<div class="badges">' + badges.join(" ") + "</div>" : "") +
    '<div class="card-row"><span class="ic">' + ICONS.info + '</span><span class="val"><strong>' + esc(c.nature) + "</strong>" +
    (c.vehicle ? ' · <span class="veh">' + esc(c.vehicle) + "</span>" : "") + "</span></div>" +
    (canSee
      ? '<div class="card-row"><span class="ic">' + ICONS.phone + '</span><span class="val"><strong>' + esc(c.callerName) + '</strong> — <a href="tel:' + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + '">' + esc(c.callerPhone) + "</a></span></div>"
      : '<div class="card-row"><span class="ic">' + ICONS.phone + '</span><span class="val dim">Caller hidden — visible only while you are responding to this call, or with an approved grant.</span></div>') +
    (c.notes ? '<div class="card-row"><span class="ic">' + ICONS.clip + '</span><span class="val note">' + esc(c.notes) + "</span></div>" : "") +
    '<div class="pills">' + pills + "</div>" + bar +
    "</article>";
}

function tabsFor() {
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

function render() {
  var me = Store.me();
  var sel = $("#role-switch");
  sel.innerHTML = Store.state.users.map(function (u) {
    return '<option value="' + u.id + '"' + (u.id === me.id ? " selected" : "") + ">" + esc(u.name) + " — " + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</option>";
  }).join("");
  var tabs = tabsFor();
  if (!tabs.some(function (t) { return t[0] === App.tab; })) App.tab = "home";
  $("#tabs").innerHTML = tabs.map(function (t) {
    return '<button data-action="tab" data-tab="' + t[0] + '"' + (App.tab === t[0] ? ' aria-current="true"' : "") + ">" + esc(t[1]) + "</button>";
  }).join("");
  // In-app alert banner (all org members except super admin)
  var banner = $("#alert-banner");
  if (me.role === "super-admin") { banner.hidden = true; }
  else {
    var recent = Store.state.alerts.slice(0, 2);
    if (recent.length) {
      banner.hidden = false;
      banner.className = "alert-banner" + (recent.some(function (a) { return a.urgent; }) ? " urgent" : "");
      banner.innerHTML = recent.map(function (a) { return "<div>" + esc(a.text) + "</div>"; }).join("");
    } else banner.hidden = true;
  }
  var v = $("#view");
  var fn = { home: viewHome, calls: viewCalls, new: viewNewCall, equipment: viewEquipment, manage: viewManage,
    contacts: viewContacts, dashboard: viewDashboard, reports: viewReports, requests: viewRequests,
    history: viewHistory, data: viewData }[App.tab] || viewHome;
  v.innerHTML = fn();
}

function viewHome() {
  var me = Store.me();
  var open = Store.state.calls.filter(function (c) { return c.status === "open"; });
  var mine = open.filter(function (c) { return Store.isResponding(c, me.id); });
  var needMe = open.filter(function (c) { return !Store.isResponding(c, me.id); });
  var backup = open.filter(function (c) { return c.backupNeeded; });
  var h = "<h1>What needs my attention</h1>";
  h += '<p class="muted">Signed in as <strong>' + esc(me.name) + "</strong> (" + roleLabel(me.role) + (me.inventoryManager ? " + inventory manager" : "") + "). " +
    "This is a test prototype on your own device — <strong>do not enter real live-dispatch caller or member data</strong>; test data only.</p>";
  if (backup.length) h += '<div class="attention"><strong>Backup needed:</strong> ' + backup.map(function (c) { return esc(c.incident) + " — " + esc(c.nature); }).join("; ") + "</div>";
  if (mine.length) h += "<h2>My calls right now</h2>" + mine.map(callCard).join("");
  else h += "<p>You are not responding to any call right now.</p>";
  if (needMe.length && (me.role === "member" || me.role === "coordinator")) {
    h += "<h2>Open calls needing a response</h2>" + needMe.map(callCard).join("");
  } else if (me.role === "dispatcher" || me.role === "coordinator") {
    h += "<h2>Open calls</h2>" + (open.length ? open.map(callCard).join("") : "<p>No open calls.</p>");
  } else if (me.role === "super-admin") {
    h += "<h2>Open calls</h2>" + (open.length ? open.map(callCard).join("") : "<p>No open calls.</p>");
  }
  return h;
}

function viewCalls() {
  var h = "<h1>Calls</h1><p class=\"muted\">List only — no map view in this version.</p>";
  var open = Store.state.calls.filter(function (c) { return c.status !== "closed"; });
  var closed = Store.state.calls.filter(function (c) { return c.status === "closed"; });
  h += "<h2>Open &amp; drafts</h2>" + (open.length ? open.map(callCard).join("") : "<p>No open calls.</p>");
  h += "<h2>Closed</h2>" + (closed.length ? closed.map(callCard).join("") : "<p>No closed calls yet.</p>");
  return h;
}

function viewNewCall() {
  var s = Store.state;
  var opts = s.callNatures.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
  var h = "<h1>New call</h1>";
  h += '<form id="new-call-form">' +
    '<label for="nc-nature">Call nature</label><select id="nc-nature" name="nature">' + opts + "</select>" +
    '<label for="nc-address">Address</label><input type="text" id="nc-address" name="address" list="addr-list" placeholder="Start typing an address…" autocomplete="off">' +
    '<datalist id="addr-list">' + s.savedAddresses.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("") + "</datalist>" +
    '<div id="nc-suggest"></div>' +
    '<label for="nc-vehicle">Vehicle (car type)</label><input type="text" id="nc-vehicle" name="vehicle" placeholder="e.g. Honda Accord">' +
    '<label for="nc-name">Caller name</label><input type="text" id="nc-name" name="callerName">' +
    '<label for="nc-phone">Callback number</label><input type="tel" id="nc-phone" name="callerPhone" placeholder="555-0100">' +
    '<label for="nc-notes">Notes</label><textarea id="nc-notes" name="notes"></textarea>' +
    '<label for="nc-coords">Coordinates (optional)</label><input type="text" id="nc-coords" name="coordinates" placeholder="e.g. 41.2743, -75.8835">' +
    '<label for="nc-maps">Google Maps link (optional — paste a link)</label><input type="text" id="nc-maps" name="mapsLink" placeholder="https://maps.google.com/…">' +
    '<fieldset><legend>Alert</legend>' +
    '<label><input type="radio" name="alertKind" value="normal" checked> Normal — alert everyone in the org</label>' +
    '<label><input type="radio" name="alertKind" value="urgent"> Urgent — different sound/vibration, bypasses the app’s own night mute (in this prototype: shown as urgent)</label>' +
    '<label><input type="radio" name="alertKind" value="none"> Don’t notify — create silently</label></fieldset>' +
    '<label><input type="checkbox" id="nc-save-addr"> Save this address for next time</label>' +
    '<label><input type="checkbox" id="nc-exclude-addr"> Exclude this address from history suggestions</label>' +
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
function openDialog(html) { $("#dlg-body").innerHTML = html; var d = $("#dlg"); if (!d.open) d.showModal(); }
function closeDialog() { var d = $("#dlg"); if (d.open) d.close(); }

function callDetailHTML(c) {
  var me = Store.me();
  var canSee = Store.canSeeCaller(c, me.id);
  var responding = Store.isResponding(c, me.id);
  var grant = Store.activeGrant(c.id, me.id);
  var h = "<h2>" + esc(c.incident) + " — " + esc(c.nature) + "</h2>";
  h += '<dl class="kv"><dt>Status</dt><dd>' + esc(c.status) + (c.outcome ? " (" + esc(c.outcome) + ")" : "") + "</dd>" +
    "<dt>Address</dt><dd>" + esc(c.address) + "</dd>" +
    "<dt>Vehicle</dt><dd>" + esc(c.vehicle || "—") + "</dd>" +
    "<dt>Coordinates</dt><dd>" + esc(c.coordinates || "—") + "</dd>" +
    "<dt>Maps link</dt><dd>" + (c.mapsLink ? '<a href="' + esc(c.mapsLink) + '" target="_blank" rel="noopener">' + esc(c.mapsLink) + "</a>" : "—") + "</dd>" +
    "<dt>Notes</dt><dd>" + esc(c.notes || "—") + "</dd>";
  if (canSee) {
    h += "<dt>Caller</dt><dd>" + esc(c.callerName) + " — <a href=\"tel:" + esc(c.callerPhone.replace(/[^0-9+]/g, "")) + "\">" + esc(c.callerPhone) + "</a> (tap to call back)</dd>";
  } else {
    h += "<dt>Caller</dt><dd class=\"muted\">Hidden. Visible only while you are responding to this call, or with an approved grant.</dd>";
  }
  if (grant) h += "<dt>Your grant</dt><dd>Approved access until " + (grant.expiresAt ? fmtDT(grant.expiresAt) : "forever") + ".</dd>";
  h += "<dt>Responding</dt><dd>" + (c.responders.length ? c.responders.map(function (r) { return userName(r.userId) + " (ETA " + esc(r.eta) + ")"; }).join(", ") : "No one yet") + "</dd>";
  h += "<dt>Backup</dt><dd>" + (c.backupNeeded ? "NEEDED" : "Not needed") + "</dd>";
  h += "<dt>Equipment out</dt><dd>" + (c.equipmentOut.length ? c.equipmentOut.map(function (id) { var it = Store.item(id); return it ? esc(it.name) : id; }).join(", ") : "None") + "</dd></dl>";

  if (c.status === "open") {
    if ((me.role === "member" || me.role === "coordinator") && !responding) {
      h += '<h3>Respond</h3><form id="respond-form" data-call="' + c.id + '">' +
        '<label for="eta">ETA (required)</label><input type="text" id="eta" name="eta" placeholder="e.g. 15 min">' +
        '<button class="btn secondary" type="button" data-action="eta-location">Use my location to prefill ETA</button>' +
        '<div id="eta-note" class="muted"></div>' +
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
    if ((me.role === "member" || me.role === "coordinator") && !responding && !canSee) {
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
          '<div><button class="btn secondary" type="submit">Create loan</button></div></form>';
      }
    }
    if (Store.can("close")) {
      h += "<h3>Close this call</h3><form id=\"close-form\" data-call=\"" + c.id + "\">" +
        OUTCOMES.map(function (o) { return '<label><input type="radio" name="outcome" value="' + o + '"' + (o === "Corrected" ? " checked" : "") + "> " + o + "</label>"; }).join("") +
        '<div><button class="btn danger" type="submit">Close call</button></div></form>';
    }
    h += '<button class="btn secondary" data-action="interstate">Interstate (placeholder — sends nothing)</button>';
  }
  if (c.status === "draft" && Store.can("create-call")) {
    h += '<button class="btn" data-action="put-out" data-id="' + c.id + '">Put out this draft</button>' +
      '<button class="btn danger" data-action="delete-draft" data-id="' + c.id + '">Delete draft</button>';
  }
  if (c.status === "closed") {
    if (Store.can("reopen")) h += '<button class="btn" data-action="reopen" data-id="' + c.id + '">Reopen call (responses, assignments and equipment stay as they were)</button>';
    if (me.role === "member") h += '<button class="btn secondary" data-action="request-hidden" data-id="' + c.id + '">Request caller name + phone (dispatcher approval needed)</button>';
  }
  h += '<div><button class="btn secondary" data-action="close-dialog">Close</button></div>';
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
  }).join("") || "<p>No equipment yet — add some.</p>";
  h += "<h2>Loans</h2>";
  h += Store.state.loans.length ? Store.state.loans.map(function (l) {
    var it = Store.item(l.itemId);
    var steps = ["released", "picked-up", "returned", "closed"];
    return '<article class="card"><h3>Loan — ' + esc(it ? it.name : l.itemId) + ' to ' + esc(l.borrower) + ' <span class="badge">' + esc(l.status) + "</span></h3>" +
      '<p class="muted">Loan agreed: ' + (l.loanAgreed ? "yes" : "no") + " · Created " + fmtDT(l.createdAt) + "</p>" +
      steps.map(function (s) { return '<button class="btn small secondary" data-action="loan-step" data-id="' + l.id + '" data-step="' + s + '">Mark ' + s + "</button>"; }).join("") +
      "</article>";
  }).join("") : "<p>No loans yet.</p>";
  return h;
}

function viewContacts() {
  return "<h1>Contacts</h1><p class=\"muted\">Members see other members’ names and phone numbers.</p>" +
    '<table><tr><th>Name</th><th>Role</th><th>Phone</th></tr>' +
    Store.state.users.map(function (u) { return "<tr><td>" + esc(u.name) + "</td><td>" + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</td><td>" + esc(u.phone) + "</td></tr>"; }).join("") + "</table>";
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
    '<table><tr><th>Incident</th><th>Date</th><th>Nature</th><th>Address</th><th>Outcome</th><th>Responders</th></tr>' +
    closed.map(function (c) { return "<tr><td>" + esc(c.incident) + "</td><td>" + fmtDT(c.closedAt) + "</td><td>" + esc(c.nature) + "</td><td>" + esc(c.address) + "</td><td>" + esc(c.outcome || "") + "</td><td>" + c.responders.map(function (r) { return userName(r.userId); }).join(", ") + "</td></tr>"; }).join("") + "</table>";
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
  }).join("") : "<p>No pending requests.</p>");
  h += "<h2>Decided (log)</h2>" + (done.length ? '<table><tr><th>Who</th><th>Call</th><th>Fields</th><th>Status</th><th>Duration</th><th>Approved by</th><th>Expires</th></tr>' +
    done.map(function (r) { var c = Store.call(r.callId); return "<tr><td>" + userName(r.requesterId) + "</td><td>" + esc(c ? c.incident : r.callId) + "</td><td>" + esc(r.fields.join(", ")) + "</td><td>" + esc(r.status) + "</td><td>" + (r.durationMinutes ? r.durationMinutes + " min" : (r.status === "approved" ? "forever" : "—")) + "</td><td>" + (r.approvedBy ? userName(r.approvedBy) : "—") + "</td><td>" + (r.expiresAt ? fmtDT(r.expiresAt) : "—") + "</td></tr>"; }).join("") + "</table>" : "<p>Nothing yet.</p>");
  h += "<h2>Activity log</h2><ul>" + Store.state.activityLog.slice(0, 30).map(function (a) { return "<li>" + fmtDT(a.at) + " — " + esc(a.text) + "</li>"; }).join("") + "</ul>";
  return h;
}

function viewHistory() {
  var me = Store.me();
  var mine = Store.state.calls.filter(function (c) { return c.status === "closed" && Store.isResponding(c, me.id); });
  var h = "<h1>My call history</h1><p class=\"muted\">Your own past calls. Caller name and number stay hidden after close unless you have an approved grant.</p>";
  h += mine.length ? mine.map(function (c) {
    return '<article class="card"><h3>' + esc(c.incident) + " — " + esc(c.nature) + "</h3>" +
      "<dl class=\"kv\"><dt>Date</dt><dd>" + fmtDT(c.closedAt) + "</dd><dt>Outcome</dt><dd>" + esc(c.outcome || "") + "</dd>" +
      "<dt>Caller</dt><dd>" + (Store.canSeeCaller(c, me.id) ? esc(c.callerName) + " — " + esc(c.callerPhone) : "Hidden after close") + "</dd></dl>" +
      '<button class="btn small" data-action="open-call" data-id="' + c.id + '">Open call</button></article>';
  }).join("") : "<p>No closed calls you responded to yet.</p>";
  return h;
}

/* ----- Manage tab ----- */
function viewManage() {
  var s = Store.state;
  var h = "<h1>Manage</h1><p class=\"muted\">Only the roles allowed to manage each thing see its section.</p>";
  if (Store.can("manage-members")) {
    h += "<h2>Members</h2><button class=\"btn\" data-action=\"member-add\">Add member</button>" +
      '<table><tr><th>Name</th><th>Role</th><th>Phone</th><th></th></tr>' +
      s.users.map(function (u) { return "<tr><td>" + esc(u.name) + "</td><td>" + roleLabel(u.role) + (u.inventoryManager ? " + inventory" : "") + "</td><td>" + esc(u.phone) + "</td><td><button class=\"btn small secondary\" data-action=\"member-edit\" data-id=\"" + u.id + "\">Edit</button></td></tr>"; }).join("") + "</table>";
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
      }).join("") || "<p>No saved addresses yet.</p>";
    h += "<h3>Excluded from history suggestions</h3><p class=\"muted\">Excluded addresses keep their call records, stop being suggested from a caller’s phone-number history, and drive no history-based suggestions for any caller. Normal typeahead while typing is unaffected.</p>" +
      (s.excludedAddresses.length ? s.excludedAddresses.map(function (a) {
        return '<div class="card">' + esc(a) + ' <button class="btn small secondary" data-action="unexclude-address" data-addr="' + esc(a) + '">Remove exclusion</button></div>';
      }).join("") : "<p>None excluded.</p>");
  }
  if (Store.can("manage-fleet")) {
    h += "<h2>Fleet</h2><form id=\"fleet-add-form\"><label for=\"fleet-new\">Add a vehicle</label><input type=\"text\" id=\"fleet-new\" name=\"name\"><div><button class=\"btn\" type=\"submit\">Add vehicle</button></div></form>" +
      s.fleet.map(function (v) {
        return '<div class="card">' + esc(v.name) + ' <span class="badge">' + (v.active ? "active" : "inactive") + "</span>" +
          ' <button class="btn small secondary" data-action="fleet-edit" data-id="' + v.id + '">Rename</button>' +
          ' <button class="btn small secondary" data-action="fleet-toggle" data-id="' + v.id + '">' + (v.active ? "Deactivate" : "Reactivate") + "</button></div>";
      }).join("") || "<p>No vehicles yet.</p>";
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
    "<dt>Calls</dt><dd>" + Store.state.calls.length + "</dd><dt>Members</dt><dd>" + Store.state.users.length + "</dd>" +
    "<dt>Call natures</dt><dd>" + Store.state.callNatures.length + "</dd><dt>Saved addresses</dt><dd>" + Store.state.savedAddresses.length + "</dd>" +
    "<dt>Equipment items</dt><dd>" + Store.state.equipment.length + "</dd><dt>Vehicles</dt><dd>" + Store.state.fleet.length + "</dd>" +
    "<dt>Loans</dt><dd>" + Store.state.loans.length + "</dd></dl>";
}

/* ----- dialogs for editing ----- */
function memberFormHTML(m) {
  m = m || { id: "", name: "", phone: "", role: "member", inventoryManager: false };
  return "<h2>" + (m.id ? "Edit member" : "Add member") + "</h2><form id=\"member-form\" data-id=\"" + m.id + "\">" +
    '<label>Name <input type="text" name="name" value="' + esc(m.name) + '" required></label>' +
    '<label>Phone <input type="tel" name="phone" value="' + esc(m.phone) + '"></label>' +
    '<label>Role <select name="role">' + ["super-admin", "coordinator", "dispatcher", "member"].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + roleLabel(r) + "</option>"; }).join("") + "</select></label>" +
    '<label><input type="checkbox" name="inventoryManager"' + (m.inventoryManager ? " checked" : "") + "> Inventory manager (add-on — keeps member abilities, adds inventory)</label>" +
    '<div><button class="btn" type="submit">Save member</button> <button class="btn secondary" type="button" data-action="close-dialog">Cancel</button></div></form>';
}
function equipFormHTML(it) {
  it = it || { id: "", name: "", kind: "call-only" };
  return "<h2>" + (it.id ? "Edit equipment" : "Add equipment") + "</h2><form id=\"equip-form\" data-id=\"" + it.id + "\">" +
    '<label>Item name <input type="text" name="name" value="' + esc(it.name) + '" required></label>' +
    '<label>Kind <select name="kind"><option value="call-only"' + (it.kind === "call-only" ? " selected" : "") + '>Call-only</option><option value="loan-only"' + (it.kind === "loan-only" ? " selected" : "") + '>Loan-only</option></select></label>' +
    '<div><button class="btn" type="submit">Save item</button> <button class="btn secondary" type="button" data-action="close-dialog">Cancel</button></div></form>';
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
  switch (a) {
    case "tab": App.tab = el.dataset.tab; render(); break;
    case "close-dialog": closeDialog(); break;
    case "open-call": c = Store.call(id); if (c) openDialog(callDetailHTML(c)); break;
    case "add-member": c = Store.call(id); if (c && Store.can("assign")) openDialog(assignPickerHTML(c)); break;
    case "assign-member": r = Store.assign(id, el.dataset.user); toast(r.ok ? "Member assigned to the call." : r.error); render(); if (r.ok) { c = Store.call(id); if (c) openDialog(assignPickerHTML(c)); } break;
    case "interstate": toast("Interstate button is a placeholder in this prototype — it sends nothing."); break;
    case "backup-request": r = Store.requestBackup(id); toast(r.ok ? "Backup requested — everyone alerted." : r.error); render(); if (r.ok && $("#dlg").open) { c = Store.call(id); if (c) openDialog(callDetailHTML(c)); } break;
    case "backup-clear": r = Store.clearBackup(id); toast(r.ok ? "Backup cleared." : r.error); render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    case "unassign": r = Store.unassign(id, el.dataset.user); toast(r.ok ? "Member unassigned." : r.error); render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    case "put-out": r = Store.putOutDraft(id); toast(r.ok ? "Draft put out — alert sent." : r.error); closeDialog(); render(); break;
    case "delete-draft":
      if (confirm("Delete this draft call?")) { r = Store.deleteDraft(id); toast(r.ok ? "Draft deleted." : r.error); closeDialog(); render(); }
      break;
    case "reopen": r = Store.reopenCall(id); toast(r.ok ? "Call reopened — responses, assignments and equipment stay as they were." : r.error); closeDialog(); render(); break;
    case "correct-call": r = Store.closeCorrect(id); toast(r.ok ? "Call closed as Corrected." : r.error); render(); break;
    case "request-callback": r = Store.requestHidden(id, ["phone"]); toast(r.ok ? "Request sent — a dispatcher must approve it." : r.error); break;
    case "request-hidden": r = Store.requestHidden(id, ["name", "phone"]); toast(r.ok ? "Request sent — a dispatcher must approve it." : r.error); break;
    case "approve-request": {
      var dur = $("#dur-" + id); var mins = dur && dur.value ? parseInt(dur.value, 10) : null;
      r = Store.approveHidden(id, mins); toast(r.ok ? "Request approved." : r.error); render(); break;
    }
    case "deny-request": r = Store.denyHidden(id); toast(r.ok ? "Request denied." : r.error); render(); break;
    case "checkout": r = Store.checkoutEquipment(el.dataset.item, id); toast(r.ok ? "Equipment checked out on this call." : r.error); render(); c = Store.call(id); if (c && r.ok && $("#dlg").open) openDialog(callDetailHTML(c)); break;
    case "return-equipment": r = Store.returnEquipment(el.dataset.item); toast(r.ok ? "Equipment returned to stock." : r.error); render(); break;
    case "loan-step": r = Store.advanceLoan(id, el.dataset.step); toast(r.ok ? "Loan marked " + el.dataset.step + "." : r.error); render(); break;
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
      var data = App.pendingCall; if (!data) { toast("Nothing to confirm — fill in the call first."); break; }
      r = Store.createCall({
        nature: data.nature, address: data.address, vehicle: data.vehicle, callerName: data.callerName,
        callerPhone: data.callerPhone, notes: data.notes, coordinates: data.coordinates, mapsLink: data.mapsLink,
        urgent: data.alertKind === "urgent", notify: data.alertKind !== "none", status: el.dataset.status,
        saveAddress: data.saveAddress
      }, App.idemKey);
      if (r.ok && r.duplicate) toast("That call was already saved — duplicate ignored.");
      else if (r.ok) toast(r.call.status === "draft" ? "Draft saved — no notifications sent." : "Call put out — everyone alerted.");
      else toast(r.error);
      App.pendingCall = null; App.idemKey = null; App.tab = "calls"; closeDialog(); render();
      break;
    }
    case "cancel-summary": App.pendingCall = null; App.idemKey = null; render(); break;
    case "member-add": if (Store.can("manage-members")) openDialog(memberFormHTML(null)); break;
    case "member-edit": { var m = Store.user(id); if (m) openDialog(memberFormHTML(m)); break; }
    case "equip-add": if (Store.can("manage-inventory")) openDialog(equipFormHTML(null)); break;
    case "equip-edit": { var it = Store.item(el.dataset.item); if (it) openDialog(equipFormHTML(it)); break; }
    case "nature-up": r = Store.moveNature(el.dataset.name, -1); if (!r.ok) toast(r.error); render(); break;
    case "nature-down": r = Store.moveNature(el.dataset.name, 1); if (!r.ok) toast(r.error); render(); break;
    case "nature-edit": {
      var nn = prompt("Rename call nature:", el.dataset.name);
      if (nn !== null) { r = Store.editNature(el.dataset.name, nn); toast(r.ok ? "Nature renamed." : r.error); render(); }
      break;
    }
    case "nature-delete":
      if (confirm("Delete call nature “" + el.dataset.name + "”?")) { r = Store.deleteNature(el.dataset.name); toast(r.ok ? "Nature deleted." : r.error); render(); }
      break;
    case "address-edit": {
      var na = prompt("Edit saved address:", el.dataset.addr);
      if (na !== null) { r = Store.editAddress(el.dataset.addr, na); toast(r.ok ? "Address updated." : r.error); render(); }
      break;
    }
    case "address-delete":
      if (confirm("Delete saved address “" + el.dataset.addr + "”?")) { r = Store.deleteAddress(el.dataset.addr); toast(r.ok ? "Address deleted." : r.error); render(); }
      break;
    case "exclude-address": Store.excludeAddress(el.dataset.addr); toast("Address excluded from history suggestions (records kept)."); render(); break;
    case "unexclude-address": Store.unexcludeAddress(el.dataset.addr); toast("Exclusion removed."); render(); break;
    case "fleet-edit": {
      var nv = prompt("Rename vehicle:", (Store.state.fleet.find(function (v) { return v.id === id; }) || {}).name || "");
      if (nv !== null) { r = Store.renameVehicle(id, nv); toast(r.ok ? "Vehicle renamed." : r.error); render(); }
      break;
    }
    case "fleet-toggle": r = Store.toggleVehicle(id); toast(r.ok ? "Vehicle updated." : r.error); render(); break;
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
        rows.push([x.incident, x.closedAt || "", x.nature, x.address, x.outcome || "", x.responders.map(function (rr) { var u = Store.user(rr.userId); return u ? u.name : ""; }).join("; ")]);
      });
      var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
      download("dispatch-mvp-report.csv", csv, "text/csv"); toast("Report downloaded as CSV."); break;
    }
  }
});

/* Keyboard: Enter/Space on a focused call card opens it, like a tap. */
document.addEventListener("keydown", function (e) {
  if ((e.key !== "Enter" && e.key !== " ") || !e.target.classList || !e.target.classList.contains("call-card")) return;
  e.preventDefault();
  var c = Store.call(e.target.dataset.id);
  if (c) openDialog(callDetailHTML(c));
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
    if (!data.nature || !data.address || !data.callerName) { toast("Call nature, address and caller name are required."); return; }
    var digits = data.callerPhone.replace(/\D/g, "");
    if (digits.length < 7) { toast("Enter a valid callback number (at least 7 digits)."); return; }
    App.pendingCall = data; App.idemKey = uid("key");
    $("#nc-summary").innerHTML = newCallSummary(data);
    $("#nc-summary").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (f.id === "respond-form") {
    r = Store.respond(f.dataset.call, fd.get("eta"));
    toast(r.ok ? "You are responding — you can now see the caller’s number and call them back." : r.error);
    if (r.ok) { closeDialog(); render(); }
    return;
  }
  if (f.id === "close-form") {
    r = Store.closeCall(f.dataset.call, fd.get("outcome"));
    toast(r.ok ? "Call closed." : r.error);
    if (r.ok) { closeDialog(); render(); }
    return;
  }
  if (f.id === "loan-form") {
    r = Store.createLoan(fd.get("itemId"), f.dataset.call, fd.get("borrower"), !!f.querySelector('[name="loanAgreed"]').checked);
    toast(r.ok ? "Loan created." : r.error);
    if (r.ok) { closeDialog(); render(); }
    return;
  }
  if (f.id === "member-form") {
    var mid = f.dataset.id;
    r = mid ? Store.editMember(mid, fd.get("name"), fd.get("phone"), fd.get("role"), !!f.querySelector('[name="inventoryManager"]').checked)
            : Store.addMember(fd.get("name"), fd.get("phone"), fd.get("role"), !!f.querySelector('[name="inventoryManager"]').checked);
    toast(r.ok ? "Member saved." : r.error);
    if (r.ok) { closeDialog(); render(); }
    return;
  }
  if (f.id === "equip-form") {
    var eid = f.dataset.id;
    r = eid ? Store.editEquipment(eid, fd.get("name"), fd.get("kind")) : Store.addEquipment(fd.get("name"), fd.get("kind"));
    toast(r.ok ? "Equipment saved." : r.error);
    if (r.ok) { closeDialog(); render(); }
    return;
  }
  if (f.id === "nature-add-form") { r = Store.addNature(fd.get("name")); toast(r.ok ? "Nature added." : r.error); if (r.ok) render(); return; }
  if (f.id === "address-add-form") { r = Store.addAddress(fd.get("address")); toast(r.ok ? "Address saved." : r.error); if (r.ok) render(); return; }
  if (f.id === "fleet-add-form") { r = Store.addVehicle(fd.get("name")); toast(r.ok ? "Vehicle added." : r.error); if (r.ok) render(); return; }
  if (f.id === "import-form") {
    var file = f.querySelector("#import-file").files[0];
    if (!file) { toast("Pick a JSON file to import first."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var res = Store.importJSON(reader.result);
      toast(res.ok ? "Data imported." : res.error);
      if (res.ok) render();
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
$("#role-switch").addEventListener("change", function (e) {
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
