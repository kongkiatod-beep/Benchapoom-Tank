// ===== Main App =====
import {
  DEFAULT_CATALOG, COLOR_HEX, invKey,
  ensureCatalog, saveCatalog, watchCatalog, allocateDocNo,
  upsertInventory, deleteInventory, watchInventory,
  addOrder, updateOrder, deleteOrder, deliverOrder, watchOrders,
  addProduction, updateProduction, deleteProduction, completeProduction, watchProduction,
} from "./store.js";

/* ---------- State ---------- */
const state = {
  catalog: structuredClone(DEFAULT_CATALOG),
  inventory: new Map(),
  orders: [],
  production: [],
  orderFilter: "all",
  delFilter: "today",
  prodFilter: "all",
  ready: { catalog: false, inventory: false, orders: false, production: false },
};

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => ymd(new Date());                                  // วันที่ตามเวลาท้องถิ่น (ไม่ใช่ UTC)
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };
const beYY = () => String(new Date().getFullYear() + 543).slice(-2);
// เลขสูงสุดของปี พ.ศ. ปัจจุบันที่มีอยู่แล้ว (ใช้เป็น floor ให้ counter + เป็นตัวเลขพรีวิว)
const floorSeq = (prefix, list, field) => {
  const re = new RegExp(`^${prefix}0*(\\d+)/${beYY()}$`);
  let max = 0;
  for (const x of list) { const m = (x[field] || "").match(re); if (m) max = Math.max(max, Number(m[1])); }
  return max;
};
// เลขพรีวิว (ค่าที่คาดว่าจะได้) — ตอนบันทึกจริงจะจองจาก counter กลางแบบ atomic
const previewDocNo = (prefix, list, field) => `${prefix}${String(floorSeq(prefix, list, field) + 1).padStart(3, "0")}/${beYY()}`;
const thDate = (s) => { if (!s) return "-"; const d = new Date(s); return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" }); };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const swatch = (c) => `<span class="swatch" style="background:${COLOR_HEX[c] || "#ccc"}"></span>`;

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = `<span>${type === "ok" ? "✅" : type === "err" ? "⚠️" : "ℹ️"}</span> ${esc(msg)}`;
  $("#toastWrap").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 2800);
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml, footHtml) {
  $("#modalBox").innerHTML = `
    <div class="m-h"><h3>${title}</h3><span class="x" id="mClose">×</span></div>
    <div class="m-b">${bodyHtml}</div>
    ${footHtml ? `<div class="m-f">${footHtml}</div>` : ""}`;
  $("#modalBack").classList.add("show");
  $("#mClose").onclick = closeModal;
}
function closeModal() { $("#modalBack").classList.remove("show"); }
$("#modalBack").addEventListener("click", (e) => { if (e.target.id === "modalBack") closeModal(); });

/* ---------- Print documents (ใบสั่งผลิต / ใบส่งของ) ---------- */
const COMPANY = {
  name: "บริษัท เบญจภูมิ ทราฟฟิค จำกัด",
  nameEn: "BENCHAPOOM TRAFFIC CO., LTD.",
  addr: "30/8 หมู่ 4 ตำบลบางใหญ่ อำเภอบางใหญ่ จังหวัดนนทบุรี 11140",
  tel: "โทร. 0-2403-6565, 0-2403-6559, 097-263-9365",
  email: "benchapoomtraffic_ns@hotmail.com",
};
const TD = "border:1px solid #000;padding:6px 8px;";
function signBlock(a, b) {
  return `<div style="display:flex;justify-content:space-around;margin-top:54px;font-size:.85rem;text-align:center;">
    <div>.......................................<br>( ${a} )<br>วันที่ ......./......./.......</div>
    <div>.......................................<br>( ${b} )<br>วันที่ ......./......./.......</div></div>`;
}
function printDoc(inner) {
  $("#printArea").innerHTML = `
    <div style="font-family:'Noto Sans Thai',sans-serif;color:#000;">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px;">
        <div style="width:56px;height:56px;border:2px solid #1d4ed8;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#1d4ed8;font-size:1.3rem;">BP</div>
        <div style="line-height:1.35;">
          <div style="font-size:1.1rem;font-weight:800;">${COMPANY.name}</div>
          <div style="font-size:.85rem;font-weight:700;letter-spacing:.5px;">${COMPANY.nameEn}</div>
          <div style="font-size:.7rem;">${COMPANY.addr}</div>
          <div style="font-size:.7rem;">${COMPANY.tel} · ${COMPANY.email}</div>
        </div>
      </div>${inner}
    </div>`;
  window.print();
}
function printProduction(p) {
  const items = p.items || [];
  const body = items.map((it, i) => `<tr>
    <td style="${TD}text-align:center;">${i + 1}</td>
    <td style="${TD}">${esc(it.color)}</td>
    <td style="${TD}">${esc(it.model)}</td>
    <td style="${TD}text-align:center;">${fmt(it.size)} ล.</td>
    <td style="${TD}text-align:center;font-weight:700;">${fmt(it.qty)}</td>
    <td style="${TD}text-align:center;">${esc(p.lot || "")}</td>
    <td style="${TD}"></td></tr>`).join("");
  const pad = Math.max(0, 8 - items.length);
  const blanks = Array.from({ length: pad }).map(() => `<tr>${`<td style="${TD}height:28px;"></td>`.repeat(7)}</tr>`).join("");
  printDoc(`
    <h2 style="text-align:center;font-size:1.2rem;margin:0;">ใบสั่งผลิตสินค้า</h2>
    <div style="display:flex;justify-content:space-between;font-size:.88rem;margin:12px 0;">
      <div>เลขที่ <b>${esc(p.prodNo || "-")}</b></div><div>วันที่ <b>${thDate(p.date)}</b></div></div>
    <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
      <thead><tr style="background:#eee;">
        <th style="${TD}">ลำดับ</th><th style="${TD}">ชนิดสี</th><th style="${TD}">รุ่น</th>
        <th style="${TD}">ขนาดบรรจุ</th><th style="${TD}">จำนวนที่สั่งผลิต</th><th style="${TD}">LOT.</th><th style="${TD}">หมายเหตุ</th>
      </tr></thead><tbody>${body}${blanks}</tbody></table>
    ${p.note ? `<div style="margin-top:10px;font-size:.85rem;">หมายเหตุ: ${esc(p.note)}</div>` : ""}
    ${signBlock("ผู้สั่งผลิต", "ผู้รับใบสั่งผลิต")}`);
}
function printDelivery(o) {
  const items = o.items || [];
  const total = items.reduce((s, i) => s + Number(i.qty || 0), 0);
  const body = items.map((it, i) => `<tr>
    <td style="${TD}text-align:center;">${i + 1}</td>
    <td style="${TD}">${esc(it.model)} ${fmt(it.size)} ล. — สี${esc(it.color)}</td>
    <td style="${TD}text-align:center;font-weight:700;">${fmt(it.qty)} ใบ</td></tr>`).join("");
  const pad = Math.max(0, 8 - items.length);
  const blanks = Array.from({ length: pad }).map(() => `<tr>${`<td style="${TD}height:28px;"></td>`.repeat(3)}</tr>`).join("");
  printDoc(`
    <h2 style="text-align:center;font-size:1.2rem;margin:0;">ใบส่งของ / ใบจัดส่งสินค้า</h2>
    <div style="font-size:.88rem;margin:12px 0;line-height:1.9;">
      <div style="display:flex;justify-content:space-between;"><div>เลขที่ <b>${esc(o.orderNo || "-")}</b></div><div>วันที่ส่ง <b>${thDate(o.deliveryDate)}</b></div></div>
      <div>ลูกค้า <b>${esc(o.customer || "")}</b>${o.contact ? ` · ผู้ติดต่อ ${esc(o.contact)}` : ""}</div></div>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
      <thead><tr style="background:#eee;"><th style="${TD}width:60px;">ลำดับ</th><th style="${TD}">รายการสินค้า</th><th style="${TD}width:110px;">จำนวน</th></tr></thead>
      <tbody>${body}${blanks}<tr><td style="${TD}" colspan="2"><b>รวมทั้งสิ้น</b></td><td style="${TD}text-align:center;font-weight:700;">${fmt(total)} ใบ</td></tr></tbody></table>
    ${o.note ? `<div style="margin-top:10px;font-size:.85rem;">หมายเหตุ: ${esc(o.note)}</div>` : ""}
    ${signBlock("ผู้ส่งสินค้า", "ผู้รับสินค้า")}`);
}

/* ---------- Export Excel (SheetJS) ---------- */
function exportXlsx(sheets, filename) {
  if (!window.XLSX) return toast("โหลดไลบรารี Excel ไม่สำเร็จ — ลองรีเฟรชหน้า", "err");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  XLSX.writeFile(wb, filename);
  toast("ดาวน์โหลด " + filename + " แล้ว", "ok");
}
function exportOrders() {
  const rows = [["เลขที่", "วันที่สั่ง", "ลูกค้า", "ผู้ติดต่อ", "รุ่น", "ขนาด(ล.)", "สี", "จำนวน", "กำหนดส่ง", "สถานะ", "หมายเหตุ"]];
  for (const o of state.orders) {
    const st = o.status === "delivered" ? "จัดส่งแล้ว" : "รอจัดส่ง";
    const its = (o.items || []).length ? o.items : [{}];
    for (const it of its) rows.push([o.orderNo || "", o.date || "", o.customer || "", o.contact || "", it.model || "", it.size || "", it.color || "", it.qty || "", o.deliveryDate || "", st, o.note || ""]);
  }
  exportXlsx([{ name: "ออเดอร์", rows }], `orders_${todayStr()}.xlsx`);
}
function exportProduction() {
  const rows = [["เลขที่", "วันที่", "LOT", "รุ่น", "ขนาด(ล.)", "สี", "จำนวนที่สั่งผลิต", "สถานะ", "หมายเหตุ"]];
  for (const p of state.production) {
    const st = p.status === "done" ? "ผลิตเสร็จ" : "กำลังผลิต";
    const its = (p.items || []).length ? p.items : [{}];
    for (const it of its) rows.push([p.prodNo || "", p.date || "", p.lot || "", it.model || "", it.size || "", it.color || "", it.qty || "", st, p.note || ""]);
  }
  exportXlsx([{ name: "ใบสั่งผลิต", rows }], `production_${todayStr()}.xlsx`);
}
function exportStock() {
  const rows = [["รุ่น", "ขนาด(ล.)", "สี", "สต๊อกคงเหลือ", "max stock", "สถานะ"]];
  const items = [...state.inventory.values()].sort((a, b) => String(a.model).localeCompare(b.model) || a.size - b.size);
  for (const i of items) {
    const max = Number(i.maxStock || 0), s = Number(i.stock || 0);
    let st = "ปกติ"; if (max > 0) { const r = s / max; st = r <= 0.25 ? "ต่ำ-ต้องผลิต" : r <= 0.5 ? "ใกล้หมด" : "ปกติ"; }
    rows.push([i.model, i.size, i.color, s, max, st]);
  }
  if (items.length === 0) rows.push(["(ยังไม่มีข้อมูลสต๊อก)", "", "", "", "", ""]);
  exportXlsx([{ name: "สต๊อกคงเหลือ", rows }], `stock_${todayStr()}.xlsx`);
}

/* ---------- Navigation ---------- */
const PAGE_META = {
  dashboard: ["Dashboard", "ภาพรวมออเดอร์ สต๊อก และการผลิตวันนี้"],
  orders: ["รับออเดอร์", "บันทึกออเดอร์ที่ลูกค้าโทรเข้ามา"],
  delivery: ["จัดส่ง", "ยืนยันการจัดส่ง — ระบบตัดสต๊อกอัตโนมัติ"],
  stock: ["สต๊อกคงเหลือ", "ตารางสต๊อกตามรุ่น × ขนาด × สี"],
  production: ["สั่งผลิต", "เปิดใบสั่งผลิตเพิ่มสต๊อก ไม่เกินขีดบน"],
  catalog: ["ตั้งค่า", "จัดการรุ่น ขนาด สี และ max stock"],
};
function nav(page) {
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  const [t, s] = PAGE_META[page];
  $("#pageTitle").textContent = t;
  $("#pageSub").textContent = s;
  $("#sidebar").classList.remove("open");
  $("#backdrop").classList.remove("show");
  renderActive(); // วาดเฉพาะหน้าที่เพิ่งเปิด
}
$("#nav").addEventListener("click", (e) => { const it = e.target.closest(".nav-item"); if (it) nav(it.dataset.page); });
$("#menuBtn").onclick = () => { $("#sidebar").classList.toggle("open"); $("#backdrop").classList.toggle("show"); };
$("#backdrop").onclick = () => { $("#sidebar").classList.remove("open"); $("#backdrop").classList.remove("show"); };

/* ---------- Derived data ---------- */
// ความต้องการค้างส่งต่อ SKU (pending orders)
function pendingDemand() {
  const m = new Map();
  for (const o of state.orders) {
    if (o.status !== "pending") continue;
    for (const it of o.items || []) {
      const k = invKey(it.model, it.size, it.color);
      m.set(k, (m.get(k) || 0) + Number(it.qty || 0));
    }
  }
  return m;
}
// รายการสต๊อกต่ำ: available = stock - pending ; ขาด = max - available
function lowStockItems() {
  const demand = pendingDemand();
  const rows = [];
  for (const [k, inv] of state.inventory) {
    const max = Number(inv.maxStock || 0);
    if (max <= 0) continue;
    const pend = demand.get(k) || 0;
    const avail = Number(inv.stock || 0) - pend;
    const need = max - avail;
    if (need > 0) rows.push({ ...inv, key: k, pend, avail, need, ratio: avail / max });
  }
  return rows.sort((a, b) => a.ratio - b.ratio);
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const today = todayStr();
  const pendingOrders = state.orders.filter((o) => o.status === "pending");
  const todayDel = pendingOrders.filter((o) => o.deliveryDate === today);
  const activeProd = state.production.filter((p) => p.status === "pending");
  const low = lowStockItems();
  const totalStock = [...state.inventory.values()].reduce((s, i) => s + Number(i.stock || 0), 0);

  $("#kpis").innerHTML = `
    ${kpi("b1", "💧", fmt(totalStock), "สต๊อกรวม (ใบ)")}
    ${kpi("b2", "📞", fmt(pendingOrders.length), "ออเดอร์รอจัดส่ง")}
    ${kpi("b3", "🚚", fmt(todayDel.length), "คิวจัดส่งวันนี้")}
    ${kpi("b4", "⚠️", fmt(low.length), "รายการต้องผลิต")}`;

  // low stock
  $("#lowStockList").innerHTML = low.length ? `
    <table class="tbl"><thead><tr><th>สินค้า</th><th>สี</th><th class="num">คงเหลือ</th><th class="num">ค้างส่ง</th><th class="num">max</th><th class="num">ต้องผลิต</th></tr></thead><tbody>
    ${low.slice(0, 12).map((r) => `<tr>
      <td><b>${esc(r.model)}</b> ${fmt(r.size)} ล.</td>
      <td>${swatch(r.color)}${esc(r.color)}</td>
      <td class="num">${fmt(r.stock)}</td>
      <td class="num">${r.pend ? fmt(r.pend) : "-"}</td>
      <td class="num">${fmt(r.maxStock)}</td>
      <td class="num"><span class="pill low">+${fmt(r.need)}</span></td>
    </tr>`).join("")}</tbody></table>` : empty("✅", "สต๊อกเพียงพอทุกรายการ");

  // today deliveries
  $("#todayDeliveries").innerHTML = todayDel.length ? `
    <table class="tbl"><thead><tr><th>ลูกค้า</th><th class="num">รายการ</th></tr></thead><tbody>
    ${todayDel.map((o) => `<tr><td><b>${esc(o.customer)}</b><br><span class="muted" style="font-size:.78rem">${esc(o.orderNo || "")}</span></td>
      <td class="num">${(o.items || []).reduce((s, i) => s + Number(i.qty || 0), 0)} ใบ</td></tr>`).join("")}
    </tbody></table>` : empty("📭", "ไม่มีคิวส่งวันนี้");

  // recent activity
  const acts = [];
  state.orders.slice(0, 6).forEach((o) => acts.push({ t: o.createdAt, icon: "📞", txt: `รับออเดอร์ <b>${esc(o.customer)}</b>`, tag: o.status }));
  state.production.slice(0, 6).forEach((p) => acts.push({ t: p.createdAt, icon: "🏭", txt: `ใบสั่งผลิต <b>${esc(p.prodNo || p.lot || "")}</b>`, tag: p.status }));
  // pending serverTimestamp ยัง null ชั่วครู่ -> ถือว่าใหม่สุด (Infinity) ให้เด้งขึ้นบน
  acts.sort((a, b) => (b.t?.seconds ?? Infinity) - (a.t?.seconds ?? Infinity));
  $("#recentActivity").innerHTML = acts.length ? `
    <table class="tbl"><tbody>${acts.slice(0, 8).map((a) => `<tr>
      <td style="width:40px">${a.icon}</td><td>${a.txt}</td>
      <td style="text-align:right">${statusPill(a.tag)}</td></tr>`).join("")}</tbody></table>` : empty("🕒", "ยังไม่มีความเคลื่อนไหว");

  renderMonthlyChart();
}

// สถิติรายเดือน 6 เดือนล่าสุด: ยอดผลิต (ใบสั่งผลิตที่เสร็จแล้ว) vs ยอดจัดส่ง (ออเดอร์ที่ส่งแล้ว)
function monthlyStats() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("th-TH", { month: "short" }) + " " + String(d.getFullYear() + 543).slice(-2),
    });
  }
  const prod = {}, ship = {};
  const sumQty = (items) => (items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
  for (const p of state.production) if (p.status === "done") { const k = (p.date || "").slice(0, 7); prod[k] = (prod[k] || 0) + sumQty(p.items); }
  for (const o of state.orders) if (o.status === "delivered") { const k = (o.deliveryDate || "").slice(0, 7); ship[k] = (ship[k] || 0) + sumQty(o.items); }
  return { labels: months.map((m) => m.label), prod: months.map((m) => prod[m.key] || 0), ship: months.map((m) => ship[m.key] || 0) };
}

let _monthlyChart = null;
function renderMonthlyChart() {
  const cv = $("#monthlyChart");
  if (!cv || !window.Chart) return; // ไลบรารียังโหลดไม่เสร็จ -> รอ render รอบถัดไป
  const s = monthlyStats();
  if (_monthlyChart) _monthlyChart.destroy();
  _monthlyChart = new Chart(cv, {
    type: "bar",
    data: {
      labels: s.labels,
      datasets: [
        { label: "ยอดผลิต", data: s.prod, backgroundColor: "#0ea5e9", borderRadius: 6, maxBarThickness: 38 },
        { label: "ยอดจัดส่ง", data: s.ship, backgroundColor: "#16a34a", borderRadius: 6, maxBarThickness: 38 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8, font: { family: "Noto Sans Thai" } } } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } },
        x: { grid: { display: false } },
      },
    },
  });
}

// อัปเดต badge ข้างเมนู (เรียกทุก snapshot โดยไม่ต้อง render หน้า Dashboard ทั้งหน้า)
function updateBadges() {
  const today = todayStr();
  setBadge("#nav-orders", state.orders.filter((o) => o.status === "pending").length);
  setBadge("#nav-delivery", state.orders.filter((o) => o.status === "pending" && o.deliveryDate <= today).length);
  setBadge("#nav-production", state.production.filter((p) => p.status === "pending").length);
}
const kpi = (cls, ico, val, lbl) => `<div class="kpi ${cls}"><div class="ico">${ico}</div><div class="val">${val}</div><div class="lbl">${lbl}</div></div>`;
const empty = (i, t) => `<div class="empty-state"><div class="e-ico">${i}</div>${t}</div>`;
function statusPill(s) {
  if (s === "pending") return `<span class="pill pending">รอดำเนินการ</span>`;
  if (s === "delivered") return `<span class="pill delivered">จัดส่งแล้ว</span>`;
  if (s === "done") return `<span class="pill done">ผลิตเสร็จ</span>`;
  return "";
}
function setBadge(sel, n) {
  const el = $(sel); if (!el) return;
  el.innerHTML = n > 0 ? `<span class="pill low" style="font-size:.66rem;padding:1px 7px">${n}</span>` : "";
}

/* ---------- Item line builder (ใช้ทั้ง order & production) ---------- */
function itemLinesHtml(rows = [{}]) {
  return `<div id="itemLines">${rows.map((r) => itemLineRow(r)).join("")}</div>
    <button type="button" class="btn btn-light btn-sm" id="addLine">➕ เพิ่มรายการ</button>`;
}
function itemLineRow(r = {}) {
  const models = Object.keys(state.catalog.models);
  return `<div class="item-line">
    <div class="field"><label>รุ่น</label><select class="il-model">
      <option value="">เลือก</option>${models.map((m) => `<option ${r.model === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
    <div class="field"><label>ขนาด (ล.)</label><select class="il-size">${sizeOptions(r.model, r.size)}</select></div>
    <div class="field"><label>สี</label><select class="il-color">
      <option value="">เลือก</option>${state.catalog.colors.map((c) => `<option ${r.color === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label>จำนวน</label><input type="number" class="il-qty" min="1" value="${r.qty || ""}" placeholder="0"></div>
    <button type="button" class="btn btn-ghost il-del" title="ลบ">🗑️</button>
  </div>`;
}
function sizeOptions(model, sel) {
  const sizes = state.catalog.models[model] || [];
  return `<option value="">-</option>` + sizes.map((s) => `<option ${String(sel) === String(s) ? "selected" : ""}>${s}</option>`).join("");
}
function wireItemLines(container) {
  container.addEventListener("click", (e) => {
    if (e.target.id === "addLine") { $("#itemLines", container).insertAdjacentHTML("beforeend", itemLineRow()); }
    if (e.target.classList.contains("il-del")) {
      const lines = $$(".item-line", container);
      if (lines.length > 1) e.target.closest(".item-line").remove();
    }
  });
  container.addEventListener("change", (e) => {
    if (e.target.classList.contains("il-model")) {
      const row = e.target.closest(".item-line");
      $(".il-size", row).innerHTML = sizeOptions(e.target.value, "");
    }
  });
}
function collectItems(container) {
  const items = [];
  for (const row of $$(".item-line", container)) {
    const model = $(".il-model", row).value;
    const size = $(".il-size", row).value;
    const color = $(".il-color", row).value;
    const qty = Number($(".il-qty", row).value);
    if (model && size && color && qty > 0) items.push({ model, size: Number(size), color, qty });
  }
  return items;
}

/* ---------- Orders ---------- */
function renderOrders() {
  const list = state.orderFilter === "all" ? state.orders : state.orders.filter((o) => o.status === state.orderFilter);
  $("#orderCount").textContent = `${list.length} รายการ`;
  $("#ordersTable").innerHTML = list.length ? `
    <table class="tbl"><thead><tr>
      <th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>รายการสั่งซื้อ</th><th class="num">รวม</th><th>กำหนดส่ง</th><th>สถานะ</th><th></th>
    </tr></thead><tbody>
    ${list.map((o) => `<tr>
      <td><b>${esc(o.orderNo || "-")}</b></td>
      <td>${thDate(o.date)}</td>
      <td><b>${esc(o.customer)}</b>${o.contact ? `<br><span class="muted" style="font-size:.76rem">${esc(o.contact)}</span>` : ""}</td>
      <td style="white-space:normal;max-width:280px">${(o.items || []).map((i) => `${swatch(i.color)}${esc(i.model)} ${fmt(i.size)}ล. <b>${fmt(i.qty)}</b>`).join("<br>")}</td>
      <td class="num">${fmt((o.items || []).reduce((s, i) => s + Number(i.qty || 0), 0))}</td>
      <td>${thDate(o.deliveryDate)}</td>
      <td>${statusPill(o.status)}</td>
      <td style="text-align:right">
        ${o.status === "pending" ? `<button class="btn btn-ok btn-sm" data-deliver="${o.id}">✓ ส่ง</button>` : ""}
        <button class="btn btn-light btn-sm" data-print-deliv="${o.id}" title="พิมพ์ใบส่งของ">🖨️</button>
        <button class="btn btn-ghost btn-sm" data-edit-order="${o.id}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-del-order="${o.id}">🗑️</button>
      </td>
    </tr>`).join("")}</tbody></table>` : empty("📞", "ยังไม่มีออเดอร์ — กด \"รับออเดอร์ใหม่\"");
}

function orderModal(existing) {
  const o = existing || {};
  const preview = existing ? o.orderNo : previewDocNo("T", state.orders, "orderNo");
  openModal(existing ? "แก้ไขออเดอร์" : "📞 รับออเดอร์ใหม่", `
    <div class="form-row">
      <div class="field"><label>เลขที่ใบสั่งซื้อ <span class="muted" style="font-weight:400;font-size:.72rem">(ปล่อยไว้ = จองอัตโนมัติ)</span></label><input id="oNo" value="${esc(preview)}"></div>
      <div class="field"><label>วันที่สั่ง</label><input type="date" id="oDate" value="${o.date || todayStr()}"></div>
      <div class="field"><label>กำหนดส่งมอบ</label><input type="date" id="oDeliv" value="${o.deliveryDate || tomorrowStr()}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>ชื่อลูกค้า</label><input id="oCust" value="${esc(o.customer || "")}" placeholder="เช่น K.สุชาย"></div>
      <div class="field"><label>ผู้ติดต่อ / เบอร์</label><input id="oContact" value="${esc(o.contact || "")}"></div>
    </div>
    <div class="items-head">📦 รายการสั่งซื้อ</div>
    <div id="orderItems">${itemLinesHtml(o.items && o.items.length ? o.items : [{}])}</div>
    <div class="field" style="margin-top:14px"><label>หมายเหตุ</label><textarea id="oNote" rows="2">${esc(o.note || "")}</textarea></div>
  `, `<button class="btn btn-light" onclick="document.getElementById('modalBack').classList.remove('show')">ยกเลิก</button>
      <button class="btn btn-primary" id="saveOrder">💾 บันทึก</button>`);
  wireItemLines($("#orderItems"));
  $("#saveOrder").onclick = async () => {
    const items = collectItems($("#orderItems"));
    const customer = $("#oCust").value.trim();
    if (!customer) return toast("กรอกชื่อลูกค้า", "err");
    if (!items.length) return toast("เพิ่มรายการสินค้าอย่างน้อย 1 รายการ", "err");
    const btn = $("#saveOrder"); btn.disabled = true;
    try {
      let orderNo = $("#oNo").value.trim();
      // ใบใหม่ที่ผู้ใช้ไม่ได้แก้เลขเอง -> จองเลขจาก counter กลางแบบ atomic (กันชนกัน)
      if (!existing && orderNo === preview) orderNo = await allocateDocNo("T", "order", floorSeq("T", state.orders, "orderNo"));
      const data = {
        orderNo, date: $("#oDate").value, deliveryDate: $("#oDeliv").value,
        customer, contact: $("#oContact").value.trim(), items, note: $("#oNote").value.trim(),
      };
      if (existing) await updateOrder(existing.id, data);
      else await addOrder(data);
      closeModal(); toast("บันทึกออเดอร์แล้ว", "ok");
    } catch (e) { btn.disabled = false; toast("บันทึกไม่สำเร็จ: " + e.message, "err"); }
  };
}

/* ---------- Delivery ---------- */
function renderDelivery() {
  const today = todayStr();
  let list = state.orders.filter((o) => o.status === "pending");
  if (state.delFilter === "today") list = list.filter((o) => o.deliveryDate <= today);
  list.sort((a, b) => (a.deliveryDate || "").localeCompare(b.deliveryDate || ""));
  $("#delCount").textContent = `${list.length} รายการ`;
  $("#deliveryTable").innerHTML = list.length ? `
    <table class="tbl"><thead><tr><th>กำหนดส่ง</th><th>ลูกค้า</th><th>รายการ</th><th>ตรวจสต๊อก</th><th></th></tr></thead><tbody>
    ${list.map((o) => {
      const checks = (o.items || []).map((i) => {
        const inv = state.inventory.get(invKey(i.model, i.size, i.color));
        const have = Number(inv?.stock || 0);
        const ok = have >= Number(i.qty);
        return `<div>${swatch(i.color)}${esc(i.model)} ${fmt(i.size)}ล. × <b>${fmt(i.qty)}</b> ${ok ? `<span class="pill ok">มี ${fmt(have)}</span>` : `<span class="pill low">เหลือ ${fmt(have)}</span>`}</div>`;
      }).join("");
      const overdue = o.deliveryDate < today;
      return `<tr>
        <td>${thDate(o.deliveryDate)} ${overdue ? '<span class="pill low">เลยกำหนด</span>' : ""}</td>
        <td><b>${esc(o.customer)}</b><br><span class="muted" style="font-size:.76rem">${esc(o.orderNo || "")}</span></td>
        <td style="white-space:normal;max-width:320px;line-height:1.8">${checks}</td>
        <td></td>
        <td style="text-align:right"><button class="btn btn-light btn-sm" data-print-deliv="${o.id}" title="พิมพ์ใบส่งของ">🖨️</button> <button class="btn btn-ok btn-sm" data-deliver="${o.id}">🚚 ยืนยันส่ง</button></td>
      </tr>`;
    }).join("")}</tbody></table>` : empty("✅", "ไม่มีรายการค้างส่ง");
}

async function doDeliver(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const summary = (o.items || []).map((i) => `${i.model} ${i.size}ล. ${i.color} × ${i.qty}`).join("\n");
  if (!confirm(`ยืนยันจัดส่งให้ ${o.customer}?\nระบบจะตัดสต๊อก:\n\n${summary}`)) return;
  try { await deliverOrder(o); toast("จัดส่งสำเร็จ — ตัดสต๊อกแล้ว", "ok"); }
  catch (e) { toast("ผิดพลาด: " + e.message, "err"); }
}

/* ---------- Stock Matrix ---------- */
function renderStockMatrix() {
  const colors = state.catalog.colors;
  let html = `<table class="matrix"><thead><tr><th class="model-cell" style="z-index:6">รุ่น / ขนาด</th>
    ${colors.map((c) => `<th><div class="color-head">${swatch(c)}<span>${esc(c)}</span></div></th>`).join("")}</tr></thead><tbody>`;
  for (const [model, sizes] of Object.entries(state.catalog.models)) {
    html += `<tr class="model-row"><td class="model-cell">${esc(model)}</td>${colors.map(() => "<td></td>").join("")}</tr>`;
    for (const size of sizes) {
      html += `<tr><td class="size-cell">${fmt(size)} ล.</td>`;
      for (const color of colors) {
        const inv = state.inventory.get(invKey(model, size, color));
        const stock = Number(inv?.stock || 0);
        const max = Number(inv?.maxStock || 0);
        let cls = "";
        if (max > 0) { const r = stock / max; if (r <= 0.25) cls = "cell-low"; else if (r <= 0.5) cls = "cell-warn"; }
        const empty = !inv || (stock === 0 && max === 0);
        html += `<td class="cell"><div class="cell-inner ${cls} ${empty ? "empty" : ""}" data-cell="1" data-model="${esc(model)}" data-size="${size}" data-color="${esc(color)}">
          <span class="s">${empty ? "+" : fmt(stock)}</span>${max > 0 ? `<span class="m">/${fmt(max)}</span>` : ""}</div></td>`;
      }
      html += `</tr>`;
    }
  }
  html += `</tbody></table>`;
  $("#stockMatrix").innerHTML = html;
}

function cellModal(model, size, color) {
  const inv = state.inventory.get(invKey(model, size, color)) || {};
  openModal(`✏️ แก้สต๊อก`, `
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-size:1.3rem;font-weight:800">${swatch(color)}${esc(model)} · ${fmt(size)} ลิตร</div>
      <div class="muted">สี${esc(color)}</div>
    </div>
    <div class="form-row">
      <div class="field"><label>สต๊อกคงเหลือ (ใบ)</label><input type="number" id="cStock" value="${Number(inv.stock || 0)}" min="0"></div>
      <div class="field"><label>max stock (ขีดบน)</label><input type="number" id="cMax" value="${Number(inv.maxStock || 0)}" min="0"></div>
    </div>`,
    `${inv.id ? `<button class="btn btn-danger" id="cDel">ลบ</button>` : ""}
     <div style="flex:1"></div>
     <button class="btn btn-light" id="cCancel">ยกเลิก</button>
     <button class="btn btn-primary" id="cSave">💾 บันทึก</button>`);
  $("#cCancel").onclick = closeModal;
  $("#cSave").onclick = async () => {
    await upsertInventory({ model, size: Number(size), color, stock: Number($("#cStock").value), maxStock: Number($("#cMax").value) });
    closeModal(); toast("อัปเดตสต๊อกแล้ว", "ok");
  };
  if (inv.id) $("#cDel").onclick = async () => { await deleteInventory(inv.id); closeModal(); toast("ลบแล้ว", "ok"); };
}

/* ---------- Production ---------- */
function renderProduction() {
  const list = state.prodFilter === "all" ? state.production : state.production.filter((p) => p.status === state.prodFilter);
  $("#prodCount").textContent = `${list.length} ใบ`;
  $("#productionTable").innerHTML = list.length ? `
    <table class="tbl"><thead><tr><th>เลขที่/LOT</th><th>วันที่</th><th>รายการที่สั่งผลิต</th><th class="num">รวม</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr>
      <td><b>${esc(p.prodNo || "-")}</b>${p.lot ? `<br><span class="muted" style="font-size:.76rem">LOT ${esc(p.lot)}</span>` : ""}</td>
      <td>${thDate(p.date)}</td>
      <td style="white-space:normal;max-width:320px">${(p.items || []).map((i) => `${swatch(i.color)}${esc(i.model)} ${fmt(i.size)}ล. <b>${fmt(i.qty)}</b>`).join("<br>")}</td>
      <td class="num">${fmt((p.items || []).reduce((s, i) => s + Number(i.qty || 0), 0))}</td>
      <td>${statusPill(p.status)}</td>
      <td style="text-align:right">
        ${p.status === "pending" ? `<button class="btn btn-ok btn-sm" data-complete="${p.id}">✓ ผลิตเสร็จ</button>` : ""}
        <button class="btn btn-light btn-sm" data-print-prod="${p.id}" title="พิมพ์ใบสั่งผลิต">🖨️</button>
        <button class="btn btn-ghost btn-sm" data-del-prod="${p.id}">🗑️</button>
      </td>
    </tr>`).join("")}</tbody></table>` : empty("🏭", "ยังไม่มีใบสั่งผลิต");
}

function prodModal(prefillItems) {
  const preview = previewDocNo("P", state.production, "prodNo");
  openModal("🏭 เปิดใบสั่งผลิต", `
    <div class="form-row">
      <div class="field"><label>เลขที่ใบสั่งผลิต <span class="muted" style="font-weight:400;font-size:.72rem">(ปล่อยไว้ = จองอัตโนมัติ)</span></label><input id="pNo" value="${preview}"></div>
      <div class="field"><label>วันที่</label><input type="date" id="pDate" value="${todayStr()}"></div>
      <div class="field"><label>LOT.</label><input id="pLot" placeholder="เช่น H008/26"></div>
    </div>
    <div class="items-head">📦 รายการสั่งผลิต <span class="muted" style="font-weight:400">(จำนวนไม่ควรเกินขีดบน max)</span></div>
    <div id="prodItems">${itemLinesHtml(prefillItems && prefillItems.length ? prefillItems : [{}])}</div>
    <div class="field" style="margin-top:14px"><label>หมายเหตุ</label><textarea id="pNote" rows="2"></textarea></div>
  `, `<button class="btn btn-light" id="pCancel">ยกเลิก</button><button class="btn btn-primary" id="savePeod">💾 บันทึก</button>`);
  wireItemLines($("#prodItems"));
  $("#pCancel").onclick = closeModal;
  $("#savePeod").onclick = async () => {
    const items = collectItems($("#prodItems"));
    if (!items.length) return toast("เพิ่มรายการอย่างน้อย 1 รายการ", "err");
    const btn = $("#savePeod"); btn.disabled = true;
    try {
      let prodNo = $("#pNo").value.trim();
      if (prodNo === preview) prodNo = await allocateDocNo("P", "prod", floorSeq("P", state.production, "prodNo"));
      await addProduction({ prodNo, date: $("#pDate").value, lot: $("#pLot").value.trim(), items, note: $("#pNote").value.trim() });
      closeModal(); toast("เปิดใบสั่งผลิตแล้ว", "ok");
    } catch (e) { btn.disabled = false; toast("ผิดพลาด: " + e.message, "err"); }
  };
}

function autoProd() {
  const low = lowStockItems();
  if (!low.length) return toast("ไม่มีรายการที่ต้องผลิต — สต๊อกเพียงพอ", "ok");
  prodModal(low.map((r) => ({ model: r.model, size: r.size, color: r.color, qty: r.need })));
}

async function doComplete(id) {
  const p = state.production.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`ยืนยันว่าผลิตเสร็จ?\nระบบจะเพิ่มสต๊อกตามรายการในใบ ${p.prodNo || ""}`)) return;
  try { await completeProduction(p); toast("ผลิตเสร็จ — เพิ่มสต๊อกแล้ว", "ok"); }
  catch (e) { toast("ผิดพลาด: " + e.message, "err"); }
}

/* ---------- Catalog editor ---------- */
function renderCatalog() {
  // models
  $("#modelsEditor").innerHTML = Object.entries(state.catalog.models).map(([m, sizes]) => `
    <div class="field" style="border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <b style="color:var(--brand-3);font-size:1rem">${esc(m)}</b>
        <button class="btn btn-ghost btn-sm" data-del-model="${esc(m)}" style="margin-left:auto">ลบรุ่น</button>
      </div>
      <label>ขนาดความจุ (ลิตร) — คั่นด้วยจุลภาค</label>
      <input data-model-sizes="${esc(m)}" value="${sizes.join(", ")}">
    </div>`).join("");

  // colors
  $("#colorsEditor").innerHTML = `
    <div class="field"><label>รายชื่อสี (คั่นด้วยจุลภาค)</label>
    <input id="colorsInput" value="${state.catalog.colors.join(", ")}"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${state.catalog.colors.map((c) => `<span class="pill" style="background:var(--surface-2)">${swatch(c)}${esc(c)}</span>`).join("")}
    </div>
    <button class="btn btn-primary btn-sm" id="saveCatalogBtn">💾 บันทึกการตั้งค่ารุ่น/สี</button>`;

  // max editor — เฉพาะ SKU ที่มีในสต๊อกแล้ว
  const items = [...state.inventory.values()].sort((a, b) => a.model.localeCompare(b.model) || a.size - b.size);
  $("#maxEditor").innerHTML = items.length ? `
    <table class="tbl"><thead><tr><th>รุ่น</th><th>ขนาด</th><th>สี</th><th class="num">สต๊อก</th><th>max stock</th></tr></thead><tbody>
    ${items.map((i) => `<tr>
      <td><b>${esc(i.model)}</b></td><td>${fmt(i.size)} ล.</td><td>${swatch(i.color)}${esc(i.color)}</td>
      <td class="num">${fmt(i.stock)}</td>
      <td><input type="number" min="0" value="${Number(i.maxStock || 0)}" style="width:110px;padding:6px 10px" data-max="${i.id}"></td>
    </tr>`).join("")}</tbody></table>
    <div style="padding:14px"><button class="btn btn-primary btn-sm" id="saveMaxBtn">💾 บันทึก max ทั้งหมด</button></div>`
    : empty("📦", "ยังไม่มี SKU — เพิ่มได้จากหน้าสต๊อก (คลิกช่องที่มี +)");
}

/* ---------- Global event delegation ---------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-deliver],[data-complete],[data-edit-order],[data-del-order],[data-del-prod],[data-cell],[data-del-model],[data-print-prod],[data-print-deliv]");
  if (!t) return;
  if (t.dataset.printProd) { const p = state.production.find((x) => x.id === t.dataset.printProd); if (p) printProduction(p); }
  else if (t.dataset.printDeliv) { const o = state.orders.find((x) => x.id === t.dataset.printDeliv); if (o) printDelivery(o); }
  else if (t.dataset.deliver) doDeliver(t.dataset.deliver);
  else if (t.dataset.complete) doComplete(t.dataset.complete);
  else if (t.dataset.editOrder) orderModal(state.orders.find((o) => o.id === t.dataset.editOrder));
  else if (t.dataset.delOrder) { if (confirm("ลบออเดอร์นี้?")) deleteOrder(t.dataset.delOrder).then(() => toast("ลบแล้ว", "ok")); }
  else if (t.dataset.delProd) { if (confirm("ลบใบสั่งผลิตนี้?")) deleteProduction(t.dataset.delProd).then(() => toast("ลบแล้ว", "ok")); }
  else if (t.dataset.cell) { cellModal(t.dataset.model, t.dataset.size, t.dataset.color); }
  else if (t.dataset.delModel) {
    if (confirm(`ลบรุ่น ${t.dataset.delModel}?`)) { delete state.catalog.models[t.dataset.delModel]; saveCatalog(state.catalog).then(() => { renderCatalog(); toast("ลบรุ่นแล้ว", "ok"); }); }
  }
});

// catalog save buttons (delegated because re-rendered)
document.addEventListener("click", async (e) => {
  if (e.target.id === "saveCatalogBtn") {
    const models = {};
    $$("[data-model-sizes]").forEach((inp) => {
      models[inp.dataset.modelSizes] = inp.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0).sort((a, b) => a - b);
    });
    const colors = $("#colorsInput").value.split(",").map((x) => x.trim()).filter(Boolean);
    await saveCatalog({ models, colors });
    toast("บันทึกการตั้งค่าแล้ว", "ok");
  }
  if (e.target.id === "saveMaxBtn") {
    for (const inp of $$("[data-max]")) {
      const inv = state.inventory.get(inp.dataset.max);
      if (inv) await upsertInventory({ model: inv.model, size: inv.size, color: inv.color, maxStock: Number(inp.value) });
    }
    toast("บันทึก max แล้ว", "ok");
  }
});

$("#btnNewOrder").onclick = () => orderModal();
$("#btnNewProd").onclick = () => prodModal();
$("#btnAutoProd").onclick = autoProd;
$("#btnExportOrders").onclick = exportOrders;
$("#btnExportProd").onclick = exportProduction;
$("#btnExportStock").onclick = exportStock;
$("#btnAddModel").onclick = () => {
  const name = prompt("ชื่อรุ่นใหม่:");
  if (!name) return;
  state.catalog.models[name.trim()] = [];
  saveCatalog(state.catalog).then(() => { renderCatalog(); toast("เพิ่มรุ่นแล้ว — ใส่ขนาดแล้วกดบันทึก", "ok"); });
};

$("#orderFilter").addEventListener("click", (e) => { if (e.target.dataset.f) { state.orderFilter = e.target.dataset.f; segActive("#orderFilter", e.target); renderOrders(); } });
$("#delFilter").addEventListener("click", (e) => { if (e.target.dataset.f) { state.delFilter = e.target.dataset.f; segActive("#delFilter", e.target); renderDelivery(); } });
$("#prodFilter").addEventListener("click", (e) => { if (e.target.dataset.f) { state.prodFilter = e.target.dataset.f; segActive("#prodFilter", e.target); renderProduction(); } });
function segActive(sel, btn) { $$(`${sel} button`).forEach((b) => b.classList.toggle("active", b === btn)); }

/* ---------- Render orchestrator ----------
   วาดเฉพาะหน้าที่เปิดอยู่ + badge เพื่อเลี่ยงการ rebuild ทุกหน้า (รวม matrix ใหญ่) ทุก snapshot */
function renderActive() {
  updateBadges();
  const active = ($(".page.active") || {}).id;
  switch (active) {
    case "page-dashboard": return renderDashboard();
    case "page-orders": return renderOrders();
    case "page-delivery": return renderDelivery();
    case "page-stock": return renderStockMatrix();
    case "page-production": return renderProduction();
    case "page-catalog":
      // อย่าวาดทับขณะผู้ใช้กำลังพิมพ์ในฟอร์มตั้งค่า (กันค่าที่พิมพ์ค้างหาย)
      if (!(document.activeElement && document.activeElement.closest("#page-catalog"))) renderCatalog();
      return;
  }
}

/* ---------- Boot ---------- */
$("#todayChip").textContent = new Date().toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

(async function boot() {
  try {
    state.catalog = await ensureCatalog();
  } catch (e) {
    toast("เชื่อมต่อ Firebase ไม่ได้: " + e.message, "err");
    console.error(e);
  }
  watchCatalog((c) => { state.catalog = c; renderActive(); });
  watchInventory((m) => { state.inventory = m; renderActive(); });
  watchOrders((a) => { state.orders = a; renderActive(); });
  watchProduction((a) => { state.production = a; renderActive(); });
  renderActive();
})();
