import { db, EndpointError } from 'sdk';
import { and, or, lte, isNull, isNotNull, sql } from 'sdk/db';
import { tasks } from '../schema.js';
import { createInput, objectInput, positiveId, ownedTask, taskColumns, validateNewReminder, notFound } from './tasks.js';
import { createUserTask, getUserTask } from './task-service.js';

function reminderInput(input, editing = false) {
  objectInput(input);
  const validated = createInput({ ...input, priority: 'normal', reminderMinutes: 0,
    ...(editing ? { requestId: 'reminder-edit-input' } : {}) });
  if (validated.dueAt === null) throw new EndpointError('Укажите дату и время напоминания.', { code: 'VALIDATION_ERROR', field: 'dueAt' });
  return validated;
}

export async function createUserReminder(userId, input) {
  return await createUserTask(userId, reminderInput(input), 'reminder');
}

export async function updateUserReminder(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  const value = reminderInput(input, true);
  const current = await getUserTask(userId, id, 'reminder');
  const changed = current.dueAt !== value.dueAt || current.dueOffsetMinutes !== value.dueOffsetMinutes;
  if (changed) validateNewReminder(value, Date.now());
  const [task] = await db.update(tasks).set({ title: value.title, note: value.note, updatedAt: Date.now(),
    ...(changed ? { dueAt: value.dueAt, dueOffsetMinutes: value.dueOffsetMinutes,
      reminderAt: value.reminderAt, reminderMinutes: 0, reminderSentAt: null, reminderLeaseUntil: null,
      scheduleVersion: sql`${tasks.scheduleVersion} + 1` } : {}),
  }).where(ownedTask(userId, id, 'reminder')).returning(taskColumns).run();
  if (!task) notFound();
  return { task };
}

export async function snoozeUserReminder(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  const current = await getUserTask(userId, id, 'reminder');
  const now = Date.now();
  // A duplicate callback from an old message cannot move an already rearmed reminder.
  if (current.reminderSentAt === null && current.reminderAt !== null && current.reminderAt > now) return { task: current };
  const dueAt = now + 10 * 60000;
  validateNewReminder({ reminderAt: dueAt, reminderMinutes: 0 }, now);
  const [task] = await db.update(tasks).set({ dueAt, reminderAt: dueAt, reminderMinutes: 0,
    reminderSentAt: null, reminderLeaseUntil: null, updatedAt: now,
    scheduleVersion: sql`${tasks.scheduleVersion} + 1`,
  }).where(and(ownedTask(userId, id, 'reminder'), or(isNotNull(tasks.reminderSentAt), isNull(tasks.reminderAt), lte(tasks.reminderAt, now))))
    .returning(taskColumns).run();
  return { task: task ?? await getUserTask(userId, id, 'reminder') };
}
