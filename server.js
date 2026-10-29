/**
 * server.js — starts the app.
 *
 *   npm start                 http://localhost:3100
 *   PORT=8080 npm start       a different port
 *
 * Port 3100 so it can run beside the B2C Sales app (3000) on the same machine.
 */

import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { purgeExpired, handoffConfig, devLoginEnabled } from './src/auth.js';
import { loadNewPages } from './src/content.js';
import { loadTrainingContent } from './src/training-content.js';

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1';

const db = openDb();
const config = handoffConfig();
const devLogin = devLoginEnabled();

const added = loadNewPages(db);
if (added) console.log(`  Added ${added} knowledge base page${added === 1 ? '' : 's'} from the content folder.`);
const t = loadTrainingContent(db);
if (t.stages + t.resources + t.questions) console.log(`  Added ${t.stages} plan stages, ${t.resources} training resources and ${t.questions} quiz questions from the training folder.`);

purgeExpired(db);
setInterval(() => purgeExpired(db), 60 * 60 * 1000).unref();

createApp({ db, config, devLogin }).listen(PORT, HOST, () => {
  console.log('\n  Sales training is running.\n');
  console.log(`    http://localhost:${PORT}`);
  if (config.ready) console.log(`    Sign-in through the B2C Sales app at ${config.b2cUrl}`);
  else if (devLogin) console.log('    Test sign-in is on (made-up people only). Run  npm run seed:dev  to add them.');
  else console.log('    Sign-in is not set up yet: B2C_URL, PUBLIC_URL and HANDOFF_KEY are needed.');
  console.log('\n  Leave this window open. Press Ctrl+C to stop.\n');
});
