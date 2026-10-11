import { EndpointError } from 'sdk';

const DAY = 86400000;
const MINUTE = 60000;
const formatters = new Map();
function invalid(message, field = 'recurrence') {
  throw new EndpointError(message, { code: 'VALIDATION_ERROR', field });
}
function formatter(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(timeZone);
}
function wallTime(timestamp, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}
export function zoneOffset(timestamp, timeZone) {
  const minute = Math.floor(timestamp / MINUTE) * MINUTE;
  return (wallTime(minute, timeZone) - minute) / MINUTE;
}
function dateNumber(date) { return Date.parse(`${date}T00:00:00Z`); }
function dateString(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }

// Inverse of Intl's timezone formatting. The earlier instant wins during an
// overlap; a nonexistent spring-forward time shifts forward by the DST gap.
export function zonedInstant(date, minuteOfDay, timeZone) {
  const desired = dateNumber(date) + minuteOfDay * MINUTE;
  const offsets = new Set([-2 * DAY, -DAY, 0, DAY, 2 * DAY].map(delta => zoneOffset(desired + delta, timeZone)));
  const candidates = [...offsets].map(offset => desired - offset * MINUTE).sort((a, b) => a - b);
  const exact = candidates.filter(candidate => wallTime(candidate, timeZone) === desired);
  if (exact.length) return exact[0];
  const after = candidates.filter(candidate => wallTime(candidate, timeZone) > desired)
    .sort((a, b) => wallTime(a, timeZone) - wallTime(b, timeZone));
  if (!after.length) invalid('Не удалось рассчитать местное время повторения.');
  return after[0];
}

export function recurrenceRule(input, dueAt, current) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || !['daily', 'alternate', 'weekdays'].includes(input.mode)) {
    invalid('Выберите корректное повторение.');
  }
  let timeZone;
  try {
    if (typeof input.timeZone !== 'string' || input.timeZone.length > 100 || !input.timeZone) throw new Error();
    timeZone = formatter(input.timeZone).resolvedOptions().timeZone;
  } catch { invalid('Неизвестный часовой пояс повторения.'); }
  let weekdays = [];
  if (input.mode === 'weekdays') {
    if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.length > 7
      || input.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) invalid('Выберите хотя бы один день недели.');
    weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  }
  if (dueAt === null || dueAt % MINUTE !== 0) invalid('Для повторения укажите дату и время с точностью до минуты.', 'dueAt');
  if (current?.recurrence && current.dueAt === dueAt && current.recurrence.mode === input.mode
    && current.recurrence.timeZone === timeZone && JSON.stringify(current.recurrence.weekdays) === JSON.stringify(weekdays)) {
    return current.recurrence;
  }
  const local = wallTime(dueAt, timeZone);
  const date = dateString(local);
  return { mode: input.mode, weekdays, timeZone, anchorDate: date, minuteOfDay: (local - dateNumber(date)) / MINUTE };
}

export function nextOccurrence(rule, reminderMinutes, after) {
  const anchor = dateNumber(rule.anchorDate);
  const localThreshold = wallTime(after + reminderMinutes * MINUTE, rule.timeZone);
  const start = Math.max(anchor, Math.floor(localThreshold / DAY) * DAY);
  for (let day = start; day <= start + 14 * DAY; day += DAY) {
    if (rule.mode === 'alternate' && Math.round((day - anchor) / DAY) % 2 !== 0) continue;
    if (rule.mode === 'weekdays' && !rule.weekdays.includes(new Date(day).getUTCDay())) continue;
    const dueAt = zonedInstant(dateString(day), rule.minuteOfDay, rule.timeZone);
    if (dueAt >= 4102444800000) return null;
    if (dueAt - reminderMinutes * MINUTE > after) return { dueAt,
      dueOffsetMinutes: zoneOffset(dueAt, rule.timeZone), reminderAt: dueAt - reminderMinutes * MINUTE };
  }
  invalid('Не удалось рассчитать следующую дату повторения.');
}

export function recurringSchedule(schedule, input, current) {
  const recurrence = recurrenceRule(input, schedule.dueAt, current);
  if (!recurrence) return { ...schedule, recurrence: null };
  if (current && current.dueAt === schedule.dueAt && recurrence === current.recurrence) return { ...schedule, recurrence };
  if (recurrence.mode !== 'weekdays' || recurrence.weekdays.includes(new Date(dateNumber(recurrence.anchorDate)).getUTCDay())) {
    return { ...schedule, dueOffsetMinutes: zoneOffset(schedule.dueAt, recurrence.timeZone), recurrence };
  }
  // For selected weekdays, begin with the first matching day on/after the date.
  const first = nextOccurrence(recurrence, schedule.reminderMinutes, schedule.reminderAt - 1);
  if (!first) invalid('Дата повторения выходит за пределы 2099 года.', 'dueAt');
  return { ...schedule, ...first, recurrence };
}

export function recurrenceLabel(rule) {
  if (!rule) return 'Разово';
  if (rule.mode === 'daily') return 'Каждый день';
  if (rule.mode === 'alternate') return 'Через день';
  const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  return [1, 2, 3, 4, 5, 6, 0].filter(day => rule.weekdays.includes(day)).map(day => names[day]).join(', ');
}
