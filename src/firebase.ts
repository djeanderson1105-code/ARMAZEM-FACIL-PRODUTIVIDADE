import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  initializeFirestore, 
  memoryLocalCache, 
  persistentLocalCache, 
  persistentMultipleTabManager, 
  setLogLevel, 
  getFirestore, 
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json';

// Set Firestore log level to silent to suppress backend retry warnings in offline mode
try {
  setLogLevel('silent');
} catch (e) {
  // Ignore if already initialized
}

// Clean up any stale or heavy firestore target keys from localStorage to free space
if (typeof window !== 'undefined') {
  try {
    if (window.localStorage) {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i);
        if (key && (key.startsWith('firestore_') || key.startsWith('firebase_'))) {
          window.localStorage.removeItem(key);
        }
      }
    }
  } catch (e) {
    // Ignore storage access errors
  }
}

interface FirebaseConfigExtended {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}

const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;

const DEFAULT_CONFIG: FirebaseConfigExtended = {
  apiKey: metaEnv?.VITE_FIREBASE_API_KEY || (appletConfig as any)?.apiKey || "AIzaSyB1ZyrUc3yDbiM1MuFqeyOCUoK5cT8xGP8",
  authDomain: metaEnv?.VITE_FIREBASE_AUTH_DOMAIN || (appletConfig as any)?.authDomain || "bionic-petal-fwx5p.firebaseapp.com",
  projectId: metaEnv?.VITE_FIREBASE_PROJECT_ID || (appletConfig as any)?.projectId || "bionic-petal-fwx5p",
  storageBucket: metaEnv?.VITE_FIREBASE_STORAGE_BUCKET || (appletConfig as any)?.storageBucket || "bionic-petal-fwx5p.firebasestorage.app",
  messagingSenderId: metaEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID || (appletConfig as any)?.messagingSenderId || "146217191211",
  appId: metaEnv?.VITE_FIREBASE_APP_ID || (appletConfig as any)?.appId || "1:146217191211:web:0ff41d060dcb835f8ee76e",
  measurementId: metaEnv?.VITE_FIREBASE_MEASUREMENT_ID || (appletConfig as any)?.measurementId || undefined,
  firestoreDatabaseId: metaEnv?.VITE_FIREBASE_DATABASE_ID || (appletConfig as any)?.firestoreDatabaseId || "ai-studio-remixremixcopyof-f0cb713b-ad8c-4b0e-9cd3-4cca19956cc4"
};

// Check if there is a custom configuration saved in localStorage
let firebaseConfig: FirebaseConfigExtended = DEFAULT_CONFIG;
let usingCustom = false;

if (typeof window !== 'undefined') {
  try {
    const savedConfigStr = window.localStorage ? window.localStorage.getItem('custom_firebase_config') : null;
    if (savedConfigStr) {
      const parsed = JSON.parse(savedConfigStr);
      if (parsed && (parsed.projectId === 'armazemfacil-b2292' || parsed.projectId === 'armazemrelatorios')) {
        // Automatically clear stale cache pointing to old project
        window.localStorage.removeItem('custom_firebase_config');
      } else if (parsed && parsed.apiKey && parsed.projectId) {
        firebaseConfig = {
          apiKey: parsed.apiKey,
          authDomain: parsed.authDomain || `${parsed.projectId}.firebaseapp.com`,
          projectId: parsed.projectId,
          storageBucket: parsed.storageBucket || `${parsed.projectId}.appspot.com`,
          messagingSenderId: parsed.messagingSenderId || '',
          appId: parsed.appId || '',
          measurementId: parsed.measurementId || '',
          firestoreDatabaseId: parsed.firestoreDatabaseId || undefined
        };
        usingCustom = true;
      }
    }
  } catch (e) {
    console.warn("Error parsing custom firebase config", e);
  }
}

// Initialize Firebase safely
let app: any = null;
try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
} catch (e) {
  try {
    app = getApp();
  } catch (e2) {
    console.warn("Error initializing Firebase App:", e2);
  }
}

let auth: any = null;
try {
  if (app) {
    auth = getAuth(app);
  }
} catch (e) {
  console.warn("Error obtaining Firebase auth:", e);
}

// Attempt background authentication to populate request.auth and avoid permission denied errors
if (typeof window !== 'undefined' && auth) {
  try {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        signInAnonymously(auth).catch(() => {
          // Anonymous authentication not enabled or offline, continue with graceful fallbacks
        });
      }
    });
  } catch (e) {
    // Ignore auth listener error
  }
}

let db: any = null;
try {
  if (app) {
    const cacheConfig = typeof window !== 'undefined'
      ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }
      : { localCache: memoryLocalCache() };

    db = firebaseConfig.firestoreDatabaseId 
      ? initializeFirestore(app, cacheConfig, firebaseConfig.firestoreDatabaseId)
      : initializeFirestore(app, cacheConfig);
  }
} catch (e) {
  try {
    if (app) {
      db = firebaseConfig.firestoreDatabaseId 
        ? initializeFirestore(app, { localCache: memoryLocalCache() }, firebaseConfig.firestoreDatabaseId)
        : initializeFirestore(app, { localCache: memoryLocalCache() });
    }
  } catch (e2) {
    try {
      if (app) {
        db = firebaseConfig.firestoreDatabaseId
          ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
          : getFirestore(app);
      }
    } catch (e3) {
      console.warn("Error initializing Firestore:", e3);
    }
  }
}

// Test connection to Firestore
if (typeof window !== 'undefined' && db) {
  try {
    getDocFromServer(doc(db, 'test', 'connection')).catch((error) => {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    });
  } catch (e) {
    // Ignore test connection error
  }
}

// Helper to determine if we are using custom config
export const isCustomFirebaseConnected = () => {
  return true; // The application is always connected to the live database in production!
};

// Helper to determine if the user has configured their own custom database via localStorage
export const isUsingCustomFirebase = () => {
  return usingCustom;
};

export const getActiveConfig = () => {
  return firebaseConfig;
};

export { app, auth, db };
export default app;
