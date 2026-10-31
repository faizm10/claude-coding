import { cacheLife } from "next/cache";
import { getContributions, isValidUsername, UserNotFoundError } from "./contributions";
import { computeStats } from "./stats";

/** Cached stats for a user, or null when the user doesn't exist. */
export async function getPlayer(user: string) {
  "use cache";
  cacheLife("hours");
  if (!isValidUsername(user)) return null;
  try {
    return computeStats(await getContributions(user));
  } catch (err) {
    if (err instanceof UserNotFoundError) return null;
    throw err;
  }
}
