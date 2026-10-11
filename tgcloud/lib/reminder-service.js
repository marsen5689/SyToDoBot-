import { db, EndpointError } from 'sdk';
import { and, eq, or, lte, isNull, isNotNull, sql } from 'sdk/db';
import { tasks } from '../schema.js';
import { createInput, objectInput, positiveId, ownedTask, taskColumns, validateNewReminder, notFound } from './tasks.js';
import { createUserTask, getUserTask } from './task-service.js';
import { recurringSchedule, zoneOffset } from './recurrence.js';

function reminderInput(input, editing = false) {
  objectInput(input);
  const validated = createInput({ ...input, priority: 'normal', reminderMinutes: input.reminderMinutes ?? 0,
    ...(editing ? { requestId: 'reminder-edit-input' } : {}) });
  if (validated.dueAt === null) throw new EndpointError('Укажите дату и время напоминания.', { code: 'VALIDATION_ERROR', field: 'dueAt' });
  return validated;
}

export async function createUserReminder(userId, input) {
  return await createUserTask(userId, { ...reminderInput(input), recurrence: input.recurrence }, 'reminder');
}

export async function updateUserReminder(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  const current = await getUserTask(userId, id, 'reminder');
  const value = recurringSchedule(reminderInput(input, true), input.recurrence === undefined ? current.recurrence : input.recurrence, current);
  const changed = current.dueAt !== value.dueAt || current.dueOffsetMinutes !== value.dueOffsetMinutes
    || current.reminderMinutes !== value.reminderMinutes || JSON.stringify(current.recurrence) !== JSON.stringify(value.recurrence);
  if (changed) validateNewReminder(value, Date.now());
  const [task] = await db.update(tasks).set({ title: value.title, note: value.note, updatedAt: Date.now(),
    ...(changed ? { dueAt: value.dueAt, dueOffsetMinutes: value.dueOffsetMinutes,
      reminderAt: value.reminderAt, reminderMinutes: value.reminderMinutes, recurrence: value.recurrence,
      reminderSentAt: null, lastReminderDueAt: null, reminderLeaseUntil: null,
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
  if (current.recurrence) {
    // Snoozing an occurrence creates an idempotent one-off copy. It cannot
    // shift the recurring schedule or reinterpret a button from an old cycle.
    if (current.lastReminderDueAt === null || (input.occurrenceAt !== undefined && input.occurrenceAt !== current.lastReminderDueAt)) {
      throw new EndpointError('Это напоминание уже обновилось. Откройте актуальный список.', { code: 'VALIDATION_ERROR' });
    }
    const dueAt = now + 10 * 60000;
    const requestKey = `reminder:${userId}:snooze:${id}:${current.lastReminderDueAt}`;
    const copyScope = and(eq(tasks.userId, userId), eq(tasks.requestKey, requestKey));
    const existing = await db.select(taskColumns).from(tasks).where(copyScope).get();
    if (existing) return { task: existing };
    validateNewReminder({ reminderAt: dueAt, reminderMinutes: 0 }, now);
    // INSERT ... SELECT makes parent existence/version checks atomic with the
    // copy creation; a concurrent deletion cannot leave an orphan notification.
    await db.run(sql`INSERT INTO tasks
      (user_id, request_key, title, note, priority, completed, due_at, due_offset_minutes,
       reminder_minutes, reminder_at, schedule_version, created_at, updated_at)
      SELECT ${userId}, ${requestKey}, ${current.title}, ${current.note}, 'normal', 0, ${dueAt},
        ${zoneOffset(dueAt, current.recurrence.timeZone)}, 0, ${dueAt}, 0, ${now}, ${now}
      WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ${id} AND user_id = ${userId}
        AND last_reminder_due_at = ${current.lastReminderDueAt} AND recurrence IS NOT NULL)
      ON CONFLICT(request_key) DO NOTHING`);
    const task = await db.select(taskColumns).from(tasks).where(copyScope).get();
    if (!task) notFound();
    return { task };
  }
  // A duplicate callback from an old message cannot move an already rearmed reminder.
  if (current.reminderSentAt === null && current.reminderAt !== null && current.reminderAt > now) return { task: current };
  const dueAt = now + 10 * 60000;
  validateNewReminder({ reminderAt: dueAt, reminderMinutes: 0 }, now);
  const [task] = await db.update(tasks).set({ dueAt, reminderAt: dueAt, reminderMinutes: 0,
    reminderSentAt: null, lastReminderDueAt: null, reminderLeaseUntil: null, updatedAt: now,
    scheduleVersion: sql`${tasks.scheduleVersion} + 1`,
  }).where(and(ownedTask(userId, id, 'reminder'), or(isNotNull(tasks.reminderSentAt), isNull(tasks.reminderAt), lte(tasks.reminderAt, now))))
    .returning(taskColumns).run();
  return { task: task ?? await getUserTask(userId, id, 'reminder') };
}
