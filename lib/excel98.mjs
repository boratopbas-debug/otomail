// Rehber 9.8 kayıtlarından biçimlendirilmiş Excel dosyası üretir.
import ExcelJS from "exceljs";
import { titleTr } from "./kap98.mjs";

const NAVY = "FF16233A", GRID = "FFDDE3E2", ZEBRA = "FFF6F8F8";
const toDate = s => { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : s; };

export async function excel98(recs, { kapIdx, kapLink, publish } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KAP Bildirim Mail";
  const ws = wb.addWorksheet("Rehber 9.8", { views: [{ state: "frozen", ySplit: 4 }] });

  const cols = [
    { h: "Rapor Tarihi", w: 12, fmt: "dd.mm.yyyy" },
    { h: "Fon Kodu", w: 9 },
    { h: "Fon Ünvanı", w: 46 },
    { h: "Katılma Payı Sahibi", w: 40 },
    { h: "T Günü Pay Oranı", w: 13, fmt: "0.00%" },
    { h: "T-1 Günü Pay Oranı", w: 13, fmt: "0.00%" },
    { h: "Değişim (puan)", w: 12, fmt: '+0.00;[Red]-0.00;0.00' },
    { h: "T Günü Sahip Olunan Pay Adedi", w: 18, fmt: "#,##0" },
    { h: "T-1 Günü Sahip Olunan Pay Adedi", w: 18, fmt: "#,##0" },
    { h: "T Günü Tedavüldeki Pay Adedi", w: 18, fmt: "#,##0" },
    { h: "T-1 Günü Tedavüldeki Pay Adedi", w: 18, fmt: "#,##0" },
  ];
  ws.columns = cols.map(c => ({ width: c.w }));

  // başlık bloğu
  ws.mergeCells(1, 1, 1, cols.length);
  const t = ws.getCell(1, 1);
  t.value = "Yatırım Fonlarına İlişkin Rehberin 9.8. Maddesi Gereğince Yapılan Açıklama";
  t.font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, cols.length);
  const s = ws.getCell(2, 1);
  s.value = kapLink ? { text: `KAP bildirimi ${kapIdx ?? ""}${publish ? " · " + publish : ""} · ${recs.length} satır`, hyperlink: kapLink } : `${recs.length} satır`;
  s.font = { size: 10, color: { argb: "FF7A1F2B" }, underline: !!kapLink };
  ws.getRow(3).height = 6;

  // tablo başlığı
  const hr = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: i >= 4 ? "right" : "left", wrapText: true };
  });
  hr.height = 32;

  const sorted = [...recs].sort((a, b) => (b.oranT || 0) - (a.oranT || 0));
  sorted.forEach((r, k) => {
    const n = 5 + k;
    const row = ws.getRow(n);
    row.values = [
      toDate(r.tarih), r.kod, titleTr(r.fon), titleTr(r.sahip),
      (r.oranT ?? 0) / 100, (r.oranT1 ?? 0) / 100, { formula: `(E${n}-F${n})*100`, result: (r.oranT ?? 0) - (r.oranT1 ?? 0) },
      r.adetT, r.adetT1, r.tedavulT, r.tedavulT1,
    ];
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.fmt) cell.numFmt = c.fmt;
      cell.alignment = { vertical: "top", wrapText: i === 2 || i === 3, horizontal: i >= 4 ? "right" : "left" };
      cell.font = { size: 10, bold: i === 1 || i === 4 };
      cell.border = { bottom: { style: "thin", color: { argb: GRID } } };
      if (k % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
  });
  const last = 4 + sorted.length;
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: cols.length } };
  // T günü oranı için veri çubuğu
  if (sorted.length) ws.addConditionalFormatting({
    ref: `E5:E${last}`,
    rules: [{ type: "dataBar", minLength: 0, maxLength: 100, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }], color: { argb: "FFC9858F" }, gradient: false }],
  });
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
