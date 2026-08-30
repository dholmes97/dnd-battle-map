import assert from "node:assert/strict";
import test from "node:test";

import { handleQaSession, resetQaFixture } from "../worker/qa-sessions.ts";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    if (this.sql.includes("SELECT is_qa FROM campaigns")) return { is_qa: 1 };
    if (this.sql.includes("SELECT 1 AS found FROM encounters")) return { found: 1 };
    if (this.sql.includes("SELECT id FROM participants")) return this.database.existingParticipant;
    return null;
  }
}

class FakeDatabase {
  constructor(existingParticipant = null) {
    this.existingParticipant = existingParticipant;
    this.batches = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches.push(statements);
    return [];
  }
}

const identity = {
  id: "identity-dan",
  displayName: "Dan",
  loginEmail: "dan@example.com",
  canCreateCampaigns: true,
  canUseQaSessions: true,
};

test("reopening a QA persona refreshes its referenced participant instead of deleting it", async () => {
  const database = new FakeDatabase({ id: "existing-participant" });
  const response = await handleQaSession(
    new Request("http://localhost/api/qa/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "dm" }),
    }),
    { DB: database },
    identity,
    async () => ({ marker: "state" }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).participantId, "existing-participant");
  const statements = database.batches[0];
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /NOT EXISTS \(SELECT 1 FROM combat_rolls/);
  assert.match(statements[1].sql, /NOT EXISTS \(SELECT 1 FROM combat_rolls/);
  assert.match(statements[2].sql, /UPDATE participants SET/);
  assert.equal(statements[2].bindings.at(-2), "existing-participant");
});

test("the isolated QA session offers an independently controlled second player", async () => {
  const database = new FakeDatabase();
  const response = await handleQaSession(
    new Request("http://localhost/api/qa/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "player2" }),
    }),
    { DB: database },
    identity,
    async () => ({ marker: "state" }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.role, "player");
  assert.equal(result.participantName, "QA Player 2");
  assert.equal(result.qa.persona, "player2");
  const participantWrite = database.batches[0].at(-1);
  assert.equal(participantWrite.bindings[2], "identity-combat-qa-player-2");
  assert.equal(participantWrite.bindings[5], "membership-combat-qa-player-2");
});

test("QA reset clears fixture activity without invalidating open participant sessions", async () => {
  const database = new FakeDatabase();
  const response = await resetQaFixture(
    new Request("http://localhost/api/qa/reset", { method: "POST" }),
    { DB: database },
    identity,
  );

  assert.equal(response.status, 200);
  const statements = database.batches[0];
  const combatRollDelete = statements.findIndex((statement) => statement.sql.includes("DELETE FROM combat_rolls"));
  const participantDelete = statements.findIndex((statement) => statement.sql.includes("DELETE FROM participants"));
  assert.notEqual(combatRollDelete, -1);
  assert.equal(participantDelete, -1);
  const guidingBolt = statements.find((statement) => statement.sql.includes("character-combat-qa-guiding-bolt-v1"));
  assert.ok(guidingBolt);
  assert.match(guidingBolt.sql, /'Guiding Bolt', 8, 'ranged', 4, 6/);
  assert.match(guidingBolt.sql, /0, 'radiant', NULL, 120, 1/);
  assert.ok(statements.some((statement) => statement.sql.includes("token-combat-qa-player-2")));
  const playerTwoActions = statements.find((statement) => statement.sql.includes("character-combat-qa-player-2-rapier-v1"));
  assert.ok(playerTwoActions);
  assert.match(playerTwoActions.sql, /'Rapier', 5, 'melee', 1, 8/);
  assert.match(playerTwoActions.sql, /'Shortbow', 5, 'ranged', 1, 6/);
});
