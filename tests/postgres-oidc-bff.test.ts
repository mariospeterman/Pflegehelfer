import { afterEach, describe, expect, it } from "vitest";
import { PostgresOidcBff } from "../src/server/oidc-bff.js";
import { provisionOidcMemberships } from "../src/server/oidc-membership.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const migrationDatabaseUrl = process.env.PFH_MIGRATION_DATABASE_URL;
const issuer = process.env.PFH_TEST_OIDC_ISSUER;
const redirectUri =
  process.env.PFH_TEST_OIDC_REDIRECT_URI ??
  "http://127.0.0.1:4173/api/v1/auth/callback";
const logoutRedirectUri =
  process.env.PFH_TEST_OIDC_POST_LOGOUT_REDIRECT_URI ??
  "http://127.0.0.1:4173/api/v1/auth/logout/callback";
const instances: PostgresOidcBff[] = [];
afterEach(async () =>
  Promise.all(instances.splice(0).map((instance) => instance.close())),
);

describe.runIf(Boolean(databaseUrl && migrationDatabaseUrl && issuer))(
  "PostgreSQL-backed OIDC authorization-code flow",
  () => {
    it("binds PKCE, state, nonce, issuer, audience and a revocable session", async () => {
      await provisionOidcMemberships(migrationDatabaseUrl!, [
        {
          organizationId: "org-demo",
          issuer: issuer!,
          subject: "synthetic-org-demo-nora",
          actorId: "u-nurse",
          membershipVersion: 1,
          policyVersion: "directory-v2-test",
          active: true,
        },
      ]);
      const bff = new PostgresOidcBff({
        issuer: issuer!,
        clientId: "pflegehelfer-test",
        redirectUri,
        logoutRedirectUri,
        publicOrigin: new URL(redirectUri).origin,
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

      await provisionOidcMemberships(migrationDatabaseUrl!, [
        {
          organizationId: "org-demo",
          issuer: issuer!,
          subject: "synthetic-org-demo-nora",
          actorId: "u-nurse",
          membershipVersion: 2,
          policyVersion: "directory-v2-test",
          active: true,
        },
      ]);
      await expect(bff.authenticate(cookieHeader)).resolves.toBeNull();

      const logout = await bff.logout(cookieHeader);
      await expect(bff.authenticate(cookieHeader)).resolves.toBeNull();
      expect(logout.mode).toBe("federated-redirect");
      const logoutTarget = new URL(logout.redirectTo);
      expect(logoutTarget.origin).toBe(new URL(issuer!).origin);
      expect(logoutTarget.searchParams.get("post_logout_redirect_uri")).toBe(
        logoutRedirectUri,
      );
      const state = logoutTarget.searchParams.get("state")!;
      const logoutCookie = logout.cookies
        .filter((entry) => entry.startsWith("pfh_logout="))
        .at(-1)!
        .split(";", 1)[0];
      const upstream = await fetch(logoutTarget, { redirect: "manual" });
      expect(upstream.status).toBe(303);
      const logoutCallback = new URL(upstream.headers.get("location")!);
      expect(logoutCallback.searchParams.get("state")).toBe(state);
      await expect(
        bff.completeLogout(state, logoutCookie),
      ).resolves.toMatchObject({ redirectTo: "/" });
      await expect(bff.completeLogout(state, logoutCookie)).rejects.toThrow(
        /STATE/,
      );
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
        redirectUri,
        logoutRedirectUri,
        publicOrigin: new URL(redirectUri).origin,
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
      ).rejects.toThrow(/MEMBERSHIP_MISSING_OR_REVOKED/);
    });
  },
);
