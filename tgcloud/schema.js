import { table, integer, text, boolean, json, index, check, sql } from 'sdk/db';

export const tasks = table('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  requestKey: text('request_key').notNull().unique(),
  title: text('title').notNull(),
  note: text('note').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  completed: boolean('completed').notNull().default(false),
  dueAt: integer('due_at'),
  dueOffsetMinutes: integer('due_offset_minutes').notNull().default(0),
  reminderMinutes: integer('reminder_minutes'),
  reminderAt: integer('reminder_at'),
  reminderSentAt: integer('reminder_sent_at'),
  recurrence: json('recurrence'),
  lastReminderDueAt: integer('last_reminder_due_at'),
  reminderLeaseUntil: integer('reminder_lease_until'),
  scheduleVersion: integer('schedule_version').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  userStatusIndex: index('idx_tasks_user_status_id').on(t.userId, t.completed, t.id),
  userIdIndex: index('idx_tasks_user_id').on(t.userId, t.id),
  reminderIndex: index('idx_tasks_pending_reminder').on(t.completed, t.reminderSentAt, t.reminderAt),
  priorityCheck: check('tasks_priority', sql`${t.priority} IN ('low', 'normal', 'high')`),
  titleCheck: check('tasks_title_length', sql`length(${t.title}) BETWEEN 1 AND 200`),
  noteCheck: check('tasks_note_length', sql`length(${t.note}) <= 1000`),
}));
