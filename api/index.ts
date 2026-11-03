// Vercel Function entry: every /api/* request is rewritten here (vercel.json) and handled by Hono.
import { app } from '../server/app.js';

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
