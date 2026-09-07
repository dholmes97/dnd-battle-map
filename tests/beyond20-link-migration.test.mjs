import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("sheet link migration touches only missing Force of Nature links and encounter versions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE campaign_characters(id TEXT, campaign_id TEXT, beyond20_character_id TEXT, controller TEXT, hp INTEGER);
      CREATE TABLE encounters(campaign_id TEXT, version INTEGER);
      INSERT INTO encounters VALUES('campaign-force-of-nature',7),('other',9);`);
    const insert = db.prepare("INSERT INTO campaign_characters VALUES(?,?,?,?,?)");
    for (const id of ["character-dareleth", "character-malichar", "character-jelton"]) insert.run(id, "campaign-force-of-nature", null, `owner-${id}`, 27);
    insert.run("other-character", "campaign-force-of-nature", null, "other-owner", 19);
    insert.run("character-jelton", "other", null, "other-owner", 19);
    const sql = readFileSync(new URL("../drizzle/0045_force_of_nature_beyond20_links.sql", import.meta.url), "utf8");
    db.exec(sql);
    const expected = { "character-dareleth": "120144329", "character-malichar": "163508159", "character-jelton": "119657366" };
    for (const row of db.prepare("SELECT * FROM campaign_characters").all()) {
      const target = row.campaign_id === "campaign-force-of-nature" && expected[row.id];
      assert.equal(row.beyond20_character_id, target || null);
      assert.equal(row.hp, target ? 27 : 19);
      assert.equal(row.controller, target ? `owner-${row.id}` : "other-owner");
    }
    assert.equal(db.prepare("SELECT version FROM encounters WHERE campaign_id='other'").get().version, 9);
    db.exec("UPDATE campaign_characters SET beyond20_character_id='987' WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature'");
    db.exec(sql);
    assert.equal(db.prepare("SELECT beyond20_character_id AS id FROM campaign_characters WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature'").get().id, "987");
  } finally { db.close(); }
});
