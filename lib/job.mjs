// Ana iş: son çalışmadan beri yayımlanan "Rehberin 9.8. maddesi" bildirimlerini bul,
// eklerini indir ve tek, düzenli bir mailde gönder.
import nodemailer from "nodemailer";
import * as XLSX from "xlsx";
import { getStore } from "@netlify/blobs";
import { getDetail, summarize, learnSubjectOid, findBySubject, downloadAttachment, kapLink, ymd } from "./kap.mjs";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const store = () => getStore({ name: "kap-mail", consistency: "strong" });
export async function getState() { try { return (await store().get("state.json", { type: "json" })) || {}; } catch { return {}; } }
async function setState(s) { try { await store().setJSON("state.json", s); } catch {} }

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAX_BYTES = 18 * 1024 * 1024; // Gmail 25 MB sınırının altında kal

// "15.10.2026 17:45:12" (İstanbul) → Date
function trDate(s) {
  const m = String(s || "").match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) - 3, +m[5] || 0, +m[6] || 0)) : null;
}
const trDay = d => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });
const trTime = d => d ? d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

// Excel ekini mail içinde okunur bir tabloya çevir
function sheetPreview(buf) {
  try {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    let out = "";
    for (const sn of wb.SheetNames.slice(0, 3)) {
      let rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" })
        .filter(r => r.some(c => String(c).trim() !== ""));
      if (!rows.length) continue;
      const nc = Math.min(12, Math.max(...rows.map(r => { let k = r.length; while (k && String(r[k - 1]).trim() === "") k--; return k; })));
      const cut = rows.length > 60;
      rows = rows.slice(0, 60);
      const fmt = c => c instanceof Date ? c.toLocaleDateString("tr-TR") : typeof c === "number" ? c.toLocaleString("tr-TR", { maximumFractionDigits: 6 }) : esc(c);
      const td = (c, i, head) => `<td style="padding:5px 9px;border-bottom:1px solid #E3E7E6;${typeof c === "number" ? "text-align:right;white-space:nowrap;" : ""}${head ? "font-weight:600;background:#F3F5F4;" : ""}">${fmt(c)}</td>`;
      out += `${wb.SheetNames.length > 1 ? `<div style="font-size:12px;color:#5B6678;margin:10px 0 4px">${esc(sn)}</div>` : ""}
        <table cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;margin:6px 0">
        ${rows.map((r, ri) => `<tr>${Array.from({ length: nc }, (_, i) => td(r[i] ?? "", i, ri === 0)).join("")}</tr>`).join("")}
        </table>${cut ? `<div style="font-size:12px;color:#5B6678">İlk 60 satır gösteriliyor; tamamı ekte.</div>` : ""}`;
    }
    return out;
  } catch { return ""; }
}

function card(d) {
  const files = d.files.map(f => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border:1px solid #D5DBDA;border-radius:6px;font-size:12px">📎 ${esc(f.filename)}</span>`).join("")
    || `<span style="font-size:12px;color:#7A1F2B">Ek indirilemedi — KAP linkinden ulaşabilirsiniz.</span>`;
  return `<div style="border:1px solid #D5DBDA;border-radius:10px;padding:14px 16px;margin:0 0 14px;background:#fff">
    <div style="font-size:15px;font-weight:700">${esc(d.fundCode ? d.fundCode + " — " : "")}${esc(d.fundName || d.company)}</div>
    ${d.fundName && d.company ? `<div style="font-size:13px;color:#5B6678">${esc(d.company)}</div>` : ""}
    <div style="font-size:12px;color:#5B6678;margin:4px 0 8px">${esc(trTime(d.pub) || d.publishDate)} · <a href="${kapLink(d.idx)}" style="color:#7A1F2B">KAP'ta aç (${d.idx})</a></div>
    ${d.bodyText ? `<div style="font-size:13px;white-space:pre-wrap;margin:0 0 8px">${esc(d.bodyText.slice(0, 1500))}${d.bodyText.length > 1500 ? "…" : ""}</div>` : ""}
    ${d.previews}
    <div style="margin-top:8px">${files}</div>
  </div>`;
}

export async function run({ dryRun = false, force = false } = {}) {
  const log = [];
  const L = m => { log.push(m); console.log(m); };
  const state = await getState();
  const now = new Date();
  const report = { zaman: now.toISOString(), dryRun, log };
  const subjectMatch = env("SUBJECT_MATCH", "Rehberin 9.8. maddesi");
  const recipients = env("RECIPIENTS").split(/[,;\s]+/).filter(Boolean);

  try {
    // 1) Konunun KAP kimliği (bir kez öğrenilir ve saklanır)
    let subjectOid = env("SUBJECT_OID") || state.subjectOid || null;
    if (!subjectOid && !state.subjectOidTried) {
      subjectOid = await learnSubjectOid(env("REF_INDEX", "1682456"), L);
      state.subjectOidTried = true;
    }

    // 2) Tarama aralığı: son çalışmadan bugüne (ilk çalışmada son 24 saat; hafta sonu boşluğu otomatik kapanır)
    const since = force && env("FORCE_HOURS") ? new Date(now - Number(env("FORCE_HOURS")) * 3600e3)
      : state.lastRunAt ? new Date(state.lastRunAt) : new Date(now - 24 * 3600e3);
    const days = [];
    for (let d = new Date(Math.max(since.getTime(), now - 10 * 864e5)); ymd(d) <= ymd(now); d = new Date(d.getTime() + 864e5)) days.push(ymd(d));
    if (!days.includes(ymd(now))) days.push(ymd(now));
    L(`Aralık: ${since.toISOString()} → şimdi (${days.join(", ")})`);

    const sent = new Set(state.sentIdx || []);
    const idxs = (await findBySubject({ subjectOid, subjectMatch, days, log: L })).filter(i => !sent.has(i));

    // 3) Detaylar ve ekler
    const items = [], attachments = [];
    let total = 0;
    for (const idx of idxs) {
      try {
        const d = summarize(idx, await getDetail(idx));
        d.pub = trDate(d.publishDate);
        if (d.pub && d.pub < since) { L(`${idx}: aralık dışı (${d.publishDate}), atlandı`); continue; }
        d.files = []; d.previews = "";
        for (const a of d.attachments.slice(0, 8)) {
          try {
            const content = await downloadAttachment(a);
            const filename = `${d.fundCode ? d.fundCode + "_" : ""}${a.fileName}`.replace(/[\\/:*?"<>|]/g, "_");
            if (/^xlsx?$/.test(a.ext)) d.previews += sheetPreview(content);
            if (total + content.length > MAX_BYTES) { L(`${filename}: boyut sınırı, mailde sadece link`); continue; }
            total += content.length;
            d.files.push({ filename, content });
            attachments.push({ filename, content });
          } catch (e) { L(`${idx} / ${a.fileName}: indirilemedi — ${e.message}`); }
        }
        items.push(d);
        L(`${idx}: ${d.fundCode || d.company} — ${d.files.length}/${d.attachments.length} ek`);
      } catch (e) { L(`${idx}: detay alınamadı — ${e.message}`); }
    }
    items.sort((a, b) => (a.fundCode || a.company || "").localeCompare(b.fundCode || b.company || "", "tr") || a.idx - b.idx);

    // 4) Mail
    const today = trDay(now);
    const subject = items.length
      ? `KAP | Rehber 9.8 açıklamaları — ${today} (${items.length} bildirim)`
      : `KAP | Rehber 9.8 açıklamaları — ${today} (yeni bildirim yok)`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#16233A;background:#EDF0EF;padding:20px">
      <div style="max-width:760px;margin:0 auto">
        <div style="font-size:20px;font-weight:700;margin-bottom:2px">Rehberin 9.8. maddesi gereğince yapılan açıklamalar</div>
        <div style="font-size:13px;color:#5B6678;margin-bottom:16px">${esc(trTime(since))} – ${esc(trTime(now))} arasında KAP'ta yayımlanan ${items.length} bildirim</div>
        ${items.length ? items.map(card).join("") : `<div style="background:#fff;border:1px solid #D5DBDA;border-radius:10px;padding:16px">Son gönderimden bu yana bu başlıkta yeni bildirim yayımlanmadı.</div>`}
        <div style="font-size:11px;color:#5B6678;margin-top:14px">Kaynak: KAP (kap.org.tr). Otomatik gönderimdir.</div>
      </div></div>`;

    report.bildirimler = items.map(d => ({ idx: d.idx, fon: d.fundCode, sirket: d.company, yayin: d.publishDate, ekler: d.files.map(f => f.filename), link: kapLink(d.idx) }));
    const newState = { ...state, subjectOid, lastRunAt: now.toISOString(), sentIdx: [...sent, ...items.map(d => d.idx)].slice(-1000) };

    if (dryRun) {
      report.sonuc = "deneme";
      report.mail = { kime: recipients, konu: subject, ekSayisi: attachments.length, boyutKB: Math.round(total / 1024) };
      report.onizlemeHtml = html.length > 200000 ? html.slice(0, 200000) : html;
      await setState({ ...state, subjectOid, subjectOidTried: state.subjectOidTried, lastTest: { ...report, onizlemeHtml: undefined } });
      return report;
    }

    if (!items.length && env("SEND_EMPTY", "true") !== "true") {
      L("Yeni bildirim yok, mail atılmadı (SEND_EMPTY=false).");
      report.sonuc = "yeni_yok";
      await setState({ ...newState, lastRun: report });
      return report;
    }

    if (!recipients.length) throw new Error("RECIPIENTS ortam değişkeni boş");
    const user = env("GMAIL_USER"), pass = env("GMAIL_APP_PASSWORD").replace(/\s+/g, "");
    if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD eksik");
    const tx = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    const useBcc = env("USE_BCC", "true") === "true";
    const info = await tx.sendMail({
      from: `"${env("FROM_NAME", "KAP Bildirim")}" <${user}>`,
      to: useBcc ? user : recipients.join(", "),
      bcc: useBcc ? recipients.join(", ") : undefined,
      subject, html, attachments,
    });
    L(`Mail gönderildi: ${recipients.length} alıcı, ${attachments.length} ek (${info.messageId})`);
    report.sonuc = "gonderildi";
    await setState({ ...newState, lastRun: report });
    return report;
  } catch (e) {
    L(`HATA: ${e.message || e}`);
    report.sonuc = "hata"; report.hata = String(e.message || e);
    await setState({ ...state, lastRun: report });
    return report;
  }
}
