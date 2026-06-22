// ===== Data Layer: Firestore CRUD + Realtime =====
import {
  db,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
} from "./firebase.js";

// ---------- Default catalog (จากแบบฟอร์มรายงานการผลิตรายวัน) ----------
export const DEFAULT_CATALOG = {
  models: {
    SAFE: [100, 200, 330, 500, 600, 750, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000],
    "โคราช": [1000, 1500, 2000],
    Super: [500, 1000, 1500],
    Green: [1500, 2000],
    "อ้วนเตี้ย": [1000],
  },
  colors: ["น้ำเงิน", "ทราย", "เทา", "เขียว", "แดง", "ขาว", "เทาเรียบ", "ครีมเรียบ"],
};

// Map สี -> รหัสสีจริง (สำหรับ swatch ใน UI)
export const COLOR_HEX = {
  "น้ำเงิน": "#1d4ed8",
  "ทราย": "#d6c08a",
  "เทา": "#9ca3af",
  "เขียว": "#16a34a",
  "แดง": "#dc2626",
  "ขาว": "#f8fafc",
  "เทาเรียบ": "#64748b",
  "ครีมเรียบ": "#f3e8c8",
};

export function invKey(model, size, color) {
  return [model, size, color].join("__").replace(/[\/.#$\[\]]/g, "_");
}

// ---------- Catalog ----------
const catalogRef = doc(db, "config", "catalog");

export async function ensureCatalog() {
  const snap = await getDoc(catalogRef);
  if (!snap.exists()) {
    await setDoc(catalogRef, DEFAULT_CATALOG);
    return DEFAULT_CATALOG;
  }
  return snap.data();
}

export async function saveCatalog(catalog) {
  await setDoc(catalogRef, catalog);
}

export function watchCatalog(cb) {
  return onSnapshot(catalogRef, (snap) => {
    if (snap.exists()) cb(snap.data());
  });
}

// ---------- Counter กลาง (จองเลขเอกสารแบบ atomic กันชนกันแม้หลายแผนกกดพร้อมกัน) ----------
// เก็บเลขรันนิ่งแยกตามชนิด+ปี พ.ศ. ใน config/counters เช่น { order_69: 12, prod_69: 5 }
const countersRef = doc(db, "config", "counters");

// floor = เลขสูงสุดของปีนี้ที่มีอยู่แล้ว (รวมที่กรอกมือ) เพื่อไม่ให้ counter จองเลขไปชน
export async function allocateDocNo(prefix, baseName, floor = 0) {
  const yy = String(new Date().getFullYear() + 543).slice(-2);
  const field = `${baseName}_${yy}`;
  let seq;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(countersRef);
    const cur = snap.exists() ? Number(snap.data()[field] || 0) : 0;
    seq = Math.max(cur, Number(floor) || 0) + 1;
    tx.set(countersRef, { [field]: seq }, { merge: true });
  });
  return `${prefix}${String(seq).padStart(3, "0")}/${yy}`;
}

// ---------- Inventory (สต๊อก ระดับ รุ่น+ขนาด+สี) ----------
export async function upsertInventory({ model, size, color, stock, maxStock }) {
  const id = invKey(model, size, color);
  const ref = doc(db, "inventory", id);
  const payload = { model, size, color, updatedAt: serverTimestamp() };
  if (stock !== undefined) payload.stock = Number(stock) || 0;
  if (maxStock !== undefined) payload.maxStock = Number(maxStock) || 0;
  await setDoc(ref, payload, { merge: true });
}

export async function deleteInventory(id) {
  await deleteDoc(doc(db, "inventory", id));
}

// รวมรายการที่เป็น SKU เดียวกัน (กันรายการซ้ำใน 1 ใบ ตัดสต๊อกพลาด)
function aggregateItems(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = invKey(it.model, it.size, it.color);
    const e = m.get(k) || { ref: k, model: it.model, size: it.size, color: it.color, qty: 0 };
    e.qty += Number(it.qty || 0);
    m.set(k, e);
  }
  return [...m.values()];
}

// ปรับสต๊อกหลายรายการ + อัปเดตสถานะเอกสาร ภายใน transaction เดียว (atomic)
// sign = -1 ตัดสต๊อก (จัดส่ง), +1 เพิ่มสต๊อก (ผลิต). ถ้า sign<0 จะตรวจของพอ ไม่งั้นยกเลิกทั้งใบ
async function commitStock(docRef, items, sign, statusPatch) {
  const lines = aggregateItems(items);
  await runTransaction(db, async (tx) => {
    // อ่านทั้งหมดก่อน (ข้อกำหนดของ Firestore transaction)
    const snaps = [];
    for (const l of lines) {
      const ref = doc(db, "inventory", l.ref);
      snaps.push({ l, ref, snap: await tx.get(ref) });
    }
    // ตรวจสต๊อกเมื่อเป็นการตัด (กันติดลบ) — ถ้าไม่พอ throw เพื่อยกเลิกทั้ง transaction
    if (sign < 0) {
      const short = [];
      for (const s of snaps) {
        const cur = s.snap.exists() ? Number(s.snap.data().stock || 0) : 0;
        if (cur < s.l.qty) short.push(`${s.l.model} ${s.l.size}ล. ${s.l.color} (มี ${cur} ต้องการ ${s.l.qty})`);
      }
      if (short.length) throw new Error("สต๊อกไม่พอ:\n" + short.join("\n"));
    }
    // เขียนทั้งหมด
    for (const s of snaps) {
      const cur = s.snap.exists() ? Number(s.snap.data().stock || 0) : 0;
      const next = cur + sign * s.l.qty;
      if (s.snap.exists()) tx.update(s.ref, { stock: next, updatedAt: serverTimestamp() });
      else tx.set(s.ref, { model: s.l.model, size: s.l.size, color: s.l.color, stock: next, maxStock: 0, updatedAt: serverTimestamp() });
    }
    tx.update(docRef, statusPatch);
  });
}

export function watchInventory(cb) {
  return onSnapshot(collection(db, "inventory"), (snap) => {
    const map = new Map();
    snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
    cb(map);
  });
}

// ---------- Orders (รับออเดอร์ทางโทรศัพท์) ----------
export async function addOrder(order) {
  return addDoc(collection(db, "orders"), {
    ...order,
    status: order.status || "pending", // pending | delivered
    createdAt: serverTimestamp(),
  });
}

export async function updateOrder(id, data) {
  await updateDoc(doc(db, "orders", id), data);
}

export async function deleteOrder(id) {
  await deleteDoc(doc(db, "orders", id));
}

// จัดส่งออเดอร์ -> ตัดสต๊อก + เปลี่ยนสถานะ แบบ atomic (ของไม่พอจะยกเลิกทั้งใบ)
export async function deliverOrder(order) {
  await commitStock(doc(db, "orders", order.id), order.items, -1, {
    status: "delivered", deliveredAt: serverTimestamp(),
  });
}

export function watchOrders(cb) {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  });
}

// ---------- Production (ใบสั่งผลิต) ----------
export async function addProduction(prod) {
  return addDoc(collection(db, "production"), {
    ...prod,
    status: prod.status || "pending", // pending | done
    createdAt: serverTimestamp(),
  });
}

export async function updateProduction(id, data) {
  await updateDoc(doc(db, "production", id), data);
}

export async function deleteProduction(id) {
  await deleteDoc(doc(db, "production", id));
}

// ผลิตเสร็จ -> เพิ่มสต๊อก + เปลี่ยนสถานะ แบบ atomic
export async function completeProduction(prod) {
  await commitStock(doc(db, "production", prod.id), prod.items, +1, {
    status: "done", doneAt: serverTimestamp(),
  });
}

export function watchProduction(cb) {
  const q = query(collection(db, "production"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  });
}
