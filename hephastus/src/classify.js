// How income and expense accounts are grouped, shared by the Finance screen (ledger uploads)
// and the Accounting reports so both show the same figures. Codes follow the company's
// chart of accounts:
//   601  revenue from the main activity (contracting, supplies, maintenance)
//   6xx  any other income (602 deposit interest, scrap sales, discounts received)
//   504  direct project costs; 3 purchases, which are materials bought for sites
//   5xx  every other expense: overheads, including finance costs and partner payments
export const PL_GROUPS = ["revenue", "otherIncome", "directCosts", "overheads"];

// Lines booked without a cost centre are reported under this name rather than dropped.
export const NO_COST_CENTRE = "بدون مركز تكلفة";

// Returns the group for an account code, or null for balance-sheet accounts.
export function plGroup(code) {
  const c = String(code ?? "");
  if (c.startsWith("601")) return "revenue";
  if (c.startsWith("6")) return "otherIncome";
  if (c.startsWith("504") || c.startsWith("3")) return "directCosts";
  if (c.startsWith("5")) return "overheads";
  return null;
}

// Income groups are credit-positive; cost groups are debit-positive.
export const isIncome = (group) => group === "revenue" || group === "otherIncome";

export function plTotals(b) {
  const r = (v) => Math.round(v * 100) / 100;
  const out = { revenue: r(b.revenue), otherIncome: r(b.otherIncome), directCosts: r(b.directCosts), overheads: r(b.overheads) };
  out.grossProfit = r(out.revenue - out.directCosts);
  out.result = r(out.revenue + out.otherIncome - out.directCosts - out.overheads);
  return out;
}
