import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runtime } from '../sqlite-runtime.mjs';

test.use({ timezoneId: 'Europe/Moscow' });
let sdk: string;
test.beforeAll(async ({ request }) => {
  sdk = process.env.TELEGRAM_SDK_PATH ? await readFile(process.env.TELEGRAM_SDK_PATH, 'utf8')
    : await (await request.get('https://telegram.org/js/telegram-web-app.js')).text();
});

for (const theme of ['light', 'dark'] as const) {
  test(`recurrence settings, custom lead, history and snooze preserve the cycle: ${theme}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 320, height: 844 });
    let now = Date.UTC(2030, 2, 10, 8);
    const app = await runtime(':memory:', { now: () => now });
    const owner = { initData: { user: { id: 101, first_name: 'Анна' } } };
    const job = { initData: { user: { id: 8347651382 } }, maintenanceJob: 'sytodo-reminders' };
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
    await page.route('**/api/*', async route => {
      const endpoint = route.request().url().split('/').pop()!;
      try { await route.fulfill({ json: { ok: true, result: await app.endpoints[endpoint](route.request().postDataJSON(), owner) } }); }
      catch (error: any) { await route.fulfill({ status: 400, json: { ok: false, error_type: 'ENDPOINT_ERROR', description: error.message, parameters: error.parameters } }); }
    });
    const data = `user=${encodeURIComponent(JSON.stringify(owner.initData.user))}&auth_date=1791634000&hash=test-fixture-only`;
    const hash = `#tgWebAppData=${encodeURIComponent(data)}&tgWebAppVersion=9.0&tgWebAppPlatform=web&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify({ bg_color: theme === 'dark' ? '#0a0a0a' : '#ffffff', text_color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }))}`;
    const permission = async () => page.evaluate(() => {
      const native = (window as any).Telegram.WebView;
      const post = native.postEvent;
      native.postEvent = (name: string, ...args: any[]) => name === 'web_app_request_write_access'
        ? native.receiveEvent('write_access_requested', { status: 'allowed' }) : post(name, ...args);
    });
    try {
      await page.goto('/?view=reminders&action=new' + hash); await permission();
      await page.getByLabel('О чём напомнить?').fill('Витамины утром');
      await page.getByRole('button', { name: /^Дата и время события:/ }).click();
      await page.getByLabel('Год', { exact: true }).selectOption('2030');
      await page.getByLabel('Месяц', { exact: true }).selectOption('2');
      await page.getByRole('button', { name: '2030-03-10', exact: true }).click();
      await page.getByRole('listbox', { name: 'Часы', exact: true }).getByRole('option', { name: '15', exact: true }).click();
      await page.getByRole('listbox', { name: 'Минуты', exact: true }).getByRole('option', { name: '00', exact: true }).click();
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await page.getByLabel('Напоминание в Telegram', { exact: true }).selectOption('custom');
      await page.getByLabel('За сколько минут?').fill('37');
      await page.getByLabel('Повторение', { exact: true }).selectOption('weekdays');
      const group = page.getByRole('group', { name: 'Дни повторения', exact: true });
      for (const name of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) {
        const button = group.getByRole('button', { name, exact: true });
        if (await button.getAttribute('aria-pressed') === 'true') await button.click();
      }
      await group.getByRole('button', { name: 'Пн', exact: true }).click();
      await group.getByRole('button', { name: 'Ср', exact: true }).click();
      expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.locator('.repeat-fields').screenshot({ path: `test-results/repeat-fields-${theme}.png` });
      await page.getByRole('dialog').getByRole('button', { name: 'Создать напоминание', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      const first = (await app.endpoints.listReminders({}, owner)).tasks[0];
      expect(first.dueAt).toBe(Date.UTC(2030, 2, 11, 12)); expect(first.reminderMinutes).toBe(37);
      expect([...first.recurrence.weekdays]).toEqual([1, 3]);
      await page.reload(); await permission();
      await page.getByRole('button', { name: 'Изменить напоминание: Витамины утром' }).click();
      await expect(page.getByLabel('За сколько минут?')).toHaveValue('37');
      await expect(group.getByRole('button', { name: 'Пн', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByLabel('Повторение', { exact: true }).selectOption('daily');
      await page.getByLabel('Напоминание в Telegram', { exact: true }).selectOption('5');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      expect((await app.endpoints.getReminder({ id: first.id }, owner)).task.recurrence.mode).toBe('daily');
      await page.getByRole('button', { name: 'Изменить напоминание: Витамины утром' }).click();
      await page.getByLabel('Повторение', { exact: true }).selectOption('alternate');
      await page.getByLabel('Напоминание в Telegram', { exact: true }).selectOption('10');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      const current = (await app.endpoints.getReminder({ id: first.id }, owner)).task;
      now = current.reminderAt; expect((await app.endpoints.processReminders({}, job)).sent).toBe(1);
      await page.getByRole('button', { name: 'Обновить напоминания' }).click();
      await expect(page.getByRole('tab', { name: /^Ожидают/ })).toHaveText('Ожидают1');
      await page.getByRole('tab', { name: /^История/ }).click();
      await expect(page.getByText(/^Следующий раз:/)).toBeVisible();
      const next = (await app.endpoints.getReminder({ id: first.id }, owner)).task;
      expect(next.dueAt).toBe(Date.UTC(2030, 2, 13, 12));
      await page.getByRole('button', { name: 'Ещё раз через 10 минут', exact: true }).click();
      await expect(page.locator('.reminder-card')).toHaveCount(2);
      expect((await app.endpoints.getReminder({ id: first.id }, owner)).task.dueAt).toBe(next.dueAt);
      await expect(page.getByRole('button', { name: 'Обновить напоминания' })).toBeEnabled();
      await expect(page.locator('.reminder-card').first()).toHaveCSS('opacity', '1');
      await page.screenshot({ path: `test-results/recurring-reminders-${theme}.png`, fullPage: true });
      await page.locator('.reminder-card').filter({ hasText: 'Через день' }).getByRole('button', { name: /^Удалить напоминание:/ }).click();
      await page.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(page.locator('.reminder-card')).toHaveCount(0);
      expect((await app.endpoints.listReminders({ status: 'all' }, owner)).tasks).toHaveLength(0);
      expect(errors).toEqual([]);
    } finally { app.close(); }
  });
}
