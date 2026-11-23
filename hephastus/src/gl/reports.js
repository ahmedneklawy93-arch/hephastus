// Financial statements from posted entries only.
import { PL_GROUPS, NO_COST_CENTRE, plGroup, isIncome, plTotals } from "../classify.js";
const num = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fail = (m) => Object.assign(new Error(m), { status: 400 });
// Accounts outside the usual code ranges fall back on their type.
const groupOf = (a) => plGroup(a.code) ?? (a.type === "revenue" ? "otherIncome" : "overheads");

export function createReports(db) {
  const posted = "JOIN gl_entries e ON e.id = l.entry_id AND e.status = 'posted'";

  // Opening balance before `from`, movements from..to, closing balance, for every account with activity.
  async function trialBalance({ from, to }) {
    if (!isDate(from) || !isDate(to)) throw fail("Choose a from and to date.");
    const rows = await db.query(`
      SELECT a.code, a.name_ar, a.name_en, a.type,
        COALESCE(SUM(CASE WHEN e.date < $1 THEN l.debit - l.credit END),0) AS opening,
        COALESCE(SUM(CASE WHEN e.date BETWEEN $1 AND $2 THEN l.debit END),0) AS debit,
        COALESCE(SUM(CASE WHEN e.date BETWEEN $1 AND $2 THEN l.credit END),0) AS credit
      FROM gl_lines l ${posted} JOIN gl_accounts a ON a.code = l.account_code
      WHERE e.date <= $2 GROUP BY a.code ORDER BY a.code`, [from, to]);
    const accounts = rows.map((r) => ({ code: r.code, nameAr: r.name_ar, nameEn: r.name_en, type: r.type,
      opening: num(r.opening), debit: num(r.debit), credit: num(r.credit), closing: num(Number(r.opening) + Number(r.debit) - Number(r.credit)) }));
    const sum = (k) => num(accounts.reduce((s, a) => s + a[k], 0));
    return { from, to, accounts, totals: { opening: sum("opening"), debit: sum("debit"), credit: sum("credit"), closing: sum("closing") } };
  }

  // Income statement by account, grouped as operating revenue, other income, direct costs and overheads, with months as columns; optional cost centre.
  async function incomeStatement({ from, to, costCentreId }) {
    if (!isDate(from) || !isDate(to)) throw fail("Choose a from and to date.");
    const params = [from, to];
    let cc = "";
    if (costCentreId) { params.push(Number(costCentreId)); cc = `AND l.cost_centre_id = $3`; }
    const rows = await db.query(`
      SELECT a.code, a.name_ar, a.name_en, a.type, to_char(e.date,'YYYY-MM') AS month, SUM(l.credit - l.debit) AS amount
      FROM gl_lines l ${posted} JOIN gl_accounts a ON a.code = l.account_code
      WHERE e.date BETWEEN $1 AND $2 AND a.type IN ('revenue','expense') ${cc}
      GROUP BY a.code, month ORDER BY a.code, month`, params);
    const months = [...new Set(rows.map((r) => r.month))].sort();
    const accounts = new Map();
    for (const r of rows) {
      if (!accounts.has(r.code)) accounts.set(r.code, { code: r.code, nameAr: r.name_ar, nameEn: r.name_en, type: r.type, months: {}, total: 0 });
      const a = accounts.get(r.code);
      // Income shows as positive income, costs as positive cost.
      const v = isIncome(groupOf(r)) ? Number(r.amount) : -Number(r.amount);
      a.months[r.month] = num(v); a.total = num(a.total + v);
    }
    const list = [...accounts.values()].map((a) => ({ ...a, group: groupOf(a) }));
    const sumOf = (group, pick) => num(list.filter((a) => a.group === group).reduce((s, a) => s + pick(a), 0));
    const totalsFor = (pick) => {
      const t = plTotals(Object.fromEntries(PL_GROUPS.map((g) => [g, sumOf(g, pick)])));
      return { ...t, expenses: num(t.directCosts + t.overheads) };
    };
    const byMonth = Object.fromEntries(months.map((m) => [m, totalsFor((a) => a.months[m] ?? 0)]));
    return { from, to, months, ...Object.fromEntries(PL_GROUPS.map((g) => [g, list.filter((a) => a.group === g)])),
      totals: totalsFor((a) => a.total), byMonth };
  }

  // Balances at a date. This year's result so far is shown under equity until it is closed.
  async function balanceSheet({ at }) {
    if (!isDate(at)) throw fail("Choose a date.");
    const rows = await db.query(`
      SELECT a.code, a.name_ar, a.name_en, a.type, SUM(l.debit - l.credit) AS balance
      FROM gl_lines l ${posted} JOIN gl_accounts a ON a.code = l.account_code
      WHERE e.date <= $1 GROUP BY a.code HAVING SUM(l.debit - l.credit) <> 0 ORDER BY a.code`, [at]);
    const pick = (type, sign) => rows.filter((r) => r.type === type).map((r) => ({ code: r.code, nameAr: r.name_ar, nameEn: r.name_en, balance: num(sign * Number(r.balance)) }));
    const assets = pick("asset", 1), liabilities = pick("liability", -1), equity = pick("equity", -1);
    const result = num(-rows.filter((r) => r.type === "revenue" || r.type === "expense").reduce((s, r) => s + Number(r.balance), 0));
    const sum = (l) => num(l.reduce((s, a) => s + a.balance, 0));
    const totals = { assets: sum(assets), liabilities: sum(liabilities), equity: num(sum(equity) + result), result };
    totals.difference = num(totals.assets - totals.liabilities - totals.equity);
    return { at, assets, liabilities, equity, totals };
  }

  // Every posted line on an account (and its sub-accounts) with a running balance.
  async function accountStatement({ code, from, to }) {
    if (!code || !isDate(from) || !isDate(to)) throw fail("Choose an account and dates.");
    const like = `${String(code).trim()}%`;
    const [open] = await db.query(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS b FROM gl_lines l ${posted} WHERE l.account_code LIKE $1 AND e.date < $2`, [like, from]);
    const rows = await db.query(`
      SELECT e.id, e.number, e.date, e.type, e.description AS entry_description, l.description, l.debit, l.credit, l.account_code, c.name AS cost_centre
      FROM gl_lines l ${posted} LEFT JOIN gl_cost_centres c ON c.id = l.cost_centre_id
      WHERE l.account_code LIKE $1 AND e.date BETWEEN $2 AND $3 ORDER BY e.date, e.number, l.line_no`, [like, from, to]);
    let run = Number(open.b);
    const lines = rows.map((r) => {
      run += Number(r.debit) - Number(r.credit);
      return { entryId: r.id, number: r.number, date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
        type: r.type, accountCode: r.account_code, description: r.description || r.entry_description, costCentre: r.cost_centre,
        debit: num(r.debit), credit: num(r.credit), balance: num(run) };
    });
    return { code, from, to, opening: num(open.b), closing: num(run), lines };
  }

  // Every income and expense line, including lines with no cost centre, so the centres add up to the income statement.
  async function costCentres({ from, to }) {
    if (!isDate(from) || !isDate(to)) throw fail("Choose a from and to date.");
    const rows = await db.query(`
      SELECT c.id, c.name, c.project_code, a.code, a.type, SUM(l.credit - l.debit) AS amount
      FROM gl_lines l ${posted} JOIN gl_accounts a ON a.code = l.account_code LEFT JOIN gl_cost_centres c ON c.id = l.cost_centre_id
      WHERE e.date BETWEEN $1 AND $2 AND a.type IN ('revenue','expense') GROUP BY c.id, c.name, c.project_code, a.code, a.type`, [from, to]);
    const centres = new Map();
    for (const r of rows) {
      const key = r.id ?? "none";
      if (!centres.has(key)) centres.set(key, { id: r.id ?? null, name: r.name ?? NO_COST_CENTRE, projectCode: r.project_code ?? null, revenue: 0, otherIncome: 0, directCosts: 0, overheads: 0 });
      const c = centres.get(key), g = groupOf(r);
      c[g] += isIncome(g) ? Number(r.amount) : -Number(r.amount);
    }
    const list = [...centres.values()].map((c) => ({ id: c.id, name: c.name, projectCode: c.projectCode, ...plTotals(c) }))
      .sort((a, b) => (a.id === null) - (b.id === null) || a.name.localeCompare(b.name));
    return { from, to, costCentres: list };
  }

  return { trialBalance, incomeStatement, balanceSheet, accountStatement, costCentres };
}
