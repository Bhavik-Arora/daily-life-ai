import http from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';

loadEnv();
const ROOT = process.cwd(), PUBLIC = join(ROOT, 'public'), DATA = join(ROOT, 'data', 'daily-life.enc');
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY is required. Copy .env.example to .env and set a 32-byte base64 secret.');
const KEY = createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY).digest();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const oauthStates = new Set();

function loadEnv() { try { requireEnv(awaitlessRead('.env')); } catch {} }
function awaitlessRead(path) { return existsSync(path) ? readFileSync(path, 'utf8') : ''; }
function requireEnv(text) { for (const line of text.split(/\r?\n/)) { const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,''); } }
function seal(value) { const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm', KEY, iv); const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]); return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}); }
function unseal(value) { const p=JSON.parse(value), decipher=createDecipheriv('aes-256-gcm',KEY,Buffer.from(p.iv,'base64')); decipher.setAuthTag(Buffer.from(p.tag,'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(p.data,'base64')),decipher.final()]).toString()); }
async function load() { try { return unseal(await readFile(DATA,'utf8')); } catch { return { user:null, conversations:[], tasks:[] }; } }
async function save(db) { await mkdir(join(ROOT,'data'),{recursive:true}); await writeFile(DATA,seal(db),{mode:0o600}); }
function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()); }
function bootstrap(db) { if (!db.user) db.user={id:randomUUID(),displayName:'Friend',email:null,streak:1,lastActiveOn:today(),createdAt:new Date().toISOString()}; if (!db.conversations.length) db.conversations.push({id:randomUUID(),title:'Today with Daily Life',messages:[]}); return db; }
function bumpStreak(user) { const now=today(); if (user.lastActiveOn===now) return; const prior=new Date(Date.now()-86400000).toISOString().slice(0,10); user.streak=user.lastActiveOn===prior ? user.streak+1 : 1; user.lastActiveOn=now; }
function json(res, code, payload) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(payload)); }
async function body(req) { let raw=''; for await(const c of req) raw+=c; return raw ? JSON.parse(raw) : {}; }
function companionReply(message, tier, effort) { const intros=['I’m right here with you.','That sounds worth giving a little room to.','I hear you.']; const focus=effort>65?'Let’s make the next step small and specific. What would make today feel 1% lighter?': 'What feels like the kindest next move?'; return `${intros[message.length%intros.length]} ${focus}`; }
async function llmReply(message,tier,effort) {
  if (!process.env.ANTHROPIC_API_KEY) return companionReply(message,tier,effort);
  const tierKey={base:'BASE',pro:'PRO','ultra max':'ULTRA'}[tier] || 'BASE';
  const model=process.env[`ANTHROPIC_MODEL_${tierKey}`] || process.env.ANTHROPIC_MODEL_BASE;
  const max_tokens=Math.round(300+effort*12);
  const response=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model,max_tokens,system:'You are Daily Life, a warm, privacy-respecting life companion. Never call yourself an AI or assistant. Be grounded, concise, and supportive.',messages:[{role:'user',content:message}]})
  });
  if(!response.ok) throw new Error('Companion service is unavailable');
  const result=await response.json();
  return result.content?.find(block=>block.type==='text')?.text || companionReply(message,tier,effort);
}

const server=http.createServer(async(req,res)=>{ try {
  const url=new URL(req.url,`http://${req.headers.host}`);
  if (url.pathname==='/api/health') return json(res,200,{ok:true});
  if (url.pathname==='/api/bootstrap' && req.method==='GET') { const db=bootstrap(await load()); bumpStreak(db.user); await save(db); return json(res,200,{...db, quote:'Small steps, held gently, become a life you recognize.'}); }
  if (url.pathname==='/api/tasks' && req.method==='POST') { const db=bootstrap(await load()), input=await body(req); const task={id:randomUUID(),title:String(input.title||'').slice(0,200),dueAt:input.dueAt||null,routine:!!input.routine,completed:false,createdAt:new Date().toISOString()}; if(!task.title) return json(res,400,{error:'A task needs a name.'}); db.tasks.push(task); await save(db); return json(res,201,task); }
  if (url.pathname.startsWith('/api/tasks/') && req.method==='PATCH') { const db=bootstrap(await load()), task=db.tasks.find(t=>t.id===url.pathname.split('/').pop()); if(!task) return json(res,404,{error:'Not found'}); Object.assign(task,await body(req)); await save(db); return json(res,200,task); }
  if (url.pathname==='/api/chat' && req.method==='POST') { const db=bootstrap(await load()), input=await body(req), conversation=db.conversations[0]; const text=String(input.message||'').trim(); if(!text) return json(res,400,{error:'Say something first.'}); const tier=['base','pro','ultra max'].includes(input.tier)?input.tier:'base', effort=Math.max(0,Math.min(100,Number(input.effort)||45)); conversation.messages.push({id:randomUUID(),role:'user',text,createdAt:new Date().toISOString(),tier,effort}); let reply; try { reply=await llmReply(text,tier,effort); } catch { reply='I’m having trouble reaching my thoughts right now. Your note is safe here—would you like to try again in a moment?'; } const answer={id:randomUUID(),role:'companion',text:reply,createdAt:new Date().toISOString(),tier,effort}; conversation.messages.push(answer); await save(db); return json(res,200,{message:answer}); }
  if (url.pathname==='/api/auth/google') { if(!process.env.GOOGLE_CLIENT_ID) return json(res,501,{error:'Google sign-in needs configuration. Add the Google values in .env.'}); const redirect=process.env.GOOGLE_REDIRECT_URI, state=randomBytes(20).toString('hex'); oauthStates.add(state); setTimeout(()=>oauthStates.delete(state),600000).unref(); res.writeHead(302,{Location:`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=openid%20email%20profile&state=${state}`}); return res.end(); }
  if (url.pathname==='/api/auth/google/callback') { const code=url.searchParams.get('code'), state=url.searchParams.get('state'); if(!code||!state||!oauthStates.delete(state)) return json(res,400,{error:'That sign-in link has expired. Please try again.'}); const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:process.env.GOOGLE_REDIRECT_URI,grant_type:'authorization_code'})}).then(r=>r.json()); if(!token.access_token) return json(res,401,{error:'Google could not complete sign-in.'}); const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}}).then(r=>r.json()), db=bootstrap(await load()); Object.assign(db.user,{email:identity.email||null,displayName:identity.given_name||identity.name||db.user.displayName,avatarUrl:identity.picture||null}); await save(db); res.writeHead(302,{Location:'/?auth=google-ready'}); return res.end(); }
  let path=url.pathname==='/'?'/index.html':url.pathname; path=path.replaceAll('..',''); const file=join(PUBLIC,path); await stat(file); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}); res.end(await readFile(file));
} catch(error) { if(error.code==='ENOENT') return json(res,404,{error:'Not found'}); console.error(error); return json(res,500,{error:'Something went wrong. Your data was not changed.'}); } });
server.listen(PORT,()=>console.log(`Daily Life is listening on http://localhost:${PORT}`));
