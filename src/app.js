/**
 * app.js — builds the Express app.
 *
 * Kept apart from server.js so the tests can drive the whole API against an
 * in-memory database, with a pretend B2C Sales app standing in for the real
 * one, and nothing listening on a port.
 */

import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachPerson, handoffConfig, devLoginEnabled, redeemWithB2C } from './auth.js';
import { handoffRoutes, authApi } from './routes/auth.js';
import { peopleRoutes } from './routes/people.js';
import { trainingRoutes } from './routes/training.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { coachingRoutes } from './routes/coaching.js';
import { performanceRoutes } from './routes/performance.js';
import { courseRoutes } from './routes/courses.js';
import { b2cFeed } from './b2c-feed.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createApp({
  db,
  config = handoffConfig(),
  devLogin = devLoginEnabled(),
  redeem = redeemWithB2C,
  feed = b2cFeed(config),
  askModel,
  quiet = false,
} = {}) {
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(attachPerson(db));

  if (!quiet) {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        res.on('finish', () => {
          if (res.statusCode >= 400) console.warn(`  ${res.statusCode} ${req.method} ${req.path} (${req.person?.name || 'not signed in'})`);
        });
      }
      next();
    });
  }

  app.use('/auth', handoffRoutes(db, { config, redeem }));
  app.use('/api/auth', authApi(db, { config, devLogin }));
  app.use('/api/people', peopleRoutes(db, { feed }));
  app.use('/api/training', trainingRoutes(db));
  app.use('/api/knowledge', knowledgeRoutes(db, askModel ? { askModel } : {}));
  app.use('/api/coaching', coachingRoutes(db));
  app.use('/api/performance', performanceRoutes(db, { feed }));
  app.use('/api/courses', courseRoutes(db));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      people: db.prepare("SELECT COUNT(*) AS n FROM people WHERE status = 'active'").get().n,
      signIn: config.ready ? 'b2c' : devLogin ? 'dev' : 'not set up',
    });
  });

  app.use(express.static(resolve(here, '..', 'public'), { extensions: ['html'] }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No such endpoint.' });
    res.sendFile(resolve(here, '..', 'public', 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong at our end. The details are in the server window.' });
  });

  return app;
}
