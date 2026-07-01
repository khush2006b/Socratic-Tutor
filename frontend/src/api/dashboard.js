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

/**
 * Refresh the AI-recommended daily question.
 * @returns {Promise<object>} New daily question payload
 */
export async function refreshDailyQuestion() {
  const res = await apiFetch('/api/dashboard/question/refresh', { method: 'POST' });
  return res.json();
}
