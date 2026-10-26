# duo-watch

Runs on your Mac and watches **Apple Store pickup stock** for the **iPhone Duo 512GB Star White** (MK1G4LL/A) within **60 miles of 94536**.

About every 10 minutes it opens Apple's real product page in a browser window and reads the pickup availability that Apple's own page loads. When the phone is in stock nearby, it sends a Mac notification and, if you set it up, a push notification to your phone.

## Setup (one time)

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
- The Terminal window prints each store and its status on every check.
- Keep the Mac plugged in. `npm start` uses `caffeinate`, which stops the Mac from sleeping while the watcher runs, but closing a laptop lid still sleeps it.
- To stop it, click the Terminal window and press **Ctrl+C**.

If three checks in a row fail, you get a "needs a look" alert. The page from the failed check is saved as `~/duo-watch/last-problem.png`.
