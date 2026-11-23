import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { connectMemory } from "../src/gl/db.js";
import { createLedger } from "../src/gl/service.js";
import { createReports } from "../src/gl/reports.js";
import { importErpLedger } from "../src/gl/import.js";
import { createServer } from "../src/server.js";

const owner = { username: "admin", role: "admin" };

async function books() {
  const db = await connectMemory();
  const ledger = createLedger(db);
  for (const [code, nameEn, parent] of [["1", "Assets"], ["1001", "Bank", "1"], ["2", "Liabilities"], ["2001", "Supplier", "2"],
    ["5", "Expenses"], ["5001", "Pipes", "5"], ["6", "Revenue"], ["6001", "Contracting", "6"]]) {
    await ledger.saveAccount({ code, nameEn, parent }, owner, { create: true });
  }
  const site = await ledger.saveCostCentre({ name: "Hospital", projectCode: "MUH" }, owner);
  return { db, ledger, reports: createReports(db), site };
}
const entry = (date, lines, extra = {}) => ({ date, type: "journal", description: "test", lines, ...extra });
const line = (accountCode, debit, credit, costCentreId = null) => ({ accountCode, debit, credit, costCentreId });

test("posting needs balanced lines on detail accounts in an open month", async () => {
  const { ledger, db } = await books();
  await assert.rejects(ledger.saveDraft(entry("2026-03-01", [line("1", 10, 0), line("6001", 0, 10)]), owner), /group account/);
  await assert.rejects(ledger.saveDraft(entry("2026-03-01", [line("1001", 10, 5), line("6001", 0, 10)]), owner), /either a debit or a credit/);
  await assert.rejects(ledger.saveDraft(entry("2026-03-01", [line("9999", 10, 0), line("6001", 0, 10)]), owner), /doesn't exist/);
  const draft = await ledger.saveDraft(entry("2026-03-01", [line("1001", 100, 0), line("6001", 0, 90)]), owner);
  await assert.rejects(ledger.post(draft.id, owner), /don't match/);
  const fixed = await ledger.saveDraft(entry("2026-03-01", [line("1001", 100.1, 0), line("6001", 0, 100.1)]), owner, draft.id);
  const posted = await ledger.post(fixed.id, owner);
  assert.equal(posted.status, "posted");
  await assert.rejects(ledger.saveDraft(entry("2026-03-02", [line("1001", 1, 0), line("6001", 0, 1)]), owner, posted.id), /Only drafts/);
  // Locking the month blocks changes; a reversal goes in an open month instead.
  await ledger.setLock("2026-03", true, owner);
  await assert.rejects(ledger.voidEntry(posted.id, "mistake", owner), /locked/);
  await assert.rejects(ledger.saveDraft(entry("2026-03-15", [line("1001", 1, 0), line("6001", 0, 1)]), owner), /locked/);
  const reversal = await ledger.reverse(posted.id, "2026-04-01", owner);
  assert.deepEqual(reversal.lines.map((l) => [l.accountCode, l.debit, l.credit]), [["1001", 0, 100.1], ["6001", 100.1, 0]]);
  const approved = await ledger.approve(posted.id, owner);
  assert.equal(approved.approvedBy, "admin");
  const actions = (await ledger.auditLog()).map((a) => a.action);
  for (const action of ["create", "update", "post", "lock", "reverse", "approve"]) assert.ok(actions.includes(action), action);
  await db.close();
});

test("reports balance: trial balance, income statement, balance sheet, statement and cost centres", async () => {
  const { ledger, reports, site, db } = await books();
  const post = async (date, lines) => ledger.post((await ledger.saveDraft(entry(date, lines), owner)).id, owner);
  await post("2026-01-10", [line("1001", 1000, 0), line("6001", 0, 1000, site)]);
  await post("2026-02-05", [line("5001", 300, 0, site), line("2001", 0, 300)]);
  await post("2026-02-20", [line("2001", 300, 0), line("1001", 0, 300)]);
  await ledger.saveDraft(entry("2026-02-21", [line("5001", 999, 0), line("1001", 0, 999)]), owner); // drafts never count
  const tb = await reports.trialBalance({ from: "2026-02-01", to: "2026-02-28" });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.accounts.find((a) => a.code === "1001").opening, 1000);
  assert.equal(tb.accounts.find((a) => a.code === "1001").closing, 700);
  const is = await reports.incomeStatement({ from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual([is.totals.revenue, is.totals.expenses, is.totals.result], [1000, 300, 700]);
  assert.deepEqual(is.months, ["2026-01", "2026-02"]);
  const bs = await reports.balanceSheet({ at: "2026-12-31" });
  assert.deepEqual([bs.totals.assets, bs.totals.liabilities, bs.totals.result, bs.totals.difference], [700, 0, 700, 0]);
  const st = await reports.accountStatement({ code: "1001", from: "2026-02-01", to: "2026-12-31" });
  assert.deepEqual([st.opening, st.closing, st.lines.length], [1000, 700, 1]);
  const cc = await reports.costCentres({ from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual([cc.costCentres[0].revenue, cc.costCentres[0].overheads, cc.costCentres[0].result], [1000, 300, 700]);
  const accounts = await ledger.listAccounts();
  assert.equal(accounts.find((a) => a.code === "1").balance, 700); // parents roll up their sub-accounts
  await db.close();
});

function erpExport(rows) {
  const header = [null, "التاريخ", "الحساب", "مدين", "دائن", "الشرح", "الرقم", "الأصل", "رقمه", "مركز التكلفة", "مؤيد"];
  const out = [header, []];
  for (const [date, entries] of rows) {
    out.push([null, new Date(`${date}T00:00:00Z`), "مجموع اليوم", 0, 0]);
    for (const [no, source, lines] of entries) for (const [acc, dr, cr, cc, ok] of lines) out.push([null, null, acc, dr, cr, "شرح", no, source, null, cc ?? null, ok ?? "غير مؤيد"]);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(out), "Sheet1");
  return XLSX.write(book, { type: "buffer", bookType: "biff8" });
}
const payment = [2440, "سند صرف نقدية", [["5-مصروفات", 500, 0], ["5001-مواسير", 500, 0, "مستشفى", "مؤيد"], ["1001-البنك", 0, 500], ["1-الأصول", 0, 500]]];
const invoice = [2441, "فاتورة مبيعات", [["1001-البنك", 2000, 0], ["6001-إيرادات المقاولات", 0, 2000, "مستشفى"]]];
const broken = [2442, "سند قيد يومية", [["5001-مواسير", 100, 0], ["1001-البنك", 0, 75]]];

test("ERP import builds the chart, keeps ERP numbers, is safe to repeat and reports vanished entries", async () => {
  const db = await connectMemory();
  const ledger = createLedger(db), reports = createReports(db);
  const first = await importErpLedger(ledger, erpExport([["2026-01-05", [payment, invoice, broken]]]), owner);
  assert.deepEqual([first.added, first.accountsAdded, first.costCentresAdded, first.drafts.length], [3, 5, 1, 1]);
  const accounts = await ledger.listAccounts();
  assert.equal(accounts.find((a) => a.code === "5").postable, false);
  assert.equal(accounts.find((a) => a.code === "5001").parent, "5");
  const { entries } = await ledger.listEntries({});
  assert.deepEqual(entries.map((e) => [e.number, e.type, e.status]).sort(), [[2440, "payment", "posted"], [2441, "sales", "posted"], [2442, "journal", "draft"]]);
  assert.equal(entries.find((e) => e.number === 2440).approvedBy, "ERP");
  assert.equal((await reports.trialBalance({ from: "2026-01-01", to: "2026-12-31" })).totals.debit, 2500);

  const again = await importErpLedger(ledger, erpExport([["2026-01-05", [payment, invoice, broken]]]), owner);
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 3]);

  // The invoice changed in the ERP and the payment vanished; January then gets locked.
  const changed = [2441, "فاتورة مبيعات", [["1001-البنك", 2500, 0], ["6001-إيرادات المقاولات", 0, 2500, "مستشفى"]]];
  const third = await importErpLedger(ledger, erpExport([["2026-01-05", [changed, broken]]]), owner);
  assert.deepEqual([third.updated, third.missing.map((m) => m.erpNumber)], [1, ["2440"]]);
  assert.equal((await ledger.listEntries({})).entries.length, 3); // nothing deleted
  await ledger.post((await ledger.listEntries({ status: "draft" })).entries[0].id, owner).catch(() => {});
  await ledger.voidEntry((await ledger.listEntries({ status: "draft" })).entries[0].id, "fixing in ERP", owner);
  await ledger.setLock("2026-01", true, owner);
  const fourth = await importErpLedger(ledger, erpExport([["2026-01-05", [invoice]]]), owner);
  assert.deepEqual(fourth.lockedConflicts.map((c) => c.erpNumber), ["2441"]);
  await db.close();
});

test("only the owner reaches accounting, and it says so when no database is set", async () => {
  const memory = () => {
    const c = {}; let h = [];
    return { getHistory: async () => h, setHistory: async (x) => { h = x; }, getFacts: async () => [], setFacts: async () => {},
      getCollection: async (n) => structuredClone(c[n] ?? []), setCollection: async (n, v) => { c[n] = structuredClone(v); } };
  };
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const run = async (gl, fn) => {
    const server = createServer({ password: "pw", sessionSecret: "s", store: memory(), assistant: {}, gl, log: { error() {} } });
    await new Promise((r) => server.listen(0, r));
    try { await fn(`http://localhost:${server.address().port}`); } finally { server.close(); }
  };
  const login = async (base, username, password) =>
    (await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];

  await run(null, async (base) => {
    const admin = await login(base, "admin", "pw");
    assert.equal((await fetch(`${base}/api/gl/accounts`, { headers: { Cookie: admin } })).status, 503);
  });
  const { ledger, reports, db } = await books();
  await run({ ledger, reports }, async (base) => {
    const admin = await login(base, "admin", "pw");
    await fetch(`${base}/api/users`, json({ username: "omar", displayName: "Omar", role: "manager", password: "office-pass-1" }, admin));
    const manager = await login(base, "omar", "office-pass-1");
    assert.equal((await fetch(`${base}/api/gl/accounts`, { headers: { Cookie: manager } })).status, 403);
    const state = await (await fetch(`${base}/api/state`, { headers: { Cookie: admin } })).json();
    assert.equal(state.me.accounting, "ready");
    const created = await fetch(`${base}/api/gl/entries`, json(entry("2026-05-01", [line("1001", 50, 0), line("6001", 0, 50)]), admin));
    assert.equal(created.status, 201);
    const { entry: e } = await created.json();
    assert.equal((await fetch(`${base}/api/gl/entries/${e.id}/post`, json({}, admin))).status, 200);
    const tb = await (await fetch(`${base}/api/gl/reports/trial-balance?from=2026-01-01&to=2026-12-31`, { headers: { Cookie: admin } })).json();
    assert.equal(tb.totals.debit, 50);
    assert.equal((await fetch(`${base}/api/gl/reports/trial-balance?from=bad`, { headers: { Cookie: admin } })).status, 400);
  });
  await db.close();
});

test("an ERP account statement is checked line by line against the books", async () => {
  const { reconcileStatement } = await import("../src/gl/statement.js");
  const db = await connectMemory();
  const ledger = createLedger(db);
  await importErpLedger(ledger, erpExport([["2026-01-05", [payment, invoice]]]), owner);
  const head = [null, "التاريخ", "الحساب", "الشرح", "مدين", "دائن", "الرصيد", "الرقم", "الأصل", "رقمه", "العملة الأصلية", "الحساب المقابل", "مركز التكلفة", "مؤيد", "مراجع", "مرحل"];
  const day = (d) => new Date(`${d}T00:00:00Z`);
  const rows = [head,
    [null, null, "5001-مواسير", "الرصيد الحالي", 1700, 0, 1700],
    [null, null, null, "الرصيد السابق", 1000, 0, 1000],
    [null, day("2026-01-05"), null, "شراء", 500, 0, 1500, 2440, "سند صرف نقدية", 7, "جنيه مصري", null, "مستشفى", "مؤيد", "لم يراجع", "مرحل"],
    [null, day("2026-01-05"), null, "مكرر؟", 150, 0, 1650, 2441, "سند قيد يومية", null, "جنيه مصري", null, null, "غير مؤيد", null, "مرحل"],
    [null, day("2026-02-01"), null, "جديد", 50, 0, 1700, 2500, "سند صرف نقدية", 8, "جنيه مصري", null, null, "مؤيد", "مراجع", "مرحل"]];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const check = await reconcileStatement(ledger, XLSX.write(book, { type: "buffer", bookType: "biff8" }));
  assert.deepEqual([check.lines, check.matched, check.reviewed, check.approved], [3, 1, 1, 2]);
  assert.deepEqual([check.newer.count, check.newer.amount], [1, 50]);
  assert.deepEqual([check.missing.count, check.missing.lines[0].entry], [1, "2441"]);
  assert.deepEqual(check.carriedForward, [{ code: "5001", name: "مواسير", previous: 1000 }]);
  await assert.rejects(reconcileStatement(ledger, erpExport([["2026-01-05", [payment]]])), /account statement/);
  await db.close();
});
