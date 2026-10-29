import { vi } from 'vitest';

export const mockVerifyIdToken = vi.fn().mockImplementation(async (token: string) => {
  if (token === 'valid-user-a' || token === 'valid-user-b') {
    return {
      uid: token,
      email: `${token}@documind.test`,
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
    };
  }
  if (token === 'expired-token') {
    const err: any = new Error('Firebase ID token has expired.');
    err.code = 'auth/id-token-expired';
    throw err;
  }
  const err: any = new Error(`Firebase ID token verification failed: ${token}`);
  err.code = 'auth/argument-error';
  throw err;
});

export const mockAuthInstance = {
  verifyIdToken: mockVerifyIdToken,
};

let currentApps: any[] = [
  {
    name: '[DEFAULT]',
    options: {
      projectId: process.env.FIREBASE_PROJECT_ID || 'test-project',
    },
  },
];

export const mockGetApps = vi.fn(() => currentApps);
export const mockInitializeApp = vi.fn((options?: any) => {
  const app = {
    name: '[DEFAULT]',
    options: options || { projectId: process.env.FIREBASE_PROJECT_ID || 'test-project' },
  };
  currentApps = [app];
  return app;
});

export function setMockApps(apps: any[]) {
  currentApps = apps;
}

vi.mock('firebase-admin/app', () => ({
  getApps: () => mockGetApps(),
  initializeApp: (opts?: any) => mockInitializeApp(opts),
  cert: vi.fn((c) => c),
  applicationDefault: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => mockAuthInstance),
}));
