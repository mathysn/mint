// pnpm dev: API (tsx watch, :3000) + Vite (:5173, proxies /api). Needs `pnpm db:local` (or a Neon URL in .env).
import { spawn } from 'node:child_process';

// `shell: true` puts a cmd.exe between us and node on Windows: killing the child only kills that
// shell, so stop the whole process tree, and stop both servers as soon as one of them exits.
const killTree = (child) => {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  children.forEach(killTree);
  setTimeout(() => process.exit(code), 800);
};

const run = (name, args) => {
  const child = spawn('pnpm', args, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    stop(code ?? 0);
  });
  return child;
};

const children = [run('api', ['dev:api']), run('web', ['dev:web'])];
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));
