const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../interfaces.js');
const M = globalThis.G06InterfaceMap;

test('normalizes short/full port names and ranges', () => {
  assert.deepEqual(M.parse('Gi1/0/3–4'), ['GigabitEthernet1/0/3', 'GigabitEthernet1/0/4']);
  assert.deepEqual(M.parse('GigabitEthernet1/0/3 - 4'), M.parse('Gi1/0/3–4'));
  assert.deepEqual(M.parse('Et0/1'), ['Ethernet0/1']);
});
test('accepts EVE Ethernet aliases in edits, ranges, peer labels and duplicate checks', () => {
  for (const name of ['e0/1', 'E0/1', 'Et0/1', 'Ethernet0/1']) {
    assert.deepEqual(M.parse(name), ['Ethernet0/1']);
  }
  assert.deepEqual(M.parse('e0/1–2'), ['Ethernet0/1', 'Ethernet0/2']);
  const maps = M.update({}, 'CE01', 'Gi0/0/0', 'e0/1', M.parse('Gi0/0/0–1'));
  assert.equal(M.remap('interface GigabitEthernet0/0/0', 'CE01', maps), 'interface Ethernet0/1');
  assert.throws(() => M.update(maps, 'CE01', 'Gi0/0/1', 'Et0/1', M.parse('Gi0/0/0–1')), /ใช้อยู่แล้ว/);
  const eveMaps = { CE01: { 'Ethernet0/1': 'Ethernet0/2' }, MLS01: { 'Ethernet0/1': 'Ethernet0/3' } };
  assert.equal(M.remap('interface e0/1', 'CE01', eveMaps), 'interface Et0/2');
  assert.equal(M.remap('description TO-MLS01-e0/1 | e0/1', 'CE01', eveMaps), 'description TO-MLS01-Et0/3 | Et0/2');
  assert.deepEqual(M.ownPorts('interface e0/1\ndescription TO-MLS01-e0/2', 'CE01'), ['Ethernet0/1']);
  assert.equal(M.remap('route-map rule0/1', 'CE01', eveMaps), 'route-map rule0/1');
});
test('substitutions use original identity once and do not cascade or affect similar numbers', () => {
  const maps = { CE01: { GigabitEthernet0: 'Ethernet0' } };
  maps.CE01['GigabitEthernet0/0/1'] = 'GigabitEthernet0/0/2';
  maps.CE01['GigabitEthernet0/0/2'] = 'GigabitEthernet0/0/1';
  assert.equal(M.remap('Gi0/0/1 Gi0/0/2 Gi0/0/10', 'CE01', maps), 'Gi0/0/2 Gi0/0/1 Gi0/0/10');
});
test('local and named peer ports are mapped in separate device namespaces', () => {
  const maps = { CE01: { 'GigabitEthernet0/0/0': 'Ethernet0/0' }, MLS01: { 'GigabitEthernet1/0/1': 'GigabitEthernet1/0/11' } };
  assert.equal(M.remap('interface GigabitEthernet0/0/0', 'CE01', maps), 'interface Ethernet0/0');
  assert.equal(M.remap('description TO-MLS01-Gi1/0/1 | Gi0/0/0', 'CE01', maps), 'description TO-MLS01-Gi1/0/11 | Et0/0');
  assert.equal(M.remap('G06-HQ-MLS01 Gi1/0/1', 'CE01', maps), 'G06-HQ-MLS01 Gi1/0/11');
});
test('range commands stay correct after full or partial changes', () => {
  const maps = { MLS01: { 'GigabitEthernet1/0/3': 'GigabitEthernet1/0/13', 'GigabitEthernet1/0/4': 'GigabitEthernet1/0/14' } };
  assert.equal(M.remap('interface range GigabitEthernet1/0/3 - 4', 'MLS01', maps), 'interface range GigabitEthernet1/0/13 - 14');
  delete maps.MLS01['GigabitEthernet1/0/4'];
  assert.equal(M.remap('interface range GigabitEthernet1/0/3 - 4', 'MLS01', maps), 'interface range GigabitEthernet1/0/13 , GigabitEthernet1/0/4');
});
test('fills WAN placeholder consistently in diagram and commands', () => {
  const maps = { CE01: { '<WAN_PORT>': 'GigabitEthernet0/0/2' } };
  assert.equal(M.remap('<WAN>', 'CE01', maps), 'Gi0/0/2');
  assert.equal(M.remap('interface <WAN_PORT>', 'CE01', maps), 'interface Gi0/0/2');
});
test('rejects duplicate ports, mismatched ranges and noninterface input', () => {
  assert.throws(() => M.update({}, 'CE01', 'Gi0/0/0', 'Gi0/0/1', M.parse('Gi0/0/0–1')), /ใช้อยู่แล้ว/);
  assert.throws(() => M.update({}, 'MLS01', 'Gi1/0/3–4', 'Gi1/0/13', []), /จำนวนพอร์ต/);
  assert.throws(() => M.parse('Gi0/0/2\nshutdown'));
  assert.throws(() => M.parse('<script>'));
});
test('WAN placeholders cannot reuse LAN ports, while a named R01 WAN alias can match itself', () => {
  const reserved = M.parse('Gi0/0/0–1').concat('<WAN_PORT>');
  assert.throws(() => M.update({}, 'CE01', '<WAN_PORT>', 'Gi0/0/0', reserved), /ใช้อยู่แล้ว/);
  const maps = { CE01: { '<WAN_PORT>': 'GigabitEthernet0/0/2' } };
  assert.throws(() => M.update(maps, 'CE01', 'Gi0/0/0', 'Gi0/0/2', reserved), /ใช้อยู่แล้ว/);
  const r01 = { R01: { '<WAN_PORT>': 'GigabitEthernet0/0/1' } };
  assert.doesNotThrow(() => M.update(r01, 'R01', 'Gi0/0/1', 'Gi0/0/2', reserved, 'GigabitEthernet0/0/1'));
});
test('all original config text stays byte-for-byte unchanged with no overrides', () => {
  const context = { window: {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../data/configs.js'), 'utf8'), context);
  for (const devices of Object.values(context.window.G06_CONFIGS)) {
    for (const [id, cfg] of Object.entries(devices)) {
      for (const line of cfg.prelude.concat(cfg.blocks.flatMap(b => b.commands))) assert.equal(M.remap(line, id, {}), line);
    }
  }
});
