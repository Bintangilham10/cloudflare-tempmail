import type { Env } from "../types";
import { cleanupExpired, getSetting } from "../db/queries";

export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
): Promise<void> {
  try {
    const ttlRaw = await getSetting(env.DB, "ttl_hours", "24");
    const ttlHours = Math.max(1, Math.min(720, Number(ttlRaw) || 24));
    const result = await cleanupExpired(env, ttlHours, 50);
    console.log(
      `TTL cleanup (${ttlHours}h): emails=${result.emails}, mailboxes=${result.mailboxes}`,
    );
  } catch (error) {
    console.error(
      "Cron cleanup failed:",
      error instanceof Error ? error.message : String(error),
      error instanceof Error && error.stack ? `\n${error.stack}` : "",
    );
  }
}
