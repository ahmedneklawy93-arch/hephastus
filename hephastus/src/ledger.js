import XLSX from "xlsx";
import { plGroup, isIncome, plTotals, NO_COST_CENTRE } from "./classify.js";

// Reads the daily ledger (دفتر اليومية) exported from the company's accounting
// system as .xls/.xlsx and boils it down to the figures Hephastus shows on the
// Finance screen. Only this summary is kept; the uploaded file is not stored.
//
// Layout of the export (one sheet):
//   col B date (on the first row of each day), col C "code-account name",
//   col D debit, col E credit, col F description, col G entry number,
//   col H source document, col J cost centre, col K approval status.
// Each entry lists leaf accounts and their parent accounts with the same
// amounts, and closes with a "مجموع القيد" total row; each day opens with a
// "مجموع اليوم" total row. Only leaf lines are counted, so nothing is doubled.

const COL = { date: 1, account: 2, debit: 3, credit: 4, description: 5, entry: 6, source: 7, costCentre: 9, approval: 10 };
const DAY_TOTAL = "مجموع اليوم";
const ENTRY_TOTAL = "مجموع القيد";
const APPROVED = "مؤيد";
const UNAPPROVED = "غير مؤيد";

// Balance-sheet account groups, by account code prefix. Income and expenses are grouped by plGroup.
export const GROUPS = {
  customers: "1020201",
  suppliers: "2020101",
  banks: "1020102",
  cash: "1020101",
};

const round = (value) => Math.round(value * 100) / 100;

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function toDate(value) {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const text = (value) => (value === null || value === undefined ? "" : String(value).trim());

// Returns every posting line (parents and leaves) from the workbook.
export function readLedgerLines(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, dense: true });
  } catch {
    throw fail("That file couldn't be opened as an Excel workbook.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const header = rows[0] ?? [];
  if (text(header[COL.account]) !== "الحساب" || text(header[COL.debit]) !== "مدين" || text(header[COL.credit]) !== "دائن") {
    throw fail("This doesn't look like the daily ledger export (expected the columns التاريخ, الحساب, مدين, دائن).");
  }

  const lines = [];
  let date = null;
  for (const row of rows.slice(1)) {
    const rowDate = toDate(row[COL.date]);
    if (rowDate) date = rowDate;
    const account = text(row[COL.account]);
    if (!account || account === DAY_TOTAL || account === ENTRY_TOTAL) continue;
    const dash = account.indexOf("-");
    const code = (dash < 0 ? account : account.slice(0, dash)).trim();
    if (!/^\d+$/.test(code)) continue;
    lines.push({
      date,
      code,
      name: dash < 0 ? "" : account.slice(dash + 1).trim(),
      debit: num(row[COL.debit]),
      credit: num(row[COL.credit]),
      description: text(row[COL.description]),
      entry: text(row[COL.entry]),
      source: text(row[COL.source]),
      costCentre: text(row[COL.costCentre]),
      approval: text(row[COL.approval]),
    });
  }
  if (!lines.length) throw fail("No ledger lines were found in that file.");
  return markLeaves(lines);
}

// A line is a parent when another line in the same entry has a longer code that starts with its code.
function markLeaves(lines) {
  const codesByEntry = new Map();
  for (const line of lines) {
    if (!codesByEntry.has(line.entry)) codesByEntry.set(line.entry, new Set());
    codesByEntry.get(line.entry).add(line.code);
  }
  for (const line of lines) {
    const codes = codesByEntry.get(line.entry);
    line.leaf = ![...codes].some((code) => code !== line.code && code.startsWith(line.code));
  }
  return lines;
}

function bucket() {
  return { revenue: 0, otherIncome: 0, directCosts: 0, overheads: 0 };
}

// Adds one leaf line's effect to a profit-and-loss bucket.
function addToResult(target, line) {
  const group = plGroup(line.code);
  if (group) target[group] += isIncome(group) ? line.credit - line.debit : line.debit - line.credit;
}

const finish = plTotals;

export function summarizeLedger(lines, { fileName = "", importedBy = "", now = new Date() } = {}) {
  const leaves = lines.filter((line) => line.leaf);
  const names = new Map();
  for (const line of lines) if (line.name && !names.has(line.code)) names.set(line.code, line.name);

  const dates = leaves.map((l) => l.date).filter(Boolean).sort();
  const total = bucket();
  const months = new Map();
  const centres = new Map();
  const accounts = new Map();
  const entries = new Map();
  let debit = 0;
  let credit = 0;
  let approved = 0;
  let unapproved = 0;

  for (const line of leaves) {
    debit += line.debit;
    credit += line.credit;
    if (line.approval === APPROVED) approved++;
    if (line.approval === UNAPPROVED) unapproved++;
    addToResult(total, line);

    const month = line.date?.slice(0, 7) ?? "unknown";
    if (!months.has(month)) months.set(month, bucket());
    addToResult(months.get(month), line);

    if (plGroup(line.code)) {
      const name = line.costCentre || NO_COST_CENTRE;
      if (!centres.has(name)) centres.set(name, { ...bucket(), lines: 0 });
      const centre = centres.get(name);
      centre.lines++;
      addToResult(centre, line);
    }

    if (!accounts.has(line.code)) accounts.set(line.code, { code: line.code, name: names.get(line.code) ?? "", debit: 0, credit: 0 });
    const account = accounts.get(line.code);
    account.debit += line.debit;
    account.credit += line.credit;

    if (!entries.has(line.entry)) entries.set(line.entry, { entry: line.entry, date: line.date, source: line.source, difference: 0 });
    entries.get(line.entry).difference += line.debit - line.credit;
  }

  const accountList = [...accounts.values()]
    .map((a) => ({ ...a, debit: round(a.debit), credit: round(a.credit), net: round(a.debit - a.credit) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const group = (prefix) =>
    accountList.filter((a) => a.code.startsWith(prefix)).sort((a, b) => b.debit + b.credit - (a.debit + a.credit));

  // The P&L broken down by the account one level under each group, e.g. 601001 contracting revenue.
  const breakdown = (group) => {
    const sign = isIncome(group) ? -1 : 1;
    const rows = new Map();
    for (const a of accountList) {
      if (plGroup(a.code) !== group) continue;
      // Group under the nearest named parent: 6 digits (e.g. 601001), else 5 (e.g. 50402 mechanical works).
      const key = [6, 5].map((n) => a.code.slice(0, n)).find((k) => names.has(k)) ?? a.code;
      const name = names.get(key) || a.name;
      if (!rows.has(key)) rows.set(key, { code: key, name, amount: 0 });
      rows.get(key).amount += sign * a.net;
    }
    return [...rows.values()].map((r) => ({ ...r, amount: round(r.amount) })).filter((r) => r.amount).sort((a, b) => b.amount - a.amount);
  };

  return {
    importedAt: now.toISOString(),
    importedBy,
    fileName,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    currency: "EGP",
    entries: entries.size,
    lines: leaves.length,
    debit: round(debit),
    credit: round(credit),
    approvedLines: approved,
    unapprovedLines: unapproved,
    unbalancedEntries: [...entries.values()]
      .filter((e) => Math.abs(e.difference) >= 0.01)
      .map((e) => ({ ...e, difference: round(e.difference) })),
    result: finish(total),
    breakdown: {
      revenue: breakdown("revenue"),
      otherIncome: breakdown("otherIncome"),
      directCosts: breakdown("directCosts"),
      overheads: breakdown("overheads"),
    },
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, ...finish(b) })),
    costCentres: [...centres.entries()]
      .map(([name, c]) => ({ name, lines: c.lines, ...finish(c) }))
      .sort((a, b) => b.revenue + b.directCosts + b.overheads - (a.revenue + a.directCosts + a.overheads)),
    customers: group(GROUPS.customers),
    suppliers: group(GROUPS.suppliers),
    banks: group(GROUPS.banks),
    cash: group(GROUPS.cash),
  };
}

export function importLedger(buffer, options) {
  return summarizeLedger(readLedgerLines(buffer), options);
}
