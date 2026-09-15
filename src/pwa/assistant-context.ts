// Deliberately process-local to this browser document. A refresh rebinds the
// same scoped conversation; a second tab receives a different server context.
let assistantClientContextId = crypto.randomUUID();

export const assistantClientContextHeaders = () =>
  ({
    "x-pfh-client-context": assistantClientContextId,
  }) as const;

export function rotateAssistantClientContext(): void {
  assistantClientContextId = crypto.randomUUID();
}
