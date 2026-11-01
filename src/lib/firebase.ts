import { initializeApp, getApps, getApp, FirebaseApp, FirebaseOptions } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';

export interface FirebaseConfigStatus {
  isConfigured: boolean;
  missingKeys: string[];
  config: (FirebaseOptions & { firestoreDatabaseId?: string }) | null;
}

export const REQUIRED_FIREBASE_ENV_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export function checkFirebaseConfig(): FirebaseConfigStatus {
  const missingKeys: string[] = [];

  const cfg = (appletConfig as any) || {};
  const viteEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

  const apiKey = viteEnv.VITE_FIREBASE_API_KEY || cfg.apiKey;
  const authDomain = viteEnv.VITE_FIREBASE_AUTH_DOMAIN || cfg.authDomain;
  const projectId = viteEnv.VITE_FIREBASE_PROJECT_ID || cfg.projectId;
  const storageBucket = viteEnv.VITE_FIREBASE_STORAGE_BUCKET || cfg.storageBucket;
  const messagingSenderId = viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || cfg.messagingSenderId;
  const appId = viteEnv.VITE_FIREBASE_APP_ID || cfg.appId;
  const measurementId = viteEnv.VITE_FIREBASE_MEASUREMENT_ID || cfg.measurementId;
  const firestoreDatabaseId = cfg.firestoreDatabaseId;

  if (!apiKey) missingKeys.push('VITE_FIREBASE_API_KEY');
  if (!authDomain) missingKeys.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!projectId) missingKeys.push('VITE_FIREBASE_PROJECT_ID');
  if (!storageBucket) missingKeys.push('VITE_FIREBASE_STORAGE_BUCKET');
  if (!messagingSenderId) missingKeys.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  if (!appId) missingKeys.push('VITE_FIREBASE_APP_ID');

  if (missingKeys.length > 0) {
    return {
      isConfigured: false,
      missingKeys,
      config: null,
    };
  }

  return {
    isConfigured: true,
    missingKeys: [],
    config: {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      measurementId: measurementId || undefined,
      firestoreDatabaseId: firestoreDatabaseId || undefined,
    },
  };
}

const configStatus = checkFirebaseConfig();

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

if (configStatus.isConfigured && configStatus.config) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(configStatus.config);
    auth = getAuth(app);
    const dbId = configStatus.config.firestoreDatabaseId;
    db = dbId ? getFirestore(app, dbId) : getFirestore(app);
    storage = getStorage(app);
  } catch (err) {
    console.warn('Failed to initialize Firebase services:', err);
  }
}

export { app, auth, db, storage };
export const isFirebaseConfigured = configStatus.isConfigured;
export const missingFirebaseKeys = configStatus.missingKeys;

// Diagnostic Firestore error handler conforming to skill specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
