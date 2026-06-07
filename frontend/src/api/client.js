/**
 * client.js
 * Shared API client — single source of truth for base URL, auth headers, and fetch wrapper.
 * All API modules (tutor.js, notes.js) and components import from here.
 */

import useAuthStore from '../store/authStore';

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

/** Returns Authorization header if user is authenticated, else empty object. */
export function getAuthHeaders() {
  try {
    const token = useAuthStore.getState().accessToken();
    if (token) return { Authorization: `Bearer ${token}` };
  } catch { /* no-op during SSR / before init */ }
  return {};
}

/**
 * Fetch wrapper with auth headers, JSON content type, and error handling.
 * @param {string} path - API path (e.g. '/api/notes/me')
 * @param {object} options - fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let detail = `API error ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  return res;
}
