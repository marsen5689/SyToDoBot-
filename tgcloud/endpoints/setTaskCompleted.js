import { currentUser } from '../lib/tasks.js';
import { completeUserTask } from '../lib/task-service.js';

export default async function setTaskCompleted(input, ctx) {
  const user = currentUser(ctx);
  return await completeUserTask(user.id, input);
}
