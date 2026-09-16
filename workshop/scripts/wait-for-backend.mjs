import { setTimeout } from 'node:timers/promises';

const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* The server may still be starting. */ }
  await setTimeout(250);
}
if (!ready) {
  console.error('The backend did not start within 60 seconds. Check the server output and workshop/.env.');
  process.exitCode = 1;
}
