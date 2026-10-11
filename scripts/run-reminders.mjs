import { spawnSync } from 'node:child_process';

// Node is used only by the external CLI runner; all DB and Bot API work runs
// inside Telegram through the official CLI. Never expose this credential to a browser.
const context = { initData: { user: { id: 8347651382 } }, maintenanceJob: 'sytodo-reminders' };
if (process.env.CI && !process.env.TGCLOUD_TOKEN?.startsWith('app8347651382:')) {
  console.error('Actions Secret TGCLOUD_TOKEN должен содержать CLI Access token проекта app8347651382.');
  process.exit(1);
}
const verifyOnly = process.env.VERIFY_ONLY === 'true';
const endpoint = verifyOnly ? 'getReminderCapabilities' : 'processReminders';
const result = spawnSync('npx', ['--no-install', 'tgcloud', 'run', `endpoints/${endpoint}`, '{}', '--ctx', JSON.stringify(context)], {
  encoding: 'utf8', env: process.env, timeout: 4 * 60 * 1000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) { console.error('Не удалось запустить обработку напоминаний.'); process.exit(1); }
if (result.status !== 0) process.exit(result.status ?? 1);
if (!verifyOnly && /"?enabled"?\s*:\s*false/.test(result.stdout)) {
  console.error('Планировщик ещё не подключён: remindersEnabled=false.');
  process.exit(1);
}
