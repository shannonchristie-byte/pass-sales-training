/**
 * try-local.js — run the app on this machine with made-up people.
 *
 *   npm run try
 *
 * Switches test sign-in on, adds the made-up people if they are not there
 * yet, then starts the app at http://localhost:3100. Nothing here can run on
 * Render: devLoginEnabled() refuses there.
 */

process.env.TRAINING_DEV_LOGIN = '1';
await import('./seed-dev.js');
await import('../server.js');
