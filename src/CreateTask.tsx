import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, errorMessage } from './api';
import { haptic } from './useTelegram';
import type { Priority, Task } from './types';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { ScheduleFields } from './ScheduleFields';
import { parseSchedule } from './schedule';
import { useReminderCapabilities } from './useReminderCapabilities';
import { requestReminderPermission } from './reminderPermission';

export function CreateTask({ onClose, onCreated }: { onClose: () => void; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [due, setDue] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  const reminderState = useReminderCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [field, setField] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const sending = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const titleRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    if (!title.trim() || title.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(title.trim())) {
      setError('Добавьте название от 1 до 200 символов.'); setField('title'); titleRef.current?.focus(); return;
    }
    let schedule;
    try {
      schedule = parseSchedule(due, reminderMinutes);
      if (!uncertain && reminderMinutes !== null && schedule.dueAt! - reminderMinutes * 60000 <= Date.now()) {
        throw new Error('Время напоминания уже прошло. Выберите более поздний дедлайн или другой интервал.');
      }
    }
    catch (cause) { setError((cause as Error).message); setField('dueAt'); return; }
    sending.current = true; setBusy(true); setError(''); setField(undefined);
    try {
      if (reminderMinutes !== null && !uncertain) await requestReminderPermission();
      const { task } = await api.create({ title: title.trim(), note: note.trim(), priority, requestId: requestId.current, ...schedule });
      haptic('success'); onCreated(task);
    } catch (cause) {
      setError(errorMessage(cause));
      setField(cause instanceof ApiError ? cause.field : undefined);
      // Preserve payload and requestId after an ambiguous failure so retry is safe.
      setUncertain(!(cause instanceof ApiError) || !['VALIDATION_ERROR', 'UNAUTHORIZED', 'WRITE_PERMISSION_REQUIRED', 'REMINDERS_UNAVAILABLE'].includes(cause.code));
      haptic('error');
    } finally { sending.current = false; setBusy(false); }
  }

  return <Sheet title="Новая задача" subtitle="Название, детали и приоритет. Всё в одном месте." onClose={onClose} busy={busy}>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || uncertain} className="form-fields">
        <label htmlFor="task-title">Что нужно сделать? <span className="required">*</span></label>
        <input ref={titleRef} id="task-title" value={title} onChange={(event) => setTitle(event.target.value)}
          placeholder="Например, подготовить проект" maxLength={200} required autoComplete="off"
          aria-invalid={field === 'title'} aria-describedby={error ? 'create-error' : undefined} />
        <div className="input-caption"><span>Коротко и по делу</span><span>{title.length}/200</span></div>
        <label htmlFor="task-note">Описание <span className="optional">необязательно</span></label>
        <textarea id="task-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Детали, которые хочется запомнить…"
          maxLength={1000} rows={3} aria-invalid={field === 'note'} aria-describedby={error ? 'create-error' : undefined} />
        <div className="input-caption"><span /><span>{note.length}/1000</span></div>
        <span className="field-label" id="priority-label">Приоритет</span>
        <div className="priority-options" role="radiogroup" aria-labelledby="priority-label">
          {([['low', 'Не спешит'], ['normal', 'Обычный'], ['high', 'Важный']] as const).map(([value, label]) =>
            <label key={value} className={`priority-option ${priority === value ? 'selected' : ''}`}>
              <input type="radio" name="priority" value={value} checked={priority === value} onChange={() => setPriority(value)} />
              <span className={`priority-dot ${value}`} />{label}
            </label>)}
        </div>
        <ScheduleFields value={due} onChange={setDue} invalid={field === 'dueAt'} reminderMinutes={reminderMinutes}
          onReminderChange={setReminderMinutes} reminderState={reminderState} />
      </fieldset>
      {error && <div className="form-error" id="create-error" role="alert"><Icon name="alert" size={18} /><span>{error}
        {uncertain && <small>Можно повторить сохранение с теми же данными: дубликат не появится.</small>}</span></div>}
      <button type="submit" className="button primary full-width" disabled={busy || !title.trim()}>
        {busy ? <span className="spinner" /> : <Icon name="plus" />}{busy ? 'Сохраняем…' : uncertain ? 'Повторить сохранение' : 'Создать задачу'}
      </button>
      <p className="form-footer"><Icon name="shield" size={14} /> Задача будет видна только вам</p>
    </form>
  </Sheet>;
}
