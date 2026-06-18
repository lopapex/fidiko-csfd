import { refreshScheduleCache } from "./schedule";

export default async function handler() {
  const schedule = await refreshScheduleCache();

  console.log(`Schedule cache refreshed at ${schedule.fetchedAt}`);
  return new Response(null, { status: 204 });
}
