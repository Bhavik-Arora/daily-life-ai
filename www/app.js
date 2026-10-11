const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// APK ONLY: set this to your deployed server URL (no trailing slash), e.g. 'https://your-app.onrender.com'. Keep '' for the website.
const API_BASE='';
const KEY='dailylife_v1';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const blankChat=()=>({id:uid(),createdAt:new Date().toISOString(),messages:[]});
const normalize=list=>(Array.isArray(list)?list:[]).map(c=>({...c,id:String(c.id||uid()),messages:Array.isArray(c.messages)?c.messages:[]}));
let state={user:{displayName:'Friend',streak:1},conversations:[blankChat()],tasks:[]};
let activeId=state.conversations[0].id;
const active=()=>state.conversations.find(c=>c.id===activeId)||state.conversations[0];
const api=(path,options={})=>fetch(API_BASE+path,{headers:{'Content-Type':'application/json'},...options}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data});
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
function renderMessages(){
  const box=$('#messages'), msgs=active().messages;
  $('#chat').classList.toggle('has-messages',msgs.length>0);
  box.innerHTML=msgs.length?msgs.map((m,i)=>'<div class="message '+m.role+'">'+escape(m.text)+(m.role==='companion'?'<button data-i="'+i+'" aria-label="Read aloud" title="Read aloud">◖</button>':'')+'</div>').join(''):'<p class="empty">Ready to chat?</p>';
  box.querySelectorAll('button[data-i]').forEach(b=>b.onclick=()=>speak(msgs[+b.dataset.i]?.text));
  scrollDown();
}
function renderChatHistory(){
  const target=$('#chatHistory');
  const list=state.conversations.filter(c=>c.messages.length||c.id===activeId).slice().reverse().slice(0,40);
  target.innerHTML=list.map(c=>{
    const first=c.messages.find(m=>m.role==='user')||c.messages[0], t=first?first.text:'New chat';
    return '<div class="chat-item'+(c.id===activeId?' active':'')+'" data-id="'+escape(c.id)+'"><span class="icon">💬</span><span class="title">'+escape(t.length>30?t.slice(0,30)+'…':t)+'</span><button type="button" class="chat-del" data-del="'+escape(c.id)+'" aria-label="Delete chat" title="Delete chat">×</button></div>';
  }).join('');
  target.querySelectorAll('.chat-item').forEach(el=>el.onclick=e=>{if(e.target.closest('.chat-del'))return;selectChat(el.dataset.id);});
  target.querySelectorAll('.chat-del').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteChat(b.dataset.del);});
}
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
function renderTasks(){const target=$('#tasks');target.innerHTML=state.tasks.length?state.tasks.map(t=>'<label class="task '+(t.completed?'done':'')+'"><input type="checkbox" '+(t.completed?'checked':'')+' data-id="'+t.id+'"><span>'+escape(t.title)+'</span><small>'+(t.dueAt?new Date(t.dueAt).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}):t.routine?'Routine':'Anytime')+'</small></label>').join(''):'<p class="empty">Nothing is asking for you yet. That can be lovely.</p>';target.querySelectorAll('input').forEach(x=>x.onchange=async()=>{const task=await api('/api/tasks/'+x.dataset.id,{method:'PATCH',body:JSON.stringify({completed:x.checked})});Object.assign(state.tasks.find(t=>t.id===task.id),task);renderTasks();renderLast7Days();save();});}
function renderLast7Days(){const target=$('#last7Days');let html='';const maxChats=7;for(let i=6;i>=0;i--){let d=new Date();d.setDate(d.getDate()-i);let chats=state.conversations.filter(c=>{if(!c.createdAt||!c.messages.length)return false;let cd=new Date(c.createdAt);return cd.getFullYear()===d.getFullYear()&&cd.getMonth()===d.getMonth()&&cd.getDate()===d.getDate();}).length;html+='<div class="day-summary" title="'+d.toLocaleDateString()+' - '+chats+' chats"><span class="day-label">'+d.toLocaleDateString([],{weekday:'short'}).substring(0,1)+'</span><span class="day-bar" style="height:'+Math.round((chats/maxChats)*100)+'%"></span></div>';}target.innerHTML=html;}
function setEffort(){let x=+$('#effort').value;let label=x<30?'Light':x<70?'Balanced':'Deep';$('#effortOut').textContent=label;$('#effortBtnOut').textContent=label;}

/* ---------- views + sidebar ---------- */
function showView(view){$$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$$('.view').forEach(x=>x.classList.toggle('active',x.id===view));}
const mq=matchMedia('(max-width:760px)'), mobile=()=>mq.matches;
const setSidebar=open=>document.body.classList.toggle('sidebar-closed',!open);
const closeOnMobile=()=>{if(mobile())setSidebar(false);};

async function start(){
  const had=load();
  renderAll();
  try{
    const s=await api('/api/bootstrap');
    state.user=s.user||state.user;
    state.tasks=s.tasks||state.tasks;
    const remote=normalize(s.conversations).filter(c=>c.messages.length);
    if(!had&&remote.length){state.conversations=remote;activeId=remote[remote.length-1].id;}
    prune();
    if($('#displayName'))$('#displayName').value=state.user.displayName||'Friend';
    if($('#userEmail'))$('#userEmail').value=state.user.email||'not@loggedin.yet';
    renderAll();save();
  }catch(e){console.warn(e);}
}

$('#newChatBtn').onclick=newChat;
$('#composer').onsubmit=async e=>{
  e.preventDefault();
  const input=$('#prompt'), message=input.value.trim();if(!message)return;
  input.value='';input.style.height='auto';
  const chat=active();
  chat.messages.push({role:'user',text:message});
  renderMessages();renderChatHistory();save();
  try{
    const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message,tier:$('#tier').value,effort:+$('#effort').value})});
    chat.messages.push(r.message);
  }catch(err){
    chat.messages.push({role:'companion',text:'I held onto your thought, but I couldn\'t respond just now. Please try again.'});
  }
  renderMessages();renderChatHistory();renderLast7Days();save();
};
$('#prompt').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';};
$('#effort').oninput=setEffort;setEffort();
$('#effortBtn').onclick=()=>$('#effortDialog').showModal();

function speak(text){if(text&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}}
$('#voice').onclick=()=>{let R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){$('#listening').textContent='Voice input is not available in this browser.';return;}let recognition=new R();recognition.lang=navigator.language;recognition.interimResults=true;$('#listening').textContent='Listening…';recognition.onresult=e=>{$('#prompt').value=[...e.results].map(r=>r[0].transcript).join(' ');};recognition.onend=()=>$('#listening').textContent='';recognition.start();};

$('#newTask').onclick=()=>$('#taskDialog').showModal();
$('#taskForm').onsubmit=async e=>{e.preventDefault();let task=await api('/api/tasks',{method:'POST',body:JSON.stringify({title:$('#taskTitle').value,dueAt:$('#taskDate').value||null,routine:$('#routine').checked})});state.tasks.push(task);e.target.reset();$('#taskDialog').close();renderTasks();renderLast7Days();save();};

$$('[data-view]').forEach(b=>b.onclick=()=>{showView(b.dataset.view);closeOnMobile();});
$('#backBtn').onclick=()=>showView('chat');
$$('.font-choice').forEach(button=>button.onclick=()=>{$$('.font-choice').forEach(x=>x.classList.remove('selected'));button.classList.add('selected');document.body.dataset.font=button.dataset.font;});
$$('.theme-choice').forEach(button=>button.onclick=()=>{$$('.theme-choice').forEach(x=>x.classList.remove('selected'));button.classList.add('selected');document.body.dataset.theme=button.dataset.theme;});
$$('.tab-btn').forEach(btn=>btn.onclick=()=>{let tab=btn.dataset.tab;$$('.tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');$$('.tab-content').forEach(c=>c.classList.remove('active'));$('#tab-'+tab).classList.add('active');});

$('#exportData').onclick=()=>{let data={conversations:state.conversations,tasks:state.tasks,user:state.user,timestamp:new Date().toISOString()};let blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download='daily-life-export-'+new Date().getTime()+'.json';a.click();URL.revokeObjectURL(url);};
$('#importData').onclick=()=>{let input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=e=>{let file=e.target.files[0];if(!file)return;let reader=new FileReader();reader.onload=evt=>{try{let imported=JSON.parse(evt.target.result);if(imported.conversations){state.conversations=normalize(imported.conversations);activeId=state.conversations.length?state.conversations[state.conversations.length-1].id:'';}state.tasks=imported.tasks||state.tasks;state.user=imported.user||state.user;prune();renderAll();save();alert('Data imported successfully!');}catch(err){alert('Failed to import data: '+err.message);}};reader.readAsText(file);};input.click();};
$('#deleteData').onclick=()=>{if(confirm('Are you sure? This will permanently delete all your data.')){state={user:{displayName:'Friend',streak:1},conversations:[blankChat()],tasks:[]};activeId=state.conversations[0].id;try{localStorage.removeItem(KEY);}catch(e){}renderAll();alert('All data deleted.');}};
$('#updateProfile').onclick=async()=>{try{const updated=await api('/api/user',{method:'PATCH',body:JSON.stringify({displayName:$('#displayName').value||'Friend'})});state.user=updated;save();alert('Profile updated!');}catch(e){alert('Failed to update profile: '+e.message);}};
$$('.close').forEach(btn=>btn.onclick=e=>{const d=e.target.closest('dialog');if(d)d.close();});
$$('.signin-btn').forEach(btn=>btn.onclick=()=>{window.location.href=API_BASE+'/api/auth/google';});

/* ---------- sidebar + chatbox shrinking ---------- */
setSidebar(!mobile());
$('#sidebarToggle').onclick=()=>setSidebar(document.body.classList.contains('sidebar-closed'));
$('#sidebarOpen').onclick=()=>setSidebar(true);
$('#backdrop').onclick=()=>setSidebar(false);
mq.addEventListener('change',()=>setSidebar(!mobile()));
const card=$('#composer');
if(mobile())card.classList.add('compact');
$('#cardToggle').onclick=()=>card.classList.toggle('compact');

start();
