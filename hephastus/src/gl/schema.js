// General ledger tables. Every statement is safe to run again on start-up.
//
// Rules the database itself enforces:
// - a line is a debit or a credit, never both or negative;
// - lines only go to accounts that exist, and entries to periods by date;
// - the audit log is append-only by convention: the app never updates or deletes it.
// Rules the app enforces (src/gl/service.js): posted entries balance, use postable
// accounts, can't be edited (only voided or reversed), and locked months take no changes.

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS gl_accounts (
     code text PRIMARY KEY,
     name_ar text NOT NULL DEFAULT '',
     name_en text NOT NULL DEFAULT '',
     parent_code text REFERENCES gl_accounts(code),
     type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
     postable boolean NOT NULL DEFAULT true,
     active boolean NOT NULL DEFAULT true
   )`,
  `CREATE TABLE IF NOT EXISTS gl_cost_centres (
     id serial PRIMARY KEY,
     name text NOT NULL UNIQUE,
     project_code text,
     active boolean NOT NULL DEFAULT true
   )`,
  `CREATE TABLE IF NOT EXISTS gl_periods (
     month text PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
     locked boolean NOT NULL DEFAULT false,
     locked_by text,
     locked_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS gl_entries (
     id serial PRIMARY KEY,
     number integer NOT NULL UNIQUE,
     date date NOT NULL,
     type text NOT NULL CHECK (type IN ('journal','payment','receipt','purchase','sales','opening')),
     description text NOT NULL DEFAULT '',
     status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
     approved_by text,
     approved_at timestamptz,
     created_by text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     posted_by text,
     posted_at timestamptz,
     void_reason text,
     reverses integer REFERENCES gl_entries(id),
     source_ref text UNIQUE
   )`,
  `CREATE TABLE IF NOT EXISTS gl_lines (
     id serial PRIMARY KEY,
     entry_id integer NOT NULL REFERENCES gl_entries(id) ON DELETE CASCADE,
     line_no integer NOT NULL,
     account_code text NOT NULL REFERENCES gl_accounts(code),
     debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
     credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
     description text NOT NULL DEFAULT '',
     cost_centre_id integer REFERENCES gl_cost_centres(id),
     CHECK (debit = 0 OR credit = 0),
     CHECK (debit > 0 OR credit > 0)
   )`,
  `CREATE INDEX IF NOT EXISTS gl_lines_account ON gl_lines(account_code)`,
  `CREATE INDEX IF NOT EXISTS gl_lines_entry ON gl_lines(entry_id)`,
  `CREATE INDEX IF NOT EXISTS gl_entries_date ON gl_entries(date)`,
  `CREATE TABLE IF NOT EXISTS gl_audit (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     username text NOT NULL,
     action text NOT NULL,
     entity text NOT NULL,
     entity_id text,
     detail jsonb
   )`,
];

// Account type from the chart's first digits (the company's existing chart):
// 1 assets, 203 partners' equity and reserves, other 2 liabilities, 3 purchases and 5 expenses, 6 revenue.
export function accountType(code) {
  if (code.startsWith("1")) return "asset";
  if (code.startsWith("203")) return "equity";
  if (code.startsWith("2")) return "liability";
  if (code.startsWith("6")) return "revenue";
  if (code.startsWith("3") || code.startsWith("5")) return "expense";
  if (code.startsWith("4")) return "equity";
  return "expense";
}
