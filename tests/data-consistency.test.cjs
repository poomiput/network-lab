// Cross-checks data/devices.js (cables, panel slots, consoles) against data/configs.js (the TXT scripts).
// Run after editing a rack mapping:  node --test tests/*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const win = {};
for (const f of ['data/configs.js', 'data/devices.js', 'interfaces.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { window: win, globalThis: win });
}
const CFG = win.G06_CONFIGS, DEV = win.G06_DEVICES, SETS = win.G06_SETS, IF = win.G06InterfaceMap;
const NAMES = Object.keys(DEV);
const SLOT = /\b([TBP])0?(\d{1,2})(?:\s*[–\-\/]\s*[TBP]?0?(\d{1,2}))?\b/g;
const slots = (text) => {
  const out = [];
  for (const m of String(text).matchAll(SLOT)) for (let i = +m[2]; i <= +(m[3] || m[2]); i++) out.push(m[1] + i);
  return out;
};
const pad = (code) => code[0] + code.slice(1).padStart(2, '0');
const ports = (text) => { try { return IF.parse(text); } catch (e) { return []; } };
const configText = (set, dev) => {
  const c = CFG[set][dev];
  return c.prelude.concat(c.blocks.flatMap((b) => b.commands)).join('\n');
};

for (const set of Object.keys(SETS)) {
  test(set + ': every panel slot belongs to one device only', () => {
    const owner = new Map();
    for (const dev of NAMES) {
      const claim = (code, what) => {
        assert.ok(!owner.has(code) || owner.get(code) === dev, `${set}: ${code} used by ${owner.get(code)} and ${dev} (${what})`);
        owner.set(code, dev);
      };
      slots(String(DEV[dev].console[set]).split(' ')[0]).slice(0, 1).forEach((c) => claim(c, 'console'));
      for (const r of DEV[dev].cables[set]) slots(r[1]).forEach((c) => claim(c, r[0]));
    }
  });

  test(set + ': both ends of every device-to-device cable agree', () => {
    for (const dev of NAMES) {
      for (const r of DEV[dev].cables[set]) {
        const m = r[2].match(/^(CE01|CE02|MLS01|MLS02|R01|SW01)\s+(\S+)/);
        if (!m) continue;
        const [, peer, peerPort] = m;
        const back = DEV[peer].cables[set].find((p) => p[2].startsWith(dev + ' '));
        assert.ok(back, `${set}: ${peer} has no cable row back to ${dev}`);
        assert.deepEqual(ports(back[0]), ports(peerPort), `${set}: ${dev} says ${peer} ${peerPort}, ${peer} lists ${back[0]}`);
        assert.deepEqual(ports(back[2].split(' ')[1]), ports(r[0]), `${set}: ${peer} says ${dev} ${back[2]}, ${dev} lists ${r[0]}`);
        assert.deepEqual(slots(back[1]), slots(r[3]), `${set}: ${dev} ${r[0]} far slot ${r[3]} but ${peer} ${back[0]} is on ${back[1]}`);
        assert.deepEqual(slots(back[3]), slots(r[1]), `${set}: ${peer} ${back[0]} far slot ${back[3]} but ${dev} ${r[0]} is on ${r[1]}`);
      }
    }
  });

  test(set + ': cable-table ports exist in the script and descriptions name the panel slots', () => {
    for (const dev of NAMES) {
      const text = configText(set, dev);
      for (const r of DEV[dev].cables[set]) {
        if (r[0] === '<WAN_PORT>') continue;
        const list = ports(r[0]);
        assert.ok(list.length, `${set} ${dev}: cannot read port ${r[0]}`);
        const [first] = list, last = list[list.length - 1];
        const inScript = text.includes('interface ' + first) || new RegExp('interface range ' + first.replace(/\//g, '\\/') + '\\b').test(text)
          || text.includes('interface range ' + first.replace(/\d+$/, '') + first.match(/\d+$/)[0] + ' - ' + last.match(/\d+$/)[0]);
        assert.ok(inScript, `${set} ${dev}: ${first} from the cable table is not configured in the script`);
        const own = slots(r[1]);
        if (own.length) assert.ok(text.includes('description ' + pad(own[0])), `${set} ${dev}: no "description ${pad(own[0])} ..." for ${r[0]} (panel ${r[1]})`);
        const far = slots(r[3]);
        if (own.length && far.length) assert.ok(text.includes('<-> ' + pad(far[0])), `${set} ${dev}: description of ${r[0]} does not mention far end ${pad(far[0])}`);
      }
    }
  });
}
