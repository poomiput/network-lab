(function () {
  "use strict";
  const CFG = window.G06_CONFIGS, DEV = window.G06_DEVICES, SETS = window.G06_SETS, ZONES = window.G06_ZONES;
  const svg = document.getElementById("topo");
  const detail = document.getElementById("detail");
  const state = { set: "vrrp", dev: null };

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
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hl = (s) => esc(s).replace(/&lt;(?!-&gt;)([^&]*?)&gt;/g, '<span class="ph">&lt;$1&gt;</span>');
  const pick = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v[state.set] : v);
  const deviceName = (id) => DEV[id]?.hostname || id;
  const peerNames = (text) => String(text).replace(/\b(?:CE01|CE02|MLS01|MLS02|R01|SW01)\b/g, deviceName);
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

  function drawTopo() {
    svg.textContent = "";
    const gLinks = el("g", {}), gLabels = el("g", {}), gNodes = el("g", {});
    svg.append(el("rect", { x: 200, y: 470, width: 460, height: 100, rx: 12, class: "zone" }));
    const zt = el("text", { x: 430, y: 492, "text-anchor": "middle", class: "zone-t" });
    zt.textContent = "HQ LAN · VLAN10 Teller · 20 App · 30 ATM · 40 DB · 50 Admin · 60 DMZ";
    svg.append(zt);
    const zt2 = el("text", { x: 430, y: 516, "text-anchor": "middle", class: "zone-t" });
    zt2.textContent = "VIP: VLAN10–50 ใช้ .1 · DMZ ใช้ 198.51.100.11 (" + SETS[state.set].fhrp + ")";
    svg.append(zt2);
    const zt3 = el("text", { x: 430, y: 540, "text-anchor": "middle", class: "zone-t" });
    zt3.textContent = "PC เสียบช่อง/LAN 5–10 ของ MLS (5=Teller … 10=DMZ)";
    svg.append(zt3);
    svg.append(el("rect", { x: 760, y: 470, width: 160, height: 100, rx: 12, class: "zone" }));
    const bt = el("text", { x: 840, y: 505, "text-anchor": "middle", class: "zone-t" }); bt.textContent = "Branch VLAN110"; svg.append(bt);
    const bt2 = el("text", { x: 840, y: 529, "text-anchor": "middle", class: "zone-t" }); bt2.textContent = "10.6.16.0/20 · GW .1"; svg.append(bt2);
    svg.append(el("line", { x1: 300, y1: 396, x2: 300, y2: 470, class: "link routed", opacity: 0.35 }));
    svg.append(el("line", { x1: 560, y1: 396, x2: 560, y2: 470, class: "link routed", opacity: 0.35 }));
    svg.append(el("line", { x1: 840, y1: 396, x2: 840, y2: 470, class: "link routed", opacity: 0.35 }));

    // WAN G01 -> R01 (curve over the top)
    gLinks.append(el("path", { d: "M300 32 Q 650 -90 840 174", class: "link wan" }));
    label(gLabels, 760, 40, "172.31.11.24/30");
    if (state.dev === "R01") label(gLabels, 868, 152, "Gi0/0/1 · " + (state.set === "vrrp" ? "T09" : "P09"), "port");
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
        if (pa && state.dev === a) { const [px, py] = near(x1, y1, x2, y2, cls === "po" ? 0.02 : 0.2); label(gLabels, px + (cls === "po" ? 52 : vx), py + (cls === "po" ? -18 : 0), pa, "port"); }
        if (pb && state.dev === b) { const [px, py] = near(x2, y2, x1, y1, cls === "po" ? 0.02 : 0.2); label(gLabels, px - (cls === "po" ? 52 : -vx), py + (cls === "po" ? -18 : 0), pb, "port"); }
      }
    });

    Object.entries(NODES).forEach(([name, n]) => {
      const g = el("g", { class: "node" + (n.isp ? " isp" : "") + (state.dev === name ? " sel" : ""), tabindex: n.isp ? -1 : 0, role: n.isp ? "img" : "button", "aria-label": deviceName(name), "data-device": name });
      g.append(el("rect", { x: n.x - W / 2, y: n.y - H / 2, width: W, height: H }));
      g.append(el("text", { x: n.x, y: n.y - 5, "text-anchor": "middle", class: "nm" + (n.isp ? "" : " hostname") }, deviceName(name)));
      const md = n.isp ? n.md : pick(DEV[name].model);
      g.append(el("text", { x: n.x, y: n.y + 14, "text-anchor": "middle", class: "md" }, md));
      if (!n.isp) {
        g.addEventListener("click", () => go(state.set, name));
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(state.set, name); } });
      }
      gNodes.append(g);
    });
    svg.append(gLinks, gLabels, gNodes);
  }

  /* ---------- detail ---------- */
  function blockHTML(b, id) {
    const status = b.status === "tested" ? '<span class="chip ok">ผ่านบน Rack</span>'
      : b.status === "passed" ? '<span class="chip ok">ผ่านบน Rack (ดูหมายเหตุ)</span>'
      : '<span class="chip warn">ยังไม่ทดสอบ</span>';
    const notes = b.notes.length ? '<div class="notes">' + b.notes.map((n) => "<p>" + hl(n) + "</p>").join("") + "</div>" : "";
    const verify = b.verify.length ? '<div class="verify"><b>ตรวจหลังวาง:</b>' + b.verify.map((v) => "<p>" + hl(v) + "</p>").join("") + "</div>" : "";
    const hasPh = b.commands.some((c) => /<(?!->)[^<>]+>/.test(c));
    return '<div class="block">' +
      '<div class="block-h"><div><div class="t">' + hl(b.title) + '</div><div class="st">' + status +
      (hasPh ? ' <span class="chip warn">มีค่าต้องเติม</span>' : "") + "</div></div>" +
      '<button class="copy" data-copy="' + id + '">Copy</button></div>' + notes +
      "<pre>" + b.commands.map(hl).join("\n") + "</pre>" + verify + "</div>";
  }

  function renderDevice() {
    const name = state.dev, d = DEV[name], c = CFG[state.set][name];
    const copyMap = {};
    let n = 0;
    const reg = (b) => { const id = "b" + n++; copyMap[id] = b.commands.join("\n") + "\n"; return id; };

    const cables = d.cables[state.set].map((r) => "<tr><td class=\"mono\">" + hl(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + esc(peerNames(r[2])) + "</td><td>" + esc(r[3]) + "</td><td class=\"mono\">" + esc(r[4]) + "</td></tr>").join("");
    const expects = d.expect.map(pick).map((e) => "<li><code>" + esc(e[0]) + "</code><span>" + esc(e[1]) + "</span></li>").join("");
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
      '<div class="chips"><span class="chip">' + esc(pick(d.model)) + '</span><span class="chip">' + esc(d.loopback) + '</span><span class="chip">Console: แผง ' + esc(d.console[state.set]) + '</span><span class="chip">ชุด ' + esc(SETS[state.set].label) + "</span></div>";
    if (warns.length) html += '<div class="notice">' + warns.map((w) => "<p>" + hl(w.replace(/^!!\s*/, "")) + "</p>").join("") + "</div>";
    html += "<h3>เสียบสาย</h3><div class=\"table-wrap\"><table><thead><tr><th>พอร์ต</th><th>แผง</th><th>ไปที่</th><th>แผงปลาย</th><th>IP / หน้าที่</th></tr></thead><tbody>" + cables + "</tbody></table></div>";
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
  function copy(text, btn) {
    const done = () => { btn.textContent = "Copied ✓"; btn.classList.add("done"); setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback(text) && done());
    } else if (fallback(text)) done();
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
  function fromHash() {
    const [s, d] = location.hash.replace(/^#/, "").split("/");
    state.set = SETS[s] ? s : "vrrp";
    state.dev = DEV[d] ? d : null;
    document.querySelectorAll(".set-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.set === state.set)));
    document.getElementById("rackNote").textContent = SETS[state.set].rack + " · Po1: " + SETS[state.set].poPorts;
    drawTopo();
    state.dev ? renderDevice() : renderOverview();
    if (state.dev && window.innerWidth < 980) detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.querySelectorAll(".set-switch button").forEach((b) => b.addEventListener("click", () => go(b.dataset.set, state.dev)));
  window.addEventListener("hashchange", fromHash);
  fromHash();
})();
