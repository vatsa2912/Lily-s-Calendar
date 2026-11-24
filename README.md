# Lily's Calendar

## Run the Web Push service

Install Node.js 18+ and run:

```powershell
npm install
npx web-push generate-vapid-keys
$env:VAPID_PUBLIC_KEY="<public key>"
$env:VAPID_PRIVATE_KEY="<private key>"
$env:VAPID_SUBJECT="mailto:you@example.com"
npm start
```

The server hosts the app and its `/api` endpoints. Publish it behind an HTTPS domain before installing on iPhone. Do not put the private VAPID key in `app.js`.

Open the HTTPS URL in Safari, tap Share → Add to Home Screen, open the installed app, and tap **Enable lock-screen alerts**. iOS only permits Web Push after a user gesture from an installed Home Screen web app.

Reminder schedules and subscriptions are stored in `push-data.json` on the server. Keep that file private and back it up.
