import { MAX_ACTIONS_PER_ENCOUNTER } from "../../shared/resource-limits.ts";
import {
  MutationConflictError,
  type MutationCommit,
  type MutationUnitOfWork,
} from "../ports/mutation-unit-of-work.ts";

const CONFLICT_MARKER = "mutation_conflict:encounter_version";

export function createD1MutationUnitOfWork(db: D1Database): MutationUnitOfWork {
  const pending: D1PreparedStatement[] = [];
  const unwrapped = new WeakMap<object, D1PreparedStatement>();
  let committed = false;

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement as object, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(statement.bind(...values));
        }
        if (property === "run") {
          return async () => {
            assertOpen();
            pending.push(statement);
            return queuedResult();
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1PreparedStatement;
    unwrapped.set(proxy as object, statement);
    return proxy;
  };

  const database = new Proxy(db as object, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(db.prepare(query));
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          assertOpen();
          pending.push(...statements.map((statement) =>
            unwrapped.get(statement as object) ?? statement
          ));
          return statements.map(() => queuedResult());
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;

  function assertOpen() {
    if (committed) throw new Error("The mutation unit of work is already committed.");
  }

  async function commit(input: MutationCommit) {
    assertOpen();
    committed = true;
    const statements: D1PreparedStatement[] = [];
    const operationId = crypto.randomUUID();
    const bumpVersion = input.bumpVersion !== false;
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      statements.push(db.prepare(
        `INSERT INTO mutation_assertions (operation_id, valid, created_at)
         SELECT ?, CASE WHEN EXISTS (
           SELECT 1 FROM encounters WHERE id = ? AND version = ?
         ) THEN 1 ELSE 0 END, ?`,
      ).bind(operationId, input.encounterId, input.expectedVersion, input.now));
    }
    statements.push(...pending);
    if (bumpVersion) {
      statements.push(db.prepare(
        "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
      ).bind(input.now, input.encounterId));
    }
    if (input.participantId && input.actionType) {
      statements.push(db.prepare(
        `DELETE FROM actions
         WHERE encounter_id = ?
           AND id NOT IN (
             SELECT id FROM actions WHERE encounter_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?
           )`,
      ).bind(input.encounterId, input.encounterId, MAX_ACTIONS_PER_ENCOUNTER - 1));
      statements.push(db.prepare(
        `INSERT INTO actions
         (id, encounter_id, participant_id, action_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.encounterId,
        input.participantId,
        input.actionType,
        JSON.stringify(input.actionPayload ?? {}),
        input.now,
      ));
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      statements.push(db.prepare(
        "DELETE FROM mutation_assertions WHERE operation_id = ?",
      ).bind(operationId));
    }
    try {
      if (statements.length) await db.batch(statements);
    } catch (error) {
      if (String(error).includes(CONFLICT_MARKER)) throw new MutationConflictError();
      throw error;
    }
  }

  return {
    database,
    get hasPendingWrites() { return pending.length > 0; },
    commit,
  };
}

function queuedResult(): D1Result {
  return {
    success: true,
    results: [],
    meta: { changes: 1 },
  } as unknown as D1Result;
}
