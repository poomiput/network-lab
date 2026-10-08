// Hand-written: roles, cabling and expected results per script set.
// "hsrp" = C9300L rack (7 Oct) · "vrrp" = C9200L rack (8 Oct, panel T = top row, B = bottom row)
window.G06_SETS = {
  hsrp: {
    label: "C9300 · HSRP",
    rack: "Rack 7 ต.ค. — สวิตช์ C9300L, แผงแถวเดียว (P = ช่องแผง)",
    fhrp: "HSRPv2",
    poPorts: "Gi1/0/21–22 (สายตรงที่ตัวสวิตช์)",
  },
  vrrp: {
    label: "C9200L · VRRP",
    rack: "Rack 8 ต.ค. — สวิตช์ C9200L, แผง 2 แถว (T = แถวบน, B = แถวล่าง)",
    fhrp: "VRRPv3",
    poPorts: "Gi1/0/3–4 (แผง T17↔B5, T18↔B6)",
  },
};

window.G06_DEVICES = {
  CE01: {
    role: "HQ Router หลัก (ทางออก ISP หลัก G01)", model: "C8200L-1N-4T", loopback: "10.6.255.1 / Lo1 198.51.100.1",
    console: { hsrp: "P1", vrrp: "T1" },
    cables: {
      hsrp: [
        ["Gi0/0/0", "P02", "MLS01 Gi1/0/1", "P12", "10.6.240.1/30"],
        ["Gi0/0/1", "P03", "MLS02 Gi1/0/1", "P16", "10.6.240.5/30"],
        ["<WAN_PORT>", "—", "G01 ISP", "—", "172.31.1.26/30"],
      ],
      vrrp: [
        ["Gi0/0/0", "T02", "MLS01 Gi1/0/1", "T15", "10.6.240.1/30"],
        ["Gi0/0/1", "T03", "MLS02 Gi1/0/1", "B03", "10.6.240.5/30"],
        ["<WAN_PORT>", "—", "G01 ISP", "—", "172.31.1.26/30 (ต้องใช้ SFP Gi0/0/2 หรือ Serial)"],
      ],
    },
    expect: [
      ["show ip ospf neighbor", "10.6.255.11 และ 10.6.255.12 เป็น FULL"],
      ["show ip bgp summary", "10.6.255.2 (CE02) มีตัวเลข = Established"],
      ["ping 10.6.255.11 source Loopback0", "5/5 (!!!!!)"],
    ],
  },
  CE02: {
    role: "HQ Router สำรอง (ทางออก ISP สำรอง G02)", model: "C8200L-1N-4T", loopback: "10.6.255.2 / Lo1 198.51.100.2",
    console: { hsrp: "P4", vrrp: "T4" },
    cables: {
      hsrp: [
        ["Gi0/0/0", "P05", "MLS01 Gi1/0/2", "P13", "10.6.240.9/30"],
        ["Gi0/0/1", "P06", "MLS02 Gi1/0/2", "P17", "10.6.240.13/30"],
        ["<WAN_PORT>", "—", "G02 ISP", "—", "172.31.2.26/30"],
      ],
      vrrp: [
        ["Gi0/0/0", "T05", "MLS01 Gi1/0/2", "T16", "10.6.240.9/30"],
        ["Gi0/0/1", "T06", "MLS02 Gi1/0/2", "B04", "10.6.240.13/30"],
        ["<WAN_PORT>", "—", "G02 ISP", "—", "172.31.2.26/30 (ต้องใช้ SFP Gi0/0/2 หรือ Serial)"],
      ],
    },
    expect: [
      ["show ip ospf neighbor", "10.6.255.11 และ 10.6.255.12 เป็น FULL"],
      ["show ip bgp summary", "10.6.255.1 (CE01) มีตัวเลข = Established"],
      ["ping 10.6.255.12 source Loopback0", "5/5"],
    ],
  },
  MLS01: {
    role: "HQ Core Switch หลัก — Gateway ตัวหลัก (pri 110) + DHCP", model: { hsrp: "C9300L-24T-4G", vrrp: "C9200L-24T-4G" }, loopback: "10.6.255.11",
    console: { hsrp: "P11", vrrp: "T14" },
    cables: {
      hsrp: [
        ["Gi1/0/1", "P12", "CE01 Gi0/0/0", "P02", "10.6.240.2/30"],
        ["Gi1/0/2", "P13", "CE02 Gi0/0/0", "P05", "10.6.240.10/30"],
        ["Gi1/0/21–22", "สายตรง", "MLS02 Gi1/0/21–22", "สายตรง", "Po1 LACP trunk VLAN10–60"],
        ["Gi1/0/5–10", "ที่ตัวสวิตช์", "PC (ช่อง 5=Teller … 10=DMZ)", "—", "access VLAN10–60"],
      ],
      vrrp: [
        ["Gi1/0/1", "T15", "CE01 Gi0/0/0", "T02", "10.6.240.2/30"],
        ["Gi1/0/2", "T16", "CE02 Gi0/0/0", "T05", "10.6.240.10/30"],
        ["Gi1/0/3–4", "T17–T18", "MLS02 Gi1/0/3–4", "B05–B06", "Po1 LACP trunk VLAN10–60"],
        ["Gi1/0/5–10", "T19–T24", "PC (LAN5=Teller … LAN10=DMZ)", "—", "access VLAN10–60"],
      ],
    },
    expect: [
      ["show ip ospf neighbor", "10.6.255.1 และ 10.6.255.2 เป็น FULL"],
      ["show etherchannel summary", "Po1(SU) สมาชิกทั้งสองเป็น (P) — (s) = suspended ให้ตรวจสมาชิกและ config ทั้งสองฝั่ง"],
      { hsrp: ["show standby brief", "ทุก VLAN = Active local; Standby VLAN10–50 = 10.6.x.3, VLAN60 = 198.51.100.10"], vrrp: ["show vrrp brief", "ทุก VLAN = MASTER (local)"] },
      ["show ip dhcp binding", "PC Teller/ATM ได้ 10.6.0.100+ / 10.6.2.100+"],
    ],
  },
  MLS02: {
    role: "HQ Core Switch สำรอง — Gateway ตัวสำรอง (pri 100)", model: { hsrp: "C9300L-24T-4G", vrrp: "C9200L-24T-4G" }, loopback: "10.6.255.12",
    console: { hsrp: "P15", vrrp: "B2 (rack 8: สาย Console/MGMT หลังเครื่องเคยสลับ — Console = รูบน)" },
    cables: {
      hsrp: [
        ["Gi1/0/1", "P16", "CE01 Gi0/0/1", "P03", "10.6.240.6/30"],
        ["Gi1/0/2", "P17", "CE02 Gi0/0/1", "P06", "10.6.240.14/30"],
        ["Gi1/0/21–22", "สายตรง", "MLS01 Gi1/0/21–22", "สายตรง", "Po1 LACP trunk VLAN10–60"],
        ["Gi1/0/5–10", "ที่ตัวสวิตช์", "PC", "—", "access VLAN10–60"],
      ],
      vrrp: [
        ["Gi1/0/1", "B03", "CE01 Gi0/0/1", "T03", "10.6.240.6/30"],
        ["Gi1/0/2", "B04", "CE02 Gi0/0/1", "T06", "10.6.240.14/30"],
        ["Gi1/0/3–4", "B05–B06", "MLS01 Gi1/0/3–4", "T17–T18", "Po1 LACP trunk VLAN10–60"],
        ["Gi1/0/5–10", "B07–B12", "PC (LAN5=Teller … LAN10=DMZ)", "—", "access VLAN10–60"],
      ],
    },
    expect: [
      ["show ip ospf neighbor", "10.6.255.1 และ 10.6.255.2 เป็น FULL"],
      ["show etherchannel summary", "Po1(SU) สมาชิกทั้งสองเป็น (P)"],
      { hsrp: ["show standby brief", "ทุก VLAN = Standby; Active VLAN10–50 = 10.6.x.2, VLAN60 = 198.51.100.9"], vrrp: ["show vrrp brief", "ทุก VLAN = BACKUP; Master VLAN10–50 = 10.6.x.2, VLAN60 = 198.51.100.9"] },
      ["ping 10.6.0.1", "VIP ตอบ (ครั้งแรกอาจ .!!!! เพราะรอ ARP)"],
    ],
  },
  R01: {
    role: "Branch Router (ทางออก ISP G01 สาขา)", model: "C8200L-1N-4T", loopback: "Lo1 198.51.100.161",
    console: { hsrp: "P7", vrrp: "T7" },
    cables: {
      hsrp: [
        ["Gi0/0/0", "P08", "SW01 Gi1/0/1", "P20", "10.6.16.1/20 (Gateway สาขา)"],
        ["Gi0/0/1", "P09", "G01 ISP", "—", "WAN 172.31.11.26/30"],
      ],
      vrrp: [
        ["Gi0/0/0", "T08", "SW01 Gi1/0/1", "B15", "10.6.16.1/20 (Gateway สาขา)"],
        ["Gi0/0/1", "T09", "G01 ISP", "—", "WAN 172.31.11.26/30"],
      ],
    },
    expect: [
      ["show ip interface brief", "Gi0/0/0 = 10.6.16.1 up/up"],
      ["show cdp neighbors", "เห็น SW01 ที่ Gi0/0/0"],
      ["ping 10.6.16.2", "SW01 ตอบ 5/5"],
    ],
  },
  SW01: {
    role: "Branch Switch (VLAN110)", model: "C9200L-24T-4G", loopback: "Vlan110 10.6.16.2 (MGMT)",
    console: { hsrp: "P19", vrrp: "B14" },
    cables: {
      hsrp: [
        ["Gi1/0/1", "P20", "R01 Gi0/0/0", "P08", "VLAN110 uplink"],
        ["Gi1/0/5–10", "ที่ตัวสวิตช์", "PC สาขา", "—", "access VLAN110"],
      ],
      vrrp: [
        ["Gi1/0/1", "B15", "R01 Gi0/0/0", "T08", "VLAN110 uplink"],
        ["Gi1/0/5–10", "B19–B24", "PC สาขา", "—", "access VLAN110"],
      ],
    },
    expect: [
      ["show vtp status | include Mode", "Off"],
      ["show vlan brief", "VLAN110 BRANCH-LAN มี Gi1/0/1 และ 5–10"],
      ["ping 10.6.16.1", "R01 ตอบ 5/5"],
    ],
  },
};

window.G06_ZONES = [
  ["10", "TELLER", "10.6.0.0/24", "10.6.0.1", "DHCP .100+", "ช่อง/LAN 5"],
  ["20", "APPLICATION", "10.6.1.0/24", "10.6.1.1", "Server 10.6.1.10", "ช่อง/LAN 6"],
  ["30", "ATM", "10.6.2.0/24", "10.6.2.1", "DHCP .100+", "ช่อง/LAN 7"],
  ["40", "DATABASE", "10.6.3.0/24", "10.6.3.1", "DB 10.6.3.10", "ช่อง/LAN 8"],
  ["50", "MANAGEMENT", "10.6.4.0/24", "10.6.4.1", "Admin 10.6.4.10", "ช่อง/LAN 9"],
  ["60", "PUBLIC-DMZ", "198.51.100.8/29", "198.51.100.11", "Web 198.51.100.12:8080", "ช่อง/LAN 10"],
  ["110", "BRANCH-LAN (SW01)", "10.6.16.0/20", "10.6.16.1", "Client .20 / Server .10", "SW01 ช่อง 5–10"],
];
