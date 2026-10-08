import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

const discoverySchema = z
  .object({
    issuer: z.url(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    jwks_uri: z.url(),
    end_session_endpoint: z.url().optional(),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({
    id_token: z.string().min(20),
    token_type: z.string().toLowerCase().pipe(z.literal("bearer")),
    expires_in: z.number().int().positive().optional(),
  })
  .passthrough();

const oidcClaimsSchema = z
  .object({
    sub: z.string().min(1).max(240),
    nonce: z.string().min(32).max(240),
    sid: z.string().min(1).max(240).optional(),
    pfh_user_id: z.string().min(1).max(80),
    pfh_organization_id: z.string().min(1).max(120),
  })
  .passthrough();

export interface AuthenticatedIdentity {
  actorId: string;
  organizationId: string;
  subject: string;
  sessionHash: string;
  csrfToken: string;
}

export interface OidcLoginResult {
  redirectTo: string;
  cookies: string[];
}

export interface OidcCallbackResult {
  redirectTo: string;
  cookies: string[];
  identity: AuthenticatedIdentity;
}

export interface OidcLogoutResult {
  redirectTo: string;
  cookies: string[];
}

export interface IdentityAdapter {
  readonly configured: boolean;
  initialize(): Promise<void>;
  beginLogin(returnPath?: string): Promise<OidcLoginResult>;
  completeLogin(
    code: string,
    state: string,
    cookieHeader: string | undefined,
  ): Promise<OidcCallbackResult>;
  authenticate(
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedIdentity | null>;
  logout(cookieHeader: string | undefined): Promise<OidcLogoutResult>;
  close?(): Promise<void>;
  assertRequestIntegrity(input: {
    identity: AuthenticatedIdentity;
    method: string;
    origin: string | undefined;
    csrfHeader: string | undefined;
  }): void;
}

export interface OidcBffConfiguration {
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
  redirectUri: string;
  publicOrigin: string;
  organizationId: string;
  databaseUrl: string;
  encryptionSecret: string;
  sessionTtlSeconds: number;
  allowInsecureHttp: boolean;
}

const configurationSchema = z
  .object({
    issuer: z.url(),
    clientId: z.string().min(3).max(240),
    clientSecret: z.string().min(16).max(1_000).optional(),
    redirectUri: z.url(),
    publicOrigin: z.url(),
    organizationId: z.string().min(1).max(120),
    databaseUrl: z.string().min(1),
    encryptionSecret: z.string().min(32),
    sessionTtlSeconds: z.number().int().min(300).max(86_400),
    allowInsecureHttp: z.boolean(),
  })
  .strict();

function normalizedIssuer(value: string): string {
  return value.replace(/\/+$/u, "");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) result.set(name, value);
  }
  return result;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function safeReturnPath(value: string | undefined): string {
  if (!value) return "/";
  if (!/^\/[A-Za-z0-9/_?&=.%+-]*$/u.test(value) || value.startsWith("//"))
    return "/";
  return value;
}

function cookie(
  name: string,
  value: string,
  options: { maxAge: number; httpOnly: boolean; secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${options.maxAge}`,
    "SameSite=Lax",
    options.httpOnly ? "HttpOnly" : null,
    options.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearCookie(name: string, httpOnly: boolean, secure: boolean): string {
  return cookie(name, "", { maxAge: 0, httpOnly, secure });
}

export function oidcConfigurationFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  organizationId = env.PFH_INSTITUTION_ID ?? "org-demo",
): OidcBffConfiguration | null {
  const identityValues = [
    env.PFH_OIDC_ISSUER,
    env.PFH_OIDC_CLIENT_ID,
    env.PFH_OIDC_REDIRECT_URI,
    env.PFH_PUBLIC_ORIGIN,
  ];
  if (identityValues.every((value) => !value)) return null;
  const values = [
    ...identityValues,
    env.PFH_OPERATIONAL_DATABASE_URL,
    env.PFH_SESSION_ENCRYPTION_SECRET,
  ];
  if (values.some((value) => !value))
    throw new Error(
      "OIDC configuration is incomplete; refusing identity fallback.",
    );
  const parsed = configurationSchema.parse({
    issuer: env.PFH_OIDC_ISSUER,
    clientId: env.PFH_OIDC_CLIENT_ID,
    ...(env.PFH_OIDC_CLIENT_SECRET
      ? { clientSecret: env.PFH_OIDC_CLIENT_SECRET }
      : {}),
    redirectUri: env.PFH_OIDC_REDIRECT_URI,
    publicOrigin: env.PFH_PUBLIC_ORIGIN,
    organizationId,
    databaseUrl: env.PFH_OPERATIONAL_DATABASE_URL,
    encryptionSecret: env.PFH_SESSION_ENCRYPTION_SECRET,
    sessionTtlSeconds: Number.parseInt(
      env.PFH_IDENTITY_SESSION_TTL_SECONDS ?? "28800",
      10,
    ),
    allowInsecureHttp: env.PFH_OIDC_ALLOW_INSECURE_HTTP === "true",
  });
  const issuer = new URL(parsed.issuer);
  const redirect = new URL(parsed.redirectUri);
  const publicOrigin = new URL(parsed.publicOrigin);
  if (
    !parsed.allowInsecureHttp &&
    [issuer, redirect, publicOrigin].some((url) => url.protocol !== "https:")
  )
    throw new Error(
      "OIDC issuer, redirect URI and public origin require HTTPS.",
    );
  if (redirect.origin !== publicOrigin.origin)
    throw new Error("OIDC redirect URI must use the configured public origin.");
  return parsed;
}

interface StoredSecrets {
  nonce: string;
  verifier: string;
}

export class PostgresOidcBff implements IdentityAdapter {
  readonly configured = true;
  private readonly pool: pg.Pool;
  private readonly encryptionKey: Buffer;
  private discovery: z.infer<typeof discoverySchema> | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private readonly secureCookies: boolean;

  constructor(private readonly config: OidcBffConfiguration) {
    this.config = configurationSchema.parse(config);
    this.encryptionKey = createHash("sha256")
      .update(this.config.encryptionSecret)
      .digest();
    this.secureCookies =
      new URL(this.config.publicOrigin).protocol === "https:";
    this.pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 4,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
  }

  async initialize(): Promise<void> {
    const issuer = normalizedIssuer(this.config.issuer);
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`OIDC_DISCOVERY_HTTP_${response.status}`);
    const discovery = discoverySchema.parse(await response.json());
    if (normalizedIssuer(discovery.issuer) !== issuer)
      throw new Error("OIDC_DISCOVERY_ISSUER_MISMATCH");
    const issuerOrigin = new URL(issuer).origin;
    for (const endpoint of [
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.jwks_uri,
    ]) {
      const url = new URL(endpoint);
      if (!this.config.allowInsecureHttp && url.protocol !== "https:")
        throw new Error("OIDC_DISCOVERY_INSECURE_ENDPOINT");
      if (url.origin !== issuerOrigin)
        throw new Error("OIDC_DISCOVERY_ENDPOINT_ORIGIN_MISMATCH");
    }
    this.discovery = discovery;
    this.jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
      timeoutDuration: 8_000,
      cooldownDuration: 30_000,
    });
    await this.pool.query("SELECT 1 FROM oidc_sessions LIMIT 1");
  }

  private encryptSecrets(value: StoredSecrets): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(this.config.organizationId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  private decryptSecrets(value: string): StoredSecrets {
    const [ivText, tagText, ciphertextText] = value.split(".");
    if (!ivText || !tagText || !ciphertextText)
      throw new Error("OIDC_LOGIN_SECRET_FORMAT_INVALID");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAAD(Buffer.from(this.config.organizationId));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return z
      .object({
        nonce: z.string().min(32),
        verifier: z.string().min(43).max(128),
      })
      .strict()
      .parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(ciphertextText, "base64url")),
            decipher.final(),
          ]).toString("utf8"),
        ),
      );
  }

  async beginLogin(returnPath?: string): Promise<OidcLoginResult> {
    if (!this.discovery) throw new Error("OIDC_NOT_INITIALIZED");
    const state = opaque();
    const nonce = opaque();
    const verifier = opaque(48);
    const browserBinding = opaque(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.pool.query(
      `INSERT INTO oidc_login_attempts
         (organization_id,state_hash,browser_binding_hash,encrypted_secrets,
          return_path,expires_at)
       VALUES ($1,$2,$3,$4,$5,clock_timestamp() + interval '5 minutes')`,
      [
        this.config.organizationId,
        digest(state),
        digest(browserBinding),
        this.encryptSecrets({ nonce, verifier }),
        safeReturnPath(returnPath),
      ],
    );
    const target = new URL(this.discovery.authorization_endpoint);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: "openid profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return {
      redirectTo: target.toString(),
      cookies: [
        cookie("pfh_login", browserBinding, {
          maxAge: 300,
          httpOnly: true,
          secure: this.secureCookies,
        }),
      ],
    };
  }

  async completeLogin(
    code: string,
    state: string,
    cookieHeader: string | undefined,
  ): Promise<OidcCallbackResult> {
    if (!this.discovery || !this.jwks) throw new Error("OIDC_NOT_INITIALIZED");
    if (code.length > 4_000 || state.length > 240)
      throw new Error("OIDC_CALLBACK_INPUT_INVALID");
    const browserBinding = parseCookies(cookieHeader).get("pfh_login");
    if (!browserBinding) throw new Error("OIDC_BROWSER_BINDING_MISSING");
    const client = await this.pool.connect();
    let encryptedSecrets: string;
    let returnPath: string;
    try {
      await client.query("BEGIN");
      const attempt = await client.query<{
        encrypted_secrets: string;
        return_path: string;
      }>(
        `UPDATE oidc_login_attempts
            SET consumed_at=clock_timestamp()
          WHERE organization_id=$1 AND state_hash=$2
            AND browser_binding_hash=$3
            AND consumed_at IS NULL AND expires_at > clock_timestamp()
        RETURNING encrypted_secrets,return_path`,
        [this.config.organizationId, digest(state), digest(browserBinding)],
      );
      if (!attempt.rows[0]) throw new Error("OIDC_STATE_INVALID_OR_EXPIRED");
      encryptedSecrets = attempt.rows[0].encrypted_secrets;
      returnPath = attempt.rows[0].return_path;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const { nonce, verifier } = this.decryptSecrets(encryptedSecrets);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });
    if (this.config.clientSecret)
      form.set("client_secret", this.config.clientSecret);
    const tokenResponse = await fetch(this.discovery.token_endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok)
      throw new Error(`OIDC_TOKEN_HTTP_${tokenResponse.status}`);
    const tokens = tokenResponseSchema.parse(await tokenResponse.json());
    const verified = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: normalizedIssuer(this.config.issuer),
      audience: this.config.clientId,
      algorithms: ["RS256", "PS256", "ES256", "EdDSA"],
      clockTolerance: 5,
      maxTokenAge: "5 minutes",
    });
    const claims = oidcClaimsSchema.parse(verified.payload);
    if (!safeEqual(claims.nonce, nonce)) throw new Error("OIDC_NONCE_MISMATCH");
    if (claims.pfh_organization_id !== this.config.organizationId)
      throw new Error("OIDC_ORGANIZATION_MISMATCH");

    const sessionToken = opaque(48);
    const csrfToken = opaque();
    const sessionHash = digest(sessionToken);
    const sessionClient = await this.pool.connect();
    try {
      await sessionClient.query("BEGIN");
      await sessionClient.query(
        `UPDATE oidc_sessions SET revoked_at=clock_timestamp(),
             revocation_reason='session-rotation'
          WHERE organization_id=$1 AND issuer=$2 AND subject=$3
            AND revoked_at IS NULL`,
        [this.config.organizationId, this.discovery.issuer, claims.sub],
      );
      await sessionClient.query(
        `INSERT INTO oidc_sessions
          (organization_id,session_hash,csrf_hash,issuer,subject,actor_id,
           idp_session_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
           clock_timestamp() + ($8 * interval '1 second'))`,
        [
          this.config.organizationId,
          sessionHash,
          digest(csrfToken),
          this.discovery.issuer,
          claims.sub,
          claims.pfh_user_id,
          claims.sid ?? null,
          this.config.sessionTtlSeconds,
        ],
      );
      await sessionClient.query("COMMIT");
    } catch (error) {
      await sessionClient.query("ROLLBACK");
      throw error;
    } finally {
      sessionClient.release();
    }
    const identity = {
      actorId: claims.pfh_user_id,
      organizationId: this.config.organizationId,
      subject: claims.sub,
      sessionHash,
      csrfToken,
    };
    return {
      redirectTo: safeReturnPath(returnPath),
      identity,
      cookies: [
        clearCookie("pfh_login", true, this.secureCookies),
        cookie("pfh_session", sessionToken, {
          maxAge: this.config.sessionTtlSeconds,
          httpOnly: true,
          secure: this.secureCookies,
        }),
        cookie("pfh_csrf", csrfToken, {
          maxAge: this.config.sessionTtlSeconds,
          httpOnly: false,
          secure: this.secureCookies,
        }),
      ],
    };
  }

  async authenticate(
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedIdentity | null> {
    const cookies = parseCookies(cookieHeader);
    const sessionToken = cookies.get("pfh_session");
    const csrfToken = cookies.get("pfh_csrf");
    if (!sessionToken || !csrfToken) return null;
    const sessionHash = digest(sessionToken);
    const result = await this.pool.query<{
      actor_id: string;
      subject: string;
      csrf_hash: string;
    }>(
      `UPDATE oidc_sessions SET last_seen_at=clock_timestamp()
        WHERE organization_id=$1 AND session_hash=$2
          AND revoked_at IS NULL AND expires_at > clock_timestamp()
      RETURNING actor_id,subject,csrf_hash`,
      [this.config.organizationId, sessionHash],
    );
    const row = result.rows[0];
    if (!row || !safeEqual(row.csrf_hash, digest(csrfToken))) return null;
    return {
      actorId: row.actor_id,
      organizationId: this.config.organizationId,
      subject: row.subject,
      sessionHash,
      csrfToken,
    };
  }

  assertRequestIntegrity(input: {
    identity: AuthenticatedIdentity;
    method: string;
    origin: string | undefined;
    csrfHeader: string | undefined;
  }): void {
    if (["GET", "HEAD", "OPTIONS"].includes(input.method)) return;
    if (!input.origin || input.origin !== this.config.publicOrigin)
      throw new Error("OIDC_ORIGIN_REJECTED");
    if (
      !input.csrfHeader ||
      !safeEqual(input.csrfHeader, input.identity.csrfToken)
    )
      throw new Error("OIDC_CSRF_REJECTED");
  }

  async logout(cookieHeader: string | undefined): Promise<OidcLogoutResult> {
    const sessionToken = parseCookies(cookieHeader).get("pfh_session");
    if (sessionToken)
      await this.pool.query(
        `UPDATE oidc_sessions SET revoked_at=clock_timestamp(),
             revocation_reason='user-logout'
          WHERE organization_id=$1 AND session_hash=$2 AND revoked_at IS NULL`,
        [this.config.organizationId, digest(sessionToken)],
      );
    return {
      redirectTo: "/",
      cookies: [
        clearCookie("pfh_session", true, this.secureCookies),
        clearCookie("pfh_csrf", false, this.secureCookies),
      ],
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function idTokenClaims(
  payload: JWTPayload,
): z.infer<typeof oidcClaimsSchema> {
  return oidcClaimsSchema.parse(payload);
}
