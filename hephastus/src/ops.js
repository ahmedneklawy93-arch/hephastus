import crypto from "node:crypto";

// MEP contracting records: projects and their contracts, variations (change
// orders), daily site reports with manpower, and site tasks. All amounts are
// in Egyptian pounds (EGP).

const ALL = ["admin", "manager", "engineer"];
const OFFICE = ["admin", "manager"];

export const DISCIPLINES = ["HVAC", "Plumbing & drainage", "Firefighting", "Electrical", "Low current", "BMS"];

export const SCHEMA = {
  projects: {
    label: "Project",
    create: OFFICE,
    edit: OFFICE,
    fields: {
      code: { label: "Project code", type: "text", required: true, max: 30 },
      name: { label: "Project name", type: "text", required: true, max: 120 },
      client: { label: "Client / main contractor", type: "text", required: true, max: 120 },
      consultant: { label: "Consultant", type: "text", max: 120 },
      location: { label: "Location", type: "text", max: 120 },
      disciplines: { label: "Disciplines", type: "multi", options: DISCIPLINES },
      contractValue: { label: "Contract value (EGP)", type: "money", required: true, min: 0 },
      retentionPct: { label: "Retention %", type: "number", min: 0, max: 100 },
      advancePct: { label: "Advance payment %", type: "number", min: 0, max: 100 },
      startDate: { label: "Start date", type: "date" },
      endDate: { label: "Planned completion", type: "date" },
      status: { label: "Status", type: "select", options: ["Tender", "Active", "On hold", "Handed over", "Closed"], required: true },
      progress: { label: "Progress %", type: "number", min: 0, max: 100 },
      notes: { label: "Notes", type: "longtext", max: 4000 },
    },
  },
  variations: {
    label: "Variation",
    create: OFFICE,
    edit: OFFICE,
    fields: {
      projectId: { label: "Project", type: "project", required: true },
      ref: { label: "Variation no.", type: "text", required: true, max: 30 },
      description: { label: "Description", type: "longtext", required: true, max: 2000 },
      discipline: { label: "Discipline", type: "select", options: DISCIPLINES },
      amount: { label: "Amount (EGP, negative for omissions)", type: "money", required: true },
      status: { label: "Status", type: "select", options: ["Draft", "Submitted", "Approved", "Rejected"], required: true },
      date: { label: "Date", type: "date", required: true },
    },
  },
  reports: {
    label: "Daily report",
    create: ALL,
    // Engineers may correct their own reports; office staff can edit any.
    edit: OFFICE,
    editOwn: true,
    fields: {
      projectId: { label: "Project", type: "project", required: true },
      date: { label: "Date", type: "date", required: true },
      engineers: { label: "Engineers", type: "integer", min: 0, max: 1000 },
      foremen: { label: "Foremen", type: "integer", min: 0, max: 1000 },
      technicians: { label: "Technicians", type: "integer", min: 0, max: 5000 },
      labourers: { label: "Labourers", type: "integer", min: 0, max: 5000 },
      subcontractors: { label: "Subcontractor workers", type: "integer", min: 0, max: 5000 },
      workDone: { label: "Work done today", type: "longtext", required: true, max: 4000 },
      materials: { label: "Materials received", type: "longtext", max: 2000 },
      issues: { label: "Issues / delays", type: "longtext", max: 2000 },
    },
  },
  tasks: {
    label: "Task",
    create: ALL,
    edit: ALL,
    fields: {
      projectId: { label: "Project", type: "project", required: true },
      title: { label: "Task", type: "text", required: true, max: 200 },
      discipline: { label: "Discipline", type: "select", options: DISCIPLINES },
      assignee: { label: "Assigned to", type: "text", max: 80 },
      dueDate: { label: "Due date", type: "date" },
      priority: { label: "Priority", type: "select", options: ["Low", "Normal", "High"], required: true },
      status: { label: "Status", type: "select", options: ["Open", "In progress", "Done"], required: true },
    },
  },
};

export const MANPOWER_FIELDS = ["engineers", "foremen", "technicians", "labourers", "subcontractors"];

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Turns raw form input into a clean record, or throws a 400 with a readable message.
export function cleanRecord(collection, input, projects) {
  const schema = SCHEMA[collection];
  const record = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    let value = input?.[key];
    if (value === "" || value === undefined) value = null;
    if (value === null) {
      if (field.required) throw fail(`${field.label} is required.`);
      record[key] = field.type === "multi" ? [] : null;
      continue;
    }
    switch (field.type) {
      case "text":
      case "longtext":
        if (typeof value !== "string") throw fail(`${field.label} must be text.`);
        value = value.trim();
        if (!value && field.required) throw fail(`${field.label} is required.`);
        if (value.length > field.max) throw fail(`${field.label} is too long.`);
        break;
      case "money":
      case "number":
      case "integer":
        value = Number(value);
        if (!Number.isFinite(value)) throw fail(`${field.label} must be a number.`);
        if (field.type === "integer" && !Number.isInteger(value)) throw fail(`${field.label} must be a whole number.`);
        if (field.min !== undefined && value < field.min) throw fail(`${field.label} can't be below ${field.min}.`);
        if (field.max !== undefined && value > field.max) throw fail(`${field.label} can't be above ${field.max}.`);
        if (field.type === "money") value = Math.round(value * 100) / 100;
        break;
      case "date":
        if (typeof value !== "string" || !isDate(value)) throw fail(`${field.label} must be a date.`);
        break;
      case "select":
        if (!field.options.includes(value)) throw fail(`${field.label} has an unknown value.`);
        break;
      case "multi":
        if (!Array.isArray(value) || value.some((item) => !field.options.includes(item))) {
          throw fail(`${field.label} has an unknown value.`);
        }
        value = field.options.filter((option) => value.includes(option));
        break;
      case "project":
        if (!projects.some((project) => project.id === value)) throw fail("Choose an existing project.");
        break;
    }
    record[key] = value;
  }
  if (collection === "projects" && record.startDate && record.endDate && record.endDate < record.startDate) {
    throw fail("Planned completion can't be before the start date.");
  }
  return record;
}

function canWrite(collection, action, user, existing) {
  const schema = SCHEMA[collection];
  if (action === "create") return schema.create.includes(user.role);
  if (action === "delete") return OFFICE.includes(user.role);
  if (schema.edit.includes(user.role)) return true;
  return Boolean(schema.editOwn && existing?.createdBy === user.username);
}

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const round = (value) => Math.round(value * 100) / 100;

// The figures shown on the dashboard and given to the chat assistant.
export function summarize(data, today = new Date().toISOString().slice(0, 10)) {
  const projects = data.projects.map((project) => {
    const variations = data.variations.filter((v) => v.projectId === project.id);
    const tasks = data.tasks.filter((t) => t.projectId === project.id);
    const reports = data.reports.filter((r) => r.projectId === project.id).sort((a, b) => b.date.localeCompare(a.date));
    const approved = round(sum(variations.filter((v) => v.status === "Approved"), (v) => v.amount));
    const pending = round(sum(variations.filter((v) => v.status === "Submitted"), (v) => v.amount));
    const revisedValue = round(project.contractValue + approved);
    const progress = project.progress ?? 0;
    const openTasks = tasks.filter((t) => t.status !== "Done");
    const latest = reports[0];
    return {
      id: project.id,
      code: project.code,
      name: project.name,
      client: project.client,
      status: project.status,
      disciplines: project.disciplines,
      progress,
      contractValue: project.contractValue,
      approvedVariations: approved,
      pendingVariations: pending,
      revisedValue,
      earnedValue: round((revisedValue * progress) / 100),
      retentionHeld: round((revisedValue * progress * (project.retentionPct ?? 0)) / 10000),
      startDate: project.startDate,
      endDate: project.endDate,
      overdue: Boolean(project.endDate && project.endDate < today && !["Handed over", "Closed"].includes(project.status)),
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((t) => t.dueDate && t.dueDate < today).length,
      lastReportDate: latest?.date ?? null,
      lastManpower: latest ? sum(MANPOWER_FIELDS, (key) => latest[key]) : 0,
    };
  });
  const live = projects.filter((p) => !["Tender", "Closed"].includes(p.status));
  return {
    currency: "EGP",
    today,
    totals: {
      activeProjects: projects.filter((p) => p.status === "Active").length,
      revisedValue: round(sum(live, (p) => p.revisedValue)),
      earnedValue: round(sum(live, (p) => p.earnedValue)),
      pendingVariations: round(sum(live, (p) => p.pendingVariations)),
      retentionHeld: round(sum(live, (p) => p.retentionHeld)),
      openTasks: sum(projects, (p) => p.openTasks),
      overdueTasks: sum(projects, (p) => p.overdueTasks),
      manpowerToday: sum(data.reports.filter((r) => r.date === today), (r) => sum(MANPOWER_FIELDS, (key) => r[key])),
    },
    projects,
  };
}

export function createOps(store) {
  // Writes are applied one at a time so two people saving at once never lose data.
  let queue = Promise.resolve();
  const serial = (work) => {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  };

  async function loadAll() {
    const entries = await Promise.all(Object.keys(SCHEMA).map(async (name) => [name, await store.getCollection(name)]));
    return Object.fromEntries(entries);
  }

  return {
    loadAll,
    summary: async () => summarize(await loadAll()),

    create: (collection, input, user) =>
      serial(async () => {
        if (!canWrite(collection, "create", user)) throw Object.assign(new Error("Your role can't add this."), { status: 403 });
        const projects = await store.getCollection("projects");
        const items = collection === "projects" ? projects : await store.getCollection(collection);
        const record = cleanRecord(collection, input, projects);
        if (collection === "projects" && items.some((p) => p.code.toLowerCase() === record.code.toLowerCase())) {
          throw fail("Another project already uses that code.");
        }
        const now = new Date().toISOString();
        const saved = { id: crypto.randomUUID(), ...record, createdBy: user.username, createdAt: now, updatedAt: now };
        items.push(saved);
        await store.setCollection(collection, items);
        return saved;
      }),

    update: (collection, id, input, user) =>
      serial(async () => {
        const projects = await store.getCollection("projects");
        const items = collection === "projects" ? projects : await store.getCollection(collection);
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) throw Object.assign(new Error("Not found."), { status: 404 });
        if (!canWrite(collection, "edit", user, items[index])) {
          throw Object.assign(new Error("Your role can't change this."), { status: 403 });
        }
        const record = cleanRecord(collection, input, projects);
        if (collection === "projects" && items.some((p) => p.id !== id && p.code.toLowerCase() === record.code.toLowerCase())) {
          throw fail("Another project already uses that code.");
        }
        items[index] = { ...items[index], ...record, updatedBy: user.username, updatedAt: new Date().toISOString() };
        await store.setCollection(collection, items);
        return items[index];
      }),

    remove: (collection, id, user) =>
      serial(async () => {
        if (!canWrite(collection, "delete", user)) throw Object.assign(new Error("Your role can't delete this."), { status: 403 });
        const items = await store.getCollection(collection);
        const remaining = items.filter((item) => item.id !== id);
        if (remaining.length === items.length) throw Object.assign(new Error("Not found."), { status: 404 });
        if (collection === "projects") {
          for (const child of ["variations", "reports", "tasks"]) {
            if ((await store.getCollection(child)).some((item) => item.projectId === id)) {
              throw fail("Delete this project's variations, reports and tasks first, or set it to Closed.");
            }
          }
        }
        await store.setCollection(collection, remaining);
      }),
  };
}
