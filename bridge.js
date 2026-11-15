/* Site Ledger mobile — runtime bridge.
   The app was written for the Claude artifact runtime (window.claude.use). This file provides the same
   calls on top of Firebase so the same app runs as an installable web app (PWA) and inside the
   Android / iOS shell (Capacitor):
     db        -> Cloud Firestore (offline cache on, works without network and syncs later)
     user      -> Firebase Authentication (email + password), team access list in config/team
     assets    -> photos and files stored in Firestore (chunked) — no paid Storage bucket needed
     downloads -> browser download, or the phone's share sheet inside the Android / iOS app
     sample    -> not available outside Claude (AI features are hidden by the app) */
(function () {
  "use strict";
  const VERSION = "1.0.0";
  const CFG_KEY = "sl.firebaseConfig";
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  /* ---------- small UI kit for the setup / login screens ---------- */
  const css = `
  .slb-ov{position:fixed;inset:0;z-index:2147483000;background:#F3F5F8;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#142033;overflow:auto}
  .slb-card{background:#fff;border:1px solid #DBE0E8;border-radius:12px;max-width:420px;width:100%;padding:22px 20px;box-shadow:0 8px 30px rgba(20,32,51,.08)}
  .slb-card h1{font-size:21px;margin:0 0 4px}.slb-card p{margin:0 0 12px;color:#4B576A;font-size:14px}
  .slb-card label{display:block;font-size:12.5px;font-weight:600;color:#4B576A;margin:10px 0 4px}
  .slb-card input,.slb-card textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 11px;border:1px solid #C9D0DB;border-radius:8px;background:#fff;color:#142033}
  .slb-card textarea{min-height:150px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
  .slb-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.slb-row button{flex:1}
  .slb-btn{font:inherit;font-weight:600;border-radius:8px;padding:11px 14px;border:1px solid #C9D0DB;background:#fff;color:#142033;cursor:pointer;min-height:44px}
  .slb-btn.pri{background:#2A43C2;border-color:#2A43C2;color:#fff}.slb-btn:disabled{opacity:.6}
  .slb-link{background:none;border:0;color:#2A43C2;font:inherit;font-size:13.5px;padding:6px 0;cursor:pointer}
  .slb-msg{font-size:13px;margin-top:10px;min-height:18px}.slb-msg.err{color:#C2413A}.slb-msg.ok{color:#1E7A4C}
  .slb-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#2A43C2;margin-bottom:12px}
  .slb-brand i{width:12px;height:16px;border-left:3px solid #C2413A;background:repeating-linear-gradient(#fff 0 3px,#DBE0E8 3px 4px)}
  .slb-acc{margin-left:4px}
  .slb-menu{position:fixed;inset:0;z-index:2147483001;background:rgba(14,19,27,.45);display:flex;align-items:flex-end;justify-content:center}
  .slb-sheet{background:#fff;color:#142033;width:100%;max-width:480px;border-radius:14px 14px 0 0;padding:16px 16px max(16px,env(safe-area-inset-bottom));font:15px/1.45 system-ui,-apple-system,sans-serif}
  .slb-sheet h3{margin:0 0 2px;font-size:17px}.slb-sheet .sub{color:#7A8597;font-size:13px;margin-bottom:10px;word-break:break-all}
  .slb-sheet button.it{display:block;width:100%;text-align:left;font:inherit;padding:12px 4px;border:0;border-top:1px solid #EBEEF3;background:none;color:inherit;cursor:pointer}
  @media (prefers-color-scheme: dark){.slb-ov{background:#0E131B;color:#E5EAF2}.slb-card,.slb-sheet{background:#151C27;color:#E5EAF2;border-color:#2A3445}.slb-card input,.slb-card textarea{background:#1B2431;color:#E5EAF2;border-color:#2A3445}.slb-btn{background:#1B2431;color:#E5EAF2;border-color:#2A3445}.slb-card p{color:#A2ADBD}.slb-sheet button.it{border-color:#2A3445}}`;
  const st = document.createElement("style"); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  const h = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function screen(html) { const old = document.querySelector(".slb-ov"); if (old) old.remove(); const el = h(`<div class="slb-ov" role="dialog" aria-modal="true"><div class="slb-card"><div class="slb-brand"><i></i>Site Ledger</div>${html}</div></div>`); (document.body || document.documentElement).appendChild(el); return el; }
  const closeScreen = () => document.querySelector(".slb-ov")?.remove();
  const whenBody = () => new Promise((r) => (document.body ? r() : document.addEventListener("DOMContentLoaded", r, { once: true })));

  /* ---------- Firebase project settings (from firebase-config.js, or pasted once on this device) ---------- */
  function parseConfig(text) {
    const t = String(text || "").replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'").replace(/\u00A0/g, " ");
    try { const j = JSON.parse(t); if (j && j.apiKey && j.projectId) return j; } catch {}
    const o = {}; ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"].forEach((k) => { const m = t.match(new RegExp("[\"']?" + k + "[\"']?\\s*:\\s*[\"'`]([^\"'`]+)[\"'`]")); if (m) o[k] = m[1]; });
    return o.apiKey && o.projectId ? o : null;
  }
  function savedConfig() {
    const f = window.FIREBASE_CONFIG; if (f && f.apiKey && f.projectId && !/PASTE|YOUR_/i.test(f.apiKey)) return f;
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch { return null; }
  }
  async function askConfig() {
    await whenBody();
    return new Promise((res) => {
      const el = screen(`<h1>Connect your Firebase project</h1><p>One-time setup on this phone. In Firebase console → Project settings → Your apps → Web app, copy the <b>firebaseConfig</b> block and paste it here.</p>
        <label for="slb-cfg">firebaseConfig</label><textarea id="slb-cfg" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder='const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "….firebaseapp.com",\n  projectId: "…",\n  …\n};'></textarea>
        <div class="slb-row"><button class="slb-btn pri" id="slb-go">Save and continue</button></div><div class="slb-msg" id="slb-m"></div>`);
      el.querySelector("#slb-go").onclick = () => { const c = parseConfig(el.querySelector("#slb-cfg").value); if (!c) { el.querySelector("#slb-m").className = "slb-msg err"; el.querySelector("#slb-m").textContent = "Couldn't read apiKey and projectId — paste the whole firebaseConfig block."; return; } localStorage.setItem(CFG_KEY, JSON.stringify(c)); closeScreen(); res(c); };
    });
  }

  /* ---------- sign in ---------- */
  const errText = (e) => { const c = (e && e.code) || ""; return ({ "auth/invalid-credential": "Email or password is wrong.", "auth/wrong-password": "Email or password is wrong.", "auth/user-not-found": "No account with this email — choose Create account.", "auth/email-already-in-use": "An account with this email already exists — sign in instead.", "auth/weak-password": "Password must be at least 6 characters.", "auth/invalid-email": "Enter a valid email address.", "auth/network-request-failed": "No internet connection. Connect once to sign in; after that the app works offline.", "auth/too-many-requests": "Too many tries — wait a minute and try again." })[c] || (e && e.message) || String(e); };
  async function askLogin(auth) {
    await whenBody();
    return new Promise((res) => {
      let mode = "in";
      const el = screen(`<h1 id="slb-t">Sign in</h1><p id="slb-s">Use the email and password of your Site Ledger account.</p>
        <label for="slb-e">Email</label><input id="slb-e" type="email" autocomplete="username" inputmode="email">
        <label for="slb-p">Password</label><input id="slb-p" type="password" autocomplete="current-password">
        <div class="slb-row"><button class="slb-btn pri" id="slb-go">Sign in</button></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px"><button class="slb-link" id="slb-sw">Create account</button><button class="slb-link" id="slb-fp">Forgot password</button></div>
        <div class="slb-msg" id="slb-m"></div>`);
      const $ = (s) => el.querySelector(s), msg = (t, k) => { $("#slb-m").className = "slb-msg " + (k || ""); $("#slb-m").textContent = t || ""; };
      $("#slb-sw").onclick = () => { mode = mode === "in" ? "up" : "in"; $("#slb-t").textContent = mode === "in" ? "Sign in" : "Create account"; $("#slb-go").textContent = mode === "in" ? "Sign in" : "Create account"; $("#slb-sw").textContent = mode === "in" ? "Create account" : "I have an account"; $("#slb-s").textContent = mode === "in" ? "Use the email and password of your Site Ledger account." : "The first account becomes the owner; others need the owner to add their email."; msg(""); };
      $("#slb-fp").onclick = async () => { const e = $("#slb-e").value.trim(); if (!e) return msg("Enter your email first.", "err"); try { await auth.sendPasswordResetEmail(e); msg("Password reset link sent to " + e, "ok"); } catch (x) { msg(errText(x), "err"); } };
      const go = async () => { const e = $("#slb-e").value.trim(), p = $("#slb-p").value; if (!e || !p) return msg("Enter email and password.", "err"); $("#slb-go").disabled = true; msg(mode === "in" ? "Signing in…" : "Creating account…");
        try { const r = mode === "in" ? await auth.signInWithEmailAndPassword(e, p) : await auth.createUserWithEmailAndPassword(e, p); closeScreen(); res(r.user); } catch (x) { msg(errText(x), "err"); } finally { $("#slb-go").disabled = false; } };
      $("#slb-go").onclick = go; $("#slb-p").addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
    });
  }

  /* ---------- Firestore with the app's document shapes ---------- */
  // Firestore can't hold an array directly inside an array, nor undefined values or empty keys: encode on write, decode on read.
  const enc = (v) => Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? { __a: enc(x) } : enc(x)))
    : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && k !== "" && typeof x !== "function").map(([k, x]) => [k, enc(x)])) : v;
  const dec = (v) => Array.isArray(v) ? v.map(dec)
    : v && typeof v === "object" && typeof v.toDate !== "function" ? (Object.keys(v).length === 1 && "__a" in v ? dec(v.__a) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])))
    : v && typeof v.toDate === "function" ? v.toDate().toISOString() : v;
  const wrapDocSnap = (d) => ({ id: d.id, exists: typeof d.exists === "function" ? d.exists() : !!d.exists, data: () => { const x = d.data(); return x == null ? undefined : dec(x); }, metadata: d.metadata, ref: d.ref });
  const wrapQuery = (s) => ({ docs: s.docs.map(wrapDocSnap), size: s.size, empty: s.empty, metadata: s.metadata, docChanges: () => s.docChanges().map((c) => ({ type: c.type, doc: wrapDocSnap(c.doc) })), forEach: (fn) => s.docs.map(wrapDocSnap).forEach(fn) });
  // A Firestore write is applied to the local cache at once but its promise waits for the server. On site with no
  // network that would leave the app waiting, so continue as soon as the write is queued and report a later refusal.
  const queued = (p) => { p.catch((e) => { const t = document.getElementById("toast"); if (t) { t.textContent = "Not saved to the server: " + (e && e.code === "permission-denied" ? "no access — ask the owner to add your email" : (e && e.message) || e); t.hidden = false; setTimeout(() => (t.hidden = true), 6000); } });
    return Promise.race([p, new Promise((r) => setTimeout(r, navigator.onLine ? 6000 : 250))]); };
  function wrapDoc(ref) {
    return { id: ref.id, path: ref.path,
      get: async () => wrapDocSnap(await ref.get()),
      set: (d, o) => queued(ref.set(enc(d), o && o.merge ? { merge: true } : undefined)),
      update: (d) => queued(ref.set(enc(d), { merge: true })),
      delete: () => queued(ref.delete()),
      onSnapshot: (fn, err) => ref.onSnapshot((s) => fn(wrapDocSnap(s)), err),
      collection: (p) => wrapCol(ref.collection(p)) };
  }
  function wrapCol(ref) {
    const q = (r) => ({ get: async () => wrapQuery(await r.get()), onSnapshot: (fn, err) => r.onSnapshot({ includeMetadataChanges: false }, (s) => fn(wrapQuery(s)), err || (() => {})),
      where: (...a) => q(r.where(...a)), orderBy: (...a) => q(r.orderBy(...a)), limit: (n) => q(r.limit(n)) });
    return { id: ref.id, path: ref.path, doc: (id) => wrapDoc(id ? ref.doc(id) : ref.doc()), ...q(ref) };
  }
  const wrapDb = (fs) => ({ collection: (p) => wrapCol(fs.collection(p)), doc: (p) => wrapDoc(fs.doc(p)) });

  /* ---------- photos & files kept in Firestore (chunked), addressed as fsmedia:<id> ---------- */
  const CHUNK = 700000; // characters of base64 per document (Firestore's limit is ~1 MB per document)
  const blobCache = new Map(), urlCache = new Map();
  const b64of = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  const blobOf = (b64, type) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: type || "application/octet-stream" }); };
  let FS = null, ME = null;
  async function mediaGet(id) {
    if (blobCache.has(id)) return blobCache.get(id);
    const p = (async () => { const m = await FS.doc("media/" + id).get(); if (!m.exists) throw new Error("File not found"); const meta = m.data(); let s = ""; for (let k = 0; k < (meta.n || 1); k++) { const c = await FS.doc(`media/${id}/c/${k}`).get(); s += (c.data() || {}).d || ""; } return blobOf(s, meta.type); })();
    blobCache.set(id, p); p.catch(() => blobCache.delete(id)); return p;
  }
  const mediaUrl = async (id) => { if (!urlCache.has(id)) urlCache.set(id, mediaGet(id).then((b) => URL.createObjectURL(b))); return urlCache.get(id); };
  const assets = {
    async upload(blob) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10), type = blob.type || "application/octet-stream", b64 = await b64of(blob), n = Math.max(1, Math.ceil(b64.length / CHUNK));
      for (let k = 0; k < n; k++) await queued(FS.doc(`media/${id}/c/${k}`).set({ d: b64.slice(k * CHUNK, (k + 1) * CHUNK) }));
      await queued(FS.doc("media/" + id).set({ type, size: blob.size, n, name: blob.name || "", by: ME && ME.email || "", at: new Date().toISOString() }));
      blobCache.set(id, Promise.resolve(blob));
      return { id, url: "fsmedia:" + id, sizeBytes: blob.size, contentType: type };
    },
    async list() { return { assets: [], usage: {} }; },
    async delete(id) { id = String(id).replace(/^fsmedia:/, ""); try { const m = await FS.doc("media/" + id).get(); const n = (m.data() || {}).n || 1; for (let k = 0; k < n; k++) await FS.doc(`media/${id}/c/${k}`).delete(); await FS.doc("media/" + id).delete(); } catch {} blobCache.delete(id); urlCache.delete(id); },
  };
  // fetch("fsmedia:…") is how the app reads a photo into Word / Excel — answer it from Firestore
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => { const u = typeof input === "string" ? input : input && input.url; if (u && u.startsWith("fsmedia:")) return mediaGet(u.slice(8)).then((b) => new Response(b, { headers: { "Content-Type": b.type } })); return nativeFetch(input, init); };
  // <img src="fsmedia:…"> and <a href="fsmedia:…"> in the screens get a local object URL
  function fixNode(n) {
    if (!n || n.nodeType !== 1) return;
    const list = n.matches && n.matches('img[src^="fsmedia:"],a[href^="fsmedia:"]') ? [n] : [];
    n.querySelectorAll && n.querySelectorAll('img[src^="fsmedia:"],a[href^="fsmedia:"]').forEach((x) => list.push(x));
    list.forEach((el) => { const attr = el.tagName === "IMG" ? "src" : "href", id = el.getAttribute(attr).slice(8); el.setAttribute("data-fsm", id); if (attr === "src") el.removeAttribute("src"); else el.setAttribute("href", "#");
      mediaUrl(id).then((u) => { if (el.getAttribute("data-fsm") === id) el.setAttribute(attr, u); }).catch(() => { if (attr === "src") el.alt = (el.alt || "") + " (not available offline yet)"; }); });
  }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(fixNode))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("click", async (ev) => { const a = ev.target.closest && ev.target.closest("a[data-fsm]"); if (!a || !isNative()) return; ev.preventDefault(); try { const b = await mediaGet(a.getAttribute("data-fsm")); await downloads.save({ filename: a.getAttribute("download") || a.textContent.trim().slice(0, 60) || "file", data: b }); } catch {} }, true);

  /* ---------- downloads: browser download, or the share sheet inside the Android / iOS app ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      if (isNative()) {
        const C = window.Capacitor, FsP = C.Plugins && C.Plugins.Filesystem || C.registerPlugin("Filesystem"), Sh = C.Plugins && C.Plugins.Share || C.registerPlugin("Share");
        const safe = String(filename || "file").replace(/[\\/:*?"<>|]+/g, "-");
        const r = await FsP.writeFile({ path: safe, data: await b64of(blob), directory: "CACHE", recursive: true });
        try { await Sh.share({ title: safe, url: r.uri, dialogTitle: "Save or send " + safe }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
        return;
      }
      const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = filename || "file"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
    },
  };

  /* ---------- team access: config/team {owner, emails[]} ---------- */
  async function teamCheck(fs, user) {
    const em = String(user.email || "").toLowerCase(), ref = fs.doc("config/team");
    let snap; try { snap = await ref.get(); } catch (e) { snap = null; }
    if (snap && !snap.exists) { await ref.set({ owner: em, emails: [em], created: new Date().toISOString() }); return { owner: em, emails: [em] }; }
    const t = snap ? snap.data() : { owner: "", emails: [em] };
    return t;
  }
  async function waitAccess(fs, auth, user, team) {
    await whenBody();
    return new Promise((res) => {
      const el = screen(`<h1>Access pending</h1><p>You are signed in as <b>${esc(user.email)}</b>, but this email is not yet in the team list.</p><p>Ask the owner${team.owner ? ` (<b>${esc(team.owner)}</b>)` : ""} to open Account → Team members and add your email.</p>
        <div class="slb-row"><button class="slb-btn pri" id="slb-r">Check again</button><button class="slb-btn" id="slb-o">Sign out</button></div><div class="slb-msg" id="slb-m"></div>`);
      el.querySelector("#slb-o").onclick = async () => { await auth.signOut(); location.reload(); };
      el.querySelector("#slb-r").onclick = async () => { try { const t = (await fs.doc("config/team").get()).data() || {}; if ((t.emails || []).includes(String(user.email).toLowerCase())) { closeScreen(); res(t); } else { el.querySelector("#slb-m").className = "slb-msg err"; el.querySelector("#slb-m").textContent = "Not added yet."; } } catch (e) { el.querySelector("#slb-m").textContent = String(e.message || e); } };
    });
  }

  /* ---------- start ---------- */
  let TEAM = null, AUTH = null;
  const ready = (async () => {
    if (!window.firebase) throw new Error("Firebase libraries missing");
    let cfg = savedConfig(); if (!cfg) cfg = await askConfig();
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    const fs = firebase.firestore();
    try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch {}
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* another tab or unsupported — online only */ }
    const auth = firebase.auth(); AUTH = auth;
    try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch {}
    let user = await new Promise((r) => { const un = auth.onAuthStateChanged((u) => { un(); r(u); }); });
    if (!user) user = await askLogin(auth);
    FS = fs; ME = user;
    let team = await teamCheck(fs, user);
    if (!(team.emails || []).includes(String(user.email || "").toLowerCase())) team = await waitAccess(fs, auth, user, team);
    TEAM = team;
    whenBody().then(addAccountButton);
    return { fs, auth, user, app };
  })();
  ready.catch(async (e) => { await whenBody(); screen(`<h1>Couldn't start</h1><p>${esc(e && e.message || e)}</p><div class="slb-row"><button class="slb-btn pri" onclick="location.reload()">Try again</button><button class="slb-btn" id="slb-reset">Change Firebase project</button></div>`).querySelector("#slb-reset").onclick = () => { localStorage.removeItem(CFG_KEY); location.reload(); }; });

  /* ---------- account menu (sign out, team members, Firebase project) ---------- */
  function addAccountButton() {
    if (document.querySelector(".slb-acc")) return;
    const host = document.querySelector(".top .proj") || document.querySelector(".top .wrap");
    const b = h(`<button class="btn sm slb-acc" type="button" title="Account">👤</button>`); b.onclick = openMenu;
    if (host) host.appendChild(b); else { b.style.cssText = "position:fixed;top:8px;right:8px;z-index:50"; document.body.appendChild(b); }
  }
  function openMenu() {
    const own = TEAM && TEAM.owner === String(ME.email || "").toLowerCase();
    const m = h(`<div class="slb-menu"><div class="slb-sheet"><h3>${esc(ME.email)}</h3><div class="sub">${own ? "Owner" : "Team member"} · Firebase project ${esc(firebase.app().options.projectId)} · app ${VERSION}${navigator.onLine ? "" : " · offline — entries will sync when online"}</div>
      ${own ? `<button class="it" data-a="team">Team members (who can open this ledger)</button>` : ""}
      <button class="it" data-a="bk">Backup / restore all data (All projects)</button>
      <button class="it" data-a="out">Sign out</button>
      <button class="it" data-a="cfg">Change Firebase project on this device</button>
      <button class="it" data-a="x">Close</button></div></div>`);
    m.onclick = async (ev) => { const a = ev.target.dataset && ev.target.dataset.a; if (ev.target === m || a === "x") return m.remove();
      if (a === "out") { await AUTH.signOut(); location.reload(); }
      if (a === "cfg") { localStorage.removeItem(CFG_KEY); await AUTH.signOut().catch(() => {}); location.reload(); }
      if (a === "bk") { m.remove(); location.hash = "portfolio"; }
      if (a === "team") { m.remove(); openTeam(); } };
    document.body.appendChild(m);
  }
  function openTeam() {
    const el = screen(`<h1>Team members</h1><p>Emails that can open and edit this ledger — one per line. Each person creates an account with that email on the sign-in screen.</p>
      <label for="slb-tm">Emails</label><textarea id="slb-tm" style="min-height:140px;font-family:inherit;font-size:15px">${esc((TEAM.emails || []).join("\n"))}</textarea>
      <div class="slb-row"><button class="slb-btn pri" id="slb-sv">Save</button><button class="slb-btn" id="slb-cl">Close</button></div><div class="slb-msg" id="slb-m"></div>`);
    el.querySelector("#slb-cl").onclick = closeScreen;
    el.querySelector("#slb-sv").onclick = async () => { const L = [...new Set(el.querySelector("#slb-tm").value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /@/.test(x)))]; if (!L.includes(TEAM.owner)) L.unshift(TEAM.owner);
      try { await FS.doc("config/team").set({ ...TEAM, emails: L }); TEAM = { ...TEAM, emails: L }; el.querySelector("#slb-m").className = "slb-msg ok"; el.querySelector("#slb-m").textContent = "Saved — " + L.length + " people."; } catch (e) { el.querySelector("#slb-m").className = "slb-msg err"; el.querySelector("#slb-m").textContent = String(e.message || e); } };
  }

  /* ---------- the runtime the app asks for ---------- */
  window.claude = {
    use: async (name) => {
      if (name === "sample" || name === "comments" || name === "room" || name === "mcp") return null;
      const R = await ready;
      if (name === "db") return wrapDb(R.fs);
      if (name === "assets") return assets;
      if (name === "downloads") return downloads;
      if (name === "user") return { can: async () => true, isOwner: () => !!(TEAM && TEAM.owner === String(R.user.email).toLowerCase()), canEdit: () => true, id: async () => R.user.uid, me: async () => ({ id: R.user.uid, name: R.user.email || "" }), profiles: async (ids) => Object.fromEntries((ids || []).map((i) => [i, { name: i === R.user.uid ? R.user.email : "" }])) };
      return null;
    },
  };

  /* ---------- installable web app (not inside the Android / iOS shell) ---------- */
  if (!isNative() && "serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
