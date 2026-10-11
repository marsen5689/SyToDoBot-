import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './sqlite-runtime.mjs';

const sender = (id = 101) => ({ id, first_name: '<Анна & друзья>', username: 'anna', is_bot: false });
const message = (text, id = 101, messageId = 1) => ({ text, message_id: messageId, from: sender(id), chat: { id, type: 'private' } });
const callback = (data, id = 101, chatId = id) => ({ id: 'query-1', data, from: sender(id), message: { message_id: 500, chat: { id: chatId, type: 'private' } } });
const ctx = (id = 101) => ({ initData: { user: sender(id) } });
const last = (app, method = 'sendMessage') => app.calls.filter((call) => call.method === method).at(-1)?.params;

test('start registers all commands and the Mini App menu, with safe profile text', async () => {
  const app = await runtime();
  try {
    await app.handlers.message(message('/start'));
    const greeting = last(app);
    assert(greeting.text.includes('&lt;Анна &amp; друзья&gt;'));
    assert(greeting.reply_markup.inline_keyboard.flat().some((button) => button.web_app?.url.endsWith('?action=new')));
    const config = last(app, 'setChatMenuButton');
    assert.equal(config.chat_id, 101);
    assert.equal(config.menu_button.type, 'web_app');
    const registered = last(app, 'setMyCommands');
    assert.deepEqual(registered.scope, { type: 'chat', chat_id: 101 });
    for (const { command } of registered.commands) {
      await app.handlers.message(message(`/${command}`, 101, 10));
      assert(last(app), `No reply for /${command}`);
      assert(!last(app).text.includes('Такой команды'));
    }
    await app.handlers.message(message('/start@SyToDoBot deep-link'));
    assert(last(app).text.includes('Привет'));
    const count = app.calls.length;
    await app.handlers.message(message('/start@OtherBot'));
    assert.equal(app.calls.length, count);
  } finally { app.close(); }
});

test('chat CRUD and Mini App share records; duplicate Telegram deliveries do not duplicate tasks', async () => {
  const app = await runtime();
  try {
    await app.handlers.message(message('/add Написать план', 101, 77));
    await app.handlers.message(message('/add Написать план', 101, 77));
    let list = await app.endpoints.listTasks({}, ctx());
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].title, 'Написать план');
    const id = list.tasks[0].id;
    await app.handlers.message(message('/tasks'));
    assert(last(app).text.includes('Написать план'));
    await app.handlers.message(message(`/done ${id}`));
    assert.equal((await app.endpoints.listTasks({ status: 'completed' }, ctx())).tasks[0].id, id);
    await app.handlers.message(message(`/undo ${id}`));
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks[0].completed, false);
    await app.handlers.message(message(`/delete ${id}`));
    assert(last(app).reply_markup.inline_keyboard.flat().some((button) => button.callback_data === `task:delete:${id}`));
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks.length, 1);
    await app.handlers.callback_query(callback('cancel'));
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks.length, 1);
    await app.handlers.callback_query(callback(`task:delete:${id}`));
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks.length, 0);
  } finally { app.close(); }
});

test('callbacks acknowledge before editing, completing and reopening are idempotent', async () => {
  const app = await runtime();
  try {
    const { task } = await app.endpoints.createTask({ title: 'Задача', requestId: 'bot-callback-test-01' }, ctx());
    for (const data of ['home', 'help', 'profile', 'stats', 'list:active', 'list:completed', 'list:all', `task:done:${task.id}`, `task:done:${task.id}`, `task:undo:${task.id}`, `task:ask_delete:${task.id}`, 'cancel', 'obsolete']) {
      app.calls.length = 0;
      await app.handlers.callback_query(callback(data));
      assert.equal(app.calls[0].method, 'answerCallbackQuery');
      assert.equal(app.calls.at(-1).method, 'editMessageText');
    }
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks[0].completed, false);
  } finally { app.close(); }
});

test('commands and forged callback task IDs cannot read, change, or delete another user records', async () => {
  const app = await runtime();
  try {
    await app.handlers.message(message('/add Секрет Анны', 101, 90));
    const { tasks: [task] } = await app.endpoints.listTasks({}, ctx());
    await app.handlers.message(message('/tasks', 202));
    assert(!last(app).text.includes('Секрет Анны'));
    for (const command of [`/done ${task.id}`, `/undo ${task.id}`, `/delete ${task.id}`]) {
      await app.handlers.message(message(command, 202));
      assert(last(app).text.includes('Задача не найдена'));
    }
    for (const data of [`task:done:${task.id}`, `task:ask_delete:${task.id}`, `task:delete:${task.id}`]) {
      await app.handlers.callback_query(callback(data, 202));
      assert(last(app, 'editMessageText').text.includes('Задача не найдена'));
    }
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks[0].completed, false);
    app.calls.length = 0;
    await app.handlers.message({ ...message('/tasks'), chat: { id: -100, type: 'group' } });
    await app.handlers.message({ ...message('/tasks'), from: sender(202) });
    assert.equal(app.calls.length, 0);
    await app.handlers.callback_query(callback(`task:delete:${task.id}`, 202, 101));
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].params.show_alert, true);
    assert.equal((await app.endpoints.listTasks({}, ctx())).tasks.length, 1);
  } finally { app.close(); }
});

test('list pagination is bounded, command errors are helpful, and user HTML is escaped', async () => {
  const app = await runtime();
  try {
    for (let i = 0; i < 12; i++) await app.handlers.message(message(`/add <b>Задача ${i}</b>`, 101, 100 + i));
    await app.handlers.message(message('/all'));
    const page = last(app);
    assert(page.text.includes('&lt;b&gt;'));
    const next = page.reply_markup.inline_keyboard.flat().find((button) => button.callback_data?.startsWith('list:all:'));
    assert(next);
    assert.equal(page.reply_markup.inline_keyboard.flat().filter((button) => button.callback_data?.startsWith('task:done:')).length, 5);
    await app.handlers.callback_query(callback(next.callback_data));
    assert(last(app, 'editMessageText').reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'list:all'));
    for (const text of ['/done nope', '/done 0', '/delete 1.5', '/unknown', '/add', '/add ' + 'a'.repeat(201), 'Привет']) {
      await app.handlers.message(message(text));
      assert(last(app).text.length > 0);
      assert(!last(app).text.includes('Не удалось выполнить действие'));
    }
  } finally { app.close(); }
});

test('menu setup failure does not block start and an unchanged callback edit is harmless', async () => {
  const app = await runtime(':memory:', { api(method, params, BotApiError) {
    if (method === 'setMyCommands' || method === 'setChatMenuButton') throw new BotApiError(429, 'Too Many Requests');
    if (method === 'editMessageText') throw new BotApiError(400, 'Bad Request: message is not modified');
    return { message_id: 500, ...params };
  } });
  try {
    await app.handlers.message(message('/start'));
    assert(last(app).text.includes('Привет'));
    await app.handlers.callback_query(callback('home'));
    assert.equal(app.calls.at(-1).method, 'editMessageText');
  } finally { app.close(); }
});
