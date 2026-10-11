import { api } from 'sdk';
import { privateUser, home, help, profile, stats, taskList, taskResult, confirmDelete, commandId, navigation, render, errorView } from '../lib/bot.js';
import { completeUserTask, deleteUserTask } from '../lib/task-service.js';

export default async function callbackQuery(input) {
  const user = privateUser(input.message, input.from);
  // Telegram supplies from; callback_data never supplies an owner.
  if (!user || !Number.isSafeInteger(input.message?.message_id) || input.message.message_id <= 0) {
    await api.answerCallbackQuery({ callback_query_id: input.id, text: 'Откройте личный чат с ботом.', show_alert: true });
    return;
  }
  // Always dismiss the Telegram loading indicator before database operations.
  await api.answerCallbackQuery({ callback_query_id: input.id });
  let view;
  try {
    const data = typeof input.data === 'string' ? input.data : '';
    const list = /^list:(active|completed|all)(?::([1-9]\d{0,15}))?$/.exec(data);
    const task = /^task:(done|undo|ask_delete|delete):([1-9]\d{0,15})$/.exec(data);
    if (data === 'home') view = home(user);
    else if (data === 'cancel') view = { ...home(user), text: 'Удаление отменено. Задача осталась в вашем списке.' };
    else if (data === 'help') view = help();
    else if (data === 'profile') view = profile(user);
    else if (data === 'stats') view = await stats(user.id);
    else if (list) view = await taskList(user.id, list[1], list[2] ? commandId(list[2]) : undefined);
    else if (task) {
      const id = commandId(task[2]);
      if (task[1] === 'ask_delete') view = await confirmDelete(user.id, id);
      else if (task[1] === 'delete') {
        await deleteUserTask(user.id, { id });
        view = { text: 'Задача удалена из вашего списка и Mini App.', reply_markup: { inline_keyboard: navigation() } };
      } else {
        const completed = task[1] === 'done';
        view = taskResult((await completeUserTask(user.id, { id, completed })).task, completed);
      }
    } else view = { text: 'Кнопка больше не поддерживается. Откройте главное меню.', reply_markup: { inline_keyboard: navigation() } };
  } catch (error) { view = errorView(error); }
  await render(input.message.chat.id, view, input.message.message_id);
}
