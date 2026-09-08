import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateCombatActionValues } from "../shared/combat-rolling.ts";

test("level-12 migrations configure typed enchantments without changing HP, ownership or custom actions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE campaign_characters(id TEXT PRIMARY KEY,campaign_id TEXT,hp INTEGER,controller TEXT);
      CREATE TABLE encounters(campaign_id TEXT,version INTEGER);
      CREATE TABLE combat_action_profiles(id TEXT PRIMARY KEY,campaign_character_id TEXT,creature_catalog_id TEXT,
        name TEXT,resolution_mode TEXT,attack_bonus INTEGER,attack_kind TEXT,damage_dice_count INTEGER,
        damage_die_size INTEGER,damage_modifier INTEGER,damage_type TEXT,reach_feet INTEGER,range_feet INTEGER,
        manual_rider INTEGER,manual_rider_text TEXT,alternate_damage_json TEXT,source_kind TEXT,source_ref TEXT,
        sort_order INTEGER,is_enabled INTEGER,created_at INTEGER,updated_at INTEGER);
      INSERT INTO encounters VALUES('campaign-force-of-nature',7),('other',9);`);
    for (const character of ["dareleth", "malichar", "jelton"]) db.prepare("INSERT INTO campaign_characters VALUES(?,?,?,?)").run(`character-${character}`, "campaign-force-of-nature", 27, `owner-${character}`);
    const insert = db.prepare(`INSERT INTO combat_action_profiles
      (id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,source_kind,source_ref,is_enabled,sort_order,created_at,updated_at)
      VALUES(?,?,?,'attack-vs-ac',9,'melee',?,8,5,'piercing',5,NULL,0,'manual-character',?,1,10,1,1)`);
    for (const [character, suffix, count] of [
      ["dareleth","longsword",1], ["dareleth","javelin-of-lightning",1], ["dareleth","unarmed-strike",0],
      ["malichar","glimmering-moonbow",1], ["malichar","dagger",1], ["malichar","rapier",1],
      ["malichar","fire-bolt",2], ["jelton","thorn-whip",2], ["jelton","produce-flame",2], ["jelton","ray-of-frost",2],
    ]) insert.run(`character-${character}-${suffix}-v1`, `character-${character}`, suffix, count, `${character}-sheet-2026-08-30`);
    insert.run("custom-action", "character-malichar", "Custom", 4, null);
    const customBefore = db.prepare("SELECT * FROM combat_action_profiles WHERE id='custom-action'").get();
    const charactersBefore = db.prepare("SELECT * FROM campaign_characters").all();
    db.exec(readFileSync(new URL("../drizzle/0046_force_of_nature_level_12_actions.sql", import.meta.url), "utf8"));
    const enchantmentSql = readFileSync(new URL("../drizzle/0047_typed_enchantment_damage.sql", import.meta.url), "utf8");
    db.exec(enchantmentSql);
    const get = (id) => db.prepare("SELECT * FROM combat_action_profiles WHERE id=?").get(`character-${id}-v1`);
    for (const id of ["dareleth-longsword", "dareleth-javelin-of-lightning"]) {
      assert.deepEqual(JSON.parse(get(id).extra_damage_json)[0].formula, { count: 1, sides: 8, modifier: 0 });
      assert.equal(JSON.parse(get(id).extra_damage_json)[0].damageType, "radiant");
    }
    assert.equal(get("dareleth-javelin-thrown").attack_kind, "ranged");
    assert.equal(get("dareleth-javelin-thrown").extra_damage_json, null);
    assert.equal(get("dareleth-unarmed-strike").extra_damage_json, null);
    assert.equal(get("dareleth-javelin-of-lightning").range_feet, null);
    assert.equal(JSON.parse(get("malichar-glimmering-moonbow").extra_damage_json)[0].formula.sides, 6);
    assert.equal(JSON.parse(get("malichar-booming-dagger").extra_damage_json)[0].formula.count, 2);
    assert.equal(JSON.parse(get("malichar-booming-rapier").extra_damage_json)[0].damageType, "thunder");
    assert.equal(get("malichar-rapier").extra_damage_json, null);
    assert.equal(get("malichar-fire-bolt").damage_dice_count, 3);
    assert.equal(get("jelton-thorn-whip").damage_dice_count, 3);
    assert.equal(get("jelton-guiding-bolt-6").damage_dice_count, 9);
    assert.equal(get("jelton-starry-archer").damage_dice_count, 2);
    assert.deepEqual(db.prepare("SELECT * FROM campaign_characters").all(), charactersBefore);
    assert.deepEqual({ ...db.prepare("SELECT * FROM combat_action_profiles WHERE id='custom-action'").get() }, { ...customBefore, extra_damage_json: null });
    assert.equal(db.prepare("SELECT version FROM encounters WHERE campaign_id='other'").get().version, 9);
    for (const row of db.prepare("SELECT * FROM combat_action_profiles WHERE source_ref='dndbeyond-level-12-2026-09-07'").all()) {
      assert.ok(validateCombatActionValues({ name: row.name, attackBonus: row.attack_bonus, attackKind: row.attack_kind,
        damage: { count: row.damage_dice_count, sides: row.damage_die_size, modifier: row.damage_modifier }, damageType: row.damage_type,
        reachFeet: row.reach_feet, rangeFeet: row.range_feet, manualRider: Boolean(row.manual_rider), manualRiderText: row.manual_rider_text,
        extraDamage: JSON.parse(row.extra_damage_json ?? "[]"),
      }, { requireManualRiderText: true }), row.id);
    }
    // A later manual edit is not overwritten by a retried data backfill.
    db.exec("UPDATE combat_action_profiles SET source_ref=NULL,extra_damage_json='[]',name='Customized' WHERE id='character-dareleth-longsword-v1'");
    db.exec(enchantmentSql.slice(enchantmentSql.indexOf("--> statement-breakpoint")));
    assert.equal(get("dareleth-longsword").name, "Customized");
    assert.equal(get("dareleth-longsword").extra_damage_json, "[]");
  } finally { db.close(); }
});
