import { currentUser } from '../lib/tasks.js';
import { deleteUserTask } from '../lib/task-service.js';

export default async function deleteReminder(input, ctx) {
  return await deleteUserTask(currentUser(ctx).id, input, 'reminder');
}
