# 💧 Benchapoom Tank — ระบบจัดการออเดอร์ & การผลิตถังน้ำ

เว็บแอป (HTML + JavaScript + CSS + Bootstrap) สำหรับโรงงานผลิตถังน้ำพลาสติก
ใช้ฟอร์มเดียวทำงานร่วมกัน 3-5 แผนก: **รับออเดอร์ → จัดส่ง → เช็คสต๊อก → สั่งผลิต**
เก็บข้อมูลแบบ Realtime ด้วย **Firebase Firestore**

## โครงสร้างไฟล์
```
index.html              หน้าเว็บหลัก (SPA + แท็บแยกแผนก)
assets/
  css/style.css         ดีไซน์ทั้งหมด (ธีมน้ำ โทนฟ้า-เทอร์ควอยซ์)
  js/firebase.js        ตั้งค่าเชื่อมต่อ Firebase
  js/store.js           Data layer: CRUD + realtime + ค่าตั้งต้น (รุ่น/ขนาด/สี)
  js/app.js             Logic + การ render ทุกแท็บ
```

## ฟีเจอร์ตามแผนก
| แท็บ | หน้าที่ |
|---|---|
| 📊 **Dashboard** | สรุปสต๊อกรวม, ออเดอร์รอส่ง, คิวส่งวันนี้, รายการที่ต้องผลิต |
| 📞 **รับออเดอร์** | บันทึกออเดอร์ลูกค้าโทรเข้า (เลขที่/วันที่/ลูกค้า/รายการ/กำหนดส่ง) |
| 🚚 **จัดส่ง** | ยืนยันส่ง → ตัดสต๊อกอัตโนมัติ + เช็คว่าของพอไหม |
| 📦 **สต๊อกคงเหลือ** | ตาราง รุ่น × ขนาด × สี — คลิกช่องเพื่อแก้สต๊อก/max ไฮไลต์สีแดงเมื่อต่ำ |
| 🏭 **สั่งผลิต** | เปิดใบสั่งผลิต / สร้างจากสต๊อกต่ำอัตโนมัติ → ผลิตเสร็จเพิ่มสต๊อก |
| ⚙️ **ตั้งค่า** | จัดการรุ่น/ขนาด/สี และกำหนด **max stock** ต่อรายการ |

## วิธี deploy ขึ้น GitHub Pages (https://kongkiatod-beep.github.io)
1. สร้าง repo ชื่อ **`kongkiatod-beep.github.io`** (เป็น user-site ต้องชื่อนี้พอดี)
2. นำไฟล์ทั้งหมดในโฟลเดอร์นี้ push ขึ้น branch `main`
   ```bash
   git init
   git add .
   git commit -m "Benchapoom Tank web app"
   git branch -M main
   git remote add origin https://github.com/kongkiatod-beep/kongkiatod-beep.github.io.git
   git push -u origin main
   ```
3. GitHub → repo → **Settings → Pages** → Source = `Deploy from a branch`, Branch = `main` / `root`
4. รอ 1-2 นาที เปิด https://kongkiatod-beep.github.io

> ทดสอบในเครื่องได้ด้วยไฟล์ `.claude/serve.ps1` (เปิด PowerShell แล้วรัน
> `powershell -ExecutionPolicy Bypass -File .claude/serve.ps1` → เปิด http://localhost:5500)
> ⚠️ ต้องเปิดผ่าน http server เท่านั้น เปิดไฟล์ตรงๆ (file://) จะไม่ทำงานเพราะใช้ ES Modules

## ⚠️ สำคัญ — Firestore Security Rules
ตอนนี้ฐานข้อมูลเปิดให้อ่าน/เขียนได้แบบสาธารณะ (test mode) ใครมี config ก็เข้าถึงได้
สำหรับใช้งานภายในควรจำกัดสิทธิ์ เช่น เพิ่มระบบ login แล้วตั้ง rule ใน Firebase Console → Firestore → Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;   // เปิดเฉพาะผู้ login
    }
  }
}
```

## โครงสร้างข้อมูล Firestore
- `config/catalog` — `{ models: {รุ่น: [ขนาด...]}, colors: [...] }`
- `inventory/{รุ่น__ขนาด__สี}` — `{ model, size, color, stock, maxStock }`
- `orders/{id}` — `{ orderNo, date, deliveryDate, customer, contact, items[], note, status }`
- `production/{id}` — `{ prodNo, date, lot, items[], note, status }`
