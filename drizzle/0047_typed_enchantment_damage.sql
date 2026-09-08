ALTER TABLE `combat_action_profiles` ADD `extra_damage_json` text;
--> statement-breakpoint
-- Complete 0046's level-12 profiles with immediate, typed extra damage.
-- Preserve later manual edits and scope every data change to Force of Nature.
INSERT OR IGNORE INTO combat_action_profiles
(id,campaign_character_id,name,resolution_mode,attack_bonus,attack_kind,damage_dice_count,damage_die_size,damage_modifier,damage_type,reach_feet,range_feet,manual_rider,manual_rider_text,source_kind,source_ref,sort_order,is_enabled,created_at,updated_at)
SELECT 'character-dareleth-javelin-thrown-v1',campaign_character_id,'Javelin of Lightning (thrown)',resolution_mode,attack_bonus,'ranged',damage_dice_count,damage_die_size,damage_modifier,damage_type,NULL,30,1,
'Thrown range 30/120 feet; no Improved Divine Smite. Activating the javelin expends its use and adds 4d6 lightning; resolve that damage and lightning-line saves with the DM.',
'manual-character','dndbeyond-level-12-2026-09-07',15,1,1788825600000,1788825600000
FROM combat_action_profiles
WHERE id='character-dareleth-javelin-of-lightning-v1' AND campaign_character_id='character-dareleth'
AND source_ref='dndbeyond-level-12-2026-09-07'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id='campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET extra_damage_json='[{"label":"Improved Divine Smite","formula":{"count":1,"sides":8,"modifier":0},"damageType":"radiant"}]',
    manual_rider=1,
    manual_rider_text='Improved Divine Smite is included automatically. Optional Divine Smite spends a slot for another 2d8/3d8/4d8 radiant at slot levels 1/2/3, plus 1d8 against undead or fiends; resolve the optional dice with the DM.',
    updated_at=1788825600000
WHERE id IN ('character-dareleth-longsword-v1','character-dareleth-javelin-of-lightning-v1')
AND campaign_character_id='character-dareleth' AND source_ref='dndbeyond-level-12-2026-09-07'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id='campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles SET name='Javelin of Lightning (melee)', range_feet=NULL
WHERE id='character-dareleth-javelin-of-lightning-v1' AND campaign_character_id='character-dareleth'
AND source_ref='dndbeyond-level-12-2026-09-07'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id='campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET extra_damage_json='[{"label":"Moonbow enchantment","formula":{"count":1,"sides":6,"modifier":0},"damageType":"radiant"}]',
    manual_rider_text='The 1d6 radiant enchantment is included automatically. Sneak Attack adds 6d6 piercing once per turn when eligible: advantage, or a non-incapacitated enemy of the target within 5 feet and no disadvantage. Resolve Sneak Attack with the DM.',
    updated_at=1788825600000
WHERE id='character-malichar-glimmering-moonbow-v1' AND campaign_character_id='character-malichar'
AND source_ref='dndbeyond-level-12-2026-09-07'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id='campaign-force-of-nature');
--> statement-breakpoint
UPDATE combat_action_profiles
SET extra_damage_json='[{"label":"Booming Blade","formula":{"count":2,"sides":8,"modifier":0},"damageType":"thunder"}]',
    manual_rider_text='The on-hit 2d8 thunder is included automatically. If the target willingly moves at least 5 feet before your next turn, resolve 3d8 thunder separately. Eligible Sneak Attack adds 6d6 piercing once per turn; resolve it with the DM. Melee only, not thrown.',
    updated_at=1788825600000
WHERE id IN ('character-malichar-booming-rapier-v1','character-malichar-booming-dagger-v1')
AND campaign_character_id='character-malichar' AND source_ref='dndbeyond-level-12-2026-09-07'
AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id='campaign-force-of-nature');
