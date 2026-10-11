import { currentUser } from '../lib/tasks.js';
import { updateUserReminder } from '../lib/reminder-service.js';

export default async function updateReminder(input, ctx) {
  return await updateUserReminder(currentUser(ctx).id, input);
}
