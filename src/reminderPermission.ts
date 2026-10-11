import { ApiError, telegram } from './api';

export function requestReminderPermission(): Promise<void> {
  const app = telegram();
  if (!app?.isVersionAtLeast('6.9') || !app.requestWriteAccess) {
    return Promise.reject(new ApiError('Обновите Telegram, чтобы разрешить боту отправлять напоминания.', 'WRITE_PERMISSION_REQUIRED'));
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new ApiError(
      'Подтвердите разрешение на сообщения бота и попробуйте снова.', 'WRITE_PERMISSION_REQUIRED',
    )), 60000);
    try {
      app.requestWriteAccess!(allowed => {
        window.clearTimeout(timeout);
        if (allowed) resolve();
        else reject(new ApiError('Разрешите сообщения бота, чтобы получать напоминания.', 'WRITE_PERMISSION_REQUIRED'));
      });
    } catch {
      window.clearTimeout(timeout);
      reject(new ApiError('Не удалось запросить разрешение на сообщения. Попробуйте снова.', 'WRITE_PERMISSION_REQUIRED'));
    }
  });
}
