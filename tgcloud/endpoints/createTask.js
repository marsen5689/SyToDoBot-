import { currentUser } from '../lib/tasks.js';
import { createUserTask } from '../lib/task-service.js';

export default async function createTask(input, ctx) {
  const user = currentUser(ctx);
  return await createUserTask(user.id, input);
}
