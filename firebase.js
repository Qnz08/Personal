import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBnVFWHENa-gbyNgtHzrW2G6b2MFTX6Q9w",
  authDomain: "personal-focus-assistant-2646d.firebaseapp.com",
  projectId: "personal-focus-assistant-2646d",
  storageBucket: "personal-focus-assistant-2646d.firebasestorage.app",
  messagingSenderId: "49453387955",
  appId: "1:49453387955:web:1a34f3f8f90e45bd3420c6",
  measurementId: "G-YPWT85RMZF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth, db,
  doc, getDoc, setDoc,
  collection, addDoc, deleteDoc, updateDoc,
  onSnapshot, query, orderBy,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
};