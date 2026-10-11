import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from './api';
import type { Task } from './types';
import { localDateInput, parseSchedule } from './schedule';
import { ScheduleFields } from './ScheduleFields';
import { Sheet } from './Sheet';
import { Icon } from './icons';
import { haptic } from './useTelegram';
import { useReminderCapabilities } from './useReminderCapabilities';
import { requestReminderPermission } from './reminderPermission';

export function EditSchedule({ task, onClose, onSaved }: { task: Task; onClose: () => void; onSaved: (task: Task) => void }) {
  const [due, setDue] = useState(() => localDateInput(task.dueAt));
  const [reminderMinutes, setReminderMinutes] = useState(task.completed ? null : task.reminderMinutes);
  const reminderState = useReminderCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    let schedule;
    try {
      schedule = parseSchedule(due, reminderMinutes);
      // Preserve the exact instant when saving an unchanged local time during
      // the repeated hour at the end of daylight saving time.
      if (due === localDateInput(task.dueAt)) {
        schedule.dueAt = task.dueAt; schedule.dueOffsetMinutes = task.dueOffsetMinutes;
      }
    }
    catch (cause) { setError((cause as Error).message); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const changed = schedule.dueAt !== task.dueAt || schedule.reminderMinutes !== task.reminderMinutes;
      if (changed && reminderMinutes !== null) {
        if (task.completed) { setError('Верните задачу в активные, чтобы настроить напоминание.'); return; }
        if (schedule.dueAt! - reminderMinutes * 60000 <= Date.now()) {
          setError('Время напоминания уже прошло. Выберите более поздний дедлайн или другой интервал.'); return;
        }
        await requestReminderPermission();
      }
      const result = await api.schedule(task.id, schedule); haptic('success'); onSaved(result.task);
    }
    catch (cause) { setError(errorMessage(cause)); haptic('error'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Sheet title="Срок и напоминание" subtitle={task.title} onClose={onClose} busy={busy}>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset className="form-fields" disabled={busy}><ScheduleFields value={due} onChange={setDue} reminderMinutes={reminderMinutes}
        onReminderChange={setReminderMinutes} reminderState={task.completed ? 'disabled' : reminderState} completed={task.completed} /></fieldset>
      {error && <div className="form-error" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
      <button type="submit" className="button primary full-width" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="check" size={18} />}Сохранить</button>
    </form>
  </Sheet>;
}
