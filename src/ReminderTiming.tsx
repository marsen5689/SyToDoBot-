import { useId, useState } from 'react';

const options = [[0, 'В момент события'], [5, 'За 5 минут'], [10, 'За 10 минут'], [15, 'За 15 минут'], [60, 'За час'], [1440, 'За день']] as const;
export function ReminderTiming({ value, onChange, disabled = false, available = true, allowOff = false }: {
  value: number | null; onChange: (minutes: number | null) => void; disabled?: boolean; available?: boolean; allowOff?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState(value !== null && !options.some(([minutes]) => minutes === value));
  const isCustom = custom && value !== null;
  return <div className="reminder-timing">
    <label htmlFor={id}>Напоминание в Telegram</label>
    <select id={id} value={isCustom ? 'custom' : value === null ? 'off' : String(value)} disabled={disabled}
      onChange={event => {
        const own = event.target.value === 'custom'; setCustom(own);
        onChange(own ? (value ?? 30) : event.target.value === 'off' ? null : Number(event.target.value));
      }}>
      {allowOff && <option value="off">Без напоминания</option>}
      {options.map(([minutes, label]) => <option key={minutes} value={minutes} disabled={!available}>{label}</option>)}
      <option value="custom" disabled={!available}>Свой интервал</option>
    </select>
    {isCustom && <div className="custom-reminder"><label htmlFor={`${id}-minutes`}>За сколько минут?</label>
      <input id={`${id}-minutes`} type="number" inputMode="numeric" min={0} max={10080} step={1} required disabled={disabled}
        value={value === null || Number.isNaN(value) ? '' : value} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))} />
      <p className="reminder-hint">От 0 до 10 080 минут (7 дней) до события.</p></div>}
  </div>;
}
