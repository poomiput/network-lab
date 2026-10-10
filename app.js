(function () {
  "use strict";
  const CFG = window.G06_CONFIGS, DEV = window.G06_DEVICES, SETS = window.G06_SETS, ZONES = window.G06_ZONES;
  const svg = document.getElementById("topo");
  const detail = document.getElementById("detail");
  const state = { set: "vrrp", dev: null };
  const IF = window.G06InterfaceMap;
  const TEMP_KEY = "g06-temporary-interfaces-v1";
  const COPY_KEY = "g06-copy-progress-v1";
  const SHARE = window.G06SharedProgress;
  let room = null, roomError = "", templates = [];
  try { room = SHARE.roomFromURL(location.href); } catch (e) { roomError = e.message; }
  const progressKey = room ? COPY_KEY + ":room:" + room.id : COPY_KEY;
  const outboxKey = progressKey + ":pending";
  const interfaceKey = "g06-interface-map-v2" + (room ? ":room:" + room.id : "");
  const historyKey = interfaceKey + ":history";
  let interfaceHistory = [];
  let sharedController = null, pending = {}, revision = 0, flushing = false, realtimeState = "connecting";
  let copied = {};
  /* ---------- who is on which device (Realtime presence, not saved) ---------- */
  // 6 avatars for the 6 team members. Put an image path in img (e.g. "avatars/cat.png") to show art instead of the emoji.
  const ANIMALS = [
    { id: "cat", label: "แมว", emoji: "🐱", img: "" },
    { id: "dog", label: "หมา", emoji: "🐶", img: "" },
    { id: "panda", label: "แพนด้า", emoji: "🐼", img: "" },
    { id: "penguin", label: "เพนกวิน", emoji: "🐧", img: "" },
    { id: "fox", label: "จิ้งจอก", emoji: "🦊", img: "" },
    { id: "turtle", label: "เต่า", emoji: "🐢", img: "" },
  ];
  const animalOf = (id) => ANIMALS.find((a) => a.id === id) || null;
  // No random pick: whoever joins later takes the first animal nobody else is using.
  const NAME_KEY = "g06-my-name", ANIMAL_KEY = "g06-my-animal-v2";
  const presenceKey = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  const cleanName = (v) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  let myName = "", myAnimal = "", people = [];
  try { myName = cleanName(localStorage.getItem(NAME_KEY)); myAnimal = localStorage.getItem(ANIMAL_KEY) || ""; } catch (e) {}
  if (!animalOf(myAnimal)) myAnimal = ANIMALS[0].id;
  const joinedAt = Date.now();
  const displayName = () => myName || animalOf(myAnimal).label;
  const presencePayload = () => ({ name: displayName(), animal: myAnimal, since: joinedAt, set: state.set, dev: state.dev });
  function resolveAnimal() {
    const others = people.filter((p) => p.key !== presenceKey);
    const clash = others.some((p) => p.animal === myAnimal && (p.since < joinedAt || (p.since === joinedAt && p.key < presenceKey)));
    if (!clash) { try { localStorage.setItem(ANIMAL_KEY, myAnimal); } catch (e) {} return false; }
    const used = new Set(others.map((p) => p.animal));
    const free = ANIMALS.find((a) => !used.has(a.id));
    if (!free) return false;
    myAnimal = free.id;
    try { localStorage.setItem(ANIMAL_KEY, myAnimal); } catch (e) {}
    return true;
  }
  function publishPresence() { if (sharedController) sharedController.track(presencePayload()); }
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) copied = saved;
    if (room) {
      const savedPending = JSON.parse(localStorage.getItem(outboxKey));
      if (savedPending && typeof savedPending === "object" && !Array.isArray(savedPending)) {
        for (const [key, value] of Object.entries(savedPending)) {
          if (/^(hsrp|vrrp):(CE01|CE02|MLS01|MLS02|R01|SW01):.{1,255}$/.test(key) && (value?.signature === null || /^\d{1,6}:[0-9a-f]{1,8}$/.test(value?.signature || ""))) pending[key] = { signature: value.signature, revision: ++revision };
        }
      }
    }
  } catch (e) {}
  let temporary = { hsrp: {}, vrrp: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(interfaceKey) || (!room && sessionStorage.getItem(TEMP_KEY)) || "null");
    for (const set of Object.keys(temporary)) {
      for (const [device, ports] of Object.entries(saved?.[set] || {})) {
        if (!DEV[device]) continue;
        const clean = {};
        for (const [old, next] of Object.entries(ports)) {
          const a = IF.parse(old), b = IF.parse(next);
          if (a.length === 1 && b.length === 1) clean[a[0]] = b[0];
        }
        temporary[set][device] = clean;
      }
    }
    const savedHistory = JSON.parse(localStorage.getItem(historyKey));
    if (Array.isArray(savedHistory)) interfaceHistory = savedHistory.filter((v) => SETS[v?.set] && DEV[v?.device] && Array.isArray(v.changes));
  } catch (e) { temporary = { hsrp: {}, vrrp: {} }; }

  /* ---------- theme ---------- */
  const themeToggle = document.getElementById("themeToggle");
  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle.textContent = dark ? "☀ Light" : "☾ Dark";
    themeToggle.setAttribute("aria-label", dark ? "เปลี่ยนเป็น Light theme" : "เปลี่ยนเป็น Dark theme");
  }
  themeToggle.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("g06-config-site-theme", theme); } catch (e) {}
    updateThemeButton();
  });
  updateThemeButton();

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const hl = (s) => esc(s).replace(/&lt;(?!-&gt;)([^&]*?)&gt;/g, '<span class="ph">&lt;$1&gt;</span>');
  const pick = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v[state.set] : v);
  const deviceName = (id) => DEV[id]?.hostname || id;
  /* ---------- patch panel slots: T05 -> "แถวบน ช่อง 5", B03 -> "แถวล่าง ช่อง 3", P02 -> "ช่อง 2" ---------- */
  const SLOT_RE = /\b([TBP])0?(\d{1,2})(?:\s*[–\-\/]\s*[TBP]?0?(\d{1,2}))?\b/g;
  const ROW_NAME = { T: "แถวบน", B: "แถวล่าง", P: "" };
  const slotText = (text) => String(text).replace(SLOT_RE, (m, r, a, b) => (ROW_NAME[r] ? ROW_NAME[r] + " " : "") + "ช่อง " + a + (b ? "–" + b : ""));
  const slotShort = (text) => String(text).replace(SLOT_RE, (m, r, a, b) => (r === "T" ? "ช่องบน " : r === "B" ? "ช่องล่าง " : "ช่อง ") + a + (b ? "–" + b : ""));
  function slotsOf(text) {
    const out = [];
    String(text).replace(SLOT_RE, (m, r, a, b) => {
      for (let i = Number(a); i <= Number(b || a); i++) out.push({ row: r, n: i });
      return m;
    });
    return out;
  }
  function saveProgress() {
    try {
      localStorage.setItem(progressKey, JSON.stringify(copied));
      if (room) localStorage.setItem(outboxKey, JSON.stringify(pending));
    } catch (e) {}
  }
  function updateProgressView() {
    const opened = detail.querySelector("details.untested")?.open;
    refresh();
    const later = detail.querySelector("details.untested");
    if (later && opened) later.open = true;
  }
  function sharingStatus(kind, message) {
    const status = document.getElementById("sharingStatus");
    const waiting = Object.keys(pending).length;
    status.dataset.state = kind;
    status.textContent = room ? (room.template ? (room.name || "Template") : "ชุดที่แชร์เดิม") + " · " + (message || (waiting ? "มี " + waiting + " รายการรอบันทึก" : kind === "live" ? "แชร์กับทีมแล้ว" : "กำลังเชื่อมต่อ")) : (message || "เก็บในเบราว์เซอร์นี้");
    document.getElementById("retrySharing").hidden = !room || !["error", "offline"].includes(kind);
  }
  async function flushPending() {
    if (!room || !sharedController || !Object.keys(pending).length || flushing) return;
    flushing = true;
    const controller = sharedController;
    try {
      while (Object.keys(pending).length && controller === sharedController) {
        const batch = { ...pending };
        try {
          await controller.write(Object.fromEntries(Object.entries(batch).map(([key, value]) => [key, value.signature])));
          for (const [key, value] of Object.entries(batch)) if (pending[key]?.revision === value.revision) delete pending[key];
          saveProgress(); sharingStatus(realtimeState);
        } catch (e) {
          sharingStatus("error", "Copy แล้ว แต่ยังไม่บันทึกให้ทีม · " + e.message);
          break;
        }
      }
    } finally {
      flushing = false;
      // A reconnect may have replaced the controller while an old write ran.
      if (controller !== sharedController) flushPending();
    }
  }
  function persistChanges(changes) {
    if (room) {
      for (const [key, signature] of Object.entries(changes)) pending[key] = { signature, revision: ++revision };
      sharingStatus("saving");
    }
    saveProgress();
    flushPending();
  }
  async function connectSharing() {
    if (!room) return;
    if (!SHARE.configured()) { sharingStatus("error", "เว็บยังไม่ได้ตั้งค่า Supabase · ใช้ข้อมูลที่เก็บไว้ในเครื่องชั่วคราว"); return; }
    sharingStatus("connecting");
    realtimeState = "connecting";
    if (sharedController) { sharedController.close(); sharedController = null; }
    try {
      sharedController = await SHARE.connect(room, (values) => {
        copied = { ...values.copied };
        for (const [key, value] of Object.entries(pending)) {
          if (value.signature === null) delete copied[key]; else copied[key] = value.signature;
        }
        const maps = { hsrp: {}, vrrp: {} };
        for (const row of values.ports || []) {
          if (!SETS[row.set_id] || !DEV[row.device_id]) continue;
          try {
            const a = IF.parse(row.original), b = IF.parse(row.replacement);
            if (a.length !== 1 || b.length !== 1 || a[0] === b[0]) continue;
            (maps[row.set_id][row.device_id] ||= {})[a[0]] = b[0];
          } catch (e) {}
        }
        temporary = maps;
        interfaceHistory = (values.history || []).map((row) => ({ id: row.id, set: row.set_id, device: row.device_id, changes: row.changes, at: row.changed_at }));
        saveInterfaces();
        saveProgress(); updateProgressView();
      }, (kind) => {
        realtimeState = kind;
        sharingStatus(kind, kind === "offline" ? "การเชื่อมต่อสดขาด · ลองเชื่อมอีกครั้ง" : kind === "error" ? "อ่านสถานะร่วมไม่สำเร็จ · ลองเชื่อมอีกครั้ง" : "");
      }, { key: presenceKey, payload: presencePayload(), onChange: (list) => { people = list; const moved = resolveAnimal(); drawPresence(); updateOnline(); if (moved) publishPresence(); } });
      updateTemplatePicker();
      flushPending();
    } catch (e) { sharingStatus("error", "ยังเชื่อมข้อมูลไม่ได้ · " + e.message); }
  }
  function updateTemplatePicker() {
    const select = document.getElementById("templateSelect");
    select.innerHTML = '<option value="">ส่วนตัว · ในเบราว์เซอร์นี้</option>';
    for (const item of templates) {
      const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; select.append(option);
    }
    if (room && !templates.some((item) => item.id === room.id)) {
      const option = document.createElement("option"); option.value = room.id; option.textContent = room.name || (room.template ? "Template ที่เลือก" : "ชุดที่แชร์เดิม"); select.append(option);
    }
    select.value = room?.id || "";
  }
  async function loadTemplates() {
    const btn = document.getElementById("refreshTemplates"); btn.disabled = true;
    try { templates = await SHARE.listTemplates(); updateTemplatePicker(); if (!room && !roomError) sharingStatus("local"); }
    catch (e) { if (!room) sharingStatus("error", e.message); btn.title = e.message; }
    finally { btn.disabled = false; }
  }
  document.getElementById("templateSelect").addEventListener("change", (event) => {
    const id = event.target.value;
    if (id === room?.id) return;
    location.href = SHARE.roomURL(location.href, id ? { id, template: true } : null);
  });
  document.getElementById("refreshTemplates").addEventListener("click", loadTemplates);
  document.getElementById("createRoom").disabled = !SHARE.configured();
  document.getElementById("createRoom").title = "ตั้งชื่อ Template · เริ่มด้วยพอร์ตและสถานะที่เห็นอยู่ · ทุกคนเลือกใช้ได้";
  document.getElementById("shareRoom").hidden = !room;
  document.getElementById("createRoom").addEventListener("click", async (event) => {
    const title = window.prompt("ตั้งชื่อ Template (ทุกคนจะเลือกชื่อนี้จากรายการได้)\nเริ่มด้วยพอร์ตและสถานะ Copy ที่เห็นอยู่", "");
    if (title === null) return;
    const name = title.trim();
    if (!name || name.length > 80) { window.alert("ชื่อ Template ต้องมี 1-80 ตัวอักษร"); return; }
    const btn = event.currentTarget; btn.disabled = true;
    sharingStatus("connecting", "กำลังสร้าง Template");
    try {
      const next = await SHARE.createTemplate(name);
      if (interfaceHistory.length || Object.values(temporary).some((maps) => Object.values(maps).some((ports) => Object.keys(ports).length))) {
        const controller = await SHARE.connect(next, () => {}, () => {});
        try {
          for (const item of interfaceHistory) await controller.setInterfaces(item.set, item.device, item.changes.map((v) => v.original), item.changes.map((v) => v.to));
          for (const [set, devices] of Object.entries(temporary)) {
            for (const [device, ports] of Object.entries(devices)) if (Object.keys(ports).length) await controller.setInterfaces(set, device, Object.keys(ports), Object.values(ports));
          }
        } finally { controller.close(); }
      }
      const nextKey = COPY_KEY + ":room:" + next.id;
      try {
        localStorage.setItem(nextKey, JSON.stringify(copied));
        localStorage.setItem(nextKey + ":pending", JSON.stringify(Object.fromEntries(Object.entries(copied).map(([key, signature]) => [key, { signature }]))));
      } catch (e) {}
      location.href = SHARE.roomURL(location.href, next);
    } catch (e) { btn.disabled = false; sharingStatus("error", "สร้าง Template ไม่สำเร็จ · " + e.message); }
  });
  document.getElementById("shareRoom").addEventListener("click", async () => {
    const link = SHARE.roomURL(location.href, room);
    try {
      await navigator.clipboard.writeText(link);
      const btn = document.getElementById("shareRoom"); btn.textContent = "Copied ✓";
      setTimeout(() => { btn.textContent = "Copy ลิงก์"; }, 1600);
    } catch (e) { window.prompt("คัดลอกลิงก์นี้", link); }
  });
  document.getElementById("retrySharing").addEventListener("click", connectSharing);
  updateTemplatePicker();
  const peerNames = (text) => String(text).replace(/\b(?:CE01|CE02|MLS01|MLS02|R01|SW01)\b/g, deviceName);
  function copySignature(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return text.length + ":" + (hash >>> 0).toString(16);
  }
  function copyIdentity(set, device, block) { return set + ":" + device + ":" + block.title; }
  function isCopied(set, device, block) { return copied[copyIdentity(set, device, block)] === copySignature(block.commands.join("\n") + "\n"); }
  function deviceProgress(device) {
    const cfg = mapData(CFG[state.set][device], device);
    const blocks = [{ title: "เริ่มที่นี่: เข้าโหมดตั้งค่า (วางก่อน BLOCK 1)", commands: cfg.prelude }, ...cfg.blocks.filter((b) => b.kind === "config")];
    return { total: blocks.length, done: blocks.filter((b) => isCopied(state.set, device, b)).length };
  }
  const mapped = (text, owner = state.dev) => IF.remap(text, owner, temporary[state.set]);
  const mapData = (data, owner) => Array.isArray(data) ? data.map((v) => mapData(v, owner))
    : data && typeof data === "object" ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, mapData(v, owner)]))
    : typeof data === "string" ? mapped(data, owner) : data;
  function portButton(owner, original) {
    const text = mapped(original, owner), changed = text !== original;
    return '<button type="button" class="interface-edit' + (changed ? ' interface-edited' : '') + '" data-interface-device="' + esc(owner) + '" data-interface-original="' + esc(original) + '" title="จิ้มเพื่อเปลี่ยนพอร์ต · บันทึกและเก็บประวัติ">' + hl(text) + '</button>';
  }
  function peerCell(text) {
    const m = text.match(/^(CE01|CE02|MLS01|MLS02|R01|SW01)\s+(.*)$/);
    return m ? esc(deviceName(m[1])) + ' ' + portButton(m[1], m[2]) : esc(peerNames(text));
  }
  function saveInterfaces() {
    try {
      localStorage.setItem(interfaceKey, JSON.stringify(temporary));
      localStorage.setItem(historyKey, JSON.stringify(interfaceHistory));
    } catch (e) {}
  }
  async function applyPortMap(set, owner, nextMap) {
    const previous = temporary[set][owner] || {};
    const changes = [...new Set(Object.keys(previous).concat(Object.keys(nextMap)))].map((original) => ({ original, from: previous[original] || original, to: nextMap[original] || original })).filter((v) => v.from !== v.to);
    if (!changes.length) return;
    if (room) {
      if (!sharedController) throw new Error("ข้อมูลยังเชื่อมต่อไม่เสร็จ กรุณารอสักครู่แล้วลองอีกครั้ง");
      sharingStatus("saving", "กำลังบันทึกพอร์ตและประวัติให้ทีม");
      await sharedController.setInterfaces(set, owner, changes.map((v) => v.original), changes.map((v) => v.to));
      sharingStatus(realtimeState);
    } else {
      temporary[set][owner] = nextMap;
      interfaceHistory.push({ id: crypto.randomUUID(), set, device: owner, changes, at: new Date().toISOString() });
      saveInterfaces(); refresh();
    }
  }
  async function editPort(owner, original) {
    const set = state.set;
    const value = window.prompt(deviceName(owner) + " — เปลี่ยนพอร์ต " + mapped(original, owner) + "\nบันทึกค่าใหม่และประวัติ (ต้นฉบับ " + original + ")\nใส่ชื่อพอร์ต เช่น e0/1, Gi0/0/2 หรือ Gi1/0/7–8\nเว้นว่างเพื่อคืนค่าเดิม", mapped(original, owner));
    if (value === null) return;
    try {
      const c = CFG[set][owner], d = DEV[owner];
      const reserved = IF.ownPorts(c.prelude.concat(c.blocks.flatMap((b) => b.commands)).join("\n"), owner)
        .concat(d.cables[set].flatMap((r) => IF.parse(r[0])));
      const wanRow = d.cables[set].find((r) => /^G0[12] ISP/.test(r[2]));
      const updated = IF.update(temporary[set], owner, original, value.trim() || original, reserved, wanRow && IF.parse(wanRow[0])[0]);
      // R01's table names its physical WAN port; its script uses a placeholder.
      const wan = d.cables[set].find((r) => r[0] === original && /^G0[12] ISP/.test(r[2]));
      if (wan && original !== "<WAN_PORT>") {
        const map = updated[owner];
        if (value.trim() && value.trim() !== original) map["<WAN_PORT>"] = IF.parse(value)[0];
        else delete map["<WAN_PORT>"];
      }
      await applyPortMap(set, owner, updated[owner]);
    } catch (e) { window.alert(e.message); }
  }
  function updateInterfaceStatus() {
    const count = Object.values(temporary[state.set]).reduce((n, ports) => n + Object.keys(ports).length, 0);
    document.getElementById("interfaceStatus").textContent = count
      ? "เปลี่ยนพอร์ต " + count + " จุด · บันทึกแล้ว · ภาพและ Copy ใช้ค่าใหม่"
      : "จิ้มเลขพอร์ตในภาพหรือตาราง · บันทึกค่าใหม่และประวัติ";
    document.getElementById("resetInterfaces").hidden = count === 0;
    const records = interfaceHistory.filter((v) => v.set === state.set);
    document.getElementById("interfaceHistoryCount").textContent = "ประวัติเปลี่ยนพอร์ต (" + records.length + ")";
    document.getElementById("interfaceHistoryList").innerHTML = records.length ? records.slice().reverse().map((v) => '<li><b>' + esc(deviceName(v.device)) + '</b> <time>' + esc(new Date(v.at).toLocaleString("th-TH")) + '</time>' + v.changes.map((p) => '<div><code>' + esc(IF.format([p.from], "Gi")) + '</code> → <code>' + esc(IF.format([p.to], "Gi")) + '</code><small>ต้นฉบับ ' + esc(IF.format([p.original], "Gi")) + '</small></div>').join("") + '</li>').join("") : '<li>ยังไม่มีการเปลี่ยนพอร์ตในชุดนี้</li>';
  }
  document.getElementById("resetInterfaces").addEventListener("click", async () => {
    const set = state.set;
    try {
      for (const owner of Object.keys(temporary[set])) await applyPortMap(set, owner, {});
    } catch (e) { window.alert(e.message); }
  });
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- topology ---------- */
  const W = 128, H = 52;
  const NODES = {
    G01: { x: 300, y: 58, isp: true, md: "ISP AS65001" },
    G02: { x: 560, y: 58, isp: true, md: "ISP AS65002" },
    CE01: { x: 300, y: 200 }, CE02: { x: 560, y: 200 }, R01: { x: 840, y: 200 },
    MLS01: { x: 300, y: 370 }, MLS02: { x: 560, y: 370 }, SW01: { x: 840, y: 370 },
  };
  // [from, to, class, subnet label, {hsrp:[aPort,bPort], vrrp:[aPort,bPort]}, label offset]
  const LINKS = [
    ["G01", "G02", "wan", "G01 ↔ G02 (ISP)", null, [0, -10]],
    ["CE01", "G01", "wan", "172.31.1.24/30", { hsrp: ["<WAN>", ""], vrrp: ["<WAN>", ""] }, [8, 0]],
    ["CE02", "G02", "wan", "172.31.2.24/30", { hsrp: ["<WAN>", ""], vrrp: ["<WAN>", ""] }, [8, 0]],
    ["CE01", "MLS01", "routed", "10.6.240.0/30", { hsrp: ["Gi0/0/0 · P02", "Gi1/0/1 · P12"], vrrp: ["Gi0/0/0 · T02", "Gi1/0/1 · T15"] }, [-58, 0]],
    ["CE01", "MLS02", "routed", "10.6.240.4/30", { hsrp: ["Gi0/0/1 · P03", "Gi1/0/1 · P16"], vrrp: ["Gi0/0/1 · T03", "Gi1/0/1 · B03"] }, [0, -9], 0.2],
    ["CE02", "MLS01", "routed", "10.6.240.8/30", { hsrp: ["Gi0/0/0 · P05", "Gi1/0/2 · P13"], vrrp: ["Gi0/0/0 · T05", "Gi1/0/2 · T16"] }, [0, -9], 0.2],
    ["CE02", "MLS02", "routed", "10.6.240.12/30", { hsrp: ["Gi0/0/1 · P06", "Gi1/0/2 · P17"], vrrp: ["Gi0/0/1 · T06", "Gi1/0/2 · B04"] }, [62, 0]],
    ["MLS01", "MLS02", "po", "Po1 trunk VLAN10–60", { hsrp: ["Gi1/0/21–22", "Gi1/0/21–22"], vrrp: ["Gi1/0/3–4 · T17/18", "Gi1/0/3–4 · B05/06"] }, [0, 22]],
    ["R01", "SW01", "routed", "10.6.16.0/20", { hsrp: ["Gi0/0/0 · P08", "Gi1/0/1 · P20"], vrrp: ["Gi0/0/0 · T08", "Gi1/0/1 · B15"] }, [52, 0]],
  ];

  function anchor(a, b) {
    // point on node a's border toward node b
    const A = NODES[a], B = NODES[b], dx = B.x - A.x, dy = B.y - A.y;
    const sx = dx === 0 ? Infinity : (W / 2) / Math.abs(dx), sy = dy === 0 ? Infinity : (H / 2) / Math.abs(dy);
    const s = Math.min(sx, sy);
    return [A.x + dx * s, A.y + dy * s];
  }
  function label(g, x, y, text, cls) {
    const t = el("text", { x, y, class: "lbl " + (cls || ""), "text-anchor": "middle", "dominant-baseline": "middle" }, text);
    g.appendChild(t);
    const bb = t.getBBox();
    const r = el("rect", { x: bb.x - 3, y: bb.y - 1, width: bb.width + 6, height: bb.height + 2, rx: 4, class: "lbl-bg" });
    g.insertBefore(r, t);
  }
  function portLabel(parent, x, y, original, owner) {
    const port = original.split(" · ")[0], text = slotShort(mapped(original, owner));
    const g = el("g", { class: "port-edit" + (text !== original ? " changed" : ""), tabindex: 0, role: "button", "aria-label": "แก้พอร์ต " + deviceName(owner) + " " + mapped(port, owner), "data-interface-device": owner, "data-interface-original": port });
    parent.append(g);
    label(g, x, y, text, "port");
    g.append(el("title", {}, "จิ้มเพื่อเปลี่ยนพอร์ต · บันทึกและเก็บประวัติ"));
    g.addEventListener("click", () => editPort(owner, port));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editPort(owner, port); } });
  }

  function drawTopo() {
    svg.textContent = "";
    const gLinks = el("g", {}), gLabels = el("g", {}), gNodes = el("g", {});
    drawHosts();

    // WAN G01 -> R01 (curve over the top)
    gLinks.append(el("path", { d: "M300 32 Q 650 -90 840 174", class: "link wan" }));
    label(gLabels, 760, 40, "172.31.11.24/30");
    if (state.dev === "R01") portLabel(gLabels, 868, 152, "Gi0/0/1 · " + (state.set === "vrrp" ? "T09" : "P09"), "R01");
    // GRE overlay
    gLinks.append(el("path", { d: "M340 174 Q 560 108 800 174", class: "link gre" }));
    gLinks.append(el("path", { d: "M600 174 Q 700 140 790 176", class: "link gre" }));
    label(gLabels, 430, 140, "GRE T1 172.30.6.0/30");
    label(gLabels, 700, 148, "T2 .4/30");

    LINKS.forEach(([a, b, cls, sub, ports, off, tpos]) => {
      const [x1, y1] = anchor(a, b), [x2, y2] = anchor(b, a);
      if (cls === "po") {
        gLinks.append(el("line", { x1, y1: y1 - 5, x2, y2: y2 - 5, class: "link po" }));
        gLinks.append(el("line", { x1, y1: y1 + 5, x2, y2: y2 + 5, class: "link po" }));
      } else {
        gLinks.append(el("line", { x1, y1, x2, y2, class: "link " + cls }));
      }
      const tp = tpos || 0.5, mx = x1 + (x2 - x1) * tp + off[0], my = y1 + (y2 - y1) * tp + off[1];
      label(gLabels, mx, my, sub);
      if (ports && (state.dev === a || state.dev === b)) {
        const [pa, pb] = ports[state.set];
        const near = (xa, ya, xb, yb, f) => [xa + (xb - xa) * f, ya + (yb - ya) * f];
        const vx = x1 === x2 ? -50 : 0;
        if (pa && state.dev === a) { const [px, py] = near(x1, y1, x2, y2, cls === "po" ? 0.02 : 0.2); portLabel(gLabels, px + (cls === "po" ? 52 : vx), py + (cls === "po" ? -18 : 0), pa, a); }
        if (pb && state.dev === b) { const [px, py] = near(x2, y2, x1, y1, cls === "po" ? 0.02 : 0.2); portLabel(gLabels, px - (cls === "po" ? 52 : -vx), py + (cls === "po" ? -18 : 0), pb, b); }
      }
    });

    Object.entries(NODES).forEach(([name, n]) => {
      const g = el("g", { class: "node" + (n.isp ? " isp" : "") + (state.dev === name ? " sel" : ""), tabindex: n.isp ? -1 : 0, role: n.isp ? "img" : "button", "aria-label": deviceName(name), "data-device": name });
      g.append(el("rect", { x: n.x - W / 2, y: n.y - H / 2, width: W, height: H }));
      g.append(el("text", { x: n.x, y: n.y - 5, "text-anchor": "middle", class: "nm" + (n.isp ? "" : " hostname") }, deviceName(name)));
      const md = n.isp ? n.md : pick(DEV[name].model);
      g.append(el("text", { x: n.x, y: n.y + 14, "text-anchor": "middle", class: "md" }, md));
      if (!n.isp) {
        const progress = deviceProgress(name), complete = progress.done === progress.total;
        if (complete) g.classList.add("copied");
        if (progress.done) {
          g.append(el("circle", { cx: n.x + W / 2 - 10, cy: n.y - H / 2 + 10, r: 5, class: complete ? "copy-dot complete" : "copy-dot" }));
        }
        g.append(el("title", {}, "Copy " + progress.done + "/" + progress.total + " BLOCK · สถานะการคัดลอก"));
        g.addEventListener("click", () => go(state.set, name));
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(state.set, name); } });
      }
      gNodes.append(g);
    });
    svg.append(gLinks, gLabels, gNodes);
    drawPresence();
  }
  /* ---------- PCs / servers under the switches ---------- */
  const HQ_HOSTS = [
    { label: "Teller", vlan: 10, ip: "IP อัตโนมัติ", icon: "pc", port: 5 },
    { label: "App Server", vlan: 20, ip: "10.6.1.10", icon: "server", port: 6 },
    { label: "ATM", vlan: 30, ip: "IP อัตโนมัติ", icon: "atm", port: 7 },
    { label: "Database", vlan: 40, ip: "10.6.3.10", icon: "server", port: 8 },
    { label: "Admin", vlan: 50, ip: "10.6.4.10", icon: "pc", port: 9 },
    { label: "Web (DMZ)", vlan: 60, ip: "198.51.100.12", icon: "web", port: 10 },
  ];
  const BR_HOSTS = [
    { label: "Client", vlan: 110, ip: "10.6.16.20", icon: "pc", port: 5 },
    { label: "Server", vlan: 110, ip: "10.6.16.10", icon: "server", port: 6 },
  ];
  // Panel slot for switch access port Gi1/0/<n>, from the cable table (null when cabled at the switch itself).
  function accessSlot(dev, n) {
    for (const r of DEV[dev].cables[state.set]) {
      let ports;
      try { ports = IF.parse(r[0]); } catch (e) { continue; }
      const i = ports.indexOf("GigabitEthernet1/0/" + n), slots = slotsOf(r[1]);
      if (i >= 0) return slots.length === ports.length ? (slots[i].row === "T" ? "บน " : slots[i].row === "B" ? "ล่าง " : "ช่อง ") + slots[i].n : null;
    }
    return null;
  }
  function hostIcon(g, kind, x, y) {
    if (kind === "pc") {
      g.append(el("rect", { x: x - 15, y, width: 30, height: 20, rx: 2, class: "ico" }));
      g.append(el("rect", { x: x - 12, y: y + 3, width: 24, height: 14, rx: 1, class: "ico-scr" }));
      g.append(el("path", { d: "M" + x + " " + (y + 20) + " v5 M" + (x - 8) + " " + (y + 26) + " h16", class: "ico-line" }));
    } else if (kind === "atm") {
      g.append(el("rect", { x: x - 12, y: y - 2, width: 24, height: 28, rx: 3, class: "ico" }));
      g.append(el("rect", { x: x - 8, y: y + 2, width: 16, height: 9, rx: 1, class: "ico-scr" }));
      g.append(el("path", { d: "M" + (x - 6) + " " + (y + 16) + " h12 M" + (x - 6) + " " + (y + 21) + " h12", class: "ico-line" }));
    } else {
      for (let i = 0; i < 3; i++) {
        g.append(el("rect", { x: x - 13, y: y - 1 + i * 9, width: 26, height: 8, rx: 1.5, class: "ico" }));
        g.append(el("circle", { cx: x + 8, cy: y + 3 + i * 9, r: 1.4, class: "ico-dot" }));
      }
      if (kind === "web") {
        g.append(el("circle", { cx: x + 15, cy: y + 1, r: 6, class: "ico-globe" }));
        g.append(el("path", { d: "M" + (x + 9) + " " + (y + 1) + " h12 M" + (x + 15) + " " + (y - 5) + " v12", class: "ico-line thin" }));
      }
    }
  }
  function drawHostRow(hosts, x0, width, switches, bg) {
    const step = width / hosts.length, top = 486, iconY = 500, sel = switches.includes(state.dev);
    const xs = hosts.map((h, i) => x0 + step * (i + 0.5));
    bg.append(el("line", { x1: xs[0], y1: top, x2: xs[xs.length - 1], y2: top, class: "host-bus" }));
    hosts.forEach((h, i) => {
      const x = xs[i], g = el("g", { class: "host" + (sel ? " sel" : "") });
      bg.append(el("line", { x1: x, y1: top, x2: x, y2: iconY - 4, class: "host-bus" }));
      hostIcon(g, h.icon, x, iconY);
      const lines = [[h.label, "host-name"], ["VLAN " + h.vlan, "host-t"], [h.ip, "host-t mono"]];
      switches.forEach((sw) => {
        const slot = accessSlot(sw, h.port);
        lines.push([sw + " " + (slot || "LAN " + h.port), "host-plug"]);
      });
      lines.forEach(([t, cls], n) => g.append(el("text", { x, y: iconY + 42 + n * 14, "text-anchor": "middle", class: cls }, t)));
      g.append(el("title", {}, h.label + " · VLAN " + h.vlan + " · " + h.ip + " · เสียบพอร์ต Gi1/0/" + h.port + " ของ " + switches.join(" หรือ ")));
      bg.append(g);
    });
  }
  function drawHosts() {
    const bg = el("g", { class: "hosts" });
    svg.append(bg);
    bg.append(el("rect", { x: 140, y: 462, width: 580, height: 178, rx: 12, class: "zone" }));
    bg.append(el("text", { x: 150, y: 478, class: "zone-t" }, "HQ LAN — เสียบ PC ที่ MLS01 หรือ MLS02 ก็ได้ · " + (state.set === "vrrp" ? "ป้ายฟ้า = ช่องบนแผง (บน/ล่าง = แถว)" : "ป้ายฟ้า = ช่อง LAN ที่ตัวสวิตช์")));
    bg.append(el("text", { x: 430, y: 632, "text-anchor": "middle", class: "zone-t" }, "Gateway ทุก VLAN = .1 · DMZ = 198.51.100.11 (" + SETS[state.set].fhrp + ")"));
    bg.append(el("rect", { x: 740, y: 462, width: 200, height: 178, rx: 12, class: "zone" }));
    bg.append(el("text", { x: 750, y: 478, class: "zone-t" }, "สาขา VLAN110 · GW .1"));
    [300, 560].forEach((x) => bg.append(el("line", { x1: x, y1: 396, x2: x, y2: 486, class: "link routed", opacity: 0.35 })));
    bg.append(el("line", { x1: 840, y1: 396, x2: 840, y2: 486, class: "link routed", opacity: 0.35 }));
    drawHostRow(HQ_HOSTS, 140, 580, ["MLS01", "MLS02"], bg);
    drawHostRow(BR_HOSTS, 740, 200, ["SW01"], bg);
  }
  function drawPresence() {
    svg.querySelector(".presence")?.remove();
    const layer = el("g", { class: "presence" });
    svg.append(layer);
    Object.entries(NODES).forEach(([name, n]) => {
      if (n.isp) return;
      const list = people.filter((p) => p.key !== presenceKey && p.dev === name)
        .map((p) => ({ animal: p.animal, text: p.name + (p.set && p.set !== state.set ? " (" + p.set.toUpperCase() + ")" : "") }));
      if (state.dev === name) list.unshift({ animal: myAnimal, text: displayName() + " (คุณ)" });
      if (!list.length) return;
      const shown = list.slice(0, 3);
      if (list.length > 3) shown.push({ animal: "", text: "+" + (list.length - 3) });
      // Lay out avatar + name chips in a row centred under the node.
      const row = el("g", {}), y = n.y + H / 2 + 13;
      layer.append(row);
      let x = 0;
      shown.forEach((p) => {
        const a = animalOf(p.animal), chip = el("g", { class: "who-chip" });
        row.append(chip);
        let w = 0;
        if (a?.img) { chip.append(el("image", { href: a.img, x, y: y - 9, width: 18, height: 18, class: "who-img" })); w = 21; }
        else if (a) { chip.append(el("text", { x, y, "dominant-baseline": "middle", class: "who-emoji" }, a.emoji)); w = chip.getBBox().width + 3; }
        const t = el("text", { x: x + w, y, "dominant-baseline": "middle", class: "lbl who" }, p.text);
        chip.append(t);
        const bb = chip.getBBox();
        chip.insertBefore(el("rect", { x: bb.x - 4, y: bb.y - 1, width: bb.width + 8, height: bb.height + 2, rx: 9, class: "lbl-bg who-bg" }), chip.firstChild);
        x += bb.width + 12;
      });
      const total = row.getBBox();
      row.setAttribute("transform", "translate(" + (n.x - total.x - total.width / 2) + ",0)");
    });
  }
  function updateOnline() {
    const box = document.getElementById("onlineList");
    updateAvatar();
    if (!room) { box.hidden = true; return; }
    const others = people.filter((p) => p.key !== presenceKey);
    box.hidden = false;
    box.textContent = "ออนไลน์ " + (others.length + 1) + " คน" + (others.length ? ": " + others.map((p) => (animalOf(p.animal)?.emoji || "") + p.name + (p.dev ? " → " + p.dev : "")).join(" · ") : "");
  }
  const nameInput = document.getElementById("myName"), avatar = document.getElementById("myAvatar");
  function updateAvatar() {
    const a = animalOf(myAnimal);
    avatar.textContent = "";
    if (a.img) avatar.append(Object.assign(document.createElement("img"), { src: a.img, alt: "" }));
    else avatar.textContent = a.emoji;
    avatar.title = "สัตว์ประจำตัว: " + a.label + " (แจกให้อัตโนมัติ ไม่ซ้ำกับคนที่เข้ามาก่อน)";
    nameInput.placeholder = a.label;
  }
  updateAvatar();
  nameInput.value = myName;
  let nameTimer;
  nameInput.addEventListener("input", () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      myName = cleanName(nameInput.value);
      try { myName ? localStorage.setItem(NAME_KEY, myName) : localStorage.removeItem(NAME_KEY); } catch (e) {}
      drawPresence(); publishPresence();
    }, 300);
  });

  /* ---------- detail ---------- */
  function blockHTML(b, id) {
    const done = isCopied(state.set, state.dev, b);
    const status = b.interfaceChanged ? '<span class="chip warn">ปรับพอร์ตแล้ว · รอตรวจ</span>' : b.status === "tested" ? '<span class="chip ok">ผ่านบน Rack</span>'
      : b.status === "passed" ? '<span class="chip ok">ผ่านบน Rack (ดูหมายเหตุ)</span>'
      : '<span class="chip warn">ยังไม่ทดสอบ</span>';
    const notes = b.notes.length ? '<div class="notes">' + b.notes.map((n) => "<p>" + hl(n) + "</p>").join("") + "</div>" : "";
    const verify = b.verify.length ? '<div class="verify"><b>ตรวจหลังวาง:</b>' + b.verify.map((v) => "<p>" + hl(v) + "</p>").join("") + "</div>" : "";
    const hasPh = b.commands.some((c) => /<(?!->)[^<>]+>/.test(c));
    return '<div class="block' + (done ? ' copied-block' : '') + '">' +
      '<div class="block-h"><div><div class="t">' + hl(b.title) + '</div><div class="st">' + status +
      (hasPh ? ' <span class="chip warn">มีค่าต้องเติม</span>' : "") + (done ? ' <span class="chip ok copy-mark">✓ Copy แล้ว</span>' : '') + "</div></div>" +
      '<div class="block-actions"><button class="copy' + (done ? ' done' : '') + '" data-copy="' + id + '">' + (done ? 'Copy อีกครั้ง' : 'Copy') + '</button><button type="button" class="undo-copy" data-undo-copy="' + id + '" title="ยกเลิกเครื่องหมาย Copy เฉพาะ BLOCK นี้"' + (done ? '' : ' hidden') + '>ยกเลิก ✓</button></div></div>' + notes +
      "<pre>" + b.commands.map(hl).join("\n") + "</pre>" + verify + "</div>";
  }

  // Picture of the patch panel (as seen from the front of the rack) with this device's slots lit up.
  function panelHTML(name) {
    const d = DEV[name], used = new Map();
    const mark = (slot, kind, text) => { const k = slot.row + slot.n; if (!used.has(k)) used.set(k, { kind, text: [] }); used.get(k).text.push(text); };
    slotsOf(String(d.console[state.set]).split(" ")[0]).slice(0, 1).forEach((sl) => mark(sl, "con", "สาย Console ของ " + name));
    d.cables[state.set].forEach((r) => {
      const slots = slotsOf(r[1]);
      let ports = [r[0]];
      try { ports = IF.parse(mapped(r[0], name)).map((p) => IF.format([p], "Gi")); } catch (e) {}
      let originals = [];
      try { originals = IF.parse(r[0]); } catch (e) {}
      slots.forEach((sl, i) => {
        const own = ports.length === slots.length ? ports[i] : mapped(r[0], name);
        // Access ports: name the actual PC (Teller, ATM, ...) instead of the generic "PC" text.
        const n = Number((originals[i] || "").match(/^GigabitEthernet1\/0\/(\d+)$/)?.[1]);
        const host = /^PC/.test(r[2]) && (name === "SW01" ? BR_HOSTS : HQ_HOSTS).find((h) => h.port === n);
        mark(sl, "lan", own + " → " + (host ? "PC " + host.label + " (VLAN " + host.vlan + ")" : /^PC/.test(r[2]) ? "PC สำรอง (ว่างได้)" : peerNames(r[2])));
      });
    });
    if (!used.size) return '<p class="meta">ไม่มีเลขช่องแผงของชุดนี้ — สายเสียบตรงที่ตัวเครื่อง</p>';
    const rows = state.set === "vrrp" ? [["T", "แถวบน"], ["B", "แถวล่าง"]] : [["P", "แผง"]];
    let html = '<div class="panel"><div class="panel-title">แผงเสียบสาย (มองจากหน้า rack) · ช่องที่มีสีคือช่องของเครื่องนี้</div>';
    rows.forEach(([r, label]) => {
      html += '<div class="panel-row"><span class="panel-label"><span class="long">' + label + '</span><span class="short">' + label.replace("แถว", "") + '</span></span><div class="panel-cells">';
      for (let i = 1; i <= 24; i++) {
        const u = used.get(r + i);
        html += '<span class="cell' + (u ? " " + u.kind : "") + '"' + (u ? ' title="' + esc(label + " ช่อง " + i + ": " + u.text.join(", ")) + '"' : "") + ">" + i + "</span>";
      }
      html += "</div></div>";
    });
    html += '<ul class="panel-key">' + [...used.entries()].sort((a, b) => (a[0][0] === b[0][0] ? Number(a[0].slice(1)) - Number(b[0].slice(1)) : a[0][0] === "T" ? -1 : 1))
      .map(([k, u]) => '<li><span class="cell ' + u.kind + '">' + k.slice(1) + "</span>" + esc(slotText(k)) + " — " + esc(u.text.join(", ")) + "</li>").join("") + "</ul>";
    return html + '<p class="panel-legend"><span class="cell con"></span> Console <span class="cell lan"></span> สาย LAN</p></div>';
  }
  function renderDevice() {
    const name = state.dev, d = DEV[name], originalConfig = CFG[state.set][name], c = mapData(originalConfig, name);
    c.blocks.forEach((b, i) => { b.interfaceChanged = b.commands.some((line, n) => line !== originalConfig.blocks[i].commands[n]); });
    const copyMap = {};
    let n = 0;
    const reg = (b) => { const id = "b" + n++; copyMap[id] = { text: b.commands.join("\n") + "\n", key: copyIdentity(state.set, name, b), set: state.set, device: name }; return id; };

    const cables = d.cables[state.set].map((r) => "<tr><td class=\"mono\">" + portButton(name, r[0]) + "</td><td>" + esc(slotText(r[1])) + "</td><td>" + peerCell(r[2]) + "</td><td>" + esc(slotText(r[3])) + "</td><td class=\"mono\">" + esc(r[4]) + "</td></tr>").join("");
    const expects = d.expect.map(pick).map((e) => "<li><code>" + esc(mapped(e[0], name)) + "</code><span>" + esc(mapped(e[1], name)) + "</span></li>").join("");
    const verifyBlock = c.blocks.find((b) => b.kind === "verify");
    const seen = new Set(d.expect.map(pick).map((e) => e[0].replace(/\s+/g, " ").trim()));
    const extra = verifyBlock ? verifyBlock.verify.map((v) => {
      const m = v.match(/^(.*?)\s+->\s+(.*)$/);
      const cmd = (m ? m[1] : v).replace(/\s+/g, " ").trim();
      if (seen.has(cmd)) return "";
      seen.add(cmd);
      return "<li><code>" + esc(cmd) + "</code><span>" + esc(m ? m[2] : "") + "</span></li>";
    }).join("") : "";
    const warns = c.header.filter((h) => h.startsWith("!!") || /ช้า|สลับ|paste/.test(h));

    const tested = c.blocks.filter((b) => b.kind === "config" && b.status === "tested");
    const later = c.blocks.filter((b) => b.kind === "config" && b.status !== "tested");
    const prelude = { title: "เริ่มที่นี่: เข้าโหมดตั้งค่า (วางก่อน BLOCK 1)", status: "tested", notes: [], commands: c.prelude, verify: [] };
    const hostnameCommand = c.blocks.flatMap((b) => b.commands).find((line) => /^\s*hostname\s+/.test(line));
    const scriptHostname = hostnameCommand ? hostnameCommand.trim().split(/\s+/)[1] : null;

    let html = '<button class="back" data-back>← ภาพรวม</button>' +
      "<h2>" + esc(deviceName(name)) + "</h2><p class=\"meta\">" + esc(d.role) + "</p>" +
      '<p class="meta">ชื่อย่อ: ' + esc(name) + (scriptHostname ? ' · Hostname ในสคริปต์เว็บ: <code>' + esc(scriptHostname) + '</code>' : "") + '</p>' +
      '<div class="chips"><span class="chip">' + esc(pick(d.model)) + '</span><span class="chip">' + esc(d.loopback) + '</span><span class="chip">Console: ' + esc(slotText(d.console[state.set])) + '</span><span class="chip">ชุด ' + esc(SETS[state.set].label) + "</span></div>";
    const progress = deviceProgress(name);
    html += '<div class="copy-progress"><span>✓ Copy ' + progress.done + '/' + progress.total + ' BLOCK · สีเขียวเมื่อครบ</span><button type="button" data-reset-copy' + (progress.done ? '' : ' hidden') + '>ล้างเครื่องหมาย Copy</button><small>' + (room ? 'ทุกคนที่ใช้ Template นี้เห็นเครื่องหมาย พอร์ต และประวัติร่วมกัน' : 'จำในเบราว์เซอร์นี้') + ' · นับการคัดลอกคำสั่ง · ตรวจผลบน Router แยกตาม BLOCK</small></div>';
    if (warns.length) html += '<div class="notice">' + warns.map((w) => "<p>" + hl(w.replace(/^!!\s*/, "")) + "</p>").join("") + "</div>";
    html += "<h3>เสียบสาย</h3>" + panelHTML(name) + "<div class=\"table-wrap\"><table><thead><tr><th>พอร์ตบนเครื่อง</th><th>เสียบที่แผง</th><th>ไปที่เครื่อง</th><th>ปลายสายอยู่ที่</th><th>IP / หน้าที่</th></tr></thead><tbody>" + cables + "</tbody></table></div>";
    html += "<h3>ผลที่ต้องเห็นหลังวางครบ</h3><ul class=\"expect\">" + expects + extra + "</ul>" +
      '<p class="meta" style="margin-top:8px">ถ้าอีกฝั่งยังวางไม่เสร็จ OSPF / LACP / Gateway จะยังไม่ขึ้น — รอทุกเครื่องเสร็จแล้วรอ ~1 นาที</p>';
    html += "<h3>คอนฟิก (วางทีละ BLOCK แล้วรอ prompt)</h3>";
    html += blockHTML(prelude, reg(prelude));
    tested.forEach((b) => { html += blockHTML(b, reg(b)); });
    if (later.length) {
      html += '<details class="untested"><summary>ส่วนต่อไป — ' + later.filter((b) => b.status === "untested").length + " BLOCK ยังไม่ทดสอบ / " + later.filter((b) => b.status === "passed").length + " BLOCK ผ่านแล้ว (กดเพื่อเปิด)</summary><div class=\"inner\">";
      if (c.untestedIntro.length) html += '<div class="intro">' + c.untestedIntro.map((t) => "<p>" + hl(t) + "</p>").join("") + "</div>";
      later.forEach((b) => { html += blockHTML(b, reg(b)); });
      html += "</div></details>";
    }
    detail.innerHTML = html;
    detail.querySelectorAll(".copy").forEach((btn) => btn.addEventListener("click", () => copy(copyMap[btn.dataset.copy], btn)));
    detail.querySelectorAll("[data-undo-copy]").forEach((btn) => btn.addEventListener("click", () => {
      const entry = copyMap[btn.dataset.undoCopy];
      delete copied[entry.key]; persistChanges({ [entry.key]: null }); updateProgressView();
    }));
    detail.querySelector("[data-reset-copy]").addEventListener("click", () => {
      const prefix = state.set + ":" + name + ":";
      const changes = {};
      for (const key of Object.keys(copied)) if (key.startsWith(prefix)) { delete copied[key]; changes[key] = null; }
      persistChanges(changes);
      refresh();
    });
    detail.querySelectorAll("[data-interface-original]").forEach((btn) => btn.addEventListener("click", () => editPort(btn.dataset.interfaceDevice, btn.dataset.interfaceOriginal)));
    detail.querySelector("[data-back]").addEventListener("click", () => go(state.set, null));
  }

  function renderOverview() {
    const rows = ZONES.map((z) => "<tr>" + z.map((v, i) => (i === 2 || i === 3 ? '<td class="mono">' : "<td>") + esc(v) + "</td>").join("") + "</tr>").join("");
    detail.innerHTML = '<div class="overview">' +
      "<h2>ภาพรวม G06</h2>" +
      '<p class="meta">' + esc(SETS[state.set].rack) + "</p>" +
      "<h3>ใช้ยังไง</h3><ol>" +
      "<li>ดูรุ่นสวิตช์ MLS (<code>show version | include Model Number</code>) แล้วเลือกปุ่มด้านบน: <b>C9300 → HSRP</b> · <b>C9200L → VRRP</b> (ไม่แน่ใจ: ถ้า <code>standby</code> ขึ้น % Invalid ใช้ VRRP)</li>" +
      "<li>แต่ละคนกดเครื่องของตัวเองในภาพ ดูช่อง Console และสายที่ต้องเสียบ</li>" +
      "<li>ก่อนใส่ IP เช็ก <code>show cdp neighbors</code> ว่าสายไปถูกเครื่อง/พอร์ต (rack อาจต่างจากตาราง)</li>" +
      "<li>กด Copy ทีละ BLOCK วางใน Console แล้วรอ prompt — ขึ้น <code>% Invalid</code> ให้หยุดดู</li>" +
      "<li>วางพร้อมกันได้ทุกเครื่อง ทุกคู่ต่อกันเองเมื่ออีกฝั่งเสร็จ แล้วเช็ก “ผลที่ต้องเห็น”</li></ol>" +
      '<div class="notice"><p>ทั้งทีมตกลงรหัสผ่านเดียวกันก่อนเริ่ม (enable secret ที่เครื่องใหม่บังคับตั้ง + บรรทัด username ใน U-SSH) — ห้ามเขียนรหัสจริงลงไฟล์หรือเว็บ</p><p>สวิตช์ C9200L รับตัวอักษรเร็วไม่ทัน: วางทีละ BLOCK หรือตั้ง paste delay ~20 ms/ตัว</p></div>' +
      "<h3>แบ่งงาน</h3><div class=\"table-wrap\"><table><thead><tr><th>คน</th><th>เครื่อง</th><th>หมายเหตุ</th></tr></thead><tbody>" +
      "<tr><td>1</td><td>" + esc(deviceName("MLS01")) + "</td><td>มี DHCP · คนตรวจผลรวมตอนท้าย</td></tr><tr><td>2</td><td>" + esc(deviceName("MLS02")) + "</td><td></td></tr>" +
      "<tr><td>3</td><td>" + esc(deviceName("CE01")) + "</td><td>WAN ทางหลัก</td></tr><tr><td>4</td><td>" + esc(deviceName("CE02")) + "</td><td>WAN ทางสำรอง</td></tr>" +
      "<tr><td>5</td><td>" + esc(deviceName("R01")) + " + " + esc(deviceName("SW01")) + "</td><td>สาขา สั้นทั้งคู่</td></tr></tbody></table></div>" +
      "<h3>VLAN / Gateway</h3><div class=\"table-wrap\"><table><thead><tr><th>VLAN</th><th>ชื่อ</th><th>วง</th><th>Gateway</th><th>เครื่องในวง</th><th>ช่อง</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<p class="meta" style="margin-top:10px">Loopback0: CE01 .1 · CE02 .2 · MLS01 .11 · MLS02 .12 (10.6.255.x) · AS65106 · ISP G01 AS65001 (หลัก) / G02 AS65002 (สำรอง)</p>' +
      "</div>";
  }

  /* ---------- copy ---------- */
  function copy(entry, btn) {
    const text = entry.text;
    const done = () => {
      copied[entry.key] = copySignature(text);
      persistChanges({ [entry.key]: copied[entry.key] });
      if (!detail.contains(btn) || state.set !== entry.set || state.dev !== entry.device) { drawTopo(); return; }
      const block = btn.closest(".block");
      block.classList.add("copied-block");
      if (!block.querySelector(".copy-mark")) {
        const mark = document.createElement("span"); mark.className = "chip ok copy-mark"; mark.textContent = "✓ Copy แล้ว";
        block.querySelector(".st").append(" ", mark);
      }
      btn.textContent = "Copied ✓"; btn.classList.add("done");
      block.querySelector(".undo-copy").hidden = false;
      const progress = deviceProgress(state.dev);
      detail.querySelector(".copy-progress span").textContent = "✓ Copy " + progress.done + "/" + progress.total + " BLOCK · สีเขียวเมื่อครบ";
      detail.querySelector("[data-reset-copy]").hidden = false;
      drawTopo();
      setTimeout(() => { btn.textContent = "Copy อีกครั้ง"; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback(text) ? done() : window.alert("คัดลอกไม่สำเร็จ ลองกด Copy อีกครั้ง"));
    } else if (fallback(text)) done();
    else window.alert("คัดลอกไม่สำเร็จ ลองกด Copy อีกครั้ง");
  }
  function fallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }

  /* ---------- routing ---------- */
  function go(set, dev) {
    location.hash = set + (dev ? "/" + dev : "");
  }
  function refresh() {
    updateInterfaceStatus();
    const po = SETS[state.set].poPorts.split(" ")[0];
    const changed = Object.values(temporary[state.set]).some((ports) => Object.keys(ports).length);
    document.getElementById("rackNote").textContent = SETS[state.set].rack.replace(/\s*\(T = แถวบน, B = แถวล่าง\)|\s*\(P = ช่องแผง\)/, "") + " · Po1: " + (changed ? "MLS01 " + mapped(po, "MLS01") + " ↔ MLS02 " + mapped(po, "MLS02") : slotText(SETS[state.set].poPorts));
    drawTopo();
    state.dev ? renderDevice() : renderOverview();
  }
  function fromHash() {
    const [s, d] = location.hash.replace(/^#/, "").split("/");
    state.set = SETS[s] ? s : "vrrp";
    state.dev = DEV[d] ? d : null;
    document.querySelectorAll(".set-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.set === state.set)));
    refresh();
    publishPresence();
    if (state.dev && window.innerWidth < 980) detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.querySelectorAll(".set-switch button").forEach((b) => b.addEventListener("click", () => go(b.dataset.set, state.dev)));
  window.addEventListener("hashchange", fromHash);
  fromHash();
  if (SHARE.configured()) loadTemplates();
  if (roomError) sharingStatus("error", roomError);
  else if (room) connectSharing();
  else if (!SHARE.configured()) sharingStatus("local", "สถานะ Copy · เก็บในเบราว์เซอร์นี้ · แชร์กับทีมรอตั้งค่า Supabase");
})();
