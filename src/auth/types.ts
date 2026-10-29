import { User as FirebaseUser } from 'firebase/auth';

export interface GuestUser {
  uid: string;
  email: null;
  displayName: string;
  photoURL: null;
  emailVerified: boolean;
  isAnonymous: boolean;
  isGuest: true;
}

export type AuthUser = FirebaseUser | GuestUser;

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isGuest: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string, rememberMe?: boolean) => Promise<void>;
  signInWithGoogle: (rememberMe?: boolean) => Promise<void>;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerification: () => Promise<void>;
  updateProfile: (data: { displayName?: string; photoURL?: string }) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  upgradeGuestAccount: (email: string, password: string, displayName?: string) => Promise<void>;
}
