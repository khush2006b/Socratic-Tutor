/**
 * api/notes.js
 * Notes API — fetch and create session notes.
 */
import { apiFetch } from './client.js';

/** Fetch all notes for the authenticated student */
export async function fetchNotes(category = null) {
  const params = category ? `?category=${category}` : '';
  const res = await apiFetch(`/api/notes/me${params}`);
  return res.json();
}

/** Fetch notes for a specific session */
export async function fetchSessionNotes(sessionId) {
  const res = await apiFetch(`/api/notes/session/${sessionId}`);
  return res.json();
}
