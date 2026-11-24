import test from 'node:test';
import assert from 'node:assert/strict';
import {nextReminder} from './scheduler.js';
process.env.TZ='Asia/Kolkata';
const rule={id:'rule',date:'2026-11-24',time:'09:00',repeat:'daily',days:[],interval:10};
const at=value=>new Date(value).getTime();
test('today done still schedules tomorrow without another app visit',()=>{
  const pending=nextReminder({rules:[rule],tasks:{'rule/2026-11-24':{done:1}}},at('2026-11-24T10:00:00'));
  assert.equal(pending.key,'rule/2026-11-25');
  assert.equal(pending.due,at('2026-11-25T09:00:00'));
});
test('overdue reminder survives a server restart',()=>{
  const pending=nextReminder({rules:[rule],tasks:{}},at('2026-11-24T10:00:00'));
  assert.equal(pending.due,at('2026-11-24T09:00:00'));
});
test('snoozes survive midnight and retain original occurrence key',()=>{
  const pending=nextReminder({rules:[rule],tasks:{'rule/2026-11-24':{next:at('2026-11-25T00:05:00')}}},at('2026-11-25T00:00:00'));
  assert.equal(pending.key,'rule/2026-11-24');
  assert.equal(pending.due,at('2026-11-25T00:05:00'));
});
test('weekly rule follows selected weekdays',()=>{
  const pending=nextReminder({rules:[{...rule,repeat:'weekly',days:[0]}],tasks:{}},at('2026-11-24T10:00:00'));
  assert.equal(pending.key,'rule/2026-11-30');
});
test('deleted and completed one-time schedules do not produce reminders',()=>{
  assert.equal(nextReminder({rules:[],tasks:{'rule/2026-11-24':{next:1}}}),undefined);
  assert.equal(nextReminder({rules:[{...rule,repeat:'once'}],tasks:{'rule/2026-11-24':{done:1}}},at('2026-11-24T10:00:00')),undefined);
});
