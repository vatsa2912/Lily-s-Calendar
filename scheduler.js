export const dateKey = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');

export function occurs(rule, date) {
  return date >= rule.date && (rule.repeat === 'daily' ||
    (rule.repeat === 'once' && date === rule.date) ||
    (rule.repeat === 'weekly' && rule.days.includes((new Date(date+'T12:00:00').getDay()+6)%7)));
}

// Timers are deliberately NOT part of the persisted device object.
export function nextReminder(device, now = Date.now()) {
  const candidates = [];
  for (const rule of device.rules || []) {
    // Explicit follow-ups/snoozes survive midnight and server restarts.
    for (const [key, task] of Object.entries(device.tasks || {})) {
      const [id, date] = key.split('/');
      if (id === rule.id && !task.done && task.next && occurs(rule, date)) {
        candidates.push({rule, key, due: task.next});
      }
    }
    const start = new Date(now);
    // Include today's overdue occurrence, but do not replay unsent past days.
    for (let offset=0; offset<370; offset++) {
      const date = dateKey(new Date(start.getFullYear(),start.getMonth(),start.getDate()+offset));
      const key = `${rule.id}/${date}`;
      if (!occurs(rule,date) || device.tasks?.[key]?.done || device.tasks?.[key]?.next) continue;
      candidates.push({rule,key,due:new Date(`${date}T${rule.time}`).getTime()});
      break;
    }
  }
  return candidates.sort((a,b)=>a.due-b.due)[0];
}
