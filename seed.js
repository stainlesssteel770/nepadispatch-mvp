/* Dispatch MVP — fake seed data (STATIC PROTOTYPE ONLY).
   All people, callers, phone numbers (555-xxxx), and addresses are
   invented for testing. No real personal data. */
window.DISPATCH_SEED = {
  org: { id: "org-1", name: "Chaverim of NEPA (Demo Org)" },
  callNatures: ["Flat Tire", "Dead Battery / Jump Start", "Lockout", "Out of Fuel", "Tow Needed", "Other"],
  users: [
    { id: "u-super", name: "Sam Admin", role: "super-admin", phone: "555-0001", inventoryManager: false, unit: "" },
    { id: "u-coord", name: "Rivka Coordinator", role: "coordinator", phone: "555-0002", inventoryManager: false, unit: "PA-01" },
    { id: "u-disp", name: "Dana Dispatcher", role: "dispatcher", phone: "555-0003", inventoryManager: false, unit: "PA-02" },
    { id: "u-m1", name: "Moishe Member", role: "member", phone: "555-0011", inventoryManager: false, unit: "PA-05" },
    { id: "u-m2", name: "Yossi Member", role: "member", phone: "555-0012", inventoryManager: false, unit: "PA-09" },
    { id: "u-m3", name: "Levi Member", role: "member", phone: "555-0013", inventoryManager: true, unit: "PA-19" },
    { id: "u-m4", name: "Shmuel Member", role: "member", phone: "555-0014", inventoryManager: false, unit: "PA-21" }
  ],
  savedAddresses: [
    "100 Main St, Kingston, PA",
    "45 Market St, Wilkes-Barre, PA",
    "12 River Rd, Pittston, PA",
    "200 Wyoming Ave, Kingston, PA"
  ],
  // Excluded from history-based suggestions (records are kept; normal
  // typeahead while typing is unaffected; does not cross organisations).
  excludedAddresses: ["300 Mall Dr, Wilkes-Barre, PA"],
  fleet: [
    { id: "v1", name: "Ford Transit", active: true },
    { id: "v2", name: "Honda Accord", active: true },
    { id: "v3", name: "Pickup Truck", active: false }
  ],
  equipment: [
    { id: "e1", name: "Jump starter pack", kind: "call-only", status: "in-stock", callId: null, checkedOutBy: null },
    { id: "e2", name: "Hydraulic jack", kind: "call-only", status: "out-on-call", callId: "c1", checkedOutBy: "u-m1" },
    { id: "e3", name: "Tire inflator", kind: "call-only", status: "in-stock", callId: null, checkedOutBy: null },
    { id: "e4", name: "Flashlight set", kind: "call-only", status: "in-stock", callId: null, checkedOutBy: null },
    { id: "e5", name: "Lockout kit", kind: "call-only", status: "in-stock", callId: null, checkedOutBy: null },
    { id: "e6", name: "Spare tire (loan)", kind: "loan-only", status: "out-on-loan", callId: "c4", checkedOutBy: "u-m2" }
  ],
  loans: [
    { id: "l1", itemId: "e6", callId: "c4", borrower: "Dana Demo", loanAgreed: true, status: "picked-up", createdAt: "2026-11-10T10:00:00" }
  ],
  calls: [
    {
      id: "c1", incident: "INC-1042", nature: "Flat Tire", status: "open",
      address: "100 Main St, Kingston, PA", vehicle: "Honda Accord",
      callerName: "Avi Demo", callerPhone: "555-0101",
      notes: "Front right tire flat, spare in trunk.",
      coordinates: "", mapsLink: "", urgent: false, notify: true,
      createdAt: "2026-11-17T14:20:00", closedAt: null, outcome: null,
      responders: [{ userId: "u-m1", eta: "15 min", at: "2026-11-17T14:25:00" }],
      backupNeeded: false, equipmentOut: ["e2"]
    },
    {
      id: "c2", incident: "INC-1043", nature: "Dead Battery / Jump Start", status: "open",
      address: "45 Market St, Wilkes-Barre, PA", vehicle: "Toyota Camry",
      callerName: "Ben Demo", callerPhone: "555-0102",
      notes: "Car will not start, lights dim.",
      coordinates: "", mapsLink: "", urgent: true, notify: true,
      createdAt: "2026-11-17T15:05:00", closedAt: null, outcome: null,
      responders: [], backupNeeded: false, equipmentOut: []
    },
    {
      id: "c3", incident: "INC-1044", nature: "Lockout", status: "draft",
      address: "12 River Rd, Pittston, PA", vehicle: "Ford F-150",
      callerName: "Chaim Demo", callerPhone: "555-0103",
      notes: "Keys locked in truck.",
      coordinates: "", mapsLink: "", urgent: false, notify: false,
      createdAt: "2026-11-17T15:30:00", closedAt: null, outcome: null,
      responders: [], backupNeeded: false, equipmentOut: []
    },
    {
      id: "c4", incident: "INC-1039", nature: "Out of Fuel", status: "closed",
      address: "200 Wyoming Ave, Kingston, PA", vehicle: "Nissan Altima",
      callerName: "Dana Demo", callerPhone: "555-0104",
      notes: "Ran out of gas on the highway.",
      coordinates: "", mapsLink: "", urgent: false, notify: true,
      createdAt: "2026-11-10T09:00:00", closedAt: "2026-11-10T09:50:00", outcome: "Corrected",
      responders: [{ userId: "u-m2", eta: "20 min", at: "2026-11-10T09:10:00" }],
      backupNeeded: false, equipmentOut: []
    },
    {
      id: "c5", incident: "INC-1038", nature: "Flat Tire", status: "closed",
      address: "100 Main St, Kingston, PA", vehicle: "Chevy Malibu",
      callerName: "Eli Demo", callerPhone: "555-0105",
      notes: "Caller cancelled before anyone arrived.",
      coordinates: "", mapsLink: "", urgent: false, notify: true,
      createdAt: "2026-11-09T18:00:00", closedAt: "2026-11-09T18:20:00", outcome: "Cancelled",
      responders: [], backupNeeded: false, equipmentOut: []
    }
  ],
  hiddenRequests: [
    { id: "r1", callId: "c4", requesterId: "u-m2", fields: ["name", "phone"], status: "approved", durationMinutes: 60, approvedBy: "u-disp", approvedAt: "2026-11-10T10:00:00", expiresAt: "2026-11-10T11:00:00" }
  ],
  alerts: [
    { id: "a1", callId: "c1", kind: "call", urgent: false, text: "New call INC-1042: Flat Tire at 100 Main St, Kingston, PA", at: "2026-11-17T14:20:00" },
    { id: "a2", callId: "c2", kind: "call", urgent: true, text: "URGENT call INC-1043: Dead Battery at 45 Market St, Wilkes-Barre, PA", at: "2026-11-17T15:05:00" }
  ],
  activityLog: [
    { at: "2026-11-17T14:20:00", text: "INC-1042 created by Dana Dispatcher" },
    { at: "2026-11-17T14:25:00", text: "Moishe Member responded to INC-1042 (ETA 15 min)" }
  ]
};
