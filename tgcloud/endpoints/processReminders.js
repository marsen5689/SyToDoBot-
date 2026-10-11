import { EndpointError } from 'sdk';
import { currentUser } from '../lib/tasks.js';
import { remindersEnabled } from '../lib/reminder-config.js';
import { dispatchDueReminders } from '../lib/reminders.js';

export default async function processReminders(input, ctx) {
  currentUser(ctx);
  // A root context field can be supplied only by the authenticated developer
  // CLI's documented run --ctx. Neither input nor initData can set this field.
  if (ctx?.maintenanceJob !== 'sytodo-reminders') {
    throw new EndpointError('Этот вызов доступен только планировщику.', { code: 'FORBIDDEN' });
  }
  if (!remindersEnabled) return { enabled: false, sent: 0 };
  return await dispatchDueReminders();
}
