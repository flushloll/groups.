import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins/anonymous";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessError } from "./store.mjs";

const TICKET_SECONDS = 60;

export async function createAuth(store) {
  const origins = (
    process.env.GROUPS_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001"
  )
    .split(",")
    .map((origin) => new URL(origin.trim()).origin);
  const auth = betterAuth({
    appName: "Groups",
    database: store.authDatabase,
    secret: store.secret.trim(),
    baseURL: process.env.BETTER_AUTH_URL || {
      allowedHosts: origins.map((origin) => new URL(origin).host),
      protocol: "auto",
    },
    trustedOrigins: origins,
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 60 },
    // Behind Vercel or another proxy, rate limits use the forwarded client address.
    ...(process.env.GROUPS_TRUST_PROXY === "true"
      ? { advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for", "fly-client-ip"] } } }
      : {}),
    plugins: [
      anonymous({
        generateName: () => `Guest ${randomSuffix()}`,
        disableDeleteAnonymousUser: true,
      }),
    ],
  });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  const sign = (payload) =>
    createHmac("sha256", store.secret.trim()).update(`ws-ticket:${payload}`).digest("base64url");
  return {
    handler: toNodeHandler(auth),
    /**
     * A short-lived credential for opening the realtime socket on another
     * origin (the frontend's cookies stay first-party on its own domain).
     */
    ticket(identity) {
      const payload = Buffer.from(
        JSON.stringify({
          user: identity.user.id,
          until: new Date(identity.session.expiresAt).getTime(),
          exp: Date.now() + TICKET_SECONDS * 1000,
        }),
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    /** Verify a ticket at socket upgrade; returns what session() needs later. */
    redeemTicket(value) {
      const [payload, signature] = String(value || "").split(".");
      if (!payload || !signature) return null;
      const expected = Buffer.from(sign(payload));
      const supplied = Buffer.from(signature);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!(data.exp > Date.now()) || typeof data.user !== "string") return null;
        return { userId: data.user, until: data.until };
      } catch {
        return null;
      }
    },
    async session(request) {
      if (request.groupsTicket) {
        // Ticket sockets carry no cookie; recheck the user and session lifetime.
        const { userId, until } = request.groupsTicket;
        const user = await store.user(userId);
        if (!user || Date.now() >= until)
          throw new AccessError("Your session has expired. Return to the lobby to reconnect.", 401);
        return { user: { id: user.id, name: user.name }, session: { expiresAt: new Date(until) } };
      }
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session)
        throw new AccessError(
          "Your session has expired. Return to the lobby to reconnect.",
          401,
        );
      return session;
    },
    origin(request) {
      const origin = request.headers.origin;
      if (!origin || !origins.includes(origin))
        throw new AccessError("This origin is not allowed.");
    },
    origins,
  };
}
function randomSuffix() {
  return crypto.randomUUID().slice(0, 4).toUpperCase();
}
