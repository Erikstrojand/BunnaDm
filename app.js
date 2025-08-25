
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, getDocs,
  serverTimestamp, query, where, orderBy, onSnapshot, runTransaction, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyD-TN2KdPRueeZQScL-cIa2rRrRqZeyxug",
  authDomain: "chat-d95eb.firebaseapp.com",
  projectId: "chat-d95eb",
  storageBucket: "chat-d95eb.firebasestorage.app",
  messagingSenderId: "105518146991",
  appId: "1:105518146991:web:8f4990cbbf2e74e4257b5a"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);


const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const authScreen = $("#auth-screen");
const appScreen  = $("#app");

const tabs = $$(".tab");
const loginForm  = $("#login-form");
const signupForm = $("#signup-form");
const loginHandle = $("#login-handle");
const loginPassword = $("#login-password");
const signupHandle = $("#signup-handle");
const signupPassword = $("#signup-password");
const loginErr = $("#login-error");
const signupErr = $("#signup-error");

const meHandleEl = $("#me-handle");
const meIdEl     = $("#me-id");
const signoutBtn = $("#signout");

const startTo = $("#start-to");
const startBtn = $("#start-btn");
const startErr = $("#start-error");

const convoList = $("#convo-list");
const peerHandleEl = $("#peer-handle");
const peerIdEl     = $("#peer-id");
const messagesEl   = $("#messages");
const emptyState   = $("#empty-state");
const inputEl      = $("#message-input");
const sendBtn      = $("#send-btn");


let currentUser = null;
let currentUserDoc = null;
let convoUnsub = null;
let msgsUnsub  = null;
let activeConvo = null; 


const handlePattern = /^[a-zA-Z0-9_]{3,20}$/;
const emailFromHandle = (h) => `${h.toLowerCase()}@handles.chat`;

const tsToDate = (ts) => ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
const shortTime = (d) => {
  if(!d) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    : d.toLocaleDateString([], {month:'short', day:'numeric'});
};

const scrollToBottom = () => {
  messagesEl.scrollTop = messagesEl.scrollHeight;
};

const sanitizeHandle = (hRaw) => (hRaw || "").trim();
const normalizeHandle = (hRaw) => sanitizeHandle(hRaw).toLowerCase();


tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    tabs.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    loginForm.classList.toggle("show", tab === "login");
    signupForm.classList.toggle("show", tab === "signup");
  });
});


signupForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  signupErr.textContent = "";
  let handle = sanitizeHandle(signupHandle.value);
  const pass = signupPassword.value;

  if(!handlePattern.test(handle)){
    signupErr.textContent = "Handle must be 3–20 chars (letters, numbers, underscore).";
    return;
  }
  const email = emailFromHandle(handle);

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    
    await updateProfile(cred.user, { displayName: handle });
    const userRef = doc(db, "users", cred.user.uid);
    await setDoc(userRef, {
      uid: cred.user.uid,
      handle: handle,              
      handleLower: handle.toLowerCase(),
      createdAt: serverTimestamp()
    });

  }catch(err){
    if (String(err?.code).includes("auth/email-already-in-use")){
      signupErr.textContent = "This @handle is already taken. Try another.";
    } else if (String(err?.code).includes("auth/weak-password")){
      signupErr.textContent = "Password should be at least 6 characters.";
    } else {
      signupErr.textContent = err.message || "Could not sign up.";
    }
  }
});

loginForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  loginErr.textContent = "";
  let handle = sanitizeHandle(loginHandle.value);
  const pass = loginPassword.value;

  if(!handlePattern.test(handle)){
    loginErr.textContent = "Invalid handle format.";
    return;
  }
  const email = emailFromHandle(handle);

  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(err){
    if (String(err?.code).includes("auth/user-not-found")){
      loginErr.textContent = "No such @handle. Sign up first?";
    } else if (String(err?.code).includes("auth/wrong-password")){
      loginErr.textContent = "Wrong password.";
    } else {
      loginErr.textContent = err.message || "Login failed.";
    }
  }
});

signoutBtn.addEventListener("click", async ()=>{
  try{
    await signOut(auth);
  }catch(e){}
});


startBtn.addEventListener("click", startChat);
startTo.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){ e.preventDefault(); startChat(); }
});

async function startChat(){
  startErr.textContent = "";
  const targetRaw = sanitizeHandle(startTo.value);
  if(!handlePattern.test(targetRaw)){
    startErr.textContent = "Enter a valid handle (letters/numbers/underscore).";
    return;
  }
  const target = normalizeHandle(targetRaw);
  const meLower = (currentUserDoc?.handleLower || "").toLowerCase();

  if(target === meLower){
    startErr.textContent = "You can't DM yourself 😅";
    return;
  }

  
  const q = query(collection(db, "users"), where("handleLower", "==", target), limit(1));
  const snap = await getDocs(q);
  if(snap.empty){
    startErr.textContent = "No user with that @handle.";
    return;
  }
  const peer = snap.docs[0].data(); 

  await openOrCreateConversation(peer);
  startTo.value = "";
}

function convoIdFor(a, b){
  return [a, b].sort().join("_");
}

async function openOrCreateConversation(peer){
  const me = currentUser.uid;
  const id = convoIdFor(me, peer.uid);
  const ref = doc(db, "conversations", id);

  
  await setDoc(ref, {
    id,
    members: [me, peer.uid],
    memberHandles: { [me]: currentUserDoc.handle, [peer.uid]: peer.handle },
    createdAt: serverTimestamp(),
    lastMessage: "",
    lastMessageAt: serverTimestamp()
  }, { merge: true }); 

  setActiveConversation({ id, members:[me, peer.uid], peer: { uid: peer.uid, handle: peer.handle } });
}

function watchConversations(){
  if(convoUnsub) convoUnsub();

  
  const qConvos = query(
    collection(db, "conversations"),
    where("members", "array-contains", currentUser.uid),
    orderBy("lastMessageAt", "desc")
  );

  convoUnsub = onSnapshot(qConvos, async (snap)=>{
    const items = [];
    for (const docSnap of snap.docs){
      const c = docSnap.data();
      const peerUid = c.members.find(u => u !== currentUser.uid);
      const peerHandle = c.memberHandles?.[peerUid] || "unknown";

      items.push({
        id: c.id,
        peerUid,
        peerHandle,
        lastMessage: c.lastMessage || "",
        lastMessageAt: tsToDate(c.lastMessageAt)
      });
    }
    renderConvoList(items);
  });
}

function renderConvoList(items){
  convoList.innerHTML = "";
  if(items.length === 0){
    const p = document.createElement("p");
    p.className = "hint";
    p.style.margin = "8px 12px 18px";
    p.textContent = "No chats yet. Start one!";
    convoList.appendChild(p);
    return;
  }

  items.forEach(item=>{
    const el = document.createElement("div");
    el.className = "convo" + (activeConvo?.id === item.id ? " active" : "");
    el.innerHTML = `
      <div class="avatar">💬</div>
      <div class="meta" style="flex:1;min-width:0">
        <div class="top">
          <div class="name">@${item.peerHandle}</div>
          <div class="time">${shortTime(item.lastMessageAt)}</div>
        </div>
        <div class="last">${item.lastMessage || ""}</div>
      </div>
    `;
    el.addEventListener("click", async ()=>{
      
      const peer = { uid: item.peerUid, handle: item.peerHandle };
      setActiveConversation({ id: item.id, members:[currentUser.uid, item.peerUid], peer });
      
      [...convoList.children].forEach(c=>c.classList.remove("active"));
      el.classList.add("active");
    });
    convoList.appendChild(el);
  });
}


function setActiveConversation(c){
  activeConvo = c;
  peerHandleEl.textContent = c?.peer?.handle ? `@${c.peer.handle}` : "Select a chat";
  peerIdEl.textContent = c?.peer?.uid || "";

  // i hate my life
  if(msgsUnsub) msgsUnsub();
  messagesEl.innerHTML = "";
  emptyState.style.display = c ? "none" : "grid";

  if(!c) return;

  const msgsRef = collection(db, "conversations", c.id, "messages");
  const qMsgs = query(msgsRef, orderBy("createdAt", "asc"));

  msgsUnsub = onSnapshot(qMsgs, (snap)=>{
    messagesEl.innerHTML = "";
    snap.forEach(s=>{
      const m = s.data();
      renderMessage(m);
    });
    scrollToBottom();
  });
}

function renderMessage(m){
  const row = document.createElement("div");
  const isMe = m.sender === currentUser.uid;
  row.className = "msg-row " + (isMe ? "me" : "them");
  const time = shortTime(tsToDate(m.createdAt));

  row.innerHTML = `
    <div class="msg ${isMe ? "me" : "them"}">
      <span class="bubble">${escapeHtml(m.text || "")}</span>
    </div>
    <div class="msg-meta">
      ${isMe ? "You" : "Them"} • ${time}
    </div>
  `;

  messagesEl.appendChild(row);
}

function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e)=>{
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage(){
  const text = (inputEl.value || "").trim();
  if(!text || !activeConvo) return;

  const msgsRef = collection(db, "conversations", activeConvo.id, "messages");
  const payload = {
    text,
    sender: currentUser.uid,
    createdAt: serverTimestamp()
  };

  inputEl.value = "";
  inputEl.style.height = "auto";

  await addDoc(msgsRef, payload);
  
  const convoRef = doc(db, "conversations", activeConvo.id);
  await updateDoc(convoRef, {
    lastMessage: text,
    lastMessageAt: serverTimestamp()
  });
}


inputEl.addEventListener("input", ()=>{
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 320) + "px";
});


onAuthStateChanged(auth, async (user)=>{
  currentUser = user || null;

  if(!user){
    
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    meHandleEl.textContent = "@you";
    meIdEl.textContent = "";
    setActiveConversation(null);
    if(convoUnsub) convoUnsub();
    return;
  }

  
  const uref = doc(db, "users", user.uid);
  const usnap = await getDoc(uref);
  if(!usnap.exists()){
    const shown = user.displayName || user.email?.split("@")[0] || "user";
    await setDoc(uref, {
      uid: user.uid,
      handle: shown,
      handleLower: String(shown).toLowerCase(),
      createdAt: serverTimestamp()
    });
  }
  currentUserDoc = (await getDoc(uref)).data();

  
  meHandleEl.textContent = `@${currentUserDoc.handle}`;
  meIdEl.textContent = currentUser.uid;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  watchConversations();
});