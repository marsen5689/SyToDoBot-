import { localTimeZone } from './schedule';

export function ScheduleFields({ value, onChange, invalid = false, reminderMinutes, onReminderChange, reminderState, completed = false }: {
  value: string; onChange: (value: string) => void; invalid?: boolean;
  reminderMinutes: number | null; onReminderChange: (value: number | null) => void;
  reminderState: 'loading' | 'enabled' | 'disabled' | 'error';
  completed?: boolean;
}) {
  return <div className="schedule-fields">
    <label htmlFor="task-deadline">Дедлайн <span className="optional">необязательно</span></label>
    <input id="task-deadline" type="datetime-local" value={value} onChange={(event) => {
      onChange(event.target.value); if (!event.target.value) onReminderChange(null);
    }}
      min="2000-01-01T00:00" max="2099-12-31T23:59" aria-invalid={invalid} aria-describedby="deadline-hint" />
    <div className="input-caption" id="deadline-hint"><span>{localTimeZone(value)}</span>
      {value && <button type="button" className="text-button clear-deadline" onClick={() => { onChange(''); onReminderChange(null); }}>Очистить</button>}</div>
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
