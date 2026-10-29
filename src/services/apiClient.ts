import { auth } from '../lib/firebase.ts';

/**
 * Retrieves the current authentication Bearer token.
 * Returns either a fresh Firebase ID token or a guest token (guest_<uid>).
 */
export async function getAuthToken(): Promise<string | null> {
  // 1. If Firebase user is signed in, get fresh ID token
  if (auth && auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken();
    } catch (err) {
      console.warn('Failed to retrieve fresh Firebase ID token:', err);
    }
  }

  // 2. Check for guest session in localStorage
  try {
    const guestSession = localStorage.getItem('documind_guest_session');
    if (guestSession) {
      const parsed = JSON.parse(guestSession);
      if (parsed?.uid) {
        return parsed.uid.startsWith('guest_') ? parsed.uid : `guest_${parsed.uid}`;
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }

  return null;
}

/**
 * Authenticated fetch wrapper that automatically attaches the Firebase ID token
 * (or guest token) as a Bearer token in the Authorization header.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = await getAuthToken();

  const headers = new Headers(init?.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    if (token.startsWith('guest_')) {
      headers.set('X-Guest-Mode', 'true');
      headers.set('X-Guest-Id', token);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  return response;
}
