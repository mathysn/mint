// Local API server (Vite proxies /api here). Same app as the Vercel function.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.API_PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}/api`));
