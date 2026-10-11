import { db, EndpointError } from 'sdk';
import { eq, and, lt, desc, sql } from 'sdk/db';
import { tasks } from '../schema.js';
import { objectInput, positiveId, createInput, scheduleInput, validateNewReminder, taskColumns, ownedTask, notFound } from './tasks.js';

// Callers must supply identity from verified endpoint context or a Telegram update.
export async function taskCounts(userId) {
  positiveId(userId, 'user');
  const active = await db.$count(tasks, and(eq(tasks.userId, userId), eq(tasks.completed, false)));
  const completed = await db.$count(tasks, and(eq(tasks.userId, userId), eq(tasks.completed, true)));
  return { active, completed };
}

export async function listUserTasks(userId, input, pageSize = 30) {
  positiveId(userId, 'user');
  objectInput(input);
  const status = input.status ?? 'active';
  if (!['active', 'completed', 'all'].includes(status)) {
    throw new EndpointError('Некорректный фильтр.', { code: 'VALIDATION_ERROR', field: 'status' });
  }
  const conditions = [eq(tasks.userId, userId)];
  if (status !== 'all') conditions.push(eq(tasks.completed, status === 'completed'));
  if (input.cursor !== undefined && input.cursor !== null) conditions.push(lt(tasks.id, positiveId(input.cursor, 'cursor')));
  const rows = await db.select(taskColumns).from(tasks)
    .where(and(...conditions)).orderBy(desc(tasks.id)).limit(pageSize + 1).all();
  const counts = await taskCounts(userId);
  const items = rows.slice(0, pageSize);
  return { tasks: items, counts, nextCursor: rows.length > pageSize ? items[items.length - 1].id : null };
}

export async function getUserTask(userId, id) {
  positiveId(userId, 'user');
  positiveId(id);
  const task = await db.select(taskColumns).from(tasks).where(ownedTask(userId, id)).get();
  if (!task) notFound();
  return task;
}

export async function createUserTask(userId, input) {
  positiveId(userId, 'user');
  const { title, note, priority, requestId, ...schedule } = createInput(input);
  const requestKey = `${userId}:${requestId}`;
  const now = Date.now();
  const existing = await db.select(taskColumns).from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.requestKey, requestKey))).get();
  // A retry remains valid even after the original reminder time has passed.
  if (existing) return { task: existing };
  validateNewReminder(schedule, now);
  const [inserted] = await db.insert(tasks).values({
    userId, requestKey, title, note, priority, ...schedule, reminderSentAt: null, reminderLeaseUntil: null,
    scheduleVersion: 0, completed: false, createdAt: now, updatedAt: now,
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

export async function deleteUserTask(userId, input) {
  positiveId(userId, 'user');
  objectInput(input);
  const id = positiveId(input.id);
  const [deleted] = await db.delete(tasks).where(ownedTask(userId, id)).returning({ id: tasks.id }).run();
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
    reminderSentAt: null, reminderLeaseUntil: null, scheduleVersion: sql`${tasks.scheduleVersion} + 1`,
  })
    .where(ownedTask(userId, id)).returning(taskColumns).run();
  if (!task) notFound();
  return { task };
}
