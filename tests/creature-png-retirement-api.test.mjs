import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { handleCreaturePngRetirement, PNG_RETIREMENT_SHA256, retiredPngReplacement } from '../worker/creature-png-retirement.ts';
const manifest = JSON.parse(readFileSync(new URL('../catalog/retirement-manifests/creature-original-png-v1.json', import.meta.url)));
const token = 'retirement-test-secret-'.repeat(3);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const png = await sharp({create:{width:2,height:2,channels:4,background:'#ab1234'}}).png().toBuffer();
const webp = await sharp(png).webp().toBuffer();
function fixture() {
  const plan = structuredClone(manifest);
  plan.candidates = Array.from({length:20}, (_,i) => ({creatureId:`test-${i}`,original:{key:`creature-catalog/original/tokens/catalog/test-${i}.png`,byteLength:png.length,sha256:sha(png)},replacement:{key:`creature-catalog/display/tokens/catalog/test-${i}.webp`,byteLength:webp.length,sha256:sha(webp)}}));
  const objects = new Map(); const deleted=[]; const leases=new Map();
  for (const c of plan.candidates) {objects.set(c.original.key,png);objects.set(c.replacement.key,webp);objects.set(c.original.key.replace('/original/','/thumbnails/'),png);}
  const env = {CREATURE_PNG_RETIREMENT_TOKEN:token,CREATURE_PNG_RETIREMENT_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),
    DB:{prepare(sql){return {bind(...args){return {async first(){
      if(sql.includes('INSERT INTO request_rate_limits'))return {request_count:1,window_ends_at:Date.now()+60000};
      if(sql.includes('INSERT INTO operation_leases')) {if(leases.has(args[0]))return null;leases.set(args[0],args[1]);return {lease_token:args[1]};}
      const c=plan.candidates.find(c=>c.creatureId===args[0]);return {token_asset:'/creature-assets/'+c.original.key.slice('creature-catalog/original/'.length),r2_key:c.replacement.key,sha256:c.replacement.sha256,byte_length:c.replacement.byteLength};
    },async run(){leases.delete(args[0]);}};}};}},
    MAP_ASSETS:{async head(key){const b=objects.get(key);return b?{size:b.length}:null;},async get(key){const b=objects.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer,json:async()=>JSON.parse(b.toString())}:null;},async put(key,value){objects.set(key,Buffer.from(value));},async delete(keys){for(const key of keys){deleted.push(key);objects.delete(key);}}}};
  async function call(body={},auth=token){return handleCreaturePngRetirement(new Request('https://example.test/api/admin/creature-png-retirement',{method:'POST',headers:{authorization:`Bearer ${auth}`},body:JSON.stringify({manifestSha256:PNG_RETIREMENT_SHA256,batch:0,apply:false,...body})}),env,plan);}
  return {plan,env,objects,deleted,leases,call};
}
test('compiled retirement digest matches the exact reviewed manifest',()=>assert.equal(PNG_RETIREMENT_SHA256,sha(readFileSync(new URL('../catalog/retirement-manifests/creature-original-png-v1.json',import.meta.url)))));
test('legacy mapping contains only reviewed originals and keeps provisioned assets separate',()=>{assert.equal(retiredPngReplacement('tokens/catalog/campaign-herald.png'),'/creature-assets/display/v1/tokens/catalog/campaign-herald.webp');assert.equal(retiredPngReplacement('tokens/provisioned/anything/file.png'),undefined);});
test('backup/import credentials and absent or expired cleanup credentials cannot delete',async()=>{const f=fixture();assert.equal((await f.call({apply:true},'backup-token')).status,401);f.env.CREATURE_PNG_RETIREMENT_EXPIRES_AT='2000-01-01';assert.equal((await f.call({apply:true})).status,401);assert.equal(f.deleted.length,0);});
test('rejects arbitrary keys, wrong manifest, invalid batches, and missing explicit apply',async()=>{for(const body of [{keys:['handouts/x']},{manifestSha256:'wrong'},{batch:-1},{batch:100},{batch:0.5},{apply:null}]){const f=fixture();assert.equal((await f.call(body)).status,400);assert.equal(f.deleted.length,0);}});
test('bounded request parsing refuses oversized bodies',async()=>{const f=fixture();assert.equal((await f.call({extra:'x'.repeat(2000)})).status,413);});
test('dry run verifies everything without object mutations',async()=>{const f=fixture();const response=await f.call();assert.equal(response.status,200);assert.equal((await response.json()).originalsPresent,10);assert.equal(f.deleted.length,0);assert.equal(f.objects.size,60);assert.equal(f.leases.size,0);});
test('whole batch fails before any delete when the last replacement is corrupt',async()=>{const f=fixture();const c=f.plan.candidates[9];f.objects.set(c.replacement.key,Buffer.alloc(webp.length));assert.equal((await f.call({apply:true})).status,409);assert.equal(f.deleted.length,0);assert.equal(f.leases.size,0);});
test('missing thumbnail or changed original prevents deletion',async()=>{for(const kind of ['thumbnail','original']){const f=fixture();const c=f.plan.candidates[9];if(kind==='thumbnail')f.objects.delete(c.original.key.replace('/original/','/thumbnails/'));else f.objects.set(c.original.key,Buffer.alloc(png.length));assert.equal((await f.call({apply:true})).status,409);assert.equal(f.deleted.length,0);}});
test('catalog lock blocks cleanup without deleting',async()=>{const f=fixture();f.leases.set('catalog-display-import','other');assert.equal((await f.call({apply:true})).status,409);assert.equal(f.deleted.length,0);assert.equal(f.leases.has('catalog-import'),false);});
test('apply records intent before exact deletion; preserves thumbnails and replacements; replay is idempotent',async()=>{const f=fixture();const originalDelete=f.env.MAP_ASSETS.delete;f.env.MAP_ASSETS.delete=async keys=>{assert.equal(JSON.parse(f.objects.get('maintenance/creature-png-retirement-v1/batch-0.json')).status,'intent');await originalDelete(keys);};const r=await f.call({apply:true});assert.equal(r.status,200);assert.equal((await r.json()).deletedThisRequest,10);assert.deepEqual(f.deleted,f.plan.candidates.slice(0,10).map(c=>c.original.key));for(const c of f.plan.candidates){assert.ok(f.objects.has(c.replacement.key));assert.ok(f.objects.has(c.original.key.replace('/original/','/thumbnails/')));}assert.equal((await (await f.call({apply:true})).json()).deletedThisRequest,0);});
test('batches require previous completion and resume recorded partial deletes',async()=>{const f=fixture();assert.equal((await f.call({apply:true,batch:1})).status,409);const originalDelete=f.env.MAP_ASSETS.delete;f.env.MAP_ASSETS.delete=async keys=>{await originalDelete(keys.slice(0,3));throw Error('interrupted');};assert.equal((await f.call({apply:true})).status,409);f.env.MAP_ASSETS.delete=originalDelete;assert.equal((await (await f.call({apply:true})).json()).deletedThisRequest,7);assert.equal((await f.call({apply:true,batch:1})).status,200);});
test('an unrecorded missing original stops apply',async()=>{const f=fixture();f.objects.delete(f.plan.candidates[0].original.key);assert.equal((await f.call({apply:true})).status,409);assert.equal(f.deleted.length,0);});
