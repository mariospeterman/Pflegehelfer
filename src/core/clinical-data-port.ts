/**
 * Reference-demo state container. This intentionally is not presented as the
 * production FHIR repository contract: a durable implementation needs
 * resource-scoped asynchronous queries, commands and transaction semantics.
 */
export interface ReferenceStatePort<TState extends object> {
  read(): TState;
  transaction<TResult>(work: (state: TState) => TResult): TResult;
  replace(next: TState): void;
}

export class InMemoryReferenceStatePort<
  TState extends object,
> implements ReferenceStatePort<TState> {
  constructor(private state: TState) {}

  read(): TState {
    return this.state;
  }

  transaction<TResult>(work: (state: TState) => TResult): TResult {
    const before = structuredClone(this.state);
    try {
      return work(this.state);
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  replace(next: TState): void {
    this.state = next;
  }
}
