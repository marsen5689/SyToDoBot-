import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runtime } from '../sqlite-runtime.mjs';
import type { Page } from '@playwright/test';

// The browser uses the real official WebApp SDK. Only Telegram's authenticated
// transport is intercepted in this test; application endpoints run against SQLite.
let sdk: string;
test.use({ timezoneId: 'Europe/Moscow' });
test.beforeAll(async ({ request }) => {
  sdk = process.env.TELEGRAM_SDK_PATH ? await readFile(process.env.TELEGRAM_SDK_PATH, 'utf8')
    : await (await request.get('https://telegram.org/js/telegram-web-app.js')).text();
});

async function pickDateTime(page: Page, value: string, label = 'Дедлайн') {
  const [date, time] = value.split('T');
  const [year, month] = date.split('-');
  const [hour, minute] = time.split(':');
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await page.getByLabel('Год', { exact: true }).selectOption(year);
  await page.getByLabel('Месяц', { exact: true }).selectOption(String(Number(month) - 1));
  await page.getByRole('button', { name: date, exact: true }).click();
  await page.getByRole('listbox', { name: 'Часы', exact: true }).getByRole('option', { name: hour, exact: true }).click();
  await page.getByRole('listbox', { name: 'Минуты', exact: true }).getByRole('option', { name: minute, exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Часы' }).getByRole('option', { selected: true })).toHaveText(hour);
  await expect(page.getByRole('listbox', { name: 'Минуты' }).getByRole('option', { selected: true })).toHaveText(minute);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
}

for (const theme of ['light', 'dark'] as const) {
  test(`mobile CRUD, persistence and theme: ${theme}`, async ({ page }) => {
    test.setTimeout(60000); // Full CRUD plus reload and two bot deep-link navigations.
    await page.setViewportSize({ width: 390, height: 844 });
    const app = await runtime(':memory:', { remindersEnabled: false });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let failList = false;
    await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: sdk }));
    await page.route('**/api/*', async (route) => {
      const endpoint = route.request().url().split('/').pop()!;
      if (failList && endpoint === 'listTasks') {
        await route.fulfill({ status: 500, json: { ok: false, error_type: 'INTERNAL', description: 'Test-only failure' } }); return;
      }
      try {
        const value = await app.endpoints[endpoint](route.request().postDataJSON(), { initData: { user: { id: 101, first_name: 'Анна', last_name: 'Соколова', username: 'anna_test' } } });
        await route.fulfill({ json: { ok: true, result: value } });
      } catch (error: any) {
        await route.fulfill({ status: 400, json: { ok: false, error_type: 'ENDPOINT_ERROR', description: error.message, parameters: error.parameters } });
      }
    });
    const params = theme === 'dark' ? { bg_color: '#181e1a', secondary_bg_color: '#29342b', text_color: '#edf1e6' }
      : { bg_color: '#f6f7f2', secondary_bg_color: '#eff1e9', text_color: '#252e26' };
    const data = `user=${encodeURIComponent(JSON.stringify({ id: 101, first_name: 'Анна' }))}&auth_date=1791634000&hash=test-fixture-only`;
    const hash = `#tgWebAppData=${encodeURIComponent(data)}&tgWebAppVersion=9.0&tgWebAppPlatform=web&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(params))}`;
    try {
      await page.goto('/' + hash);
      await expect(page.getByText('Анна Соколова')).toBeVisible();
      await expect(page.getByText('Место для новых планов')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('body')).toHaveCSS('background-color', theme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(10, 10, 10)');
      await expect(page.locator('.profile-card')).toHaveCSS('border-radius', '24px');
      await expect(page.locator('.add-task')).toHaveCSS('border-radius', '18px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Новая задача' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Создать задачу' })).toBeDisabled();
      await page.getByLabel('Что нужно сделать?').fill('Подготовить запуск');
      await page.getByLabel('Описание').fill('Проверить всё на смартфоне');
      await page.getByText('Важный', { exact: true }).click();
      await pickDateTime(page, '2027-03-10T15:30');
      await expect(page.getByLabel('Напоминание в Telegram')).toBeDisabled();
      await expect(page.getByText('Автоматическая отправка пока не подключена.')).toBeVisible();
      await page.screenshot({ path: `test-results/form-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Создать задачу' }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByRole('heading', { name: 'Подготовить запуск' })).toBeVisible();
      await expect(page.getByText('Проверить всё на смартфоне')).toBeVisible();
      await expect(page.locator('.task-deadline')).toContainText('15:30');
      expect((await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks[0].dueAt).toBe(Date.UTC(2027, 2, 10, 12, 30));
      await page.getByRole('button', { name: 'Настроить срок: Подготовить запуск' }).click();
      await expect(page.getByRole('button', { name: /^Дедлайн:/ })).toContainText('15:30');
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await pickDateTime(page, '2001-01-01T12:00');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByText('Просрочено')).toBeVisible();
      await page.getByRole('button', { name: 'Настроить срок: Подготовить запуск' }).click();
      await page.getByRole('button', { name: 'Очистить', exact: true }).click();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.locator('.task-deadline')).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Настроить срок: Подготовить запуск' }).click();
      await pickDateTime(page, '2027-03-10T15:30');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.screenshot({ path: `test-results/tasks-${theme}.png`, fullPage: true });
      // Refresh failure must not roll back a successful mutation in the UI.
      failList = true;
      await page.getByRole('checkbox', { name: 'Выполнить: Подготовить запуск' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Подготовить запуск' })).not.toBeVisible();
      failList = false;
      await page.getByRole('tab', { name: /^Готово/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Вернуть в активные: Подготовить запуск' })).toBeVisible();
      await page.reload();
      await page.getByRole('tab', { name: /^Готово/ }).click();
      await expect(page.getByRole('heading', { name: 'Подготовить запуск' })).toBeVisible();
      await expect(page.locator('.task-deadline')).toContainText('15:30');
      await page.getByRole('checkbox', { name: 'Вернуть в активные: Подготовить запуск' }).click();
      await page.getByRole('tab', { name: /^Активные/ }).click();
      await expect(page.getByRole('heading', { name: 'Подготовить запуск' })).toBeVisible();
      await page.getByRole('button', { name: 'Удалить: Подготовить запуск' }).click();
      await page.getByRole('button', { name: 'Оставить', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Подготовить запуск' })).toBeVisible();
      await page.screenshot({ path: `test-results/mobile-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Удалить: Подготовить запуск' }).click();
      await page.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(page.getByText('Место для новых планов')).toBeVisible();
      await page.goto('/?action=new' + hash);
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await page.goto('/?filter=completed' + hash);
      await expect(page.getByRole('tab', { name: /^Готово/ })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Здесь будут ваши маленькие победы')).toBeVisible();
      expect(errors).toEqual([]);
    } finally { app.close(); }
  });
}

test('outside Telegram: desktop and narrow mobile have no fake tasks or enabled writes', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: sdk }));
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/');
    await expect(page.getByText('Ваш день начинается здесь')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новая задача' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/outside-${width}.png`, fullPage: true });
  }
});

test('enabled reminders require write permission, save the interval and can be cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await runtime(':memory:', { remindersEnabled: true });
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
  await page.route('**/api/*', async route => {
    const endpoint = route.request().url().split('/').pop()!;
    try {
      const result = await app.endpoints[endpoint](route.request().postDataJSON(), { initData: { user: { id: 101, first_name: 'Анна' } } });
      await route.fulfill({ json: { ok: true, result } });
    } catch (error: any) {
      await route.fulfill({ status: 400, json: { ok: false, error_type: 'ENDPOINT_ERROR', description: error.message, parameters: error.parameters } });
    }
  });
  const data = `user=${encodeURIComponent(JSON.stringify({ id: 101, first_name: 'Анна' }))}&auth_date=1791634000&hash=test-fixture-only`;
  try {
    await page.goto('/#tgWebAppData=' + encodeURIComponent(data) + '&tgWebAppVersion=9.0&tgWebAppPlatform=web');
    // Emulate only the native permission reply, keeping requestWriteAccess and
    // Serverless.call from the official SDK intact. No real messages are sent.
    await page.evaluate(() => {
      const native = (window as any).Telegram.WebView;
      const post = native.postEvent;
      (window as any).allowReminderMessages = false;
      (window as any).permissionRequests = 0;
      native.postEvent = (name: string, ...args: any[]) => {
        if (name === 'web_app_request_write_access') {
          (window as any).permissionRequests++;
          native.receiveEvent('write_access_requested', { status: (window as any).allowReminderMessages ? 'allowed' : 'cancelled' });
        } else post(name, ...args);
      };
    });
    await page.getByRole('button', { name: 'Новая задача' }).click();
    await page.getByLabel('Что нужно сделать?').fill('Задача с напоминанием');
    await pickDateTime(page, '2030-03-10T15:30');
    await expect(page.getByLabel('Напоминание в Telegram')).toBeEnabled();
    await page.getByLabel('Напоминание в Telegram').selectOption('custom');
    await page.getByLabel('За сколько минут?').fill('37');
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    await expect(page.getByRole('alert')).toContainText('Разрешите сообщения бота');
    expect((await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks).toHaveLength(0);
    await expect(page.getByLabel('Что нужно сделать?')).toBeEnabled();
    await page.evaluate(() => { (window as any).allowReminderMessages = true; });
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('Напомнить за 37 минут')).toBeVisible();
    const saved = (await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks[0];
    expect(saved.reminderAt).toBe(saved.dueAt - 37 * 60000);
    await page.getByRole('button', { name: 'Настроить срок: Задача с напоминанием' }).click();
    await page.getByLabel('Напоминание в Telegram').selectOption('off');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.task-reminder')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(2);
    expect((await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks[0].reminderAt).toBeNull();
  } finally { app.close(); }
});

for (const theme of ['light', 'dark'] as const) {
  test(`standalone reminders, calendar and vertical time wheels: ${theme}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 320, height: 844 });
    let now = Date.UTC(2030, 2, 10, 12);
    const app = await runtime(':memory:', { now: () => now });
    const owner = { initData: { user: { id: 101, first_name: 'Анна' } } };
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
    await page.route('**/api/*', async route => {
      const endpoint = route.request().url().split('/').pop()!;
      try {
        const result = await app.endpoints[endpoint](route.request().postDataJSON(), owner);
        await route.fulfill({ json: { ok: true, result } });
      } catch (error: any) {
        await route.fulfill({ status: 400, json: { ok: false, error_type: 'ENDPOINT_ERROR', description: error.message, parameters: error.parameters } });
      }
    });
    const data = `user=${encodeURIComponent(JSON.stringify({ id: 101, first_name: 'Анна' }))}&auth_date=1791634000&hash=test-fixture-only`;
    const hash = `#tgWebAppData=${encodeURIComponent(data)}&tgWebAppVersion=9.0&tgWebAppPlatform=web&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify({ bg_color: theme === 'dark' ? '#0a0a0a' : '#ffffff', text_color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }))}`;
    const nativePermission = async () => page.evaluate(() => {
      const native = (window as any).Telegram.WebView;
      const post = native.postEvent;
      native.postEvent = (name: string, ...args: any[]) => {
        if (name === 'web_app_request_write_access') native.receiveEvent('write_access_requested', { status: 'allowed' });
        else post(name, ...args);
      };
    });
    try {
      await page.goto('/?view=reminders' + hash); await nativePermission();
      await expect(page.getByRole('heading', { name: 'Мои напоминания' })).toBeVisible();
      await page.getByRole('button', { name: 'Новое напоминание', exact: true }).click();
      await page.getByLabel('О чём напомнить?').fill('Позвонить родителям');
      await page.getByLabel('Детали', { exact: false }).fill('Рассказать хорошие новости');
      await page.getByRole('button', { name: /^Дата и время события:/ }).click();
      await page.getByRole('button', { name: 'Завтра', exact: true }).click();
      const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
      await expect(page.getByRole('button', { name: tomorrow, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await pickDateTime(page, '2030-03-10T15:30', 'Дата и время события');
      await page.getByRole('button', { name: /^Дата и время события:/ }).click();
      const minutes = page.getByRole('listbox', { name: 'Минуты', exact: true });
      await minutes.scrollIntoViewIfNeeded();
      const bounds = (await minutes.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 80);
      await expect(minutes.getByRole('option', { selected: true })).toHaveText('32');
      await minutes.focus(); await minutes.press('End');
      await expect(minutes.getByRole('option', { selected: true })).toHaveText('59');
      await minutes.press('Home'); await minutes.press('ArrowDown');
      await expect(minutes.getByRole('option', { selected: true })).toHaveText('01');
      await minutes.getByRole('option', { name: '30', exact: true }).click();
      expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.locator('.datetime-panel').screenshot({ path: `test-results/calendar-wheel-${theme}.png` });
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Создать напоминание', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByRole('heading', { name: 'Позвонить родителям' })).toBeVisible();
      const saved = (await app.endpoints.listReminders({}, owner)).tasks[0];
      expect(saved.dueAt).toBe(Date.UTC(2030, 2, 10, 12, 30));
      expect((await app.endpoints.listTasks({ status: 'all' }, owner)).tasks).toHaveLength(0);
      await page.reload(); await nativePermission();
      await expect(page.getByRole('heading', { name: 'Позвонить родителям' })).toBeVisible();
      await page.getByRole('button', { name: 'Изменить напоминание: Позвонить родителям' }).click();
      await page.getByLabel('О чём напомнить?').fill('Позвонить маме');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Позвонить маме' })).toBeVisible();
      now = saved.dueAt;
      await app.endpoints.processReminders({}, { initData: { user: { id: 8347651382 } }, maintenanceJob: 'sytodo-reminders' });
      await page.getByRole('button', { name: 'Обновить напоминания' }).click();
      await page.getByRole('tab', { name: /^История/ }).click();
      await expect(page.getByText('Отправлено', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Ещё раз через 10 минут' }).click();
      await expect(page.getByRole('tab', { name: /^Ожидают/ })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'Позвонить маме' })).toBeVisible();
      expect((await app.endpoints.getReminder({ id: saved.id }, owner)).task.dueAt).toBe(now + 600000);
      await expect(page.getByRole('button', { name: 'Обновить напоминания' })).toBeEnabled();
      await expect(page.locator('.reminder-card')).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const tab of await page.getByRole('tab').all()) expect(await tab.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/reminders-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Удалить напоминание: Позвонить маме' }).click();
      await page.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Важное не потеряется' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Разделы приложения' }).getByRole('button', { name: 'Задачи', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Мои задачи', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { app.close(); }
  });
}
