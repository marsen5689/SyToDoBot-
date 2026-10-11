import { BOT_USERNAME, privateUser, appButton, navigation, home, help, profile, stats, taskList, taskResult, confirmDelete, reminderList, commandId, render, setupMenu, errorView } from '../lib/bot.js';
import { createUserTask, completeUserTask } from '../lib/task-service.js';

export default async function message(input) {
  const user = privateUser(input);
  if (!user) return;
  const match = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(input.text?.trim() ?? '');
  if (match?.[2] && match[2].toLowerCase() !== BOT_USERNAME.toLowerCase()) return;
  const command = match?.[1].toLowerCase();
  const argument = match?.[3]?.trim() ?? '';
  let view;
  try {
    switch (command) {
      case 'start': case 'menu':
        await setupMenu(input.chat.id);
        view = home(user, command === 'start'); break;
      case 'help': view = help(); break;
      case 'app': view = { text: 'Ваши задачи, напоминания и профиль — в одном месте.', reply_markup: { inline_keyboard: [[appButton()], ...navigation()] } }; break;
      case 'tasks': case 'active': view = await taskList(user.id); break;
      case 'reminders': view = await reminderList(user.id); break;
      case 'remind': view = { text: 'О чём напомнить? Выберите дату в календаре и прокрутите часы и минуты. Напоминание сохранится отдельно от задач.',
        reply_markup: { inline_keyboard: [[appButton('＋ Создать напоминание', '?view=reminders&action=new')], [{ text: 'Мои напоминания', callback_data: 'reminders:active' }]] } }; break;
      case 'completed': view = await taskList(user.id, 'completed'); break;
      case 'all': view = await taskList(user.id, 'all'); break;
      case 'profile': view = profile(user); break;
      case 'stats': view = await stats(user.id); break;
      case 'add': case 'new':
        if (!argument) {
          view = { text: 'Что нужно сделать?\n\nОтправьте команду с названием: <code>/add Купить продукты</code>\n\nИли откройте форму в приложении — там можно добавить описание и приоритет.', reply_markup: { inline_keyboard: navigation() } }; break;
        }
        view = taskResult((await createUserTask(user.id, { title: argument, requestId: `telegram-message-${input.chat.id}-${commandId(String(input.message_id))}` })).task); break;
      case 'done': case 'undo':
        view = taskResult((await completeUserTask(user.id, { id: commandId(argument), completed: command === 'done' })).task, command === 'done'); break;
      case 'delete': view = await confirmDelete(user.id, commandId(argument)); break;
      case 'cancel': view = { ...home(user), text: 'Действие закрыто. Выберите, что сделать дальше.' }; break;
      default:
        view = { text: command ? 'Такой команды пока нет. Откройте /help или выберите действие ниже.' : 'Чтобы сохранить задачу, отправьте <code>/add Название задачи</code>. Все возможности доступны в приложении и меню ниже.', reply_markup: { inline_keyboard: navigation() } };
    }
  } catch (error) { view = errorView(error); }
  await render(input.chat.id, view);
}
