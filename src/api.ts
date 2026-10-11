import type { Priority, Profile, ServerlessError, Task, TaskPage, TaskStatus, TaskSchedule } from './types';

export class ApiError extends Error {
  constructor(message: string, public code = 'INTERNAL', public field?: string) { super(message); }
}
export function telegram() { return window.Telegram?.WebApp; }
export function availability(): 'outside' | 'unsupported' | 'ready' {
  const app = telegram();
  if (!app?.initData) return 'outside';
  return typeof app.Serverless?.call === 'function' ? 'ready' : 'unsupported';
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Не удалось связаться с сервером. Попробуйте ещё раз.';
}

// The official SDK sends initData and returns the unwrapped result.
export function callEndpoint<T>(name: string, input: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const app = telegram();
    if (availability() !== 'ready' || !app?.Serverless) {
      reject(new ApiError('Откройте приложение в обновлённом Telegram.', 'UNAUTHORIZED'));
      return;
    }
    // A timeout is ambiguous for mutations. Never automatically retry a write.
    const timer = window.setTimeout(() => reject(new ApiError(
      'Сервер отвечает дольше обычного. Обновите список перед повторной попыткой.', 'TIMEOUT',
    )), 20000);
    try {
      app.Serverless.call(name, input, (error: ServerlessError | null, result: unknown) => {
        window.clearTimeout(timer);
        if (error) {
          const message = error.type === 'ENDPOINT_ERROR' ? error.message
            : error.type === 'UNAUTHORIZED' ? 'Сессия истекла. Закройте и снова откройте приложение в Telegram.'
            : 'Не удалось загрузить данные. Проверьте соединение и попробуйте ещё раз.';
          reject(new ApiError(message, error.parameters?.code ?? error.type, error.parameters?.field));
        } else resolve(result as T);
      });
    } catch {
      window.clearTimeout(timer);
      reject(new ApiError('Не удалось отправить запрос. Проверьте соединение.', 'NETWORK_ERROR'));
    }
  });
}
export const api = {
  reminderCapabilities: () => callEndpoint<{ enabled: boolean; precisionMinutes: number }>('getReminderCapabilities'),
  profile: () => callEndpoint<Profile>('getProfile'),
  tasks: (status: TaskStatus, cursor?: number) => callEndpoint<TaskPage>('listTasks', { status, ...(cursor ? { cursor } : {}) }),
  create: (input: { title: string; note: string; priority: Priority; requestId: string } & TaskSchedule) => callEndpoint<{ task: Task }>('createTask', input),
  schedule: (id: number, schedule: TaskSchedule) => callEndpoint<{ task: Task }>('setTaskSchedule', { id, ...schedule }),
  complete: (id: number, completed: boolean) => callEndpoint<{ task: Task }>('setTaskCompleted', { id, completed }),
  delete: (id: number) => callEndpoint<{ id: number }>('deleteTask', { id }),
};
