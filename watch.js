// Watches Apple Store pickup stock for iPhone Duo 512GB Star White near a ZIP.
//
// Opens Apple's real product page in a visible browser on your Mac every few
// minutes and reads the pickup availability that Apple's own page loads.
// Sends a push notification (ntfy) and a Mac notification when it's in stock.
const { chromium } = require('playwright');
const { execFile } = require('child_process');
const path = require('path');

const PART = 'MK1G4LL/A'; // iPhone Duo 512GB Star White (US)
const ZIP = process.env.ZIP || '94536';
const MAX_MILES = Number(process.env.MAX_MILES || 60);
const EVERY_MINUTES = Number(process.env.EVERY_MINUTES || 10);
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
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

async function notify(title, text) {
  console.log(`\n*** ${title}\n${text}\n`);
  macNotify(title, text);
  await phoneNotify(title, text);
}

// Pull the store list out of one of Apple's fulfillment-messages responses.
function storesFrom(json) {
  return json?.body?.content?.pickupMessage?.stores || null;
}

async function clickIfThere(page, selector) {
  try {
    await page.locator(selector).first().click({ timeout: 3000 });
    await sleep(1200);
    return true;
  } catch {
    return false;
  }
}

async function checkOnce(context) {
  const page = await context.newPage();
  let stores = null;
  let blocked = false;
  page.on('response', async (res) => {
    if (!res.url().includes('/shop/fulfillment-messages')) return;
    if (res.status() !== 200) {
      blocked = true;
      return;
    }
    try {
      const s = storesFrom(await res.json());
      if (s && s.length) stores = s;
    } catch {}
  });

  try {
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);

    // Pick the same options you would so the pickup section shows up.
    for (const a of ['choose-noTradeIn', 'purchaseGroupOptionfullprice', 'carrierModelUNLOCKED/US', 'noapplecare']) {
      await clickIfThere(page, `[data-autom="${a}"]`);
    }
    await sleep(3000);

    // Open "Check availability" and search the ZIP, like you'd do by hand.
    if (!stores) {
      const opened =
        (await clickIfThere(page, 'button:has-text("Check availability")')) ||
        (await clickIfThere(page, 'button:has-text("availability")')) ||
        (await clickIfThere(page, '[data-autom*="pickup" i] button'));
      if (opened) {
        const zipBox = page
          .locator('input[placeholder*="ZIP" i], input[aria-label*="ZIP" i], input[name*="zip" i], input[name*="location" i], input[type="search"]')
          .first();
        try {
          await zipBox.fill(ZIP, { timeout: 5000 });
          await zipBox.press('Enter');
        } catch {}
        for (let i = 0; i < 10 && !stores; i++) await sleep(1000);
      }
    }

    if (!stores) {
      const shot = path.join(__dirname, 'last-problem.png');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const why = blocked ? 'Apple refused the stock request' : "couldn't find the pickup stock on the page";
      console.log(`[${now()}] Check failed: ${why}. Screenshot saved to ${shot}`);
      return null;
    }
    return stores;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  console.log(`Watching ${PART} within ${MAX_MILES} mi of ${ZIP}, about every ${EVERY_MINUTES} min.`);
  console.log('Leave the browser window open. Press Ctrl+C here to stop.\n');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), {
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1280, height: 900 },
  });

  let lastHit = '';
  let failures = 0;
  for (;;) {
    const stores = await checkOnce(context).catch((e) => {
      console.log(`[${now()}] Error: ${e.message}`);
      return null;
    });

    if (stores) {
      failures = 0;
      const hits = [];
      for (const s of stores) {
        const miles = parseFloat(s.storedistance ?? s.storeDistanceWithUnit ?? 'Infinity');
        const a = s.partsAvailability?.[PART] || {};
        const status = a.pickupDisplay || 'unknown';
        console.log(`[${now()}] ${String(miles).padStart(5)} mi  ${s.storeName} (${s.city}): ${status} ${a.pickupSearchQuote || ''}`);
        if (status === 'available' && miles <= MAX_MILES) {
          hits.push(`${s.storeName} (${s.city}, ${miles} mi): ${a.pickupSearchQuote || 'available'}`);
        }
      }
      const key = hits.join('|');
      if (hits.length && key !== lastHit) {
        await notify('iPhone Duo 512GB White IN STOCK', hits.join('\n'));
      } else if (!hits.length) {
        console.log(`[${now()}] Not in stock nearby.`);
      }
      lastHit = key;
    } else if (++failures === 3) {
      await notify('Duo watcher needs a look', 'Three checks in a row failed. See the Terminal window.');
    }

    // Wait EVERY_MINUTES, plus or minus a minute.
    await sleep((EVERY_MINUTES + (Math.random() * 2 - 1)) * 60000);
  }
}

main();
