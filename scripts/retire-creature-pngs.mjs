#!/usr/bin/env node
// Intentionally fixed to the reviewed production operation; no arbitrary keys, origins, or backup tokens.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowed = new Set(['--apply','--from','--through','--receipt-directory']);
for (let i=0;i<args.length;i++) {if(!allowed.has(args[i]))throw Error('Unknown argument');if(args[i]!=='--apply')i++;}
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const from = Number(option('--from','0'));
const through = Number(option('--through','0'));
if(!Number.isInteger(from)||!Number.isInteger(through)||from<0||through<from||through>99)throw Error('Expected fixed batch range 0–99.');
const receiptDirectory = resolve(option('--receipt-directory', '.working/png-retirement-2026-09-07'));
await mkdir(receiptDirectory,{recursive:true,mode:0o700});
const manifestBytes = await readFile(new URL('../catalog/retirement-manifests/creature-original-png-v1.json',import.meta.url));
const manifest=JSON.parse(manifestBytes);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestSha256=hash(manifestBytes);
const token=process.env.CREATURE_PNG_RETIREMENT_TOKEN || execFileSync('/usr/bin/security',['find-generic-password','-a','dnd-battle-map','-s','dnd-battle-map-png-retirement','-w'],{encoding:'utf8'}).trim();
const origin='https://dnd.fridaylunchcrew.com';
for(let batch=from;batch<=through;batch++){
  const candidates=manifest.candidates.slice(batch*10,batch*10+10);
  const response=await fetch(origin+'/api/admin/creature-png-retirement',{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({manifestSha256,batch,apply}),signal:AbortSignal.timeout(115000)});
  const receipt=await response.json();
  if(!response.ok)throw Error(`Batch ${batch}: HTTP ${response.status}: ${receipt.error}`);
  if(receipt.manifestSha256!==manifestSha256||receipt.batch!==batch||receipt.candidateCount!==10||receipt.status!==(apply?'complete':'verified'))throw Error(`Unexpected batch ${batch} response`);
  const name=`batch-${String(batch).padStart(3,'0')}-${apply?'applied':'dry-run'}-${Date.now()}.json`;
  await writeFile(resolve(receiptDirectory,name),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  // Check the old URL too: redirects must preserve every legacy reference after originals disappear.
  const delivery=[];
  for(const c of candidates){
    const legacy='/creature-assets/'+c.original.key.slice('creature-catalog/original/'.length);
    const r=await fetch(origin+legacy,{signal:AbortSignal.timeout(20000)});
    const bytes=Buffer.from(await r.arrayBuffer());
    if(!r.ok||r.headers.get('content-type')!=='image/webp'||hash(bytes)!==c.replacement.sha256)throw Error(`Legacy image delivery failed: ${c.creatureId}`);
    await sharp(bytes).raw().toBuffer();
    const thumbnail=await fetch(origin+legacy+'?variant=thumbnail',{signal:AbortSignal.timeout(20000)});
    if(!thumbnail.ok)throw Error(`Thumbnail delivery failed: ${c.creatureId}`);
    await sharp(Buffer.from(await thumbnail.arrayBuffer())).raw().toBuffer();
    delivery.push({creatureId:c.creatureId,webpSha256:c.replacement.sha256,legacyRedirect:r.redirected,thumbnailVerified:true});
  }
  await writeFile(resolve(receiptDirectory,name.replace('.json','-delivery.json')),JSON.stringify({batch,checkedAt:new Date().toISOString(),delivery},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(`Batch ${batch}: ${apply?'deleted':'verified'} ${receipt.candidateCount} originals; all WebPs, legacy URLs, and thumbnails verified.`);
}
