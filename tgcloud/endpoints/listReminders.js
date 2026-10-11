import { currentUser } from '../lib/tasks.js';
import { listUserTasks } from '../lib/task-service.js';

export default async function listReminders(input, ctx) {
  return await listUserTasks(currentUser(ctx).id, input, 30, 'reminder');
}
