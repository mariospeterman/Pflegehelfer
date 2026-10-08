export interface IntentExecutionAttempt {
  commandId: string;
  selectionFingerprint: string;
}

export function resolveIntentExecutionAttempt(
  attempts: Map<string, IntentExecutionAttempt>,
  token: string,
  reviewedActionIds: string[] | undefined,
  createCommandId: () => string,
): { commandId: string } | { conflict: true } {
  const selectionFingerprint = JSON.stringify(reviewedActionIds ?? null);
  const prior = attempts.get(token);
  if (prior && prior.selectionFingerprint !== selectionFingerprint)
    return { conflict: true };
  const commandId = prior?.commandId ?? createCommandId();
  attempts.set(token, { commandId, selectionFingerprint });
  return { commandId };
}
