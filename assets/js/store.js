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

// ปรับสต๊อก (delta บวก=เพิ่ม, ลบ=ลด) แบบ transaction กันชนกัน
export async function adjustStock(model, size, color, delta) {
  const id = invKey(model, size, color);
  const ref = doc(db, "inventory", id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? Number(snap.data().stock || 0) : 0;
    const next = cur + Number(delta);
    if (snap.exists()) {
      tx.update(ref, { stock: next, updatedAt: serverTimestamp() });
    } else {
      tx.set(ref, { model, size, color, stock: next, maxStock: 0, updatedAt: serverTimestamp() });
    }
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

// จัดส่งออเดอร์ -> ตัดสต๊อกตามรายการ + เปลี่ยนสถานะ
export async function deliverOrder(order) {
  for (const it of order.items) {
    await adjustStock(it.model, it.size, it.color, -Number(it.qty));
  }
  await updateOrder(order.id, { status: "delivered", deliveredAt: serverTimestamp() });
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

// ผลิตเสร็จ -> เพิ่มสต๊อกตามรายการ + เปลี่ยนสถานะ
export async function completeProduction(prod) {
  for (const it of prod.items) {
    await adjustStock(it.model, it.size, it.color, +Number(it.qty));
  }
  await updateProduction(prod.id, { status: "done", doneAt: serverTimestamp() });
}

export function watchProduction(cb) {
  const q = query(collection(db, "production"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  });
}
