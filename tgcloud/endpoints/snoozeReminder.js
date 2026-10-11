import { currentUser } from '../lib/tasks.js';
import { snoozeUserReminder } from '../lib/reminder-service.js';

export default async function snoozeReminder(input, ctx) {
  return await snoozeUserReminder(currentUser(ctx).id, input);
}
