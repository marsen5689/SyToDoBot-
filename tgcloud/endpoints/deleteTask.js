import { currentUser } from '../lib/tasks.js';
import { deleteUserTask } from '../lib/task-service.js';

export default async function deleteTask(input, ctx) {
  const user = currentUser(ctx);
  return await deleteUserTask(user.id, input);
}
