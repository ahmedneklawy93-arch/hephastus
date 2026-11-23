import XLSX from "xlsx";

// Reads an account statement exported from the old ERP (كشف حساب: one block per account
// with "الرصيد السابق" / "رصيد الحركة" / "الرصيد الحالي" rows, then its lines) and checks
// it against Hephastus's books: every statement line should match a posted line of the
// ERP entry with the same number, on the same account, for the same amount.

const fail = (m) => Object.assign(new Error(m), { status: 400 });
const cents = (v) => Math.round(Number(v || 0) * 100);
const dateOf = (v) => (typeof v === "number" ? XLSX.SSF.format("yyyy-mm-dd", v) : null);
const PREVIOUS = "الرصيد السابق", REVIEWED = "مراجع", APPROVED = "مؤيد";

export function readStatement(buffer) {
  let rows;
  try {
    const book = XLSX.read(buffer, { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: null, raw: true });
  } catch {
    throw fail("That file couldn't be opened as an Excel workbook.");
  }
  const head = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const col = (name) => head.indexOf(name);
  const C = { date: col("التاريخ"), account: col("الحساب"), desc: col("الشرح"), debit: col("مدين"), credit: col("دائن"), entry: col("الرقم"),
    source: col("الأصل"), voucher: col("رقمه"), counter: col("الحساب المقابل"), cc: col("مركز التكلفة"), approved: col("مؤيد"), reviewed: col("مراجع") };
  if (C.account < 0 || C.debit < 0 || C.credit < 0 || C.entry < 0 || col("الرصيد") < 0) {
    throw fail("This doesn't look like an account statement export (expected the columns التاريخ, الحساب, الشرح, مدين, دائن, الرصيد, الرقم).");
  }
  const accounts = new Map(), lines = [];
  let account = null;
  for (const r of rows.slice(1)) {
    if (r[C.account]) {
      const text = String(r[C.account]); const dash = text.indexOf("-");
      account = { code: (dash < 0 ? text : text.slice(0, dash)).trim(), name: dash < 0 ? "" : text.slice(dash + 1).trim() };
      if (!accounts.has(account.code)) accounts.set(account.code, { ...account, previous: 0 });
    }
    if (!account) continue;
    if (String(r[C.desc] ?? "").trim() === PREVIOUS) accounts.get(account.code).previous = (cents(r[C.debit]) - cents(r[C.credit])) / 100;
    const date = dateOf(r[C.date]);
    if (!date) continue;
    lines.push({ date, code: account.code, name: account.name, description: String(r[C.desc] ?? "").trim(), debit: cents(r[C.debit]) / 100, credit: cents(r[C.credit]) / 100,
      entry: String(r[C.entry] ?? "").trim(), source: r[C.source] ?? "", voucher: r[C.voucher] ?? "", counter: r[C.counter] ?? "", costCentre: r[C.cc] ?? "",
      approved: r[C.approved] === APPROVED, reviewed: r[C.reviewed] === REVIEWED });
  }
  if (!lines.length) throw fail("No statement lines were found in that file.");
  return { accounts: [...accounts.values()], lines };
}

export async function reconcileStatement(ledger, buffer) {
  const { accounts, lines } = readStatement(buffer);
  const codes = [...new Set(lines.map((l) => l.code))];
  const posted = await ledger.db.query(`
    SELECT substr(e.source_ref, 5) AS erp, e.number, to_char(e.date, 'YYYY-MM-DD') AS date, l.account_code, l.debit, l.credit
    FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id AND e.status = 'posted'
    WHERE l.account_code = ANY($1)`, [codes]);
  const key = (entry, code, amount) => `${entry}|${code}|${amount}`;
  const books = new Map();
  for (const p of posted) {
    for (const k of [key(p.erp, p.account_code, cents(p.debit) - cents(p.credit)), key(String(p.number), p.account_code, cents(p.debit) - cents(p.credit))]) {
      books.set(k, (books.get(k) ?? 0) + 1);
    }
  }
  const dates = lines.map((l) => l.date).sort();
  // The books run to their latest posted entry on any account.
  const [{ last: booksTo }] = await ledger.db.query("SELECT to_char(MAX(date), 'YYYY-MM-DD') AS last FROM gl_entries WHERE status = 'posted'");
  const notInBooks = [];
  let matched = 0;
  for (const l of lines) {
    const k = key(l.entry, l.code, cents(l.debit) - cents(l.credit));
    if (books.get(k) > 0) { books.set(k, books.get(k) - 1); matched++; } else notInBooks.push(l);
  }
  const sum = (list) => Math.round(list.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
  const newer = notInBooks.filter((l) => booksTo && l.date > booksTo);
  return {
    from: dates[0], to: dates.at(-1), booksTo: booksTo || null, accounts: accounts.length, lines: lines.length, matched,
    newer: { count: newer.length, amount: sum(newer), lines: newer.slice(0, 100) },
    missing: { count: notInBooks.length - newer.length, amount: sum(notInBooks.filter((l) => !newer.includes(l))), lines: notInBooks.filter((l) => !newer.includes(l)).slice(0, 100) },
    reviewed: lines.filter((l) => l.reviewed).length, approved: lines.filter((l) => l.approved).length,
    // Detail accounts only: a parent's balance repeats its sub-accounts'.
    carriedForward: accounts.filter((a) => Math.abs(a.previous) >= 0.01 && /^[35]/.test(a.code) && !accounts.some((o) => o.code !== a.code && o.code.startsWith(a.code)))
      .map((a) => ({ code: a.code, name: a.name, previous: a.previous })),
  };
}
