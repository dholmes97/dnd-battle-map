-- Custom SQL migration file, put your code below! --
-- Explicitly authorized one-time production data migration; campaign-scoped IDs.
-- Preserve any existing DM-maintained link and every ownership/combat field.
UPDATE campaign_characters
SET beyond20_character_id = CASE id
  WHEN 'character-dareleth' THEN '120144329'
  WHEN 'character-malichar' THEN '163508159'
  WHEN 'character-jelton' THEN '119657366'
END
WHERE campaign_id = 'campaign-force-of-nature'
  AND id IN ('character-dareleth', 'character-malichar', 'character-jelton')
  AND beyond20_character_id IS NULL;
--> statement-breakpoint
UPDATE encounters SET version = version + 1
WHERE campaign_id = 'campaign-force-of-nature';
