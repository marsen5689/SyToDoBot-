import { currentUser } from '../lib/tasks.js';

export default async function getProfile(_input, ctx) {
  const user = currentUser(ctx);
  return {
    id: user.id,
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    username: user.username ?? '',
    photo_url: user.photo_url ?? '',
  };
}
