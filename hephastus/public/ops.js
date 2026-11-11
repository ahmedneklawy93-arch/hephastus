// Projects, Site and Team screens. Every value from the server is shown with
// textContent (through h()), never as HTML.

(() => {
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 });
  const MANPOWER = ["engineers", "foremen", "technicians", "labourers", "subcontractors"];
  let me = null;
  let schema = null;
  let data = null;
  let openProjectId = null;
  let siteProjectId = "";

  const office = () => me && (me.role === "admin" || me.role === "manager");

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "class") el.className = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: options.body ? { "Content-Type": "application/json" } : {} });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.reload();
      throw new Error("Please log in.");
    }
    if (!response.ok) throw new Error(body.error || "Something went wrong.");
    return body;
  }

  async function refresh() {
    if (!schema) schema = (await api("/api/ops/schema")).schema;
    data = await api("/api/ops/data");
    render();
  }

  const projectById = (id) => data.projects.find((p) => p.id === id);
  const projectLabel = (id) => {
    const p = projectById(id);
    return p ? `${p.code} · ${p.name}` : "Unknown project";
  };
  const canEdit = (collection, record) =>
    schema[collection].edit.includes(me.role) || (schema[collection].editOwn && record.createdBy === me.username);
  const canCreate = (collection) => schema[collection].create.includes(me.role);

  // ---------- Record form (built from the server's schema) ----------

  function openForm(collection, record = null, defaults = {}) {
    const fields = schema[collection].fields;
    const form = $("record-form");
    form.replaceChildren();
    form.append(h("h2", {}, `${record ? "Edit" : "New"} ${schema[collection].label.toLowerCase()}`));
    const values = { ...defaults, ...(record ?? {}) };
    if (!record && fields.date && !values.date) values.date = new Date().toISOString().slice(0, 10);
    if (!record && fields.status && !values.status) values.status = fields.status.options[collection === "projects" ? 1 : 0];
    if (!record && fields.priority && !values.priority) values.priority = "Normal";

    const grid = h("div", { class: "form-grid" });
    for (const [key, field] of Object.entries(fields)) {
      const id = `f-${key}`;
      const value = values[key] ?? "";
      let input;
      if (field.type === "longtext") {
        input = h("textarea", { id, name: key, rows: 3, maxlength: field.max });
        input.value = value;
      } else if (field.type === "select" || field.type === "project") {
        const options = field.type === "project"
          ? data.projects.map((p) => [p.id, `${p.code} · ${p.name}`])
          : field.options.map((o) => [o, o]);
        input = h("select", { id, name: key },
          field.required ? null : h("option", { value: "" }, "—"),
          options.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
      } else if (field.type === "multi") {
        input = h("div", { class: "checks", id },
          field.options.map((o) => h("label", {}, h("input", { type: "checkbox", name: key, value: o, checked: (values[key] ?? []).includes(o) }), o)));
      } else {
        const type = { date: "date", money: "number", number: "number", integer: "number" }[field.type] ?? "text";
        input = h("input", {
          id, name: key, type, value,
          step: field.type === "integer" ? 1 : "any",
          min: field.min, max: type === "number" ? field.max : undefined,
          maxlength: type === "text" ? field.max : undefined,
          inputmode: field.type === "money" ? "decimal" : undefined,
        });
      }
      if (field.required && field.type !== "multi") input.required = true;
      const wide = ["longtext", "multi"].includes(field.type) || key === "name" || key === "title";
      grid.append(h("div", { class: wide ? "field wide" : "field" },
        h(field.type === "multi" ? "span" : "label", { for: field.type === "multi" ? undefined : id, class: "field-label" },
          field.label, field.required ? " *" : ""),
        input));
    }
    form.append(grid);

    const error = h("div", { class: "error", role: "alert" });
    const buttons = h("div", { class: "form-actions" });
    if (record && office()) {
      buttons.append(h("button", { type: "button", class: "ghost danger", onclick: async () => {
        if (!confirm(`Delete this ${schema[collection].label.toLowerCase()}? This can't be undone.`)) return;
        try {
          await api(`/api/ops/${collection}/${record.id}`, { method: "DELETE" });
          if (collection === "projects") openProjectId = null;
          $("record-dialog").close();
          await refresh();
        } catch (e) { error.textContent = e.message; }
      } }, "Delete"));
    }
    buttons.append(
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "ghost", onclick: () => $("record-dialog").close() }, "Cancel"),
      h("button", { type: "submit", class: "primary small" }, "Save"));
    form.append(error, buttons);

    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = {};
      for (const [key, field] of Object.entries(fields)) {
        if (field.type === "multi") body[key] = [...form.querySelectorAll(`input[name="${key}"]:checked`)].map((c) => c.value);
        else body[key] = form.elements[key].value;
      }
      const save = form.querySelector("button[type=submit]");
      save.disabled = true;
      try {
        await api(record ? `/api/ops/${collection}/${record.id}` : `/api/ops/${collection}`, {
          method: record ? "PUT" : "POST",
          body: JSON.stringify(body),
        });
        $("record-dialog").close();
        await refresh();
      } catch (e) {
        error.textContent = e.message;
      } finally {
        save.disabled = false;
      }
    };
    $("record-dialog").showModal();
    form.querySelector("input, select, textarea")?.focus();
  }

  // ---------- Building blocks ----------

  const tile = (label, value, tone = "") => h("div", { class: `tile ${tone}` }, h("span", {}, label), h("strong", {}, value));
  const badge = (text) => h("span", { class: `badge b-${String(text).toLowerCase().replace(/\s+/g, "-")}` }, text);
  const bar = (pct) => h("div", { class: "bar", title: `${pct}%` }, h("i", { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
  const empty = (text) => h("p", { class: "muted" }, text);

  function section(title, action, ...content) {
    return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, title), action), ...content);
  }

  function addButton(collection, label, defaults) {
    return canCreate(collection) && data.projects.length
      ? h("button", { class: "ghost", type: "button", onclick: () => openForm(collection, null, defaults) }, label)
      : null;
  }

  function table(headers, rows) {
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, headers.map((t) => h("th", {}, t)))),
      h("tbody", {}, rows)));
  }

  function taskRows(tasks, showProject) {
    const today = data.summary.today;
    return tasks
      .sort((a, b) => (a.status === "Done") - (b.status === "Done") || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
      .map((t) => {
        const late = t.status !== "Done" && t.dueDate && t.dueDate < today;
        const status = h("select", { class: "inline-select", "aria-label": "Status", disabled: !canEdit("tasks", t) },
          schema.tasks.fields.status.options.map((o) => h("option", { selected: o === t.status }, o)));
        status.onchange = async () => {
          try {
            await api(`/api/ops/tasks/${t.id}`, { method: "PUT", body: JSON.stringify({ ...t, status: status.value }) });
            await refresh();
          } catch (e) { alert(e.message); }
        };
        return h("tr", { class: t.status === "Done" ? "done" : "" },
          h("td", {}, h("button", { class: "link", type: "button", onclick: () => canEdit("tasks", t) && openForm("tasks", t) }, t.title),
            showProject ? h("div", { class: "muted small" }, projectLabel(t.projectId)) : null),
          h("td", {}, t.discipline ?? ""),
          h("td", {}, t.assignee ?? ""),
          h("td", { class: late ? "late" : "" }, t.dueDate ?? ""),
          h("td", {}, badge(t.priority)),
          h("td", {}, status));
      });
  }

  function reportCard(r, showProject) {
    const crew = MANPOWER.map((k) => [schema.reports.fields[k].label, r[k] ?? 0]).filter(([, n]) => n);
    const total = crew.reduce((s, [, n]) => s + n, 0);
    return h("article", { class: "report" },
      h("div", { class: "report-head" },
        h("strong", {}, r.date),
        showProject ? h("span", { class: "muted" }, projectLabel(r.projectId)) : null,
        h("span", { class: "muted" }, `${total} on site`),
        h("span", { class: "spacer" }),
        canEdit("reports", r) ? h("button", { class: "ghost", type: "button", onclick: () => openForm("reports", r) }, "Edit") : null),
      crew.length ? h("div", { class: "muted small" }, crew.map(([l, n]) => `${l}: ${n}`).join(" · ")) : null,
      h("p", {}, r.workDone),
      r.materials ? h("p", {}, h("b", {}, "Materials: "), r.materials) : null,
      r.issues ? h("p", { class: "issue" }, h("b", {}, "Issues: "), r.issues) : null,
      h("div", { class: "muted small" }, `By ${r.createdBy}`));
  }

  // ---------- Projects view ----------

  function renderProjects() {
    const root = $("view-projects");
    root.replaceChildren();
    if (openProjectId && projectById(openProjectId)) {
      root.append(renderProjectDetail(openProjectId));
      return;
    }
    const t = data.summary.totals;
    root.append(h("div", { class: "tiles" },
      tile("Active projects", t.activeProjects),
      tile("Revised contract value", money.format(t.revisedValue)),
      tile("Work done (earned)", money.format(t.earnedValue)),
      tile("Variations pending", money.format(t.pendingVariations), t.pendingVariations ? "warn" : ""),
      tile("Retention held", money.format(t.retentionHeld)),
      tile("Overdue tasks", t.overdueTasks, t.overdueTasks ? "bad" : "")));

    const add = canCreate("projects") ? h("button", { class: "primary small", type: "button", onclick: () => openForm("projects") }, "Add project") : null;
    const rows = data.summary.projects.map((p) => h("tr", {},
      h("td", {}, h("button", { class: "link", type: "button", onclick: () => { openProjectId = p.id; render(); } }, `${p.code} · ${p.name}`),
        h("div", { class: "muted small" }, p.client)),
      h("td", {}, badge(p.status), p.overdue ? h("div", { class: "late small" }, "Past completion date") : null),
      h("td", { class: "num" }, money.format(p.revisedValue)),
      h("td", {}, bar(p.progress), h("span", { class: "small muted" }, `${p.progress}%`)),
      h("td", { class: "num" }, p.pendingVariations ? money.format(p.pendingVariations) : "—"),
      h("td", { class: "num" }, `${p.openTasks}${p.overdueTasks ? ` (${p.overdueTasks} late)` : ""}`),
      h("td", {}, p.lastReportDate ?? "—")));
    root.append(section("Projects", add,
      rows.length
        ? table(["Project", "Status", "Revised value", "Progress", "Pending variations", "Open tasks", "Last report"], rows)
        : empty(office() ? "No projects yet. Add your first project to get started." : "No projects yet. A manager adds them.")));
  }

  function renderProjectDetail(id) {
    const project = projectById(id);
    const s = data.summary.projects.find((p) => p.id === id);
    const wrap = h("div", {});
    wrap.append(h("div", { class: "detail-head" },
      h("button", { class: "ghost", type: "button", onclick: () => { openProjectId = null; render(); } }, "← All projects"),
      h("h2", {}, `${project.code} · ${project.name}`),
      badge(project.status),
      h("span", { class: "spacer" }),
      canEdit("projects", project) ? h("button", { class: "ghost", type: "button", onclick: () => openForm("projects", project) }, "Edit project") : null));

    wrap.append(h("div", { class: "tiles" },
      tile("Contract value", money.format(s.contractValue)),
      tile("Approved variations", money.format(s.approvedVariations)),
      tile("Revised value", money.format(s.revisedValue)),
      tile("Progress", `${s.progress}%`),
      tile("Work done (earned)", money.format(s.earnedValue)),
      tile("Retention held", money.format(s.retentionHeld))));

    const facts = [
      ["Client", project.client], ["Consultant", project.consultant], ["Location", project.location],
      ["Disciplines", (project.disciplines ?? []).join(", ")],
      ["Start", project.startDate], ["Planned completion", project.endDate],
      ["Retention", project.retentionPct != null ? `${project.retentionPct}%` : null],
      ["Advance payment", project.advancePct != null ? `${project.advancePct}%` : null],
    ].filter(([, v]) => v);
    wrap.append(section("Contract", null,
      h("dl", { class: "facts-list" }, facts.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      project.notes ? h("p", {}, project.notes) : null));

    const variations = data.variations.filter((v) => v.projectId === id).sort((a, b) => b.date.localeCompare(a.date));
    wrap.append(section("Variations", addButton("variations", "Add variation", { projectId: id }),
      variations.length ? table(["No.", "Description", "Discipline", "Amount", "Status", "Date"], variations.map((v) => h("tr", {},
        h("td", {}, canEdit("variations", v) ? h("button", { class: "link", type: "button", onclick: () => openForm("variations", v) }, v.ref) : v.ref),
        h("td", {}, v.description),
        h("td", {}, v.discipline ?? ""),
        h("td", { class: "num" }, money.format(v.amount)),
        h("td", {}, badge(v.status)),
        h("td", {}, v.date)))) : empty("No variations recorded.")));

    const tasks = data.tasks.filter((t) => t.projectId === id);
    wrap.append(section("Tasks", addButton("tasks", "Add task", { projectId: id }),
      tasks.length ? table(["Task", "Discipline", "Assigned to", "Due", "Priority", "Status"], taskRows(tasks, false)) : empty("No tasks.")));

    const reports = data.reports.filter((r) => r.projectId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    wrap.append(section("Latest daily reports", addButton("reports", "New daily report", { projectId: id }),
      reports.length ? reports.map((r) => reportCard(r, false)) : empty("No daily reports yet.")));
    return wrap;
  }

  // ---------- Site view ----------

  function renderSite() {
    const root = $("view-site");
    root.replaceChildren();
    if (!data.projects.length) {
      root.append(section("Site", null, empty("There are no projects yet. A manager adds them on the Projects screen.")));
      return;
    }
    const picker = h("select", { "aria-label": "Project" },
      h("option", { value: "" }, "All projects"),
      data.projects.filter((p) => p.status !== "Closed").map((p) => h("option", { value: p.id, selected: p.id === siteProjectId }, `${p.code} · ${p.name}`)));
    picker.onchange = () => { siteProjectId = picker.value; renderSite(); };
    const defaults = siteProjectId ? { projectId: siteProjectId } : {};
    root.append(h("div", { class: "toolbar" }, picker, h("span", { class: "spacer" }),
      addButton("tasks", "Add task", defaults),
      h("button", { class: "primary small", type: "button", onclick: () => openForm("reports", null, defaults) }, "New daily report")));

    const mine = (items) => (siteProjectId ? items.filter((i) => i.projectId === siteProjectId) : items);
    const tasks = mine(data.tasks).filter((t) => t.status !== "Done");
    root.append(section("Open tasks", null,
      tasks.length ? table(["Task", "Discipline", "Assigned to", "Due", "Priority", "Status"], taskRows(tasks, !siteProjectId)) : empty("No open tasks.")));
    const reports = mine(data.reports).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
    root.append(section("Daily reports", null, reports.length ? reports.map((r) => reportCard(r, !siteProjectId)) : empty("No daily reports yet.")));
  }

  // ---------- Team view (admin) ----------

  async function renderTeam() {
    const root = $("view-team");
    root.replaceChildren();
    const { users } = await api("/api/users");
    const list = table(["Name", "Username", "Role", ""], users.map((u) => h("tr", {},
      h("td", {}, u.displayName), h("td", {}, u.username), h("td", {}, badge(u.role)),
      h("td", {}, u.username === "admin" ? h("span", { class: "muted small" }, "Uses APP_PASSWORD") : [
        h("button", { class: "ghost", type: "button", onclick: () => editUser(u) }, "Edit"), " ",
        h("button", { class: "ghost danger", type: "button", onclick: async () => {
          if (!confirm(`Remove ${u.displayName}? They will be logged out.`)) return;
          await api(`/api/users/${encodeURIComponent(u.username)}`, { method: "DELETE" });
          renderTeam();
        } }, "Remove")]))));
    root.append(section("Team", h("button", { class: "primary small", type: "button", onclick: () => editUser(null) }, "Add person"),
      h("p", { class: "muted small" }, "Managers can add and edit projects, variations and everything on site. Site engineers write daily reports and work on tasks, and can read the projects."),
      list));
  }

  function editUser(user) {
    const form = $("record-form");
    const error = h("div", { class: "error", role: "alert" });
    form.replaceChildren(
      h("h2", {}, user ? `Edit ${user.displayName}` : "Add a team member"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { class: "field-label", for: "u-name" }, "Full name *"), h("input", { id: "u-name", name: "displayName", required: true, value: user?.displayName ?? "" })),
        h("div", { class: "field" }, h("label", { class: "field-label", for: "u-user" }, "Username *"), h("input", { id: "u-user", name: "username", required: true, value: user?.username ?? "", disabled: Boolean(user), autocapitalize: "none" })),
        h("div", { class: "field" }, h("label", { class: "field-label", for: "u-role" }, "Role *"),
          h("select", { id: "u-role", name: "role" }, [["engineer", "Site engineer"], ["manager", "Manager"]].map(([v, l]) => h("option", { value: v, selected: user?.role === v }, l)))),
        h("div", { class: "field" }, h("label", { class: "field-label", for: "u-pass" }, user ? "New password (leave empty to keep)" : "Password * (10+ characters)"),
          h("input", { id: "u-pass", name: "password", type: "password", autocomplete: "new-password", minlength: 10, required: !user }))),
      error,
      h("div", { class: "form-actions" }, h("span", { class: "spacer" }),
        h("button", { type: "button", class: "ghost", onclick: () => $("record-dialog").close() }, "Cancel"),
        h("button", { type: "submit", class: "primary small" }, "Save")));
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(["displayName", "username", "role", "password"].map((k) => [k, form.elements[k].value]));
      try {
        await api(user ? `/api/users/${encodeURIComponent(user.username)}` : "/api/users", { method: user ? "PUT" : "POST", body: JSON.stringify(body) });
        $("record-dialog").close();
        renderTeam();
      } catch (e) { error.textContent = e.message; }
    };
    $("record-dialog").showModal();
  }

  // ---------- Navigation ----------

  let current = "chat";
  function render() {
    if (current === "projects") renderProjects();
    if (current === "site") renderSite();
  }

  async function show(view) {
    current = view;
    for (const button of document.querySelectorAll(".tabs button")) button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
    for (const el of document.querySelectorAll(".view")) el.hidden = el.id !== `view-${view}`;
    try {
      if (view === "projects" || view === "site") await refresh();
      if (view === "team") await renderTeam();
    } catch (e) {
      $(`view-${view}`)?.replaceChildren(h("p", { class: "error" }, e.message));
    }
  }

  window.Ops = {
    init(user) {
      me = user;
      $("tab-team").hidden = me.role !== "admin";
      $("who").textContent = `${me.displayName} · ${me.role}`;
      show(current);
    },
  };
  for (const button of document.querySelectorAll(".tabs button")) button.addEventListener("click", () => show(button.dataset.view));
})();
