(function (root) {
  "use strict";
  const families = {
    gi: "GigabitEthernet", gigabitethernet: "GigabitEthernet",
    fa: "FastEthernet", fastethernet: "FastEthernet",
    e: "Ethernet", et: "Ethernet", ethernet: "Ethernet",
    te: "TenGigabitEthernet", tengigabitethernet: "TenGigabitEthernet",
    se: "Serial", serial: "Serial"
  };
  const short = { GigabitEthernet: "Gi", FastEthernet: "Fa", Ethernet: "Et", TenGigabitEthernet: "Te", Serial: "Se" };
  const portPattern = "(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|Ethernet|Serial|Gi|Fa|Te|Et|Se|\\bE)\\d+(?:/\\d+){0,3}(?:\\s*[-–]\\s*\\d+)?";
  const peerPattern = "(?:G06-(?:HQ|BR)-)?(?:CE01|CE02|MLS01|MLS02|R01|SW01)";
  const tokens = new RegExp("(?:(" + peerPattern + ")([\\s-]+))?(" + portPattern + "|<WAN_PORT>|<WAN>)(?![\\w/])", "gi");

  function parse(value) {
    const text = String(value).trim();
    if (/^<WAN(?:_PORT)?>$/i.test(text)) return ["<WAN_PORT>"];
    const m = text.match(/^([a-z]+)(\d+(?:\/\d+){0,3})(?:\s*[-–]\s*(\d+))?$/i);
    if (!m || !families[m[1].toLowerCase()]) throw new Error("ใส่ชื่อพอร์ต เช่น e0/1, Gi0/0/2 หรือ Gi1/0/7–8");
    const family = families[m[1].toLowerCase()], parts = m[2].split("/").map(Number);
    const first = parts.pop(), last = m[3] == null ? first : Number(m[3]);
    if (last < first || last - first > 47) throw new Error("ช่วงพอร์ตต้องเรียงจากน้อยไปมาก และไม่เกิน 48 พอร์ต");
    const prefix = family + (parts.length ? parts.join("/") + "/" : "");
    return Array.from({ length: last - first + 1 }, (_, i) => prefix + (first + i));
  }
  function format(ports, original) {
    const abbreviation = !/^(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|Ethernet|Serial)/i.test(original);
    const display = (port) => abbreviation ? port.replace(/^[a-z]+/i, (f) => short[f] || f) : port;
    if (ports.length === 1) return display(ports[0]);
    const first = ports[0].match(/^(.*?)(\d+)$/);
    const consecutive = first && ports.every((p, i) => p === first[1] + (Number(first[2]) + i));
    if (consecutive) {
      const dash = original.includes("–") ? "–" : " - ";
      return display(ports[0]) + dash + ports[ports.length - 1].match(/\d+$/)[0];
    }
    return ports.map(display).join(" , ");
  }
  function remap(text, owner, maps) {
    return String(text).replace(tokens, (whole, peer, separator, port) => {
      const device = peer ? peer.toUpperCase().replace(/^G06-(?:HQ|BR)-/, "") : owner;
      const map = maps[device] || {};
      const old = parse(port), next = old.map((p) => map[p] || p);
      if (old.every((p, i) => p === next[i])) return whole;
      return (peer ? peer + separator : "") + format(next, port);
    });
  }
  function ownPorts(text, owner) {
    const found = [];
    String(text).replace(tokens, (whole, peer, separator, port) => {
      if (!peer || peer.toUpperCase().replace(/^G06-(?:HQ|BR)-/, "") === owner) found.push(...parse(port));
      return whole;
    });
    return found;
  }
  // Update by original identity, with one replacement pass so edits cannot cascade.
  function update(maps, owner, original, replacement, reserved, wanAlias) {
    const from = parse(original), to = parse(replacement);
    if (from.length !== to.length) throw new Error("ต้องใส่จำนวนพอร์ตเท่าเดิม: " + from.length + " พอร์ต");
    const next = Object.assign({}, maps[owner]);
    from.forEach((p, i) => { if (p === to[i]) delete next[p]; else next[p] = to[i]; });
    const destinations = new Map();
    for (const port of new Set(reserved)) {
      const dest = next[port] || port;
      // Only skip a placeholder when the cable table names its physical WAN port.
      if (port === "<WAN_PORT>" && wanAlias && wanAlias !== "<WAN_PORT>") continue;
      if (destinations.has(dest)) throw new Error("พอร์ต " + format([dest], "Gi") + " ใช้อยู่แล้ว กรุณาเลือกพอร์ตที่ไม่ซ้ำ");
      destinations.set(dest, port);
    }
    return Object.assign({}, maps, { [owner]: next });
  }
  root.G06InterfaceMap = { parse, format, remap, ownPorts, update };
})(typeof window !== "undefined" ? window : globalThis);
