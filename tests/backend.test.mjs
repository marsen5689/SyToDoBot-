import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtime } from './sqlite-runtime.mjs';

const user = (id) => ({ initData: { user: { id, first_name: `User ${id}` } } });
const create = (title = 'Моя задача', requestId = 'test-request-00000001') => ({ title, requestId });
const hasCode = (code) => (error) => error.parameters?.code === code;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('CRUD persists across a new runtime, completion and deletion', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sytodo-test-'));
  const filename = path.join(folder, 'db.sqlite');
  let app = await runtime(filename);
  try {
    const { task } = await app.endpoints.createTask({ ...create(), title: '  Написать план  ', note: 'Детали', priority: 'high' }, user(101));
    assert.equal(task.title, 'Написать план');
    assert.equal(task.completed, false);
    assert.equal('userId' in task, false);
    assert.equal('requestKey' in task, false);
    const done = await app.endpoints.setTaskCompleted({ id: task.id, completed: true }, user(101));
    assert.equal(done.task.completed, true);
    app.close();
    app = await runtime(filename);
    const saved = await app.endpoints.listTasks({ status: 'completed' }, user(101));
    assert.equal(saved.tasks[0].id, task.id);
    assert.deepEqual(plain(saved.counts), { active: 0, completed: 1 });
    await app.endpoints.setTaskCompleted({ id: task.id, completed: false }, user(101));
    await app.endpoints.deleteTask({ id: task.id }, user(101));
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks.length, 0);
  } finally { app.close(); await rm(folder, { recursive: true, force: true }); }
});

test('ownership cannot be overridden by client IDs, including mutations and counts', async () => {
  const app = await runtime();
  try {
    const a = await app.endpoints.createTask({ ...create(), userId: 202 }, user(101));
    await app.endpoints.createTask({ ...create('Другая задача'), userId: 101 }, user(202));
    const list = await app.endpoints.listTasks({ status: 'all', userId: 202 }, user(101));
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].title, 'Моя задача');
    assert.deepEqual(plain(list.counts), { active: 1, completed: 0 });
    await assert.rejects(app.endpoints.setTaskCompleted({ id: a.task.id, completed: true, userId: 101 }, user(202)), hasCode('NOT_FOUND'));
    await assert.rejects(app.endpoints.deleteTask({ id: a.task.id, userId: 101 }, user(202)), hasCode('NOT_FOUND'));
    await assert.rejects(app.endpoints.deleteTask({ id: 99999 }, user(202)), hasCode('NOT_FOUND'));
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks[0].completed, false);
  } finally { app.close(); }
});

test('create retries are idempotent and keys are isolated per user', async () => {
  const app = await runtime();
  try {
    const first = await app.endpoints.createTask(create(), user(101));
    const second = await app.endpoints.createTask(create(), user(101));
    assert.equal(first.task.id, second.task.id);
    assert.equal((await app.endpoints.listTasks({}, user(101))).counts.active, 1);
    const other = await app.endpoints.createTask(create(), user(202));
    assert.notEqual(first.task.id, other.task.id);
    // Concurrent retries also converge to one row.
    const results = await Promise.all(Array.from({ length: 5 }, () => app.endpoints.createTask(create('Concurrent', 'test-request-concurrent'), user(101))));
    assert.equal(new Set(results.map((result) => result.task.id)).size, 1);
  } finally { app.close(); }
});

test('all endpoints require a valid verified-context user', async () => {
  const app = await runtime();
  try {
    for (const endpoint of Object.values(app.endpoints)) {
      for (const context of [{}, { user: { id: 101 } }, user(-1), user('101'), user(Number.MAX_SAFE_INTEGER + 1)]) {
        await assert.rejects(endpoint({ ...create(), id: 1, completed: true }, context), hasCode('UNAUTHORIZED'));
      }
    }
    const profile = await app.endpoints.getProfile({ userId: 202 }, user(101));
    assert.equal(profile.id, 101);
  } finally { app.close(); }
});

test('invalid input is rejected; SQL-like titles remain literal data', async () => {
  const app = await runtime();
  try {
    for (const input of [null, [], {}, create('  '), create('x'.repeat(201)), create('a\u0000b'), { ...create(), note: 12 }, { ...create(), note: 'x'.repeat(1001) }, { ...create(), priority: 'urgent' }, { ...create(), requestId: '../bad' }]) {
      await assert.rejects(app.endpoints.createTask(input, user(101)), hasCode('VALIDATION_ERROR'));
    }
    for (const id of [0, -1, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(app.endpoints.deleteTask({ id }, user(101)), hasCode('VALIDATION_ERROR'));
    await assert.rejects(app.endpoints.setTaskCompleted({ id: 1, completed: 'false' }, user(101)), hasCode('VALIDATION_ERROR'));
    await assert.rejects(app.endpoints.listTasks({ status: 'invalid' }, user(101)), hasCode('VALIDATION_ERROR'));
    await assert.rejects(app.endpoints.listTasks({ cursor: '1' }, user(101)), hasCode('VALIDATION_ERROR'));
    const title = "'); DROP TABLE tasks; --";
    await app.endpoints.createTask(create(title), user(101));
    assert.equal((await app.endpoints.listTasks({}, user(101))).tasks[0].title, title);
  } finally { app.close(); }
});

test('pagination and filters return every owned task exactly once', async () => {
  const app = await runtime();
  try {
    for (let i = 0; i < 67; i++) {
      const { task } = await app.endpoints.createTask(create(`Задача ${i}`, `pagination-request-${String(i).padStart(4, '0')}`), user(i === 66 ? 202 : 101));
      if (i < 66 && i % 2 === 0) await app.endpoints.setTaskCompleted({ id: task.id, completed: true }, user(101));
    }
    let cursor, ids = [];
    do {
      const page = await app.endpoints.listTasks({ status: 'all', cursor }, user(101));
      assert(page.tasks.length <= 30);
      assert.deepEqual(plain(page.counts), { active: 33, completed: 33 });
      ids.push(...page.tasks.map((task) => task.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 66);
    assert.equal(new Set(ids).size, 66);
    assert(ids.every((id, i) => i === 0 || id < ids[i - 1]));
    assert((await app.endpoints.listTasks({ status: 'active' }, user(101))).tasks.every((task) => !task.completed));
    assert((await app.endpoints.listTasks({ status: 'completed' }, user(101))).tasks.every((task) => task.completed));
  } finally { app.close(); }
});
