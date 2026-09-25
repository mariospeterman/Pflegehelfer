import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedSyntheticDemoWorkspace } from "../src/infrastructure/demo-workspace.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";

describe("synthetic demo workspace", () => {
  it("seeds realistic collaboration fixtures idempotently and restores them after reset", async () => {
    const store = new InMemoryOperationalStore();
    await store.initialize();

    await seedSyntheticDemoWorkspace(store);
    await seedSyntheticDemoWorkspace(store);

    const visiblePatientIds = [
      "p-anna",
      "p-luca",
      "p-ruth",
      "p-peter",
      "p-sofia",
      "p-emil",
      "p-mei",
      "p-jonas",
    ];
    const comments = await store.listWorkspaceComments({
      actorId: "u-assistant",
      visiblePatientIds,
    });
    const attachments = await store.listWorkspaceAttachments({
      actorId: "u-assistant",
      visiblePatientIds,
    });
    const projects = await store.listWorkspaceProjects("u-assistant");

    expect(comments).toHaveLength(2);
    expect(
      comments.some(
        (item) =>
          item.patientId === "p-anna" && item.topicIds[0] === "mobilitaet",
      ),
    ).toBe(true);
    expect(
      comments.some(
        (item) => item.patientId === null && item.audience.kind === "direct",
      ),
    ).toBe(true);
    expect(attachments).toHaveLength(1);
    const content = await store.loadWorkspaceAttachment(
      "u-assistant",
      attachments[0]!.id,
      visiblePatientIds,
    );
    expect(content).not.toBeNull();
    expect(createHash("sha256").update(content!.bytes).digest("hex")).toBe(
      attachments[0]!.sha256,
    );
    expect(new TextDecoder().decode(content!.bytes)).toContain(
      "SYNTHETISCHE DEMO",
    );
    expect(projects).toEqual([
      expect.objectContaining({
        title: "Morgenmobilisation koordinieren",
        links: [{ kind: "task", id: "t-mobilise-luca" }],
      }),
    ]);

    await store.resetDemoState();
    await seedSyntheticDemoWorkspace(store);
    expect(await store.listWorkspaceProjects("u-assistant")).toHaveLength(1);
  });
});
