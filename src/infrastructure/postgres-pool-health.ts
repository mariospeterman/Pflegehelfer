export interface ObservablePostgresClient {
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface ObservablePostgresPool {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "connect",
    listener: (client: ObservablePostgresClient) => void,
  ): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(
    event: "connect",
    listener: (client: ObservablePostgresClient) => void,
  ): unknown;
  query(query: {
    text: string;
    query_timeout: number;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface PostgresPoolHealthBoundary {
  available(): boolean;
  probe(): Promise<boolean>;
  dispose(): void;
}

/**
 * node-postgres emits an `error` event when an idle pooled client loses its
 * connection. Without a listener Node treats that event as uncaught and exits.
 * The pool already removes the failed client and can reconnect on a later
 * query, so this boundary records the outage and turns recovery into an
 * explicit bounded probe instead of retrying any interrupted operation.
 */
export function monitorPostgresPool(
  pool: ObservablePostgresPool,
  probeTimeoutMs = 2_000,
): PostgresPoolHealthBoundary {
  let available = true;
  let probeInFlight: Promise<boolean> | null = null;
  const onUnexpectedIdleClientError = () => {
    available = false;
  };
  const onConnectedClient = (client: ObservablePostgresClient) => {
    // pg-pool temporarily removes its own idle-client listener while a client
    // is checked out. Keep this permanent listener so a socket failure between
    // transaction statements cannot become an uncaught EventEmitter error.
    // The query/transaction promise still rejects and owns reconciliation.
    client.on("error", onUnexpectedIdleClientError);
  };
  pool.on("error", onUnexpectedIdleClientError);
  pool.on("connect", onConnectedClient);
  return {
    available: () => available,
    probe() {
      probeInFlight ??= (async () => {
        const signal = AbortSignal.timeout(probeTimeoutMs);
        const query = pool
          .query({ text: "SELECT 1", query_timeout: probeTimeoutMs, signal })
          .then(
            () => true,
            () => false,
          );
        let timer: ReturnType<typeof setTimeout> | null = null;
        const completed = await Promise.race([
          query,
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), probeTimeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        available = completed;
        return completed;
      })().finally(() => {
        probeInFlight = null;
      });
      return probeInFlight;
    },
    dispose() {
      pool.off("error", onUnexpectedIdleClientError);
      pool.off("connect", onConnectedClient);
    },
  };
}
