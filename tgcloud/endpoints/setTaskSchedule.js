import { currentUser } from '../lib/tasks.js';
import { setUserSchedule } from '../lib/task-service.js';

export default async function setTaskSchedule(input, ctx) {
  return await setUserSchedule(currentUser(ctx).id, input);
}
