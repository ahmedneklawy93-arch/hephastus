import { readLedgerLines } from "../ledger.js";
import { accountType } from "./schema.js";

// Loads the old ERP's daily ledger export into the general ledger. Safe to run
// again each week while both systems are in use:
// - accounts and cost centres that are new are added;
// - each ERP entry is kept once, by its ERP number (source_ref "ERP-<no>");
// - an entry that changed in the ERP is replaced, unless its month is locked here;
// - an entry that is no longer in the export is reported, never deleted.
// Entries whose debits and credits don't match are loaded as drafts to fix by hand.

const TYPES = { "سند صرف نقدية": "payment", "سند قبض نقدية": "receipt", "فاتورة مشتريات": "purchase", "فاتورة مبيعات": "sales" };
const APPROVED = "مؤيد";
const cents = (v) => Math.round(Number(v) * 100);

// A line with both sides zero carries nothing; the database refuses it, so it is left out everywhere.
const real = (lines) => lines.filter((l) => cents(l.debit) > 0 || cents(l.credit) > 0);

function fingerprint(lines) {
  return real(lines).map((l) => `${l.code}|${cents(l.debit)}|${cents(l.credit)}|${l.costCentre}|${l.description}`).sort().join("\n");
}

export async function importErpLedger(ledger, buffer, user) {
  const all = readLedgerLines(buffer);
  const leaves = all.filter((l) => l.leaf && l.date);
  const names = new Map();
  for (const l of all) if (l.name && !names.has(l.code)) names.set(l.code, l.name);
  const codes = [...names.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const parentOf = (code) => codes.filter((c) => c !== code && code.startsWith(c)).sort((a, b) => b.length - a.length)[0] ?? null;
  const hasChildren = new Set(codes.map(parentOf).filter(Boolean));

  const entries = new Map();
  for (const l of leaves) {
    if (!entries.has(l.entry)) entries.set(l.entry, []);
    entries.get(l.entry).push(l);
  }
  const dates = leaves.map((l) => l.date).sort();
  const report = { from: dates[0], to: dates.at(-1), accountsAdded: 0, costCentresAdded: 0, added: 0, updated: 0, unchanged: 0, drafts: [], lockedConflicts: [], missing: [] };

  await ledger.db.tx(async (q) => {
    // Accounts, parents first.
    const existing = new Map((await q("SELECT code, postable FROM gl_accounts")).map((a) => [a.code, a]));
    for (const code of codes) {
      const parent = parentOf(code);
      if (!existing.has(code)) {
        await q("INSERT INTO gl_accounts (code, name_ar, parent_code, type, postable) VALUES ($1,$2,$3,$4,$5)",
          [code, names.get(code), parent, accountType(code), !hasChildren.has(code)]);
        existing.set(code, { code, postable: !hasChildren.has(code) });
        report.accountsAdded++;
      } else if (hasChildren.has(code) && existing.get(code).postable) {
        const [used] = await q("SELECT 1 FROM gl_lines WHERE account_code = $1 LIMIT 1", [code]);
        if (!used) await q("UPDATE gl_accounts SET postable = false WHERE code = $1", [code]);
      }
    }
    // Cost centres.
    const centres = new Map((await q("SELECT id, name FROM gl_cost_centres")).map((c) => [c.name, c.id]));
    for (const name of new Set(leaves.map((l) => l.costCentre).filter(Boolean))) {
      if (centres.has(name)) continue;
      const [row] = await q("INSERT INTO gl_cost_centres (name) VALUES ($1) RETURNING id", [name]);
      centres.set(name, row.id);
      report.costCentresAdded++;
    }

    const locked = new Set((await q("SELECT month FROM gl_periods WHERE locked")).map((p) => p.month));
    const usedNumbers = new Set((await q("SELECT number FROM gl_entries")).map((r) => r.number));
    const known = new Map();
    for (const r of await q(`SELECT e.id, e.source_ref, e.date, string_agg(l.account_code || '|' || (l.debit*100)::bigint || '|' || (l.credit*100)::bigint || '|' || COALESCE(c.name,'') || '|' || l.description, E'\\n' ORDER BY l.account_code, l.debit, l.credit) AS fp
      FROM gl_entries e JOIN gl_lines l ON l.entry_id = e.id LEFT JOIN gl_cost_centres c ON c.id = l.cost_centre_id
      WHERE e.source_ref LIKE 'ERP-%' GROUP BY e.id`)) known.set(r.source_ref, r);
    let next = Math.max(0, ...usedNumbers) + 1;

    for (const [erpNo, lines] of entries) {
      const ref = `ERP-${erpNo}`;
      const date = lines[0].date;
      const fp = fingerprint(lines);
      const old = known.get(ref);
      if (old) {
        const oldFp = String(old.fp).split("\n").sort().join("\n");
        if (oldFp === fp) { report.unchanged++; continue; }
        const oldMonth = (old.date instanceof Date ? old.date.toISOString() : String(old.date)).slice(0, 7);
        if (locked.has(oldMonth) || locked.has(date.slice(0, 7))) { report.lockedConflicts.push({ erpNumber: erpNo, date }); continue; }
        await q("DELETE FROM gl_entries WHERE id = $1", [old.id]);
        report.updated++;
      } else {
        if (locked.has(date.slice(0, 7))) { report.lockedConflicts.push({ erpNumber: erpNo, date }); continue; }
        report.added++;
      }
      const debit = lines.reduce((s, l) => s + cents(l.debit), 0), credit = lines.reduce((s, l) => s + cents(l.credit), 0);
      const balanced = debit === credit;
      if (!balanced) report.drafts.push({ erpNumber: erpNo, date, difference: (debit - credit) / 100 });
      let number = Number(erpNo);
      if (!Number.isInteger(number) || number <= 0 || usedNumbers.has(number)) number = next++;
      usedNumbers.add(number);
      const approved = lines.some((l) => l.approval === APPROVED);
      const [row] = await q(`INSERT INTO gl_entries (number, date, type, description, status, created_by, posted_by, posted_at, approved_by, approved_at, source_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [number, date, TYPES[lines[0].source] ?? "journal", lines.find((l) => l.description)?.description ?? "",
          balanced ? "posted" : "draft", `erp-import:${user.username}`, balanced ? "erp-import" : null, balanced ? new Date() : null,
          approved ? "ERP" : null, approved ? new Date() : null, ref]);
      const kept = real(lines), params = [];
      kept.forEach((l, i) => params.push(row.id, i + 1, l.code, cents(l.debit) / 100, cents(l.credit) / 100, l.description, l.costCentre ? centres.get(l.costCentre) : null));
      if (kept.length) {
        await q(`INSERT INTO gl_lines (entry_id, line_no, account_code, debit, credit, description, cost_centre_id) VALUES ${
          kept.map((_, i) => `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4},$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`).join(",")}`, params);
      }
    }

    // ERP entries we hold for this period that the new export no longer has.
    for (const [ref, r] of known) {
      const d = (r.date instanceof Date ? r.date.toISOString() : String(r.date)).slice(0, 10);
      if (d >= report.from && d <= report.to && !entries.has(ref.slice(4))) report.missing.push({ erpNumber: ref.slice(4), date: d });
    }
    await q("INSERT INTO gl_audit (username, action, entity, detail) VALUES ($1,'import','ledger',$2)",
      [user.username, JSON.stringify({ ...report, drafts: report.drafts.length, lockedConflicts: report.lockedConflicts.length, missing: report.missing.length })]);
  });
  return report;
}
