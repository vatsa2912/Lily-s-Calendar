# Lily's Calendar

## Deploy with HTTPS

[Deploy to Render](https://render.com/deploy?repo=https://github.com/vatsa2912/Lily-s-Calendar)

The included [Render Blueprint](./render.yaml) creates one always-on Node web service and a 1 GB persistent disk. **This is paid hosting. Review Render's displayed price before confirming creation.** No service has been provisioned merely by adding this configuration.

1. Open the deployment link and sign in to Render with GitHub.
2. Review the Starter service and disk charges, then create the Blueprint.
3. Wait for the service to become Live. Open the exact HTTPS `onrender.com` address shown by Render; no custom domain or certificate setup is needed.
4. On iPhone, open that address in Safari, use Share → Add to Home Screen, launch the installed app, and enable lock-screen alerts.

The server generates VAPID keys on its first start and stores them with subscriptions on the persistent disk at `/var/data/lily`. Keys are never committed or served as static files. Do not delete the disk or rotate keys unless you intend to re-enroll devices.

The deployment schedules reminder times in **India Standard Time (Asia/Kolkata)**. Use a single server instance with this file-backed storage. Render's free tier sleeps when idle and does not support persistent disks, so it is unsuitable for this timer-based reminder service.

Sources: [Render free-tier limits](https://render.com/docs/free), [persistent disks](https://render.com/docs/disks), [Blueprint configuration](https://render.com/docs/blueprint-spec).

## Run the Web Push service locally

Install Node.js 22+ and run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd start
```

Visit http://localhost:3000. Local data and auto-generated keys go in the ignored `.data/` directory. Optionally set `DATA_DIR`, `PORT`, `TZ`, `VAPID_SUBJECT`, and both `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` to override defaults. Never put a private VAPID key in client-side code.

Open the HTTPS URL in Safari, tap Share → Add to Home Screen, open the installed app, and tap **Enable lock-screen alerts**. iOS only permits Web Push after a user gesture from an installed Home Screen web app.

Reminder schedules and subscriptions are stored in `push-data.json` inside the data directory. Keep that directory private and back it up. After changing, completing, or snoozing a reminder, make sure the app says it has synced; offline changes cannot reach the notification server until you reconnect. OS notification permissions, Focus settings, connectivity, and Push delivery affect when an alert appears.
