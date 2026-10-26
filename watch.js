// Watches Apple Store pickup stock for iPhone Duo 512GB Star White near a ZIP.
//
// Two sources, checked side by side:
// - Apple's own pickup endpoint (what "Check availability" on the buy page
//   uses), asked every few minutes about the stores nearest the ZIP.
// - Duo Stock (duo-checker.on-forge.com), which sweeps every US store every
//   20 minutes. We poll it every 20 seconds around when each sweep publishes.
// Sends a push notification (ntfy) and a Mac notification when it's in stock.
const { execFile } = require('child_process');

const PART = 'MK1G4LL/A'; // iPhone Duo 512GB Star White (US)
const ZIP = process.env.ZIP || '94536';
const MAX_MILES = Number(process.env.MAX_MILES || 100);
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const APPLE = process.env.APPLE !== '0'; // APPLE=0 skips asking Apple directly
const APPLE_API = 'https://www.apple.com/shop/retail/pickup-message';
const APPLE_EVERY_MINUTES = Number(process.env.APPLE_EVERY_MINUTES || 4);
const APPLE_BLOCKED_MINUTES = 30; // wait this long after Apple says slow down
const DUO_STOCK_API = 'https://duo-checker.on-forge.com/api/v1/nearby';
const SWEEP_MINUTES = 20; // Duo Stock sweeps every 20 minutes
const POLL_SECONDS = 20; // poll this often while a sweep is due
const POLL_LATE_MINUTES = 2; // keep polling this long past the expected time
const STALE_MINUTES = 60; // alert if Duo Stock's data is older than this in the daytime
const PRODUCT_URL =
  'https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-512gb-star-white-unlocked';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString();

function macNotify(title, text) {
  const script = `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)} sound name "Glass"`;
  execFile('osascript', ['-e', script], () => {});
}

async function phoneNotify(title, text) {
  if (!NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: title, Priority: 'urgent', Click: PRODUCT_URL },
      body: text,
    });
  } catch (e) {
    console.log(`[${now()}] ntfy failed: ${e.message}`);
  }
}

// When running in GitHub Actions, open an issue assigned to the repo owner so
// the GitHub app on their phone sends a notification.
async function issueNotify(title, text) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ title, body: `${text}\n\n${PRODUCT_URL}`, assignees: [GITHUB_REPOSITORY_OWNER] }),
    });
    if (!res.ok) console.log(`[${now()}] Issue alert failed: HTTP ${res.status}`);
  } catch (e) {
    console.log(`[${now()}] Issue alert failed: ${e.message}`);
  }
}

async function notify(title, text) {
  console.log(`\n*** ${title}\n${text}\n`);
  macNotify(title, text);
  await Promise.all([phoneNotify(title, text), issueNotify(title, text)]);
}

// Ask Apple's pickup endpoint (the one its buy page uses) about the stores
// nearest ZIP. Returns Apple's store list, or { blocked } / null on failure.
async function fetchApple() {
  const url = `${APPLE_API}?pl=true&location=${ZIP}&parts.0=${encodeURIComponent(PART)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        Accept: 'application/json',
        Referer: PRODUCT_URL,
      },
    });
    if (res.status === 541 || res.status === 403 || res.status === 429) {
      console.log(`[${now()}] Apple: HTTP ${res.status}, it's asking us to slow down.`);
      return { blocked: true };
    }
    if (!res.ok) {
      console.log(`[${now()}] Apple: HTTP ${res.status}.`);
      return null;
    }
    const stores = (await res.json())?.body?.stores;
    if (!stores?.length) {
      console.log(`[${now()}] Apple: no stores in the reply.`);
      return null;
    }
    return { stores };
  } catch (e) {
    console.log(`[${now()}] Apple error: ${e.message}`);
    return null;
  }
}

async function watchApple() {
  let lastHit = '';
  let failures = 0;
  for (;;) {
    const r = await fetchApple();
    if (r?.stores) {
      failures = 0;
      const hits = [];
      let farthest = 0;
      for (const s of r.stores) {
        const miles = parseFloat(s.storedistance ?? s.storeDistanceWithUnit ?? 'Infinity');
        farthest = Math.max(farthest, miles);
        const a = s.partsAvailability?.[PART] || {};
        if (a.pickupDisplay === 'available' && miles <= MAX_MILES) {
          hits.push(`${s.storeName} (${s.city}, ${miles} mi): ${a.pickupSearchQuote || 'available'}`);
        }
      }
      console.log(`[${now()}] Apple: ${r.stores.length} stores out to ${farthest} mi: ${hits.length ? hits.join('; ') : 'not in stock nearby'}.`);
      const key = hits.join('|');
      if (hits.length && key !== lastHit) {
        await notify('iPhone Duo 512GB White IN STOCK (Apple)', hits.join('\n'));
      }
      lastHit = key;
    } else if (++failures === 6) {
      await notify('Duo watcher needs a look', "Apple's pickup check has failed 6 times in a row. Duo Stock is still being watched.");
    }

    // Apple limits how often one internet connection can ask, and a block
    // covers every device on it, so back off hard when it says slow down.
    const minutes = r?.blocked ? APPLE_BLOCKED_MINUTES : APPLE_EVERY_MINUTES;
    await sleep((minutes + (Math.random() - 0.5) / 2) * 60000);
  }
}

// One Duo Stock request. Returns the parsed body, or null if it failed.
async function fetchDuoStock() {
  const url = `${DUO_STOCK_API}?zip=${ZIP}&part_number=${encodeURIComponent(PART)}&radius_miles=${MAX_MILES}&available_only=1&limit=50`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 60);
      console.log(`[${now()}] Duo Stock: rate limited, waiting ${wait}s.`);
      await sleep(wait * 1000);
      return null;
    }
    if (!res.ok) {
      console.log(`[${now()}] Duo Stock: HTTP ${res.status}.`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`[${now()}] Duo Stock error: ${e.message}`);
    return null;
  }
}

// True if Duo Stock should be sweeping now. It sweeps 6:30 AM to 9:30 PM
// Eastern; 8 AM to 8 PM leaves room on both ends, whatever clock it uses.
function duoStockDaytime() {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }));
  return hour >= 8 && hour < 20;
}

async function watchDuoStock() {
  let lastRun = '';
  let lastHit = '';
  let failures = 0;
  let staleAlerted = false;
  let due = Date.now(); // when the next sweep should publish

  for (;;) {
    // Sleep until just before the next sweep is due, then poll every
    // POLL_SECONDS until it shows up or we're POLL_LATE_MINUTES past due.
    await sleep(Math.max(0, due - POLL_SECONDS * 1000 - Date.now()));
    let data = null;
    while (Date.now() < due + POLL_LATE_MINUTES * 60000) {
      const d = await fetchDuoStock();
      if (d) failures = 0;
      else if (++failures === 10) {
        await notify('Duo watcher needs a look', 'Duo Stock has failed 10 times in a row. See the Terminal window.');
      }
      if (d) {
        const age = (Date.now() - Date.parse(d.run_finished_at)) / 60000;
        const stale = d.is_stale || (age > STALE_MINUTES && duoStockDaytime());
        if (stale && !staleAlerted) {
          await notify('Duo watcher needs a look', `Duo Stock hasn't updated in ${Math.round(age)} minutes, so stock alerts may be late. Check duo-checker.on-forge.com.`);
        }
        if (stale !== staleAlerted) console.log(`[${now()}] Duo Stock data is ${stale ? 'stale' : 'fresh again'}.`);
        staleAlerted = stale;
      }
      if (d && d.run_id !== lastRun) {
        data = d;
        break;
      }
      await sleep(POLL_SECONDS * 1000);
    }

    if (!data) {
      // No new sweep (overnight, or it ran late). Try again at the next slot.
      due += SWEEP_MINUTES * 60000;
      continue;
    }

    lastRun = data.run_id;
    const started = Date.parse(data.run_started_at);
    const took = Date.parse(data.run_finished_at) - started;
    due = started + SWEEP_MINUTES * 60000 + took;
    while (due < Date.now()) due += SWEEP_MINUTES * 60000;

    const hits = (data.stores || []).map((s) => {
      const p = s.products.find((x) => x.part_number === PART) || {};
      return `${s.name} (${s.city}, ${s.distance_miles} mi): ${p.pickup_message || 'available'}`;
    });
    const sweptAt = new Date(data.run_finished_at).toLocaleTimeString();
    console.log(`[${now()}] Duo Stock sweep from ${sweptAt}: ${hits.length ? hits.join('; ') : 'not in stock nearby'}${data.is_stale ? ' (stale)' : ''}.`);
    const key = hits.join('|');
    if (hits.length && key !== lastHit) {
      await notify('iPhone Duo 512GB White IN STOCK (Duo Stock)', hits.join('\n'));
    }
    lastHit = key;
  }
}

async function main() {
  console.log(`Watching ${PART} within ${MAX_MILES} mi of ${ZIP}.`);
  console.log(`Duo Stock every ${POLL_SECONDS}s around each ${SWEEP_MINUTES}-min sweep.`);
  if (APPLE) console.log(`Apple directly about every ${APPLE_EVERY_MINUTES} min (nearest ~12 stores).`);
  console.log('Press Ctrl+C to stop.\n');
  if (process.env.TEST_ALERT === '1') {
    await notify('Duo watcher test alert', `If you see this, alerts work. Watching Star White 512GB within ${MAX_MILES} mi of ${ZIP}.`);
  }
  await Promise.all([APPLE && watchApple(), watchDuoStock()]);
}

main();
