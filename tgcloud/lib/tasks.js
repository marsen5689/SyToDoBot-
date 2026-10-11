import { EndpointError } from 'sdk';
import { eq, and, like, notLike } from 'sdk/db';
import { tasks } from '../schema.js';
import { remindersEnabled } from './reminder-config.js';

// Ownership and idempotency keys stay private.
export const taskColumns = {
  id: tasks.id, title: tasks.title, note: tasks.note, priority: tasks.priority,
  completed: tasks.completed, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt,
  dueAt: tasks.dueAt, dueOffsetMinutes: tasks.dueOffsetMinutes,
  reminderMinutes: tasks.reminderMinutes, reminderAt: tasks.reminderAt, reminderSentAt: tasks.reminderSentAt,
};

export function currentUser(ctx) {
  const user = ctx?.initData?.user;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) {
    throw new EndpointError('Откройте приложение через Telegram.', { code: 'UNAUTHORIZED' });
  }
  return user;
}

export function objectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EndpointError('Некорректный запрос.', { code: 'VALIDATION_ERROR' });
  }
  return input;
}

export function positiveId(value, field = 'id') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EndpointError('Некорректный идентификатор.', { code: 'VALIDATION_ERROR', field });
  }
  return value;
}

// Separate server-owned idempotency namespaces distinguish standalone reminders
// from legacy task records without changing the deployed SQLite schema.
// Client requestId validation excludes ':'; createTask cannot forge this prefix.
export function recordScope(userId, kind = 'task') {
  return and(eq(tasks.userId, userId), kind === 'reminder'
    ? like(tasks.requestKey, 'reminder:%') : notLike(tasks.requestKey, 'reminder:%'));
}

export function ownedTask(userId, id, kind = 'task') {
  return and(recordScope(userId, kind), eq(tasks.id, id));
}

export function notFound() {
  throw new EndpointError('Задача не найдена. Обновите список.', { code: 'NOT_FOUND' });
}

export function createInput(input) {
  objectInput(input);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const note = input.note === undefined ? '' : typeof input.note === 'string' ? input.note.trim() : null;
  const priority = input.priority ?? 'normal';
  if (!title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new EndpointError('Название: от 1 до 200 символов, без переносов строк.', {
      code: 'VALIDATION_ERROR', field: 'title',
    });
  }
  if (note === null || note.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    throw new EndpointError('Описание: не более 1000 символов.', { code: 'VALIDATION_ERROR', field: 'note' });
  }
  if (!['low', 'normal', 'high'].includes(priority)) {
    throw new EndpointError('Некорректный приоритет.', { code: 'VALIDATION_ERROR', field: 'priority' });
  }
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId)) {
    throw new EndpointError('Некорректный ключ запроса.', { code: 'VALIDATION_ERROR', field: 'requestId' });
  }
  return { title, note, priority, requestId: input.requestId, ...scheduleInput(input) };
}

export function scheduleInput(input) {
  objectInput(input);
  const dueAt = input.dueAt ?? null;
  const dueOffsetMinutes = dueAt === null ? 0 : (input.dueOffsetMinutes ?? 0);
  if (dueAt !== null && (!Number.isSafeInteger(dueAt) || dueAt < 946684800000 || dueAt >= 4102444800000)) {
    throw new EndpointError('Выберите корректные дату и время дедлайна (2000–2099).', { code: 'VALIDATION_ERROR', field: 'dueAt' });
  }
  if (!Number.isSafeInteger(dueOffsetMinutes) || Math.abs(dueOffsetMinutes) > 840) {
    throw new EndpointError('Некорректный часовой пояс.', { code: 'VALIDATION_ERROR', field: 'dueAt' });
  }
  const reminderMinutes = input.reminderMinutes ?? null;
  if (reminderMinutes !== null && (!Number.isSafeInteger(reminderMinutes) || ![0, 15, 60, 1440].includes(reminderMinutes) || dueAt === null)) {
    throw new EndpointError('Укажите дедлайн и выберите время напоминания.', { code: 'VALIDATION_ERROR', field: 'reminderMinutes' });
  }
  return { dueAt, dueOffsetMinutes, reminderMinutes, reminderAt: reminderMinutes === null ? null : dueAt - reminderMinutes * 60000 };
}

export function validateNewReminder(schedule, now) {
  if (schedule.reminderMinutes !== null && !remindersEnabled) {
    throw new EndpointError('Автоматические напоминания пока не подключены.', { code: 'REMINDERS_UNAVAILABLE', field: 'reminderMinutes' });
  }
  if (schedule.reminderAt !== null && schedule.reminderAt <= now) {
    throw new EndpointError('Время напоминания уже прошло. Выберите более поздний дедлайн или другой интервал.', { code: 'VALIDATION_ERROR', field: 'reminderMinutes' });
  }
}
