import { DateTimePicker } from './DateTimePicker';
import { ReminderTiming } from './ReminderTiming';

export function ScheduleFields({ value, onChange, invalid = false, reminderMinutes, onReminderChange, reminderState, completed = false }: {
  value: string; onChange: (value: string) => void; invalid?: boolean;
  reminderMinutes: number | null; onReminderChange: (value: number | null) => void;
  reminderState: 'loading' | 'enabled' | 'disabled' | 'error';
  completed?: boolean;
}) {
  return <div className="schedule-fields">
    <DateTimePicker value={value} invalid={invalid} onChange={next => { onChange(next); if (!next) onReminderChange(null); }} />
    <ReminderTiming value={reminderMinutes} onChange={onReminderChange} allowOff available={reminderState === 'enabled'}
      disabled={!value || (reminderState !== 'enabled' && reminderMinutes === null)} />
    <p className="reminder-hint" id="reminder-hint">{completed ? 'Для напоминания верните задачу в активные.' : reminderState === 'loading' ? 'Проверяем доступность напоминаний…'
      : reminderState === 'disabled' ? 'Автоматическая отправка пока не подключена.'
      : reminderState === 'error' ? 'Не удалось проверить напоминания. Закройте форму и попробуйте снова.'
      : !value ? 'Сначала укажите дедлайн.' : 'Бот напишет в личный чат, даже если приложение закрыто. Возможна задержка отправки.'}</p>
  </div>;
}
