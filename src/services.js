/**
 * services.js — the services the sales team sells.
 *
 * One list, read by both halves. The knowledge base shows every service to
 * everybody. Training and development only opens a service's courses once
 * Shannon or Poppy has switched it on for that person, because people are
 * trained on one service at a time.
 *
 * MME is left out on purpose (Shannon, 28 Oct 2026).
 */

export const SERVICES = [
  { key: 'pfs', name: 'Pass Functional Skills', short: 'PFS' },
  { key: 'astar', name: 'A Star Equivalency', short: 'A Star' },
  { key: 'pmg', name: 'Pass GCSE', short: 'Pass GCSE' },
  { key: 'alevel', name: 'Pass A Level', short: 'A Level' },
  { key: 'access', name: 'Access to HE', short: 'Access' },
  { key: 'exams', name: 'Online international exams', short: 'Online exams' },
];

export const SERVICE_KEYS = SERVICES.map((s) => s.key);

export const isService = (key) => SERVICE_KEYS.includes(key);
