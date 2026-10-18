let pendingFiles=[];
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// APK ONLY: set this to your deployed server URL (no trailing slash), e.g. 'https://your-app.onrender.com'. Keep '' for the website.
const API_BASE='https://daily-life-ai.onrender.com';
const KEY='dailylife_v1';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const blankChat=()=>({id:uid(),createdAt:new Date().toISOString(),messages:[]});
const normalize=list=>(Array.isArray(list)?list:[]).map(c=>({...c,id:String(c.id||uid()),messages:Array.isArray(c.messages)?c.messages:[]}));
let state={user:{displayName:'Friend',streak:1},conversations:[blankChat()],tasks:[]};
let activeId=state.conversations[0].id;
const active=()=>state.conversations.find(c=>c.id===activeId)||state.conversations[0];
const TOKEN_KEY='dailylife_token';
let authToken=null;try{authToken=localStorage.getItem(TOKEN_KEY);}catch(e){}
function guestId(){let g=null;try{g=localStorage.getItem('dailylife_guest');}catch(e){}if(!g){g=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('dailylife_guest',g);}catch(e){}}return g;}
const api=(path,options={})=>fetch(API_BASE+path,{headers:{'Content-Type':'application/json',...(authToken?{Authorization:'Bearer '+authToken}:{'X-Guest-Id':guestId()})},...options}).then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok){const e=Error(data.error||('Request failed ('+r.status+')'));e.status=r.status;throw e;}return data;});
function escape(text){return String(text).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}

/* ---------- saving (chats stay on the phone) ---------- */
function save(){try{localStorage.setItem(KEY,JSON.stringify({user:state.user,conversations:state.conversations,tasks:state.tasks,activeId}));}catch(e){}}
function load(){try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&Array.isArray(s.conversations)&&s.conversations.length){state.user=s.user||state.user;state.conversations=normalize(s.conversations);state.tasks=s.tasks||[];activeId=state.conversations.some(c=>c.id===s.activeId)?s.activeId:state.conversations[state.conversations.length-1].id;return true;}}catch(e){}return false;}
function prune(){ // drop empty chats except the open one
  if(!state.conversations.length)state.conversations=[blankChat()];
  if(!state.conversations.some(c=>c.id===activeId))activeId=state.conversations[state.conversations.length-1].id;
  state.conversations=state.conversations.filter(c=>c.messages.length||c.id===activeId);
}

/* ---------- chats ---------- */
function scrollDown(){setTimeout(()=>{const c=$('.chat-container');if(c)c.scrollTop=c.scrollHeight;try{window.scrollTo({top:document.body.scrollHeight});}catch(e){}},50);}
/* ---------- formatting for AI replies (text is escaped first; only https links and images) ---------- */
function renderMd(src){
  const codes=[];
  let s=escape(String(src||'')).replace(/`([^`\n]+)`/g,(_,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000';});
  s=s.replace(/!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)/g,(_,alt,u)=>'<img class="md-img" src="'+u+'" alt="'+alt+'" loading="lazy" referrerpolicy="no-referrer">');
  s=s.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g,(_,t,u)=>'<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+t+'</a>');
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_\n]+)__/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
  let out='', list=null;
  const closeList=()=>{if(list){out+='</'+list+'>';list=null;}};
  for(const raw of s.split('\n')){
    const line=raw.trim(); let m;
    if(line===''){closeList();continue;}
    if((m=line.match(/^[-*•]\s+(.*)$/))){if(list!=='ul'){closeList();out+='<ul>';list='ul';}out+='<li>'+m[1]+'</li>';continue;}
    if((m=line.match(/^\d+[.)]\s+(.*)$/))){if(list!=='ol'){closeList();out+='<ol>';list='ol';}out+='<li>'+m[1]+'</li>';continue;}
    closeList();
    if((m=line.match(/^#{1,3}\s+(.*)$/))){out+='<p class="md-h"><strong>'+m[1]+'</strong></p>';continue;}
    out+='<p>'+line+'</p>';
  }
  closeList();
  return out.replace(/\u0000(\d+)\u0000/g,(_,i)=>'<code>'+codes[+i]+'</code>');
}
function renderMessages(){
  const box=$('#messages'), msgs=active().messages;
  $('#chat').classList.toggle('has-messages',msgs.length>0);
  box.innerHTML=msgs.length?msgs.map((m,i)=>'<div class="message '+m.role+'">'+(m.role==='companion'?renderMd(m.text):escape(m.text))+(m.role==='companion'?'<button class="icon-btn" data-i="'+i+'" aria-label="Read aloud" title="Read aloud"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg></button>':'')+'</div>').join(''):'<p class="empty">Ready to chat?</p>';
  box.querySelectorAll('button[data-i]').forEach(b=>b.onclick=()=>speak(msgs[+b.dataset.i]?.text));
  scrollDown();
}
let chatQuery='';
function chatTitle(c){const first=c.messages.find(m=>m.role==='user')||c.messages[0];const t=((first&&first.text)||'').split('\n')[0].trim();return t||'New chat';}
function bucket(c){const d=new Date(c.createdAt||Date.now()),now=new Date();const days=Math.round((new Date(now.getFullYear(),now.getMonth(),now.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);return days<=0?'Today':days===1?'Yesterday':days<=7?'Previous 7 days':days<=30?'Previous 30 days':'Older';}
function renderChatHistory(){
  const target=$('#chatHistory'); if(!target)return;
  const q=chatQuery.trim().toLowerCase();
  const list=state.conversations.filter(c=>c.messages.length||c.id===activeId)
    .filter(c=>!q||chatTitle(c).toLowerCase().includes(q)||c.messages.some(m=>String(m.text).toLowerCase().includes(q)))
    .slice().reverse();
  if(!list.length){target.innerHTML='<p class="sb-empty">'+(q?'No chats match your search':'No chats yet. Start one above.')+'</p>';return;}
  let html='';
  for(const label of ['Today','Yesterday','Previous 7 days','Previous 30 days','Older']){
    const items=list.filter(c=>bucket(c)===label); if(!items.length)continue;
    html+='<div class="sb-group"><h4>'+label+'</h4>'+items.map(c=>{const t=chatTitle(c);return '<div class="chat-item'+(c.id===activeId?' active':'')+'" data-id="'+escape(c.id)+'" title="'+escape(t)+'"><span class="title">'+escape(t.length>36?t.slice(0,36)+'…':t)+'</span><button type="button" class="chat-del" data-del="'+escape(c.id)+'" aria-label="Delete chat">×</button></div>';}).join('')+'</div>';
  }
  target.innerHTML=html;
  target.querySelectorAll('.chat-item').forEach(el=>el.onclick=e=>{if(e.target.closest('.chat-del'))return;selectChat(el.dataset.id);});
  target.querySelectorAll('.chat-del').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteChat(b.dataset.del);});
}
$('#chatSearch').oninput=e=>{chatQuery=e.target.value;renderChatHistory();};

function renderAll(){renderMessages();renderTasks();renderChatHistory();renderLast7Days();}
function selectChat(id){activeId=id;prune();showView('chat');closeOnMobile();renderAll();save();}
function deleteChat(id){
  if(!confirm('Delete this chat?'))return;
  state.conversations=state.conversations.filter(c=>c.id!==id);
  if(activeId===id)activeId='';
  prune();renderAll();save();
}
function newChat(){
  if(active().messages.length){const c=blankChat();state.conversations.push(c);activeId=c.id;}
  prune();showView('chat');closeOnMobile();renderAll();save();
}

/* ---------- tasks / last 7 days ---------- */
/* ---------- calendar ---------- */
let shown=new Date(), selected=new Date();
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const tasksFor=day=>{const isToday=sameDay(day,new Date());return state.tasks.filter(t=>t.dueAt?sameDay(new Date(t.dueAt),day):(t.routine||isToday));};
function renderCalendar(){
  const y=shown.getFullYear(),m=shown.getMonth(),first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),today=new Date();
  $('#calTitle').textContent=shown.toLocaleDateString([],{month:'long',year:'numeric'});
  let html='';for(let i=0;i<first;i++)html+='<span></span>';
  for(let d=1;d<=days;d++){const day=new Date(y,m,d),has=state.tasks.some(t=>t.dueAt&&sameDay(new Date(t.dueAt),day));
    html+='<button type="button" class="cal-day'+(sameDay(day,today)?' today':'')+(sameDay(day,selected)?' selected':'')+'" data-d="'+d+'">'+d+(has?'<i class="dot"></i>':'')+'</button>';}
  $('#calGrid').innerHTML=html;
  $$('#calGrid .cal-day').forEach(b=>b.onclick=()=>{selected=new Date(y,m,+b.dataset.d);renderTasks();});
}
$('#calPrev').onclick=()=>{shown=new Date(shown.getFullYear(),shown.getMonth()-1,1);renderCalendar();};
$('#calNext').onclick=()=>{shown=new Date(shown.getFullYear(),shown.getMonth()+1,1);renderCalendar();};
function renderTasks(){const target=$('#tasks'),list=tasksFor(selected);$('#dayTitle').textContent=sameDay(selected,new Date())?'Today':selected.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});target.innerHTML=list.length?list.map(t=>'<label class="task '+(t.completed?'done':'')+'"><input type="checkbox" '+(t.completed?'checked':'')+' data-id="'+t.id+'"><span>'+escape(t.title)+'</span><small>'+(t.dueAt?new Date(t.dueAt).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}):t.routine?'Routine':'Anytime')+'</small></label>').join(''):'<p class="empty">Nothing is asking for you yet. That can be lovely.</p>';target.querySelectorAll('input').forEach(x=>x.onchange=async()=>{const task=await api('/api/tasks/'+x.dataset.id,{method:'PATCH',body:JSON.stringify({completed:x.checked})});Object.assign(state.tasks.find(t=>t.id===task.id),task);renderTasks();renderLast7Days();save();});renderCalendar();}
function renderLast7Days(){const target=$('#last7Days');if(!target)return;let html='';const maxChats=7;for(let i=6;i>=0;i--){let d=new Date();d.setDate(d.getDate()-i);let chats=state.conversations.filter(c=>{if(!c.createdAt||!c.messages.length)return false;let cd=new Date(c.createdAt);return cd.getFullYear()===d.getFullYear()&&cd.getMonth()===d.getMonth()&&cd.getDate()===d.getDate();}).length;html+='<div class="day-summary" title="'+d.toLocaleDateString()+' - '+chats+' chats"><span class="day-label">'+d.toLocaleDateString([],{weekday:'short'}).substring(0,1)+'</span><span class="day-bar" style="height:'+Math.round((chats/maxChats)*100)+'%"></span></div>';}target.innerHTML=html;}

/* ---------- views + sidebar ---------- */
let currentView='chat';
function showView(view){currentView=view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$$('.view').forEach(x=>x.classList.toggle('active',x.id===view));}
const mq=matchMedia('(max-width:760px)'), mobile=()=>mq.matches;
const setSidebar=open=>document.body.classList.toggle('sidebar-closed',!open);
const closeOnMobile=()=>{if(mobile())setSidebar(false);};

const clockEl=$('#clock');const tick=()=>{if(clockEl)clockEl.textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};tick();setInterval(tick,15000);
(()=>{if(/[?&]work=drive/.test(location.search)){history.replaceState(null,'',location.pathname);setTimeout(()=>setMode('work'),400);}})();
(()=>{const t=new URLSearchParams(location.search).get('token');if(t){authToken=t;try{localStorage.setItem(TOKEN_KEY,t);}catch(e){}history.replaceState(null,'',location.pathname);}})();
async function start(){
  const had=load();
  renderAuth();renderAll();
  await sync(!had);
}
async function sync(allowRemoteChats){
  try{
    const s=await api('/api/bootstrap');
    state.user=s.user||state.user;
    state.tasks=s.tasks||state.tasks;
    const remote=normalize(s.conversations).filter(c=>c.messages.length);
    if(allowRemoteChats&&remote.length){state.conversations=remote;activeId=remote[remote.length-1].id;}
    prune();
    if($('#displayName'))$('#displayName').value=state.user.displayName||'Friend';
    renderAuth();renderAll();save();
    if(/[?&]auth=google-ready/.test(location.search)){
      history.replaceState(null,'',location.pathname);
      if(state.user.email&&!account)setAccount({name:state.user.displayName,email:state.user.email});
    }
  }catch(e){if(e.status===401)forgetSession();console.warn(e);}
}

$('#newChatBtn').onclick=newChat;
$('#composer').onsubmit=async e=>{
  e.preventDefault();
  const input=$('#prompt'), typed=input.value.trim();if(!typed&&!pendingFiles.length)return;const files=pendingFiles;pendingFiles=[];renderTray();const {shown,payload}=buildMessage(typed,files);
  input.value='';input.style.height='auto';
  const chat=active();
  chat.messages.push({role:'user',text:shown});
  renderMessages();renderChatHistory();save();
  try{
    const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:payload,tier:$('#tier').value,effort:+$('#effort').value})});
    if(!r||!r.message)throw Error('empty');chat.messages.push(r.message);
  }catch(err){
    chat.messages.push({role:'companion',text:'I held onto your thought, but I couldn\'t respond just now. Please try again.'});
  }
  renderMessages();renderChatHistory();renderLast7Days();save();
};
$('#prompt').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';};

function speak(text){if(text&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}}
$('#voice').onclick=()=>{let R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){$('#listening').textContent='Voice input is not available in this browser.';return;}let recognition=new R();recognition.lang=navigator.language;recognition.interimResults=true;$('#listening').textContent='Listening…';recognition.onresult=e=>{$('#prompt').value=[...e.results].map(r=>r[0].transcript).join(' ');};recognition.onend=()=>$('#listening').textContent='';recognition.start();};

$('#newTask').onclick=()=>{const d=new Date(selected),now=new Date(),p=n=>String(n).padStart(2,'0');d.setHours(sameDay(selected,now)?Math.min(now.getHours()+1,23):9,0,0,0);$('#taskDate').value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':00';$('#taskDialog').showModal();};
$('#taskForm').onsubmit=async e=>{e.preventDefault();let task=await api('/api/tasks',{method:'POST',body:JSON.stringify({title:$('#taskTitle').value,dueAt:$('#taskDate').value||null,routine:$('#routine').checked})});state.tasks.push(task);e.target.reset();$('#taskDialog').close();renderTasks();renderLast7Days();save();};

$$('[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.view==='settings'){openSettings();return;}showView(b.dataset.view);closeOnMobile();});

$$('.font-choice').forEach(b=>b.onclick=()=>setPref('font',b.dataset.font));
$$('.size-choice').forEach(b=>b.onclick=()=>setPref('size',b.dataset.size));
$('#glowToggle').onchange=e=>setPref('glow',e.target.checked);$('#dataCollection').onchange=e=>setPref('analytics',e.target.checked);$('#shareInsights').onchange=e=>setPref('insights',e.target.checked);

$$('.tab-btn').forEach(btn=>btn.onclick=()=>{let tab=btn.dataset.tab;$$('.tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');$$('.tab-content').forEach(c=>c.classList.remove('active'));$('#tab-'+tab).classList.add('active');});

$('#exportData').onclick=()=>{let data={conversations:state.conversations,tasks:state.tasks,user:state.user,timestamp:new Date().toISOString()};let blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download='daily-life-export-'+new Date().getTime()+'.json';a.click();URL.revokeObjectURL(url);};
$('#importData').onclick=()=>{let input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=e=>{let file=e.target.files[0];if(!file)return;let reader=new FileReader();reader.onload=evt=>{try{let imported=JSON.parse(evt.target.result);if(imported.conversations){state.conversations=normalize(imported.conversations);activeId=state.conversations.length?state.conversations[state.conversations.length-1].id:'';}state.tasks=imported.tasks||state.tasks;state.user=imported.user||state.user;prune();renderAll();save();alert('Data imported successfully!');}catch(err){alert('Failed to import data: '+err.message);}};reader.readAsText(file);};input.click();};
$('#deleteData').onclick=()=>{if(confirm('Are you sure? This will permanently delete all your data.')){state={user:{displayName:'Friend',streak:1},conversations:[blankChat()],tasks:[]};activeId=state.conversations[0].id;try{localStorage.removeItem(KEY);}catch(e){}renderAll();alert('All data deleted.');}};
$('#updateProfile').onclick=async()=>{
  const name=$('#displayName').value.trim()||'Friend',note=$('#saveNote');
  state.user.displayName=name;save();renderAuth();
  try{const u=await api('/api/user',{method:'PATCH',body:JSON.stringify({displayName:name})});if(u&&u.displayName)state.user={...state.user,...u};save();note.textContent='Saved ✓';}
  catch(e){note.textContent='Saved on this phone ✓';}
  setTimeout(()=>{note.textContent='';},2500);
};
$$('.close').forEach(btn=>btn.onclick=e=>{const d=e.target.closest('dialog');if(d)d.close();});
/* ---------- log in / sign up gate ---------- */
const ALLOW_GUEST=true; // set false to remove the "Continue as guest" link
// Web client ID from Google Cloud (Credentials > OAuth client ID > Web application). Same value as serverClientId in capacitor.config.
const GOOGLE_WEB_CLIENT_ID='545590780255-ie9s93forogb6fpt34u7v0rocb51fudt.apps.googleusercontent.com';
let account=null, guest=false, authMode='login';
try{account=JSON.parse(localStorage.getItem('dailylife_account')||'null');}catch(e){}
const isNative=()=>!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
const googleAuth=()=>window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.GoogleAuth;
const authError=msg=>{$('#authError').textContent=msg||'';};
function renderAuth(){
  const who=account; // only a login on THIS device counts (the server keeps one shared profile)
  document.body.classList.toggle('locked',!who&&!guest);
  if($('#accountBtn'))$('#accountBtn').textContent=who?'Sign out':'Log in / Sign up';
  if($('#userEmail'))$('#userEmail').value=(who&&who.email)||'';
  const nm=(state.user.displayName&&state.user.displayName!=='Friend')?state.user.displayName:((who&&who.name)||state.user.displayName||'Friend');
  if($('#avatar'))$('#avatar').textContent=(nm.trim()[0]||'F').toUpperCase();
  if($('#profileName'))$('#profileName').textContent=nm;
  if($('#profileEmail'))$('#profileEmail').textContent=(who&&who.email)||'Not signed in';
  $('#guestBtn').hidden=!ALLOW_GUEST;
}
function setAccount(a){
  account=a;try{localStorage.setItem('dailylife_account',JSON.stringify(a));}catch(e){}
  if(a.name&&(!state.user.displayName||state.user.displayName==='Friend')){state.user.displayName=a.name;if($('#displayName'))$('#displayName').value=a.name;}
  guest=false;authError('');$('#authForm').reset();save();renderAuth();showView('chat');closeOnMobile();sync(false);
}
async function googleSignIn(){
  authError('');
  if(!isNative()){window.location.href=API_BASE+'/api/auth/google';return;} // website
  const G=googleAuth();
  if(!G){authError("Google sign-in isn't included in this build. Use email instead.");return;}
  try{
    try{await G.initialize({clientId:GOOGLE_WEB_CLIENT_ID||undefined,scopes:['profile','email'],grantOfflineAccess:false});}catch(e){}
    const u=await G.signIn();
    setAccount({name:u.name||u.givenName||'',email:u.email||'',imageUrl:u.imageUrl||''});
  }catch(e){
    const m=String((e&&(e.message||e.error))||e||'');
    authError(/12501|cancel/i.test(m)?'Sign-in was cancelled.':/\b10\b|developer/i.test(m)?"Google setup doesn't match this app yet (package name or SHA-1 in Google Cloud). Use email for now.":'Google sign-in failed'+(m?': '+m:'.')+' You can use email instead.');
  }
}
async function signOut(){
  if(!confirm('Sign out? Your chats and tasks stay saved to your account.'))return;
  try{const G=googleAuth();if(G)await G.signOut();}catch(e){}
  $('#settingsDialog').close();
  forgetSession();showView('chat');
}
function setAuthMode(m){authMode=m;authError('');$('#authCode').value='';setStage('email');}
$('#authGoogle').onclick=googleSignIn;
$('#guestBtn').onclick=()=>{guest=true;renderAuth();};
/* ---------- email code sign in (accounts live on the server) ---------- */
let otpStage='email', otpEmail='', otpName='';
const friendly=ex=>{const m=String((ex&&ex.message)||'');if(!(ex&&ex.status)&&/fetch|Failed|NetworkError|Load failed/i.test(m))return "Can't reach the server right now. Check your connection and try again.";return m||'Something went wrong. Please try again.';};
function setStage(stage){
  otpStage=stage;const code=stage==='code';
  $('#authCode').hidden=!code;$('#authBack').hidden=!code;$('#authEmail').readOnly=code;
  $('#authSubmit').textContent=code?'Verify and continue':'Continue';
  if(code)setTimeout(()=>$('#authCode').focus(),50);
}
function forgetSession(){
  authToken=null;account=null;guest=false;
  try{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem('dailylife_account');}catch(e){}
  state.conversations=[blankChat()];activeId=state.conversations[0].id;state.tasks=[];state.user={displayName:'Friend',streak:1};
  save();renderAuth();renderAll();setStage('email');
}
const authBackBtn=$('#authBack');if(authBackBtn)authBackBtn.onclick=()=>{$('#authCode').value='';authError('');setStage('email');};
$('#authForm').onsubmit=async e=>{
  e.preventDefault();authError('');
  const btn=$('#authSubmit');btn.disabled=true;
  try{
    if(otpStage==='email'){
      const email=$('#authEmail').value.trim().toLowerCase(), name='';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');
      await api('/api/auth/otp/request',{method:'POST',body:JSON.stringify({email})});
      otpEmail=email;otpName=name;$('#authCode').value='';setStage('code');
    }else{
      const code=$('#authCode').value.trim();
      if(!/^\d{6}$/.test(code))throw Error('Enter the 6-digit code from the email.');
      const r=await api('/api/auth/otp/verify',{method:'POST',body:JSON.stringify({email:otpEmail,code,name:otpName})});
      authToken=r.token;try{localStorage.setItem(TOKEN_KEY,r.token);}catch(x){}
      state.conversations=[blankChat()];activeId=state.conversations[0].id;state.tasks=[];
      setAccount({name:r.user.displayName||otpName||otpEmail.split('@')[0],email:r.user.email||otpEmail});
      await sync(true);
      setStage('email');
    }
  }catch(ex){authError(friendly(ex));}
  btn.disabled=false;
};
$('#accountBtn').onclick=()=>{if(account)signOut();else{$('#settingsDialog').close();guest=false;renderAuth();}};
// logo copy for the gate (own gradient id so it renders even when the hero is hidden)
(()=>{const l=document.querySelector('.hero .logo');if(l)$('#authLogo').innerHTML=l.outerHTML.replace(/id="lg"/g,'id="lg2"').replace(/#lg\)/g,'#lg2)');})();

/* ---------- sidebar + chatbox shrinking ---------- */
setSidebar(!mobile());
$('#sidebarToggle').onclick=()=>setSidebar(document.body.classList.contains('sidebar-closed'));
$('#sidebarOpen').onclick=()=>setSidebar(true);
$('#backdrop').onclick=()=>setSidebar(false);
mq.addEventListener('change',()=>setSidebar(!mobile()));

/* ---------- settings popup + preferences ---------- */
const PREFS_KEY='dailylife_prefs';
let prefs={font:'sans',size:'m',glow:true,analytics:true,insights:true,tier:'breathe',effort:45,plan:'free'};
try{Object.assign(prefs,JSON.parse(localStorage.getItem(PREFS_KEY)||'{}'));}catch(e){}
function applyPrefs(){
  document.body.dataset.font=prefs.font;
  document.documentElement.style.setProperty('--msg-size',{s:'14px',m:'15px',l:'17px'}[prefs.size]||'15px');
  document.body.classList.toggle('no-glow',!prefs.glow);
  $$('.font-choice').forEach(b=>b.classList.toggle('selected',b.dataset.font===prefs.font));
  $$('.size-choice').forEach(b=>b.classList.toggle('selected',b.dataset.size===prefs.size));
  $('#glowToggle').checked=prefs.glow;$('#dataCollection').checked=prefs.analytics;$('#shareInsights').checked=prefs.insights;
  if(!canUse(prefs.tier))prefs.tier='breathe';
  $('#tier').value=prefs.tier;$('#effort').value=prefs.effort;renderPill();
  if($('#currentPlan'))$('#currentPlan').textContent=PLAN_NAME[prefs.plan||'free'];
  $$('#planSeg button').forEach(b=>b.classList.toggle('selected',b.dataset.plan===(prefs.plan||'free')));
  dispatchEvent(new Event('dl-glow'));
}
function setPref(k,v){prefs[k]=v;try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));}catch(e){}applyPrefs();}
/* ---------- model / effort / + popups (anchored above the bar) ---------- */
const MODELS=[['breathe','Breathe','#a78bfa'],['tide','Tide','#38bdf8'],['echo','Echo','#34d399'],['orbit','Orbit','#fb923c'],['seed','Seed','#f472b6']];
const MODEL_PLAN={breathe:'free',tide:'free',echo:'free',orbit:'pro',seed:'max'};
const PLAN_RANK={free:0,pro:1,max:2};
const PLAN_NAME={free:'Free',pro:'Pro',max:'Max'};
const canUse=id=>(PLAN_RANK[prefs.plan||'free']||0)>=PLAN_RANK[MODEL_PLAN[id]];
const EFFORTS=[['Light',15,''],['Balanced',45,'Recommended'],['Deep',75,''],['Max',100,'Longest replies']];
const CHECK='<svg class="chk" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV='<svg class="cv" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const modelMenu=$('#modelMenu'),effortMenu=$('#effortMenu'),plusMenu=$('#plusMenu'),allMenus=[modelMenu,effortMenu,plusMenu];
const modelInfo=()=>MODELS.find(m=>m[0]===prefs.tier)||MODELS[0];
const effortInfo=()=>EFFORTS.find(e=>e[1]===prefs.effort)||EFFORTS[1];
function renderPill(){
  $('#modelLabel').textContent=modelInfo()[1];$('#modelDot').style.background=modelInfo()[2];$('#effortLabel').textContent=effortInfo()[0];
  modelMenu.innerHTML=MODELS.map(m=>{const ok=canUse(m[0]);return '<button type="button" class="mi'+(ok?'':' locked')+'" role="menuitemradio" aria-checked="'+(m[0]===prefs.tier)+'" aria-disabled="'+(!ok)+'" data-model="'+m[0]+'"><i class="dot" style="background:'+m[2]+'"></i><span>'+m[1]+'</span>'+(ok?'':'<em class="need">'+PLAN_NAME[MODEL_PLAN[m[0]]]+'</em><svg class="lk" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>')+CHECK+'</button>';}).join('')+'<div class="msep"></div><button type="button" class="mi" id="effortRow" aria-haspopup="menu"><span>Effort</span><em>'+effortInfo()[0]+'</em>'+CHEV+'</button>';
  effortMenu.innerHTML='<button type="button" class="mback" id="effortBack">‹ Back</button><p class="mhint">Higher effort gives longer, more thorough replies, but they take more time.</p>'+EFFORTS.map(e=>'<button type="button" class="mi" role="menuitemradio" aria-checked="'+(e[1]===prefs.effort)+'" data-effort="'+e[1]+'"><span>'+e[0]+'</span>'+(e[2]?'<small class="tag">'+e[2]+'</small>':'')+CHECK+'</button>').join('');
  plusMenu.innerHTML='<button type="button" class="mi" data-act="files"><span class="ic">📎</span><span>Add files</span></button><button type="button" class="mi" data-act="chat"><span class="ic">✏</span><span>New chat</span></button><button type="button" class="mi" data-act="task"><span class="ic">🗓</span><span>Add a task</span></button><button type="button" class="mi" data-act="voice"><span class="ic">🎙</span><span>Voice input</span></button>';
}
function closeMenus(){allMenus.forEach(m=>{m.hidden=true;m.classList.remove('drill');});$('#modelBtn').setAttribute('aria-expanded','false');}
function placeMenu(menu,anchor,align){
  menu.hidden=false;const r=anchor.getBoundingClientRect();
  menu.style.top='auto';menu.style.bottom=(innerHeight-r.top+10)+'px';
  if(align==='right'){menu.style.right=Math.max(12,innerWidth-r.right)+'px';menu.style.left='auto';}
  else{menu.style.left=Math.max(12,r.left)+'px';menu.style.right='auto';}
}
function showEffort(){
  const mr=modelMenu.getBoundingClientRect();effortMenu.hidden=false;const w=effortMenu.offsetWidth;
  effortMenu.style.top='auto';effortMenu.style.bottom=modelMenu.style.bottom;effortMenu.style.left='auto';
  if(mr.left-8-w>=12){effortMenu.classList.remove('drill');effortMenu.style.right=(innerWidth-mr.left+8)+'px';} // beside the model list
  else{effortMenu.classList.add('drill');effortMenu.style.right=modelMenu.style.right;modelMenu.hidden=true;} // small screens: replaces it
}
$('#modelBtn').onclick=()=>{const open=!modelMenu.hidden||!effortMenu.hidden;closeMenus();if(!open){placeMenu(modelMenu,$('#modelBtn'),'right');$('#modelBtn').setAttribute('aria-expanded','true');}};
$('#plusBtn').onclick=()=>{const open=!plusMenu.hidden;closeMenus();if(!open)placeMenu(plusMenu,$('#plusBtn'),'left');};
modelMenu.addEventListener('click',e=>{
  const m=e.target.closest('[data-model]');if(m){
    if(!canUse(m.dataset.model)){alert(MODELS.find(x=>x[0]===m.dataset.model)[1]+' needs the '+PLAN_NAME[MODEL_PLAN[m.dataset.model]]+' plan. You can change your plan in Settings > Billing.');return;}
    setPref('tier',m.dataset.model);closeMenus();return;}
  if(e.target.closest('#effortRow'))showEffort();
});
effortMenu.addEventListener('click',e=>{
  const v=e.target.closest('[data-effort]');if(v){setPref('effort',+v.dataset.effort);closeMenus();return;}
  if(e.target.closest('#effortBack')){effortMenu.hidden=true;effortMenu.classList.remove('drill');modelMenu.hidden=false;}
});
plusMenu.addEventListener('click',e=>{
  const a=e.target.closest('[data-act]');if(!a)return;closeMenus();
  if(a.dataset.act==='chat')newChat();else if(a.dataset.act==='task')$('#newTask').click();else if(a.dataset.act==='files')$('#fileInput').click();else $('#voice').click();
});
document.addEventListener('pointerdown',e=>{if(allMenus.every(m=>m.hidden))return;if(e.target.closest('.menu,#plusBtn,#modelBtn'))return;closeMenus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus();});
addEventListener('resize',closeMenus);
/* ---------- attachments ---------- */
const fmtSize=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const TEXTY=/^text\/|json|javascript|xml|csv/;
const TEXT_EXT=/\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|py|java|kt|xml|yml|yaml|log|c|cpp|h|go|rs|sql)$/i;
$('#fileInput').onchange=async e=>{
  for(const f of e.target.files){
    if(pendingFiles.length>=8){alert('You can attach up to 8 files at a time.');break;}
    const item={name:f.name,size:f.size,text:null};
    if(f.size>2*1048576){item.note='too large to read (2 MB max)';}
    else if(TEXTY.test(f.type)||TEXT_EXT.test(f.name)){item.text=(await f.text()).slice(0,20000);}
    pendingFiles.push(item);
  }
  e.target.value='';renderTray();
};
function renderTray(){
  const t=$('#attachTray');t.hidden=!pendingFiles.length;
  t.innerHTML=pendingFiles.map((f,i)=>'<span class="chip" title="'+escape(f.name)+'"><span class="chip-name">'+escape(f.name)+'</span><small>'+(f.note?escape(f.note):fmtSize(f.size))+'</small><button type="button" data-i="'+i+'" aria-label="Remove '+escape(f.name)+'">×</button></span>').join('');
  t.querySelectorAll('button').forEach(b=>b.onclick=()=>{pendingFiles.splice(+b.dataset.i,1);renderTray();});
}
function buildMessage(typed,files){
  const shown=[typed,...files.map(f=>'📎 '+f.name)].filter(Boolean).join('\n');
  const readable=files.filter(f=>f.text!==null).map(f=>'--- File: '+f.name+' ---\n'+f.text);
  const unreadable=files.filter(f=>f.text===null).map(f=>'[Attached file: '+f.name+(f.note?' ('+f.note+')':'')+'. Contents not read.]');
  const payload=[typed||'Please look at the attached file(s).',...unreadable,...readable].join('\n\n');
  return {shown,payload};
}
/* ---------- Chat / Work + connectors ---------- */
function setMode(m){
  showView(m==='work'?'work':'chat');
  $$('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  if(m==='work')refreshWork();
}
$$('.mode-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
async function refreshWork(){
  const note=$('#driveNote'),btn=$('#driveBtn'),list=$('#driveFiles');
  if(!authToken){note.textContent='Log in to connect your Google Drive.';btn.hidden=true;list.innerHTML='';return;}
  btn.hidden=false;
  let st={connected:false};try{st=await api('/api/drive/status');}catch(e){}
  if(!st.connected){note.textContent='Not connected';btn.textContent='Connect';btn.dataset.act='connect';list.innerHTML='';return;}
  note.textContent='Connected · read-only';btn.textContent='Disconnect';btn.dataset.act='disconnect';
  try{
    const r=await api('/api/drive/files');
    list.innerHTML=r.files.length?r.files.map(f=>'<button type="button" class="file-row" data-id="'+escape(f.id)+'"><span>'+escape(f.name)+'</span><small>'+new Date(f.modifiedTime).toLocaleDateString()+'</small></button>').join(''):'<p class="sb-empty">No files found in your Drive.</p>';
    list.querySelectorAll('.file-row').forEach(b=>b.onclick=()=>attachDriveFile(b.dataset.id));
  }catch(e){list.innerHTML='<p class="auth-error">'+escape(friendly(e))+'</p>';}
}
$('#driveBtn').onclick=async()=>{
  if($('#driveBtn').dataset.act==='connect'){window.location.href=API_BASE+'/api/drive/connect?token='+encodeURIComponent(authToken);return;}
  try{await api('/api/drive/disconnect',{method:'POST'});}catch(e){alert(friendly(e));}
  refreshWork();
};
async function attachDriveFile(id){
  try{
    const f=await api('/api/drive/file?id='+encodeURIComponent(id));
    pendingFiles.push({name:f.name,size:(f.text||'').length,text:f.text});
    renderTray();setMode('chat');$('#prompt').focus();
  }catch(e){alert(friendly(e));}
}
const sdlg=$('#settingsDialog');
function syncNav(){$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===(sdlg.open?'settings':currentView)));}
function openSettings(){renderAuth();$$('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab==='profile'));$$('.tab-content').forEach(c=>c.classList.toggle('active',c.id==='tab-profile'));sdlg.showModal();syncNav();}
sdlg.addEventListener('click',e=>{if(e.target===sdlg)sdlg.close();});
sdlg.addEventListener('close',syncNav);
$$('#planSeg button').forEach(b=>b.onclick=()=>setPref('plan',b.dataset.plan));
applyPrefs();
start();

/* ---------- background that follows your finger / cursor ---------- */
(()=>{
  const cv=$('#ambient');if(!cv)return;
  const ctx=cv.getContext&&cv.getContext('2d');if(!ctx)return;
  const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W=0,H=0,raf=0;const t0=performance.now();
  const P={x:innerWidth/2,y:innerHeight*.4,tx:innerWidth/2,ty:innerHeight*.4,x2:innerWidth/2,y2:innerHeight*.4,power:.55,last:0};
  function size(){const dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  const move=(x,y)=>{P.tx=x;P.ty=y;P.last=performance.now();};
  addEventListener('pointermove',e=>move(e.clientX,e.clientY),{passive:true});
  addEventListener('pointerdown',e=>move(e.clientX,e.clientY),{passive:true});
  const touch=e=>{const t=e.touches[0];if(t)move(t.clientX,t.clientY);};
  addEventListener('touchstart',touch,{passive:true});addEventListener('touchmove',touch,{passive:true});
  addEventListener('resize',()=>{size();if(still)frame(performance.now());});
  function glow(x,y,r,rgb,a){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba('+rgb+','+a+')');g.addColorStop(1,'rgba('+rgb+',0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
  const stopped=()=>document.body.classList.contains('no-glow');
  function frame(now){
    if(stopped()){ctx.clearRect(0,0,W,H);return;}
    const idle=now-P.last>3500;
    if(idle&&!still){const t=(now-t0)/1000;P.tx=W*(.5+.28*Math.sin(t*.35));P.ty=H*(.42+.2*Math.cos(t*.27));}
    P.x+=(P.tx-P.x)*.14;P.y+=(P.ty-P.y)*.14;
    P.x2+=(P.tx-P.x2)*.05;P.y2+=(P.ty-P.y2)*.05;
    P.power+=((idle?.55:1)-P.power)*.05;
    const s=Math.min(W,H)<600?.75:1;
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    glow(P.x2,P.y2,430*s,'120,90,255',.17*P.power);
    glow(P.x,P.y,250*s,'31,168,216',.28*P.power);
    // dot grid: faint everywhere, bright near the pointer
    const gap=30,R=170*s;
    ctx.fillStyle='rgba(170,210,255,.05)';
    for(let y=gap/2;y<H;y+=gap)for(let x=gap/2;x<W;x+=gap)ctx.fillRect(x-.6,y-.6,1.2,1.2);
    const x0=Math.max(0,Math.floor((P.x-R)/gap)),x1=Math.ceil((P.x+R)/gap),y0=Math.max(0,Math.floor((P.y-R)/gap)),y1=Math.ceil((P.y+R)/gap);
    for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){
      const x=gap/2+i*gap,y=gap/2+j*gap,d=Math.hypot(x-P.x,y-P.y);if(d>=R)continue;
      const f=1-d/R,a=.5*f*f*P.power,sz=1.2+1.8*f;
      ctx.fillStyle='rgba(170,210,255,'+a.toFixed(3)+')';ctx.fillRect(x-sz/2,y-sz/2,sz,sz);
    }
    if(!still)document.documentElement.style.setProperty('--px',((P.x/W)-.5).toFixed(3));
    if(!still&&!document.hidden)raf=requestAnimationFrame(frame);
  }
  addEventListener('dl-glow',()=>{cancelAnimationFrame(raf);if(!still)raf=requestAnimationFrame(frame);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!still){cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);}});
  size();raf=requestAnimationFrame(frame);
})();
