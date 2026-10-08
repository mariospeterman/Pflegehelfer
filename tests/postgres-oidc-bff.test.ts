import { afterEach, describe, expect, it } from "vitest";
import { PostgresOidcBff } from "../src/server/oidc-bff.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const issuer = process.env.PFH_TEST_OIDC_ISSUER;
const instances: PostgresOidcBff[] = [];
afterEach(async () =>
  Promise.all(instances.splice(0).map((instance) => instance.close())),
);

describe.runIf(Boolean(databaseUrl && issuer))(
  "PostgreSQL-backed OIDC authorization-code flow",
  () => {
    it("binds PKCE, state, nonce, issuer, audience and a revocable session", async () => {
      const bff = new PostgresOidcBff({
        issuer: issuer!,
        clientId: "pflegehelfer-test",
        redirectUri: "http://127.0.0.1:4173/api/v1/auth/callback",
        publicOrigin: "http://127.0.0.1:4173",
        organizationId: "org-demo",
        databaseUrl: databaseUrl!,
        encryptionSecret: "synthetic-oidc-test-secret-material-000000000",
        sessionTtlSeconds: 900,
        allowInsecureHttp: true,
      });
      instances.push(bff);
      await bff.initialize();

      const login = await bff.beginLogin("/workspace");
      const loginCookie = login.cookies[0]!.split(";", 1)[0];
      const authorizationUrl = new URL(login.redirectTo);
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
        "S256",
      );
      expect(authorizationUrl.searchParams.get("nonce")).toHaveLength(43);
      authorizationUrl.searchParams.set("login_hint", "nora.nurse");
      const authorization = await fetch(authorizationUrl, {
        redirect: "manual",
      });
      expect(authorization.status).toBe(303);
      const callback = new URL(authorization.headers.get("location")!);

      await expect(
        bff.completeLogin(
          callback.searchParams.get("code")!,
          callback.searchParams.get("state")!,
          "pfh_login=wrong-browser-binding",
        ),
      ).rejects.toThrow(/STATE/);

      const result = await bff.completeLogin(
        callback.searchParams.get("code")!,
        callback.searchParams.get("state")!,
        loginCookie,
      );
      expect(result.redirectTo).toBe("/workspace");
      expect(result.identity).toMatchObject({
        actorId: "u-nurse",
        organizationId: "org-demo",
      });
      expect(result.cookies.join(";")).not.toContain("synthetic-");
      const cookieHeader = result.cookies
        .map((entry) => entry.split(";", 1)[0])
        .join("; ");
      await expect(bff.authenticate(cookieHeader)).resolves.toMatchObject({
        actorId: "u-nurse",
      });

      await bff.logout(cookieHeader);
      await expect(bff.authenticate(cookieHeader)).resolves.toBeNull();
      await expect(
        bff.completeLogin(
          callback.searchParams.get("code")!,
          callback.searchParams.get("state")!,
          loginCookie,
        ),
      ).rejects.toThrow(/STATE/);
    });

    it("rejects an identity from a second fictional institution", async () => {
      const bff = new PostgresOidcBff({
        issuer: issuer!,
        clientId: "pflegehelfer-test",
        redirectUri: "http://127.0.0.1:4173/api/v1/auth/callback",
        publicOrigin: "http://127.0.0.1:4173",
        organizationId: "org-demo",
        databaseUrl: databaseUrl!,
        encryptionSecret: "synthetic-oidc-test-secret-material-000000000",
        sessionTtlSeconds: 900,
        allowInsecureHttp: true,
      });
      instances.push(bff);
      await bff.initialize();
      const login = await bff.beginLogin();
      const loginCookie = login.cookies[0]!.split(";", 1)[0];
      const target = new URL(login.redirectTo);
      target.searchParams.set("login_hint", "rita.rehab");
      const authorization = await fetch(target, { redirect: "manual" });
      const callback = new URL(authorization.headers.get("location")!);
      await expect(
        bff.completeLogin(
          callback.searchParams.get("code")!,
          callback.searchParams.get("state")!,
          loginCookie,
        ),
      ).rejects.toThrow(/ORGANIZATION_MISMATCH/);
    });
  },
);
