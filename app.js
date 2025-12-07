// app.js
import { db, ref, set, push, onValue, update, get } from "./firebase.js";

// ---------- Simple client-side "auth" ----------
const LOCAL_USER_KEY = "whisper_pact_user";
let currentUser = loadOrCreateUser();
let currentRoomId = null;
let currentRoomRef = null;
let currentParticipantId = null;
let currentProgress = null;

// 7-day task list
const TASKS = [
  { id: 0, title: "The First Impulse", prompt: "Think of the last time you wanted to text or call them but stopped. What did you stop yourself from saying?" },
  { id: 1, title: "Underneath the Message", prompt: "Pick any recent message you sent them. What did your heart actually want to say behind those words?" },
  { id: 2, title: "The Unsent Version", prompt: "Write the unsent version of something you softened or joked about. How would it sound if you were 10% more honest?" },
  { id: 3, title: "The Hidden Fear", prompt: "What is a small fear you feel in this connection that you rarely put into words?" },
  { id: 4, title: "The Quiet Gratitude", prompt: "Write about something they did that meant a lot to you, but you never fully acknowledged out loud." },
  { id: 5, title: "The Version of You With Them", prompt: "Describe the version of you that appears when you are with them. What do you like and dislike about that version?" },
  { id: 6, title: "If This Was the Last Whisper", prompt: "If you could send them one message that you knew they would truly hear, what would you say?" }
];

// ---------- DOM elements ----------
const screenSetup = document.getElementById("screen-setup");
const screenRoom = document.getElementById("screen-room");
const screenGame = document.getElementById("screen-game");

const displayNameInput = document.getElementById("displayNameInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const setupError = document.getElementById("setupError");

const roomIdLabel = document.getElementById("roomIdLabel");
const roomCodeBig = document.getElementById("roomCodeBig");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const participantsList = document.getElementById("participantsList");
const roomStatusText = document.getElementById("roomStatusText");
const startGameBtn = document.getElementById("startGameBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");

const currentDayLabel = document.getElementById("currentDayLabel");
const taskTitle = document.getElementById("taskTitle");
const taskPrompt = document.getElementById("taskPrompt");
const responseInput = document.getElementById("responseInput");
const savePrivateBtn = document.getElementById("savePrivateBtn");
const shareWithPartnerBtn = document.getElementById("shareWithPartnerBtn");
const gameInfo = document.getElementById("gameInfo");
const sharedList = document.getElementById("sharedList");
const journalList = document.getElementById("journalList");
const signOutBtn = document.getElementById("signOutBtn");

// ---------- Initial setup ----------
displayNameInput.value = currentUser.name || "";
setupError.textContent = "";

// ---------- Helper functions ----------
function switchScreen(name) {
  screenSetup.classList.remove("active");
  screenRoom.classList.remove("active");
  screenGame.classList.remove("active");
  if (name === "setup") screenSetup.classList.add("active");
  if (name === "room") screenRoom.classList.add("active");
  if (name === "game") screenGame.classList.add("active");
}

function loadOrCreateUser() {
  let raw = localStorage.getItem(LOCAL_USER_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  const user = { id: "u_" + Math.random().toString(36).slice(2, 10), name: "" };
  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
  return user;
}

function saveUser() {
  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(currentUser));
}

function randomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---------------------- FIXED: CREATE ROOM ----------------------
async function handleCreateRoom() {
  setupError.textContent = "";
  const name = displayNameInput.value.trim();
  if (!name) { setupError.textContent = "Please enter your name."; return; }

  createRoomBtn.disabled = true; joinRoomBtn.disabled = true;

  currentUser.name = name;
  saveUser();

  const roomId = randomRoomId();
  const roomRef = ref(db, "rooms/" + roomId);

  currentParticipantId = currentUser.id;

  const participants = {
    [currentParticipantId]: {
      name: currentUser.name,
      createdAt: Date.now()
    }
  };

  const roomData = {
    roomId,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    participants,
    identityMap: {
      [currentUser.name]: currentParticipantId   // ★ creator persistent identity
    }
  };

  await set(roomRef, roomData);
  currentRoomId = roomId;
  currentRoomRef = roomRef;

  attachRoomListener(roomId);
  switchScreen("room");

  createRoomBtn.disabled = false; joinRoomBtn.disabled = false;
}

// ---------------------- FIXED: JOIN ROOM ----------------------
async function handleJoinRoom() {
  setupError.textContent = "";
  const name = displayNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) { setupError.textContent = "Please enter your name."; return; }
  if (!code || code.length < 4) { setupError.textContent = "Invalid room code."; return; }

  createRoomBtn.disabled = true; joinRoomBtn.disabled = true;

  const roomRef = ref(db, "rooms/" + code);
  const snap = await get(roomRef);
  if (!snap.exists()) { setupError.textContent = "Room not found."; return resetButtons(); }

  const room = snap.val();
  const identityMap = room.identityMap || {};
  const participants = room.participants || {};
  const count = Object.keys(participants).length;

  // ★ user already belongs to this room
  if (identityMap[name]) {
    currentParticipantId = identityMap[name];
    currentUser.name = name;
    saveUser();
    switchToRoom(code);
    return resetButtons();
  }

  // ★ new participant, but room is full
  if (count >= 2) {
    setupError.textContent = "Room already has 2 participants.";
    return resetButtons();
  }

  // ★ new participant → persist identity
  currentParticipantId = "u_" + Math.random().toString(36).slice(2, 10);
  currentUser.name = name;
  saveUser();

  // update database
  const updates = {};
  updates[`rooms/${code}/identityMap/${name}`] = currentParticipantId;
  updates[`rooms/${code}/participants/${currentParticipantId}`] = {
    name,
    createdAt: Date.now()
  };

  await update(ref(db), updates);
  switchToRoom(code);
  resetButtons();
}

function resetButtons() {
  createRoomBtn.disabled = false;
  joinRoomBtn.disabled = false;
}

// ---------------------- Room listeners ----------------------
function switchToRoom(code) {
  currentRoomId = code;
  currentRoomRef = ref(db, "rooms/" + code);
  attachRoomListener(code);
  switchScreen("room");
}

function attachRoomListener(roomId) {
  const roomRef = ref(db, "rooms/" + roomId);
  onValue(roomRef, (snap) => {
    if (!snap.exists()) {
      currentRoomId = null;
      switchScreen("setup");
      return;
    }

    const room = snap.val();
    renderRoom(room);

    if (room.status === "active") {
      if (!screenGame.classList.contains("active")) switchScreen("game");
      renderGame(room);
      attachEntriesListener(roomId);
      attachProgressListener(roomId);
    }
  });
}

// ---------------------- Render logic ----------------------
function renderRoom(room) {
  roomIdLabel.textContent = room.roomId;
  roomCodeBig.textContent = room.roomId;

  participantsList.innerHTML = "";
  const participants = room.participants || {};

  Object.keys(participants).forEach((pid) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="name">${participants[pid].name}</span>
      ${pid === currentParticipantId ? '<span class="you">you</span>' : ''}
    `;
    participantsList.appendChild(li);
  });

  const count = Object.keys(participants).length;
  if (room.status === "waiting") {
    if (count < 2) {
      roomStatusText.textContent = "Waiting for your friend…";
      startGameBtn.classList.add("hidden");
    } else {
      roomStatusText.textContent = "Both of you are here.";
      startGameBtn.classList.remove("hidden");
    }
  }
}

// ---------------------- Game Logic ----------------------
function attachProgressListener(roomId) {
  const progRef = ref(db, `rooms/${roomId}/progress/${currentParticipantId}`);
  onValue(progRef, (snap) => {
    currentProgress = snap.val() || { currentTaskIndex: 0 };
    renderTask();
  });
}

function renderGame(room) {
  const day = Math.min(7, Math.max(1, Math.floor((Date.now() - room.startedAt) / 86400000) + 1));
  currentDayLabel.textContent = day;
  renderTask();
}

function renderTask() {
  const idx = currentProgress?.currentTaskIndex ?? 0;
  const task = TASKS[idx];
  taskTitle.textContent = task.title;
  taskPrompt.textContent = task.prompt;
}

// ---------------------- Entries ----------------------
function attachEntriesListener(roomId) {
  const entriesRef = ref(db, `rooms/${roomId}/entries`);
  onValue(entriesRef, (snap) => {
    const entries = snap.val() || {};
    renderEntries(entries);
  });
}

function renderEntries(entries) {
  const all = Object.values(entries);
  const shared = all.filter((e) => e.authorId !== currentParticipantId && e.shareWithPartner);
  const mine = all.filter((e) => e.authorId === currentParticipantId);

  sharedList.innerHTML = shared.length
    ? shared.map(e => renderEntryHTML(e)).join("")
    : `<p class="muted small">Your partner hasn’t shared anything yet.</p>`;

  journalList.innerHTML = mine.length
    ? mine.map(e => renderEntryHTML(e, true)).join("")
    : `<p class="muted small">Your journal is empty.</p>`;
}

function renderEntryHTML(entry, mine = false) {
  return `
    <div class="whisper-item">
      <div class="whisper-meta">
        <span>${mine ? (entry.shareWithPartner ? "Shared" : "Private") : entry.authorName}</span>
        <span>${new Date(entry.createdAt).toLocaleString()}</span>
      </div>
      <div class="whisper-text">${entry.text}</div>
    </div>
  `;
}

// ---------------------- Save entries ----------------------
async function handleSubmitResponse(shareWithPartner) {
  if (!currentRoomId || !currentParticipantId) return;

  const text = responseInput.value.trim();
  if (!text) return gameInfo.textContent = "Write something first.";

  const now = Date.now();
  const entryRef = push(ref(db, `rooms/${currentRoomId}/entries`));
  await set(entryRef, {
    id: entryRef.key,
    authorId: currentParticipantId,
    authorName: currentUser.name,
    text,
    shareWithPartner,
    createdAt: now
  });

  responseInput.value = "";

  const newIndex = (currentProgress?.currentTaskIndex ?? 0) + 1;
  await update(ref(db, `rooms/${currentRoomId}/progress/${currentParticipantId}`), {
    currentTaskIndex: newIndex,
    updatedAt: now
  });

  gameInfo.textContent = shareWithPartner
    ? "Shared with your partner."
    : "Saved privately.";
}

// ---------------------- Copy code ----------------------
function handleCopyCode() {
  navigator.clipboard.writeText(currentRoomId);
  roomStatusText.textContent = "Code copied!";
}

// On first load
switchScreen("setup");
