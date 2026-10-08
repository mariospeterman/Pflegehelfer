import { describe, expect, it } from "vitest";
import { parseOidcMembershipProvisioning } from "../src/server/oidc-membership.js";

describe("OIDC principal membership provisioning", () => {
  it("accepts an explicit server-owned issuer and subject mapping", () => {
    expect(
      parseOidcMembershipProvisioning(
        JSON.stringify([
          {
            organizationId: "org-demo",
            issuer: "https://identity.example/",
            subject: "opaque-subject",
            actorId: "u-nurse",
            membershipVersion: 3,
            policyVersion: "directory-v3",
            active: true,
          },
        ]),
      ),
    ).toEqual([
      {
        organizationId: "org-demo",
        issuer: "https://identity.example",
        subject: "opaque-subject",
        actorId: "u-nurse",
        membershipVersion: 3,
        policyVersion: "directory-v3",
        active: true,
      },
    ]);
  });

  it("fails closed on malformed or incomplete deployment input", () => {
    expect(() => parseOidcMembershipProvisioning("not-json")).toThrow(
      "OIDC_MEMBERSHIP_PROVISIONING_JSON_INVALID",
    );
    expect(() =>
      parseOidcMembershipProvisioning(
        JSON.stringify([{ issuer: "https://identity.example" }]),
      ),
    ).toThrow();
  });
});
