import fs from 'node:fs';
const requested=process.argv.slice(2);
const files=requested.length?requested.map(name=>{if(!/^\d{12}_[a-z0-9_]+\.sql$/.test(name)||!fs.existsSync('supabase/migrations/'+name))throw Error('Invalid migration '+name);return name;}):fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)).sort();
const sql='begin;\nset local lock_timeout=\'3s\';\nset local statement_timeout=\'60s\';\n'+files.map(file=>'\n-- '+file+'\n'+fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n')+'\ncommit;\n';
fs.writeFileSync('deploy-schema.txt',sql);
const html=content=>'<meta charset="utf-8"><pre id="code">'+content.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>';
fs.writeFileSync('deploy-schema.html',html(sql));
console.log(JSON.stringify({migrations:files,sqlBytes:Buffer.byteLength(sql)}));
