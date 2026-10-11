import { currentUser } from '../lib/tasks.js';
import { createUserReminder } from '../lib/reminder-service.js';

export default async function createReminder(input, ctx) {
  return await createUserReminder(currentUser(ctx).id, input);
}
