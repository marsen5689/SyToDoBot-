import { useEffect, useRef, useState } from 'react';
import { api, availability, errorMessage } from './api';
import { useTelegram, haptic } from './useTelegram';
import { useTasks } from './useTasks';
import { CreateTask } from './CreateTask';
import { Sheet } from './Sheet';
import { EditSchedule } from './EditSchedule';
import { deadlineFormat } from './schedule';
import { Icon } from './icons';
import type { Profile, Task } from './types';

const priorityLabels = { high: 'Важная', normal: 'Обычная', low: 'Не спешит' };
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

function ProfileCard({ profile, error, retry }: { profile: Profile | null; error: string; retry: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = profile ? `${profile.first_name.charAt(0)}${profile.last_name.charAt(0)}`.toUpperCase() || 'Я' : '';
  const name = profile ? `${profile.first_name} ${profile.last_name}`.trim() || 'Ваш профиль' : 'Ваш профиль';
  const safePhoto = profile?.photo_url.startsWith('https://') ? profile.photo_url : '';
  return <section className="profile-card" aria-label="Telegram-профиль">
    <div className="profile-top"><span className="eyebrow">TELEGRAM-ПРОФИЛЬ</span><Icon name="telegram" size={19} /></div>
    <div className="profile-person">
      <div className={`avatar ${!profile && !error && availability() === 'ready' ? 'skeleton' : ''}`}>
        {safePhoto && !imageFailed ? <img src={safePhoto} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          : profile ? initials : <Icon name="user" size={24} />}
      </div>
      <div className="profile-name"><h2>{name}</h2><p>{profile?.username ? `@${profile.username}` : profile ? 'Аккаунт Telegram' : 'Войдите через Telegram'}</p></div>
    </div>
    {error ? <div className="profile-error" role="alert"><span>{error}</span><button className="text-button" onClick={retry}>Повторить</button></div>
      : <div className="profile-bottom"><span className="status-dot" /><span>{profile ? 'Подключено к Telegram' : 'Ваши задачи всегда под рукой'}</span>{profile && <Icon name="check" size={15} />}</div>}
  </section>;
}

function TaskRow({ task, busy, disabled, now, onComplete, onDelete, onSchedule }: {
  task: Task; busy: boolean; disabled: boolean; now: number; onComplete: () => void; onDelete: () => void; onSchedule: () => void;
}) {
  return <li className={`task-card ${task.completed ? 'is-completed' : ''} ${busy ? 'is-busy' : ''}`}>
    <button className="task-checkbox" role="checkbox" aria-checked={task.completed}
      aria-label={`${task.completed ? 'Вернуть в активные' : 'Выполнить'}: ${task.title}`}
      disabled={disabled} onClick={onComplete}>
      {busy ? <span className="spinner" /> : task.completed ? <Icon name="check" size={18} /> : null}
    </button>
    <div className="task-content"><h3>{task.title}</h3>{task.note && <p className="task-note">{task.note}</p>}
      {task.dueAt !== null && <div className={`task-deadline ${!task.completed && task.dueAt < now ? 'is-overdue' : ''}`}>
        <Icon name="calendar" size={14} /><span>{deadlineFormat.format(task.dueAt)}</span>
        {!task.completed && task.dueAt < now && <span className="deadline-status">Просрочено</span>}
      </div>}
      {task.reminderMinutes !== null && !task.completed && <div className="task-reminder"><Icon name="bell" size={14} /><span>
        {task.reminderSentAt !== null ? 'Напоминание отправлено' : task.reminderAt === null ? 'Напоминание отключено'
          : task.reminderMinutes === 0 ? 'Напомнить в дедлайн' : task.reminderMinutes === 15 ? 'Напомнить за 15 минут'
          : task.reminderMinutes === 60 ? 'Напомнить за час' : 'Напомнить за день'}
      </span></div>}
      <div className="task-meta"><span className={`priority-badge ${task.priority}`}><span className="priority-dot" />{priorityLabels[task.priority]}</span>
        <span className="task-date"><Icon name="clock" size={12} />{dateFormat.format(new Date(task.createdAt))}</span>
        {task.completed && <span className="completed-label">Готово</span>}
      </div>
    </div>
    <div className="task-actions"><button className="icon-button schedule-button" aria-label={`Настроить срок: ${task.title}`} title="Дедлайн" onClick={onSchedule} disabled={disabled}><Icon name="calendar" size={18} /></button>
      <button className="icon-button delete-button" aria-label={`Удалить: ${task.title}`} onClick={onDelete} disabled={disabled}><Icon name="trash" size={18} /></button></div>
  </li>;
}

function EmptyState({ completed, onCreate }: { completed: boolean; onCreate: () => void }) {
  return <div className="empty-state"><div className="state-icon"><Icon name={completed ? 'check' : 'list'} size={26} /></div>
    <h3>{completed ? 'Здесь будут ваши маленькие победы' : 'Место для новых планов'}</h3>
    <p>{completed ? 'Отметьте задачу выполненной — и она появится здесь.' : 'Добавьте задачу, выберите приоритет и сохраните детали.'}</p>
    {!completed && <button className="button secondary" onClick={onCreate}><Icon name="plus" size={18} />Добавить первую задачу</button>}
  </div>;
}

export function App() {
  useTelegram();
  const access = availability();
  const { status, selectStatus, page, loading, error, applyWrite, refresh, loadMore } = useTasks();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [creating, setCreating] = useState(() => access === 'ready' && new URLSearchParams(window.location.search).get('action') === 'new');
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Task | null>(null);
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const writeLock = useRef(false);
  const profileSequence = useRef(0);

  async function loadProfile() {
    if (access !== 'ready') return;
    const request = ++profileSequence.current;
    setProfileError('');
    try { const result = await api.profile(); if (request === profileSequence.current) setProfile(result); }
    catch (cause) { if (request === profileSequence.current) setProfileError(errorMessage(cause)); }
  }
  useEffect(() => { void loadProfile(); return () => { ++profileSequence.current; }; }, [access]); // access is fixed for this WebView session
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timeout); }, [notice]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);

  async function complete(task: Task) {
    if (writeLock.current) return;
    writeLock.current = true; setPending(task.id); setMutationError('');
    try {
      const result = await api.complete(task.id, !task.completed);
      applyWrite(result.task);
      haptic('success'); setNotice(task.completed ? 'Задача снова в активных' : 'Задача выполнена');
      await refresh();
    } catch (cause) { setMutationError(errorMessage(cause)); haptic('error'); }
    finally { writeLock.current = false; setPending(null); }
  }
  async function remove() {
    if (!deleting || writeLock.current) return;
    writeLock.current = true; setPending(deleting.id); setDeleteError('');
    try {
      await api.delete(deleting.id);
      applyWrite(deleting, true);
      setDeleting(null); haptic('light'); setNotice('Задача удалена'); await refresh();
    } catch (cause) { setDeleteError(errorMessage(cause)); haptic('error'); }
    finally { writeLock.current = false; setPending(null); }
  }

  const active = page?.counts.active;
  const completed = page?.counts.completed;
  const total = active !== undefined && completed !== undefined ? active + completed : 0;
  const progress = total ? Math.round(completed! / total * 100) : 0;
  const blocked = pending !== null || loading !== null;
  const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(new Date());

  return <div className="app-shell">
    <header className="header"><a className="brand" href="/" aria-label="SyToDo — главная"><span className="brand-mark"><Icon name="check" size={23} /></span><span>SyToDo<span className="brand-period">.</span></span></a>
      <div className="header-caption"><span>Личное пространство</span><span className="breadcrumb-divider">/</span><span>Задачи</span></div><div className="header-date">{date}</div></header>
    <main>
      <div className="intro"><div className="intro-copy"><div className="eyebrow">ВАШ ДЕНЬ. ВАШ ПЛАН.</div>
        <h1>Порядок в каждом дне.</h1>
        <p>Сохраните важное. Сосредоточьтесь на следующем шаге.</p>
      </div><ProfileCard profile={profile} error={profileError} retry={() => void loadProfile()} /></div>

      <div className="workspace">
        <aside className="overview"><div className="overview-title"><Icon name="list" size={18} /><span>Обзор задач</span></div>
          <div className="stat-grid"><div className="stat"><span className="stat-label">АКТИВНЫЕ</span><strong>{active ?? '—'}</strong><span className="stat-caption">в работе</span></div>
            <div className="stat"><span className="stat-label">ВЫПОЛНЕНО</span><strong>{completed ?? '—'}</strong><span className="stat-caption">в списке</span></div></div>
          <div className="progress-card"><div className="progress-top"><span>Ваш прогресс</span><strong>{page ? `${progress}%` : '—'}</strong></div>
            <div className="progress-track" role="progressbar" aria-label="Выполненные задачи" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
            <p>{!total ? 'Добавьте задачу, чтобы начать.' : progress === 100 ? 'Все задачи выполнены.' : `${completed} из ${total} задач выполнено`}</p>
          </div>
          <div className="privacy-note"><Icon name="shield" size={18} /><span>Личные задачи.<br />Доступ только у вас.</span></div>
        </aside>

        <section className="tasks-panel" aria-labelledby="tasks-heading"><div className="tasks-heading"><div><span className="eyebrow">СПИСОК ЗАДАЧ</span><h2 id="tasks-heading">Мои задачи</h2></div>
          <button className="button primary add-task" onClick={() => { haptic('light'); setCreating(true); }} disabled={access !== 'ready' || pending !== null}><Icon name="plus" /><span>Новая задача</span></button></div>
          <div className="tasks-toolbar"><div className="tabs" role="tablist" aria-label="Фильтр задач">
            {([['active', 'Активные', active], ['completed', 'Готово', completed], ['all', 'Все', page ? total : undefined]] as const).map(([value, label, count]) =>
              <button key={value} role="tab" id={`tab-${value}`} aria-selected={status === value} aria-controls="task-list"
                className={status === value ? 'selected' : ''} disabled={pending !== null} onClick={() => { selectStatus(value); setMutationError(''); }}>
                {label}{count !== undefined && <span className="tab-count">{count}</span>}</button>)}
          </div><button className="icon-button refresh-button" aria-label="Обновить список задач" disabled={access !== 'ready' || blocked}
            onClick={() => { setMutationError(''); void refresh(); }}><Icon name="refresh" size={18} className={loading === 'refresh' ? 'rotating' : ''} /></button></div>

          {(error || mutationError) && <div className="error-banner" role="alert"><Icon name="alert" size={20} /><div><strong>Не получилось с первого раза</strong><p>{mutationError || error}</p></div>
            <button className="text-button" disabled={blocked} onClick={() => { setMutationError(''); void refresh(); }}>Обновить</button></div>}

          <div id="task-list" role="tabpanel" aria-labelledby={`tab-${status}`} aria-busy={loading !== null} className="task-list-wrap">
            {access !== 'ready' ? <div className="launch-state"><div className="launch-icon"><Icon name="telegram" size={34} /></div>
              <h3>{access === 'unsupported' ? 'Обновите Telegram' : 'Ваш день начинается здесь'}</h3>
              <p>{access === 'unsupported' ? 'Для работы с задачами нужна актуальная версия Telegram и Mini Apps SDK. Обновите Telegram и откройте приложение снова.' : 'Откройте SyToDo через Telegram, чтобы увидеть свой профиль и сохранить первую задачу.'}</p>
              <a className="button primary" href="https://t.me/SyToDoBot" target="_blank" rel="noopener noreferrer">Открыть в Telegram<Icon name="arrow" size={18} /></a>
              <span className="launch-note">Ваши планы сохранятся к следующему открытию</span></div>
              : !page && loading ? <div className="skeleton-list" aria-label="Загружаем задачи">{[1, 2, 3].map((key) => <div key={key} className="task-skeleton"><span className="skeleton skeleton-circle" /><div><span className="skeleton skeleton-line" /><span className="skeleton skeleton-small" /></div></div>)}</div>
              : page && page.tasks.length === 0 ? <EmptyState completed={status === 'completed'} onCreate={() => setCreating(true)} />
              : page ? <><ul className="task-list">{page.tasks.map((task) => <TaskRow key={task.id} task={task} busy={pending === task.id} disabled={blocked} now={now}
                onComplete={() => void complete(task)} onSchedule={() => setEditingSchedule(task)} onDelete={() => { setDeleteError(''); setDeleting(task); }} />)}</ul>
                {page.nextCursor !== null && <button className="button load-more" disabled={blocked} onClick={() => void loadMore()}>{loading === 'more' ? <><span className="spinner" />Загружаем…</> : 'Показать ещё'}</button>}</>
              : <div className="empty-state"><Icon name="refresh" size={32} /><h3>Пока не удалось загрузить задачи</h3><p>Ваши планы ждут на сервере. Попробуйте обновить список.</p></div>}
          </div>
          <div className="list-footer"><Icon name="shield" size={16} /><span>Задачи сохраняются автоматически</span></div>
        </section>
      </div>
    </main>
    <footer className="footer"><span>SyToDo<span className="brand-period">.</span><span className="footer-divider">/</span>Для того, что важно</span><span>Ваши задачи в Telegram</span></footer>
    <div className="toast-region" role="status" aria-live="polite">{notice && <div className="toast"><Icon name="check" size={18} />{notice}</div>}</div>
    {creating && <CreateTask onClose={() => setCreating(false)} onCreated={(task) => { applyWrite(task); setCreating(false); setNotice('Задача сохранена'); void refresh(); }} />}
    {editingSchedule && <EditSchedule task={editingSchedule} onClose={() => setEditingSchedule(null)} onSaved={(task) => {
      applyWrite(task); setEditingSchedule(null); setNow(Date.now()); setNotice('Настройки сохранены'); void refresh();
    }} />}
    {deleting && <Sheet title="Удалить задачу?" subtitle="Она исчезнет из вашего списка." onClose={() => setDeleting(null)} busy={pending !== null}>
      <div className="delete-preview"><Icon name={deleting.completed ? 'check' : 'list'} /><p>{deleting.title}</p></div>
      {deleteError && <div className="form-error" role="alert"><Icon name="alert" size={18} /><span>{deleteError}</span></div>}
      <div className="dialog-actions"><button className="button secondary" disabled={pending !== null} onClick={() => setDeleting(null)}>Оставить</button>
        <button className="button danger" disabled={pending !== null} onClick={() => void remove()}>{pending !== null ? <span className="spinner" /> : <Icon name="trash" size={18} />}Удалить</button></div>
    </Sheet>}
  </div>;
}
