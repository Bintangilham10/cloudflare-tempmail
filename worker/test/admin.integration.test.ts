import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const adminOrigin = "https://admin.example.test";
const bootstrapSecret = "test-bootstrap-secret-that-is-long-enough";

function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", adminOrigin);
  if (init.body) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`https://api.example.test/api/admin${path}`, {
    ...init,
    headers,
  });
}

describe("admin authentication", () => {
  it("rejects setup without an admin origin", async () => {
    const response = await exports.default.fetch(
      "https://api.example.test/api/admin/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "correct horse battery staple",
          bootstrap_secret: bootstrapSecret,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("rejects setup without the bootstrap secret", async () => {
    const response = await adminRequest("/setup", {
      method: "POST",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });

    expect(response.status).toBe(403);
  });

  it("sets a hardened cookie and never returns the raw session token", async () => {
    const response = await adminRequest("/setup", {
      method: "POST",
      body: JSON.stringify({
        password: "correct horse battery staple",
        bootstrap_secret: bootstrapSecret,
      }),
    });
    const cookie = response.headers.get("Set-Cookie") || "";
    const payload = await response.json<{ data: Record<string, unknown> }>();

    expect(response.status).toBe(201);
    expect(cookie).toContain("__Host-tempmail_admin=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(payload.data).not.toHaveProperty("token");

    const sessionCookie = cookie.split(";", 1)[0];
    const sessionResponse = await adminRequest("/session", {
      headers: { Cookie: sessionCookie },
    });
    expect(sessionResponse.status).toBe(200);
  });

  it("revokes every session after a password change", async () => {
    const setupResponse = await adminRequest("/setup", {
      method: "POST",
      body: JSON.stringify({
        password: "correct horse battery staple",
        bootstrap_secret: bootstrapSecret,
      }),
    });
    const firstCookie = (setupResponse.headers.get("Set-Cookie") || "").split(
      ";",
      1,
    )[0];

    const loginResponse = await adminRequest("/login", {
      method: "POST",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    const secondCookie = (loginResponse.headers.get("Set-Cookie") || "").split(
      ";",
      1,
    )[0];

    const changeResponse = await adminRequest("/settings", {
      method: "PUT",
      headers: { Cookie: firstCookie },
      body: JSON.stringify({
        current_password: "correct horse battery staple",
        new_password: "a completely different secure password",
      }),
    });
    expect(changeResponse.status).toBe(200);

    const firstSession = await adminRequest("/session", {
      headers: { Cookie: firstCookie },
    });
    const secondSession = await adminRequest("/session", {
      headers: { Cookie: secondCookie },
    });
    expect(firstSession.status).toBe(401);
    expect(secondSession.status).toBe(401);
  });
});
