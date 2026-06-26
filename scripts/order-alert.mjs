import { exec } from 'node:child_process';
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
const POLL_INTERVAL_MS = 6000;       // Check every 6 seconds
const ALERT_STATUSES = ['NEW'];      // Which statuses trigger the alert
const ALERT_GAP_MS = 1500;           // Gap between alert repeats (1.5 seconds)

// ─── Resolve sound file path ─────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUND_CANDIDATES = [
  path.join(__dirname, 'swiggy_new_order.mp3.mpeg'),
  path.join(__dirname, '..', 'swiggy_new_order.mp3.mpeg'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'swiggy_new_order.mp3.mpeg'),
  path.join(__dirname, '..', 'public', 'swiggy-new-order.mp3'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'swiggy-new-order.mp3'),
];

let SOUND_FILE = '';
for (const candidate of SOUND_CANDIDATES) {
  if (fs.existsSync(candidate)) {
    SOUND_FILE = candidate;
    break;
  }
}

if (!SOUND_FILE) {
  console.warn('[WARN] No alert sound file found! Sound alerts will not work.');
  console.warn('       Place swiggy_new_order.mp3.mpeg in the same folder as this script.');
}

// ─── State ───────────────────────────────────────────────────
const knownOrderIds = new Set();
let isFirstPoll = true;
let alertActive = false;            // Is the continuous alert currently ringing?
let pendingNewOrderCodes = [];      // Order codes that haven't been acknowledged
let currentAudioProcess = null;     // Reference to current playing audio process

// ─── Play sound using PowerShell (LOUD, full volume) ─────────
const playMp3Once = () =>
  new Promise((resolve) => {
    if (!SOUND_FILE) {
      // Fallback: loud system beeps
      const beepCmd = `powershell -Command "[console]::beep(1200, 600); [console]::beep(1500, 600); [console]::beep(1200, 600)"`;
      const child = exec(beepCmd, { stdio: 'ignore' });
      child.on('close', resolve);
      child.on('error', resolve);
      setTimeout(resolve, 3000);
      return;
    }

    const escaped = SOUND_FILE.replace(/\\/g, '/').replace(/'/g, "''");
    // Use MediaPlayer with volume set to MAX (1.0) and wait for full playback
    const ps = [
      'Add-Type -AssemblyName presentationCore',
      '$player = New-Object System.Windows.Media.MediaPlayer',
      `$player.Open([uri]"file:///${escaped}")`,
      'Start-Sleep -Milliseconds 600',
      '$player.Volume = 1.0',
      '$player.Play()',
      'Start-Sleep -Milliseconds 4500',
      '$player.Stop()',
      '$player.Close()',
    ].join('; ');

    const child = exec(`powershell -Command "${ps}"`, { stdio: 'ignore' });
    currentAudioProcess = child;
    child.on('close', () => {
      if (currentAudioProcess === child) currentAudioProcess = null;
      resolve();
    });
    child.on('error', () => {
      if (currentAudioProcess === child) currentAudioProcess = null;
      resolve();
    });
    // Safety timeout
    setTimeout(resolve, 7000);
  });

// ─── Continuous alert loop — keeps ringing until orders are acknowledged ───
const startContinuousAlert = async () => {
  if (alertActive) return; // Already ringing
  alertActive = true;

  console.log(`[ALERT] 🔔🔔🔔 NEW ORDER(S): ${pendingNewOrderCodes.join(', ')}`);
  console.log(`[ALERT] 🔊 CONTINUOUS ALERT STARTED — will ring until order is accepted!`);

  let ringCount = 0;
  while (alertActive && pendingNewOrderCodes.length > 0) {
    ringCount++;
    console.log(`[ALERT] 🔔 Ring #${ringCount} — Pending orders: ${pendingNewOrderCodes.join(', ')}`);
    await playMp3Once();

    // Small gap between rings
    if (alertActive && pendingNewOrderCodes.length > 0) {
      await new Promise((r) => setTimeout(r, ALERT_GAP_MS));
    }
  }

  alertActive = false;
  console.log(`[ALERT] ✅ Alert stopped after ${ringCount} rings — all orders acknowledged.`);
};

const stopAlert = () => {
  alertActive = false;
  pendingNewOrderCodes = [];
  if (currentAudioProcess) {
    try { currentAudioProcess.kill(); } catch { /* ignore */ }
    currentAudioProcess = null;
  }
};

// ─── Fetch orders from Supabase ──────────────────────────────
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
    const currentNewOrders = orders.filter((o) => ALERT_STATUSES.includes(o.status));

    if (isFirstPoll) {
      // On startup, record existing orders — don't ring
      for (const o of currentNewOrders) {
        knownOrderIds.add(o.id);
      }
      isFirstPoll = false;
      console.log(`[STARTUP] Loaded ${currentNewOrders.length} existing NEW order(s). Watching for new ones...`);
      return;
    }

    // Find orders we haven't seen before
    const brandNewOrders = currentNewOrders.filter((o) => !knownOrderIds.has(o.id));

    if (brandNewOrders.length > 0) {
      for (const o of brandNewOrders) {
        knownOrderIds.add(o.id);
        const code = `#${o.order_code || o.id}`;
        if (!pendingNewOrderCodes.includes(code)) {
          pendingNewOrderCodes.push(code);
        }
      }

      // Start continuous alert (if not already ringing)
      startContinuousAlert();
    }

    // Check if all pending orders have been acknowledged (no longer in NEW status)
    if (pendingNewOrderCodes.length > 0 && currentNewOrders.length === 0) {
      console.log('[ALERT] ✅ All orders have been acknowledged! Stopping alert.');
      stopAlert();
    }

    // Also check: if the orders that triggered alert are no longer NEW
    if (alertActive && currentNewOrders.length === 0) {
      stopAlert();
    }

    // Cleanup: prevent memory leak in knownOrderIds
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
console.log('  BVR ORDER ALERT v2.0 - Continuous Sound');
console.log('============================================');
console.log(`  Supabase:  ${SUPABASE_URL}`);
console.log(`  Sound:     ${SOUND_FILE || '⚠️  NO MP3 FOUND — will use beeps'}`);
console.log(`  Polling:   Every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`  Watching:  ${ALERT_STATUSES.join(', ')} orders`);
console.log(`  Alert:     CONTINUOUS until order accepted`);
console.log(`  Volume:    MAX (1.0)`);
console.log('============================================');
console.log('');
console.log('🔊 Sound will ring NON-STOP when new order');
console.log('   arrives. Stops ONLY when order is accepted');
console.log('   from the owner dashboard.');
console.log('');

// Initial poll
poll();

// Recurring poll
setInterval(poll, POLL_INTERVAL_MS);
