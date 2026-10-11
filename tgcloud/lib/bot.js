import { api, EndpointError, BotApiError } from 'sdk';
import { positiveId } from './tasks.js';
import { listUserTasks, taskCounts, getUserTask } from './task-service.js';

export const APP_URL = 'https://app8347651382.tgcloud.ai/';
export const BOT_USERNAME = 'SyToDoBot';
export const commands = [
  { command: 'start', description: 'Начать и открыть главное меню' },
  { command: 'app', description: 'Задачи и напоминания в одном приложении' },
  { command: 'menu', description: 'Показать главное меню' },
  { command: 'tasks', description: 'Мои активные задачи' },
  { command: 'reminders', description: 'Мои отдельные напоминания' },
  { command: 'remind', description: 'Создать напоминание с датой и временем' },
  { command: 'completed', description: 'Мои выполненные задачи' },
  { command: 'all', description: 'Все мои задачи' },
  { command: 'add', description: 'Создать: /add название задачи' },
  { command: 'done', description: 'Выполнить: /done ID' },
  { command: 'undo', description: 'Вернуть в активные: /undo ID' },
  { command: 'delete', description: 'Удалить с подтверждением: /delete ID' },
  { command: 'profile', description: 'Мой Telegram-профиль' },
  { command: 'stats', description: 'Статистика моих задач' },
  { command: 'help', description: 'Команды и помощь' },
  { command: 'cancel', description: 'Закрыть действие и вернуться в меню' },
];

export function privateUser(message, sender = message?.from) {
  if (message?.chat?.type !== 'private' || sender?.is_bot || !Number.isSafeInteger(sender?.id) || sender.id <= 0
    || message.chat.id !== sender.id) return null;
  return sender;
}

export function html(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function formatDeadline(task) {
  if (task.dueAt === null) return '';
  const local = new Date(task.dueAt + task.dueOffsetMinutes * 60000).toISOString();
  const offset = task.dueOffsetMinutes;
  const sign = offset < 0 ? '−' : '+';
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${local.slice(8, 10)}.${local.slice(5, 7)}.${local.slice(0, 4)} ${local.slice(11, 16)} (UTC${sign}${hours}:${minutes})`;
}

export function appButton(text = 'Открыть SyToDo', query = '') {
  return { text, web_app: { url: APP_URL + query } };
}

export function navigation() {
  return [[appButton('＋ Новая задача', '?action=new'), appButton('＋ Напоминание', '?view=reminders&action=new')], [
    { text: '📋 Активные', callback_data: 'list:active' },
    { text: '✓ Выполненные', callback_data: 'list:completed' },
  ], [{ text: '🔔 Напоминания', callback_data: 'reminders:active' }], [{ text: 'Все задачи', callback_data: 'list:all' }, { text: 'Статистика', callback_data: 'stats' }], [{ text: '← Главное меню', callback_data: 'home' }]];
}

export function home(user, welcome = false) {
  return {
    text: `${welcome ? `Привет, ${html(user.first_name || 'друг')}!\n\n` : ''}<b>SyToDo — ваши планы в своём ритме.</b>\n\nЗадачи и отдельные напоминания — в одном боте. Создавайте задачи в приложении или прямо здесь: <code>/add Купить продукты</code>. Для сообщения в нужный момент откройте /remind. Данные в чате и Mini App общие и видны только вам.\n\nВыберите, с чего начать:`,
    reply_markup: { inline_keyboard: [
      [appButton()], [appButton('＋ Создать задачу', '?action=new'), appButton('＋ Напоминание', '?view=reminders&action=new')],
      [{ text: '🔔 Мои напоминания', callback_data: 'reminders:active' }],
      [{ text: '📋 Активные задачи', callback_data: 'list:active' }, { text: '✓ Выполненные', callback_data: 'list:completed' }],
      [{ text: 'Все задачи', callback_data: 'list:all' }],
      [{ text: '👤 Мой профиль', callback_data: 'profile' }, { text: '📊 Статистика', callback_data: 'stats' }],
      [{ text: 'Как пользоваться', callback_data: 'help' }],
    ] },
  };
}

export function help() {
  return {
    text: '<b>Как пользоваться SyToDo</b>\n\n/start, /menu — главное меню\n/app — открыть приложение\n/tasks — активные задачи\n/reminders — отдельные напоминания\n/remind — создать напоминание в календаре\n/completed — выполненные\n/all — все задачи\n/add Купить продукты — создать задачу\n/done 42 — выполнить задачу №42\n/undo 42 — вернуть её в активные\n/delete 42 — удалить с подтверждением\n/profile — ваш профиль\n/stats — статистика\n/cancel — вернуться в меню\n/help — эта справка\n\nНапоминания работают отдельно от задач. Выберите дату и прокрутите часы и минуты в Mini App. Бот напишет в личный чат; из сообщения можно отложить напоминание на 10 минут. Возможна задержка отправки. Номер задачи указан в списке; можно пользоваться кнопками под сообщением.',
    reply_markup: { inline_keyboard: navigation() },
  };
}

export function profile(user) {
  const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || 'Пользователь Telegram';
  return {
    text: `<b>Ваш Telegram-профиль</b>\n\n${html(name)}${user.username ? `\n@${html(user.username)}` : ''}\nID: <code>${user.id}</code>\n\nПолный профиль и задачи доступны в Mini App.`,
    reply_markup: { inline_keyboard: [[appButton('Открыть мой профиль')], [{ text: '← Главное меню', callback_data: 'home' }]] },
  };
}

export async function stats(userId) {
  const counts = await taskCounts(userId);
  const total = counts.active + counts.completed;
  const progress = total ? Math.round(counts.completed / total * 100) : 0;
  return { text: `<b>Ваш прогресс</b>\n\n📋 Активных: ${counts.active}\n✓ Выполнено: ${counts.completed}\nВсего: ${total}\nПрогресс: ${progress}%\n\n${total ? 'Каждый маленький шаг считается.' : 'Добавьте первую задачу — начало положено.'}`, reply_markup: { inline_keyboard: navigation() } };
}

export async function taskList(userId, status = 'active', cursor) {
  const page = await listUserTasks(userId, { status, cursor }, 5);
  const headings = { active: 'Активные задачи', completed: 'Выполненные задачи', all: 'Все задачи' };
  const lines = page.tasks.map((task) => `${task.completed ? '✓' : '○'} <b>${html(task.title)}</b>\n№<code>${task.id}</code>${task.priority === 'high' ? ' · Важная' : ''}${task.dueAt !== null ? `\nДедлайн: ${formatDeadline(task)}` : ''}${task.note ? `\n${html(task.note.slice(0, 120))}${task.note.length > 120 ? '…' : ''}` : ''}`);
  const keyboard = page.tasks.map((task) => [
    { text: `${task.completed ? '↩ Вернуть' : '✓ Выполнить'} №${task.id}`, callback_data: `task:${task.completed ? 'undo' : 'done'}:${task.id}` },
    { text: `Удалить №${task.id}`, callback_data: `task:ask_delete:${task.id}` },
  ]);
  if (page.nextCursor) keyboard.push([{ text: 'Следующие 5 →', callback_data: `list:${status}:${page.nextCursor}` }]);
  if (cursor) keyboard.push([{ text: '↑ К началу списка', callback_data: `list:${status}` }]);
  keyboard.push([appButton('Открыть список в приложении', `?filter=${status}`)]);
  keyboard.push(...navigation());
  return { text: `<b>${headings[status]}</b>\nВ планах: ${page.counts.active} · Готово: ${page.counts.completed}\n\n${lines.length ? lines.join('\n\n') : cursor ? 'На этой странице задач больше нет. Вернитесь к началу списка.' : status === 'completed' ? 'Здесь появятся ваши выполненные задачи.' : 'Пока пусто. Добавьте задачу через /add или в приложении.'}`, reply_markup: { inline_keyboard: keyboard } };
}

export function taskResult(task, completed) {
  return {
    text: `<b>${completed === undefined ? 'Задача сохранена' : completed ? 'Задача выполнена ✓' : 'Задача снова в активных'}</b>\n\n${html(task.title)}\n№<code>${task.id}</code>`,
    reply_markup: { inline_keyboard: [[
      { text: task.completed ? '↩ Вернуть в активные' : '✓ Выполнить', callback_data: `task:${task.completed ? 'undo' : 'done'}:${task.id}` },
      { text: 'Удалить', callback_data: `task:ask_delete:${task.id}` },
    ], ...navigation()] },
  };
}

export async function confirmDelete(userId, id) {
  const task = await getUserTask(userId, id);
  return { text: `<b>Удалить задачу?</b>\n\n${html(task.title)}\n№<code>${task.id}</code>\n\nЭто действие удалит задачу и из Mini App.`, reply_markup: { inline_keyboard: [[
    { text: 'Да, удалить', callback_data: `task:delete:${task.id}` },
    { text: 'Оставить', callback_data: 'cancel' },
  ]] } };
}

export async function reminderList(userId, status = 'active', cursor) {
  const page = await listUserTasks(userId, { status, cursor }, 5, 'reminder');
  const headings = { active: 'Предстоящие напоминания', completed: 'Отправленные напоминания', all: 'Все напоминания' };
  const lines = page.tasks.map(item => `<b>${html(item.title)}</b>\n${formatDeadline(item)}\n№<code>${item.id}</code> · ${item.reminderSentAt !== null ? 'Отправлено' : item.reminderAt === null ? 'Отправка приостановлена' : 'Запланировано'}`);
  const keyboard = page.tasks.map(item => [appButton(`Изменить №${item.id}`, `?view=reminders&edit=${item.id}`),
    { text: `Удалить №${item.id}`, callback_data: `reminder:ask_delete:${item.id}` }]);
  if (page.nextCursor) keyboard.push([{ text: 'Следующие 5 →', callback_data: `reminders:${status}:${page.nextCursor}` }]);
  keyboard.push([{ text: 'Предстоящие', callback_data: 'reminders:active' }, { text: 'Отправленные', callback_data: 'reminders:completed' }]);
  keyboard.push([appButton('＋ Создать напоминание', '?view=reminders&action=new')], [{ text: '← Главное меню', callback_data: 'home' }]);
  return { text: `<b>${headings[status]}</b>\nОжидают: ${page.counts.active} · Отправлено: ${page.counts.completed}\n\n${lines.length ? lines.join('\n\n') : 'Здесь пока пусто. Создайте напоминание с датой и временем.'}`, reply_markup: { inline_keyboard: keyboard } };
}

export async function confirmReminderDelete(userId, id) {
  const item = await getUserTask(userId, id, 'reminder');
  return { text: `<b>Удалить напоминание?</b>\n\n${html(item.title)}\n№<code>${item.id}</code>\n\nОжидающая отправка будет отменена.`, reply_markup: { inline_keyboard: [[
    { text: 'Да, удалить', callback_data: `reminder:delete:${item.id}` },
    { text: 'Оставить', callback_data: 'reminders:active' },
  ]] } };
}

export function commandId(argument) {
  if (!/^[1-9]\d{0,15}$/.test(argument)) throw new EndpointError('Укажите номер задачи. Например: /done 42. Номер есть в списке /tasks.', { code: 'VALIDATION_ERROR' });
  return positiveId(Number(argument));
}

export function errorView(error) {
  const expected = error instanceof EndpointError;
  if (!expected) console.error('Bot action failed');
  return { text: expected ? html(error.message) : 'Не удалось выполнить действие. Попробуйте ещё раз. Если вы создавали задачу, сначала проверьте список /tasks.', reply_markup: { inline_keyboard: navigation() } };
}

export async function render(chatId, view, messageId) {
  const params = { chat_id: chatId, ...view, parse_mode: 'HTML' };
  if (messageId === undefined) return await api.sendMessage(params);
  try { return await api.editMessageText({ ...params, message_id: messageId }); }
  catch (error) {
    if (error instanceof BotApiError && error.code === 400 && /message is not modified/i.test(error.description)) return;
    if (error instanceof BotApiError && error.code === 400 && /message to edit not found|message can.t be edited/i.test(error.description)) return await api.sendMessage(params);
    throw error;
  }
}

export async function setupMenu(chatId) {
  // Runs on /start and /menu after deployment, never during local implementation.
  try { await api.setMyCommands({ commands, scope: { type: 'chat', chat_id: chatId } }); }
  catch { console.warn('Could not configure the chat command list'); }
  try { await api.setChatMenuButton({ chat_id: chatId, menu_button: { type: 'web_app', text: 'SyToDo', web_app: { url: APP_URL } } }); }
  catch { console.warn('Could not configure the Mini App menu button'); }
}
