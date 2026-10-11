export type Priority = 'low' | 'normal' | 'high';
export type TaskStatus = 'active' | 'completed' | 'all';
export type RepeatMode = 'daily' | 'alternate' | 'weekdays';
export interface RecurrenceInput { mode: RepeatMode; timeZone: string; weekdays?: number[] }
export interface RecurrenceRule extends RecurrenceInput { anchorDate: string; minuteOfDay: number; weekdays: number[] }
export interface Task {
  id: number; title: string; note: string; priority: Priority;
  completed: boolean; createdAt: number; updatedAt: number;
  dueAt: number | null; dueOffsetMinutes: number;
  reminderMinutes: number | null; reminderAt: number | null; reminderSentAt: number | null;
  recurrence: RecurrenceRule | null; lastReminderDueAt: number | null;
}
export interface TaskSchedule {
  dueAt: number | null; dueOffsetMinutes: number;
  reminderMinutes: number | null;
  recurrence?: RecurrenceInput | null;
}
export interface Profile {
  id: number; first_name: string; last_name: string; username: string; photo_url: string;
}
export interface TaskPage {
  tasks: Task[]; counts: { active: number; completed: number }; nextCursor: number | null;
}
export interface ServerlessError {
  message: string; type: string; parameters?: { code?: string; field?: string };
}
export interface WebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string | undefined>;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  requestWriteAccess?(callback: (allowed: boolean) => void): void;
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium'): void;
    notificationOccurred(type: 'success' | 'error'): void;
  };
  BackButton: { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
  Serverless?: { call(name: string, input: object, callback: (error: ServerlessError | null, result: unknown) => void): void };
}
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }
