// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  serverTimestamp,
  get,
  child
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkbr0t5nftXlhrQpyz25xXu5U08bszAAc",
  authDomain: "void-whisper.firebaseapp.com",
  projectId: "void-whisper",
  storageBucket: "void-whisper.firebasestorage.app",
  messagingSenderId: "656334819196",
  appId: "1:656334819196:web:e00fe3973cea78189a5ef9",
  measurementId: "G-8KT24L0SFL",
  databaseURL: "https://void-whisper-default-rtdb.firebaseio.com/"

};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export {
  ref,
  set,
  push,
  onValue,
  update,
  serverTimestamp,
  get,
  child
};
