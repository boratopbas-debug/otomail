// PDF ekindeki metni ve tabloları mail içinde gösterilecek HTML'e çevirir.
// Satırlar y konumuna göre, sütunlar tüm satırlardaki hücre başlangıçlarının x kümelerine göre hizalanır.
let pdfjsP = null;
const pdfjs = () => (pdfjsP ||= (async () => {
  // Node'da worker'ı ana iş parçacığına yükle; paketleyicinin dosyayı dahil etmesini de sağlar
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
})());

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FIX = { "Ġ": "İ", "ġ": "ş", "Ģ": "Ş", "Ý": "İ", "ý": "ı", "Þ": "Ş", "þ": "ş", "Ð": "Ğ", "ð": "ğ" };
const norm = s => String(s).replace(/[ĠġĢÝýÞþÐð]/g, c => FIX[c]);
const isNum = s => /^[-+(]?%?\s?[\d.,]+%?\)?$/.test(s.trim());

// Bir sayfanın satırları: [{y, cells:[{x, text}]}]
async function pageRows(page) {
  const tc = await page.getTextContent();
  const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({
    s: norm(i.str), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8,
  }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.4));
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of r.items) {
      const last = cells[cells.length - 1];
      const charW = it.s.length ? it.w / it.s.length : it.h * 0.5;
      if (last && it.x - last.end < Math.max(charW * 1.6, 4)) { last.text += (it.x - last.end > charW * 0.25 ? " " : "") + it.s; last.end = it.x + it.w; }
      else cells.push({ x: it.x, end: it.x + it.w, text: it.s });
    }
    return { y: r.y, cells: cells.map(c => ({ x: c.x, text: c.text.trim() })).filter(c => c.text) };
  }).filter(r => r.cells.length);
}

// Ardışık çok hücreli satırları tablolara, tek hücrelileri paragraflara ayır
function blocksToHtml(rows) {
  const blocks = [];
  for (const r of rows) {
    const multi = r.cells.length >= 2;
    const last = blocks[blocks.length - 1];
    if (multi && last?.type === "table") last.rows.push(r);
    else if (multi) blocks.push({ type: "table", rows: [r] });
    else blocks.push({ type: "p", text: r.cells[0].text });
  }
  // tek satırlık "tablolar" (ör. "Konu: ... Tarih: ...") paragraf olsun
  let html = "";
  for (const b of blocks) {
    if (b.type === "p" || b.rows.length < 2) {
      const t = b.type === "p" ? b.text : b.rows[0].cells.map(c => c.text).join("   ");
      html += `<div style="font-size:13px;margin:3px 0">${esc(t)}</div>`;
      continue;
    }
    // sütun çapaları: hücre başlangıç x'lerini kümele
    const xs = b.rows.flatMap(r => r.cells.map(c => c.x)).sort((a, b) => a - b);
    const anchors = [];
    for (const x of xs) { if (!anchors.length || x - anchors[anchors.length - 1].max > 10) anchors.push({ min: x, max: x }); else anchors[anchors.length - 1].max = x; }
    const col = x => { let k = 0; for (let i = 0; i < anchors.length; i++) if (x >= anchors[i].min - 6) k = i; return k; };
    const n = anchors.length;
    const grid = b.rows.map(r => { const g = Array(n).fill(""); for (const c of r.cells) { const k = col(c.x); g[k] = g[k] ? g[k] + " " + c.text : c.text; } return g; });
    // tamamen boş sütunları at
    const keep = [...Array(n).keys()].filter(i => grid.some(g => g[i]));
    html += `<table cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;margin:8px 0">` +
      grid.map((g, ri) => `<tr>${keep.map(i => {
        const t = g[i], head = ri === 0;
        return `<td style="padding:5px 8px;border:1px solid #E3E7E6;vertical-align:top;${isNum(t) ? "text-align:right;white-space:nowrap;" : ""}${head ? "font-weight:600;background:#F3F5F4;" : ""}">${esc(t)}</td>`;
      }).join("")}</tr>`).join("") + `</table>`;
  }
  return html;
}

export async function pdfPreview(buf, { maxPages = 10, maxRows = 300 } = {}) {
  try {
    const { getDocument } = await pdfjs();
    const doc = await getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
    let rows = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages) && rows.length < maxRows; p++) {
      const page = await doc.getPage(p);
      rows.push(...await pageRows(page));
      page.cleanup();
    }
    const pages = doc.numPages;
    await doc.destroy();
    if (!rows.length) return { html: "", note: "PDF taranmış görüntü, metin okunamadı; ekteki dosyaya bakınız." };
    const cut = rows.length > maxRows || pages > maxPages;
    rows = rows.slice(0, maxRows);
    return { html: blocksToHtml(rows) + (cut ? `<div style="font-size:12px;color:#5B6678">Devamı ekteki dosyada.</div>` : ""), note: "" };
  } catch (e) {
    return { html: "", note: `PDF okunamadı (${e.message}); ekteki dosyaya bakınız.` };
  }
}
