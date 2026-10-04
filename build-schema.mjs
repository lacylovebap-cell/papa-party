import fs from 'node:fs';
const files=fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)).sort();
const sql='begin;\nset local lock_timeout=\'3s\';\nset local statement_timeout=\'60s\';\n'+files.map(file=>'\n-- '+file+'\n'+fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n')+'\ncommit;\n';
fs.writeFileSync('deploy-schema.txt',sql);
const html=content=>'<meta charset="utf-8"><pre id="code">'+content.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>';
fs.writeFileSync('deploy-schema.html',html(sql));
console.log(JSON.stringify({migrations:files,sqlBytes:Buffer.byteLength(sql)}));
