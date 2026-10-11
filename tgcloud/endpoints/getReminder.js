import { currentUser, objectInput, positiveId } from '../lib/tasks.js';
import { getUserTask } from '../lib/task-service.js';

export default async function getReminder(input, ctx) {
  const user = currentUser(ctx);
  objectInput(input);
  return { task: await getUserTask(user.id, positiveId(input.id), 'reminder') };
}
