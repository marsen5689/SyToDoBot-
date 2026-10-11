import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { deadlineFormat, localDateInput, localTimeZone } from './schedule';
import { haptic } from './useTelegram';

const pad = (value: number) => String(value).padStart(2, '0');
const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('ru', { month: 'long' }).format(new Date(2026, month, 1)));
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const ROW = 40;

function TimeWheel({ label, value, count, onChange }: { label: string; value: number; count: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useRef<number | null>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (selected.current !== value) {
      selected.current = value;
      ref.current!.scrollTop = value * ROW;
    }
  }, [value]);
  const choose = (next: number) => {
    if (ref.current?.closest('fieldset')?.disabled) return;
    const bounded = Math.max(0, Math.min(count - 1, next));
    selected.current = bounded;
    ref.current?.scrollTo({ top: bounded * ROW, behavior: 'auto' });
    onChange(bounded);
    haptic('light');
  };
  return <div className="wheel-column"><span className="wheel-label">{label}</span>
    <div className="time-wheel" ref={ref} role="listbox" tabIndex={0} aria-label={label} aria-activedescendant={`${id}-${value}`}
      onScroll={(event) => {
        if (event.currentTarget.closest('fieldset')?.disabled) return;
        const next = Math.max(0, Math.min(count - 1, Math.round(event.currentTarget.scrollTop / ROW)));
        if (selected.current !== next) { selected.current = next; onChange(next); }
      }}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowDown' ? value + 1 : event.key === 'ArrowUp' ? value - 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
        if (next !== null) { event.preventDefault(); choose(next); }
      }}>
      {Array.from({ length: count }, (_, item) => <div key={item} id={`${id}-${item}`} role="option" aria-selected={item === value}
        className={`wheel-option ${item === value ? 'selected' : Math.abs(item - value) === 1 ? 'near' : ''}`}
        onClick={() => choose(item)}>{pad(item)}</div>)}
    </div>
  </div>;
}

export function DateTimePicker({ value, onChange, label = 'Дедлайн', optional = true, invalid = false }: {
  value: string; onChange: (value: string) => void; label?: string; optional?: boolean; invalid?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const fallback = useRef(localDateInput(Date.now() + 15 * 60000));
  const selected = value || fallback.current;
  const day = selected.slice(0, 10);
  const hour = Number(selected.slice(11, 13));
  const minute = Number(selected.slice(14, 16));
  const [month, setMonth] = useState(() => new Date(`${selected.slice(0, 7)}-01T12:00`));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const today = dateKey(new Date());
  const update = (newDay: string, newHour = hour, newMinute = minute) => onChange(`${newDay}T${pad(newHour)}:${pad(newMinute)}`);
  const quick = (offset: number) => {
    const date = new Date(); date.setDate(date.getDate() + offset);
    const key = dateKey(date); update(key); setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  return <div className="datetime-field">
    <span className="field-label">{label} <span className={optional ? 'optional' : 'required'}>{optional ? 'необязательно' : '*'}</span></span>
    <button type="button" className={`datetime-trigger ${value ? 'has-value' : ''}`} aria-label={`${label}: ${value ? deadlineFormat.format(new Date(value)) : 'выбрать дату и время'}`}
      aria-expanded={open} aria-controls={id} aria-invalid={invalid} onClick={() => {
        if (!open) setMonth(new Date(`${selected.slice(0, 7)}-01T12:00`));
        setOpen(!open);
      }}><Icon name="calendar" /><span>{value ? deadlineFormat.format(new Date(value)) : 'Выбрать дату и время'}</span><Icon name="chevron" size={16} className={open ? 'is-open' : ''} /></button>
    {open && <div className="datetime-panel" id={id}>
      <div className="date-shortcuts"><button type="button" className="button secondary" onClick={() => quick(0)}>Сегодня</button>
        <button type="button" className="button secondary" onClick={() => quick(1)}>Завтра</button></div>
      <div className="calendar-navigation">
        <button type="button" className="icon-button" aria-label="Предыдущий месяц" disabled={year === 2000 && monthIndex === 0} onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><Icon name="chevron-left" size={18} /></button>
        <div className="calendar-selects"><select aria-label="Месяц" value={monthIndex} onChange={(event) => setMonth(new Date(year, Number(event.target.value), 1))}>
          {months.map((name, index) => <option key={index} value={index}>{name}</option>)}</select>
          <select aria-label="Год" value={year} onChange={(event) => setMonth(new Date(Number(event.target.value), monthIndex, 1))}>
            {Array.from({ length: 100 }, (_, index) => <option key={index} value={2000 + index}>{2000 + index}</option>)}</select></div>
        <button type="button" className="icon-button" aria-label="Следующий месяц" disabled={year === 2099 && monthIndex === 11} onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><Icon name="chevron-right" size={18} /></button>
      </div>
      <div className="calendar-grid" role="group" aria-label="Календарь">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(name => <span key={name} className="calendar-weekday">{name}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`gap-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const key = `${year}-${pad(monthIndex + 1)}-${pad(index + 1)}`;
          return <button type="button" key={key} aria-label={key} aria-pressed={value !== '' && day === key}
            aria-current={today === key ? 'date' : undefined} className={`calendar-day ${value && day === key ? 'selected' : ''} ${today === key ? 'today' : ''}`}
            onClick={() => { update(key); haptic('light'); }}>{index + 1}</button>;
        })}
      </div>
      <div className="time-picker"><div className="time-selection" aria-hidden="true" />
        <TimeWheel label="Часы" count={24} value={hour} onChange={next => update(day, next)} />
        <span className="time-colon" aria-hidden="true">:</span>
        <TimeWheel label="Минуты" count={60} value={minute} onChange={next => update(day, hour, next)} />
      </div>
      <div className="datetime-footer"><span>{localTimeZone(selected)}</span><button type="button" className="button primary" onClick={() => { if (!value) onChange(selected); setOpen(false); }}>Готово</button></div>
    </div>}
    {optional && value && <button type="button" className="text-button clear-deadline" onClick={() => { onChange(''); setOpen(false); }}>Очистить</button>}
    {!open && <p className="reminder-hint datetime-zone">{localTimeZone(value)}</p>}
  </div>;
}
