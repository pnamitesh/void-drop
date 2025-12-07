// app.js
import { db, ref, set, push, onValue, update, serverTimestamp, get, child } from "./firebase.js";

// ---------- Simple client-side "auth" ----------
const LOCAL_USER_KEY = "whisper_pact_user";
let currentUser = loadOrCreateUser();
let currentRoomId = null;
let currentRoomRef = null;
let currentParticipantId = null;
let currentProgress = null;

// 7-day task list (you can edit text later)
const TASKS = [
  {
    id: 0,
    title: "The First Impulse",
    prompt:
      "Think of the last time you wanted to text or call them but stopped. What did you stop yourself from saying?"
  },
  {
    id: 1,
    title: "Underneath the Message",
    prompt:
      "Pick any recent message you sent them. What did your heart actually want to say behind those words?"
  },
  {
    id: 2,
    title: "The Unsent Version",
    prompt:
      "Write the unsent version of something you softened or joked about. How would it sound if you were 10% more honest?"
  },
  {
    id: 3,
    title: "The Hidden Fear",
    prompt:
      "What is a small fear you feel in this connection that you rarely put into words?"
  },
  {
    id: 4,
    title: "The Quiet Gratitude",
    prompt:
      "Write about something they did that meant a lot to you, but you never fully acknowledged out loud."
  },
  {
    id: 5,
    title: "The Version of You With Them",
    prompt:
      "Describe the version of you that appears when you are with them. What do you like and dislike about that version?"
  },
  {
    id: 6,
    title: "If This Was the Last Whisper",
    prompt:
      "If you could send them one message that you knew they would truly hear, what would you say?"
  }
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
  // Just go back to landing; user data stays
  currentRoomId = null;
  currentRoomRef = null;
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
    } catch {
      // ignore
    }
  }
  const user = {
    id: "u_" + Math.random().toString(36).slice(2, 10),
    name: ""
  };
  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
  return user;
}

function saveUser() {
  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(currentUser));
}

function randomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    day: "2-digit",
    month: "short"
  });
}

// Calculate day 1–7 based on startedAt
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
  const roomRef = ref(db, "rooms/" + roomId);

  const participants = {};
  currentParticipantId = currentUser.id;
  participants[currentParticipantId] = {
    name: currentUser.name,
    createdAt: Date.now()
  };

  const roomData = {
    roomId,
    status: "waiting", // "waiting" | "active" | "finished"
    createdAt: Date.now(),
    startedAt: null,
    participants,
    identityMap: {}
  };

  await set(roomRef, roomData);

  currentRoomId = roomId;
  currentRoomRef = roomRef;

  attachRoomListener(roomId);
  switchScreen("room");

  createRoomBtn.disabled = false;
  joinRoomBtn.disabled = false;
}

// async function handleJoinRoom() {
//   setupError.textContent = "";
//   const name = displayNameInput.value.trim();
//   let code = roomCodeInput.value.trim().toUpperCase();

//   if (!name) {
//     setupError.textContent = "Please enter your name.";
//     return;
//   }

//   if (!code || code.length < 4) {
//     setupError.textContent = "Please enter a valid room code.";
//     return;
//   }

//   createRoomBtn.disabled = true;
//   joinRoomBtn.disabled = true;

//   currentUser.name = name;
//   saveUser();

//   const roomRef = ref(db, "rooms/" + code);
//   const snap = await get(roomRef);
//   if (!snap.exists()) {
//     setupError.textContent = "Room not found. Check the code.";
//     createRoomBtn.disabled = false;
//     joinRoomBtn.disabled = false;
//     return;
//   }

//   const roomData = snap.val();

//   if (roomData.status === "finished") {
//     setupError.textContent = "This pact has already ended.";
//     createRoomBtn.disabled = false;
//     joinRoomBtn.disabled = false;
//     return;
//   }

//   const participants = roomData.participants || {};
//   const existingIds = Object.keys(participants);

//   // Limit to 2 participants
//   if (existingIds.length >= 2 && !participants[currentUser.id]) {
//     setupError.textContent = "This room already has two participants.";
//     createRoomBtn.disabled = false;
//     joinRoomBtn.disabled = false;
//     return;
//   }

//   currentParticipantId = currentUser.id;

//   // Add / update self as participant
//   const updates = {};
//   updates["rooms/" + code + "/participants/" + currentParticipantId] = {
//     name: currentUser.name,
//     createdAt: Date.now()
//   };
//   await update(ref(db), updates);

//   currentRoomId = code;
//   currentRoomRef = roomRef;

//   attachRoomListener(code);
//   switchScreen("room");

//   createRoomBtn.disabled = false;
//   joinRoomBtn.disabled = false;
// }
async function handleJoinRoom() {
  setupError.textContent = "";
  const name = displayNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) {
    setupError.textContent = "Please enter your name.";
    return;
  }

  if (!code || code.length < 4) {
    setupError.textContent = "Please enter a valid room code.";
    return;
  }

  createRoomBtn.disabled = true;
  joinRoomBtn.disabled = true;

  // Read room
  const roomRef = ref(db, "rooms/" + code);
  const snap = await get(roomRef);

  if (!snap.exists()) {
    setupError.textContent = "Room not found.";
    resetButtons();
    return;
  }

  const room = snap.val();

  // --- Persistent identity check ---
  const identityMap = room.identityMap || {};

  if (identityMap[name]) {
    // User already exists in this room
    currentParticipantId = identityMap[name];
    currentUser.name = name;
    saveUser();

    switchToRoom(code);
    resetButtons();
    return;
  }

  // --- NEW participant joining ---
  const participants = room.participants || {};
  const count = Object.keys(participants).length;

  if (count >= 2) {
    setupError.textContent = "This room already has 2 participants.";
    resetButtons();
    return;
  }

  // create new userId
  currentParticipantId = "u_" + Math.random().toString(36).slice(2, 10);
  currentUser.name = name;
  saveUser();

  // write to DB: add identity + participant
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
      // Room deleted or left
      if (currentRoomId === roomId) {
        currentRoomId = null;
        switchScreen("setup");
      }
      return;
    }

    const room = snap.val();
    renderRoom(room);

    if (room.status === "active") {
      // Go to game if not already
      if (screenGame.classList.contains("active") === false) {
        switchScreen("game");
      }
      renderGame(room);
      attachEntriesListener(roomId);
      attachProgressListener(roomId);
    } else if (room.status === "finished") {
      roomStatusText.textContent = "This pact has ended. You can still read what was shared.";
      switchScreen("game");
      renderGame(room);
      attachEntriesListener(roomId);
      attachProgressListener(roomId);
    }
  });
}

async function handleStartGame() {
  if (!currentRoomId) return;

  const updates = {};
  updates["rooms/" + currentRoomId + "/status"] = "active";
  updates["rooms/" + currentRoomId + "/startedAt"] = Date.now();
  await update(ref(db), updates);
}

async function handleLeaveRoom() {
  if (!currentRoomId || !currentParticipantId) {
    switchScreen("setup");
    return;
  }

  const updates = {};
  updates["rooms/" + currentRoomId + "/participants/" + currentParticipantId] = null;
  await update(ref(db), updates);

  currentRoomId = null;
  currentRoomRef = null;
  switchScreen("setup");
}

function renderRoom(room) {
  roomIdLabel.textContent = room.roomId;
  roomCodeBig.textContent = room.roomId;

  // Participants list
  participantsList.innerHTML = "";
  const participants = room.participants || {};
  const ids = Object.keys(participants);

  ids.forEach((pid) => {
    const li = document.createElement("li");
    const spanName = document.createElement("span");
    spanName.classList.add("name");
    spanName.textContent = participants[pid].name || "Anonymous";

    const meta = document.createElement("span");
    if (pid === currentParticipantId) {
      meta.innerHTML = `<span class="you">you</span>`;
    } else {
      meta.textContent = "";
    }

    li.appendChild(spanName);
    li.appendChild(meta);
    participantsList.appendChild(li);
  });

  const count = ids.length;

  if (room.status === "waiting") {
    if (count < 2) {
      roomStatusText.textContent = "Waiting for your friend to join…";
      // Only creator should see start button, but for simplicity:
      startGameBtn.classList.add("hidden");
    } else {
      roomStatusText.textContent = "Both of you are here. You can start the 7-day pact.";
      startGameBtn.classList.remove("hidden");
    }
  } else if (room.status === "active") {
    roomStatusText.textContent = "Pact is in progress.";
    startGameBtn.classList.add("hidden");
  } else if (room.status === "finished") {
    roomStatusText.textContent = "This pact has ended.";
    startGameBtn.classList.add("hidden");
  }
}

// ---------- Game: progress + entries ----------
function attachProgressListener(roomId) {
  const progRef = ref(db, `rooms/${roomId}/progress/${currentParticipantId}`);
  onValue(progRef, (snap) => {
    currentProgress = snap.val() || { currentTaskIndex: 0 };
    renderTask();
  });
}

function renderGame(room) {
  const day = computeDay(room.startedAt);
  currentDayLabel.textContent = day.toString();
  renderTask();
}

function renderTask() {
  const idx = currentProgress?.currentTaskIndex ?? 0;
  const safeIndex = Math.min(TASKS.length - 1, Math.max(0, idx));
  const task = TASKS[safeIndex];

  taskTitle.textContent = task.title;
  taskPrompt.textContent = task.prompt;
  gameInfo.textContent = `You’re on prompt ${safeIndex + 1} of ${TASKS.length}. You can answer at your own pace.`;
}

// Shared + journal entries listener
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

  sharedList.innerHTML = "";
  journalList.innerHTML = "";

  if (shared.length === 0) {
    sharedList.innerHTML = `<p class="muted small">Your partner hasn’t shared anything yet.</p>`;
  } else {
    shared
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((entry) => {
        const div = document.createElement("div");
        div.classList.add("whisper-item");

        const meta = document.createElement("div");
        meta.classList.add("whisper-meta");
        meta.innerHTML = `<span>${entry.authorName || "Partner"}</span><span>${formatTime(entry.createdAt)}</span>`;

        const text = document.createElement("div");
        text.classList.add("whisper-text");
        text.textContent = entry.text;

        div.appendChild(meta);
        div.appendChild(text);
        sharedList.appendChild(div);
      });
  }

  if (mine.length === 0) {
    journalList.innerHTML = `<p class="muted small">Your journal is empty. Every response you save or share appears here for you.</p>`;
  } else {
    mine
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((entry) => {
        const div = document.createElement("div");
        div.classList.add("whisper-item");

        const visibility = entry.shareWithPartner ? "Shared" : "Private";

        const meta = document.createElement("div");
        meta.classList.add("whisper-meta");
        meta.innerHTML = `<span>${visibility}</span><span>${formatTime(entry.createdAt)}</span>`;

        const text = document.createElement("div");
        text.classList.add("whisper-text");
        text.textContent = entry.text;

        div.appendChild(meta);
        div.appendChild(text);
        journalList.appendChild(div);
      });
  }
}

async function handleSubmitResponse(shareWithPartner) {
  if (!currentRoomId || !currentParticipantId) return;

  const text = responseInput.value.trim();
  if (!text) {
    gameInfo.textContent = "Write something before saving.";
    return;
  }

  savePrivateBtn.disabled = true;
  shareWithPartnerBtn.disabled = true;

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

  // Move to next task
  const newIndex = (currentProgress?.currentTaskIndex ?? 0) + 1;
  await update(ref(db, `rooms/${currentRoomId}/progress/${currentParticipantId}`), {
    currentTaskIndex: newIndex,
    updatedAt: now
  });

  gameInfo.textContent = shareWithPartner
    ? "Saved and shared with your partner."
    : "Saved privately in your journal.";

  savePrivateBtn.disabled = false;
  shareWithPartnerBtn.disabled = false;
}

// ---------- UI utility ----------
function handleCopyCode() {
  if (!currentRoomId) return;
  navigator.clipboard
    .writeText(currentRoomId)
    .then(() => {
      roomStatusText.textContent = "Code copied. Send it to your friend.";
    })
    .catch(() => {
      roomStatusText.textContent = "Could not copy code, but you can tell them: " + currentRoomId;
    });
}

// On first load, always show setup
switchScreen("setup");
