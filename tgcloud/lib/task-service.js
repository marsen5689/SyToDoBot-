import { db, EndpointError } from 'sdk';
import { eq, and, or, like, lt, desc, sql } from 'sdk/db';
import { tasks } from '../schema.js';
import { objectInput, positiveId, createInput, scheduleInput, validateNewReminder, taskColumns, ownedTask, recordScope, reminderStatus, notFound } from './tasks.js';
import { recurringSchedule } from './recurrence.js';

// Callers must supply identity from verified endpoint context or a Telegram update.
export async function taskCounts(userId, kind = 'task') {
  positiveId(userId, 'user');
  const active = await db.$count(tasks, and(recordScope(userId, kind), kind === 'reminder' ? reminderStatus('active') : eq(tasks.completed, false)));
  const completed = await db.$count(tasks, and(recordScope(userId, kind), kind === 'reminder' ? reminderStatus('completed') : eq(tasks.completed, true)));
  return { active, completed };
}

export async function listUserTasks(userId, input, pageSize = 30, kind = 'task') {
  positiveId(userId, 'user');
  objectInput(input);
  const status = input.status ?? 'active';
  if (!['active', 'completed', 'all'].includes(status)) {
    throw new EndpointError('Некорректный фильтр.', { code: 'VALIDATION_ERROR', field: 'status' });
  }
  const conditions = [recordScope(userId, kind)];
  if (status !== 'all') conditions.push(kind === 'reminder'
    ? reminderStatus(status)
    : eq(tasks.completed, status === 'completed'));
  if (input.cursor !== undefined && input.cursor !== null) conditions.push(lt(tasks.id, positiveId(input.cursor, 'cursor')));
  const rows = await db.select(taskColumns).from(tasks)
    .where(and(...conditions)).orderBy(desc(tasks.id)).limit(pageSize + 1).all();
  const counts = await taskCounts(userId, kind);
  const items = rows.slice(0, pageSize);
  return { tasks: items, counts, nextCursor: rows.length > pageSize ? items[items.length - 1].id : null };
}

export async function getUserTask(userId, id, kind = 'task') {
  positiveId(userId, 'user');
  positiveId(id);
  const task = await db.select(taskColumns).from(tasks).where(ownedTask(userId, id, kind)).get();
  if (!task) notFound();
  return task;
}

export async function createUserTask(userId, input, kind = 'task') {
  positiveId(userId, 'user');
  const { title, note, priority, requestId, ...rawSchedule } = createInput(input);
  const requestKey = `${kind === 'reminder' ? 'reminder:' : ''}${userId}:${requestId}`;
  const now = Date.now();
  const existing = await db.select(taskColumns).from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.requestKey, requestKey))).get();
  // A retry remains valid even after the original reminder time has passed.
  if (existing) return { task: existing };
  const schedule = kind === 'reminder' ? recurringSchedule(rawSchedule, input.recurrence) : { ...rawSchedule, recurrence: null };
  validateNewReminder(schedule, now);
  const [inserted] = await db.insert(tasks).values({
    userId, requestKey, title, note, priority, ...schedule, reminderSentAt: null, reminderLeaseUntil: null,
    lastReminderDueAt: null, scheduleVersion: 0, completed: false, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: tasks.requestKey }).returning(taskColumns).run();
  const task = inserted ?? await db.select(taskColumns).from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.requestKey, requestKey))).get();
  return { task };
}

export async function completeUserTask(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  if (typeof input.completed !== 'boolean') {
    throw new EndpointError('Статус должен быть логическим значением.', { code: 'VALIDATION_ERROR', field: 'completed' });
  }
  const now = Date.now();
  const [task] = await db.update(tasks).set({ completed: input.completed, updatedAt: now,
    scheduleVersion: sql`${tasks.scheduleVersion} + 1`, reminderLeaseUntil: null,
    // Completion cancels pending delivery. Undo rearms only a future reminder.
    reminderAt: sql`CASE WHEN ${input.completed} THEN NULL WHEN ${tasks.dueAt} - ${tasks.reminderMinutes} * 60000 > ${now} THEN ${tasks.dueAt} - ${tasks.reminderMinutes} * 60000 ELSE NULL END`,
  })
    .where(ownedTask(userId, id)).returning(taskColumns).run();
  if (!task) notFound();
  return { task };
}

export async function deleteUserTask(userId, input, kind = 'task') {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  if (kind === 'reminder') await getUserTask(userId, id, kind);
  const deletedRows = await db.delete(tasks).where(kind === 'reminder'
    ? and(recordScope(userId, kind), or(eq(tasks.id, id), like(tasks.requestKey, `reminder:${userId}:snooze:${id}:%`)))
    : ownedTask(userId, id, kind)).returning({ id: tasks.id }).run();
  const deleted = deletedRows.find(row => row.id === id);
  if (!deleted) notFound();
  return { id: deleted.id };
}

export async function setUserSchedule(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  const schedule = scheduleInput(input);
  const current = await getUserTask(userId, id);
  // Saving identical settings preserves delivery state and is safe to retry.
  if (current.dueAt === schedule.dueAt && current.dueOffsetMinutes === schedule.dueOffsetMinutes
    && current.reminderMinutes === schedule.reminderMinutes) return { task: current };
  if (current.completed && schedule.reminderMinutes !== null) {
    throw new EndpointError('Верните задачу в активные, чтобы настроить напоминание.', { code: 'VALIDATION_ERROR', field: 'reminderMinutes' });
  }
  const now = Date.now();
  validateNewReminder(schedule, now);
  const [task] = await db.update(tasks).set({ ...schedule, updatedAt: now,
    reminderSentAt: null, lastReminderDueAt: null, reminderLeaseUntil: null, scheduleVersion: sql`${tasks.scheduleVersion} + 1`,
  })
    .where(ownedTask(userId, id)).returning(taskColumns).run();
  if (!task) notFound();
  return { task };
}
