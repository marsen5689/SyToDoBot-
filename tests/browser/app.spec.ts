import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runtime } from '../sqlite-runtime.mjs';

// The browser uses the real official WebApp SDK. Only Telegram's authenticated
// transport is intercepted in this test; application endpoints run against SQLite.
let sdk: string;
test.use({ timezoneId: 'Europe/Moscow' });
test.beforeAll(async ({ request }) => {
  sdk = process.env.TELEGRAM_SDK_PATH ? await readFile(process.env.TELEGRAM_SDK_PATH, 'utf8')
    : await (await request.get('https://telegram.org/js/telegram-web-app.js')).text();
});

for (const theme of ['light', 'dark'] as const) {
  test(`mobile CRUD, persistence and theme: ${theme}`, async ({ page }) => {
    test.setTimeout(60000); // Full CRUD plus reload and two bot deep-link navigations.
    await page.setViewportSize({ width: 390, height: 844 });
    const app = await runtime();
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
      await page.getByLabel(/^Дедлайн/).fill('2027-03-10T15:30');
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
      await expect(page.getByLabel(/^Дедлайн/)).toHaveValue('2027-03-10T15:30');
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByLabel(/^Дедлайн/).fill('2001-01-01T12:00');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByText('Просрочено')).toBeVisible();
      await page.getByRole('button', { name: 'Настроить срок: Подготовить запуск' }).click();
      await page.getByRole('button', { name: 'Очистить', exact: true }).click();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.locator('.task-deadline')).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Настроить срок: Подготовить запуск' }).click();
      await page.getByLabel(/^Дедлайн/).fill('2027-03-10T15:30');
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
    await page.getByLabel(/^Дедлайн/).fill('2030-03-10T15:30');
    await expect(page.getByLabel('Напоминание в Telegram')).toBeEnabled();
    await page.getByLabel('Напоминание в Telegram').selectOption('15');
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    await expect(page.getByRole('alert')).toContainText('Разрешите сообщения бота');
    expect((await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks).toHaveLength(0);
    await expect(page.getByLabel('Что нужно сделать?')).toBeEnabled();
    await page.evaluate(() => { (window as any).allowReminderMessages = true; });
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('Напомнить за 15 минут')).toBeVisible();
    const saved = (await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks[0];
    expect(saved.reminderAt).toBe(saved.dueAt - 15 * 60000);
    await page.getByRole('button', { name: 'Настроить срок: Задача с напоминанием' }).click();
    await page.getByLabel('Напоминание в Telegram').selectOption('off');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.task-reminder')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(2);
    expect((await app.endpoints.listTasks({}, { initData: { user: { id: 101 } } })).tasks[0].reminderAt).toBeNull();
  } finally { app.close(); }
});
