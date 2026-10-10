const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../shared-progress.js');
const S = globalThis.G06SharedProgress;
const room = { id: '11111111-1111-1111-1111-111111111111', key: 'ab'.repeat(32) };
test('room links retain set/device routes and survive reload, while leaving removes access key', () => {
  const link = S.roomURL('https://example.test/?x=1#vrrp/CE01', room);
  assert.deepEqual(S.roomFromURL(link), room);
  assert.match(link, /#vrrp\/CE01$/);
  const left = new URL(S.roomURL(link, null));
  assert.equal(left.searchParams.get('key'), null);
  assert.equal(left.searchParams.get('room'), null);
  assert.equal(left.searchParams.get('x'), '1');
});
test('malformed room links fail rather than falling into personal mode', () => {
  assert.throws(() => S.roomFromURL('https://example.test/?room=bad'));
  assert.throws(() => S.roomFromURL('https://example.test/?room=' + room.id));
  assert.equal(S.roomFromURL('https://example.test/#vrrp/CE01'), null);
});
test('templates open by ID without an invitation key and preserve the current device', () => {
  const template = { id: room.id, template: true };
  const link = S.roomURL('https://example.test/?room=' + room.id + '&key=' + room.key + '#vrrp/CE02', template);
  assert.deepEqual(S.roomFromURL(link), template);
  assert.equal(new URL(link).searchParams.get('key'), null);
  assert.match(link, /#vrrp\/CE02$/);
  assert.equal(new URL(S.roomURL(link, null)).searchParams.get('template'), null);
  assert.throws(() => S.roomFromURL('https://example.test/?template=invalid'));
});
test('progress rows accept only signatures of known devices, and reset tombstones remove marks', () => {
  assert.deepEqual(S.readRows([
    { block_key: 'vrrp:CE01:BLOCK 1', signature: '50:abc123' },
    { block_key: 'vrrp:CE02:BLOCK 1', signature: null },
    { block_key: '__proto__', signature: '50:abc123' },
    { block_key: 'vrrp:CE01:BLOCK 2', signature: 'router bgp 65106' }
  ]), { 'vrrp:CE01:BLOCK 1': '50:abc123' });
});
test('browser connection accepts a publishable key and rejects privileged keys', () => {
  globalThis.G06_SUPABASE = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test-key' };
  assert.equal(S.configured(), true);
  globalThis.G06_SUPABASE.publishableKey = 'sb_secret_test-key';
  assert.equal(S.configured(), false);
});
test('presence keeps only a cleaned name and known set/device', () => {
  assert.deepEqual(S.readPresence({
    a: [{ name: '  🐱 แมว ', animal: 'cat', since: 5, set: 'vrrp', dev: 'CE01' }],
    b: [{ name: 'x'.repeat(40), animal: '<img>', set: 'bad', dev: 'G01' }],
    c: [{ name: '\u0007' }],
    d: null
  }), [
    { key: 'a', name: '🐱 แมว', animal: 'cat', since: 5, set: 'vrrp', dev: 'CE01' },
    { key: 'b', name: 'x'.repeat(24), animal: '', since: 0, set: null, dev: null }
  ]);
});
