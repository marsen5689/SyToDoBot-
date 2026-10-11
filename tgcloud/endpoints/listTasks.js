import { currentUser } from '../lib/tasks.js';
import { listUserTasks } from '../lib/task-service.js';

export default async function listTasks(input, ctx) {
  const user = currentUser(ctx);
  return await listUserTasks(user.id, input);
}
