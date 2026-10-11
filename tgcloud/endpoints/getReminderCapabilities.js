import { currentUser } from '../lib/tasks.js';
import { remindersEnabled, reminderPrecisionMinutes } from '../lib/reminder-config.js';

export default async function getReminderCapabilities(input, ctx) {
  currentUser(ctx);
  return { enabled: remindersEnabled, precisionMinutes: reminderPrecisionMinutes };
}
