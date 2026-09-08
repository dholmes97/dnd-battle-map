-- Prepared from the three linked D&D Beyond sheets at level 12 on 2026-09-07.
-- Character actions only: no token HP, ownership, catalog actions, or roll history changes.
UPDATE combat_action_profiles
SET damage_dice_count = 3, source_ref = 'dndbeyond-level-12-2026-09-07', updated_at = 1788825600000
WHERE (id, campaign_character_id) IN (
  ('character-jelton-thorn-whip-v1', 'character-jelton'),
  ('character-jelton-produce-flame-v1', 'character-jelton'),
  ('character-jelton-ray-of-frost-v1', 'character-jelton'),
  ('character-malichar-fire-bolt-v1', 'character-malichar')
)
AND damage_dice_count = 2
AND source_ref IN ('jelton-sheet-2026-08-30', 'malichar-sheet-2026-08-30')
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id = 'campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET manual_rider = 1,
    manual_rider_text = 'Improved Divine Smite: add 1d8 radiant on a melee weapon hit (not included in this base damage roll). Optional Divine Smite spends a slot for another 2d8/3d8/4d8 radiant at slot levels 1/2/3, plus 1d8 against undead or fiends. Resolve added dice with the DM.',
    source_ref = 'dndbeyond-level-12-2026-09-07', updated_at = 1788825600000
WHERE id = 'character-dareleth-longsword-v1' AND campaign_character_id = 'character-dareleth'
AND source_ref = 'dareleth-sheet-2026-08-30'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id = 'campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET manual_rider = 1,
    manual_rider_text = 'Melee hits add 1d8 radiant from Improved Divine Smite; thrown hits do not. Optional Divine Smite applies only to melee weapon attacks. Activating the javelin adds 4d6 lightning and expends its use; resolve lightning-line saves separately. All extra dice require DM adjudication.',
    source_ref = 'dndbeyond-level-12-2026-09-07', updated_at = 1788825600000
WHERE id = 'character-dareleth-javelin-of-lightning-v1' AND campaign_character_id = 'character-dareleth'
AND source_ref = 'dareleth-sheet-2026-08-30'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id = 'campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET manual_rider = 1,
    manual_rider_text = CASE WHEN id = 'character-malichar-glimmering-moonbow-v1'
      THEN 'Also deals 1d6 radiant, adjudicated separately. Sneak Attack adds 6d6 piercing once per turn when eligible: advantage, or a non-incapacitated enemy of the target within 5 feet and no disadvantage. Extra dice are not included in the base roll.'
      ELSE 'Sneak Attack adds 6d6 piercing once per turn when eligible: advantage, or a non-incapacitated enemy of the target within 5 feet and no disadvantage. Extra dice are not included in the base roll. Use the separate Booming Blade action when casting that cantrip.' END,
    source_ref = 'dndbeyond-level-12-2026-09-07', updated_at = 1788825600000
WHERE id IN ('character-malichar-dagger-v1','character-malichar-rapier-v1','character-malichar-glimmering-moonbow-v1')
AND campaign_character_id = 'character-malichar' AND source_ref = 'malichar-sheet-2026-08-30'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id = 'campaign-force-of-nature');
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-jelton-guiding-bolt-1-v1',id,'Guiding Bolt','attack-vs-ac',9,'ranged',4,6,0,'radiant',NULL,240,1,
'The next attack against the target has advantage before the end of your next turn. Cast with a slot or one of four Star Map uses per long rest; track uses manually.',
'manual-character','dndbeyond-level-12-2026-09-07',60,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-jelton-guiding-bolt-6-v1',id,'Guiding Bolt (6th level)','attack-vs-ac',9,'ranged',9,6,0,'radiant',NULL,240,1,
'Uses a sixth-level spell slot. The next attack against the target has advantage before the end of your next turn. Track the slot manually.',
'manual-character','dndbeyond-level-12-2026-09-07',105,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-jelton-starry-archer-v1',id,'Starry Form: Archer','attack-vs-ac',9,'ranged',2,8,5,'radiant',NULL,120,1,
'Requires Archer Starry Form. Attack on activation and as a bonus action on later turns. Range follows the linked sheet; track Wild Shape use and form duration manually.',
'manual-character','dndbeyond-level-12-2026-09-07',120,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-jelton-shillelagh-v1',id,'Shillelagh (active weapon)','attack-vs-ac',9,'melee',1,8,5,'bludgeoning',5,NULL,1,
'Attack with an already enchanted club or quarterstaff; casting Shillelagh is a separate bonus action. Values follow the sheet spell entry, without inferring an additional magic-weapon bonus.',
'manual-character','dndbeyond-level-12-2026-09-07',130,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-jelton' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-malichar-booming-rapier-v1',id,'Booming Blade (Rapier +1)','attack-vs-ac',10,'melee',1,8,6,'piercing',5,NULL,1,
'Cast Booming Blade and make its melee weapon attack. On hit add 2d8 thunder; if the target willingly moves at least 5 feet before your next turn, add 3d8 thunder. Eligible Sneak Attack adds 6d6 piercing once per turn. Extra dice require DM adjudication.',
'manual-character','dndbeyond-level-12-2026-09-07',60,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-malichar' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-malichar-booming-dagger-v1',id,'Booming Blade (Dagger)','attack-vs-ac',9,'melee',1,4,5,'piercing',5,NULL,1,
'Cast Booming Blade and make its melee weapon attack (not thrown). On hit add 2d8 thunder; if the target willingly moves at least 5 feet before your next turn, add 3d8 thunder. Eligible Sneak Attack adds 6d6 piercing once per turn. Extra dice require DM adjudication.',
'manual-character','dndbeyond-level-12-2026-09-07',70,1,1788825600000,1788825600000
FROM campaign_characters WHERE id='character-malichar' AND campaign_id='campaign-force-of-nature';
--> statement-breakpoint
UPDATE encounters SET version=version+1 WHERE campaign_id='campaign-force-of-nature';
