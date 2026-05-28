const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const dec = new TextDecoder();

// In-memory only — never persisted
let masterKey = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault(vaultArr) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    enc.encode(JSON.stringify(vaultArr))
  );
  const { salt } = await chrome.storage.local.get("salt");
  await chrome.storage.local.set({
    cipher: b64(ct),
    iv: b64(iv),
    salt, // unchanged
  });
}

async function decryptVault() {
  const { cipher, iv } = await chrome.storage.local.get(["cipher", "iv"]);
  if (!cipher) return [];
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    masterKey,
    unb64(cipher)
  );
  return JSON.parse(dec.decode(pt));
}

async function loadVault() { return decryptVault(); }
async function saveVault(v) { return encryptVault(v); }

async function init() {
  const { salt, cipher } = await chrome.storage.local.get(["salt", "cipher"]);
  if (!salt) {
    show("setup");
  } else {
    show("unlock");
    $("#u-pass").focus();
  }
}

function show(which) {
  $("#setup").style.display = which === "setup" ? "block" : "none";
  $("#unlock").style.display = which === "unlock" ? "block" : "none";
  $("#app").style.display = which === "app" ? "block" : "none";
  $("#lock-btn").style.display = which === "app" ? "inline-block" : "none";
}

$("#s-create").onclick = async () => {
  const p1 = $("#s-pass").value;
  const p2 = $("#s-pass2").value;
  const err = $("#s-error");
  err.textContent = "";
  if (p1.length < 8) { err.textContent = "Password must be at least 8 characters."; return; }
  if (p1 !== p2) { err.textContent = "Passwords do not match."; return; }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ salt: b64(salt) });
  masterKey = await deriveKey(p1, salt);
  await encryptVault([]);
  $("#s-pass").value = ""; $("#s-pass2").value = "";
  show("app");
  render();
};

$("#u-unlock").onclick = async () => {
  const pass = $("#u-pass").value;
  const err = $("#u-error");
  err.textContent = "";
  const { salt } = await chrome.storage.local.get("salt");
  try {
    masterKey = await deriveKey(pass, unb64(salt));
    await decryptVault(); // throws if wrong key
    $("#u-pass").value = "";
    show("app");
    render();
  } catch {
    masterKey = null;
    err.textContent = "Incorrect master password.";
  }
};

$("#u-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#u-unlock").click(); });
$("#s-pass2").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#s-create").click(); });

$("#lock-btn").onclick = () => {
  masterKey = null;
  show("unlock");
  $("#u-pass").focus();
};

async function render() {
  const tab = await getActiveTab();
  const host = hostOf(tab?.url || "");
  $("#site").textContent = host ? `Current site: ${host}` : "No active site";
  $("#f-site").value = host || "";

  const vault = await loadVault();
  const list = $("#list");
  list.innerHTML = "";

  const matching = vault.filter(c => host && (c.site === host || host.endsWith("." + c.site) || c.site.endsWith("." + host)));
  const others = vault.filter(c => !matching.includes(c));
  const ordered = [...matching, ...others];

  if (!ordered.length) {
    list.innerHTML = '<div class="empty">No credentials saved yet</div>';
    return;
  }

  ordered.forEach((c) => {
    const idx = vault.indexOf(c);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="top">
        <div>
          <div class="user">${escapeHtml(c.username)}</div>
          <div class="host">${escapeHtml(c.site)}</div>
        </div>
      </div>
      <div class="pw" data-pw style="display:none">${escapeHtml(c.password)}</div>
      <div class="actions">
        <button class="ghost" data-act="fill">Autofill</button>
        <button class="ghost" data-act="reveal">Reveal</button>
        <button class="ghost" data-act="copy">Copy</button>
        <button class="danger" data-act="del">Delete</button>
      </div>
    `;
    el.querySelector('[data-act="fill"]').onclick = () => autofill(c);
    el.querySelector('[data-act="reveal"]').onclick = (e) => {
      const pw = el.querySelector("[data-pw]");
      const shown = pw.style.display !== "none";
      pw.style.display = shown ? "none" : "block";
      e.target.textContent = shown ? "Reveal" : "Hide";
    };
    el.querySelector('[data-act="copy"]').onclick = () => navigator.clipboard.writeText(c.password);
    el.querySelector('[data-act="del"]').onclick = async () => {
      const v = await loadVault();
      v.splice(idx, 1);
      await saveVault(v);
      render();
    };
    list.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function autofill(c) {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (username, password) => {
      const userSel = 'input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="email" i], input[autocomplete="username"], input[type="text"][id*="user" i], input[type="text"][id*="email" i]';
      const passSel = 'input[type="password"]';
      const u = document.querySelector(userSel);
      const p = document.querySelector(passSel);
      const set = (el, val) => {
        if (!el) return;
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter ? setter.call(el, val) : (el.value = val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set(u, username);
      set(p, password);
    },
    args: [c.username, c.password],
  });
  window.close();
}

$("#f-reveal").onclick = () => {
  const f = $("#f-pass");
  const shown = f.type === "text";
  f.type = shown ? "password" : "text";
  $("#f-reveal").textContent = shown ? "Show" : "Hide";
};

$("#f-save").onclick = async () => {
  const site = $("#f-site").value.trim();
  const username = $("#f-user").value.trim();
  const password = $("#f-pass").value;
  if (!site || !username || !password) return;
  const vault = await loadVault();
  vault.push({ site: site.replace(/^www\./, ""), username, password });
  await saveVault(vault);
  $("#f-user").value = "";
  $("#f-pass").value = "";
  render();
};

init();
