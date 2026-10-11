import { useCallback, useEffect, useRef, useState } from 'react';
import { api, availability, errorMessage } from './api';
import type { Task, TaskPage, TaskStatus } from './types';

export function useTasks(kind: 'task' | 'reminder' = 'task') {
  const [status, setStatus] = useState<TaskStatus>(() => {
    const filter = new URLSearchParams(window.location.search).get('filter');
    return filter === 'completed' || (kind === 'task' && filter === 'all') ? filter : 'active';
  });
  const [page, setPage] = useState<TaskPage | null>(null);
  const [loading, setLoading] = useState<'initial' | 'refresh' | 'more' | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const statusRef = useRef(status);
  const pageRef = useRef(page);
  const fetching = useRef(false);

  const load = useCallback(async (append = false): Promise<boolean> => {
    if (availability() !== 'ready') return false;
    if (append && (fetching.current || !pageRef.current?.nextCursor)) return false;
    const request = ++sequence.current;
    const filter = statusRef.current;
    const cursor = append ? pageRef.current?.nextCursor ?? undefined : undefined;
    fetching.current = true;
    setLoading(append ? 'more' : pageRef.current ? 'refresh' : 'initial');
    setError('');
    try {
      const result = await (kind === 'reminder' ? api.reminders(filter, cursor) : api.tasks(filter, cursor));
      if (request !== sequence.current) return false;
      const next = append && pageRef.current ? {
        ...result,
        tasks: [...pageRef.current.tasks, ...result.tasks.filter((task) => !pageRef.current!.tasks.some((existing) => existing.id === task.id))],
      } : result;
      pageRef.current = next;
      setPage(next);
      return true;
    } catch (cause) {
      if (request === sequence.current) setError(errorMessage(cause));
      return false;
    } finally {
      if (request === sequence.current) { fetching.current = false; setLoading(null); }
    }
  }, [kind]);

  const selectStatus = useCallback((next: TaskStatus) => {
    if (next === statusRef.current) return;
    ++sequence.current;
    statusRef.current = next;
    pageRef.current = null;
    setPage(null);
    setStatus(next);
  }, []);

  useEffect(() => {
    void load();
    return () => { ++sequence.current; };
  }, [status, load]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && !fetching.current) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [load]);

  function applyWrite(task: Task, deleted = false, previous?: Task) {
    // Commit a confirmed write locally even when a following refresh fails.
    ++sequence.current;
    fetching.current = false;
    setLoading(null);
    const current = pageRef.current;
    if (!current) return;
    const old = current.tasks.find((item) => item.id === task.id) ?? previous;
    const counts = { ...current.counts };
    const isDone = (item: Task) => kind === 'reminder' ? item.reminderSentAt !== null : item.completed;
    if (old) counts[isDone(old) ? 'completed' : 'active']--;
    if (!deleted) counts[isDone(task) ? 'completed' : 'active']++;
    const visible = !deleted && (statusRef.current === 'all' || isDone(task) === (statusRef.current === 'completed'));
    const items = current.tasks.filter((item) => item.id !== task.id);
    if (visible) items.push(task);
    const next = { ...current, counts, tasks: items.sort((a, b) => b.id - a.id) };
    pageRef.current = next;
    setPage(next);
  }
  return { status, selectStatus, page, loading, error, applyWrite, refresh: () => load(), loadMore: () => load(true) };
}
