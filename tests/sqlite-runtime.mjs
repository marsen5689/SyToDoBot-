// Test-only implementation of the documented SDK subset, backed by actual SQLite.
// It tests business logic and data isolation; it is never imported by production.
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const fragment = (text, params = []) => ({ text, params });
const expression = (value) => value?.column ? fragment(quote(value.name)) : value?.text !== undefined ? value : fragment('?', [typeof value === 'boolean' ? Number(value) : value]);
const binary = (operator) => (left, right) => {
  const a = expression(left), b = expression(right);
  return fragment(`${a.text} ${operator} ${b.text}`, [...a.params, ...b.params]);
};
function column(type, name) {
  return {
    column: true, type, name, required: false, isUnique: false, primary: false,
    notNull() { this.required = true; return this; },
    unique() { this.isUnique = true; return this; },
    default(value) { this.defaultValue = value; return this; },
    primaryKey() { this.primary = true; return this; },
  };
}
const sql = (strings, ...values) => {
  const parts = values.map(expression);
  return fragment(strings.reduce((text, part, i) => text + part + (parts[i]?.text ?? ''), ''), parts.flatMap((part) => part.params));
};
const operators = {
  integer: (name) => column('INTEGER', name),
  text: (name) => column('TEXT', name),
  boolean: (name) => column('BOOLEAN', name),
  eq: binary('='), lt: binary('<'), lte: binary('<='),
  isNull: (value) => fragment(`${expression(value).text} IS NULL`),
  isNotNull: (value) => fragment(`${expression(value).text} IS NOT NULL`),
  and: (...parts) => fragment(`(${parts.map((p) => p.text).join(' AND ')})`, parts.flatMap((p) => p.params)),
  or: (...parts) => fragment(`(${parts.map((p) => p.text).join(' OR ')})`, parts.flatMap((p) => p.params)),
  desc: (col) => fragment(`${quote(col.name)} DESC`),
  asc: (col) => fragment(`${quote(col.name)} ASC`),
  sql,
  index: (name) => ({ on: (...columns) => ({ index: true, name, columns }) }),
  check: (name, expr) => ({ name, check: expr }),
};

export async function runtime(filename = ':memory:', options = {}) {
  const sqlite = new DatabaseSync(filename);
  const tables = new Map();
  const sdkDb = {
    ...operators,
    table(name, columns, extras) {
      const table = { tableName: name, columns, ...columns };
      const constraints = extras?.(table) ?? {};
      const definitions = Object.values(columns).map((col) => `${quote(col.name)} ${col.type === 'BOOLEAN' ? 'INTEGER' : col.type}${col.primary ? ' PRIMARY KEY AUTOINCREMENT' : ''}${col.required ? ' NOT NULL' : ''}${col.isUnique ? ' UNIQUE' : ''}${col.defaultValue === undefined ? '' : ` DEFAULT ${typeof col.defaultValue === 'string' ? `'${col.defaultValue.replaceAll("'", "''")}'` : typeof col.defaultValue === 'boolean' ? Number(col.defaultValue) : col.defaultValue}`}`);
      for (const extra of Object.values(constraints)) if (extra.check) definitions.push(`CHECK (${extra.check.text})`);
      sqlite.exec(`CREATE TABLE IF NOT EXISTS ${quote(name)} (${definitions.join(', ')})`);
      for (const extra of Object.values(constraints)) if (extra.index) sqlite.exec(`CREATE INDEX IF NOT EXISTS ${quote(extra.name)} ON ${quote(name)} (${extra.columns.map((col) => quote(col.name)).join(', ')})`);
      tables.set(name, table);
      return table;
    },
  };

  function builder(kind, table, projection) {
    let values, condition, order, limit, returning, conflict;
    const project = (selected) => Object.entries(selected ?? table.columns).map(([key, col]) => `${quote(col.name)} AS ${quote(key)}`).join(', ');
    const convert = (row, selected) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, (selected ?? table.columns)[key]?.type === 'BOOLEAN' ? Boolean(value) : value]));
    function execute() {
      let query, params = [];
      if (kind === 'select') query = `SELECT ${project(projection)} FROM ${quote(table.tableName)}`;
      if (kind === 'insert') {
        const entries = Object.entries(values);
        query = `INSERT INTO ${quote(table.tableName)} (${entries.map(([key]) => quote(table[key].name)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`;
        params = entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value);
        if (conflict) query += ` ON CONFLICT (${quote(conflict.name)}) DO NOTHING`;
      }
      if (kind === 'update') {
        const entries = Object.entries(values);
        const parts = entries.map(([key, value]) => ({ key, expr: expression(value) }));
        query = `UPDATE ${quote(table.tableName)} SET ${parts.map(({ key, expr }) => `${quote(table[key].name)} = ${expr.text}`).join(', ')}`;
        params = parts.flatMap(({ expr }) => expr.params);
      }
      if (kind === 'delete') query = `DELETE FROM ${quote(table.tableName)}`;
      if (condition) { query += ` WHERE ${condition.text}`; params.push(...condition.params); }
      if (order) query += ` ORDER BY ${order.text}`;
      if (limit) { query += ' LIMIT ?'; params.push(limit); }
      if (returning) query += ` RETURNING ${project(returning)}`;
      const statement = sqlite.prepare(query);
      if (kind === 'select' || returning) return statement.all(...params).map((row) => convert(row, returning ?? projection));
      const result = statement.run(...params);
      return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid, rows: [] };
    }
    const chain = {
      from(value) { table = value; return this; },
      values(value) { values = value; return this; },
      set(value) { values = value; return this; },
      where(value) { condition = value; return this; },
      orderBy(value) { order = value; return this; },
      limit(value) { limit = value; return this; },
      returning(value) { returning = value ?? table.columns; return this; },
      onConflictDoNothing({ target }) { conflict = target; return this; },
      async all() { return execute(); },
      async get() { return execute()[0] ?? null; },
      async run() { return execute(); },
    };
    return chain;
  }
  const db = {
    select: (projection) => builder('select', null, projection),
    insert: (table) => builder('insert', table),
    update: (table) => builder('update', table),
    delete: (table) => builder('delete', table),
    async $count(table, condition) {
      return sqlite.prepare(`SELECT count(*) AS n FROM ${quote(table.tableName)} WHERE ${condition.text}`).get(...condition.params).n;
    },
  };
  class EndpointError extends Error {
    constructor(message, parameters) { super(message); this.parameters = parameters; }
  }
  class BotApiError extends Error {
    constructor(code, description, parameters) { super(description); this.code = code; this.description = description; this.parameters = parameters; }
  }
  const calls = [];
  const api = Object.fromEntries(['sendMessage', 'editMessageText', 'answerCallbackQuery', 'setMyCommands', 'setChatMenuButton'].map((method) => [method, async (params) => {
    calls.push({ method, params: JSON.parse(JSON.stringify(params)) });
    if (options.api) return await options.api(method, params, BotApiError);
    return { message_id: 500, ...params };
  }]));
  const Clock = options.now ? class extends Date { static now() { return options.now(); } } : Date;
  const context = vm.createContext({ console, Date: Clock });
  const cache = new Map();
  function synthetic(name, exports) {
    const module = new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context, identifier: name });
    cache.set(name, module);
  }
  synthetic('sdk', { db, EndpointError, BotApiError, api });
  synthetic('sdk/db', sdkDb);
  const root = path.resolve('tgcloud');
  if (options.remindersEnabled !== undefined) synthetic(path.join(root, 'lib/reminder-config.js'), {
    remindersEnabled: options.remindersEnabled, reminderPrecisionMinutes: 5,
  });
  async function load(name, referencing) {
    const resolved = name === 'sdk' || name === 'sdk/db' ? name : path.resolve(referencing ? path.dirname(referencing.identifier) : root, name);
    if (cache.has(resolved)) return cache.get(resolved);
    const module = new vm.SourceTextModule(await readFile(resolved, 'utf8'), { context, identifier: resolved });
    cache.set(resolved, module);
    await module.link(load);
    return module;
  }
  const endpoints = {};
  for (const name of ['getProfile', 'listTasks', 'createTask', 'setTaskCompleted', 'deleteTask', 'setTaskSchedule', 'getReminderCapabilities', 'processReminders']) {
    const module = await load(`./endpoints/${name}.js`);
    await module.evaluate();
    endpoints[name] = module.namespace.default;
  }
  const handlers = {};
  for (const name of ['message', 'callback_query']) {
    const module = await load(`./handlers/${name}.js`);
    await module.evaluate();
    handlers[name] = module.namespace.default;
  }
  return { endpoints, handlers, calls, sqlite, close: () => sqlite.close() };
}
