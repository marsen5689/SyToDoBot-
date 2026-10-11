import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtime } from './sqlite-runtime.mjs';
import { DatabaseSync } from 'node:sqlite';

const user = id => ({ initData: { user: { id } } });
const job = { ...user(8347651382), maintenanceJob: 'sytodo-reminders' };
const START = Date.UTC(2026, 9, 12, 8);
const DAY = 86400000;
const input = (suffix = 'new', extra = {}) => ({ title: 'Витамины <утром>', requestId: `recurring-reminder-${suffix}`,
  dueAt: START + 3600000, dueOffsetMinutes: 0, reminderMinutes: 15,
  recurrence: { mode: 'daily', timeZone: 'UTC' }, ...extra });
const code = value => error => error.parameters?.code === value;
const iso = value => new Date(value).toISOString();

test('the two-column additive migration preserves already scheduled tasks and delivered one-off reminders', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-cycle-migrate-'));
  const filename = path.join(folder, 'db.sqlite');
  let now = START;
  let app = await runtime(filename, { now: () => now });
  try {
    await app.endpoints.createTask(input('legacy-task', { reminderMinutes: 5 }), user(101));
    const { task } = await app.endpoints.createReminder(input('legacy-one-off', { recurrence: null }), user(101));
    now = task.reminderAt; await app.endpoints.processReminders({}, job); app.close();
    const db = new DatabaseSync(filename);
    db.exec('ALTER TABLE tasks DROP COLUMN recurrence; ALTER TABLE tasks DROP COLUMN last_reminder_due_at');
    const before = db.prepare('SELECT * FROM tasks ORDER BY id').all().map(row => ({ ...row }));
    db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT; ALTER TABLE tasks ADD COLUMN last_reminder_due_at INTEGER');
    const after = db.prepare('SELECT * FROM tasks ORDER BY id').all();
    assert.deepEqual(after.map(row => Object.fromEntries(Object.keys(before[0]).map(key => [key, row[key]]))), before);
    assert.ok(after.every(row => row.recurrence === null && row.last_reminder_due_at === null)); db.close();
    app = await runtime(filename, { now: () => now });
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks.length, 1);
    assert.equal((await app.endpoints.listReminders({ status: 'completed' }, user(101))).tasks[0].id, task.id);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('recurrence persists, is normalized by the server, and cannot override ownership or kind', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-recurrence-'));
  const filename = path.join(folder, 'db.sqlite');
  let app = await runtime(filename, { now: () => START });
  try {
    const { task } = await app.endpoints.createReminder(input('persist', { userId: 202,
      recurrence: { mode: 'alternate', timeZone: 'UTC', anchorDate: '2000-01-01', minuteOfDay: 0 } }), user(101));
    assert.equal(task.recurrence.anchorDate, '2026-10-12'); assert.equal(task.recurrence.minuteOfDay, 540);
    assert.equal(task.reminderAt, task.dueAt - 15 * 60000);
    const normal = await app.endpoints.createTask(input('normal'), user(101));
    assert.equal(normal.task.recurrence, null);
    await assert.rejects(app.endpoints.updateReminder({ ...input(), id: task.id, userId: 101 }, user(202)), code('NOT_FOUND'));
    assert.equal((await app.endpoints.listReminders({}, user(202))).tasks.length, 0);
    app.close(); app = await runtime(filename, { now: () => START });
    assert.equal((await app.endpoints.getReminder({ id: task.id }, user(101))).task.recurrence.mode, 'alternate');
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks.length, 1);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('daily advance is atomic across parallel jobs and remains active with a last-delivery history', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const { task } = await app.endpoints.createReminder(input(), user(101));
    now = task.reminderAt;
    await Promise.all([app.endpoints.processReminders({}, job), app.endpoints.processReminders({}, job)]);
    assert.equal(app.calls.filter(call => call.method === 'sendMessage').length, 1);
    const sent = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
    assert.equal(sent.dueAt, task.dueAt + DAY); assert.equal(sent.reminderAt, task.reminderAt + DAY);
    assert.equal(sent.lastReminderDueAt, task.dueAt); assert.equal(sent.reminderSentAt, now);
    const page = await app.endpoints.listReminders({}, user(101));
    assert.equal(page.tasks[0].id, task.id); assert.deepEqual({ ...page.counts }, { active: 1, completed: 1 });
    assert.equal((await app.endpoints.listReminders({ status: 'completed' }, user(101))).tasks[0].lastReminderDueAt, task.dueAt);
    assert.equal((await app.endpoints.processReminders({}, job)).sent, 0);
    now = sent.reminderAt; assert.equal((await app.endpoints.processReminders({}, job)).sent, 1);
    assert.equal((await app.endpoints.getReminder({ id: task.id }, user(101))).task.dueAt, task.dueAt + 2 * DAY);
    const message = app.calls.find(call => call.method === 'sendMessage').params;
    assert.match(message.text, /Каждый день/); assert.match(message.text, /За 15 мин/); assert.match(message.text, /&lt;утром&gt;/);
    assert.equal(message.reply_markup.inline_keyboard[0][0].callback_data, `reminder:snooze:${task.id}:${task.dueAt}`);
  } finally { app.close(); }
});

test('alternate days keep their anchor after long scheduler delays without a catch-up flood', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const { task } = await app.endpoints.createReminder(input('alternate', { recurrence: { mode: 'alternate', timeZone: 'UTC' } }), user(101));
    now = task.reminderAt + 41 * DAY;
    assert.equal((await app.endpoints.processReminders({}, job)).sent, 1);
    const next = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
    assert.equal(next.dueAt, task.dueAt + 42 * DAY); assert.ok(next.reminderAt > now);
    assert.equal((await app.endpoints.processReminders({}, job)).sent, 0);
    const renamed = await app.endpoints.updateReminder({ ...input(), id: task.id, dueAt: next.dueAt,
      title: 'Новое название', recurrence: { mode: 'alternate', timeZone: 'UTC' } }, user(101));
    assert.equal(renamed.task.recurrence.anchorDate, '2026-10-12'); assert.equal(renamed.task.reminderSentAt, now);
  } finally { app.close(); }
});

test('selected weekdays choose the first matching day and continue across week boundaries', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const { task } = await app.endpoints.createReminder(input('weekdays', { recurrence: { mode: 'weekdays', timeZone: 'UTC', weekdays: [5, 3, 3] } }), user(101));
    assert.equal(iso(task.dueAt), '2026-10-14T09:00:00.000Z');
    for (const expected of ['2026-10-16T09:00:00.000Z', '2026-10-21T09:00:00.000Z']) {
      const current = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
      now = current.reminderAt; await app.endpoints.processReminders({}, job);
      assert.equal(iso((await app.endpoints.getReminder({ id: task.id }, user(101))).task.dueAt), expected);
    }
  } finally { app.close(); }
});

test('recurrence keeps local clock time across DST, resolves gaps forward and overlaps once', async () => {
  for (const scenario of [
    { zone: 'Europe/Kyiv', first: '2026-10-24T06:00:00Z', next: ['2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z'], offsets: [120, 120] },
    { zone: 'Europe/Paris', first: '2026-03-28T01:30:00Z', next: ['2026-03-29T01:30:00.000Z', '2026-03-30T00:30:00.000Z'], offsets: [120, 120] },
    { zone: 'Europe/Paris', first: '2026-10-24T00:30:00Z', next: ['2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z'], offsets: [120, 60] },
    { zone: 'Asia/Kathmandu', first: '2026-10-12T03:15:00Z', next: ['2026-10-13T03:15:00.000Z', '2026-10-14T03:15:00.000Z'], offsets: [345, 345] },
  ]) {
    let now = Date.parse(scenario.first) - 3600000;
    const app = await runtime(':memory:', { now: () => now });
    try {
      const { task } = await app.endpoints.createReminder(input('zone', { dueAt: Date.parse(scenario.first), reminderMinutes: 0,
        recurrence: { mode: 'daily', timeZone: scenario.zone } }), user(101));
      let current = task;
      for (let index = 0; index < scenario.next.length; index++) {
        now = current.reminderAt; assert.equal((await app.endpoints.processReminders({}, job)).sent, 1);
        current = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
        assert.equal(iso(current.dueAt), scenario.next[index]); assert.equal(current.dueOffsetMinutes, scenario.offsets[index]);
      }
    } finally { app.close(); }
  }
});

test('server validates repeat settings and accepts preset and custom lead minutes for tasks and reminders', async () => {
  const app = await runtime(':memory:', { now: () => START });
  try {
    for (const recurrence of [[], 'daily', { mode: 'bad', timeZone: 'UTC' }, { mode: 'daily', timeZone: 'Fake/Zone' },
      { mode: 'weekdays', timeZone: 'UTC', weekdays: [] }, { mode: 'weekdays', timeZone: 'UTC', weekdays: [7] },
      { mode: 'weekdays', timeZone: 'UTC', weekdays: ['1'] }]) {
      await assert.rejects(app.endpoints.createReminder(input('invalid', { recurrence }), user(101)), code('VALIDATION_ERROR'));
    }
    for (const minutes of [-1, 2.5, 10081, '5', NaN]) {
      await assert.rejects(app.endpoints.createReminder(input('invalid', { reminderMinutes: minutes }), user(101)), code('VALIDATION_ERROR'));
    }
    for (const minutes of [0, 5, 10, 15, 37, 10080]) {
      for (const endpoint of ['createTask', 'createReminder']) {
        const { task } = await app.endpoints[endpoint](input(`${endpoint}-${minutes}`, { reminderMinutes: minutes, dueAt: START + 8 * DAY }), user(101));
        assert.equal(task.reminderAt, task.dueAt - minutes * 60000);
      }
    }
  } finally { app.close(); }
});

test('renaming preserves recurrence delivery, changing timing rearms it, and removing repetition becomes one-off', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const { task } = await app.endpoints.createReminder(input('edit'), user(101));
    now = task.reminderAt; await app.endpoints.processReminders({}, job);
    const current = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
    const renamed = await app.endpoints.updateReminder({ ...input(), id: task.id, dueAt: current.dueAt, title: 'Новое имя' }, user(101));
    assert.equal(renamed.task.reminderSentAt, now); assert.equal(renamed.task.lastReminderDueAt, task.dueAt);
    const changed = await app.endpoints.updateReminder({ ...input(), id: task.id, dueAt: current.dueAt, reminderMinutes: 5 }, user(101));
    assert.equal(changed.task.reminderSentAt, null); assert.equal(changed.task.lastReminderDueAt, null);
    const oneOff = await app.endpoints.updateReminder({ ...input(), id: task.id, dueAt: current.dueAt, recurrence: null }, user(101));
    assert.equal(oneOff.task.recurrence, null);
    now = oneOff.task.reminderAt; await app.endpoints.processReminders({}, job);
    assert.equal((await app.endpoints.listReminders({}, user(101))).tasks.length, 0);
  } finally { app.close(); }
});

test('recurring snooze is an idempotent separate copy, stale callbacks are rejected and deleting cancels pending copies', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const { task } = await app.endpoints.createReminder(input('snooze'), user(101));
    now = task.reminderAt; await app.endpoints.processReminders({}, job);
    const before = (await app.endpoints.getReminder({ id: task.id }, user(101))).task;
    const callback = { id: task.id, occurrenceAt: task.dueAt, userId: 101 };
    await assert.rejects(app.endpoints.snoozeReminder(callback, user(202)), code('NOT_FOUND'));
    const copies = await Promise.all([app.endpoints.snoozeReminder(callback, user(101)), app.endpoints.snoozeReminder(callback, user(101))]);
    assert.equal(copies[0].task.id, copies[1].task.id); assert.notEqual(copies[0].task.id, task.id);
    assert.equal(copies[0].task.dueAt, now + 600000); assert.equal(copies[0].task.recurrence, null);
    assert.equal((await app.endpoints.getReminder({ id: task.id }, user(101))).task.dueAt, before.dueAt);
    assert.equal((await app.endpoints.listReminders({}, user(101))).counts.active, 2);
    now = before.reminderAt; await app.endpoints.processReminders({}, job);
    await assert.rejects(app.endpoints.snoozeReminder(callback, user(101)), code('VALIDATION_ERROR'));
    const nextCopy = await app.endpoints.snoozeReminder({ id: task.id, occurrenceAt: before.dueAt }, user(101));
    await app.endpoints.deleteReminder({ id: task.id }, user(101));
    assert.equal((await app.endpoints.listReminders({ status: 'all' }, user(101))).tasks.length, 0);
    now = nextCopy.task.dueAt; assert.equal((await app.endpoints.processReminders({}, job)).sent, 0);
  } finally { app.close(); }
});
