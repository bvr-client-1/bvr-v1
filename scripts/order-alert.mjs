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
const POLL_INTERVAL_MS = 5000;       // Check every 5 seconds
const ALERT_GAP_MS = 800;            // Gap between alert repeats (0.8 seconds)

// ─── Resolve sound file path ─────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUND_CANDIDATES = [
  // Look for .mp3 first (user's preferred file)
  path.join(process.env.USERPROFILE || '', 'Downloads', 'swiggy_new_order.mp3'),
  path.join(__dirname, 'swiggy_new_order.mp3'),
  path.join(__dirname, '..', 'public', 'swiggy-new-order.mp3'),
  // Then look for .mpeg variant
  path.join(process.env.USERPROFILE || '', 'Downloads', 'swiggy_new_order.mp3.mpeg'),
  path.join(__dirname, 'swiggy_new_order.mp3.mpeg'),
  path.join(__dirname, '..', 'swiggy_new_order.mp3.mpeg'),
];

let SOUND_FILE = '';
for (const candidate of SOUND_CANDIDATES) {
  if (fs.existsSync(candidate)) {
    SOUND_FILE = candidate;
    break;
  }
}

if (!SOUND_FILE) {
  console.error('============================================');
  console.error('  ⚠️  NO SOUND FILE FOUND!');
  console.error('  Place swiggy_new_order.mp3 in Downloads');
  console.error('============================================');
}

// ─── State ───────────────────────────────────────────────────
const knownOrderIds = new Set();
let isFirstPoll = true;
let alertActive = false;
let currentAudioProcess = null;

// ─── Play sound using PowerShell (LOUD, full volume) ─────────
const playMp3Once = () =>
  new Promise((resolve) => {
    if (!SOUND_FILE) {
      // Fallback: loud system beeps
      const child = exec(
        'powershell -Command "[console]::beep(1200, 600); [console]::beep(1500, 600); [console]::beep(1200, 600)"',
        { stdio: 'ignore' },
      );
      child.on('close', resolve);
      child.on('error', resolve);
      setTimeout(resolve, 3000);
      return;
    }

    const escaped = SOUND_FILE.replace(/\\/g, '/').replace(/'/g, "''");
    const ps = [
      'Add-Type -AssemblyName presentationCore',
      '$player = New-Object System.Windows.Media.MediaPlayer',
      `$player.Open([uri]"file:///${escaped}")`,
      'Start-Sleep -Milliseconds 500',
      '$player.Volume = 1.0',
      '$player.Play()',
      'Start-Sleep -Milliseconds 4000',
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
    setTimeout(resolve, 6000);
  });

// ─── Continuous alert — rings until order is accepted/cancelled ───
const startContinuousAlert = async (orderCodes) => {
  if (alertActive) return;
  alertActive = true;

  console.log(`[ALERT] 🔔🔔🔔 NEW ORDER(S): ${orderCodes.join(', ')}`);
  console.log(`[ALERT] 🔊 RINGING NON-STOP until order is accepted or cancelled!`);

  let ringCount = 0;
  while (alertActive) {
    ringCount++;
    console.log(`[ALERT] 🔔 Ring #${ringCount}`);
    await playMp3Once();

    if (alertActive) {
      await new Promise((r) => setTimeout(r, ALERT_GAP_MS));
    }
  }

  console.log(`[ALERT] ✅ Alert stopped after ${ringCount} rings.`);
};

const stopAlert = () => {
  if (!alertActive) return;
  alertActive = false;
  console.log('[ALERT] ✅ Order accepted/cancelled — STOPPING sound!');
  if (currentAudioProcess) {
    try { currentAudioProcess.kill(); } catch { /* ignore */ }
    currentAudioProcess = null;
  }
};

// ─── Fetch NEW orders from Supabase ──────────────────────────
const fetchNewStatusOrders = async () => {
  const url = `${SUPABASE_URL}/rest/v1/orders?status=eq.NEW&order=created_at.desc&limit=50`;

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
    const orders = await fetchNewStatusOrders();

    if (isFirstPoll) {
      for (const o of orders) {
        knownOrderIds.add(o.id);
      }
      isFirstPoll = false;
      console.log(`[STARTUP] ${orders.length} existing NEW order(s). Watching for new ones...`);
      return;
    }

    // Find brand new orders we haven't alerted for
    const brandNewOrders = orders.filter((o) => !knownOrderIds.has(o.id));

    if (brandNewOrders.length > 0) {
      const codes = brandNewOrders.map((o) => `#${o.order_code || o.id}`);
      for (const o of brandNewOrders) {
        knownOrderIds.add(o.id);
      }
      // Start continuous alert
      startContinuousAlert(codes);
    }

    // If alert is ringing but NO orders are in NEW status anymore → STOP
    // This means someone clicked Accept or Cancel in the dashboard
    if (alertActive && orders.length === 0) {
      stopAlert();
    }

    // Cleanup old IDs to prevent memory leak
    if (knownOrderIds.size > 500) {
      const arr = [...knownOrderIds];
      for (const id of arr.slice(0, arr.length - 200)) {
        knownOrderIds.delete(id);
      }
    }
  } catch (error) {
    console.error('[POLL ERROR]', error.message);
  }
};

// ─── Start ───────────────────────────────────────────────────
console.log('============================================');
console.log('  BVR ORDER ALERT v2.0');
console.log('  Continuous Sound - Like Swiggy/Zomato');
console.log('============================================');
console.log(`  Sound:     ${SOUND_FILE || '⚠️  NOT FOUND'}`);
console.log(`  Polling:   Every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`  Volume:    MAX`);
console.log(`  Stops:     When Accept or Cancel clicked`);
console.log('============================================');
console.log('');

// Initial poll, then recurring
poll();
setInterval(poll, POLL_INTERVAL_MS);
