// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

function reqEnv(k: string): string {
  const v = (import.meta as any).env?.[k];
  if (!v || typeof v !== "string" || !v.trim()) {
    throw new Error(`Missing required env var ${k}`);
  }
  return v;
}

const firebaseConfig = {
  apiKey: reqEnv("VITE_FIREBASE_API_KEY"),
  authDomain: reqEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: reqEnv("VITE_FIREBASE_PROJECT_ID"),
  appId: reqEnv("VITE_FIREBASE_APP_ID"),
  storageBucket: reqEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: reqEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (e) {
    console.warn("Firestore persistence unavailable; using non-persistent Firestore.", e);
    return getFirestore(app);
  }
})();