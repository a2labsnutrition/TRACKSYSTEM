/**
 * Fonte do script de tracking servido em /t.js.
 * Uso:  <script src="https://SEU-APP/t.js" data-site="SITE_ID" async></script>
 *
 * Atributos opcionais no <script>:
 *  data-pixel="123"            Pixel ID (se vazio, usa o configurado no painel)
 *  data-checkout=".btn,.cta"   seletores CSS extras de botões de checkout
 *  data-id-param="sck"         parâmetro que leva o ID da sessão para o checkout
 *  data-consent="required"     só rastreia após consentimento (LGPD)
 *  data-banner="1"             mostra um aviso simples de cookies
 *  data-viewcontent="load"     dispara ViewContent ao carregar (padrão: engajado)
 *
 * Na URL da página:  ?cc_debug=1 (log no console)  ·  ?cc_pick=1 (modo clicar para marcar)
 *
 * Escrito em JS compatível com navegadores antigos e sem dependências.
 */
export const TRACKER_VERSION = "1.0.0";

export function trackerSource(endpoint: string): string {
  return `/*! Central de Comando — tracker v${TRACKER_VERSION} */
(function(){
"use strict";
if (window.__ccTracker) { if (window.console) console.warn("[CentralTracker] script incluído mais de uma vez — remova a cópia extra."); return; }
var S = document.currentScript || document.querySelector('script[data-site][src*="/t.js"]');
if (!S) return;
var SITE = S.getAttribute("data-site");
if (!SITE) { if (window.console) console.warn("[CentralTracker] data-site ausente"); return; }
var EP = ${JSON.stringify(endpoint)};
var LS = {};
try { LS = window.localStorage; } catch (e) { LS = null; }
var qs = parseQuery(location.search);
var DEBUG = qs.cc_debug === "1";
var cfg = {
  pixel: S.getAttribute("data-pixel") || null,
  selectors: splitList(S.getAttribute("data-checkout")),
  idParam: S.getAttribute("data-id-param") || "sck",
  consentRequired: S.getAttribute("data-consent") === "required",
  banner: S.getAttribute("data-banner") === "1",
  vc: S.getAttribute("data-viewcontent") || "engaged"
};
var state = { started: false, consent: null, externalPixel: typeof window.fbq === "function", queue: [], vcSent: false, scrollMax: 0, t0: Date.now(), lastClick: 0 };
window.__ccTracker = true;

function log(){ if (DEBUG && window.console) console.log.apply(console, ["[CentralTracker]"].concat([].slice.call(arguments))); }
function splitList(v){ return (v || "").split(",").map(function(x){ return x.trim(); }).filter(Boolean); }
function parseQuery(q){ var o = {}; (q || "").replace(/^\\?/, "").split("&").forEach(function(p){ if(!p) return; var i = p.indexOf("="); var k = decodeURIComponent((i<0?p:p.slice(0,i)).replace(/\\+/g," ")); var v = i<0 ? "" : decodeURIComponent(p.slice(i+1).replace(/\\+/g," ")); o[k] = v; }); return o; }
function rid(n){ var a = ""; var c = "abcdefghijklmnopqrstuvwxyz0123456789"; var r = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(n)) : null; for (var i=0;i<n;i++) a += c.charAt(r ? r[i] % 36 : Math.floor(Math.random()*36)); return a; }
function getCookie(n){ var m = document.cookie.match(new RegExp("(?:^|; )" + n.replace(/[.$?*|{}()\\[\\]\\\\/+^]/g,"\\\\$&") + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; }
function rootDomain(){ var h = location.hostname; if (/^[\\d.]+$/.test(h) || h.indexOf(".") < 0) return h; var p = h.split("."); return p.slice(-2).join("."); }
function setCookie(n, v, days){ var d = new Date(Date.now() + days*864e5).toUTCString(); document.cookie = n + "=" + encodeURIComponent(v) + "; expires=" + d + "; path=/; domain=" + rootDomain() + "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); }
function lsGet(k){ try { return LS ? LS.getItem(k) : null; } catch(e){ return null; } }
function lsSet(k, v){ try { if (LS) LS.setItem(k, v); } catch(e){} }

// ---------------- Consentimento (LGPD) ----------------
function hasConsent(){
  if (!cfg.consentRequired) return true;
  if (state.consent !== null) return state.consent;
  var v = lsGet("_cc_consent");
  return v === "1" ? true : v === "0" ? false : null;
}
function showBanner(){
  if (!cfg.banner || document.getElementById("cc-consent")) return;
  var b = document.createElement("div");
  b.id = "cc-consent";
  b.setAttribute("style","position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483646;background:#111827;color:#f9fafb;padding:12px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 8px 30px rgba(0,0,0,.35)");
  b.innerHTML = '<span style="flex:1;min-width:200px">Usamos cookies para medir anúncios e melhorar sua experiência.</span><button data-a="1" style="background:#22c55e;color:#04150a;border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer">Aceitar</button><button data-a="0" style="background:transparent;color:#d1d5db;border:1px solid #4b5563;border-radius:8px;padding:8px 12px;cursor:pointer">Recusar</button>';
  b.addEventListener("click", function(e){ var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a"); if (a === null || a === undefined) return; api.consent(a === "1"); b.parentNode && b.parentNode.removeChild(b); });
  (document.body || document.documentElement).appendChild(b);
}

// ---------------- Identificadores first-party ----------------
function ids(){
  var vid = getCookie("_cc_vid") || lsGet("_cc_vid");
  if (!vid) vid = "v" + rid(20);
  setCookie("_cc_vid", vid, 365); lsSet("_cc_vid", vid);
  var now = Date.now(), sid = null;
  try { var s = JSON.parse(lsGet("_cc_sess") || "null"); if (s && now - s.t < 30*60*1000) sid = s.id; } catch(e){}
  if (!sid) sid = "s" + rid(22);
  lsSet("_cc_sess", JSON.stringify({ id: sid, t: now }));
  return { vid: vid, sid: sid };
}
function touchSession(){ try { var s = JSON.parse(lsGet("_cc_sess") || "null"); if (s) { s.t = Date.now(); lsSet("_cc_sess", JSON.stringify(s)); } } catch(e){} }

var UTM_KEYS = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"];
function attribution(){
  // Guarda o último toque com parâmetros (7 dias), para não perder UTMs ao navegar entre páginas.
  var stored = {}; try { stored = JSON.parse(lsGet("_cc_attr") || "{}") || {}; } catch(e){}
  var fresh = {}, has = false;
  UTM_KEYS.concat(["fbclid"]).forEach(function(k){ if (qs[k]) { fresh[k] = qs[k]; has = true; } });
  if (has) { fresh._t = Date.now(); lsSet("_cc_attr", JSON.stringify(fresh)); return fresh; }
  if (stored._t && Date.now() - stored._t < 7*864e5) return stored;
  return {};
}
function fbIds(attr){
  var fbp = getCookie("_fbp");
  if (!fbp && !cfg.pixel && !state.externalPixel) { fbp = "fb.1." + Date.now() + "." + Math.floor(Math.random()*1e10); setCookie("_fbp", fbp, 90); }
  var fbc = getCookie("_fbc");
  var clk = qs.fbclid || attr.fbclid;
  if (clk && (!fbc || fbc.split(".").slice(3).join(".") !== clk)) { fbc = "fb.1." + Date.now() + "." + clk; setCookie("_fbc", fbc, 90); }
  return { fbp: fbp || null, fbc: fbc || null };
}
function device(){ var u = navigator.userAgent; return /iPad|Tablet/i.test(u) ? "tablet" : /Mobi|Android|iPhone/i.test(u) ? "mobile" : "desktop"; }

// ---------------- Pixel do Meta ----------------
function loadPixel(){
  if (!cfg.pixel) return;
  if (typeof window.fbq !== "function") {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
  }
  var already = false;
  try { var st = window.fbq.getState && window.fbq.getState(); already = !!(st && st.pixels && st.pixels.some(function(p){ return String(p.id) === String(cfg.pixel); })); } catch(e){}
  if (!already) window.fbq("init", cfg.pixel);
  log("pixel", cfg.pixel, state.externalPixel ? "(fbq já existia na página)" : "(carregado pelo script)");
}
function pixelTrack(name, eventId, props){
  if (!cfg.pixel || typeof window.fbq !== "function") return;
  try { window.fbq("trackSingle", cfg.pixel, name, props || {}, { eventID: eventId }); } catch(e){}
}

// ---------------- Envio ----------------
var ctx = null;
function send(name, props, extra){
  if (!state.started) { state.queue.push([name, props, extra]); return; }
  if (!hasConsent()) return;
  touchSession();
  var eventId = (extra && extra.eventId) || (name.charAt(0).toLowerCase() + rid(16));
  var body = {
    site: SITE, event: name, event_id: eventId, sid: ctx.sid, vid: ctx.vid,
    url: location.href.slice(0, 2000), ref: document.referrer ? document.referrer.slice(0, 2000) : null,
    fbclid: ctx.attr.fbclid || null, fbp: getCookie("_fbp") || ctx.fb.fbp, fbc: getCookie("_fbc") || ctx.fb.fbc,
    device: ctx.device, consent: hasConsent() === true, props: props || {}
  };
  UTM_KEYS.forEach(function(k){ body[k] = ctx.attr[k] || null; });
  if (extra && extra.email) body.email = extra.email;
  if (extra && extra.phone) body.phone = extra.phone;
  if (extra && extra.noCapi) body.props.no_capi = true;
  var payload = JSON.stringify(body);
  log("evento", name, body);
  try {
    // text/plain evita preflight CORS; sendBeacon sobrevive à navegação para o checkout
    var blob = new Blob([payload], { type: "text/plain" });
    if (!(navigator.sendBeacon && navigator.sendBeacon(EP + "/api/collect", blob))) {
      fetch(EP + "/api/collect", { method: "POST", body: payload, keepalive: true, mode: "cors", headers: { "content-type": "text/plain" } });
    }
  } catch(e){}
  return eventId;
}
function std(name, props, extra){
  extra = extra || {};
  var eventId = name.charAt(0).toLowerCase() + rid(16);
  extra.eventId = eventId;
  if (hasConsent()) pixelTrack(name, eventId, props);
  send(name, props, extra);
  return eventId;
}

// ---------------- Checkout: detecção e repasse de parâmetros ----------------
function isCheckoutHref(href){ return /(^|\\.)cakto\\.com\\.br$|(^|\\.)cakto\\.com$/i.test(hostOf(href)) || /pay\\.cakto/i.test(href || ""); }
function hostOf(href){ try { return new URL(href, location.href).hostname; } catch(e){ return ""; } }
function matchesCustom(el){ for (var i=0;i<cfg.selectors.length;i++){ try { if (el.matches(cfg.selectors[i]) || el.closest(cfg.selectors[i])) return true; } catch(e){} } return false; }
function checkoutTarget(el){
  if (!el || !el.closest) return null;
  var t = el.closest('[data-track="checkout"]'); if (t) return t;
  var a = el.closest("a[href]"); if (a && isCheckoutHref(a.getAttribute("href"))) return a;
  var b = el.closest("a,button,[role=button],input[type=submit]"); if (b && matchesCustom(b)) return b;
  return null;
}
function decorate(href){
  try {
    var u = new URL(href, location.href);
    UTM_KEYS.forEach(function(k){ if (ctx.attr[k] && !u.searchParams.get(k)) u.searchParams.set(k, ctx.attr[k]); });
    u.searchParams.set(cfg.idParam, ctx.sid);
    return u.toString();
  } catch(e){ return href; }
}
function decorateAll(){
  if (!ctx) return;
  var links = document.querySelectorAll("a[href]");
  for (var i=0;i<links.length;i++){
    var a = links[i], h = a.getAttribute("href");
    if (h && (isCheckoutHref(h) || a.getAttribute("data-track") === "checkout" || matchesCustom(a))) {
      var d = decorate(h); if (d !== h) a.setAttribute("href", d);
    }
  }
}
function onPointer(e){
  var t = checkoutTarget(e.target);
  if (!t || !ctx) return;
  if (t.tagName === "A" && t.getAttribute("href")) t.setAttribute("href", decorate(t.getAttribute("href")));
  var url = t.getAttribute("data-checkout-url"); if (url) t.setAttribute("data-checkout-url", decorate(url));
}
function onClick(e){
  var t = checkoutTarget(e.target);
  if (!t) return;
  onPointer(e);
  if (Date.now() - state.lastClick < 1000) return;
  state.lastClick = Date.now();
  std("InitiateCheckout", { button_text: (t.innerText || t.value || "").trim().slice(0, 80) });
}

// ---------------- Engajamento ----------------
function onScroll(){
  var h = document.documentElement, b = document.body;
  var max = Math.max(h.scrollHeight, b ? b.scrollHeight : 0) - window.innerHeight;
  var pct = max > 0 ? Math.min(100, Math.round((window.scrollY || h.scrollTop) / max * 100)) : 100;
  if (pct > state.scrollMax) state.scrollMax = pct;
  if (cfg.vc === "engaged" && !state.vcSent && pct >= 50) viewContent();
}
function viewContent(){ if (state.vcSent) return; state.vcSent = true; std("ViewContent", { content_name: document.title.slice(0, 120) }); }
function flushEngagement(){
  if (!state.started || state.flushed) return;
  state.flushed = true;
  send("page_engagement", { scroll_max: state.scrollMax, time_ms: Date.now() - state.t0 });
}

// ---------------- Formulários: identifica lead (e-mail/telefone) ----------------
function onSubmit(e){
  var f = e.target; if (!f || !f.querySelector) return;
  var em = f.querySelector('input[type=email],input[name*="mail"]');
  var ph = f.querySelector('input[type=tel],input[name*="phone"],input[name*="whats"],input[name*="telefone"],input[name*="celular"]');
  var email = em && em.value && em.value.indexOf("@") > 0 ? em.value : null;
  var phone = ph && ph.value ? ph.value : null;
  if (email || phone) std("Lead", {}, { email: email, phone: phone });
}

// ---------------- Modo "clicar para marcar" ----------------
function cssPath(el){
  if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return "#" + el.id;
  var parts = [];
  while (el && el.nodeType === 1 && parts.length < 4 && el !== document.body) {
    var p = el.tagName.toLowerCase();
    var cls = [].slice.call(el.classList || []).filter(function(c){ return /^[A-Za-z][\\w-]{1,30}$/.test(c) && !/^(hover|active|focus)/.test(c); }).slice(0, 2);
    if (cls.length) p += "." + cls.join(".");
    var parent = el.parentElement;
    if (parent) { var same = [].slice.call(parent.children).filter(function(c){ return c.tagName === el.tagName; }); if (same.length > 1) p += ":nth-of-type(" + (same.indexOf(el) + 1) + ")"; }
    parts.unshift(p);
    if (el.id) { parts[0] = "#" + el.id; break; }
    el = parent;
  }
  return parts.join(" > ");
}
function pickerMode(){
  var box = document.createElement("div");
  box.setAttribute("style","position:fixed;pointer-events:none;border:2px solid #4f8cff;background:rgba(79,140,255,.12);z-index:2147483646;border-radius:4px;transition:all .05s");
  var panel = document.createElement("div");
  panel.setAttribute("style","position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:90vw");
  panel.innerHTML = "<b>Modo marcar botão</b> — clique no botão de checkout da sua página.";
  document.body.appendChild(box); document.body.appendChild(panel);
  document.addEventListener("mousemove", function(e){ var r = e.target.getBoundingClientRect(); box.style.top=r.top+"px"; box.style.left=r.left+"px"; box.style.width=r.width+"px"; box.style.height=r.height+"px"; }, true);
  document.addEventListener("click", function(e){
    if (panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target.closest("a,button,[role=button],input[type=submit]") || e.target;
    var sel = cssPath(el);
    panel.innerHTML = '<div><b>Seletor:</b> <code style="background:#1e293b;padding:2px 6px;border-radius:4px">' + sel.replace(/</g,"&lt;") + '</code></div><div style="margin-top:6px;opacity:.8">Copie e cole em Conexões → Script → Botões de checkout.</div>';
    var btn = document.createElement("button"); btn.textContent = "Copiar seletor";
    btn.setAttribute("style","margin-top:8px;background:#4f8cff;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer");
    btn.onclick = function(ev){ ev.stopPropagation(); try { navigator.clipboard.writeText(sel); btn.textContent = "Copiado!"; } catch(x){ prompt("Copie o seletor:", sel); } };
    panel.appendChild(btn);
  }, true);
}

// ---------------- Inicialização ----------------
function start(){
  if (state.started) return;
  if (hasConsent() !== true) { if (cfg.consentRequired) showBanner(); return; }
  var i = ids(), attr = attribution();
  ctx = { vid: i.vid, sid: i.sid, attr: attr, fb: fbIds(attr), device: device() };
  state.started = true;
  loadPixel();
  // Se o Pixel já existia na página (código base do usuário), o PageView do navegador
  // foi disparado sem event_id: não enviamos PageView pela CAPI para não duplicar.
  if (state.externalPixel) send("PageView", {}, { noCapi: true }); else std("PageView", {});
  if (cfg.vc === "load") viewContent(); else setTimeout(viewContent, 15000);
  decorateAll();
  setTimeout(decorateAll, 1500); setTimeout(decorateAll, 4000);
  if (window.MutationObserver) { var mo = new MutationObserver(function(){ clearTimeout(state.mt); state.mt = setTimeout(decorateAll, 300); }); mo.observe(document.documentElement, { childList: true, subtree: true }); }
  var q = state.queue; state.queue = []; q.forEach(function(x){ send(x[0], x[1], x[2]); });
}

var api = {
  version: "${TRACKER_VERSION}",
  track: function(name, props){ return /^[A-Z]/.test(name) ? std(name, props) : send(name, props); },
  identify: function(o){ o = o || {}; return std("Lead", {}, { email: o.email, phone: o.phone }); },
  consent: function(ok){ state.consent = !!ok; lsSet("_cc_consent", ok ? "1" : "0"); if (ok) start(); },
  checkoutUrl: function(url){ return ctx ? decorate(url) : url; },
  sessionId: function(){ return ctx ? ctx.sid : null; }
};
window.CentralTracker = api;

document.addEventListener("click", onClick, true);
document.addEventListener("mousedown", onPointer, true);
document.addEventListener("touchstart", onPointer, { capture: true, passive: true });
document.addEventListener("submit", onSubmit, true);
window.addEventListener("scroll", onScroll, { passive: true });
document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "hidden") flushEngagement(); });
window.addEventListener("pagehide", flushEngagement);

function boot(){
  if (qs.cc_pick === "1") { pickerMode(); return; }
  // Configuração do painel (Pixel, seletores, consentimento). Atributos do <script> têm prioridade.
  var done = false;
  var go = function(){ if (done) return; done = true; start(); };
  setTimeout(go, 1500);
  try {
    fetch(EP + "/api/tracking/config?site=" + encodeURIComponent(SITE), { mode: "cors" }).then(function(r){ return r.ok ? r.json() : null; }).then(function(c){
      if (c) {
        if (!cfg.pixel && c.pixelId) cfg.pixel = c.pixelId;
        if (c.selectors && c.selectors.length) cfg.selectors = cfg.selectors.concat(c.selectors);
        if (!S.getAttribute("data-id-param") && c.idParam) cfg.idParam = c.idParam;
        if (!S.getAttribute("data-consent") && c.consentMode === "required") cfg.consentRequired = true;
      }
      go();
    }).catch(go);
  } catch(e){ go(); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
`;
}
