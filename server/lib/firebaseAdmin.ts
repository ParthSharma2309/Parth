import fs from 'fs';
import path from 'path';
import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { logger } from './logger.js';

export class AuthNotConfiguredError extends Error {
  constructor(message = 'Firebase Auth is not configured: missing project ID.') {
    super(message);
    this.name = 'AuthNotConfiguredError';
    Object.setPrototypeOf(this, AuthNotConfiguredError.prototype);
  }
}

export type AuthPrincipal =
  | { kind: 'user'; uid: string; email?: string; emailVerified: boolean; isGuest: false }
  | { kind: 'guest'; isGuest: true; uid?: undefined };

export type DecodedAuthUser = AuthPrincipal;

let adminAuth: Auth | null = null;
let adminFirestore: Firestore | null = null;
let appInstance: App | null = null;

function loadAppletConfig(): any | null {
  if (process.env.FIREBASE_DISABLE_APPLET_CONFIG === 'true') {
    return null;
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}
  return null;
}

function parseServiceAccount(): any | null {
  // Format 1: Complete JSON string or base64-encoded JSON in FIREBASE_SERVICE_ACCOUNT
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) {
    try {
      const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      return JSON.parse(jsonStr);
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON'
      );
      return null;
    }
  }

  // Format 2: Discrete credentials via FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey) {
    const projectId = resolveProjectId();
    return {
      projectId,
      project_id: projectId,
      clientEmail,
      client_email: clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

export function resolveProjectId(serviceAccount?: any): string | undefined {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  if (process.env.VITE_FIREBASE_PROJECT_ID?.trim()) {
    return process.env.VITE_FIREBASE_PROJECT_ID.trim();
  }
  if (serviceAccount && typeof serviceAccount.project_id === 'string' && serviceAccount.project_id.trim()) {
    return serviceAccount.project_id.trim();
  }
  const appletCfg = loadAppletConfig();
  if (appletCfg?.projectId) {
    return appletCfg.projectId;
  }
  return undefined;
}

export function isFirebaseAuthConfigured(): { configured: boolean; projectId?: string } {
  if (getApps().length > 0) {
    const existing = getApps()[0];
    const pId = existing.options?.projectId || resolveProjectId();
    return { configured: Boolean(pId), projectId: pId || undefined };
  }
  const sa = parseServiceAccount();
  const pId = resolveProjectId(sa);
  return { configured: Boolean(pId), projectId: pId };
}

export function getAdminAuth(): Auth | null {
  if (adminAuth) return adminAuth;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    appInstance = existingApps[0];
    adminAuth = getAuth(appInstance);
    return adminAuth;
  }

  const serviceAccount = parseServiceAccount();
  const projectId = resolveProjectId(serviceAccount);

  if (!projectId) {
    return null;
  }

  try {
    if (serviceAccount) {
      appInstance = initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
    } else {
      appInstance = initializeApp({ projectId });
    }
    adminAuth = getAuth(appInstance);
    return adminAuth;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to initialize Firebase Admin app');
    return null;
  }
}

export function getAdminFirestore(): Firestore | null {
  if (adminFirestore) return adminFirestore;
  getAdminAuth();
  if (!appInstance) return null;
  try {
    const appletCfg = loadAppletConfig();
    const dbId = process.env.FIREBASE_DATABASE_ID || appletCfg?.firestoreDatabaseId;
    adminFirestore = dbId ? getFirestore(appInstance, dbId) : getFirestore(appInstance);
    return adminFirestore;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to initialize Firebase Admin Firestore');
    return null;
  }
}

export function setAdminFirestoreForTesting(instance: Firestore | null): void {
  adminFirestore = instance;
}

export async function verifyAuthToken(token: string): Promise<AuthPrincipal> {
  const clean = token.trim();
  const authStatus = isFirebaseAuthConfigured();
  if (!authStatus.configured) {
    throw new AuthNotConfiguredError();
  }
  const auth = getAdminAuth();
  if (!auth) {
    throw new AuthNotConfiguredError();
  }

  const decoded = await auth.verifyIdToken(clean);
  return {
    kind: 'user',
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: Boolean(decoded.email_verified),
    isGuest: false,
  };
}
