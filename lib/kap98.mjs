// KAP "Rehber 9.8" ek PDF'i (MicroStrategy raporu) için özel okuyucu ve mail görünümü.
// Sütunlar: Rapor Tarihi | Katılma Payı Sahibi | Fon Kodu | Fon Ünvanı |
//           T-1 adet | T adet | T-1 oran % | T oran % | T-1 tedavül adet | T tedavül adet
// Uzun isimler hücre içinde birkaç satıra bölünür; tarih satırı kaydın dikey ortasındadır.
let pdfjsP = null;
const pdfjs = () => (pdfjsP ||= (async () => {
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
})());

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const NUM = /^-?[\d.]+(,\d+)?%?$/;
const toNum = s => parseFloat(String(s).replace(/%/g, "").replace(/\./g, "").replace(",", "."));

export async function parse98(buf) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const recs = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items.filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width }));
    page.cleanup();
    // başlık konumları
    const find = re => items.find(i => re.test(i.s));
    const hOwner = find(/^Katılma Payı$/), hCode = find(/^Fon Kodu$/), hTitle = find(/^Fon Ünvanı$/);
    if (!hOwner || !hCode || !hTitle) continue;
    const headerBottom = Math.min(...items.filter(i => /Adedi|\(%\)|Sahibi|Rapor Tarihi|Fon Kodu|Fon Ünvanı/.test(i.s) && i.y > hTitle.y - 60).map(i => i.y));
    const numStartX = Math.min(...items.filter(i => /Gününde/.test(i.s)).map(i => i.x)) - 8;
    const dates = items.filter(i => DATE.test(i.s) && i.y < headerBottom).sort((a, b) => b.y - a.y);
    if (!dates.length) continue;
    const rows = dates.map(d => ({ date: d.s, y: d.y, owner: [], title: [], code: "", nums: [] }));
    const nearest = y => rows.reduce((bi, r, j) => Math.abs(r.y - y) < Math.abs(rows[bi].y - y) ? j : bi, 0);
    const ownerCol = [], titleCol = [];
    for (const it of items) {
      if (it.y >= headerBottom - 1 || DATE.test(it.s)) continue;
      if (it.x >= numStartX && NUM.test(it.s)) { const r = rows[nearest(it.y)]; if (Math.abs(it.y - r.y) < 4) r.nums.push(it); continue; }
      if (it.x >= hCode.x - 4 && it.x < hTitle.x - 4) { const r = rows[nearest(it.y)]; if (!r.code && /^[A-Z0-9]{2,6}$/.test(it.s) && Math.abs(it.y - r.y) < 4) r.code = it.s; continue; }
      if (it.x >= hOwner.x - 4 && it.x < hCode.x - 4) ownerCol.push(it);
      else if (it.x >= hTitle.x - 4 && it.x < numStartX) titleCol.push(it);
    }
    assignCentered(ownerCol, rows, "owner");
    assignCentered(titleCol, rows, "title");
    const wOwner = hCode.x - hOwner.x, wTitle = numStartX - hTitle.x;
    for (const r of rows) {
      const n = r.nums.sort((a, b) => a.x - b.x).map(i => toNum(i.s));
      if (n.length < 4) continue;
      recs.push({
        tarih: r.date, sahip: joinLines(r.owner, wOwner), kod: r.code, fon: joinLines(r.title, wTitle),
        adetT1: n[0], adetT: n[1], oranT1: n[2], oranT: n[3], tedavulT1: n[4], tedavulT: n[5],
      });
    }
  }
  await doc.destroy();
  return recs;
}

// Bir sütunun satırlarını (yukarıdan aşağı) kayıtlara bitişik gruplar halinde dağıtır;
// her grubun dikey ortası kendi tarih satırına en yakın olacak şekilde (dinamik programlama).
function assignCentered(col, rows, key) {
  if (!col.length || !rows.length) return;
  // aynı y'deki parçaları tek satır say
  const lines = [];
  for (const it of col.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) < 2) l.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  const n = lines.length, k = rows.length;
  const cost = (i, j, r) => { let s = 0; for (let t = i; t < j; t++) s += lines[t].y; return Math.abs(s / (j - i) - rows[r].y); };
  const INF = 1e18, dp = Array.from({ length: k + 1 }, () => Array(n + 1).fill(INF)), from = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  dp[0][0] = 0;
  for (let r = 1; r <= k; r++) for (let j = r; j <= n; j++) for (let i = r - 1; i < j; i++) {
    if (dp[r - 1][i] === INF) continue;
    const c = dp[r - 1][i] + cost(i, j, r - 1);
    if (c < dp[r][j]) { dp[r][j] = c; from[r][j] = i; }
  }
  if (dp[k][n] === INF) { for (const l of lines) rows[rows.reduce((bi, rr, j) => Math.abs(rr.y - l.y) < Math.abs(rows[bi].y - l.y) ? j : bi, 0)][key].push(l); return; }
  for (let r = k, j = n; r > 0; r--) { const i = from[r][j]; for (let t = i; t < j; t++) rows[r - 1][key].push(lines[t]); j = i; }
}

const STANDALONE = new Set(["FON", "FONU", "FONA", "VE", "İLE", "A.Ş.", "A.Ş", "TL", "(TL)", "PARA", "BANK", "ŞTİ.", "LTD.", "SAN.", "TİC.", "VAKFI", "OYAK", "BV", "MT", "ONE", "NEO", "ROTA", "FİBA", "İŞ"]);
// Satırları birleştir; sütunu dolduran tek kelimelik satır ya da "-" ile biten satır kelime bölünmesidir
function joinLines(lines, colW) {
  const ls = lines.sort((a, b) => b.y - a.y).map(l => {
    const its = l.items.sort((a, b) => a.x - b.x);
    return { text: its.map(i => i.s).join(" ").trim(), w: its[its.length - 1].x + its[its.length - 1].w - its[0].x, words: its.map(i => i.s).join(" ").trim().split(/\s+/).length };
  });
  let out = "";
  ls.forEach((l, i) => {
    if (i === 0) { out = l.text; return; }
    const prev = ls[i - 1];
    const first = l.text.split(/\s+/)[0];
    const broken = /-$/.test(prev.text) || (prev.words === 1 && prev.w >= colW - 14 && !/[.,)]$/.test(prev.text)
      && first.length <= 5 && !STANDALONE.has(first));
    out += (broken ? "" : " ") + l.text;
  });
  return out.replace(/\s+/g, " ").replace(/([A-ZÇĞİÖŞÜ]+)- ([A-ZÇĞİÖŞÜ])/g, "$1-$2").trim();
}

// ---- görünüm ----
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KEEP = new Set(["TL", "USD", "EUR", "A.Ş.", "PYŞ", "II", "III", "IV", "BV", "ICBC", "QNB", "TEB", "ING", "HSBC", "ZİRAAT", "BNP", "PYS", "GSYF", "BYF", "KYD", "TÜFE"]);
const SMALL = new Set(["VE", "İLE", "DA", "DE"]);
export function titleTr(s) {
  return String(s || "").split(" ").map(w => {
    const core = w.replace(/[()]/g, "");
    if (KEEP.has(core) || /^[IVX]+$/.test(core) || /\d/.test(core) || core.includes("-") || (core.length <= 2 && !SMALL.has(core))) return w;
    if (SMALL.has(core)) return w.toLocaleLowerCase("tr");
    const low = w.toLocaleLowerCase("tr");
    const i = low.search(/[a-zçğıöşü]/i);
    return i < 0 ? low : low.slice(0, i) + low[i].toLocaleUpperCase("tr") + low.slice(i + 1);
  }).join(" ");
}
const fmtInt = n => Number.isFinite(n) ? Math.round(n).toLocaleString("tr-TR") : "–";
const fmtPct = n => Number.isFinite(n) ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%" : "–";

export function render98(recs) {
  const sorted = [...recs].sort((a, b) => (b.oranT || 0) - (a.oranT || 0));
  const th = (t, right) => `<th style="padding:8px 10px;font-size:11px;font-weight:600;color:#5B6678;text-transform:uppercase;letter-spacing:.03em;border-bottom:2px solid #16233A;${right ? "text-align:right;" : "text-align:left;"}white-space:nowrap">${t}</th>`;
  const rows = sorted.map((r, i) => {
    const d = (r.oranT ?? 0) - (r.oranT1 ?? 0);
    const dCol = d > 0.005 ? "#1B7F4C" : d < -0.005 ? "#B42318" : "#5B6678";
    const dTxt = Math.abs(d) < 0.005 ? "0,00" : (d > 0 ? "+" : "−") + Math.abs(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const bar = Math.max(0, Math.min(100, r.oranT || 0));
    const bg = i % 2 ? "#FAFBFB" : "#FFFFFF";
    return `<tr style="background:${bg}">
      <td style="padding:9px 10px;border-bottom:1px solid #E6EAE9;vertical-align:top;width:34%">
        <div style="font-weight:700;font-size:13px;color:#16233A">${esc(r.kod)}</div>
        <div style="font-size:12px;color:#3D4A5E;line-height:1.35">${esc(titleTr(r.fon))}</div></td>
      <td style="padding:9px 10px;border-bottom:1px solid #E6EAE9;vertical-align:top;font-size:12px;color:#16233A;line-height:1.35">${esc(titleTr(r.sahip))}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #E6EAE9;vertical-align:top;text-align:right;white-space:nowrap">
        <div style="font-size:14px;font-weight:700;color:#16233A">${fmtPct(r.oranT)}</div>
        <div style="margin:4px 0 0 auto;width:90px;height:5px;background:#E6EAE9;border-radius:3px"><div style="width:${bar}%;height:5px;background:#7A1F2B;border-radius:3px"></div></div>
        <div style="font-size:11px;color:#5B6678;margin-top:3px">önceki gün ${fmtPct(r.oranT1)}</div></td>
      <td style="padding:9px 10px;border-bottom:1px solid #E6EAE9;vertical-align:top;text-align:right;white-space:nowrap;font-size:12px;font-weight:600;color:${dCol}">${dTxt}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #E6EAE9;vertical-align:top;text-align:right;white-space:nowrap;font-size:12px;color:#16233A">${fmtInt(r.adetT)}
        <div style="font-size:11px;color:#5B6678">/ ${fmtInt(r.tedavulT)}</div></td>
    </tr>`;
  }).join("");
  const dates = [...new Set(recs.map(r => r.tarih))].join(", ");
  return `<div style="font-size:12px;color:#5B6678;margin:4px 0 8px">Rapor tarihi ${esc(dates)} · ${recs.length} fon · tek yatırımcının fondaki payına göre büyükten küçüğe</div>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif">
    <tr>${th("Fon")}${th("Katılma payı sahibi")}${th("Pay oranı", 1)}${th("Değişim (puan)", 1)}${th("Sahip olunan / tedavüldeki pay", 1)}</tr>
    ${rows}
  </table>`;
}
