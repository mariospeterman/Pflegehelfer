import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";

if (process.env.PFH_TEST_IDP !== "true")
  throw new Error("The synthetic test IdP requires PFH_TEST_IDP=true.");

const port = Number.parseInt(process.env.PORT ?? "9000", 10);
const host = process.env.HOST ?? "127.0.0.1";
const issuer = (
  process.env.PFH_TEST_IDP_ISSUER ?? `http://127.0.0.1:${port}`
).replace(/\/+$/u, "");
const clientId = process.env.PFH_TEST_IDP_CLIENT_ID ?? "pflegehelfer-test";
const redirectUri =
  process.env.PFH_TEST_IDP_REDIRECT_URI ??
  "http://127.0.0.1:4173/api/v1/auth/callback";
const postLogoutRedirectUri =
  process.env.PFH_TEST_IDP_POST_LOGOUT_REDIRECT_URI ??
  "http://127.0.0.1:4173/api/v1/auth/logout/callback";

const syntheticUsers = {
  "nora.nurse": {
    sub: "synthetic-org-demo-nora",
    actorId: "u-nurse",
    organizationId: "org-demo",
    label: "Nora Pflege (Organisation Demo)",
  },
  "rita.rehab": {
    sub: "synthetic-org-alpenblick-rita",
    actorId: "u-nurse",
    organizationId: "org-alpenblick-demo",
    label: "Rita Reha (Organisation Alpenblick)",
  },
} as const;

const authorizeQuery = z
  .object({
    response_type: z.literal("code"),
    client_id: z.literal(clientId),
    redirect_uri: z.literal(redirectUri),
    scope: z.string().refine((scope) => scope.split(/\s+/u).includes("openid")),
    state: z.string().min(32).max(240),
    nonce: z.string().min(32).max(240),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal("S256"),
    login_hint: z.enum(["nora.nurse", "rita.rehab"]).optional(),
  })
  .strict();

const tokenBody = z
  .object({
    grant_type: z.literal("authorization_code"),
    code: z.uuid(),
    redirect_uri: z.literal(redirectUri),
    client_id: z.literal(clientId),
    code_verifier: z.string().min(43).max(128),
  })
  .passthrough();

const logoutQuery = z
  .object({
    client_id: z.literal(clientId),
    post_logout_redirect_uri: z.literal(postLogoutRedirectUri),
    state: z.string().min(32).max(240),
  })
  .strict();

interface AuthorizationCode {
  nonce: string;
  challenge: string;
  user: keyof typeof syntheticUsers;
  expiresAt: number;
}

const codes = new Map<string, AuthorizationCode>();
const { publicKey, privateKey } = await generateKeyPair("RS256", {
  modulusLength: 2048,
  extractable: true,
});
const publicJwk = await exportJWK(publicKey);
const keyId = createHash("sha256")
  .update(JSON.stringify(publicJwk))
  .digest("hex")
  .slice(0, 24);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" } });
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_request, body, done) => {
    done(
      null,
      Object.fromEntries(
        new URLSearchParams(
          typeof body === "string" ? body : body.toString("utf8"),
        ),
      ),
    );
  },
);

app.get("/.well-known/openid-configuration", () => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  end_session_endpoint: `${issuer}/logout`,
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["openid", "profile"],
}));

app.get("/jwks", () => ({
  keys: [{ ...publicJwk, kid: keyId, use: "sig", alg: "RS256" }],
}));

app.get("/authorize", async (request, reply) => {
  const query = authorizeQuery.parse(request.query);
  if (!query.login_hint) {
    const hidden = Object.entries(query)
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${name}" value="${String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`,
      )
      .join("");
    return reply.type("text/html; charset=utf-8").send(
      `<!doctype html><html lang="de"><meta charset="utf-8"><title>Synthetischer Test-Login</title><body><h1>Synthetischer Test-Login</h1><p>Nur fiktionale Identitäten.</p><form method="get" action="${issuer}/authorize">${hidden}<label>Testperson <select name="login_hint">${Object.entries(
        syntheticUsers,
      )
        .map(
          ([value, user]) => `<option value="${value}">${user.label}</option>`,
        )
        .join(
          "",
        )}</select></label><button type="submit">Anmelden</button></form></body></html>`,
    );
  }
  const code = randomUUID();
  codes.set(code, {
    nonce: query.nonce,
    challenge: query.code_challenge,
    user: query.login_hint,
    expiresAt: Date.now() + 60_000,
  });
  const target = new URL(query.redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", query.state);
  return reply.redirect(target.toString(), 303);
});

app.post("/token", async (request, reply) => {
  const body = tokenBody.parse(request.body);
  const authorization = codes.get(body.code);
  codes.delete(body.code);
  if (
    !authorization ||
    authorization.expiresAt <= Date.now() ||
    createHash("sha256").update(body.code_verifier).digest("base64url") !==
      authorization.challenge
  )
    return reply.code(400).send({ error: "invalid_grant" });
  const user = syntheticUsers[authorization.user];
  const idToken = await new SignJWT({
    nonce: authorization.nonce,
    sid: randomUUID(),
    pfh_user_id: user.actorId,
    pfh_organization_id: user.organizationId,
    name: user.label,
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return {
    access_token: `synthetic-${randomUUID()}`,
    token_type: "Bearer",
    expires_in: 300,
    id_token: idToken,
  };
});

app.get("/logout", (request, reply) => {
  const query = logoutQuery.parse(request.query);
  const target = new URL(query.post_logout_redirect_uri);
  target.searchParams.set("state", query.state);
  return reply.redirect(target.toString(), 303);
});
app.get("/health", () => ({ status: "ok", service: "pflegehelfer-test-idp" }));

await app.listen({ port, host });
