import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtime } from './sqlite-runtime.mjs';
import { DatabaseSync } from 'node:sqlite';

const user = id => ({ initData: { user: { id, first_name: 'Test' } } });
const job = () => ({ ...user(8347651382), maintenanceJob: 'sytodo-reminders' });
const request = (name, dueAt = null, reminderMinutes = null) => ({
  title: name, requestId: `reminder-test-${name.padEnd(16, 'x')}`, dueAt, dueOffsetMinutes: 180, reminderMinutes,
});
const code = value => error => error.parameters?.code === value;
const START = Date.UTC(2026, 9, 10, 9, 0);

test('additive schedule migration preserves existing tasks and supplies neutral defaults', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-migrate-'));
  const filename = path.join(folder, 'db.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    request_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal', completed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.prepare('INSERT INTO tasks (user_id, request_key, title, note, priority, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(101, 'legacy-key', 'Существующая задача', 'Сохранённые детали', 'high', 0, START, START);
  const before = db.prepare('SELECT * FROM tasks').get();
  for (const declaration of ['due_at INTEGER', 'due_offset_minutes INTEGER NOT NULL DEFAULT 0',
    'reminder_minutes INTEGER', 'reminder_at INTEGER', 'reminder_sent_at INTEGER', 'reminder_lease_until INTEGER',
    'schedule_version INTEGER NOT NULL DEFAULT 0', 'recurrence TEXT', 'last_reminder_due_at INTEGER']) db.exec('ALTER TABLE tasks ADD COLUMN ' + declaration);
  const after = db.prepare('SELECT * FROM tasks').get();
  assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, after[key]])), { ...before });
  assert.equal(after.due_at, null); assert.equal(after.schedule_version, 0);
  db.close();
  const app = await runtime(filename);
  try {
    const old = (await app.endpoints.listTasks({}, user(101))).tasks[0];
    assert.equal(old.title, 'Существующая задача'); assert.equal(old.note, 'Сохранённые детали');
    assert.equal(old.dueAt, null); assert.equal(old.reminderAt, null);
    await app.endpoints.setTaskSchedule({ id: old.id, dueAt: START, dueOffsetMinutes: 180 }, user(101));
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks[0].dueAt, START);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('deadline persists, can be changed and cleared, and stays isolated between users', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-deadline-'));
  const filename = path.join(folder, 'db.sqlite');
  let app = await runtime(filename);
  try {
    const { task } = await app.endpoints.createTask(request('deadline', START + 3600000), user(101));
    assert.equal(task.dueAt, START + 3600000);
    assert.equal(task.dueOffsetMinutes, 180);
    app.close(); app = await runtime(filename);
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks[0].dueAt, task.dueAt);
    await assert.rejects(app.endpoints.setTaskSchedule({ id: task.id, dueAt: START, userId: 101 }, user(202)), code('NOT_FOUND'));
    const changed = await app.endpoints.setTaskSchedule({ id: task.id, dueAt: START, dueOffsetMinutes: -240, userId: 202 }, user(101));
    assert.equal(changed.task.dueAt, START);
    assert.equal(changed.task.dueOffsetMinutes, -240);
    const cleared = await app.endpoints.setTaskSchedule({ id: task.id, dueAt: null }, user(101));
    assert.equal(cleared.task.dueAt, null);
    assert.equal(cleared.task.dueOffsetMinutes, 0);
    assert.equal((await app.endpoints.listTasks({}, user(101))).counts.active, 1);
    assert.equal((await app.endpoints.listTasks({}, user(202))).tasks.length, 0);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('date, time zone and reminder settings are validated server-side', async () => {
  const app = await runtime(':memory:', { remindersEnabled: true, now: () => START });
  try {
    for (const value of ['2026-10-10', 0, -1, 4102444800000, START + .5, Number.NaN]) {
      await assert.rejects(app.endpoints.createTask({ ...request('validation'), dueAt: value }, user(101)), code('VALIDATION_ERROR'));
    }
    for (const offset of ['180', 841, -841, 15.5]) {
      await assert.rejects(app.endpoints.createTask({ ...request('zone', START), dueOffsetMinutes: offset }, user(101)), code('VALIDATION_ERROR'));
    }
    for (const minutes of [-1, '15', 10081, 15.5, true]) {
      await assert.rejects(app.endpoints.createTask({ ...request('interval', START + 3600000), reminderMinutes: minutes }, user(101)), code('VALIDATION_ERROR'));
    }
    await assert.rejects(app.endpoints.createTask(request('missing-date', null, 15), user(101)), code('VALIDATION_ERROR'));
    await assert.rejects(app.endpoints.createTask(request('past-reminder', START + 60000, 15), user(101)), code('VALIDATION_ERROR'));
    const { task } = await app.endpoints.createTask(request('past-deadline', START - 60000), user(101));
    assert.equal(task.dueAt, START - 60000); // Overdue deadlines are allowed without reminders.
  } finally { app.close(); }
});

test('disabled scheduler cannot be bypassed and public requests cannot invoke maintenance', async () => {
  const app = await runtime(':memory:', { remindersEnabled: false });
  try {
    assert.equal((await app.endpoints.getReminderCapabilities({}, user(101))).enabled, false);
    await assert.rejects(app.endpoints.createTask(request('disabled', Date.now() + 3600000, 0), user(101)), code('REMINDERS_UNAVAILABLE'));
    for (const ctx of [user(101), { initData: { user: { id: 101 }, maintenanceJob: 'sytodo-reminders' } }]) {
      await assert.rejects(app.endpoints.processReminders({ maintenanceJob: 'sytodo-reminders', userId: 8347651382 }, ctx), code('FORBIDDEN'));
    }
    assert.equal((await app.endpoints.processReminders({}, job())).sent, 0);
    assert.equal(app.calls.length, 0);
  } finally { app.close(); }
});

test('due reminders reach the stored owner once across parallel jobs, with escaped text and local deadline', async () => {
  let now = START;
  const app = await runtime(':memory:', { remindersEnabled: true, now: () => now });
  try {
    const due = START + 3600000;
    const input = { ...request('delivery', due, 15), title: '<b>Личная задача</b>', userId: 202 };
    const { task } = await app.endpoints.createTask(input, user(101));
    await app.endpoints.createTask(request('second-owner', due, 15), user(202));
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 0);
    now = due - 15 * 60000;
    await Promise.all([app.endpoints.processReminders({}, job()), app.endpoints.processReminders({}, job())]);
    const sent = app.calls.filter(call => call.method === 'sendMessage');
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(call => call.params.chat_id).sort(), [101, 202]);
    const first = sent.find(call => call.params.chat_id === 101);
    assert.match(first.params.text, /&lt;b&gt;Личная задача&lt;\/b&gt;/);
    assert.match(first.params.text, /10\.10\.2026 13:00 \(UTC\+03:00\)/);
    assert.equal(first.params.reply_markup.inline_keyboard[0][0].callback_data, `task:done:${task.id}`);
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 2);
    // Retry creation after the reminder time still returns the original task.
    const retry = await app.endpoints.createTask(input, user(101));
    assert.equal(retry.task.id, task.id);
    assert.equal(retry.task.reminderSentAt, now);
    const saved = await app.endpoints.setTaskSchedule({ id: task.id, dueAt: due, dueOffsetMinutes: 180, reminderMinutes: 15 }, user(101));
    assert.equal(saved.task.reminderSentAt, now);
  } finally { app.close(); }
});

test('completion, deletion and rescheduling cancel outdated notifications; undo only rearms future ones', async () => {
  let now = START;
  const app = await runtime(':memory:', { remindersEnabled: true, now: () => now });
  try {
    const due = START + 3600000;
    const done = (await app.endpoints.createTask(request('done', due, 0), user(101))).task;
    const deleted = (await app.endpoints.createTask(request('deleted', due, 0), user(101))).task;
    const moved = (await app.endpoints.createTask(request('moved', due, 0), user(101))).task;
    await app.endpoints.setTaskCompleted({ id: done.id, completed: true }, user(101));
    await app.endpoints.deleteTask({ id: deleted.id }, user(101));
    await app.endpoints.setTaskSchedule({ id: moved.id, dueAt: due + 3600000, reminderMinutes: 0 }, user(101));
    now = due;
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 0);
    await app.endpoints.setTaskCompleted({ id: done.id, completed: false }, user(101));
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 0);
    now = due + 3600000;
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 1);
    assert.match(app.calls[0].params.text, /moved/);
  } finally { app.close(); }
});

test('a changed schedule is not sent from a stale batch', async () => {
  let now = START;
  let second, app;
  app = await runtime(':memory:', { remindersEnabled: true, now: () => now, api: async method => {
    if (method === 'sendMessage') await app.endpoints.setTaskSchedule({ id: second.id, dueAt: START + 7200000, reminderMinutes: 0 }, user(101));
    return {};
  } });
  try {
    await app.endpoints.createTask(request('first', START + 3600000, 0), user(101));
    second = (await app.endpoints.createTask(request('rescheduled', START + 3600000, 0), user(101))).task;
    now = START + 3600000;
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 1);
  } finally { app.close(); }
});

test('transient failures respect leases and permanent bot blocking disables further delivery', async () => {
  let now = START, fail = true;
  const app = await runtime(':memory:', { remindersEnabled: true, now: () => now, api: async (method, params, BotApiError) => {
    if (params.chat_id === 202) throw new BotApiError(403, 'Forbidden: bot was blocked by the user');
    if (fail) throw new BotApiError(429, 'Too Many Requests', { retry_after: 900 });
    return {};
  } });
  try {
    await app.endpoints.createTask(request('transient', START + 60000, 0), user(101));
    await app.endpoints.createTask(request('blocked', START + 60000, 0), user(202));
    now += 60000;
    assert.equal((await app.endpoints.processReminders({}, job())).failed, 2);
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 2);
    now += 10 * 60000;
    await app.endpoints.processReminders({}, job());
    assert.equal(app.calls.length, 2);
    fail = false; now += 5 * 60000;
    assert.equal((await app.endpoints.processReminders({}, job())).sent, 1);
    assert.equal(app.calls.length, 3);
    assert.equal((await app.endpoints.listTasks({}, user(202))).tasks[0].reminderAt, null);
  } finally { app.close(); }
});
