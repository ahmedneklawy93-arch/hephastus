import { accountType } from "./schema.js";

// General ledger operations. Every write runs in one transaction and leaves a
// row in gl_audit. Amounts are handled in piastres (integers) in JavaScript and
// numeric(18,2) in the database, so sums never drift.

export const ENTRY_TYPES = ["journal", "payment", "receipt", "purchase", "sales", "opening"];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cents = (value) => Math.round(Number(value) * 100);
const money = (c) => Math.round(c) / 100;
const num = (value) => Number(value ?? 0);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const text = (v, max = 500) => String(v ?? "").trim().slice(0, max);

async function audit(q, user, action, entity, entityId, detail = null) {
  await q("INSERT INTO gl_audit (username, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)",
    [user.username, action, entity, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null]);
}

async function assertOpen(q, date) {
  const [period] = await q("SELECT locked FROM gl_periods WHERE month = $1", [String(date).slice(0, 7)]);
  if (period?.locked) throw fail(`${String(date).slice(0, 7)} is locked. Unlock the month first.`);
}

const dateOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function shapeEntry(row, lines = []) {
  return {
    id: row.id, number: row.number, date: dateOf(row.date), type: row.type, description: row.description,
    status: row.status, approvedBy: row.approved_by, createdBy: row.created_by, postedBy: row.posted_by,
    voidReason: row.void_reason, reverses: row.reverses, sourceRef: row.source_ref,
    debit: num(row.debit), credit: num(row.credit),
    lines: lines.map((l) => ({
      lineNo: l.line_no, accountCode: l.account_code, accountName: l.name_ar || l.name_en || "",
      debit: num(l.debit), credit: num(l.credit), description: l.description,
      costCentreId: l.cost_centre_id, costCentre: l.cost_centre ?? null,
    })),
  };
}

export function createLedger(db) {
  // ---------- Accounts ----------
  async function listAccounts() {
    const rows = await db.query(`
      SELECT a.*, COALESCE(s.debit,0) AS debit, COALESCE(s.credit,0) AS credit
      FROM gl_accounts a
      LEFT JOIN (SELECT l.account_code, SUM(l.debit) AS debit, SUM(l.credit) AS credit FROM gl_lines l
        JOIN gl_entries e ON e.id = l.entry_id AND e.status = 'posted' GROUP BY l.account_code) s ON s.account_code = a.code
      ORDER BY a.code`);
    // Roll leaf balances up to their parents.
    const byCode = new Map(rows.map((r) => [r.code, { code: r.code, nameAr: r.name_ar, nameEn: r.name_en, parent: r.parent_code,
      type: r.type, postable: r.postable, active: r.active, debit: cents(r.debit), credit: cents(r.credit) }]));
    for (const a of [...byCode.values()]) {
      if (!a.postable) continue;
      let p = a.parent;
      while (p && byCode.has(p)) { const parent = byCode.get(p); parent.debit += a.debit; parent.credit += a.credit; p = parent.parent; }
    }
    return [...byCode.values()].map((a) => ({ ...a, debit: money(a.debit), credit: money(a.credit), balance: money(a.debit - a.credit) }));
  }

  async function saveAccount(input, user, { create }) {
    const code = text(input.code, 30);
    if (!/^\d{1,20}$/.test(code)) throw fail("An account code is digits only.");
    const nameAr = text(input.nameAr, 200), nameEn = text(input.nameEn, 200);
    if (!nameAr && !nameEn) throw fail("Give the account a name.");
    return db.tx(async (q) => {
      const [existing] = await q("SELECT * FROM gl_accounts WHERE code = $1", [code]);
      if (create && existing) throw fail("That account code already exists.");
      if (!create && !existing) throw fail("No such account.", 404);
      if (create) {
        const parent = text(input.parent, 30) || null;
        if (parent) {
          const [p] = await q("SELECT * FROM gl_accounts WHERE code = $1", [parent]);
          if (!p) throw fail("The parent account doesn't exist.");
          if (!code.startsWith(parent) || code === parent) throw fail("A sub-account's code starts with its parent's code.");
          const [used] = await q("SELECT 1 FROM gl_lines WHERE account_code = $1 LIMIT 1", [parent]);
          if (used) throw fail("The parent account already has postings, so it can't get sub-accounts.");
          await q("UPDATE gl_accounts SET postable = false WHERE code = $1", [parent]);
        }
        await q("INSERT INTO gl_accounts (code, name_ar, name_en, parent_code, type, postable) VALUES ($1,$2,$3,$4,$5,true)",
          [code, nameAr, nameEn, parent, accountType(code)]);
        await audit(q, user, "create", "account", code, { nameAr, nameEn, parent });
      } else {
        const active = input.active === undefined ? existing.active : Boolean(input.active);
        await q("UPDATE gl_accounts SET name_ar = $2, name_en = $3, active = $4 WHERE code = $1", [code, nameAr, nameEn, active]);
        await audit(q, user, "update", "account", code, { nameAr, nameEn, active });
      }
      return code;
    });
  }

  // ---------- Cost centres ----------
  const listCostCentres = async () =>
    (await db.query("SELECT * FROM gl_cost_centres ORDER BY name")).map((c) => ({ id: c.id, name: c.name, projectCode: c.project_code, active: c.active }));

  async function saveCostCentre(input, user) {
    const name = text(input.name, 200);
    if (!name) throw fail("Give the cost centre a name.");
    const projectCode = text(input.projectCode, 30) || null;
    return db.tx(async (q) => {
      if (input.id) {
        const [row] = await q("UPDATE gl_cost_centres SET name = $2, project_code = $3, active = $4 WHERE id = $1 RETURNING id",
          [Number(input.id), name, projectCode, input.active === undefined ? true : Boolean(input.active)]);
        if (!row) throw fail("No such cost centre.", 404);
        await audit(q, user, "update", "cost_centre", row.id, { name, projectCode });
        return row.id;
      }
      const [dupe] = await q("SELECT 1 FROM gl_cost_centres WHERE name = $1", [name]);
      if (dupe) throw fail("A cost centre with that name exists.");
      const [row] = await q("INSERT INTO gl_cost_centres (name, project_code) VALUES ($1,$2) RETURNING id", [name, projectCode]);
      await audit(q, user, "create", "cost_centre", row.id, { name, projectCode });
      return row.id;
    });
  }

  // ---------- Entries ----------
  async function getEntry(id, q = db.query) {
    const [row] = await q(`SELECT e.*, (SELECT COALESCE(SUM(debit),0) FROM gl_lines WHERE entry_id = e.id) AS debit,
      (SELECT COALESCE(SUM(credit),0) FROM gl_lines WHERE entry_id = e.id) AS credit FROM gl_entries e WHERE e.id = $1`, [Number(id)]);
    if (!row) throw fail("No such entry.", 404);
    const lines = await q(`SELECT l.*, a.name_ar, a.name_en, c.name AS cost_centre FROM gl_lines l
      JOIN gl_accounts a ON a.code = l.account_code LEFT JOIN gl_cost_centres c ON c.id = l.cost_centre_id
      WHERE l.entry_id = $1 ORDER BY l.line_no`, [row.id]);
    return shapeEntry(row, lines);
  }

  async function listEntries({ from, to, type, status, search, account, limit = 50, offset = 0 } = {}) {
    const where = [], params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
    if (isDate(from)) add("e.date >= ?", from);
    if (isDate(to)) add("e.date <= ?", to);
    if (ENTRY_TYPES.includes(type)) add("e.type = ?", type);
    if (["draft", "posted", "void"].includes(status)) add("e.status = ?", status);
    if (status === "unapproved") where.push("e.status = 'posted' AND e.approved_by IS NULL");
    if (search) add("(e.description ILIKE ? OR CAST(e.number AS text) = btrim(?, '%'))", `%${text(search, 100)}%`);
    if (account) add("EXISTS (SELECT 1 FROM gl_lines x WHERE x.entry_id = e.id AND x.account_code LIKE ?)", `${text(account, 30)}%`);
    params.push(Math.min(200, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0));
    const rows = await db.query(`SELECT e.*, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit, COUNT(*) OVER () AS total
      FROM gl_entries e LEFT JOIN gl_lines l ON l.entry_id = e.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY e.id ORDER BY e.date DESC, e.number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { total: Number(rows[0]?.total ?? 0), entries: rows.map((r) => shapeEntry(r)) };
  }

  // Checks lines against the chart and cost centres; returns clean lines.
  async function cleanLines(q, lines) {
    if (!Array.isArray(lines) || lines.length < 2) throw fail("An entry needs at least two lines.");
    if (lines.length > 500) throw fail("An entry can have at most 500 lines.");
    const codes = [...new Set(lines.map((l) => text(l.accountCode, 30)))];
    const accounts = new Map((await q("SELECT code, postable, active FROM gl_accounts WHERE code = ANY($1)", [codes])).map((a) => [a.code, a]));
    const centreIds = [...new Set(lines.map((l) => l.costCentreId).filter((v) => v != null && v !== ""))].map(Number);
    const centres = new Set((await q("SELECT id FROM gl_cost_centres WHERE id = ANY($1)", [centreIds])).map((c) => c.id));
    return lines.map((l, i) => {
      const code = text(l.accountCode, 30), n = i + 1;
      const account = accounts.get(code);
      if (!account) throw fail(`Line ${n}: account ${code || "(empty)"} doesn't exist.`);
      if (!account.postable) throw fail(`Line ${n}: account ${code} is a group account. Post to one of its sub-accounts.`);
      if (!account.active) throw fail(`Line ${n}: account ${code} is closed.`);
      const debit = cents(l.debit || 0), credit = cents(l.credit || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) throw fail(`Line ${n}: amounts must be positive numbers.`);
      if ((debit > 0) === (credit > 0)) throw fail(`Line ${n}: enter either a debit or a credit.`);
      const cc = l.costCentreId == null || l.costCentreId === "" ? null : Number(l.costCentreId);
      if (cc != null && !centres.has(cc)) throw fail(`Line ${n}: that cost centre doesn't exist.`);
      return { code, debit, credit, description: text(l.description), cc };
    });
  }

  async function writeLines(q, entryId, lines) {
    await q("DELETE FROM gl_lines WHERE entry_id = $1", [entryId]);
    for (const [i, l] of lines.entries()) {
      await q("INSERT INTO gl_lines (entry_id, line_no, account_code, debit, credit, description, cost_centre_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [entryId, i + 1, l.code, money(l.debit), money(l.credit), l.description, l.cc]);
    }
  }

  const nextNumber = async (q) => {
    await q("LOCK TABLE gl_entries IN SHARE ROW EXCLUSIVE MODE");
    return Number((await q("SELECT COALESCE(MAX(number),0) + 1 AS n FROM gl_entries"))[0].n);
  };

  // Creates or changes a draft. Posted and void entries can't be edited.
  async function saveDraft(input, user, id = null) {
    if (!isDate(input.date)) throw fail("Give the entry a date.");
    const type = ENTRY_TYPES.includes(input.type) ? input.type : "journal";
    return db.tx(async (q) => {
      await assertOpen(q, input.date);
      const lines = await cleanLines(q, input.lines);
      let entryId = id;
      if (id) {
        const [row] = await q("SELECT status, date FROM gl_entries WHERE id = $1 FOR UPDATE", [Number(id)]);
        if (!row) throw fail("No such entry.", 404);
        if (row.status !== "draft") throw fail("Only drafts can be changed. Void or reverse a posted entry instead.");
        await assertOpen(q, dateOf(row.date));
        await q("UPDATE gl_entries SET date = $2, type = $3, description = $4 WHERE id = $1", [Number(id), input.date, type, text(input.description, 1000)]);
      } else {
        const [row] = await q("INSERT INTO gl_entries (number, date, type, description, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [await nextNumber(q), input.date, type, text(input.description, 1000), user.username]);
        entryId = row.id;
      }
      await writeLines(q, entryId, lines);
      await audit(q, user, id ? "update" : "create", "entry", entryId, { date: input.date, type, lines: lines.length });
      return getEntry(entryId, q);
    });
  }

  async function post(id, user) {
    return db.tx(async (q) => {
      const [row] = await q("SELECT * FROM gl_entries WHERE id = $1 FOR UPDATE", [Number(id)]);
      if (!row) throw fail("No such entry.", 404);
      if (row.status !== "draft") throw fail("Only a draft can be posted.");
      await assertOpen(q, dateOf(row.date));
      const [t] = await q("SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c, COUNT(*) AS n FROM gl_lines WHERE entry_id = $1", [row.id]);
      if (Number(t.n) < 2) throw fail("An entry needs at least two lines.");
      if (cents(t.d) !== cents(t.c)) throw fail(`Debits (${num(t.d).toFixed(2)}) and credits (${num(t.c).toFixed(2)}) don't match.`);
      await q("UPDATE gl_entries SET status = 'posted', posted_by = $2, posted_at = now() WHERE id = $1", [row.id, user.username]);
      await audit(q, user, "post", "entry", row.id);
      return getEntry(row.id, q);
    });
  }

  async function approve(id, user) {
    return db.tx(async (q) => {
      const [row] = await q("SELECT * FROM gl_entries WHERE id = $1 FOR UPDATE", [Number(id)]);
      if (!row) throw fail("No such entry.", 404);
      if (row.status !== "posted") throw fail("Only a posted entry can be approved.");
      if (row.approved_by) throw fail("Already approved.");
      await q("UPDATE gl_entries SET approved_by = $2, approved_at = now() WHERE id = $1", [row.id, user.username]);
      await audit(q, user, "approve", "entry", row.id, { selfApproved: row.created_by === user.username });
      return getEntry(row.id, q);
    });
  }

  async function voidEntry(id, reason, user) {
    const why = text(reason, 500);
    if (!why) throw fail("Say why the entry is being voided.");
    return db.tx(async (q) => {
      const [row] = await q("SELECT * FROM gl_entries WHERE id = $1 FOR UPDATE", [Number(id)]);
      if (!row) throw fail("No such entry.", 404);
      if (row.status === "void") throw fail("Already void.");
      await assertOpen(q, dateOf(row.date));
      if (row.status === "draft") {
        await q("DELETE FROM gl_entries WHERE id = $1", [row.id]);
        await audit(q, user, "delete-draft", "entry", row.id, { reason: why });
        return null;
      }
      await q("UPDATE gl_entries SET status = 'void', void_reason = $2 WHERE id = $1", [row.id, why]);
      await audit(q, user, "void", "entry", row.id, { reason: why });
      return getEntry(row.id, q);
    });
  }

  // Posts a mirror entry on a later date, for a posted entry in a locked month.
  async function reverse(id, date, user) {
    if (!isDate(date)) throw fail("Give the reversal a date.");
    return db.tx(async (q) => {
      await assertOpen(q, date);
      const original = await getEntry(id, q);
      if (original.status !== "posted") throw fail("Only a posted entry can be reversed.");
      const [row] = await q(`INSERT INTO gl_entries (number, date, type, description, created_by, status, posted_by, posted_at, reverses)
        VALUES ($1,$2,'journal',$3,$4,'posted',$4,now(),$5) RETURNING id`,
        [await nextNumber(q), date, `Reversal of entry ${original.number}`, user.username, original.id]);
      await writeLines(q, row.id, original.lines.map((l) => ({ code: l.accountCode, debit: cents(l.credit), credit: cents(l.debit), description: l.description, cc: l.costCentreId })));
      await audit(q, user, "reverse", "entry", original.id, { reversal: row.id, date });
      return getEntry(row.id, q);
    });
  }

  // ---------- Periods ----------
  const listPeriods = async () => (await db.query(`
    SELECT m.month, COALESCE(p.locked,false) AS locked, p.locked_by, p.locked_at FROM
    (SELECT DISTINCT to_char(date,'YYYY-MM') AS month FROM gl_entries UNION SELECT month FROM gl_periods) m
    LEFT JOIN gl_periods p ON p.month = m.month ORDER BY m.month DESC`)).map((p) => ({ month: p.month, locked: p.locked, lockedBy: p.locked_by }));

  async function setLock(month, locked, user) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw fail("Give a month as YYYY-MM.");
    return db.tx(async (q) => {
      if (locked) {
        const [d] = await q("SELECT COUNT(*) AS n FROM gl_entries WHERE status = 'draft' AND to_char(date,'YYYY-MM') = $1", [month]);
        if (Number(d.n)) throw fail(`${month} has ${d.n} draft entries. Post or delete them before locking.`);
      }
      await q(`INSERT INTO gl_periods (month, locked, locked_by, locked_at) VALUES ($1,$2,$3,now())
        ON CONFLICT (month) DO UPDATE SET locked = $2, locked_by = $3, locked_at = now()`, [month, locked, user.username]);
      await audit(q, user, locked ? "lock" : "unlock", "period", month);
    });
  }

  const auditLog = async ({ limit = 100 } = {}) => (await db.query("SELECT * FROM gl_audit ORDER BY id DESC LIMIT $1", [Math.min(500, Number(limit) || 100)]))
    .map((a) => ({ at: a.at, user: a.username, action: a.action, entity: a.entity, entityId: a.entity_id, detail: a.detail }));

  return { db, listAccounts, saveAccount, listCostCentres, saveCostCentre, getEntry, listEntries, saveDraft, post, approve, voidEntry, reverse, listPeriods, setLock, auditLog };
}
