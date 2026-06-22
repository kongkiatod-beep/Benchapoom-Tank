// ===== Firebase Initialization (Modular SDK v10) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2tPs3_mfkX70HOC6OnfNH6mC1ld3Vzwc",
  authDomain: "api-team-38970.firebaseapp.com",
  projectId: "api-team-38970",
  storageBucket: "api-team-38970.firebasestorage.app",
  messagingSenderId: "882231702606",
  appId: "1:882231702606:web:409170e47f5508136f7f1f",
  measurementId: "G-K1HRFJJTY3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  db,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  writeBatch,
};
