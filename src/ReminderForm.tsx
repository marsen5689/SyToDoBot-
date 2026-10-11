import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Task, RepeatMode } from './types';
import { api, ApiError, errorMessage } from './api';
import { Sheet } from './Sheet';
import { DateTimePicker } from './DateTimePicker';
import { ReminderTiming } from './ReminderTiming';
import { RepeatFields } from './RepeatFields';
import { localDateInput, parseSchedule } from './schedule';
import { requestReminderPermission } from './reminderPermission';
import { useReminderCapabilities } from './useReminderCapabilities';
import { Icon } from './icons';
import { haptic } from './useTelegram';

export function ReminderForm({ item, onClose, onSaved }: { item?: Task; onClose: () => void; onSaved: (task: Task) => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [due, setDue] = useState(() => localDateInput(item?.dueAt ?? null));
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(item?.reminderMinutes ?? 0);
  const [repeat, setRepeat] = useState<RepeatMode | 'none'>(item?.recurrence?.mode ?? 'none');
  const [days, setDays] = useState<number[]>(item?.recurrence?.weekdays ?? [new Date(item?.dueAt ?? Date.now()).getDay()]);
  const timeZone = item?.recurrence?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const lock = useRef(false);
  const capabilities = useReminderCapabilities();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!title.trim() || title.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(title.trim())) { setError('Укажите название от 1 до 200 символов.'); return; }
    let schedule;
    try {
      if (!due) throw new Error('Укажите дату и время напоминания.');
      schedule = parseSchedule(due, reminderMinutes ?? 0);
      if (repeat === 'weekdays' && days.length === 0) throw new Error('Выберите хотя бы один день недели.');
      schedule.recurrence = repeat === 'none' ? null : { mode: repeat, timeZone, weekdays: repeat === 'weekdays' ? [...days].sort((a, b) => a - b) : [] };
      if (item && due === localDateInput(item.dueAt)) { schedule.dueAt = item.dueAt; schedule.dueOffsetMinutes = item.dueOffsetMinutes; }
      const changed = !item || schedule.dueAt !== item.dueAt || schedule.reminderMinutes !== item.reminderMinutes
        || repeat !== (item.recurrence?.mode ?? 'none') || JSON.stringify(schedule.recurrence?.weekdays ?? []) !== JSON.stringify(item.recurrence?.weekdays ?? []);
      if (!uncertain && changed && schedule.dueAt! - (schedule.reminderMinutes ?? 0) * 60000 <= Date.now()) throw new Error('Время уведомления уже прошло. Выберите более позднюю дату или меньший интервал.');
    } catch (cause) { setError((cause as Error).message); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      if (!uncertain && (!item || schedule.dueAt !== item.dueAt || schedule.reminderMinutes !== item.reminderMinutes
        || repeat !== (item.recurrence?.mode ?? 'none') || JSON.stringify(schedule.recurrence?.weekdays ?? []) !== JSON.stringify(item.recurrence?.weekdays ?? []))) await requestReminderPermission();
      const result = item ? await api.updateReminder(item.id, { title: title.trim(), note: note.trim(), ...schedule })
        : await api.createReminder({ title: title.trim(), note: note.trim(), requestId: requestId.current, ...schedule });
      haptic('success'); onSaved(result.task);
    } catch (cause) {
      setError(errorMessage(cause)); haptic('error');
      setUncertain(!(cause instanceof ApiError) || !['VALIDATION_ERROR', 'UNAUTHORIZED', 'WRITE_PERMISSION_REQUIRED', 'REMINDERS_UNAVAILABLE', 'NOT_FOUND'].includes(cause.code));
    } finally { lock.current = false; setBusy(false); }
  }
  return <Sheet title={item ? 'Изменить напоминание' : 'Новое напоминание'} subtitle="Важное сообщение в нужный момент. Задача не требуется." onClose={onClose} busy={busy}>
    <form onSubmit={event => void submit(event)}>
      <fieldset className="form-fields" disabled={busy || uncertain}>
        <label htmlFor="reminder-title">О чём напомнить? <span className="required">*</span></label>
        <input id="reminder-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required autoComplete="off" placeholder="Например, позвонить родителям" />
        <div className="input-caption"><span>Короткое название</span><span>{title.length}/200</span></div>
        <label htmlFor="reminder-note">Детали <span className="optional">необязательно</span></label>
        <textarea id="reminder-note" rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Что хочется вспомнить…" />
        <div className="input-caption"><span /><span>{note.length}/1000</span></div>
        <DateTimePicker label="Дата и время события" value={due} onChange={setDue} optional={false} />
        <ReminderTiming value={reminderMinutes} onChange={setReminderMinutes} available={capabilities === 'enabled'} />
        <RepeatFields mode={repeat} onModeChange={setRepeat} days={days} onDaysChange={setDays} timeZone={timeZone} />
      </fieldset>
      <div className="reminder-delivery-note"><Icon name="telegram" size={18} /><p>{capabilities === 'disabled' ? 'Автоматическая отправка сейчас приостановлена.'
        : capabilities === 'error' ? 'Не удалось проверить доступность отправки. Попробуйте ещё раз.'
        : 'Бот напишет вам, даже если Mini App закрыт. Проверка примерно каждые 5 минут; возможна задержка.'}</p></div>
      {error && <div className="form-error" role="alert"><Icon name="alert" size={18} /><span>{error}{uncertain && <small>Повторите сохранение с теми же данными: дубликат не появится.</small>}</span></div>}
      <button className="button primary full-width" type="submit" disabled={busy || !title.trim() || !due || (!item && capabilities !== 'enabled')}>
        {busy ? <span className="spinner" /> : <Icon name="bell" size={18} />}{busy ? 'Сохраняем…' : uncertain ? 'Повторить сохранение' : item ? 'Сохранить' : 'Создать напоминание'}
      </button>
    </form>
  </Sheet>;
}
