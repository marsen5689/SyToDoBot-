import { db, api, BotApiError } from 'sdk';
import { and, eq, lte, isNull, isNotNull, or, asc, sql } from 'sdk/db';
import { tasks } from '../schema.js';
import { html, APP_URL, formatDeadline } from './bot.js';
import { nextOccurrence, recurrenceLabel } from './recurrence.js';

const LEASE_MS = 10 * 60 * 1000;
const BATCH_SIZE = 20;

function pending(now) {
  return and(eq(tasks.completed, false), isNotNull(tasks.reminderAt), lte(tasks.reminderAt, now),
    or(isNull(tasks.reminderSentAt), isNotNull(tasks.recurrence)), or(isNull(tasks.reminderLeaseUntil), lte(tasks.reminderLeaseUntil, now)));
}

// Called by the protected maintenance endpoint, never by a user-supplied ID.
export async function dispatchDueReminders() {
  const now = Date.now();
  const candidates = await db.select().from(tasks).where(pending(now)).orderBy(asc(tasks.reminderAt)).limit(BATCH_SIZE).all();
  const result = { enabled: true, sent: 0, failed: 0, skipped: 0 };
  for (const candidate of candidates) {
    const leaseUntil = now + LEASE_MS;
    const ownedVersion = and(eq(tasks.id, candidate.id), eq(tasks.userId, candidate.userId), eq(tasks.scheduleVersion, candidate.scheduleVersion));
    const [claimed] = await db.update(tasks).set({ reminderLeaseUntil: leaseUntil })
      .where(and(ownedVersion, pending(now))).returning().run();
    if (!claimed) { result.skipped++; continue; }
    const claim = and(ownedVersion, eq(tasks.reminderLeaseUntil, leaseUntil));
    // Recheck after claiming: completion, deletion or rescheduling cancels it.
    const current = await db.select().from(tasks).where(and(claim, eq(tasks.completed, false), or(isNull(tasks.reminderSentAt), isNotNull(tasks.recurrence)))).get();
    if (!current) { result.skipped++; continue; }
    const standalone = current.requestKey.startsWith('reminder:');
    try {
      const next = current.recurrence ? nextOccurrence(current.recurrence, current.reminderMinutes, Date.now()) : null;
      await api.sendMessage({
        chat_id: current.userId,
        parse_mode: 'HTML',
        text: `<b>${standalone ? 'Напоминание' : 'Напоминание о задаче'}</b>\n\n${html(current.title)}${standalone && current.note ? `\n${html(current.note)}` : ''}\n${standalone ? 'Время' : 'Дедлайн'}: ${formatDeadline(current)}${current.reminderMinutes > 0 ? `\nЗа ${current.reminderMinutes} мин. до события` : ''}${current.recurrence ? `\nПовтор: ${recurrenceLabel(current.recurrence)}` : ''}\n№<code>${current.id}</code>`,
        reply_markup: { inline_keyboard: [
          [standalone ? { text: 'Отложить на 10 минут', callback_data: `reminder:snooze:${current.id}${current.recurrence ? ':' + current.dueAt : ''}` }
            : { text: '✓ Выполнить', callback_data: `task:done:${current.id}` }],
          [{ text: standalone ? 'Открыть напоминания' : 'Открыть задачи', web_app: { url: APP_URL + (standalone ? '?view=reminders' : '') } }],
        ] },
      });
      await db.update(tasks).set({ reminderSentAt: Date.now(), lastReminderDueAt: current.dueAt, reminderLeaseUntil: null,
        ...(current.recurrence ? { ...(next ?? { reminderAt: null }), scheduleVersion: sql`${tasks.scheduleVersion} + 1` } : {}),
      }).where(claim).run();
      result.sent++;
    } catch (error) {
      // Keep the lease on transient failures to avoid rapid retries. Telegram
      // does not supply a sendMessage idempotency key; a lost reply may duplicate.
      const retrySeconds = error instanceof BotApiError ? error.parameters?.retry_after : null;
      const nextLease = Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.max(leaseUntil, Date.now() + retrySeconds * 1000) : leaseUntil;
      const permanent = error instanceof BotApiError && (error.code === 403
        || (error.code === 400 && /chat not found|user is deactivated/i.test(error.description)));
      await db.update(tasks).set(permanent ? { reminderAt: null, reminderLeaseUntil: null }
        : { reminderLeaseUntil: nextLease }).where(claim).run();
      result.failed++;
      console.warn('Reminder delivery failed', { taskId: current.id, permanent });
    }
  }
  return result;
}
