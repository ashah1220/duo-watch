# duo-watch

Runs on your Mac and watches **Apple Store pickup stock** for the **iPhone Duo 512GB Star White** (MK1G4LL/A) within **100 miles of 94536**.

It checks two sources at the same time:

- **Apple's page:** about every 10 minutes it opens Apple's real product page in a browser window and reads the pickup availability that Apple's own page loads. Apple only lists the stores closest to you, so this may not reach the farther stores.
- **[Duo Stock](https://duo-checker.on-forge.com):** this site checks every US Apple Store every 20 minutes (6:30 AM to 9:30 PM Eastern). The watcher works out when each check will publish and polls every 20 seconds around that time, so it sees new results within seconds. That's roughly 9 requests an hour.

When the phone is in stock nearby, it sends a Mac notification and, if you set it up, a push notification to your phone.

## No computer? It also runs on GitHub

The **Watch Duo Stock** workflow (in the Actions tab) polls Duo Stock around the clock on GitHub's servers, with no Mac needed. It only uses Duo Stock, not Apple's page. When the phone is in stock within 100 miles it:

- opens a GitHub issue assigned to you, so the **GitHub app** on your phone notifies you, and
- if you add a repository secret named `NTFY_TOPIC` (Settings → Secrets and variables → Actions), also sends an ntfy push to that topic.

To check that alerts reach your phone, open Actions → Watch Duo Stock → Run workflow and tick "Send a test alert". To stop it, open the workflow's "..." menu and choose Disable workflow.

## Mac setup (one time)

1. Install **Node.js**: go to <https://nodejs.org>, download the macOS installer, and run it.
2. Open **Terminal** (Spotlight → "Terminal"), then paste this and press Return:

   ```
   mkdir -p ~/duo-watch && cd ~/duo-watch && curl -fsSL -o watch.js https://raw.githubusercontent.com/ashah1220/duo-watch/claude/iphone-duo-stock-checker-2bjkdu/watch.js && curl -fsSL -o package.json https://raw.githubusercontent.com/ashah1220/duo-watch/claude/iphone-duo-stock-checker-2bjkdu/package.json && npm run setup
   ```

3. For phone alerts: install the **ntfy** app on your phone and subscribe to a hard-to-guess topic name, like `duo-ashah-7731`.

## Run it

```
cd ~/duo-watch && NTFY_TOPIC=duo-ashah-7731 npm start
```

Replace `duo-ashah-7731` with your own topic name.

- A browser window opens and checks Apple's page. Leave it open. You can move it out of the way, but don't close it.
- The Terminal window prints each store and its status on every check, plus one line for each Duo Stock check.
- Keep the Mac plugged in. `npm start` uses `caffeinate`, which stops the Mac from sleeping while the watcher runs, but closing a laptop lid still sleeps it.
- To stop it, click the Terminal window and press **Ctrl+C**.

If three checks in a row fail, you get a "needs a look" alert. The page from the failed check is saved as `~/duo-watch/last-problem.png`.
