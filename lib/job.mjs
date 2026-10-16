// Ana iş: son çalışmadan beri yayımlanan "Rehberin 9.8. maddesi" bildirimlerini bul,
// eklerini indir ve tek, düzenli bir mailde gönder.
import nodemailer from "nodemailer";
import * as XLSX from "xlsx";
import { getStore } from "@netlify/blobs";
import { pdfPreview } from "./pdfpreview.mjs";
import { parse98, render98 } from "./kap98.mjs";
import { excel98 } from "./excel98.mjs";
import { getDetail, summarize, findBySubject, downloadAttachment, kapLink, ymd } from "./kap.mjs";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const store = () => getStore({ name: "kap-mail", consistency: "strong" });
export async function getState() { try { return (await store().get("state.json", { type: "json" })) || {}; } catch { return {}; } }
async function setState(s) { try { await store().setJSON("state.json", s); } catch {} }
export async function getPreview() { try { return await store().get("preview.html"); } catch { return null; } }

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAX_BYTES = 18 * 1024 * 1024; // Gmail 25 MB sınırının altında kal

// "15.10.2026 17:45:12" (İstanbul) → Date
function trDate(s) {
  const t = String(s || "");
  let m = t.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 3, +m[5] || 0, +m[6] || 0));
  m = t.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
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
  const files = d.files.map(f => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:4px 10px;background:#F3F5F4;border:1px solid #E1E6E5;border-radius:6px;font-size:12px;color:#16233A">📎 ${esc(f.filename)}</span>`).join("")
    || `<span style="font-size:12px;color:#7A1F2B">Ek indirilemedi — KAP linkinden ulaşabilirsiniz.</span>`;
  const body = !d.recCount && d.bodyText ? `<div style="font-size:13px;line-height:1.5;white-space:pre-wrap;margin:0 0 10px;color:#3D4A5E">${esc(d.bodyText.slice(0, 600))}${d.bodyText.length > 600 ? "…" : ""}</div>` : "";
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;background:#fff;border:1px solid #DDE3E2;border-radius:10px;margin:0 0 16px">
    <tr><td style="padding:16px 18px 6px">
      <div style="font-size:15px;font-weight:700;color:#16233A">${esc(d.title || "Rehber 9.8 açıklaması")}</div>
      <div style="font-size:12px;color:#5B6678;margin-top:3px">${esc(d.company || "")} · ${esc(trTime(d.pub) || d.publishDate)} · <a href="${kapLink(d.idx)}" style="color:#7A1F2B;text-decoration:none;font-weight:600">KAP'ta aç →</a></div>
    </td></tr>
    <tr><td style="padding:6px 18px 4px">${body}${d.previews}</td></tr>
    <tr><td style="padding:8px 18px 16px">${files}</td></tr>
  </table>`;
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
    // 2) Tarama aralığı: son başarılı çalışmadan 1 gün öncesinden bugüne (en az LOOKBACK_DAYS gün).
    //    Daha önce gönderilenler sentIdx ile ayıklanır; böylece geç düşen bildirim kaçmaz.
    const lookback = Number(env("LOOKBACK_DAYS", "3"));
    const base = state.lastOkAt ? new Date(Math.min(new Date(state.lastOkAt).getTime() - 864e5, now - lookback * 864e5)) : new Date(now - lookback * 864e5);
    const since = new Date(Math.max(base.getTime(), now - 10 * 864e5));
    const days = [];
    for (let d = since; ymd(d) <= ymd(now); d = new Date(d.getTime() + 864e5)) days.push(ymd(d));
    if (!days.includes(ymd(now))) days.push(ymd(now));
    L(`Taranan günler: ${days.join(", ")}`);

    const sent = new Set(force ? [] : (state.sentIdx || []));
    const { idxs: allIdx, errors } = await findBySubject({ subjectMatch, days, log: L });
    delete state.titleCache; delete state.subjectOid; delete state.subjectOidTried; delete state.checked; delete state.signature;
    // "Şimdi gönder" (force) penceredeki tüm eşleşenleri gönderir; sabah işi sadece daha önce gönderilmemişleri
    const idxs = allIdx.filter(i => !sent.has(i));
    L(`Eşleşen ${allIdx.length} bildirim, gönderilecek ${idxs.length}${errors ? `, ${errors} KAP hatası` : ""}`);

    // 3) Detaylar ve ekler
    const items = [], attachments = [];
    let total = 0;
    for (const idx of idxs) {
      try {
        const d = summarize(idx, await getDetail(idx));
        d.pub = trDate(d.publishDate);
        d.files = []; d.previews = "";
        for (const a of d.attachments.slice(0, 8)) {
          try {
            const content = await downloadAttachment(a);
            const filename = `${d.fundCode && !/[, ]/.test(d.fundCode) ? d.fundCode + "_" : ""}${a.fileName}`.replace(/[\\/:*?"<>|]/g, "_");
            const extra = [];
            const isPdf = a.ext === "pdf" || content.subarray(0, 5).toString() === "%PDF-";
            if (/^xlsx?$/.test(a.ext)) d.previews += sheetPreview(content);
            else if (isPdf) {
              let recs = [];
              try { recs = await parse98(content); } catch (e) { L(`${idx}: 9.8 tablosu okunamadı (${e.message})`); }
              if (recs.length) {
                d.previews += render98(recs);
                d.recCount = (d.recCount || 0) + recs.length;
                L(`${idx} / ${a.fileName}: ${recs.length} fon satırı okundu`);
                try {
                  const xbuf = await excel98(recs, { kapIdx: idx, kapLink: kapLink(idx), publish: d.publishDate });
                  extra.push({ filename: filename.replace(/\.pdf$/i, "") + ".xlsx", content: xbuf });
                } catch (e) { L(`${idx}: Excel oluşturulamadı (${e.message})`); }
              } else {
                const pv = await pdfPreview(content);
                d.previews += pv.html || (pv.note ? `<div style="font-size:12px;color:#8A5A00">${esc(pv.note)}</div>` : "");
                L(`${idx} / ${a.fileName}: PDF ${Math.round(content.length / 1024)} KB, ${pv.html ? "içerik maile eklendi" : pv.note}`);
              }
            }
            if (total + content.length > MAX_BYTES) { L(`${filename}: boyut sınırı, mailde sadece link`); continue; }
            for (const f of [{ filename, content }, ...extra]) {
              if (total + f.content.length > MAX_BYTES) { L(`${f.filename}: boyut sınırı, eklenmedi`); continue; }
              total += f.content.length;
              d.files.push(f);
              attachments.push(f);
            }
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
    const total98 = items.reduce((t, d) => t + (d.recCount || 0), 0);
    const html = `<div style="background:#EDF0EF;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#16233A">
      <table cellspacing="0" cellpadding="0" style="max-width:820px;width:100%;margin:0 auto;border-collapse:collapse">
        <tr><td style="background:#16233A;border-radius:10px 10px 0 0;padding:18px 20px">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#AFC0D3">KAP · Günlük takip · ${esc(trDay(now))}</div>
          <div style="font-size:20px;font-weight:700;color:#FFFFFF;margin-top:4px">Rehber 9.8 açıklamaları</div>
          <div style="font-size:13px;color:#D5DEE8;margin-top:4px">${items.length ? `${items.length} yeni bildirim${total98 ? ` · ${total98} fon satırı` : ""}` : "Yeni bildirim yok"}</div>
        </td></tr>
        <tr><td style="padding:16px 0 0">
          ${errors ? `<div style="background:#FBF0DA;color:#8A5A00;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px">KAP'a erişirken ${errors} hata oluştu; liste eksik olabilir. Eksikler bir sonraki gönderimde gelir.</div>` : ""}
          ${items.length ? items.map(card).join("") : `<div style="background:#fff;border:1px solid #DDE3E2;border-radius:10px;padding:16px;font-size:14px">Son gönderimden bu yana bu başlıkta yeni bildirim yayımlanmadı.</div>`}
          <div style="font-size:11px;color:#7A8697;margin-top:6px">Kaynak: KAP (kap.org.tr). Tablo ekteki PDF'ten otomatik okunmuştur; esas belge ekteki dosyadır.</div>
        </td></tr>
      </table></div>`;

    report.bildirimler = items.map(d => ({ idx: d.idx, fon: d.fundCode, sirket: d.company, yayin: d.publishDate, ekler: d.files.map(f => f.filename), link: kapLink(d.idx) }));
    const newState = { ...state, lastRunAt: now.toISOString(), ...(errors ? {} : { lastOkAt: now.toISOString() }),
      sentIdx: [...new Set([...(state.sentIdx || []), ...items.map(d => d.idx)])].slice(-1000) };

    if (dryRun) {
      report.sonuc = "deneme";
      report.mail = { kime: recipients, konu: subject, ekSayisi: attachments.length, boyutKB: Math.round(total / 1024) };
      report.onizlemeHtml = html.length > 200000 ? html.slice(0, 200000) : html;
      try { await store().set("preview.html", report.onizlemeHtml); } catch {}
      await setState({ ...state, lastTest: { ...report, onizlemeHtml: undefined } });
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
    await setState(dryRun ? { ...state, lastTest: report } : { ...state, lastRun: report });
    return report;
  }
}
