import { db, ref, set, push, onValue, update, get } from "./firebase.js";

// ---------- Client-side "auth" ----------
const LOCAL_USER_KEY = "whisper_pact_user";
let currentUser = loadOrCreateUser();
let currentRoomId = null;
let currentParticipantId = null;
let currentProgress = null;

// 7-day task list
const TASKS = [
  {
    id: 0,
    title: "The First Impulse",
    prompt:
      "Think of the last time you wanted to text or call them but stopped. What did you stop yourself from saying?",
  },
  {
    id: 1,
    title: "Underneath the Message",
    prompt:
      "Pick any recent message you sent them. What did your heart actually want to say behind those words?",
  },
  {
    id: 2,
    title: "The Unsent Version",
    prompt:
      "Write the unsent version of something you softened or joked about. How would it sound if you were 10% more honest?",
  },
  {
    id: 3,
    title: "The Hidden Fear",
    prompt:
      "What is a small fear you feel in this connection that you rarely put into words?",
  },
  {
    id: 4,
    title: "The Quiet Gratitude",
    prompt:
      "Write about something they did that meant a lot to you, but you never fully acknowledged out loud.",
  },
  {
    id: 5,
    title: "The Version of You With Them",
    prompt:
      "Describe the version of you that appears when you are with them. What do you like and dislike about that version?",
  },
  {
    id: 6,
    title: "If This Was the Last Whisper",
    prompt:
      "If you could send them one message that you knew they would truly hear, what would you say?",
  },
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

// ---------- Event Listeners ----------
createRoomBtn.addEventListener("click", handleCreateRoom);
joinRoomBtn.addEventListener("click", handleJoinRoom);
copyCodeBtn.addEventListener("click", handleCopyCode);
leaveRoomBtn.addEventListener("click", handleLeaveRoom);
startGameBtn.addEventListener("click", handleStartGame);
savePrivateBtn.addEventListener("click", () => handleSubmitResponse(false));
shareWithPartnerBtn.addEventListener("click", () => handleSubmitResponse(true));
signOutBtn.addEventListener("click", () => {
  currentRoomId = null;
  switchScreen("setup");
});

// ---------- Helpers ----------
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
    try {
      return JSON.parse(raw);
    } catch {}
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
  for (let i = 0; i < 6; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function computeDay(startedAt) {
  if (!startedAt) return 1;
  const now = Date.now();
  const diff = now - startedAt;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return Math.min(7, Math.max(1, days + 1));
}

// ---------- Room logic ----------
async function handleCreateRoom() {
  setupError.textContent = "";
  const name = displayNameInput.value.trim();
  if (!name) {
    setupError.textContent = "Please enter your name.";
    return;
  }

  createRoomBtn.disabled = true;
  joinRoomBtn.disabled = true;
  currentUser.name = name;
  saveUser();

  const roomId = randomRoomId();
  currentParticipantId = currentUser.id;

  const roomData = {
    roomId,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    participants: {
      [currentParticipantId]: { name: currentUser.name, createdAt: Date.now() },
    },
    identityMap: { [currentUser.name]: currentParticipantId },
  };

  await set(ref(db, "rooms/" + roomId), roomData);
  switchToRoom(roomId);
}

async function handleJoinRoom() {
  setupError.textContent = "";
  const name = displayNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name || !code || code.length < 4) {
    setupError.textContent = "Please enter name and valid code.";
    return;
  }

  createRoomBtn.disabled = true;
  joinRoomBtn.disabled = true;

  const snap = await get(ref(db, "rooms/" + code));
  if (!snap.exists()) {
    setupError.textContent = "Room not found.";
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    return;
  }

  const room = snap.val();
  const participants = room.participants || {};
  const identityMap = room.identityMap || {};

  // Rejoin or Join
  if (identityMap[name]) {
    currentParticipantId = identityMap[name];
  } else {
    if (Object.keys(participants).length >= 2) {
      setupError.textContent = "Room full.";
      createRoomBtn.disabled = false;
      joinRoomBtn.disabled = false;
      return;
    }
    currentParticipantId = "u_" + Math.random().toString(36).slice(2, 10);
  }

  currentUser.name = name;
  saveUser();

  const updates = {};
  updates[`rooms/${code}/identityMap/${name}`] = currentParticipantId;
  updates[`rooms/${code}/participants/${currentParticipantId}`] = {
    name,
    createdAt: Date.now(),
  };

  await update(ref(db), updates);
  switchToRoom(code);
}

function switchToRoom(code) {
  currentRoomId = code;
  attachRoomListener(code);
  switchScreen("room");
  createRoomBtn.disabled = false;
  joinRoomBtn.disabled = false;
}

function attachRoomListener(roomId) {
  onValue(ref(db, "rooms/" + roomId), (snap) => {
    if (!snap.exists()) {
      currentRoomId = null;
      switchScreen("setup");
      return;
    }
    const room = snap.val();
    renderRoom(room);

    if (room.status === "active" || room.status === "finished") {
      if (!screenGame.classList.contains("active")) switchScreen("game");
      renderGame(room);
      attachEntriesListener(roomId);
      attachProgressListener(roomId);
    }
  });
}

async function handleStartGame() {
  if (!currentRoomId) return;
  await update(ref(db, `rooms/${currentRoomId}`), {
    status: "active",
    startedAt: Date.now(),
  });
}

async function handleLeaveRoom() {
  if (!currentRoomId || !currentParticipantId) return;
  await update(
    ref(db, `rooms/${currentRoomId}/participants/${currentParticipantId}`),
    null
  );
  currentRoomId = null;
  switchScreen("setup");
}

function renderRoom(room) {
  roomIdLabel.textContent = room.roomId;
  roomCodeBig.textContent = room.roomId;
  participantsList.innerHTML = "";

  const ids = Object.keys(room.participants || {});
  ids.forEach((pid) => {
    const p = room.participants[pid];
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${p.name}</span>${
      pid === currentParticipantId ? '<span class="you">you</span>' : ""
    }`;
    participantsList.appendChild(li);
  });

  if (room.status === "waiting") {
    if (ids.length < 2) {
      roomStatusText.textContent = "Waiting for partner...";
      startGameBtn.classList.add("hidden");
    } else {
      roomStatusText.textContent = "Ready to start.";
      startGameBtn.classList.remove("hidden");
    }
  }
}

// ---------- Game Logic ----------
function attachProgressListener(roomId) {
  onValue(
    ref(db, `rooms/${roomId}/progress/${currentParticipantId}`),
    (snap) => {
      currentProgress = snap.val() || { currentTaskIndex: 0 };
      renderTask();
    }
  );
}

function renderGame(room) {
  currentDayLabel.textContent = computeDay(room.startedAt).toString();
  renderTask();
}

function renderTask() {
  const idx = Math.min(
    TASKS.length - 1,
    Math.max(0, currentProgress?.currentTaskIndex ?? 0)
  );
  const task = TASKS[idx];
  taskTitle.textContent = task.title;
  taskPrompt.textContent = task.prompt;
}

function attachEntriesListener(roomId) {
  onValue(ref(db, `rooms/${roomId}/entries`), (snap) => {
    renderEntries(snap.val() || {});
  });
}

// *** RENDERING LOGIC ***
function renderEntries(entries) {
  const all = Object.values(entries);

  // 1. Shared Chat (My shared + Partner shared)
  const chatMessages = all
    .filter((e) => e.shareWithPartner === true)
    .sort((a, b) => a.createdAt - b.createdAt);

  sharedList.innerHTML = "";
  if (chatMessages.length === 0) {
    sharedList.innerHTML = `<div class="muted small" style="text-align:center; padding:20px;">No whispers shared yet.</div>`;
  } else {
    chatMessages.forEach((msg, index) => {
      const isMe = msg.authorId === currentParticipantId;
      const prevMsg = chatMessages[index - 1];

      const sameAuthorAsPrev = prevMsg && prevMsg.authorId === msg.authorId;

      const bubble = document.createElement("div");
      bubble.classList.add("chat-bubble");
      bubble.classList.add(isMe ? "me" : "partner");

      if (sameAuthorAsPrev) {
        bubble.classList.add("block-continue");
      } else {
        bubble.classList.add("block-start");
      }

      bubble.innerHTML = `
        <div>${msg.text}</div>
        <div class="bubble-meta">
          <span>Day ${msg.day || "?"}</span>
          <span>${formatTime(msg.createdAt)}</span>
        </div>
      `;
      sharedList.appendChild(bubble);
    });
    sharedList.scrollTop = sharedList.scrollHeight;
  }

  // 2. Private Journal (Only my PRIVATE entries)
  // UPDATED: Added !e.shareWithPartner so shared ones don't appear here
  const myPrivateEntries = all
    .filter((e) => e.authorId === currentParticipantId && !e.shareWithPartner)
    .sort((a, b) => a.createdAt - b.createdAt);

  journalList.innerHTML = "";
  if (myPrivateEntries.length === 0) {
    journalList.innerHTML = `<p class="muted small">No private notes yet.</p>`;
  } else {
    myPrivateEntries.forEach((entry) => {
      const div = document.createElement("div");
      div.classList.add("whisper-item");
      // No need to show "Private" label anymore since they are all private
      div.innerHTML = `
        <div class="whisper-meta"><span>Private</span><span>${formatTime(
          entry.createdAt
        )}</span></div>
        <div class="whisper-text">${entry.text}</div>
      `;
      journalList.appendChild(div);
    });
  }
}

async function handleSubmitResponse(shareWithPartner) {
  if (!currentRoomId || !currentParticipantId) return;
  const text = responseInput.value.trim();
  if (!text) return;

  savePrivateBtn.disabled = true;
  shareWithPartnerBtn.disabled = true;

  const now = Date.now();
  const day = currentDayLabel.textContent || "1";

  const entryRef = push(ref(db, `rooms/${currentRoomId}/entries`));
  await set(entryRef, {
    id: entryRef.key,
    authorId: currentParticipantId,
    authorName: currentUser.name,
    text,
    shareWithPartner,
    createdAt: now,
    day: day,
  });

  responseInput.value = "";
  const newIndex = (currentProgress?.currentTaskIndex ?? 0) + 1;
  await update(
    ref(db, `rooms/${currentRoomId}/progress/${currentParticipantId}`),
    { currentTaskIndex: newIndex, updatedAt: now }
  );

  gameInfo.textContent = shareWithPartner
    ? "Sent to chat."
    : "Saved to journal.";
  savePrivateBtn.disabled = false;
  shareWithPartnerBtn.disabled = false;
}

// ---------- UI utility ----------
function handleCopyCode() {
  if (!currentRoomId) return;
  navigator.clipboard.writeText(currentRoomId).catch(() => {});
  roomStatusText.textContent = "Code copied!";
}

// Init
switchScreen("setup");
