# G06 Config Map

เว็บ HTML/CSS/JavaScript สำหรับดู topology, สายและ Console, ผลที่ต้องเห็น และคัดลอกคอนฟิกทีละ BLOCK มีสองชุด:

- **C9300 · HSRP**: สคริปต์และผัง Rack 7 ตุลาคม 2026
- **C9200L · VRRP**: สคริปต์และผัง Rack 8 ตุลาคม 2026

สถานะบนเว็บมาจากหมายเหตุในสคริปต์ ไม่ได้อ่านสถานะเครื่องจริงแบบสด คำว่า “ผ่านบน Rack” อ้างถึงการทดสอบของชุดนั้น ส่วน WAN, GRE, NAT และค่าที่ต้องกรอกยังต้องตรวจตาม BLOCK

ชื่อบนภาพ หัวข้อเครื่อง และคำสั่ง `hostname` ที่ Copy ใช้ตามใบงาน: `G06-HQ-CE01`, `G06-HQ-CE02`, `G06-HQ-MLS01`, `G06-HQ-MLS02`, `G06-BR-R01`, `G06-BR-SW01` หน้ารายละเอียดยังแสดงชื่อย่อไว้ และ URL เดิม เช่น `#vrrp/CE01` ยังใช้ได้

`build.py` แปลงเฉพาะคำสั่ง `hostname` ในข้อมูลเว็บให้อัตโนมัติเมื่อสร้างใหม่ ไฟล์ TXT ต้นฉบับคงเดิม การปรับเว็บไม่ได้เปลี่ยนหรือยืนยัน Hostname ของอุปกรณ์ Rack

## เปิดในเครื่อง

เปิด Terminal ที่โฟลเดอร์ `Lab-Exam` แล้วรัน:

```sh
python3 -m http.server 4180 --bind 127.0.0.1 --directory g06-config-site
```

เปิด [ภาพรวม](http://localhost:4180/), [HSRP / MLS01](http://localhost:4180/#hsrp/MLS01) หรือ [VRRP / MLS01](http://localhost:4180/#vrrp/MLS01)

หยุด server ด้วย `Ctrl-C` หรือใช้รายการ `g06-config-site` ใน `.claude/launch.json` ที่มีอยู่แล้ว

## อัปเดตข้อมูลหลังแก้สคริปต์

ไฟล์ต้นฉบับ:

| ชุด | แหล่งคำสั่ง |
| --- | --- |
| HSRP | `G06_Device_Scripts/{CE01,CE02,MLS01,MLS02,R01,SW01}.txt` |
| VRRP | `G06_Device_Scripts/C9200L-VRRP/{CE01,CE02,MLS01,MLS02,R01,SW01}.txt` |

รันจาก `Lab-Exam`:

```sh
python3 g06-config-site/build.py
```

หรือรันจากโฟลเดอร์เว็บ:

```sh
cd g06-config-site
python3 build.py
```

จากนั้น:

1. ตรวจว่ารายงานมีครบ 6 เครื่องของทั้ง `hsrp` และ `vrrp`
2. เปลี่ยนค่า `?v=` ทุกจุดใน `index.html` เป็นเลขเวอร์ชันใหม่เดียวกัน เช่น `?v=20261008223000` รวม CSS และ JavaScript ทุกไฟล์ เพื่อให้ browser โหลดไฟล์ใหม่
3. ถ้าเปลี่ยนสาย, พอร์ต, Console หรือผลที่ต้องเห็น ให้แก้ `data/devices.js` ด้วย เพราะไฟล์นี้เขียนมือ
4. เปิดเว็บ ตรวจทั้งสองชุด และกด Copy เพื่อตรวจคำสั่งก่อนนำไปวาง
5. ก่อน deploy ให้ส่ง `data/configs.js` ที่สร้างใหม่และ `index.html` ที่เปลี่ยนเวอร์ชันไปด้วย

`data/configs.js` เป็นไฟล์สร้างอัตโนมัติ ให้แก้คำสั่งที่ TXT แล้วสร้างใหม่ ส่วนขั้นตอนนี้เป็นการเตรียมข้อมูลในเครื่อง เว็บที่ deploy ใช้ไฟล์ที่สร้างเสร็จแล้ว

สคริปต์ไม่มีบรรทัด SSH key ของผู้ช่วยแล้ว (ทีมไม่ได้ใช้) ถ้ามี `key-hash` หลุดเข้ามา ตัวสร้างจะแทนด้วย `<SSH_PUBLIC_KEY_HASH>` และจะหยุดถ้าพบบรรทัดรหัส `secret` ที่ไม่มี placeholder

## ใช้ปุ่ม Copy

- เปิดผ่าน `localhost` หรือ HTTPS และคลิกปุ่ม Copy โดยตรง
- ข้อความเปลี่ยนเป็น `Copied ✓` เมื่อคัดลอกสำเร็จ
- ข้อความที่คัดลอกเป็นคำสั่งของ BLOCK นั้น รวมย่อหน้าใหม่และช่องว่างนำหน้าคำสั่งย่อย
- ค่าที่อยู่ใน `<...>` ต้องเติมก่อนวาง เช่น รหัส, `<WAN_PORT>` และ `<DB_PORT>`
- คำสั่งแต่ละ BLOCK ต้องวางตามลำดับแล้วรอ prompt ตรวจผลให้ครบ การทดสอบ Copy ในเว็บไม่ใช่การทดสอบคำสั่งบนอุปกรณ์
- เว็บเริ่มเป็น Light แม้ระบบใช้ Dark; กดปุ่ม Dark/Light ด้านบนเพื่อสลับ เว็บจำโหมดที่เลือกไว้เมื่อเปิดครั้งถัดไป

## Deploy บน Vercel

**เว็บนี้เป็นเว็บสาธารณะ ใครมีลิงก์ก็เห็นคอนฟิก IP และแผนเครือข่ายได้** คำสั่งรหัสต้องเป็น placeholder และไม่ใส่รหัสจริง, hash ของรหัส หรือ key ของเครื่องลงไฟล์ที่เผยแพร่ ผู้ใช้ต้องเป็นผู้ deploy เองหรืออนุญาตก่อนเผยแพร่

Repository: [poomiput/network-lab](https://github.com/poomiput/network-lab) — ไฟล์เว็บอยู่ที่ราก repo (โฟลเดอร์ `g06-config-site` ในเครื่องคือ repo นี้)

1. สร้าง `data/configs.js` ในเครื่องและอัปเดต `?v=` ก่อน แล้ว commit + push
2. บน Vercel เลือก **Add New → Project** แล้ว import `poomiput/network-lab`
3. ตั้งค่าตามนี้:

| ตั้งค่า | ค่า |
| --- | --- |
| Root Directory | `.` (ค่าเริ่มต้น) |
| Framework Preset | `Other` |
| Build Command | เปิด Override แล้วเว้นว่าง |
| Output Directory | `.` หรือค่าเริ่มต้นสำหรับ Other ที่ไม่มีโฟลเดอร์ `public` |
| Install Command | เว้นว่าง; เว็บไม่มี package dependencies |

4. ตรวจไฟล์ที่จะเผยแพร่และกด **Deploy** เมื่อพร้อมให้ข้อมูลเป็นสาธารณะ
5. เปิด URL ที่ได้แล้วทดสอบการสลับชุด, deep link `/#hsrp/CE01` และ `/#vrrp/MLS01`, กับปุ่ม Copy อีกครั้งบน HTTPS

หลัง import แล้ว ทุกครั้งที่ push เข้า branch `main` Vercel จะ deploy ใหม่เอง

ไม่ต้องรัน `build.py` บน Vercel: ใช้ `data/configs.js` ที่สร้างและ commit มาก่อน เพราะไฟล์ต้นฉบับ `../G06_Device_Scripts` อยู่นอก repo การตั้ง Other และเว้น Build Command ว่างเป็นวิธีที่ Vercel รองรับสำหรับเว็บ HTML/CSS/JS ตาม [เอกสารการตั้ง Build และ Root Directory](https://vercel.com/docs/builds/configure-a-build)

## โครงสร้าง

```text
g06-config-site/
├── index.html       # หน้าหลักและเวอร์ชัน cache
├── style.css        # หน้าจอ desktop/mobile และ dark/light
├── app.js           # SVG, แสดงเครื่อง, URL hash และ Copy
├── build.py         # สร้างข้อมูลจาก TXT ในเครื่อง
└── data/
    ├── devices.js   # สาย, Console, รุ่น และผลที่ต้องเห็น
    └── configs.js   # สร้างอัตโนมัติ
```

เว็บนี้ใช้โฟลเดอร์ `g06-config-site` แยกจากเว็บเดิม
