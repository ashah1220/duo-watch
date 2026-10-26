// Watches Apple Store pickup stock for iPhone Duo 512GB (Star White or Night Sky) near a ZIP.
//
// Two sources, checked side by side:
// - Apple's own pickup endpoint (what "Check availability" on the buy page
//   uses), asked every few minutes about the stores nearest the ZIP.
// - Duo Stock (duo-checker.on-forge.com), which sweeps every US store every
//   20 minutes. We poll it every 20 seconds around when each sweep publishes.
// Sends a push notification (ntfy) and a Mac notification when it's in stock.
const { execFile } = require('child_process');

// The iPhone Duo 512GB models to watch (US part numbers).
const BUY_URL = 'https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-512gb';
const PARTS = {
  'MK1G4LL/A': { color: 'Star White', url: `${BUY_URL}-star-white-unlocked` },
  'MK1H4LL/A': { color: 'Night Sky', url: `${BUY_URL}-night-sky-unlocked` },
};
const ZIP = process.env.ZIP || '94536';
const MAX_MILES = Number(process.env.MAX_MILES || 100);
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const STATUS_TOPIC = process.env.STATUS_TOPIC || ''; // optional ntfy topic for every check's result
const APPLE = process.env.APPLE !== '0'; // APPLE=0 skips asking Apple directly
const APPLE_API = 'https://www.apple.com/shop/retail/pickup-message';
// Apple answers with the ~12 stores nearest the ZIP asked about. Rotating
// through these covers every store within 100 miles of 94536: Vacaville adds
// Sacramento, Roseville, Santa Rosa, Marin and SF; Salinas adds Monterey and
// Modesto. The home ZIP comes up every other check.
const APPLE_ZIPS = (process.env.APPLE_ZIPS || `${ZIP},95688,${ZIP},93901`).split(',');
const APPLE_EVERY_MINUTES = Number(process.env.APPLE_EVERY_MINUTES || 2);
const APPLE_MAX_MINUTES = 6; // slowest we'll go after Apple says slow down
const APPLE_BLOCKED_MINUTES = 30; // wait this long after Apple says slow down
const APPLE_REALERT_MINUTES = 30; // don't re-alert a store/color still in stock sooner
// Distances are measured from here (the center of 94536), not from the ZIP
// Apple was asked about.
const HOME = [Number(process.env.HOME_LAT || 37.563), Number(process.env.HOME_LON || -122.0101)];
const DUO_STOCK_API = 'https://duo-checker.on-forge.com/api/v1/nearby';
const SWEEP_MINUTES = 20; // Duo Stock sweeps every 20 minutes
const POLL_SECONDS = 20; // poll this often while a sweep is due
const POLL_LATE_MINUTES = 2; // keep polling this long past the expected time
const STALE_MINUTES = 60; // alert if Duo Stock's data is older than this in the daytime
const PRODUCT_URL = PARTS['MK1G4LL/A'].url;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString();

// Turn in-stock finds ({ part, line }) into one alert naming the colors.
async function notifyHits(hits, source) {
  const colors = [...new Set(hits.map((h) => PARTS[h.part].color))];
  await notify(`iPhone Duo 512GB ${colors.join(' + ')} IN STOCK (${source})`, hits.map((h) => h.line).join('\n'), PARTS[hits[0].part].url);
}

// Log one check's result, and copy it to STATUS_TOPIC so it can be read
// while the watcher runs (GitHub only shows logs once a run ends).
function status(line) {
  console.log(`[${now()}] ${line}`);
  if (!STATUS_TOPIC) return;
  fetch(`https://ntfy.sh/${encodeURIComponent(STATUS_TOPIC)}`, {
    method: 'POST',
    headers: { Priority: 'min' },
    body: `${new Date().toISOString().slice(11, 19)}Z ${line}`,
  }).catch(() => {});
}

function macNotify(title, text) {
  const script = `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)} sound name "Glass"`;
  execFile('osascript', ['-e', script], () => {});
}

async function phoneNotify(title, text, url) {
  if (!NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: title, Priority: 'urgent', Click: url },
      body: text,
    });
  } catch (e) {
    console.log(`[${now()}] ntfy failed: ${e.message}`);
  }
}

// When running in GitHub Actions, open an issue assigned to the repo owner so
// the GitHub app on their phone sends a notification.
async function issueNotify(title, text, url) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ title, body: `${text}\n\n${url}`, assignees: [GITHUB_REPOSITORY_OWNER] }),
    });
    if (!res.ok) console.log(`[${now()}] Issue alert failed: HTTP ${res.status}`);
  } catch (e) {
    console.log(`[${now()}] Issue alert failed: ${e.message}`);
  }
}

async function notify(title, text, url = PRODUCT_URL) {
  console.log(`\n*** ${title}\n${text}\n`);
  macNotify(title, text);
  await Promise.all([phoneNotify(title, text, url), issueNotify(title, text, url)]);
}

// Straight-line miles between two [lat, lon] points.
function milesBetween([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 3959 * Math.asin(Math.sqrt(h));
}

// Ask Apple's pickup endpoint (the one its buy page uses) about the stores
// nearest zip. Returns Apple's store list, or { blocked } / null on failure.
async function fetchApple(zip) {
  const parts = Object.keys(PARTS).map((p, i) => `&parts.${i}=${encodeURIComponent(p)}`).join('');
  const url = `${APPLE_API}?pl=true&location=${zip}${parts}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        Accept: 'application/json',
        Referer: PRODUCT_URL,
      },
    });
    if (res.status === 541 || res.status === 403 || res.status === 429) {
      status(`Apple ${zip}: HTTP ${res.status}, it's asking us to slow down.`);
      return { blocked: true };
    }
    if (!res.ok) {
      status(`Apple ${zip}: HTTP ${res.status}.`);
      return null;
    }
    const stores = (await res.json())?.body?.stores;
    if (!stores?.length) {
      status(`Apple ${zip}: no stores in the reply.`);
      return null;
    }
    return { stores };
  } catch (e) {
    status(`Apple ${zip} error: ${e.message}`);
    return null;
  }
}

async function watchApple() {
  const alerted = new Map(); // "store|part" -> when we last alerted it
  let every = APPLE_EVERY_MINUTES;
  let failures = 0;
  for (let n = 0; ; n++) {
    const zip = APPLE_ZIPS[n % APPLE_ZIPS.length];
    const r = await fetchApple(zip);
    if (r?.stores) {
      failures = 0;
      const hits = [];
      let farthest = 0;
      for (const s of r.stores) {
        const at = [Number(s.storelatitude), Number(s.storelongitude)];
        const miles = Number.isFinite(at[0] + at[1]) ? Math.round(milesBetween(HOME, at) * 10) / 10 : parseFloat(s.storedistance);
        farthest = Math.max(farthest, miles);
        for (const part in PARTS) {
          const a = s.partsAvailability?.[part] || {};
          const key = `${s.storeNumber}|${part}`;
          if (a.pickupDisplay !== 'available') alerted.delete(key);
          else if (miles <= MAX_MILES) {
            hits.push({ key, part, line: `${PARTS[part].color}: ${s.storeName} (${s.city}, ${miles} mi): ${a.pickupSearchQuote || 'available'}` });
          }
        }
      }
      const lines = hits.map((h) => h.line);
      status(`Apple ${zip}: ${r.stores.length} stores out to ${farthest} mi: ${hits.length ? lines.join('; ') : 'not in stock nearby'}.`);
      // The same store shows up in several ZIPs' answers, so remember what
      // we've already alerted instead of comparing with the last answer.
      const fresh = hits.filter((h) => !(Date.now() - alerted.get(h.key) < APPLE_REALERT_MINUTES * 60000));
      if (fresh.length) {
        fresh.forEach((h) => alerted.set(h.key, Date.now()));
        await notifyHits(fresh, 'Apple');
      }
    } else if (++failures === 6) {
      await notify('Duo watcher needs a look', "Apple's pickup check has failed 6 times in a row. Duo Stock is still being watched.");
    }

    // Apple limits how often one internet connection can ask, and a block
    // covers every device on it, so back off hard when it says slow down,
    // then keep a slower pace.
    if (r?.blocked) {
      every = Math.min(every + 1, APPLE_MAX_MINUTES);
      status(`Apple: pausing ${APPLE_BLOCKED_MINUTES} min, then checking every ${every} min.`);
    }
    const minutes = r?.blocked ? APPLE_BLOCKED_MINUTES : every;
    await sleep((minutes + (Math.random() - 0.5) / 4) * 60000);
  }
}

// One Duo Stock request. Returns the parsed body, or null if it failed.
async function fetchDuoStock() {
  const url = `${DUO_STOCK_API}?zip=${ZIP}&storage_gb=512&radius_miles=${MAX_MILES}&available_only=1&limit=50`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 60);
      status(`Duo Stock: rate limited, waiting ${wait}s.`);
      await sleep(wait * 1000);
      return null;
    }
    if (!res.ok) {
      status(`Duo Stock: HTTP ${res.status}.`);
      return null;
    }
    return await res.json();
  } catch (e) {
    status(`Duo Stock error: ${e.message}`);
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
        if (stale !== staleAlerted) status(`Duo Stock data is ${stale ? 'stale' : 'fresh again'}.`);
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

    const hits = (data.stores || []).flatMap((s) =>
      s.products
        .filter((p) => PARTS[p.part_number] && p.pickup_status === 'available')
        .map((p) => ({ part: p.part_number, line: `${PARTS[p.part_number].color}: ${s.name} (${s.city}, ${s.distance_miles} mi): ${p.pickup_message || 'available'}` })),
    );
    const lines = hits.map((h) => h.line);
    const sweptAt = new Date(data.run_finished_at).toLocaleTimeString();
    status(`Duo Stock sweep from ${sweptAt}: ${hits.length ? lines.join('; ') : 'not in stock nearby'}${data.is_stale ? ' (stale)' : ''}.`);
    const key = lines.join('|');
    if (hits.length && key !== lastHit) await notifyHits(hits, 'Duo Stock');
    lastHit = key;
  }
}

async function main() {
  console.log(`Watching ${Object.keys(PARTS).join(' and ')} within ${MAX_MILES} mi of ${ZIP}.`);
  console.log(`Duo Stock every ${POLL_SECONDS}s around each ${SWEEP_MINUTES}-min sweep.`);
  if (APPLE) console.log(`Apple directly every ${APPLE_EVERY_MINUTES} min, rotating ZIPs ${APPLE_ZIPS.join(' → ')}.`);
  console.log('Press Ctrl+C to stop.\n');
  if (process.env.TEST_ALERT === '1') {
    await notify('Duo watcher test alert', `If you see this, alerts work. Watching 512GB Star White and Night Sky within ${MAX_MILES} mi of ${ZIP}.`);
  }
  await Promise.all([APPLE && watchApple(), watchDuoStock()]);
}

main();
