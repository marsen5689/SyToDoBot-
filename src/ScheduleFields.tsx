import { DateTimePicker } from './DateTimePicker';

export function ScheduleFields({ value, onChange, invalid = false, reminderMinutes, onReminderChange, reminderState, completed = false }: {
  value: string; onChange: (value: string) => void; invalid?: boolean;
  reminderMinutes: number | null; onReminderChange: (value: number | null) => void;
  reminderState: 'loading' | 'enabled' | 'disabled' | 'error';
  completed?: boolean;
}) {
  return <div className="schedule-fields">
    <DateTimePicker value={value} invalid={invalid} onChange={next => { onChange(next); if (!next) onReminderChange(null); }} />
    <label htmlFor="task-reminder">Напоминание в Telegram</label>
    <select id="task-reminder" value={reminderMinutes === null ? 'off' : String(reminderMinutes)}
      disabled={!value || (reminderState !== 'enabled' && reminderMinutes === null)} aria-describedby="reminder-hint"
      onChange={(event) => onReminderChange(event.target.value === 'off' ? null : Number(event.target.value))}>
      <option value="off">Без напоминания</option><option value="0" disabled={reminderState !== 'enabled'}>В момент дедлайна</option>
      <option value="15" disabled={reminderState !== 'enabled'}>За 15 минут</option><option value="60" disabled={reminderState !== 'enabled'}>За час</option><option value="1440" disabled={reminderState !== 'enabled'}>За день</option>
    </select>
    <p className="reminder-hint" id="reminder-hint">{completed ? 'Для напоминания верните задачу в активные.' : reminderState === 'loading' ? 'Проверяем доступность напоминаний…'
      : reminderState === 'disabled' ? 'Автоматическая отправка пока не подключена.'
      : reminderState === 'error' ? 'Не удалось проверить напоминания. Закройте форму и попробуйте снова.'
      : !value ? 'Сначала укажите дедлайн.' : 'Бот напишет в личный чат, даже если приложение закрыто. Возможна задержка отправки.'}</p>
  </div>;
}
