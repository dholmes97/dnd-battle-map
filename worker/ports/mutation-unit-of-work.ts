export type MutationCommit = {
  encounterId: string;
  expectedVersion?: number | null;
  participantId?: string | null;
  actionType?: string | null;
  actionPayload?: Record<string, unknown> | null;
  actionId?: string | null;
  now: number;
  bumpVersion?: boolean;
};

export interface MutationUnitOfWork {
  readonly database: D1Database;
  readonly hasPendingWrites: boolean;
  commit(input: MutationCommit): Promise<void>;
}

export class MutationConflictError extends Error {
  constructor(message = "Shared state changed before this operation could commit.") {
    super(message);
    this.name = "MutationConflictError";
  }
}
