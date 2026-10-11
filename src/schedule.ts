import type { TaskSchedule } from './types';

export function localDateInput(timestamp: number | null): string {
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseSchedule(value: string, reminderMinutes: number | null = null): TaskSchedule {
  if (!value) {
    if (reminderMinutes !== null) throw new Error('Для напоминания укажите дедлайн.');
    return { dueAt: null, dueOffsetMinutes: 0, reminderMinutes: null };
  }
  const dueAt = new Date(value).getTime();
  // Reject impossible local times, including the gap when daylight saving starts.
  if (!Number.isFinite(dueAt) || localDateInput(dueAt) !== value || dueAt < 946684800000 || dueAt >= 4102444800000) {
    throw new Error('Выберите корректные дату и время дедлайна (2000–2099).');
  }
  return { dueAt, dueOffsetMinutes: -new Date(dueAt).getTimezoneOffset(), reminderMinutes };
}

export function localTimeZone(value = ''): string {
  const date = value ? new Date(value) : new Date();
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `Местное время (UTC${offset < 0 ? '−' : '+'}${hours}:${minutes})`;
}

export const deadlineFormat = new Intl.DateTimeFormat('ru', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
