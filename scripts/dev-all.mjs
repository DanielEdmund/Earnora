#!/usr/bin/env node
// One command keeps BOTH dev servers alive:
//
//   npm run dev        → API (nest --watch, :3000) + web (next dev, :3001)
//
// If either process dies, it is restarted automatically (the recurring cause
// of "Failed to fetch" was the API process silently going away). Windows- and
// POSIX-aware tree-kill so no orphaned node processes are left holding ports.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const SERVICES = [
  { name: 'api', args: ['run', 'start:dev'], cwd: ROOT },
  { name: 'web', args: ['run', 'dev'], cwd: path.join(ROOT, 'web') },
];

/** @type {Map<string, import('node:child_process').ChildProcess>} */
const children = new Map();
/** restart timestamps per service, for the crash-loop guard */
const restarts = new Map();
let stopping = false;

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

function start(service) {
  const child = spawn('npm', service.args, {
    cwd: service.cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  children.set(service.name, child);

  child.on('exit', (code, signal) => {
    if (stopping) return;
    const now = Date.now();
    const recent = (restarts.get(service.name) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    restarts.set(service.name, recent);

    if (recent.length > 5) {
      console.error(
        `\n[dev] ${service.name} keeps dying (${recent.length} restarts in the last minute) — ` +
          'stopping here so the error above stays visible. Fix it and rerun `npm run dev`.',
      );
      return;
    }
    console.log(`\n[dev] ${service.name} exited (code=${code ?? signal}) — restarting in 2s…`);
    setTimeout(() => {
      if (!stopping) start(service);
    }, 2000);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) killTree(child);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  stopping = true;
  for (const child of children.values()) killTree(child);
});

console.log('[dev] starting API (:3000) + web (:3001) — web auto-restarts either if it dies.');
console.log('[dev] PC: http://localhost:3001   Phone: http://<this-computer-IP>:3001');
for (const service of SERVICES) start(service);
