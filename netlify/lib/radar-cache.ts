import { getStore } from "@netlify/blobs";
import type { RadarSnapshot } from "./radar-refresh";

export const RADAR_CACHE_STORE = "radar-cache";
export const RADAR_CACHE_KEY = "current-v18";
export const RADAR_WEEK_CACHE_VERSION = "week-v17";

export const getRadarStore = () => getStore(RADAR_CACHE_STORE, { consistency: "strong" });

export const readRadarSnapshot = async (
  store: ReturnType<typeof getStore>,
  key: string,
) => {
  try {
    return await store.get(key, { type: "json" }) as RadarSnapshot | null;
  } catch (error) {
    console.warn(`Radar snapshot ${key} could not be read`, error);
    return null;
  }
};

export const cleanupRadarWeekCache = async (
  store: ReturnType<typeof getStore>,
  retainedWeeks: Set<string>,
) => {
  try {
    const { blobs } = await store.list();
    const staleKeys = getStaleRadarWeekKeys(blobs.map((blob) => blob.key), retainedWeeks);
    await Promise.all(staleKeys.map((key) => store.delete(key)));
    if (staleKeys.length > 0) {
      console.log(`Radar cache cleanup removed ${staleKeys.length} stale weekly snapshots`);
    }
  } catch (error) {
    console.warn("Radar weekly cache cleanup failed", error);
  }
};

export const getStaleRadarWeekKeys = (keys: string[], retainedWeeks: Set<string>) =>
  keys.filter((key) => {
    const match = key.match(/^week-v\d+\/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return false;
    return key.split("/")[0] !== RADAR_WEEK_CACHE_VERSION || !retainedWeeks.has(match[1]);
  });
