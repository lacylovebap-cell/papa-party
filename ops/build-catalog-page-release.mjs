import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const base=fs.readFileSync('ops/edge-release/party-api-11.03-STATS.2.js','utf8');
const source=fs.readFileSync('supabase/functions/party-api/catalog.ts','utf8');
const start=source.indexOf('  if(b.pageReview===true)');
const end=source.indexOf("  if(b.decision==='confirm_same'",start);
if(start<0||end<0)throw Error('Catalog review source boundary missing');
const anchors=['"/rest/v1/rpc/papa_catalog_review_page"','    if (b.decision === "confirm_same" && b.variantDetails) {','version: "11.03-STATS.2",'];
for(const anchor of anchors)if(base.split(anchor).length!==2)throw Error('Unexpected production artifact boundary: '+anchor);
const artifact=base
 .replace(anchors[0], '"/rest/v1/rpc/" + (b.status === "duplicates" ? "papa_catalog_review_page_matches" : "papa_catalog_review_page")')
 .replace(anchors[1],stripTypeScriptTypes("async function block(){\n"+source.slice(start,end)+"\n}").split("\n").slice(1,-1).join("\n")+"\n"+anchors[1])
 .replace(anchors[2],'version: "11.05-CATALOG.1", catalogPageReview: 1,');
fs.writeFileSync('ops/edge-release/party-api-11.05-CATALOG.1.js',artifact);

