import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = path.dirname(fileURLToPath(import.meta.url));
const rootPrefix = `${root}${path.sep}`;
const port = Number(process.env.PORT || 3000);
const dataFile = path.join(root, 'push-data.json');
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

if (!vapidPublicKey || !vapidPrivateKey) {
  console.warn('VAPID keys are missing. Run `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.');
} else {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

let data = { devices: {} };
try { data = JSON.parse(await fs.readFile(dataFile, 'utf8')); } catch { /* first run */ }
const save = () => fs.writeFile(dataFile, JSON.stringify(data, null, 2));
const localDateKey = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const body = async req => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
};

function nextOccurrence(rule, from = Date.now()) {
  const start = new Date(from);
  for (let offset = 0; offset < 370; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const iso = localDateKey(date);
    if (iso < rule.date) continue;
    const day = (date.getDay() + 6) % 7;
    const matches = rule.repeat === 'daily' || (rule.repeat === 'once' && iso === rule.date) || (rule.repeat === 'weekly' && rule.days?.includes(day));
    if (!matches) continue;
    const due = new Date(`${iso}T${rule.time}`).getTime();
    if (due > from) return due;
  }
  return null;
}

async function sendReminder(device, rule, due) {
  if (!vapidPublicKey || !vapidPrivateKey) return false;
  try {
    await webpush.sendNotification(device.subscription, JSON.stringify({
      title: `${rule.category} · ${rule.title}`,
      body: 'It is time for Lily’s care.',
      tag: `${rule.id}/${new Date(due).toISOString().slice(0, 10)}`,
      url: './'
    }));
    return true;
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) delete data.devices[device.id];
    else console.error('Push delivery failed:', error.message);
    return false;
  }
}

function scheduleDevice(device) {
  if (device.timer) clearTimeout(device.timer);
  const now = Date.now();
  const pending = (device.rules || [])
    .filter(rule => !(device.tasks?.[`${rule.id}/${localDateKey(new Date())}`]?.done))
    .map(rule => ({ rule, due: device.tasks?.[`${rule.id}/${localDateKey(new Date())}`]?.next || nextOccurrence(rule, now) }))
    .filter(item => item.due)
    .sort((a, b) => a.due - b.due)[0];
  if (!pending) return;
  device.timer = setTimeout(async () => {
    const delivered = await sendReminder(device, pending.rule, pending.due);
    if (delivered) {
      const key = `${pending.rule.id}/${localDateKey(new Date(pending.due))}`;
      device.tasks ||= {};
      device.tasks[key] = { next: Date.now() + Number(pending.rule.interval || 10) * 60000 };
      await save();
    }
    scheduleDevice(device);
  }, Math.max(1000, pending.due - now));
}

async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/vapid-public-key') return json(res, 200, { publicKey: vapidPublicKey || null });
  if (req.method === 'POST' && pathname === '/api/push/subscribe') {
    const input = await body(req);
    if (!input.id || !input.subscription?.endpoint) return json(res, 400, { error: 'Invalid subscription.' });
    const device = data.devices[input.id] || { id: input.id };
    device.subscription = input.subscription;
    device.rules = input.rules || [];
    device.tasks = input.tasks || {};
    data.devices[input.id] = device;
    await save();
    scheduleDevice(device);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/push/sync') {
    const input = await body(req);
    const device = data.devices[input.id];
    if (!device) return json(res, 404, { error: 'Subscribe first.' });
    device.rules = input.rules || [];
    device.tasks = input.tasks || {};
    await save();
    scheduleDevice(device);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found.' });
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(rootPrefix) && file !== root) return res.writeHead(403).end();
    const content = await fs.readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, () => console.log(`Lily’s Calendar listening on port ${port}`));
