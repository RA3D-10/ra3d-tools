// ==UserScript==
// @name         ThailandCodes
// @namespace    ra3d.sys
// @version      2.0.0
// @description  Discord quest helper
// @author       ra3d.sys
// @match        https://discord.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.__TC_LOADED__) return;
    window.__TC_LOADED__ = true;
    console.log('[TC] script injected');

    // ─── WEBPACK ─────────────────────────────────────────────────────
    let _wp = null, _token = null, _dispatcher = null, _api = null;

    function findWebpack() {
        if (_wp) return _wp;
        const chunk = window.webpackChunkdiscord_app;
        if (!chunk) return null;
        let found = null;
        try {
            chunk.push([
                [Symbol()], {},
                (m) => {
                    if (!m.c) return;
                    for (const id in m.c) {
                        const ex = m.c[id]?.exports;
                        const cand = ex?.default || ex;
                        if (cand && typeof cand.getToken === 'function') {
                            found = m;
                            return;
                        }
                    }
                },
            ]);
            chunk.pop();
        } catch {}
        if (found) _wp = found;
        return _wp;
    }

    function resolveModules() {
        const wp = findWebpack();
        if (!wp) return false;
        for (const m of Object.values(wp.c)) {
            const ex = m?.exports;
            const cand = ex?.default || ex;
            if (!cand || typeof cand !== 'object') continue;
            if (!_token && typeof cand.getToken === 'function') _token = cand.getToken;
            if (!_dispatcher && cand.__proto__?.flushWaitQueue) _dispatcher = cand;
            if (!_api && (cand.tn?.get || cand.Bo?.get)) _api = cand.tn || cand.Bo;
        }
        return !!(_token && _api);
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

    // ─── API ─────────────────────────────────────────────────────────
    async function apiCall(method, url, body) {
        if (!resolveModules()) throw new Error('modules not ready');
        if (method === 'GET') return (await _api.get({ url }))?.body;
        return (await _api.post({ url, body: body || {} }))?.body;
    }

    async function fetchQuests() {
        const body = await apiCall('GET', '/quests/@me');
        const quests = body?.quests || [];
        if (_dispatcher) {
            _dispatcher.dispatch({
                type: 'QUESTS_FETCH_CURRENT_QUESTS_SUCCESS',
                quests,
                excludedQuests: body?.excluded_quests || [],
                questEnrollmentBlockedUntil: body?.quest_enrollment_blocked_until,
            });
        }
        return quests;
    }

    const enrollQuest = async (id) =>
        !!(await apiCall('POST', `/quests/${id}/enroll`, {
            location: 11, is_targeted: false,
        }))?.enrolled_at;

    const claimQuest = async (id) =>
        !!(await apiCall('POST', `/quests/${id}/claim-reward`, {
            platform: 0, location: 11, is_targeted: false,
        }))?.claimed_at;

    const videoProgress = async (id, ts) =>
        await apiCall('POST', `/quests/${id}/video-progress`, { timestamp: ts });

    const _d = (v, d) => (v && typeof v === 'object' ? v : d);
    const _i = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 ? n : null; };

    const questName = (q) => {
        const c = _d(q?.config, {});
        return _d(c.application, {}).name || _d(c.messages, {}).questName || 'Unknown';
    };

    const rewardLabel = (q) => {
        const rewardsArr = _d(_d(q?.config, {}).rewardsConfig, {}).rewards || [];
        const r = _d(rewardsArr[0], {});
        const m = _d(r.messages, {});
        for (const c of [r.orbQuantity, r.quantity, m.orbQuantity]) {
            const n = _i(c);
            if (n) return `${n} Orbs`;
        }
        const raw = (m.name || m.nameWithArticle || '').trim();
        if (raw) { const x = raw.match(/\d+/); return x ? `${x[0]} Orbs` : raw; }
        return 'Reward';
    };

    const isEnrolled = (q) => !!q?.userStatus?.enrolledAt;
    const isComplete = (q) => !!q?.userStatus?.completedAt;
    const isClaimed  = (q) => !!q?.userStatus?.claimedAt;

    // ─── ENCRYPTED TOKEN ─────────────────────────────────────────────
    async function encryptedToken() {
        const token = await getToken();
        const firstSeg = token.split('.')[0];
        let password;
        try { password = atob(firstSeg); } catch { password = firstSeg; }
        const enc = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
        );
        const cipher = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 }, key, enc.encode(token)
        );
        const out = new Uint8Array(16 + 12 + cipher.byteLength);
        out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(cipher), 28);
        let bin = '';
        for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
        return btoa(bin);
    }

    // ─── TRACKING BLOCKER ────────────────────────────────────────────
    (function blockTracking() {
        const hit = (u) => String(u).includes('/api/v9/science');
        const of = window.fetch;
        window.fetch = function (...a) {
            const u = typeof a[0] === 'string' ? a[0] : a[0]?.url;
            if (hit(u)) return Promise.reject(new TypeError('TC blocked'));
            return of.apply(this, a);
        };
        const oo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u, ...r) {
            if (hit(u)) { this.send = () => {}; this.setRequestHeader = () => {}; return; }
            return oo.call(this, m, u, ...r);
        };
    })();

    // ─── UI ──────────────────────────────────────────────────────────
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
        button{background:#1f222a;border:1px solid transparent;color:#c9cdd4;
            padding:8px 14px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:700;
            letter-spacing:.4px;text-transform:uppercase;font-family:inherit;
            transition:background .12s,color .12s,transform .1s;white-space:nowrap}
        button:hover{background:#262a34;color:#fff}
        button:active{transform:scale(.97)}
        button.ok{color:#57f287}
        button.ok:hover{background:#57f287;color:#0f1115}
        button.warn{color:#fee75c}
        button.warn:hover{background:#fee75c;color:#0f1115}
        button.close{padding:8px 10px;color:#6a6f7a;font-size:14px;
            text-transform:none;letter-spacing:0}
        button.close:hover{background:#ed4245;color:#fff}
        button:disabled{opacity:.4;cursor:wait}
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
        .toast.warn{border-left:3px solid #fee75c}
        .panel{position:fixed;top:72px;left:50%;transform:translateX(-50%);
            z-index:2147483645;width:620px;max-height:70vh;background:#0f1115;
            border:1px solid #1f222a;border-radius:14px;
            box-shadow:0 24px 60px rgba(0,0,0,.6);color:#e6e8ec;
            display:none;flex-direction:column;overflow:hidden}
        .panel.show{display:flex}
        .panel-h{padding:14px 18px;border-bottom:1px solid #1f222a;
            display:flex;align-items:center;justify-content:space-between;
            font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
        .panel-h .stat{color:#6a6f7a;font-weight:600;letter-spacing:.3px}
        .panel-b{padding:12px 16px;overflow-y:auto;
            font-family:'SF Mono',Consolas,Menlo,monospace;font-size:11.5px;line-height:1.7}
        .q{display:grid;grid-template-columns:24px 1fr auto;gap:10px;
            padding:8px 10px;border-radius:8px;align-items:center;transition:background .1s}
        .q:hover{background:#171a21}
        .q .flag{font-size:13px;text-align:center;color:#6a6f7a}
        .q .name{color:#e6e8ec;font-weight:600}
        .q .rew{color:#6a6f7a;font-size:11px;text-align:right}
        .q.done .name{color:#6a6f7a;text-decoration:line-through}
        .q.done .flag{color:#57f287}
        .q.part .flag{color:#fee75c}
        .empty{color:#6a6f7a;text-align:center;padding:30px 0;font-style:italic}
        .dock{position:fixed;top:0;left:50%;transform:translateX(-50%) translateY(-100%);
            z-index:2147483647;background:#5865f2;color:#fff;padding:6px 18px;
            border-radius:0 0 10px 10px;font-size:10px;font-weight:800;
            letter-spacing:.8px;text-transform:uppercase;cursor:pointer;
            transition:transform .3s cubic-bezier(.32,.72,0,1);border:none}
        .dock.show{transform:translateX(-50%) translateY(0)}
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
        console.log('[TC]', msg);
    }

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
        <div class="panel-h">
            <span>ThailandCodes · quests</span>
            <span class="stat" id="stat">—</span>
        </div>
        <div class="panel-b" id="list">
            <div class="empty">press QUEST LIST to load</div>
        </div>`;
    host.appendChild(panel);

    const dock = document.createElement('button');
    dock.className = 'dock';
    dock.textContent = '↑ open ThailandCodes';
    host.appendChild(dock);

    const bar = document.createElement('div');
    bar.className = 'wrap hidden';
    bar.innerHTML = `<div class="brand">Thailand<span class="a">Codes</span><span class="v">v2.0</span></div>`;
    host.appendChild(bar);

    const ACTIONS = [
        ['COPY TOKEN',   '',     actCopyToken],
        ['ENCRYPTED',    '',     actCopyEncrypted],
        ['ENROLL ALL',   'ok',   actEnrollAll],
        ['CLAIM ALL',    'ok',   actClaimAll],
        ['WATCH VIDEOS', 'warn', actWatchVideos],
        ['QUEST LIST',   '',     actQuestList],
    ];
    for (const [label, cls, fn] of ACTIONS) {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.classList.add(cls);
        b.addEventListener('click', async () => {
            if (b.disabled) return;
            b.disabled = true;
            try { await fn(); }
            catch (e) { console.error('[TC]', e); say('✗ ' + (e.message || e), 'err'); }
            b.disabled = false;
        });
        bar.appendChild(b);
    }
    const x = document.createElement('button');
    x.className = 'close';
    x.textContent = '✕';
    x.addEventListener('click', () => {
        bar.classList.add('hidden');
        dock.classList.add('show');
    });
    bar.appendChild(x);
    dock.addEventListener('click', () => {
        bar.classList.remove('hidden');
        dock.classList.remove('show');
    });

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function actCopyToken() {
        const t = await getToken();
        await navigator.clipboard.writeText(t);
        say('✓ token copied', 'ok');
    }

    async function actCopyEncrypted() {
        const e = await encryptedToken();
        await navigator.clipboard.writeText(e);
        say('✓ encrypted token copied', 'ok');
    }

    async function actEnrollAll() {
        say('fetching quests…', 'info');
        const quests = await fetchQuests();
        const targets = quests.filter((q) => !isEnrolled(q) && !isClaimed(q));
        if (!targets.length) return say('nothing to enroll', 'warn');
        let ok = 0, fail = 0;
        for (let i = 0; i < targets.length; i++) {
            const q = targets[i];
            try {
                const success = await enrollQuest(q.id);
                if (success) { ok++; say(`✓ enrolled · ${questName(q)}`, 'ok'); }
                else { fail++; say(`✗ ${questName(q)}`, 'err'); }
            } catch (e) { fail++; say(`✗ ${questName(q)}`, 'err'); }
            if (i < targets.length - 1) await sleep(5000);
        }
        say(`done — ok ${ok} · fail ${fail}`, fail ? 'warn' : 'ok');
    }

    async function actClaimAll() {
        say('fetching quests…', 'info');
        const quests = await fetchQuests();
        const targets = quests.filter((q) => isComplete(q) && !isClaimed(q));
        if (!targets.length) return say('nothing to claim', 'warn');
        let ok = 0, fail = 0;
        for (let i = 0; i < targets.length; i++) {
            const q = targets[i];
            try {
                const success = await claimQuest(q.id);
                if (success) { ok++; say(`✓ claimed · ${questName(q)}`, 'ok'); }
                else { fail++; say(`✗ ${questName(q)}`, 'err'); }
            } catch (e) { fail++; say(`✗ ${questName(q)}`, 'err'); }
            if (i < targets.length - 1) await sleep(2000);
        }
        say(`done — ok ${ok} · fail ${fail}`, fail ? 'warn' : 'ok');
    }

    async function actWatchVideos() {
        say('scanning video quests…', 'info');
        const quests = await fetchQuests();
        const targets = quests.filter((q) => {
            if (isClaimed(q)) return false;
            const t = q?.config?.taskConfigV2?.tasks || {};
            return !!(t.WATCH_VIDEO || t.WATCH_VIDEO_ON_MOBILE);
        });
        if (!targets.length) return say('no video quests', 'warn');
        say(`found ${targets.length} video quest(s)`, 'info');
        for (const q of targets) {
            const name = questName(q);
            if (!isEnrolled(q)) {
                try { await enrollQuest(q.id); say(`✓ enrolled · ${name}`, 'ok'); await sleep(2000); }
                catch (e) { say(`✗ enroll ${name}`, 'err'); continue; }
            }
            const t = q?.config?.taskConfigV2?.tasks || {};
            const vt = t.WATCH_VIDEO || t.WATCH_VIDEO_ON_MOBILE;
            const target = parseInt(vt?.target) || 300;
            say(`▶ watching ${name} (${target}s)`, 'info');
            let cur = 0;
            const STEP = 7;
            while (cur < target) {
                await sleep(1500);
                cur = Math.min(cur + STEP, target);
                try { await videoProgress(q.id, cur + 0.001); } catch {}
            }
            await sleep(1500);
            try {
                await videoProgress(q.id, target + 1);
                const claimed = await claimQuest(q.id);
                say(claimed ? `✓ ${name} done` : `◐ ${name} solved`, claimed ? 'ok' : 'warn');
            } catch (e) { say(`✗ claim ${name}`, 'err'); }
            await sleep(3000);
        }
        say('video batch complete', 'ok');
    }

    async function actQuestList() {
        say('fetching quests…', 'info');
        const quests = await fetchQuests();
        renderList(quests);
        panel.classList.add('show');
    }

    function renderList(quests) {
        const listEl = panel.querySelector('#list');
        const statEl = panel.querySelector('#stat');
        if (!quests.length) {
            listEl.innerHTML = '<div class="empty">no quests</div>';
            statEl.textContent = '0';
            return;
        }
        listEl.innerHTML = quests.map((q) => {
            const name = questName(q), reward = rewardLabel(q);
            let cls = 'open', flag = '○';
            if (isClaimed(q))       { cls = 'done'; flag = '✓'; }
            else if (isComplete(q)) { cls = 'done'; flag = '◆'; }
            else if (isEnrolled(q)) { cls = 'part'; flag = '◐'; }
            return `<div class="q ${cls}">
                <div class="flag">${flag}</div>
                <div class="name">${esc(name)}</div>
                <div class="rew">${esc(reward)}</div>
            </div>`;
        }).join('');
        const open = quests.filter((q) => !isClaimed(q) && !isComplete(q)).length;
        statEl.textContent = `${open} active / ${quests.length}`;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g,
            (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (findWebpack()) {
            clearInterval(timer);
            bar.classList.remove('hidden');
            dock.classList.remove('show');
            try { resolveModules(); } catch {}
            say('tools ready', 'ok');
        } else if (tries > 120) {
            clearInterval(timer);
            bar.classList.remove('hidden');
        }
    }, 500);

})();
