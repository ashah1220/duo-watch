// Watches Apple Store pickup stock for iPhone Duo 256GB and 512GB (Star White or Night Sky) near a ZIP.
//
// Two sources, checked side by side:
// - Apple's own pickup endpoint (what "Check availability" on the buy page
//   uses), asked every few minutes about the stores nearest the ZIP.
// - Duo Stock (duo-checker.on-forge.com), which sweeps every US store every
//   20 minutes. We poll it every 20 seconds around when each sweep publishes.
// Sends a push notification (ntfy) and a Mac notification when it's in stock.
const { execFile } = require('child_process');

// The iPhone Duo models to watch (US part numbers).
const BUY_URL = 'https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display';
const PARTS = {
  'MK1G4LL/A': { name: '512GB Star White', url: `${BUY_URL}-512gb-star-white-unlocked` },
  'MK1H4LL/A': { name: '512GB Night Sky', url: `${BUY_URL}-512gb-night-sky-unlocked` },
  'MK1E4LL/A': { name: '256GB Star White', url: `${BUY_URL}-256gb-star-white-unlocked` },
  'MK1F4LL/A': { name: '256GB Night Sky', url: `${BUY_URL}-256gb-night-sky-unlocked` },
};
const ZIP = process.env.ZIP || '94536';
const MAX_MILES = Number(process.env.MAX_MILES || 100);
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const BARK_URL = (process.env.BARK_URL || '').replace(/\/+$/, ''); // e.g. https://api.day.app/<your key>
// Text alerts: email from a Gmail account (an app password, not the real
// one) to the carrier's email-to-text address, e.g. 5105551234@tmomail.net.
const { GMAIL_USER, GMAIL_APP_PASSWORD, SMS_TO } = process.env;
const STATUS_TOPIC = process.env.STATUS_TOPIC || ''; // optional ntfy topic for every check's result
const APPLE = process.env.APPLE !== '0'; // APPLE=0 skips asking Apple directly
const APPLE_API = 'https://www.apple.com/shop/retail/pickup-message';
// Apple answers with the ~12 stores nearest the ZIP asked about. Rotating
// through these covers every store within 100 miles of 94536: Vacaville adds
// Sacramento, Roseville, Santa Rosa, Marin and SF; Salinas adds Monterey and
// Modesto. The home ZIP comes up every other check.
const APPLE_ZIPS = (process.env.APPLE_ZIPS || `${ZIP},95688,${ZIP},93901`).split(',');
const APPLE_EVERY_MINUTES = Number(process.env.APPLE_EVERY_MINUTES || 2);
// Around store opening (Pacific time), when most stock appears, check every
// minute but only the stores within FAST_MILES: the home ZIP twice for each
// Vacaville check, which adds SF and Marin.
const [FAST_START, FAST_END] = (process.env.FAST_WINDOW || '09:50-10:30').split('-');
const FAST_ZIPS = (process.env.FAST_ZIPS || `${ZIP},${ZIP},95688`).split(',');
const FAST_MILES = Number(process.env.FAST_MILES || 50);
const APPLE_MAX_MINUTES = 6; // slowest we'll go after Apple says slow down
const APPLE_BLOCKED_MINUTES = 30; // wait this long after Apple says slow down
const REALERT_MINUTES = 30; // don't re-alert a store/color still in stock sooner
const OLD_HIT_MINUTES = 5; // stock seen longer ago than this is gone; don't alert it
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
const clock = (t = Date.now()) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// Shared by both sources, keyed "store|part" (both use Apple's store IDs):
// when we last alerted it, and when Apple last saw it not in stock. Duo Stock
// reports the same stock minutes after Apple does, so without this one
// sighting would alert twice, the second time after it's gone.
const alerted = new Map();
const goneAt = new Map();

// Alert the hits ({ key, part, seenAt, line }) worth one: seen in the last
// OLD_HIT_MINUTES, not alerted in the last REALERT_MINUTES unless Apple has
// seen them sell out since, and not seen sold out by Apple after they were
// seen in stock.
async function alertFresh(hits, source) {
  const fresh = hits.filter((h) => {
    const last = alerted.get(h.key);
    const gone = goneAt.get(h.key);
    if (gone > h.seenAt || Date.now() - h.seenAt > OLD_HIT_MINUTES * 60000) return false;
    return !(Date.now() - last < REALERT_MINUTES * 60000) || gone > last;
  });
  if (!fresh.length) return;
  fresh.forEach((h) => alerted.set(h.key, Date.now()));
  await notifyHits(fresh, source);
}

// Turn in-stock finds ({ part, line }) into one alert naming the colors.
async function notifyHits(hits, source) {
  const names = [...new Set(hits.map((h) => PARTS[h.part].name))];
  await notify(`iPhone Duo ${names.join(' + ')} IN STOCK (${source})`, hits.map((h) => h.line).join('\n'), PARTS[hits[0].part].url);
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

// Bark (iPhone app) pushes straight through Apple's push service. Stock
// alerts are critical, so they sound even on silent or in a Focus.
async function barkNotify(title, text, url, critical) {
  if (!BARK_URL) return;
  try {
    const res = await fetch(BARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body: text, url, group: 'duo-watch', ...(critical ? { level: 'critical', volume: 10 } : { level: 'timeSensitive' }) }),
    });
    if (!res.ok) console.log(`[${now()}] Bark failed: HTTP ${res.status}`);
  } catch (e) {
    console.log(`[${now()}] Bark failed: ${e.message}`);
  }
}

// Send a short email to the carrier's email-to-text address, through Gmail
// with curl (it speaks SMTP), so no mail library is needed.
function smsNotify(title, text) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !SMS_TO) return;
  const message = `From: ${GMAIL_USER}\r\nTo: ${SMS_TO}\r\nSubject: ${title}\r\n\r\n${text}\r\n`;
  return new Promise((resolve) => {
    const curl = execFile(
      'curl',
      ['-sS', '--max-time', '30', '--ssl-reqd', '--url', 'smtps://smtp.gmail.com:465', '--user', `${GMAIL_USER}:${GMAIL_APP_PASSWORD}`,
        '--mail-from', GMAIL_USER, '--mail-rcpt', SMS_TO, '--upload-file', '-'],
      (err, _out, errText) => {
        if (err) console.log(`[${now()}] Text failed: ${(errText || err.message).trim()}`);
        resolve();
      },
    );
    curl.stdin.end(message);
  });
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
  const critical = title.includes('IN STOCK');
  await Promise.all([phoneNotify(title, text, url), barkNotify(title, text, url, critical), smsNotify(title, text), issueNotify(title, text, url)]);
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

// True between FAST_START and FAST_END, Pacific time.
function inFastWindow() {
  const hm = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return hm >= FAST_START && hm < FAST_END;
}

async function watchApple() {
  let every = APPLE_EVERY_MINUTES;
  let failures = 0;
  let wasFast = false;
  for (let n = 0; ; n++) {
    // Skip the fast window once Apple has asked us to slow down.
    const fast = every === APPLE_EVERY_MINUTES && inFastWindow();
    if (fast !== wasFast) status(fast ? `Apple: every minute within ${FAST_MILES} mi until ${FAST_END}.` : `Apple: back to every ${every} min within ${MAX_MILES} mi.`);
    wasFast = fast;
    const zips = fast ? FAST_ZIPS : APPLE_ZIPS;
    const maxMiles = fast ? FAST_MILES : MAX_MILES;
    const zip = zips[n % zips.length];
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
          if (a.pickupDisplay !== 'available') goneAt.set(key, Date.now());
          else if (miles <= maxMiles) {
            hits.push({ key, part, seenAt: Date.now(), line: `${PARTS[part].name}: ${s.storeName} (${s.city}, ${miles} mi): ${a.pickupSearchQuote || 'available'}, seen ${clock()}` });
          }
        }
      }
      const lines = hits.map((h) => h.line);
      status(`Apple ${zip}: ${r.stores.length} stores out to ${farthest} mi: ${hits.length ? lines.join('; ') : 'not in stock nearby'}.`);
      // The same store shows up in several ZIPs' answers, so remember what
      // we've already alerted instead of comparing with the last answer.
      await alertFresh(hits, 'Apple');
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
    const minutes = r?.blocked ? APPLE_BLOCKED_MINUTES : fast ? 1 : every;
    await sleep((minutes + (Math.random() - 0.5) / 4) * 60000);
  }
}

// One Duo Stock request. Returns the parsed body, or null if it failed.
async function fetchDuoStock() {
  const url = `${DUO_STOCK_API}?zip=${ZIP}&radius_miles=${MAX_MILES}&available_only=1&limit=50`;
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
        .map((p) => ({
          key: `${s.store_id}|${p.part_number}`,
          part: p.part_number,
          seenAt: Date.parse(p.observed_at) || Date.parse(data.run_finished_at),
          line: `${PARTS[p.part_number].name}: ${s.name} (${s.city}, ${s.distance_miles} mi): ${p.pickup_message || 'available'}, seen ${clock(Date.parse(p.observed_at) || Date.parse(data.run_finished_at))}`,
        })),
    );
    const lines = hits.map((h) => h.line);
    const sweptAt = new Date(data.run_finished_at).toLocaleTimeString();
    status(`Duo Stock sweep from ${sweptAt}: ${hits.length ? lines.join('; ') : 'not in stock nearby'}${data.is_stale ? ' (stale)' : ''}.`);
    await alertFresh(hits, 'Duo Stock');
  }
}

async function main() {
  console.log(`Watching ${Object.values(PARTS).map((p) => p.name).join(', ')} within ${MAX_MILES} mi of ${ZIP}.`);
  console.log(`Duo Stock every ${POLL_SECONDS}s around each ${SWEEP_MINUTES}-min sweep.`);
  if (APPLE) console.log(`Apple directly every ${APPLE_EVERY_MINUTES} min, rotating ZIPs ${APPLE_ZIPS.join(' → ')}; every minute within ${FAST_MILES} mi from ${FAST_START} to ${FAST_END} Pacific.`);
  console.log('Press Ctrl+C to stop.\n');
  if (process.env.TEST_ALERT === '1') {
    await notify('Duo watcher test alert', `If you see this, alerts work. Watching ${Object.values(PARTS).map((p) => p.name).join(', ')} within ${MAX_MILES} mi of ${ZIP}.`);
  }
  await Promise.all([APPLE && watchApple(), watchDuoStock()]);
}

main();
