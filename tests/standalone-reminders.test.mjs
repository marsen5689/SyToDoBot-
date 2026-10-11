import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtime } from './sqlite-runtime.mjs';

const user = id => ({ initData: { user: { id, first_name: 'Test' } } });
const job = { ...user(8347651382), maintenanceJob: 'sytodo-reminders' };
const START = Date.UTC(2026, 9, 11, 12);
const input = (suffix = 'new', dueAt = START + 60000) => ({ title: 'Позвонить <родителям>', note: 'Вспомнить & рассказать новости',
  requestId: `standalone-reminder-${suffix}`, dueAt, dueOffsetMinutes: 180 });
const code = value => error => error.parameters?.code === value;

test('standalone reminders persist separately from tasks and cannot forge namespaces', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-standalone-'));
  const filename = path.join(folder, 'sqlite.db');
  let app = await runtime(filename, { now: () => START });
  try {
    const data = input();
    const normal = (await app.endpoints.createTask({ ...data, kind: 'reminder', userId: 202 }, user(101))).task;
    const reminder = (await app.endpoints.createReminder({ ...data, userId: 202, reminderMinutes: null }, user(101))).task;
    assert.notEqual(normal.id, reminder.id);
    assert.equal(reminder.reminderMinutes, 0);
    assert.equal(reminder.reminderAt, data.dueAt);
    assert.equal((await app.endpoints.listTasks({ status: 'all' }, user(101))).tasks.length, 1);
    assert.equal((await app.endpoints.listReminders({ status: 'all' }, user(101))).tasks.length, 1);
    assert.deepEqual({ ...(await app.endpoints.listTasks({}, user(101))).counts }, { active: 1, completed: 0 });
    assert.deepEqual({ ...(await app.endpoints.listReminders({}, user(101))).counts }, { active: 1, completed: 0 });
    assert.equal((await app.endpoints.createReminder(data, user(101))).task.id, reminder.id);
    await assert.rejects(app.endpoints.createTask({ ...data, requestId: 'reminder:forged-key-123' }, user(101)), code('VALIDATION_ERROR'));
    app.close(); app = await runtime(filename, { now: () => START });
    assert.equal((await app.endpoints.getReminder({ id: reminder.id }, user(101))).task.title, data.title);
    assert.equal((await app.endpoints.listReminders({}, user(202))).tasks.length, 0);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('all reminder endpoints reject other owners and cross-kind IDs', async () => {
  const app = await runtime(':memory:', { now: () => START });
  try {
    const normal = (await app.endpoints.createTask(input('normal'), user(101))).task;
    const reminder = (await app.endpoints.createReminder(input(), user(101))).task;
    for (const name of ['getReminder', 'updateReminder', 'snoozeReminder', 'deleteReminder']) {
      const payload = { ...input(), id: reminder.id, userId: 101 };
      await assert.rejects(app.endpoints[name](payload, user(202)), code('NOT_FOUND'));
      await assert.rejects(app.endpoints[name]({ ...payload, id: normal.id }, user(101)), code('NOT_FOUND'));
      await assert.rejects(app.endpoints[name](payload, {}), code('UNAUTHORIZED'));
    }
    for (const name of ['setTaskCompleted', 'setTaskSchedule', 'deleteTask']) {
      await assert.rejects(app.endpoints[name]({ ...input(), id: reminder.id, completed: true }, user(101)), code('NOT_FOUND'));
    }
    for (const name of ['createReminder', 'listReminders']) await assert.rejects(app.endpoints[name](input(), {}), code('UNAUTHORIZED'));
    assert.equal((await app.endpoints.listReminders({ userId: 101 }, user(202))).tasks.length, 0);
  } finally { app.close(); }
});

test('standalone dates are required, future-only, and depend on enabled scheduling', async () => {
  const app = await runtime(':memory:', { now: () => START });
  const disabled = await runtime(':memory:', { now: () => START, remindersEnabled: false });
  try {
    for (const dueAt of [null, undefined, START, START - 1, '2026-10-11', NaN]) {
      await assert.rejects(app.endpoints.createReminder({ ...input(), dueAt }, user(101)), code('VALIDATION_ERROR'));
    }
    await assert.rejects(disabled.endpoints.createReminder(input(), user(101)), code('REMINDERS_UNAVAILABLE'));
    const reminder = (await app.endpoints.createReminder(input(), user(101))).task;
    await assert.rejects(app.endpoints.updateReminder({ ...input(), id: reminder.id, dueAt: START - 1 }, user(101)), code('VALIDATION_ERROR'));
    await app.endpoints.deleteReminder({ id: reminder.id }, user(101));
    assert.equal((await app.endpoints.processReminders({}, job)).sent, 0);
  } finally { app.close(); disabled.close(); }
});

test('real worker flow sends standalone reminders once, maintains history, and rearms only changed schedules', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  try {
    const reminder = (await app.endpoints.createReminder(input(), user(101))).task;
    now += 60000;
    await Promise.all([app.endpoints.processReminders({}, job), app.endpoints.processReminders({}, job)]);
    const sent = app.calls.filter(call => call.method === 'sendMessage');
    assert.equal(sent.length, 1); assert.equal(sent[0].params.chat_id, 101);
    assert.match(sent[0].params.text, /^<b>Напоминание<\/b>/);
    assert.match(sent[0].params.text, /&lt;родителям&gt;/);
    assert.match(sent[0].params.text, /Вспомнить &amp; рассказать/);
    assert.equal(sent[0].params.reply_markup.inline_keyboard[0][0].callback_data, `reminder:snooze:${reminder.id}`);
    assert.match(sent[0].params.reply_markup.inline_keyboard[1][0].web_app.url, /view=reminders/);
    assert.deepEqual({ ...(await app.endpoints.listReminders({}, user(101))).counts }, { active: 0, completed: 1 });
    assert.equal((await app.endpoints.listReminders({}, user(101))).tasks.length, 0);
    assert.equal((await app.endpoints.listReminders({ status: 'completed' }, user(101))).tasks.length, 1);
    assert.equal((await app.endpoints.createReminder(input(), user(101))).task.reminderSentAt, now);
    const renamed = await app.endpoints.updateReminder({ ...input(), id: reminder.id, title: 'Новое название' }, user(101));
    assert.equal(renamed.task.reminderSentAt, now);
    await app.endpoints.processReminders({}, job);
    assert.equal(app.calls.length, 1);
    await app.endpoints.updateReminder({ ...input(), id: reminder.id, dueAt: now + 60000 }, user(101));
    now += 60000;
    assert.equal((await app.endpoints.processReminders({}, job)).sent, 1);
    assert.deepEqual({ ...(await app.endpoints.listTasks({}, user(101))).counts }, { active: 0, completed: 0 });
  } finally { app.close(); }
});

test('chat reminders, deep links and snooze buttons share storage and reject forged ownership', async () => {
  let now = START;
  const app = await runtime(':memory:', { now: () => now });
  const message = text => ({ text, from: { id: 101 }, chat: { id: 101, type: 'private' }, message_id: 1 });
  const callback = (data, id = 101) => ({ id: 'callback-test', data, from: { id }, message: { message_id: 2, chat: { id, type: 'private' } } });
  try {
    await app.handlers.message(message('/remind'));
    assert.match(app.calls.at(-1).params.reply_markup.inline_keyboard[0][0].web_app.url, /view=reminders&action=new/);
    const reminder = (await app.endpoints.createReminder(input(), user(101))).task;
    await app.handlers.message(message('/reminders'));
    assert.match(app.calls.at(-1).params.text, /Предстоящие напоминания/);
    assert.match(app.calls.at(-1).params.reply_markup.inline_keyboard[0][0].web_app.url, new RegExp(`edit=${reminder.id}`));
    now += 60000; await app.endpoints.processReminders({}, job);
    await app.handlers.callback_query(callback(`reminder:snooze:${reminder.id}`, 202));
    assert.equal((await app.endpoints.getReminder({ id: reminder.id }, user(101))).task.reminderSentAt, now);
    await app.handlers.callback_query(callback(`reminder:snooze:${reminder.id}`));
    const moved = (await app.endpoints.getReminder({ id: reminder.id }, user(101))).task;
    assert.equal(moved.dueAt, now + 600000); assert.equal(moved.reminderSentAt, null);
    now += 1000;
    await Promise.all([app.endpoints.snoozeReminder({ id: reminder.id }, user(101)), app.endpoints.snoozeReminder({ id: reminder.id }, user(101))]);
    assert.equal((await app.endpoints.getReminder({ id: reminder.id }, user(101))).task.dueAt, moved.dueAt);
    now = moved.dueAt; assert.equal((await app.endpoints.processReminders({}, job)).sent, 1);
    await app.handlers.callback_query(callback(`reminder:ask_delete:${reminder.id}`));
    assert.match(app.calls.at(-1).params.text, /Удалить напоминание/);
    await app.handlers.callback_query(callback(`reminder:delete:${reminder.id}`));
    assert.equal((await app.endpoints.listReminders({ status: 'all' }, user(101))).tasks.length, 0);
  } finally { app.close(); }
});
