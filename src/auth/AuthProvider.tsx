import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile as firebaseUpdateProfile,
  updatePassword,
  deleteUser,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, setDoc, updateDoc, collection, addDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase.ts';
import { AuthContextType, AuthUser, GuestUser } from './types.ts';
import { migrateLocalDataToCloud } from '../services/cloudSync.ts';

const AuthContext = createContext<AuthContextType | null>(null);

const GUEST_STORAGE_KEY = 'documind_guest_session';
const AUTH_SYNC_EVENT_KEY = 'documind_auth_sync_event';

function createGuestUser(customUid?: string): GuestUser {
  const uid = customUid || `guest_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;
  return {
    uid,
    email: null,
    displayName: 'Guest Researcher',
    photoURL: null,
    emailVerified: false,
    isAnonymous: true,
    isGuest: true,
  };
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Broadcast auth events across tabs
  const broadcastAuthEvent = (type: 'login' | 'logout' | 'guest') => {
    try {
      localStorage.setItem(
        AUTH_SYNC_EVENT_KEY,
        JSON.stringify({ type, timestamp: Date.now() })
      );
    } catch {
      // Ignore quota/private mode errors
    }
  };

  // Record login history in Firestore if user is authenticated
  const logLoginHistory = async (firebaseUser: FirebaseUser, method: 'password' | 'google' | 'guest') => {
    if (!db) return;
    try {
      const historyCol = collection(db, `users/${firebaseUser.uid}/loginHistory`);
      await addDoc(historyCol, {
        at: new Date().toISOString(),
        method,
        userAgent: navigator.userAgent.substring(0, 500),
        platform: navigator.platform.substring(0, 90),
        success: true,
      });

      // Update or create user profile doc
      const userDoc = doc(db, `users/${firebaseUser.uid}`);
      await setDoc(
        userDoc,
        {
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Researcher',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL || null,
          lastLoginAt: new Date().toISOString(),
          plan: 'free',
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Could not record login history in Firestore:', err);
    }
  };

  // Initialize and listen to Auth state changes
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      // Check if previously stored guest exists
      const savedGuest = localStorage.getItem(GUEST_STORAGE_KEY);
      if (savedGuest) {
        try {
          const parsed = JSON.parse(savedGuest);
          setUser(createGuestUser(parsed.uid));
        } catch {
          setUser(createGuestUser());
        }
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Clear any leftover guest state
        localStorage.removeItem(GUEST_STORAGE_KEY);
        setUser(firebaseUser);
      } else {
        // If no Firebase user, check if user was operating in guest mode
        const savedGuest = localStorage.getItem(GUEST_STORAGE_KEY);
        if (savedGuest) {
          try {
            const parsed = JSON.parse(savedGuest);
            setUser(createGuestUser(parsed.uid));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Multi-tab synchronization listener
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_SYNC_EVENT_KEY && e.newValue) {
        try {
          const event = JSON.parse(e.newValue);
          if (event.type === 'logout') {
            setUser(null);
            localStorage.removeItem(GUEST_STORAGE_KEY);
          } else if (event.type === 'guest') {
            const savedGuest = localStorage.getItem(GUEST_STORAGE_KEY);
            if (savedGuest) {
              const parsed = JSON.parse(savedGuest);
              setUser(createGuestUser(parsed.uid));
            }
          }
        } catch (err) {
          console.warn('Error syncing auth across tabs:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const continueAsGuest = useCallback(() => {
    const existing = localStorage.getItem(GUEST_STORAGE_KEY);
    let guest: GuestUser;
    if (existing) {
      try {
        guest = createGuestUser(JSON.parse(existing).uid);
      } catch {
        guest = createGuestUser();
      }
    } else {
      guest = createGuestUser();
    }
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ uid: guest.uid }));
    setUser(guest);
    broadcastAuthEvent('guest');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, rememberMe = true) => {
      if (!auth) throw new Error('Firebase Auth is not configured.');
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      localStorage.removeItem(GUEST_STORAGE_KEY);
      await logLoginHistory(credential.user, 'password');
      broadcastAuthEvent('login');
    },
    []
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string, rememberMe = true) => {
      if (!auth) throw new Error('Firebase Auth is not configured.');
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const credential = await createUserWithEmailAndPassword(auth, email, password);

      if (displayName) {
        await firebaseUpdateProfile(credential.user, { displayName });
      }

      // Automatically send verification email
      try {
        await sendEmailVerification(credential.user);
      } catch (err) {
        console.warn('Could not send initial verification email:', err);
      }

      localStorage.removeItem(GUEST_STORAGE_KEY);

      if (db) {
        const userDoc = doc(db, `users/${credential.user.uid}`);
        await setDoc(userDoc, {
          displayName: displayName || email.split('@')[0],
          email,
          photoURL: null,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          plan: 'free',
          settings: {},
        });
      }

      await logLoginHistory(credential.user, 'password');
      broadcastAuthEvent('login');
    },
    []
  );

  const signInWithGoogle = useCallback(
    async (rememberMe = true) => {
      if (!auth) throw new Error('Firebase Auth is not configured.');

      // CRITICAL FOR IFRAME & USER-GESTURE SAFETY:
      // 1. In cross-origin iframes (AI Studio preview), signInWithRedirect is blocked by X-Frame-Options: DENY.
      //    signInWithPopup is the strictly required method as it opens an independent top-level window.
      // 2. signInWithPopup must be invoked synchronously from the user activation click event.
      //    Awaiting asynchronous operations (like setPersistence) before calling signInWithPopup consumes the
      //    browser's transient user activation window, causing browsers to block the popup (auth/popup-blocked).
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      provider.setCustomParameters({ prompt: 'select_account' });

      try {
        const credential = await signInWithPopup(auth, provider);

        // Apply session persistence if the user opted out of "remember me"
        if (!rememberMe && auth) {
          try {
            await setPersistence(auth, browserSessionPersistence);
          } catch (persErr) {
            console.warn('[FirebaseAuth] Could not set session persistence:', persErr);
          }
        }

        localStorage.removeItem(GUEST_STORAGE_KEY);
        await logLoginHistory(credential.user, 'google');
        broadcastAuthEvent('login');
      } catch (err: unknown) {
        const authErr = err as { code?: string; message?: string };
        const code = authErr?.code || 'unknown';
        const rawMessage = authErr?.message || (err instanceof Error ? err.message : String(err));
        const currentHostname = typeof window !== 'undefined' ? window.location.hostname : 'unknown';

        // Clear, structured error logging without exposing secrets, credentials, or tokens
        console.error('[FirebaseAuth] Google Sign-In failed:', {
          code,
          message: rawMessage,
          hostname: currentHostname,
        });

        throw err;
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(GUEST_STORAGE_KEY);
    if (auth && auth.currentUser) {
      await firebaseSignOut(auth);
    }
    setUser(null);
    broadcastAuthEvent('logout');
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured.');
    await sendPasswordResetEmail(auth, email);
  }, []);

  const sendVerification = useCallback(async () => {
    if (!auth || !auth.currentUser) throw new Error('No user is currently signed in.');
    await sendEmailVerification(auth.currentUser);
  }, []);

  const updateProfile = useCallback(
    async (data: { displayName?: string; photoURL?: string }) => {
      if (!auth || !auth.currentUser) throw new Error('No user is currently signed in.');
      await firebaseUpdateProfile(auth.currentUser, data);
      setUser({ ...auth.currentUser });

      if (db) {
        const userDoc = doc(db, `users/${auth.currentUser.uid}`);
        await updateDoc(userDoc, {
          ...(data.displayName ? { displayName: data.displayName } : {}),
          ...(data.photoURL ? { photoURL: data.photoURL } : {}),
        });
      }
    },
    []
  );

  const changePassword = useCallback(async (newPassword: string) => {
    if (!auth || !auth.currentUser) throw new Error('No user is currently signed in.');
    await updatePassword(auth.currentUser, newPassword);
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!auth || !auth.currentUser) throw new Error('No user is currently signed in.');
    const currentUser = auth.currentUser;
    await deleteUser(currentUser);
    localStorage.removeItem(GUEST_STORAGE_KEY);
    setUser(null);
    broadcastAuthEvent('logout');
  }, []);

  const getIdToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      if (user && 'isGuest' in user && user.isGuest) {
        return user.uid; // "guest_<id>" format
      }
      if (auth && auth.currentUser) {
        return await auth.currentUser.getIdToken(forceRefresh);
      }
      return null;
    },
    [user]
  );

  // Upgrade guest: create account, then seamlessly migrate local IndexedDB data to Firestore
  const upgradeGuestAccount = useCallback(
    async (email: string, password: string, displayName?: string) => {
      if (!auth) throw new Error('Firebase Auth is not configured.');
      const credential = await createUserWithEmailAndPassword(auth, email, password);

      if (displayName) {
        await firebaseUpdateProfile(credential.user, { displayName });
      }

      try {
        await sendEmailVerification(credential.user);
      } catch (err) {
        console.warn('Verification email could not be sent immediately:', err);
      }

      localStorage.removeItem(GUEST_STORAGE_KEY);

      // Initialize Firestore document
      if (db) {
        const userDoc = doc(db, `users/${credential.user.uid}`);
        await setDoc(userDoc, {
          displayName: displayName || email.split('@')[0],
          email,
          photoURL: null,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          plan: 'free',
          settings: {},
        });
      }

      // Migrate existing local research data to their new cloud account
      await migrateLocalDataToCloud(credential.user.uid);

      await logLoginHistory(credential.user, 'password');
      broadcastAuthEvent('login');
    },
    []
  );

  const isGuest = Boolean(user && 'isGuest' in user && user.isGuest);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isGuest,
        signIn,
        signUp,
        signInWithGoogle,
        continueAsGuest,
        signOut,
        resetPassword,
        sendVerification,
        updateProfile,
        changePassword,
        deleteAccount,
        getIdToken,
        upgradeGuestAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
