// Accounting (general ledger) screens and the English/Arabic switch.
// Every value from the server is shown with textContent (through h()), never as HTML.

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Language ----------
  const T = {
    en: {
      chat: "Chat", projects: "Projects", site: "Site", finance: "Finance", accounting: "Accounting", team: "Team", logout: "Log out",
      journal: "Journal", accounts: "Accounts", reports: "Reports", periods: "Periods", import: "Import from ERP", audit: "Audit log",
      newEntry: "New entry", number: "No.", date: "Date", type: "Type", description: "Description", debit: "Debit", credit: "Credit",
      status: "Status", approved: "Approved", account: "Account", costCentre: "Cost centre", balance: "Balance", from: "From", to: "To",
      all: "All", search: "Search description or number", show: "Show", saveDraft: "Save draft", savePost: "Save and post", post: "Post",
      approve: "Approve", void: "Void", reverse: "Reverse", edit: "Edit", cancel: "Cancel", close: "Close", addLine: "Add line",
      difference: "Difference", total: "Total", draft: "Draft", posted: "Posted", unapproved: "Posted, not approved",
      journal_t: "Journal", payment: "Cash payment", receipt: "Cash receipt", purchase: "Purchase invoice", sales: "Sales invoice", opening: "Opening balance",
      code: "Code", nameAr: "Arabic name", nameEn: "English name", parent: "Parent account", addAccount: "Add account", group: "Group",
      costCentres: "Cost centres", project: "Project code", addCostCentre: "Add cost centre", save: "Save",
      trialBalance: "Trial balance", income: "Income statement", balanceSheet: "Balance sheet", statement: "Account statement", ccReport: "Cost centres",
      run: "Run", at: "At", opening_b: "Opening", closing: "Closing", revenue: "Revenue", expenses: "Expenses", result: "Result",
      assets: "Assets", liabilities: "Liabilities", equity: "Equity", yearResult: "Result for the year so far", checkBalances: "Assets − liabilities − equity",
      directCosts: "Direct costs", overheads: "Overheads", month: "Month", locked: "Locked", open: "Open", lock: "Lock", unlock: "Unlock",
      importHelp: "Upload the daily ledger export from the old ERP. You can upload it every week until you switch over: new and changed entries are brought in, nothing is deleted, and entries that vanished from the ERP are listed.",
      chooseFile: "Choose the ledger file", imported: "Import finished", added: "Added", updated: "Updated", unchanged: "Unchanged",
      draftsUnbalanced: "Loaded as drafts (don't balance)", lockedConflicts: "Changed in the ERP but locked here", missing: "In Hephastus but no longer in the ERP export",
      when: "When", user: "User", action: "Action", what: "What", reason: "Why is this entry being voided?", reverseDate: "Date for the reversal",
      notSetUp: "The accounting database isn't connected yet. Once DATABASE_URL is set on Render, this screen opens.",
      confirmVoid: "Void", line: "Line", lines: "lines", entries: "entries", none: "Nothing yet.", prev: "Previous", next: "Next",
      createdBy: "Entered by", erp: "From ERP",
    },
    ar: {
      chat: "المحادثة", projects: "المشروعات", site: "الموقع", finance: "المالية", accounting: "الحسابات", team: "الفريق", logout: "خروج",
      journal: "دفتر اليومية", accounts: "دليل الحسابات", reports: "التقارير", periods: "الفترات", import: "استيراد من النظام القديم", audit: "سجل التعديلات",
      newEntry: "قيد جديد", number: "رقم", date: "التاريخ", type: "النوع", description: "الشرح", debit: "مدين", credit: "دائن",
      status: "الحالة", approved: "مؤيد", account: "الحساب", costCentre: "مركز التكلفة", balance: "الرصيد", from: "من", to: "إلى",
      all: "الكل", search: "بحث في الشرح أو الرقم", show: "عرض", saveDraft: "حفظ كمسودة", savePost: "حفظ وترحيل", post: "ترحيل",
      approve: "تأييد", void: "إلغاء", reverse: "عكس القيد", edit: "تعديل", cancel: "إلغاء الأمر", close: "إغلاق", addLine: "إضافة سطر",
      difference: "الفرق", total: "الإجمالي", draft: "مسودة", posted: "مرحل", unapproved: "مرحل غير مؤيد",
      journal_t: "قيد يومية", payment: "سند صرف نقدية", receipt: "سند قبض نقدية", purchase: "فاتورة مشتريات", sales: "فاتورة مبيعات", opening: "قيد افتتاحي",
      code: "الكود", nameAr: "الاسم بالعربية", nameEn: "الاسم بالإنجليزية", parent: "الحساب الرئيسي", addAccount: "إضافة حساب", group: "حساب رئيسي",
      costCentres: "مراكز التكلفة", project: "كود المشروع", addCostCentre: "إضافة مركز تكلفة", save: "حفظ",
      trialBalance: "ميزان المراجعة", income: "قائمة الدخل", balanceSheet: "الميزانية", statement: "كشف حساب", ccReport: "مراكز التكلفة",
      run: "عرض", at: "في", opening_b: "رصيد أول المدة", closing: "رصيد آخر المدة", revenue: "الإيرادات", expenses: "المصروفات", result: "صافي الربح / الخسارة",
      assets: "الأصول", liabilities: "الالتزامات", equity: "حقوق الملكية", yearResult: "نتيجة العام حتى تاريخه", checkBalances: "الأصول − الالتزامات − حقوق الملكية",
      directCosts: "تكاليف مباشرة", overheads: "مصروفات عمومية", month: "الشهر", locked: "مغلق", open: "مفتوح", lock: "إغلاق الشهر", unlock: "فتح الشهر",
      importHelp: "ارفع ملف دفتر اليومية من النظام القديم. يمكنك رفعه كل أسبوع حتى الانتقال: تُضاف القيود الجديدة والمعدلة، ولا يُحذف شيء، وتُعرض القيود التي اختفت من النظام القديم.",
      chooseFile: "اختر ملف دفتر اليومية", imported: "تم الاستيراد", added: "أضيف", updated: "عُدّل", unchanged: "بدون تغيير",
      draftsUnbalanced: "حُمّلت كمسودات (غير متوازنة)", lockedConflicts: "تغيرت في النظام القديم لكن الشهر مغلق هنا", missing: "موجودة هنا ولم تعد في ملف النظام القديم",
      when: "الوقت", user: "المستخدم", action: "الإجراء", what: "البيان", reason: "لماذا يُلغى هذا القيد؟", reverseDate: "تاريخ قيد العكس",
      notSetUp: "قاعدة بيانات الحسابات غير متصلة بعد. ستفتح هذه الشاشة بعد ضبط DATABASE_URL على Render.",
      confirmVoid: "إلغاء", line: "سطر", lines: "أسطر", entries: "قيود", none: "لا يوجد شيء بعد.", prev: "السابق", next: "التالي",
      createdBy: "أدخله", erp: "من النظام القديم",
    },
  };
  let lang = "en";
  try { lang = localStorage.getItem("lang") === "ar" ? "ar" : "en"; } catch {}
  const t = (key) => T[lang][key] ?? T.en[key] ?? key;
  const nameOf = (a) => (lang === "ar" ? a.nameAr || a.nameEn : a.nameEn || a.nameAr) || "";

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    const toggle = $("lang-btn");
    if (toggle) toggle.textContent = lang === "ar" ? "English" : "عربي";
  }

  // ---------- Helpers ----------
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "class") el.className = value;
      else if (key === "value") el.value = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }
  async function api(path, options = {}) {
    const headers = options.raw ? { "Content-Type": "application/octet-stream" } : options.body ? { "Content-Type": "application/json" } : {};
    const response = await fetch(path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { location.reload(); throw new Error("Please log in."); }
    if (!response.ok) throw new Error(body.error || "Something went wrong.");
    return body;
  }
  const amount = (v) => (v ? new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : "");
  const signed = (v) => new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  const yearStart = () => `${today().slice(0, 4)}-01-01`;
  const num = (td) => { td.className = "num"; return td; };
  const typeLabel = (type) => t(type === "journal" ? "journal_t" : type);
  const table = (headers, rows) => h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))), h("tbody", {}, rows)));
  const card = (title, action, ...content) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, title), action), ...content);
  const field = (label, input) => h("div", { class: "field" }, h("label", { class: "field-label" }, label), input);
  const errorBox = () => h("div", { class: "error", role: "alert" });

  let accounts = [], centres = [], sub = "journal";
  async function loadChart() {
    [accounts, centres] = await Promise.all([api("/api/gl/accounts").then((r) => r.accounts), api("/api/gl/cost-centres").then((r) => r.costCentres)]);
  }
  const accountLabel = (code) => { const a = accounts.find((x) => x.code === code); return a ? `${a.code} · ${nameOf(a)}` : code; };

  // ---------- Journal ----------
  const filters = { from: "", to: "", type: "", status: "", search: "", offset: 0 };
  async function renderJournal(root) {
    const form = h("form", { class: "toolbar gl-filters" },
      field(t("from"), h("input", { type: "date", name: "from", value: filters.from })),
      field(t("to"), h("input", { type: "date", name: "to", value: filters.to })),
      field(t("type"), h("select", { name: "type" }, h("option", { value: "" }, t("all")), ["journal", "payment", "receipt", "purchase", "sales", "opening"].map((x) => h("option", { value: x, selected: filters.type === x }, typeLabel(x))))),
      field(t("status"), h("select", { name: "status" }, h("option", { value: "" }, t("all")), ["draft", "posted", "unapproved", "void"].map((x) => h("option", { value: x, selected: filters.status === x }, t(x === "void" ? "void" : x))))),
      field(t("search"), h("input", { name: "search", value: filters.search })),
      h("button", { class: "ghost", type: "submit" }, t("show")),
      h("span", { class: "spacer" }),
      h("button", { class: "primary small", type: "button", onclick: () => openEditor() }, t("newEntry")));
    form.onsubmit = (e) => { e.preventDefault(); Object.assign(filters, Object.fromEntries(new FormData(form)), { offset: 0 }); render(); };
    root.append(form);
    const qs = new URLSearchParams(Object.entries({ ...filters, limit: 50 }).filter(([, v]) => v !== "" && v != null));
    const { entries, total } = await api(`/api/gl/entries?${qs}`);
    const rows = entries.map((e) => h("tr", { class: e.status === "void" ? "done" : "" },
      h("td", {}, h("button", { class: "link", type: "button", onclick: () => openEntry(e.id) }, e.number)),
      h("td", {}, e.date), h("td", {}, typeLabel(e.type)),
      h("td", { dir: "auto", class: "wrap-text" }, e.description),
      num(h("td", {}, amount(e.debit))),
      h("td", {}, h("span", { class: `badge b-${e.status === "posted" ? "approved" : e.status === "draft" ? "submitted" : "rejected"}` }, t(e.status))),
      h("td", {}, e.approvedBy ? "✓" : "")));
    root.append(card(`${t("journal")} · ${total.toLocaleString()} ${t("entries")}`, null,
      rows.length ? table([t("number"), t("date"), t("type"), t("description"), t("debit"), t("status"), t("approved")], rows) : h("p", { class: "muted" }, t("none")),
      total > 50 ? h("div", { class: "form-actions" },
        h("button", { class: "ghost", type: "button", disabled: filters.offset === 0, onclick: () => { filters.offset = Math.max(0, filters.offset - 50); render(); } }, t("prev")),
        h("span", { class: "muted small" }, `${filters.offset + 1}–${Math.min(total, filters.offset + 50)} / ${total}`),
        h("button", { class: "ghost", type: "button", disabled: filters.offset + 50 >= total, onclick: () => { filters.offset += 50; render(); } }, t("next"))) : null));
  }

  async function openEntry(id) {
    const { entry: e } = await api(`/api/gl/entries/${id}`);
    const dlg = $("record-dialog"), form = $("record-form"), err = errorBox();
    const act = (label, fn, cls = "ghost") => h("button", { type: "button", class: cls, onclick: async () => { try { await fn(); dlg.close(); render(); } catch (x) { err.textContent = x.message; } } }, label);
    form.onsubmit = (ev) => ev.preventDefault();
    const voidReason = h("input", { placeholder: t("reason") }), revDate = h("input", { type: "date", value: today() });
    form.replaceChildren(
      h("h2", {}, `${typeLabel(e.type)} ${e.number} · ${e.date}`),
      h("p", { class: "muted", dir: "auto" }, e.description),
      h("p", { class: "muted small" }, `${t("status")}: ${t(e.status)}${e.approvedBy ? ` · ${t("approved")}: ${e.approvedBy}` : ""} · ${t("createdBy")}: ${e.createdBy}${e.sourceRef ? ` · ${t("erp")} ${e.sourceRef}` : ""}${e.voidReason ? ` · ${e.voidReason}` : ""}`),
      table([t("account"), t("description"), t("costCentre"), t("debit"), t("credit")], [
        ...e.lines.map((l) => h("tr", {}, h("td", { dir: "auto" }, `${l.accountCode} · ${l.accountName}`), h("td", { dir: "auto" }, l.description), h("td", { dir: "auto" }, l.costCentre ?? ""), num(h("td", {}, amount(l.debit))), num(h("td", {}, amount(l.credit))))),
        h("tr", { class: "total-row" }, h("td", {}, t("total")), h("td"), h("td"), num(h("td", {}, signed(e.debit))), num(h("td", {}, signed(e.credit)))),
      ]),
      err,
      e.status === "posted" ? h("div", { class: "form-actions" }, field(t("reason"), voidReason), act(t("void"), () => api(`/api/gl/entries/${e.id}/void`, { method: "POST", body: JSON.stringify({ reason: voidReason.value }) }), "ghost danger"),
        field(t("reverseDate"), revDate), act(t("reverse"), () => api(`/api/gl/entries/${e.id}/reverse`, { method: "POST", body: JSON.stringify({ date: revDate.value }) }))) : null,
      h("div", { class: "form-actions" },
        e.status === "draft" ? act(t("void"), () => api(`/api/gl/entries/${e.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Draft deleted" }) }), "ghost danger") : null,
        h("span", { class: "spacer" }),
        e.status === "draft" ? h("button", { type: "button", class: "ghost", onclick: () => openEditor(e) }, t("edit")) : null,
        e.status === "draft" ? act(t("post"), () => api(`/api/gl/entries/${e.id}/post`, { method: "POST", body: "{}" }), "primary small") : null,
        e.status === "posted" && !e.approvedBy ? act(t("approve"), () => api(`/api/gl/entries/${e.id}/approve`, { method: "POST", body: "{}" }), "primary small") : null,
        h("button", { type: "button", class: "ghost", onclick: () => dlg.close() }, t("close"))));
    if (!dlg.open) dlg.showModal();
  }

  function openEditor(entry = null) {
    const dlg = $("record-dialog"), form = $("record-form"), err = errorBox();
    const postable = accounts.filter((a) => a.postable && a.active);
    const list = h("datalist", { id: "gl-accounts" }, postable.map((a) => h("option", { value: `${a.code} · ${nameOf(a)}` })));
    const date = h("input", { type: "date", value: entry?.date ?? today(), required: true });
    const type = h("select", {}, ["journal", "payment", "receipt", "purchase", "sales", "opening"].map((x) => h("option", { value: x, selected: (entry?.type ?? "journal") === x }, typeLabel(x))));
    const desc = h("input", { value: entry?.description ?? "", dir: "auto" });
    const body = h("tbody");
    const totals = h("p", { class: "muted gl-totals" });
    const recalc = () => {
      let d = 0, c = 0;
      for (const tr of body.children) { d += Math.round((Number(tr.querySelector(".dr").value) || 0) * 100); c += Math.round((Number(tr.querySelector(".cr").value) || 0) * 100); }
      totals.textContent = `${t("debit")} ${signed(d / 100)} · ${t("credit")} ${signed(c / 100)} · ${t("difference")} ${signed((d - c) / 100)}`;
      totals.className = d === c && d > 0 ? "muted gl-totals" : "gl-totals late";
    };
    const addLine = (l = {}) => {
      const acc = h("input", { list: "gl-accounts", class: "acc", value: l.accountCode ? accountLabel(l.accountCode) : "", dir: "auto", required: true });
      const cc = h("select", { class: "cc" }, h("option", { value: "" }, "—"), centres.filter((c) => c.active).map((c) => h("option", { value: c.id, selected: l.costCentreId === c.id }, c.name)));
      const tr = h("tr", {},
        h("td", {}, acc),
        h("td", {}, h("input", { class: "ld", value: l.description ?? "", dir: "auto" })),
        h("td", {}, cc),
        h("td", {}, h("input", { class: "dr num-in", type: "number", step: "0.01", min: "0", value: l.debit || "", oninput: recalc })),
        h("td", {}, h("input", { class: "cr num-in", type: "number", step: "0.01", min: "0", value: l.credit || "", oninput: recalc })),
        h("td", {}, h("button", { type: "button", class: "ghost", "aria-label": "Remove line", onclick: () => { tr.remove(); recalc(); } }, "×")));
      body.append(tr);
    };
    (entry?.lines?.length ? entry.lines : [{}, {}]).forEach(addLine);
    const save = async (andPost) => {
      err.textContent = "";
      const lines = [...body.children].map((tr) => ({
        accountCode: tr.querySelector(".acc").value.split("·")[0].trim(),
        description: tr.querySelector(".ld").value,
        costCentreId: tr.querySelector(".cc").value || null,
        debit: Number(tr.querySelector(".dr").value) || 0,
        credit: Number(tr.querySelector(".cr").value) || 0,
      })).filter((l) => l.accountCode || l.debit || l.credit);
      try {
        const payload = JSON.stringify({ date: date.value, type: type.value, description: desc.value, lines });
        const { entry: saved } = await api(entry ? `/api/gl/entries/${entry.id}` : "/api/gl/entries", { method: entry ? "PUT" : "POST", body: payload });
        if (andPost) await api(`/api/gl/entries/${saved.id}/post`, { method: "POST", body: "{}" });
        dlg.close(); render();
      } catch (x) { err.textContent = x.message; }
    };
    form.onsubmit = (ev) => { ev.preventDefault(); save(false); };
    form.replaceChildren(
      h("h2", {}, entry ? `${t("edit")} ${entry.number}` : t("newEntry")), list,
      h("div", { class: "form-grid" }, field(t("date"), date), field(t("type"), type), h("div", { class: "field wide" }, h("label", { class: "field-label" }, t("description")), desc)),
      h("div", { class: "table-wrap" }, h("table", { class: "gl-lines" },
        h("thead", {}, h("tr", {}, [t("account"), t("description"), t("costCentre"), t("debit"), t("credit"), ""].map((x) => h("th", {}, x)))), body)),
      h("div", { class: "form-actions" }, h("button", { type: "button", class: "ghost", onclick: () => { addLine(); } }, t("addLine")), totals),
      err,
      h("div", { class: "form-actions" }, h("span", { class: "spacer" }),
        h("button", { type: "button", class: "ghost", onclick: () => dlg.close() }, t("cancel")),
        h("button", { type: "submit", class: "ghost" }, t("saveDraft")),
        h("button", { type: "button", class: "primary small", onclick: () => save(true) }, t("savePost"))));
    recalc();
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Accounts and cost centres ----------
  let accountSearch = "";
  async function renderAccounts(root) {
    await loadChart();
    const depth = (a) => { let d = 0, p = a.parent; while (p) { d++; p = accounts.find((x) => x.code === p)?.parent; } return d; };
    const q = accountSearch.trim();
    const shown = accounts.filter((a) => !q || a.code.startsWith(q) || nameOf(a).includes(q) || a.nameAr.includes(q));
    const search = h("input", { value: accountSearch, placeholder: t("search"), oninput: (e) => { accountSearch = e.target.value; clearTimeout(search.timer); search.timer = setTimeout(render, 300); } });
    root.append(card(t("accounts"), h("button", { class: "primary small", type: "button", onclick: () => accountForm() }, t("addAccount")),
      h("div", { class: "toolbar" }, search),
      table([t("code"), t("account"), t("debit"), t("credit"), t("balance"), ""], shown.slice(0, 400).map((a) => h("tr", { class: a.active ? "" : "done" },
        h("td", {}, a.code),
        h("td", { dir: "auto", style: `padding-inline-start:${8 + depth(a) * 16}px;${a.postable ? "" : "font-weight:600"}` }, nameOf(a)),
        num(h("td", {}, amount(a.debit))), num(h("td", {}, amount(a.credit))), num(h("td", {}, signed(a.balance))),
        h("td", {}, h("button", { class: "ghost", type: "button", onclick: () => accountForm(a) }, t("edit"))))))));
    root.append(card(t("costCentres"), h("button", { class: "primary small", type: "button", onclick: () => centreForm() }, t("addCostCentre")),
      table([t("costCentre"), t("project"), ""], centres.map((c) => h("tr", { class: c.active ? "" : "done" },
        h("td", { dir: "auto" }, c.name), h("td", {}, c.projectCode ?? ""),
        h("td", {}, h("button", { class: "ghost", type: "button", onclick: () => centreForm(c) }, t("edit"))))))));
  }
  function simpleForm(title, fields, submit) {
    const dlg = $("record-dialog"), form = $("record-form"), err = errorBox();
    form.replaceChildren(h("h2", {}, title), h("div", { class: "form-grid" }, fields.map(([label, input]) => field(label, input))), err,
      h("div", { class: "form-actions" }, h("span", { class: "spacer" }), h("button", { type: "button", class: "ghost", onclick: () => dlg.close() }, t("cancel")), h("button", { type: "submit", class: "primary small" }, t("save"))));
    form.onsubmit = async (ev) => { ev.preventDefault(); try { await submit(); dlg.close(); render(); } catch (x) { err.textContent = x.message; } };
    dlg.showModal();
  }
  function accountForm(a = null) {
    const code = h("input", { value: a?.code ?? "", disabled: Boolean(a), inputmode: "numeric" });
    const parent = h("input", { list: "gl-parents", value: a?.parent ?? "", disabled: Boolean(a) });
    const parents = h("datalist", { id: "gl-parents" }, accounts.map((x) => h("option", { value: x.code }, nameOf(x))));
    const ar = h("input", { value: a?.nameAr ?? "", dir: "rtl" }), en = h("input", { value: a?.nameEn ?? "" });
    const active = h("select", {}, h("option", { value: "1", selected: a?.active !== false }, t("open")), h("option", { value: "0", selected: a?.active === false }, t("locked")));
    simpleForm(a ? `${t("edit")} ${a.code}` : t("addAccount"), [[t("code"), code], [t("parent"), h("span", {}, parent, parents)], [t("nameAr"), ar], [t("nameEn"), en], ...(a ? [[t("status"), active]] : [])],
      () => api(a ? `/api/gl/accounts/${a.code}` : "/api/gl/accounts", { method: a ? "PUT" : "POST",
        body: JSON.stringify({ code: code.value, parent: parent.value, nameAr: ar.value, nameEn: en.value, active: active.value === "1" }) }));
  }
  function centreForm(c = null) {
    const name = h("input", { value: c?.name ?? "", dir: "auto" }), project = h("input", { value: c?.projectCode ?? "" });
    simpleForm(c ? t("edit") : t("addCostCentre"), [[t("costCentre"), name], [t("project"), project]],
      () => api(c ? `/api/gl/cost-centres/${c.id}` : "/api/gl/cost-centres", { method: c ? "PUT" : "POST", body: JSON.stringify({ name: name.value, projectCode: project.value }) }));
  }

  // ---------- Reports ----------
  const rep = { kind: "trial-balance", from: yearStart(), to: today(), at: today(), code: "", costCentreId: "" };
  async function renderReports(root) {
    if (!accounts.length) await loadChart();
    const kinds = [["trial-balance", "trialBalance"], ["income", "income"], ["balance-sheet", "balanceSheet"], ["statement", "statement"], ["cost-centres", "ccReport"]];
    const kind = h("select", { onchange: (e) => { rep.kind = e.target.value; render(); } }, kinds.map(([v, k]) => h("option", { value: v, selected: rep.kind === v }, t(k))));
    const from = h("input", { type: "date", value: rep.from }), to = h("input", { type: "date", value: rep.to }), at = h("input", { type: "date", value: rep.at });
    const code = h("input", { list: "gl-all", value: rep.code, dir: "auto" });
    const all = h("datalist", { id: "gl-all" }, accounts.map((a) => h("option", { value: a.code }, nameOf(a))));
    const cc = h("select", {}, h("option", { value: "" }, t("all")), centres.map((c) => h("option", { value: c.id, selected: String(rep.costCentreId) === String(c.id) }, c.name)));
    const form = h("form", { class: "toolbar gl-filters" }, field(t("reports"), kind),
      rep.kind === "balance-sheet" ? field(t("at"), at) : [field(t("from"), from), field(t("to"), to)],
      rep.kind === "statement" ? field(t("account"), h("span", {}, code, all)) : null,
      rep.kind === "income" ? field(t("costCentre"), cc) : null,
      h("button", { class: "primary small", type: "submit" }, t("run")));
    const out = h("div");
    form.onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(rep, { from: from.value, to: to.value, at: at.value, code: code.value.split("·")[0].trim(), costCentreId: cc.value });
      out.replaceChildren(h("p", { class: "muted" }, "…"));
      try { out.replaceChildren(await runReport()); } catch (x) { out.replaceChildren(h("p", { class: "error" }, x.message)); }
    };
    root.append(card(t("reports"), null, form), out);
    form.requestSubmit();
  }
  async function runReport() {
    const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null));
    const nm = (a) => h("td", { dir: "auto" }, `${a.code} · ${nameOf(a)}`);
    if (rep.kind === "trial-balance") {
      const r = await api(`/api/gl/reports/trial-balance?${q({ from: rep.from, to: rep.to })}`);
      return card(`${t("trialBalance")} ${r.from} → ${r.to}`, null, table([t("account"), t("opening_b"), t("debit"), t("credit"), t("closing")], [
        ...r.accounts.map((a) => h("tr", {}, nm(a), num(h("td", {}, signed(a.opening))), num(h("td", {}, amount(a.debit))), num(h("td", {}, amount(a.credit))), num(h("td", {}, signed(a.closing))))),
        h("tr", { class: "total-row" }, h("td", {}, t("total")), num(h("td", {}, signed(r.totals.opening))), num(h("td", {}, signed(r.totals.debit))), num(h("td", {}, signed(r.totals.credit))), num(h("td", {}, signed(r.totals.closing))))]));
    }
    if (rep.kind === "income") {
      const r = await api(`/api/gl/reports/income?${q({ from: rep.from, to: rep.to, costCentreId: rep.costCentreId })}`);
      const rows = (list) => list.map((a) => h("tr", {}, nm(a), ...r.months.map((m) => num(h("td", {}, amount(a.months[m])))), num(h("td", {}, signed(a.total)))));
      const tot = (label, byMonth, total) => h("tr", { class: "total-row" }, h("td", {}, label), ...r.months.map((m) => num(h("td", {}, signed(byMonth[m])))), num(h("td", {}, signed(total))));
      const result = Object.fromEntries(r.months.map((m) => [m, r.totals.revenueByMonth[m] - r.totals.expensesByMonth[m]]));
      return card(`${t("income")} ${r.from} → ${r.to}`, null, table([t("account"), ...r.months, t("total")], [
        ...rows(r.revenue), tot(t("revenue"), r.totals.revenueByMonth, r.totals.revenue),
        ...rows(r.expenses), tot(t("expenses"), r.totals.expensesByMonth, r.totals.expenses),
        tot(t("result"), result, r.totals.result)]));
    }
    if (rep.kind === "balance-sheet") {
      const r = await api(`/api/gl/reports/balance-sheet?${q({ at: rep.at })}`);
      const block = (title, list, total) => [h("tr", { class: "group-row" }, h("td", { colspan: "2" }, title)), ...list.map((a) => h("tr", {}, nm(a), num(h("td", {}, signed(a.balance))))), h("tr", { class: "total-row" }, h("td", {}, `${t("total")} ${title}`), num(h("td", {}, signed(total))))];
      return card(`${t("balanceSheet")} ${r.at}`, null, table([t("account"), t("balance")], [
        ...block(t("assets"), r.assets, r.totals.assets),
        ...block(t("liabilities"), r.liabilities, r.totals.liabilities),
        ...block(t("equity"), [...r.equity, { code: "—", nameAr: t("yearResult"), nameEn: t("yearResult"), balance: r.totals.result }], r.totals.equity),
        h("tr", { class: "total-row" }, h("td", {}, t("checkBalances")), num(h("td", { class: r.totals.difference ? "late" : "" }, signed(r.totals.difference))))]));
    }
    if (rep.kind === "statement") {
      if (!rep.code) return h("p", { class: "muted" }, t("account"));
      const r = await api(`/api/gl/reports/statement?${q({ code: rep.code, from: rep.from, to: rep.to })}`);
      return card(`${t("statement")} ${accountLabel(rep.code)} · ${r.from} → ${r.to}`, null, table([t("date"), t("number"), t("description"), t("costCentre"), t("debit"), t("credit"), t("balance")], [
        h("tr", { class: "group-row" }, h("td", { colspan: "6" }, t("opening_b")), num(h("td", {}, signed(r.opening)))),
        ...r.lines.map((l) => h("tr", {}, h("td", {}, l.date), h("td", {}, h("button", { class: "link", type: "button", onclick: () => openEntry(l.entryId) }, l.number)),
          h("td", { dir: "auto", class: "wrap-text" }, l.description), h("td", { dir: "auto" }, l.costCentre ?? ""), num(h("td", {}, amount(l.debit))), num(h("td", {}, amount(l.credit))), num(h("td", {}, signed(l.balance))))),
        h("tr", { class: "total-row" }, h("td", { colspan: "6" }, t("closing")), num(h("td", {}, signed(r.closing))))]));
    }
    const r = await api(`/api/gl/reports/cost-centres?${q({ from: rep.from, to: rep.to })}`);
    return card(`${t("ccReport")} ${r.from} → ${r.to}`, null, table([t("costCentre"), t("project"), t("revenue"), t("directCosts"), t("overheads"), t("result")],
      r.costCentres.map((c) => h("tr", {}, h("td", { dir: "auto" }, c.name), h("td", {}, c.projectCode ?? ""), num(h("td", {}, signed(c.revenue))), num(h("td", {}, signed(c.directCosts))), num(h("td", {}, signed(c.overheads))), num(h("td", { class: c.result < 0 ? "late" : "" }, signed(c.result)))))));
  }

  // ---------- Periods, import, audit ----------
  async function renderPeriods(root) {
    const { periods } = await api("/api/gl/periods");
    root.append(card(t("periods"), null, table([t("month"), t("status"), ""], periods.map((p) => h("tr", {},
      h("td", {}, p.month), h("td", {}, p.locked ? `${t("locked")} (${p.lockedBy})` : t("open")),
      h("td", {}, h("button", { class: "ghost", type: "button", onclick: async () => {
        try { await api(`/api/gl/periods/${p.month}/${p.locked ? "unlock" : "lock"}`, { method: "POST", body: "{}" }); render(); } catch (x) { alert(x.message); }
      } }, p.locked ? t("unlock") : t("lock"))))))));
  }
  let lastImport = null;
  function renderImport(root) {
    const file = h("input", { type: "file", accept: ".xls,.xlsx", id: "gl-import-file" });
    const status = h("p", { class: "muted" });
    file.onchange = async () => {
      if (!file.files[0]) return;
      status.textContent = "…";
      try {
        const res = await fetch("/api/gl/import", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file.files[0] });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Import failed.");
        lastImport = body.report; render();
      } catch (x) { status.textContent = x.message; status.className = "error"; }
    };
    root.append(card(t("import"), null, h("p", { class: "muted" }, t("importHelp")), field(t("chooseFile"), file), status));
    if (lastImport) {
      const r = lastImport;
      const list = (title, items, fmt) => items.length ? h("div", {}, h("h4", {}, `${title}: ${items.length}`), h("p", { class: "small muted" }, items.slice(0, 100).map(fmt).join(" · "))) : null;
      root.append(card(`${t("imported")} · ${r.from} → ${r.to}`, null,
        h("p", {}, `${t("added")} ${r.added} · ${t("updated")} ${r.updated} · ${t("unchanged")} ${r.unchanged} · ${t("accounts")} +${r.accountsAdded} · ${t("costCentres")} +${r.costCentresAdded}`),
        list(t("draftsUnbalanced"), r.drafts, (d) => `${d.erpNumber} (${d.date}, ${signed(d.difference)})`),
        list(t("lockedConflicts"), r.lockedConflicts, (d) => `${d.erpNumber} (${d.date})`),
        list(t("missing"), r.missing, (d) => `${d.erpNumber} (${d.date})`)));
    }
  }
  async function renderAudit(root) {
    const { audit } = await api("/api/gl/audit?limit=200");
    root.append(card(t("audit"), null, table([t("when"), t("user"), t("action"), t("what")], audit.map((a) => h("tr", {},
      h("td", {}, new Date(a.at).toLocaleString()), h("td", {}, a.user), h("td", {}, a.action),
      h("td", { class: "wrap-text small" }, `${a.entity} ${a.entityId ?? ""} ${a.detail ? JSON.stringify(a.detail) : ""}`))))));
  }

  // ---------- Frame ----------
  let ready = false;
  async function render() {
    const root = $("view-accounting");
    if (!root || root.hidden) return;
    const tabs = [["journal", "journal"], ["accounts", "accounts"], ["reports", "reports"], ["periods", "periods"], ["import", "import"], ["audit", "audit"]];
    const nav = h("nav", { class: "subtabs" }, tabs.map(([v, k]) => h("button", { type: "button", "aria-current": sub === v ? "page" : "false", onclick: () => { sub = v; render(); } }, t(k))));
    const body = h("div");
    root.replaceChildren(nav, body);
    if (!ready) { body.append(h("p", { class: "muted" }, t("notSetUp"))); return; }
    try {
      if (!accounts.length && sub !== "import") await loadChart();
      await { journal: renderJournal, accounts: renderAccounts, reports: renderReports, periods: renderPeriods, import: renderImport, audit: renderAudit }[sub](body);
    } catch (x) { body.append(h("p", { class: "error" }, x.message)); }
  }

  window.GL = {
    init(me) {
      const tab = $("tab-accounting");
      if (tab) tab.hidden = !me.accounting;
      ready = me.accounting === "ready";
    },
    render: () => { accounts = []; render(); },
    t, applyLanguage,
  };
  window.addEventListener("DOMContentLoaded", () => {
    applyLanguage();
    $("lang-btn")?.addEventListener("click", () => {
      lang = lang === "ar" ? "en" : "ar";
      try { localStorage.setItem("lang", lang); } catch {}
      applyLanguage(); render();
    });
  });
})();
