// Signed login tokens. Nothing is kept on the server, so any Cloud Run instance can check a token
// that another instance issued. A token is  base64url(payload) + "." + HMAC-SHA256 signature.
// Payload: { u: <user>, exp: <ms since 1970> }. Changing SESSION_SECRET logs everyone out.
import crypto from "node:crypto";

const b64 = (buf) => Buffer.from(buf).toString("base64url");

export function createTokens({ secret, now = () => Date.now() } = {}) {
  if (!secret || String(secret).length < 24) throw new Error("SESSION_SECRET must be at least 24 characters.");
  const sign = (body) => crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return {
    issue(user, ttlMs) {
      const body = b64(JSON.stringify({ u: user, exp: now() + ttlMs, n: crypto.randomBytes(4).toString("hex") }));
      return body + "." + sign(body);
    },
    // -> the user object, or null if the token is missing, forged or expired
    verify(token) {
      if (typeof token !== "string" || token.length > 2000) return null;
      const [body, sig] = token.split(".");
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body)), got = Buffer.from(sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
      try { const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return p.exp > now() ? p.u : null; } catch { return null; }
    },
  };
}

// The secret: SESSION_SECRET in production. Locally a random one is made per run (logins end when you restart).
export function secretFromEnv(env = process.env) {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 24) return env.SESSION_SECRET;
  if (env.NODE_ENV === "production") throw new Error("Set SESSION_SECRET (at least 24 random characters) before running in production.");
  console.warn("[auth] SESSION_SECRET is not set: using a temporary secret. Everyone is logged out when the server restarts.");
  return crypto.randomBytes(32).toString("hex");
}
