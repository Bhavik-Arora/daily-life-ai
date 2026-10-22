import http from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { join, extname } from 'node:path';

loadEnv();
const ROOT = process.cwd(), PUBLIC = join(ROOT, 'www'), DATA_DIR = join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY is required. Copy .env.example to .env and set a 32-byte base64 secret.');
const KEY = createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY).digest();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const oauthStates = new Set();
const otps = new Map();          // email -> { hash, exp, tries }
const lastCodeSent = new Map();  // email -> timestamp of last code
const SESSION_MS = 30 * 86400000;

function loadEnv() { try { requireEnv(awaitlessRead('.env')); } catch {} }
function awaitlessRead(path) { return existsSync(path) ? readFileSync(path, 'utf8') : ''; }
function requireEnv(text) { for (const line of text.split(/\r?\n/)) { const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,''); } }
function seal(value) { const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm', KEY, iv); const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]); return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}); }
function unseal(value) { const p=JSON.parse(value), decipher=createDecipheriv('aes-256-gcm',KEY,Buffer.from(p.iv,'base64')); decipher.setAuthTag(Buffer.from(p.tag,'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(p.data,'base64')),decipher.final()]).toString()); }

// Each account gets its own encrypted file. Guests (no account) use the original shared file.
// Every account and every guest device has its own encrypted file. Nothing is shared.
function dataFile(key) {
  return join(DATA_DIR, 'u-' + createHash('sha256').update('user:' + key).digest('hex').slice(0, 40) + '.enc');
}
async function load(email) { try { return unseal(await readFile(dataFile(email), 'utf8')); } catch { return { user:null, conversations:[], tasks:[] }; } }
async function save(db, email) { await mkdir(DATA_DIR, { recursive: true }); await writeFile(dataFile(email), seal(db), { mode: 0o600 }); }

function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()); }
function bootstrap(db, key) {
  const email = key && !key.startsWith('guest:') ? key : null;
  if (!db.user) db.user = { id: randomUUID(), displayName: 'Friend', email, streak: 1, lastActiveOn: today(), createdAt: new Date().toISOString() };
  if (!db.conversations.length) db.conversations.push({ id: randomUUID(), createdAt: new Date().toISOString(), title: 'Today with Daily Life', messages: [] });
  return db;
}
function bumpStreak(user) { const now=today(); if (user.lastActiveOn===now) return; const prior=new Date(Date.now()-86400000).toISOString().slice(0,10); user.streak=user.lastActiveOn===prior ? user.streak+1 : 1; user.lastActiveOn=now; }
function json(res, code, payload) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(payload)); }
async function body(req) { let raw=''; for await(const c of req) raw+=c; return raw ? JSON.parse(raw) : {}; }
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---- sign-in tokens (signed, expire after 30 days) ----
const sign = v => createHmac('sha256', KEY).update(v).digest('base64url');
const normEmail = e => { const v=String(e||'').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null; };
function makeToken(email) { const p=Buffer.from(JSON.stringify({ e: email, x: Date.now()+SESSION_MS })).toString('base64url'); return p+'.'+sign(p); }
function emailFromToken(token) {
  const [p, sig] = String(token||'').split('.'); if (!p || !sig) return null;
  const a=Buffer.from(sign(p)), b=Buffer.from(sig); if (a.length!==b.length || !timingSafeEqual(a,b)) return null;
  try { const { e, x } = JSON.parse(Buffer.from(p,'base64url').toString()); return x > Date.now() ? e : null; } catch { return null; }
}
// Signed-in email, or null for a guest. A bad or expired token is an error, never a guest.
function sessionEmail(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const email = emailFromToken(h.slice(7));
  if (!email) throw fail(401, 'Your session has ended. Please log in again.');
  return email;
}

// ---- email code ----
async function sendCode(email, code) {
  if (!process.env.RESEND_API_KEY) throw fail(503, 'Email sign-in is not set up on the server yet.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Daily Life <onboarding@resend.dev>',
      to: [email],
      subject: 'Your Daily Life code',
      html: `<p>Your Daily Life code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p>`
    })
  });
  if (!r.ok) { console.error('Email send failed', r.status, await r.text()); throw fail(502, "We couldn't send the email. Please try again in a moment."); }
}

const SYSTEM={
  advice:'You are Daily Life, an advice assistant for everyday decisions, plans and problems. Give clear, practical, honest advice. Ask a short clarifying question when the situation is unclear. Be concise, warm and respectful. Remind people to check important medical, legal or financial decisions with a qualified professional. If asked what model or company powers Daily Life, say you are the Daily Life assistant and cannot share details about the underlying technology. If someone sincerely asks whether they are talking to an AI, always say yes.',
  general:'You are Daily Life, a general-purpose AI assistant, like a standard chatbot. Answer any question, explain topics, write and edit text, help with code, brainstorm, summarize, translate and solve problems. Match the length to the question: short for simple questions, detailed for complex ones. Use lists, tables, code blocks and headings when they help. Be accurate, say when you are not sure, and do not add advice or wellbeing reminders unless asked. If asked what model or company powers Daily Life, say you are the Daily Life assistant and cannot share details about the underlying technology. If someone sincerely asks whether they are talking to an AI, always say yes.'
};
async function llmReply(message,tier,effort,mode='advice') {
  if (!process.env.ANTHROPIC_API_KEY) return companionReply(message,tier,effort);
  const tierKey={base:'BASE',pro:'PRO','ultra max':'ULTRA'}[tier] || 'BASE';
  const model=process.env[`ANTHROPIC_MODEL_${tierKey}`] || process.env.ANTHROPIC_MODEL_BASE;
  const max_tokens=Math.round(300+effort*12);
  const response=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model,max_tokens,system:SYSTEM[mode],messages:[{role:'user',content:message}]})
  });
  if(!response.ok) throw new Error('Companion service is unavailable');
  const result=await response.json();
  return result.content?.find(block=>block.type==='text')?.text || companionReply(message,tier,effort);
}
function companionReply(message, tier, effort) { const intros=['I’m right here with you.','That sounds worth giving a little room to.','I hear you.']; const focus=effort>65?'Let’s make the next step small and specific. What would make today feel 1% lighter?': 'What feels like the kindest next move?'; return `${intros[message.length%intros.length]} ${focus}`; }

// ---- Google Drive connector (read-only) ----
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.readonly';
const driveRedirect=()=>process.env.GOOGLE_DRIVE_REDIRECT_URI||'https://daily-life-ai.onrender.com/api/drive/callback';
async function driveAccessToken(email){
  const db=await load(email); const refresh=db.drive&&db.drive.refresh_token;
  if(!refresh) throw fail(409,'Google Drive is not connected yet.');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'})}).then(r=>r.json());
  if(!r.access_token) throw fail(401,'Google Drive access expired. Disconnect and connect again.');
  return r.access_token;
}
// Who the data belongs to: the signed-in email, or this guest device's own ID.
function identity(req){
  const email=sessionEmail(req); if(email) return email;
  const g=String(req.headers['x-guest-id']||'');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(g)) throw fail(400,'Your guest session needs a refresh. Reload the page.');
  return 'guest:'+g;
}
function requireLogin(req){ const me=identity(req); if(!me) throw fail(401,'Log in to use connectors.'); return me; }

const server=http.createServer(async(req,res)=>{ try {
  const url=new URL(req.url,`http://${req.headers.host}`);
  // Let the phone app (which runs from https://localhost) talk to this server
  const origin=req.headers.origin;
  if (origin && ['https://localhost','http://localhost','capacitor://localhost','https://bhavikarora.com','https://www.bhavikarora.com'].includes(origin)) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Guest-Id'); }
  if (req.method==='OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname==='/api/health') return json(res,200,{ok:true});

  // Step 1: email a 6-digit code
  if (url.pathname==='/api/auth/otp/request' && req.method==='POST') {
    const email=normEmail((await body(req)).email);
    if (!email) return json(res,400,{error:'Enter a valid email address.'});
    const last=lastCodeSent.get(email)||0;
    if (Date.now()-last < 60000) return json(res,429,{error:'Please wait a minute before asking for another code.'});
    const code=String(randomInt(100000,1000000));
    await sendCode(email,code);
    lastCodeSent.set(email,Date.now());
    otps.set(email,{ hash: sign('otp:'+email+':'+code), exp: Date.now()+600000, tries: 0 });
    return json(res,200,{ok:true});
  }

  // Step 2: check the code and sign in
  if (url.pathname==='/api/auth/otp/verify' && req.method==='POST') {
    const input=await body(req);
    const email=normEmail(input.email), code=String(input.code||'').trim(), name=String(input.name||'').trim().slice(0,60);
    const rec=email && otps.get(email);
    if (!rec || rec.exp < Date.now()) return json(res,400,{error:'That code has expired. Request a new one.'});
    rec.tries++;
    if (rec.tries > 5) { otps.delete(email); return json(res,429,{error:'Too many wrong tries. Request a new code.'}); }
    if (sign('otp:'+email+':'+code) !== rec.hash) return json(res,400,{error:'That code is not right. Check the email and try again.'});
    otps.delete(email);
    const db=bootstrap(await load(email), email);
    if (name) db.user.displayName=name;
    else if (!db.user.displayName || db.user.displayName==='Friend') db.user.displayName=email.split('@')[0];
    db.user.email=email;
    await save(db,email);
    return json(res,200,{ token: makeToken(email), user: { displayName: db.user.displayName, email } });
  }

  if (url.pathname==='/api/bootstrap' && req.method==='GET') { const me=identity(req); const db=bootstrap(await load(me), me); bumpStreak(db.user); await save(db,me); return json(res,200,{...db, quote:'Small steps, held gently, become a life you recognize.'}); }
  if (url.pathname==='/api/tasks' && req.method==='POST') { const me=identity(req); const db=bootstrap(await load(me), me), input=await body(req); const task={id:randomUUID(),title:String(input.title||'').slice(0,200),dueAt:input.dueAt||null,routine:!!input.routine,completed:false,createdAt:new Date().toISOString()}; if(!task.title) return json(res,400,{error:'A task needs a name.'}); db.tasks.push(task); await save(db,me); return json(res,201,task); }
  if (url.pathname.startsWith('/api/tasks/') && req.method==='PATCH') { const me=identity(req); const db=bootstrap(await load(me), me), task=db.tasks.find(t=>t.id===url.pathname.split('/').pop()); if(!task) return json(res,404,{error:'Not found'}); Object.assign(task,await body(req)); await save(db,me); return json(res,200,task); }
  if (url.pathname==='/api/chat' && req.method==='POST') { const me=identity(req); const db=bootstrap(await load(me), me), input=await body(req), conversation=db.conversations[0]; const text=String(input.message||'').trim(); if(!text) return json(res,400,{error:'Say something first.'}); const tier=['base','pro','ultra max'].includes(input.tier)?input.tier:'base', effort=Math.max(0,Math.min(100,Number(input.effort)||45)); conversation.messages.push({id:randomUUID(),role:'user',text,createdAt:new Date().toISOString(),tier,effort}); let reply; try { reply=await llmReply(text,tier,effort,input.mode==='general'?'general':'advice'); } catch { reply='I’m having trouble reaching my thoughts right now. Your note is safe here—would you like to try again in a moment?'; } const answer={id:randomUUID(),role:'companion',text:reply,createdAt:new Date().toISOString(),tier,effort}; conversation.messages.push(answer); await save(db,me); return json(res,200,{message:answer}); }

  // ---- Google Drive connector ----
  if (url.pathname==='/api/drive/connect' && req.method==='GET') {
    const email=emailFromToken(url.searchParams.get('token'));
    if (!email) return json(res,401,{error:'Log in first, then connect Google Drive.'});
    if (!process.env.GOOGLE_CLIENT_ID) return json(res,501,{error:'Google is not configured on the server.'});
    const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:driveRedirect(),response_type:'code',scope:DRIVE_SCOPE,access_type:'offline',prompt:'consent',state:makeToken(email)});
    res.writeHead(302,{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+q}); return res.end();
  }
  if (url.pathname==='/api/drive/callback' && req.method==='GET') {
    const code=url.searchParams.get('code'), email=emailFromToken(url.searchParams.get('state'));
    if (!code || !email) return json(res,400,{error:'That Drive link has expired. Try connecting again.'});
    const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:driveRedirect(),grant_type:'authorization_code'})}).then(r=>r.json());
    if (!t.refresh_token) return json(res,400,{error:'Google did not give Drive access. Remove this app from your Google account permissions and connect again.'});
    const db=bootstrap(await load(email),email); db.drive={refresh_token:t.refresh_token,connectedAt:new Date().toISOString()}; await save(db,email);
    res.writeHead(302,{Location:'/?work=drive'}); return res.end();
  }
  if (url.pathname==='/api/drive/status' && req.method==='GET') {
    const me=identity(req); if (!me) return json(res,200,{connected:false});
    const db=await load(me); return json(res,200,{connected:!!(db.drive&&db.drive.refresh_token)});
  }
  if (url.pathname==='/api/drive/files' && req.method==='GET') {
    const me=requireLogin(req); const at=await driveAccessToken(me);
    const p=new URLSearchParams({pageSize:'25',orderBy:'modifiedTime desc',q:'trashed=false',fields:'files(id,name,mimeType,modifiedTime)'});
    const r=await fetch('https://www.googleapis.com/drive/v3/files?'+p,{headers:{Authorization:'Bearer '+at}}).then(r=>r.json());
    return json(res,200,{files:r.files||[]});
  }
  if (url.pathname==='/api/drive/file' && req.method==='GET') {
    const me=requireLogin(req); const id=url.searchParams.get('id')||'';
    if (!/^[\w-]+$/.test(id)) throw fail(400,'That file could not be opened.');
    const at=await driveAccessToken(me), H={Authorization:'Bearer '+at};
    const meta=await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`,{headers:H}).then(r=>r.json());
    let text;
    if (meta.mimeType==='application/vnd.google-apps.document'||meta.mimeType==='application/vnd.google-apps.presentation') text=await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,{headers:H}).then(r=>r.text());
    else if (String(meta.mimeType||'').startsWith('text/')||meta.mimeType==='application/json') text=await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,{headers:H}).then(r=>r.text());
    else throw fail(415,"This file type can't be read yet. Try a Google Doc or a text file.");
    return json(res,200,{name:meta.name,text:text.slice(0,20000)});
  }
  if (url.pathname==='/api/drive/disconnect' && req.method==='POST') {
    const me=requireLogin(req); const db=await load(me); delete db.drive; await save(db,me); return json(res,200,{connected:false});
  }

  if (url.pathname==='/api/auth/google') { if(!process.env.GOOGLE_CLIENT_ID) return json(res,501,{error:'Google sign-in needs configuration. Add the Google values in .env.'}); const redirect=process.env.GOOGLE_REDIRECT_URI, state=randomBytes(20).toString('hex'); oauthStates.add(state); setTimeout(()=>oauthStates.delete(state),600000).unref(); res.writeHead(302,{Location:`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=openid%20email%20profile&state=${state}`}); return res.end(); }
  if (url.pathname==='/api/auth/google/callback') {
    const code=url.searchParams.get('code'), state=url.searchParams.get('state');
    if(!code||!state||!oauthStates.delete(state)) return json(res,400,{error:'That sign-in link has expired. Please try again.'});
    const googleToken=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:process.env.GOOGLE_REDIRECT_URI,grant_type:'authorization_code'})}).then(r=>r.json());
    if(!googleToken.access_token) return json(res,401,{error:'Google could not complete sign-in.'});
    const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${googleToken.access_token}`}}).then(r=>r.json());
    const email=normEmail(identity.email);
    if(!email) return json(res,400,{error:'Google did not share an email address.'});
    const db=bootstrap(await load(email), email);
    Object.assign(db.user,{email,displayName:identity.given_name||identity.name||db.user.displayName,avatarUrl:identity.picture||null});
    await save(db,email);
    res.writeHead(302,{Location:'/?auth=google-ready&token='+encodeURIComponent(makeToken(email))}); return res.end();
  }

  let path=url.pathname==='/'?'/index.html':url.pathname; path=path.replaceAll('..',''); const file=join(PUBLIC,path); await stat(file); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}); res.end(await readFile(file));
} catch(error) {
  if (error.status) return json(res,error.status,{error:error.message});
  if (error.code==='ENOENT') return json(res,404,{error:'Not found'});
  console.error(error); return json(res,500,{error:'Something went wrong. Your data was not changed.'});
} });
server.listen(PORT,()=>{
  console.log(`Daily Life is listening on http://localhost:${PORT}`);
  console.log('Email sign-in key set:', Boolean(process.env.RESEND_API_KEY), '| mail from:', process.env.MAIL_FROM ? 'custom' : 'default');
});
