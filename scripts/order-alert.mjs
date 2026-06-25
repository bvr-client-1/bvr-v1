import { execSync, exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
});

// ─── Configuration ───────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://feglxiibeuzsahoevzuu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlZ2x4aWliZXV6c2Fob2V2enV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIxODczMywiZXhwIjoyMDg4Nzk0NzMzfQ.e3xVmckMyEij5GXTw52B1QzpAKvtosJqiggmOfn8sFg';
const POLL_INTERVAL_MS = 8000; // Check every 8 seconds
const ALERT_REPEAT_COUNT = 5;  // Ring 5 times for each new order batch
const ALERT_STATUSES = ['NEW']; // Which statuses trigger the alert

// ─── Resolve sound file path ─────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUND_CANDIDATES = [
  path.join(__dirname, 'swiggy_new_order.mp3.mpeg'),
  path.join(__dirname, '..', 'swiggy_new_order.mp3.mpeg'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'swiggy_new_order.mp3.mpeg'),
];

let SOUND_FILE = '';
for (const candidate of SOUND_CANDIDATES) {
  if (fs.existsSync(candidate)) {
    SOUND_FILE = candidate;
    break;
  }
}

if (!SOUND_FILE) {
  console.warn('[WARN] No alert sound file found. Will use system beep instead.');
  console.warn('       Place swiggy_new_order.mp3.mpeg in the same folder as this script.');
}

// ─── Track known orders ──────────────────────────────────────
const knownOrderIds = new Set();
let isFirstPoll = true;
let alertPlaying = false;

// ─── Play alert sound ────────────────────────────────────────
const playSystemBeep = () => {
  try {
    execSync('powershell -Command "[console]::beep(1000, 800)"', { stdio: 'ignore' });
  } catch { /* ignore */ }
};

const playMp3Once = (filePath) =>
  new Promise((resolve) => {
    const escaped = filePath.replace(/'/g, "''");
    const ps = `
      Add-Type -AssemblyName presentationCore
      $player = New-Object System.Windows.Media.MediaPlayer
      $player.Open([uri]"file:///${escaped.replace(/\\/g, '/')}")
      Start-Sleep -Milliseconds 500
      $player.Play()
      Start-Sleep -Milliseconds 4000
      $player.Stop()
      $player.Close()
    `;
    const child = exec(`powershell -Command "${ps.replace(/\n/g, '; ')}"`, { stdio: 'ignore' });
    child.on('close', resolve);
    child.on('error', resolve);
    // Safety timeout
    setTimeout(resolve, 6000);
  });

const playAlertLoop = async (count, orderCodes) => {
  if (alertPlaying) return;
  alertPlaying = true;

  console.log(`[ALERT] 🔔 NEW ORDER(S): ${orderCodes.join(', ')} — ringing ${count} times...`);

  for (let i = 0; i < count; i++) {
    if (SOUND_FILE) {
      await playMp3Once(SOUND_FILE);
    } else {
      playSystemBeep();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  alertPlaying = false;
};

// ─── Fetch new orders from Supabase ──────────────────────────
const fetchNewOrders = async () => {
  const statusFilter = ALERT_STATUSES.map((s) => `"${s}"`).join(',');
  const url = `${SUPABASE_URL}/rest/v1/orders?status=in.(${statusFilter})&order=created_at.desc&limit=50`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

// ─── Main polling loop ───────────────────────────────────────
const poll = async () => {
  try {
    const orders = await fetchNewOrders();
    const currentIds = new Set(orders.map((o) => o.id));

    if (isFirstPoll) {
      // On startup, just record existing orders — don't ring
      for (const id of currentIds) {
        knownOrderIds.add(id);
      }
      isFirstPoll = false;
      console.log(`[STARTUP] Loaded ${currentIds.size} existing order(s). Watching for new ones...`);
      return;
    }

    // Find orders we haven't seen before
    const newOrders = orders.filter((o) => !knownOrderIds.has(o.id));

    if (newOrders.length > 0) {
      const newCodes = newOrders.map((o) => `#${o.order_code || o.id}`);

      // Add to known set
      for (const o of newOrders) {
        knownOrderIds.add(o.id);
      }

      // Ring the alert
      playAlertLoop(ALERT_REPEAT_COUNT, newCodes);
    }

    // Also add current IDs (in case orders moved to another status and back)
    for (const id of currentIds) {
      knownOrderIds.add(id);
    }

    // Cleanup: remove orders older than 24h from tracking set (prevent memory leak)
    if (knownOrderIds.size > 500) {
      const idsArray = [...knownOrderIds];
      const toRemove = idsArray.slice(0, idsArray.length - 200);
      for (const id of toRemove) {
        knownOrderIds.delete(id);
      }
    }
  } catch (error) {
    console.error('[POLL ERROR]', error.message);
  }
};

// ─── Start ───────────────────────────────────────────────────
console.log('============================================');
console.log('  BVR ORDER ALERT - New Order Sound Monitor');
console.log('============================================');
console.log(`  Supabase:  ${SUPABASE_URL}`);
console.log(`  Sound:     ${SOUND_FILE || 'System beep (no MP3 found)'}`);
console.log(`  Polling:   Every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`  Watching:  ${ALERT_STATUSES.join(', ')} orders`);
console.log('============================================');
console.log('');

// Initial poll
poll();

// Recurring poll
setInterval(poll, POLL_INTERVAL_MS);
