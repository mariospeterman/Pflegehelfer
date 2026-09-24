// Deliberately process-local to this browser document. A refresh rebinds the
// same scoped conversation; a second tab receives a different server context.
let assistantClientContextId = crypto.randomUUID();

interface AssistantContextScope {
  userId: string;
  patientId: string | null;
}

const sameScope = (
  left: AssistantContextScope | undefined,
  right: AssistantContextScope,
) => left?.userId === right.userId && left.patientId === right.patientId;

export function createAssistantContextBindingCoordinator() {
  let bound: AssistantContextScope | undefined;
  let pending:
    { scope: AssistantContextScope; promise: Promise<void> } | undefined;
  let revision = 0;

  return {
    ensure(
      scope: AssistantContextScope,
      bind: () => Promise<unknown>,
    ): Promise<void> {
      if (sameScope(bound, scope)) return Promise.resolve();
      if (pending && sameScope(pending.scope, scope)) return pending.promise;

      const requestRevision = ++revision;
      const promise = (async () => {
        await bind();
        if (revision === requestRevision) bound = scope;
      })().finally(() => {
        if (pending?.promise === promise) pending = undefined;
      });
      pending = { scope, promise };
      return promise;
    },
    markBound(scope: AssistantContextScope): void {
      revision += 1;
      pending = undefined;
      bound = scope;
    },
    reset(): void {
      revision += 1;
      pending = undefined;
      bound = undefined;
    },
  };
}

export const assistantClientContextHeaders = () =>
  ({
    "x-pfh-client-context": assistantClientContextId,
  }) as const;

export function rotateAssistantClientContext(): void {
  assistantClientContextId = crypto.randomUUID();
}
