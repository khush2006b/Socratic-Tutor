/**
 * dashboard.js
 * API client for the dashboard endpoint.
 */

import { apiFetch } from './client.js';

/**
 * Fetch full dashboard data for the authenticated student.
 * @returns {Promise<object>} Dashboard payload
 */
export async function fetchDashboard() {
  const res = await apiFetch('/api/dashboard/me');
  return res.json();
}
