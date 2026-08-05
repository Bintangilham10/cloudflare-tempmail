import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { resolveAdminCorsOrigin, resolvePublicCorsOrigin } from "./utils/cors";
import { publicApi } from "./handlers/api";
import { adminApi } from "./handlers/admin";
import { handleInboundEmail } from "./handlers/inbound";
import { handleScheduled } from "./handlers/cron";
import { fail, ok } from "./utils/response";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const isAdminRequest = c.req.path.startsWith("/api/admin");
  const corsMiddleware = cors({
    origin: (requestOrigin) =>
      (isAdminRequest
        ? resolveAdminCorsOrigin(requestOrigin, c.env)
        : resolvePublicCorsOrigin(requestOrigin, c.env)) || "",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: isAdminRequest
      ? ["Content-Type"]
      : ["Content-Type", "X-Mailbox-Token"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 86400,
    credentials: isAdminRequest,
  });
  return corsMiddleware(c, next);
});

app.get("/", (c) => ok(c, { name: "tempmail-api", version: "1.1.0" }));

app.get("/api/health", async (c) => {
  const checks: Record<string, "ok" | "error"> = { d1: "error", r2: "error" };
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.d1 = "ok";
  } catch {
    /* D1 unreachable */
  }
  try {
    await c.env.MESSAGE_BUCKET.head("__health_check__");
    checks.r2 = "ok";
  } catch {
    /* R2 unreachable */
  }
  const healthy = checks.d1 === "ok" && checks.r2 === "ok";
  return c.json(
    {
      success: true,
      data: {
        status: healthy ? "ok" : "degraded",
        time: new Date().toISOString(),
        checks,
      },
    },
    healthy ? 200 : 503,
  );
});
app.route("/api", publicApi);
app.route("/api/admin", adminApi);
app.notFound((c) => fail(c, "Not found", 404, "NOT_FOUND"));
app.onError((_error, c) => fail(c, "Internal server error", 500, "INTERNAL"));

export default {
  fetch: app.fetch,
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await handleInboundEmail(message, env);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
