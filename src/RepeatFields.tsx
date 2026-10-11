import { useId } from 'react';
import type { RepeatMode, RecurrenceRule } from './types';

export function repeatLabel(rule: RecurrenceRule | null): string {
  if (!rule) return 'Разово';
  if (rule.mode === 'daily') return 'Каждый день';
  if (rule.mode === 'alternate') return 'Через день';
  const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  return [1, 2, 3, 4, 5, 6, 0].filter(day => rule.weekdays.includes(day)).map(day => names[day]).join(', ');
}
export function RepeatFields({ mode, onModeChange, days, onDaysChange, timeZone }: {
  mode: RepeatMode | 'none'; onModeChange: (mode: RepeatMode | 'none') => void;
  days: number[]; onDaysChange: (days: number[]) => void; timeZone: string;
}) {
  const id = useId();
  return <div className="repeat-fields">
    <label htmlFor={id}>Повторение</label><select id={id} value={mode} onChange={event => onModeChange(event.target.value as RepeatMode | 'none')}>
      <option value="none">Не повторять</option><option value="daily">Каждый день</option>
      <option value="alternate">Через день</option><option value="weekdays">По дням недели</option>
    </select>
    {mode === 'weekdays' && <><div className="weekday-options" role="group" aria-label="Дни повторения">
      {([[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']] as const).map(([day, label]) =>
        <button type="button" key={day} aria-pressed={days.includes(day)} className={days.includes(day) ? 'selected' : ''}
          onClick={() => onDaysChange(days.includes(day) ? days.filter(value => value !== day) : [...days, day])}>{label}</button>)}
    </div><p className="reminder-hint">Начиная с выбранной даты, в первый подходящий день недели.</p></>}
    {mode !== 'none' && <p className="reminder-hint">Часовой пояс: {timeZone}. Время по часам сохраняется при переходе на летнее и зимнее время.</p>}
  </div>;
}
