import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server/app.js";
import {
  idTokenClaims,
  oidcConfigurationFromEnvironment,
  type AuthenticatedIdentity,
  type IdentityAdapter,
} from "../src/server/oidc-bff.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function fakeIdentity(actorId = "u-hr") {
  const authenticated: AuthenticatedIdentity = {
    actorId,
    organizationId: "org-demo",
    subject: `subject-${actorId}`,
    membershipVersion: 1,
    policyVersion: "directory-v2-test",
    sessionHash: "session-hash",
    csrfToken: "csrf-token",
  };
  return {
    configured: true as const,
    initialize: vi.fn<IdentityAdapter["initialize"]>(() => Promise.resolve()),
    beginLogin: vi.fn<IdentityAdapter["beginLogin"]>(() =>
      Promise.resolve({
        redirectTo: "https://idp.example/authorize?state=opaque",
        cookies: ["pfh_login=opaque; HttpOnly"],
      }),
    ),
    completeLogin: vi.fn<IdentityAdapter["completeLogin"]>(() =>
      Promise.resolve({
        redirectTo: "/",
        cookies: ["pfh_session=opaque; HttpOnly", "pfh_csrf=csrf-token"],
        identity: authenticated,
      }),
    ),
    authenticate: vi.fn<IdentityAdapter["authenticate"]>((header) =>
      Promise.resolve(
        header?.includes("pfh_session=valid") ? authenticated : null,
      ),
    ),
    logout: vi.fn<IdentityAdapter["logout"]>(() =>
      Promise.resolve({
        redirectTo: "/",
        cookies: ["pfh_session=; Max-Age=0", "pfh_csrf=; Max-Age=0"],
        mode: "local",
      }),
    ),
    completeLogout: vi.fn<IdentityAdapter["completeLogout"]>(() =>
      Promise.resolve({
        redirectTo: "/",
        cookies: ["pfh_logout=; Max-Age=0"],
      }),
    ),
    assertRequestIntegrity: vi.fn<IdentityAdapter["assertRequestIntegrity"]>(
      (input) => {
        if (
          !["GET", "HEAD", "OPTIONS"].includes(input.method) &&
          (input.origin !== "https://pflege.example" ||
            input.csrfHeader !== "csrf-token")
        )
          throw new Error("invalid-request-integrity");
      },
    ),
  };
}

describe("OIDC BFF boundary", () => {
  it("accepts standard identity claims without trusting private actor claims", () => {
    expect(
      idTokenClaims({
        sub: "opaque-subject",
        nonce: "n".repeat(32),
        pfh_user_id: "caller-controlled-actor",
        pfh_organization_id: "caller-controlled-tenant",
      }),
    ).toMatchObject({ sub: "opaque-subject" });
  });
  it("fails closed on partial or insecure production configuration", () => {
    expect(
      oidcConfigurationFromEnvironment({
        PFH_OPERATIONAL_DATABASE_URL: "postgresql://runtime.example/pfh",
      }),
    ).toBeNull();
    expect(() =>
      oidcConfigurationFromEnvironment({ PFH_OIDC_ISSUER: "https://idp" }),
    ).toThrow(/incomplete/);
    expect(() =>
      oidcConfigurationFromEnvironment({
        PFH_OIDC_ISSUER: "http://idp.example",
        PFH_OIDC_CLIENT_ID: "pflegehelfer",
        PFH_OIDC_REDIRECT_URI: "http://pflege.example/api/v1/auth/callback",
        PFH_PUBLIC_ORIGIN: "http://pflege.example",
        PFH_OPERATIONAL_DATABASE_URL: "postgresql://example",
        PFH_SESSION_ENCRYPTION_SECRET: "s".repeat(32),
      }),
    ).toThrow(/HTTPS/);
  });

  it("ignores demo headers when an authenticated BFF identity is active", async () => {
    const identity = fakeIdentity("u-hr");
    const app = buildApp(undefined, { demoMode: true, identity });
    apps.push(app);

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: { "x-demo-user": "u-it" },
    });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: {
        cookie: "pfh_session=valid; pfh_csrf=csrf-token",
        "x-demo-user": "u-it",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ patients: [], tasks: [] });
  });

  it("requires same-origin CSRF proof and clears the durable session on logout", async () => {
    const identity = fakeIdentity("u-nurse");
    const app = buildApp(undefined, { demoMode: true, identity });
    apps.push(app);
    const cookie = "pfh_session=valid; pfh_csrf=csrf-token";

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(rejected.statusCode).toBe(403);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        cookie,
        origin: "https://pflege.example",
        "x-csrf-token": "csrf-token",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      localLogout: true,
      federatedLogout: false,
      redirectTo: "/",
    });
    expect(JSON.stringify(accepted.headers["set-cookie"])).toContain(
      "pfh_session=",
    );
    expect(identity.logout).toHaveBeenCalledOnce();
  });

  it("returns an explicit federated redirect and validates the public logout callback", async () => {
    const identity = fakeIdentity("u-nurse");
    identity.logout.mockResolvedValue({
      redirectTo: "https://idp.example/logout?state=opaque",
      cookies: [
        "pfh_session=; Max-Age=0",
        "pfh_csrf=; Max-Age=0",
        "pfh_logout=browser-binding; HttpOnly",
      ],
      mode: "federated-redirect",
    });
    const app = buildApp(undefined, { demoMode: true, identity });
    apps.push(app);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        cookie: "pfh_session=valid; pfh_csrf=csrf-token",
        origin: "https://pflege.example",
        "x-csrf-token": "csrf-token",
      },
    });
    expect(accepted.json()).toEqual({
      localLogout: true,
      federatedLogout: true,
      redirectTo: "https://idp.example/logout?state=opaque",
    });

    const callback = await app.inject({
      method: "GET",
      url: `/api/v1/auth/logout/callback?state=${"s".repeat(32)}`,
      headers: { cookie: "pfh_logout=browser-binding" },
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("/");
    expect(identity.completeLogout).toHaveBeenCalledWith(
      "s".repeat(32),
      "pfh_logout=browser-binding",
    );
  });

  it("creates authorization redirects without accepting a caller identity", async () => {
    const identity = fakeIdentity();
    const app = buildApp(undefined, { demoMode: true, identity });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/login?returnTo=%2Fworkspace",
      headers: { "x-demo-user": "u-it" },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/idp\.example\//);
    expect(JSON.stringify(response.headers["set-cookie"])).toContain(
      "pfh_login=",
    );
    expect(identity.beginLogin).toHaveBeenCalledWith("/workspace");
  });

  it("forwards the initiating browser binding to the OIDC callback", async () => {
    const identity = fakeIdentity();
    const app = buildApp(undefined, { demoMode: true, identity });
    apps.push(app);
    const state = "s".repeat(32);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/callback?code=synthetic-code&state=${state}`,
      headers: { cookie: "pfh_login=initiating-browser" },
    });
    expect(response.statusCode).toBe(303);
    expect(identity.completeLogin).toHaveBeenCalledWith(
      "synthetic-code",
      state,
      "pfh_login=initiating-browser",
    );
  });
});
