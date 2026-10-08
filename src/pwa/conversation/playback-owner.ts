let activeOwner: { id: symbol; stop: () => void } | null = null;

/** One application-wide speech owner prevents overlapping protected readouts. */
export function claimPlayback(stop: () => void): () => void {
  activeOwner?.stop();
  const owner = { id: Symbol("playback-owner"), stop };
  activeOwner = owner;
  return () => {
    if (activeOwner?.id === owner.id) activeOwner = null;
  };
}
