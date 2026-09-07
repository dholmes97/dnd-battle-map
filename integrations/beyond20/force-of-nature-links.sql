-- Operator backfill, separate from schema migrations. Review target database first.
-- Only fills missing links; never overwrites a DM-maintained link or modifies HP.
BEGIN TRANSACTION;
UPDATE campaign_characters
SET beyond20_character_id = CASE id
  WHEN 'character-dareleth' THEN '120144329'
  WHEN 'character-malichar' THEN '163508159'
  WHEN 'character-jelton' THEN '119657366'
END, updated_at = unixepoch() * 1000
WHERE campaign_id = 'campaign-force-of-nature'
  AND id IN ('character-dareleth', 'character-malichar', 'character-jelton')
  AND beyond20_character_id IS NULL;
UPDATE encounters SET version = version + 1, updated_at = unixepoch() * 1000
WHERE campaign_id = 'campaign-force-of-nature' AND changes() > 0;
COMMIT;
