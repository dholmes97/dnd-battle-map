import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { createD1ScenarioProvisioningRepository, createR2ScenarioProvisioningStorage } from '../worker/adapters/d1-scenario-provisioning-repository.ts';
import { createScenarioProvisioningService } from '../worker/scenario-provisioning-service.ts';
import { provisioningContext } from '../worker/adapters/d1-provisioning-access.ts';
import { handleCampaignResource } from '../worker/campaigns.ts';
import { handleScenarioProvisioningApi } from '../worker/scenario-provisioning-api.ts';

const campaignId = 'campaign-force-of-nature';
const sender = 'dholmes97@gmail.com';
const secret = 'local-test-provisioning-secret-00000001';
const jpeg = () => { const b = new Uint8Array(21); b.set([255,216,255,192,0,17,8,8,0,8,0,3]); return b; };
let seq = 0;
function manifest(overrides = {}) {
  const n = ++seq;
  return { version: 2, campaignId, idempotencyKey: `campaign-test-${n}`, revision: n, operation: 'create', targetScenarioCode: null,
    source: { provider: 'gmail', mailboxKey: 'test-mailbox', messageId: `message-${n}`, threadId: 'thread-1', sender },
    scenario: { name: `Email encounter ${n}`, briefing: 'Private preparation' }, party: { include: true, placements: [] },
    settings: { strictMovement: null }, map: { id: 'test-map', assetId: 'map', name: 'Test map', description: '', biome: 'dungeon', mood: 'torchlight', width: 16, height: 16 },
    creatures: [], handouts: [], assumptions: [], reviewWarnings: [], ...overrides };
}

test('campaign email preparation: delegation, first encounters, current parties, scoped revisions, conflicts and retries', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-05-22', d1Databases: ['DB'], r2Buckets: ['MAP_ASSETS'] });
  try {
    const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('MAP_ASSETS');
    const dir = new URL('../drizzle/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
      for (const sql of (await readFile(new URL(name, dir), 'utf8')).split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    let id = 0, race = null;
    const racedDb = new Proxy(db, { get(target, key) {
      if (key === 'batch') return async (statements) => { if (race) { const run = race; race = null; await run(); } return db.batch(statements); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    }});
    const service = createScenarioProvisioningService({ repository: createD1ScenarioProvisioningRepository(racedDb), objectStorage: createR2ScenarioProvisioningStorage(bucket, db),
      createId: () => `campaign-email-${++id}`, now: () => 1900000000000 + id, hash: async (v) => JSON.stringify(v), authorizedSenders: [sender, 'uncletev@gmail.com'] });
    const env = { DB: db, MAP_ASSETS: bucket, SCENARIO_PROVISIONING_TOKEN: secret, SCENARIO_PROVISIONING_SENDERS: `${sender},uncletev@gmail.com` };
    const seeded = await db.prepare('SELECT id, role, can_provision_scenarios FROM campaign_memberships WHERE campaign_id=? AND identity_id=?').bind(campaignId, 'identity-dan').first();
    assert.equal(seeded.role, 'player'); assert.equal(seeded.can_provision_scenarios, 1);
    const delegate = async (identityId, allowed, membershipId = seeded.id, selectedCampaign = campaignId) => handleCampaignResource(new Request('http://localhost/api/campaigns/test/email-delegation', { method: 'PATCH', body: JSON.stringify({ membershipId, allowed }) }), env, { id: identityId }, selectedCampaign, 'email-delegation');
    assert.equal((await delegate('identity-dan', false)).status, 403);
    assert.equal((await delegate('identity-kevin', false)).status, 200);
    await assert.rejects(service.createJob(manifest()), (e) => e.code === 'campaign_unauthorized');
    assert.equal((await delegate('identity-kevin', true)).status, 200);
    assert.equal((await delegate('identity-kevin', true, 'missing')).status, 404);

    // Second campaign has no prior encounter and an entirely different, current party.
    await db.batch([
      db.prepare("INSERT INTO campaigns(id,slug,name,created_at,updated_at) VALUES ('campaign-second','second','Second campaign',1,1)"),
      db.prepare("INSERT INTO campaign_memberships(id,campaign_id,identity_id,role,created_at,updated_at) VALUES ('second-dm','campaign-second','identity-dan','dm',1,1)"),
      db.prepare("INSERT INTO campaign_characters(id,campaign_id,controller_membership_id,name,class_name,size,speed,armor_class,max_hp,sort_order,is_active,created_at,updated_at) VALUES ('new-hero','campaign-second','second-dm','New Hero','Wizard','medium',35,15,43,1,1,1,1)"),
    ]);
    assert.equal((await provisioningContext(db, sender, {})).campaigns.length, 2, 'caller must resolve ambiguous campaign selection');
    assert.equal((await delegate('identity-kevin', true, 'second-dm', 'campaign-second')).status, 403);
    await assert.rejects(service.createJob(manifest({ campaignId: '' })), (e) => e.code === 'manifest_invalid');
    await assert.rejects(provisioningContext(db, 'uncletev@gmail.com', { campaignId: 'campaign-second' }), (e) => e.code === 'campaign_unauthorized');
    await db.prepare("INSERT INTO creature_catalog(id,name,family,size,default_speed,source_asset,token_asset,thumbnail_asset,sort_order,is_active,created_at,updated_at,default_hp,armor_class,walk_speed) VALUES ('srd-bandit','Bandit','humanoid','medium',30,'test-source','test-token','test-thumb',1,1,1,1,11,12,30)").run();
    const createInput = manifest({ campaignId: 'campaign-second', creatures: [{ catalogId: 'srd-bandit', create: null, placements: [{ id: 'guard', name: 'Gate guard', x: 5, y: 5, hidden: true }] }] });
    const created = await service.createJob(createInput);
    assert.equal((await service.createJob(createInput)).created, false);
    await service.stageAsset(created.job.id, 'map', 'image/jpeg', jpeg());
    const result = await service.finalize(created.job.id);
    assert.deepEqual(await service.finalize(created.job.id), result);
    const tokens = (await db.prepare('SELECT * FROM tokens WHERE encounter_id=? ORDER BY kind').bind(result.scenario.id).all()).results;
    assert.equal(tokens.length, 2);
    const hero = tokens.find((t) => t.kind === 'character'), monster = tokens.find((t) => t.kind === 'monster');
    assert.equal(hero.name, 'New Hero'); assert.equal(hero.hp, 43); assert.equal(hero.max_hp, 43); assert.equal(hero.campaign_character_id, 'new-hero'); assert.equal(hero.initiative, null); assert.equal(hero.movement_used, 0);
    const thread = await provisioningContext(db, sender, { campaignId: 'campaign-second', mailboxKey: 'test-mailbox', threadId: 'thread-1' });
    assert.equal(thread.threadJobs[0].scenarioCode, result.scenario.code);
    const context = async () => provisioningContext(db, sender, { campaignId: 'campaign-second', scenarioCode: result.scenario.code });
    const revision = async (changes = {}) => { const c = await context(); return manifest({ campaignId: 'campaign-second', operation: 'revise', targetScenarioCode: result.scenario.code, expectedVersion: c.encounter.version, expectedDraftUpdatedAt: c.encounter.draftUpdatedAt, party: { include: false }, map: null, ...changes }); };
    const before = await context();
    await assert.rejects(service.createJob(await revision({ campaignId })), (e) => e.code === 'campaign_unauthorized');
    const mapJob = await service.createJob(await revision({ map: createInput.map }));
    await service.stageAsset(mapJob.job.id, 'map', 'image/jpeg', jpeg());
    await service.finalize(mapJob.job.id);
    const after = await context();
    assert.equal(after.encounter.activeMapImageId, before.encounter.activeMapImageId);
    assert.notEqual(after.encounter.draftMapImageId, before.encounter.draftMapImageId);
    const moveJob = await service.createJob(await revision({ tokenChanges: [{ tokenId: monster.id, operation: 'move', x: 7, y: 8 }] }));
    await service.transition(moveJob.job.id, 'validating', 'Validated'); await service.finalize(moveJob.job.id);
    assert.equal((await context()).tokens.find((t) => t.id === monster.id).x, 7);
    const protectedJob = await service.createJob(await revision({ tokenChanges: [{ tokenId: hero.id, operation: 'remove' }] }));
    await service.transition(protectedJob.job.id, 'validating', 'Validated');
    await assert.rejects(service.finalize(protectedJob.job.id), (e) => e.code === 'token_not_editable');
    const stale = await revision();
    await db.prepare('UPDATE encounters SET draft_updated_at=draft_updated_at+1 WHERE id=?').bind(result.scenario.id).run();
    await assert.rejects(service.createJob(stale), (e) => e.code === 'scenario_changed');
    const raceJob = await service.createJob(await revision()); await service.transition(raceJob.job.id, 'validating', 'Validated');
    race = () => db.prepare('UPDATE encounters SET draft_updated_at=draft_updated_at+1 WHERE id=?').bind(result.scenario.id).run();
    await assert.rejects(service.finalize(raceJob.job.id), (e) => e.code === 'scenario_changed');
    const removal = await service.createJob(await revision({ tokenChanges: [{ tokenId: monster.id, operation: 'remove' }] }));
    await service.transition(removal.job.id, 'validating', 'Validated'); await service.finalize(removal.job.id);
    assert.equal((await context()).tokens.length, 1);

    // Revocation at the final D1 boundary rolls back a new encounter too.
    const revokeJob = await service.createJob(manifest()); await service.stageAsset(revokeJob.job.id, 'map', 'image/jpeg', jpeg());
    const countBefore = await db.prepare('SELECT count(*) AS n FROM encounters').first();
    race = () => db.prepare('UPDATE campaign_memberships SET can_provision_scenarios=0 WHERE id=?').bind(seeded.id).run();
    await assert.rejects(service.finalize(revokeJob.job.id));
    assert.deepEqual(await db.prepare('SELECT count(*) AS n FROM encounters').first(), countBefore);
    await assert.rejects(service.stageAsset(revokeJob.job.id, 'map', 'image/jpeg', jpeg()), (e) => e.code === 'campaign_unauthorized');
    // Context requires dedicated secret and allowlist; no unrelated campaign disclosure.
    const body = JSON.stringify({ sender: 'uncletev@gmail.com', campaignId: 'campaign-second' });
    const response = await handleScenarioProvisioningApi(new Request('http://localhost/api/scenario-provisioning/context', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-length': String(Buffer.byteLength(body)) }, body }), env);
    assert.equal(response.status, 403);
  } finally { await mf.dispose(); }
});
