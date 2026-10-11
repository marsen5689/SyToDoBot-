import { useEffect, useRef, useState } from 'react';
import { useTasks } from './useTasks';
import { api, availability, errorMessage } from './api';
import { ReminderForm } from './ReminderForm';
import { Sheet } from './Sheet';
import { Icon } from './icons';
import { deadlineFormat } from './schedule';
import { repeatLabel } from './RepeatFields';
import { haptic } from './useTelegram';
import type { Task } from './types';

export function RemindersPanel() {
  const { page, status, selectStatus, loading, error, applyWrite, refresh, loadMore } = useTasks('reminder');
  const [creating, setCreating] = useState(() => availability() === 'ready' && new URLSearchParams(location.search).get('view') === 'reminders' && new URLSearchParams(location.search).get('action') === 'new');
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [writeError, setWriteError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const edit = new URLSearchParams(location.search).get('edit');
    let alive = true;
    if (edit && availability() === 'ready' && /^[1-9]\d{0,15}$/.test(edit)) {
      void api.getReminder(Number(edit)).then(result => { if (alive) setEditing(result.task); })
        .catch(cause => { if (alive) setWriteError(errorMessage(cause)); });
    }
    return () => { alive = false; };
  }, []);
  const blocked = pending !== null || loading !== null;
  async function write(item: Task, remove = false) {
    if (lock.current) return;
    lock.current = true; setPending(item.id); setWriteError('');
    try {
      if (remove) { await api.deleteReminder(item.id); applyWrite(item, true); setDeleting(null); }
      else { const result = await api.snoozeReminder(item.id, item.lastReminderDueAt ?? undefined); applyWrite(result.task); selectStatus('active'); }
      haptic('success'); await refresh();
    } catch (cause) { setWriteError(errorMessage(cause)); haptic('error'); }
    finally { lock.current = false; setPending(null); }
  }
  const closeForm = () => {
    setCreating(false); setEditing(null);
    const url = new URL(location.href); url.searchParams.delete('action'); url.searchParams.delete('edit');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  };
  const saved = (item: Task) => { applyWrite(item, false, editing ?? undefined); closeForm(); void refresh(); };
  return <section className="tasks-panel reminders-panel" aria-labelledby="reminders-heading">
    <div className="tasks-heading"><div><span className="eyebrow">ВОВРЕМЯ О ВАЖНОМ</span><h2 id="reminders-heading">Мои напоминания</h2></div>
      <button className="button primary add-task" disabled={availability() !== 'ready' || pending !== null} onClick={() => { setWriteError(''); setCreating(true); }}><Icon name="plus" /><span>Новое напоминание</span></button></div>
    <div className="reminders-summary"><Icon name="bell" size={20} /><p>Для звонков, встреч и всего, что хочется вспомнить вовремя.<span>Сообщение придёт в этот же бот.</span></p></div>
    <div className="tasks-toolbar"><div className="tabs" role="tablist" aria-label="Фильтр напоминаний">
      {([['active', 'Ожидают', page?.counts.active], ['completed', 'История', page?.counts.completed]] as const).map(([value, label, count]) =>
        <button key={value} role="tab" className={status === value ? 'selected' : ''} aria-selected={status === value} aria-controls="reminders-list" id={`reminders-tab-${value}`}
          disabled={pending !== null} onClick={() => selectStatus(value)}>{label}{count !== undefined && <span className="tab-count">{count}</span>}</button>)}
    </div><button className="icon-button" aria-label="Обновить напоминания" disabled={availability() !== 'ready' || blocked} onClick={() => void refresh()}><Icon name="refresh" size={18} /></button></div>
    {(error || writeError) && <div className="error-banner" role="alert"><Icon name="alert" size={18} /><span>{writeError || error}</span></div>}
    <div id="reminders-list" role="tabpanel" aria-labelledby={`reminders-tab-${status}`} aria-busy={loading !== null}>
      {availability() !== 'ready' ? <div className="empty-state"><Icon name="telegram" size={32} /><h3>Откройте через Telegram</h3><p>Напоминания сохраняются в вашем аккаунте.</p></div>
        : !page && loading ? <div className="empty-state" aria-label="Загружаем напоминания"><span className="spinner" /></div>
        : page?.tasks.length === 0 ? <div className="empty-state"><div className="state-icon"><Icon name={status === 'completed' ? 'check' : 'bell'} size={26} /></div>
          <h3>{status === 'completed' ? 'История ещё пуста' : 'Важное не потеряется'}</h3><p>{status === 'completed' ? 'Здесь появятся отправленные напоминания.' : 'Выберите дату и время — мы напомним в Telegram.'}</p>
          {status !== 'completed' && <button className="button secondary" onClick={() => setCreating(true)}>Создать напоминание</button>}</div>
        : page ? <><ul className="task-list">{page.tasks.map(item => <li key={item.id} className={`task-card reminder-card ${pending === item.id ? 'is-busy' : ''}`}>
          <div className="reminder-mark">{pending === item.id ? <span className="spinner" /> : <Icon name={status === 'completed' ? 'check' : 'bell'} size={20} />}</div>
          <div className="task-content"><h3>{item.title}</h3>{item.note && <p className="task-note">{item.note}</p>}
            <div className="task-deadline"><Icon name="calendar" size={14} /><span>{item.dueAt === null ? 'Срок не указан' : deadlineFormat.format(status === 'completed' ? item.lastReminderDueAt ?? item.dueAt : item.dueAt)}</span></div>
            <div className="task-meta"><span className="priority-badge">{status === 'completed' ? 'Отправлено' : item.reminderAt === null ? 'Отправка приостановлена' : item.reminderAt <= Date.now() ? 'Ожидает отправки' : 'Запланировано'}</span>
              {item.recurrence && <span className="priority-badge">{repeatLabel(item.recurrence)}</span>}</div>
            {item.reminderMinutes !== null && item.reminderMinutes > 0 && <p className="reminder-hint">Уведомление за {item.reminderMinutes} мин.</p>}
            {status === 'completed' && item.recurrence && item.reminderAt !== null && <p className="reminder-hint">Следующий раз: {deadlineFormat.format(item.dueAt!)}</p>}
            {item.reminderSentAt !== null && <button className="text-button snooze-button" disabled={blocked} onClick={() => void write(item)}><Icon name="clock" size={14} />Ещё раз через 10 минут</button>}
          </div>
          <div className="task-actions"><button className="icon-button" aria-label={`Изменить напоминание: ${item.title}`} disabled={blocked} onClick={() => { setWriteError(''); setEditing(item); }}><Icon name="calendar" size={18} /></button>
            <button className="icon-button delete-button" aria-label={`Удалить напоминание: ${item.title}`} disabled={blocked} onClick={() => { setWriteError(''); setDeleting(item); }}><Icon name="trash" size={18} /></button></div>
        </li>)}</ul>{page.nextCursor !== null && <button className="button load-more" disabled={blocked} onClick={() => void loadMore()}>Показать ещё</button>}</>
        : <div className="empty-state"><p>Не удалось загрузить напоминания.</p><button className="button secondary" onClick={() => void refresh()}>Повторить</button></div>}
    </div>
    <div className="list-footer"><Icon name="shield" size={16} /><span>Личные напоминания в Telegram</span></div>
    {(creating || editing) && <ReminderForm item={editing ?? undefined} onClose={closeForm} onSaved={saved} />}
    {deleting && <Sheet title="Удалить напоминание?" subtitle="Ожидающая отправка будет отменена." onClose={() => setDeleting(null)} busy={pending !== null}>
      <div className="delete-preview"><Icon name="bell" /><p>{deleting.title}</p></div>
      {writeError && <div className="form-error" role="alert">{writeError}</div>}
      <div className="dialog-actions"><button className="button secondary" disabled={pending !== null} onClick={() => setDeleting(null)}>Оставить</button>
        <button className="button danger" disabled={pending !== null} onClick={() => void write(deleting, true)}>{pending !== null && <span className="spinner" />}Удалить</button></div>
    </Sheet>}
  </section>;
}
