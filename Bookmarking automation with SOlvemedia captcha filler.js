// ==UserScript==
// @name         Multi-Site Social Bookmark Auto Submit (V12.7 — Shared Defaults, Separate Progress)
// @namespace    http://tampermonkey.net/
// @version      12.7
// @description  Shared saved defaults can be loaded on any site; each site keeps independent progress.
// @match        https://bookmarkport.com/*
// @match        https://bookmarkbirth.com/*
// @match        https://bookmark-template.com/*
// @match        https://bookmarkrange.com/*
// @match        https://bookmarkilo.com/*
// @match        https://doctorbookmark.com/*
// @match        https://social4geek.com/*
// @match        https://www.bookmarkport.com/*
// @match        https://www.bookmarkbirth.com/*
// @match        https://www.bookmark-template.com/*
// @match        https://www.bookmarkrange.com/*
// @match        https://www.bookmarkilo.com/*
// @match        https://www.doctorbookmark.com/*
// @match        https://www.social4geek.com/*
// @match        *://bookmarkshq.com/*
// @match        *://bookmarkstumble.com/*
// @match        *://bookmarketmaven.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    /************************************************************
     * BAIL IF INSIDE NESTED SAME-SITE IFRAME
     ************************************************************/
    if (window.self !== window.top) {
        try {
            const refHost = document.referrer ? new URL(document.referrer).hostname.replace("www.", "") : "";
            const ownHost = location.hostname.replace("www.", "");
            if (refHost && refHost === ownHost) return;
        } catch (e) {}
    }

    /************************************************************
     * ⚙️ DATA (loaded from localStorage, with fallback defaults)
     ************************************************************/
    const SITE_HOST = location.hostname.replace(/^www\./i, '').toLowerCase();
    const STATE_PREFIX = `bb_${SITE_HOST}_`;
    const GLOBAL_DEFAULTS_KEY = 'bb_global_defaults_v2';
    const LEGACY_GLOBAL_DEFAULTS_KEY = 'bb_global_defaults_v1';

    const LS_KEYS = {
        URLS: `${STATE_PREFIX}gui_urls`,
        TITLES: `${STATE_PREFIX}gui_titles`,
        DESCS: `${STATE_PREFIX}gui_descs`,
        TAGS: `${STATE_PREFIX}gui_tags`
    };

    const DEFAULT_URLS = [
        "https://example1.com",
        "https://example2.com"
    ];

    const DEFAULT_TITLES = [
        "Example Title1 1 for URL 1",
        "example title 2 of URL 2"
    ];

    const DEFAULT_DESCS = [
        "example desc 1 for URL 1",
        "example desc 2 for URL 2"
       
    ];

    const DEFAULT_TAGS = "Business";

    // Every website gets its own defaults key. www.example.com and example.com
    // are treated as the same site, but different domains never share settings.
    const SITE_DEFAULTS_KEY = `bb_site_defaults_v1_${SITE_HOST}`;

    function readSiteDefaults() {
        try { return GM_getValue(SITE_DEFAULTS_KEY, null); }
        catch (e) { console.warn('[BM] Could not read site defaults:', e); return null; }
    }
    function readGlobalDefaults() {
        try {
            return GM_getValue(GLOBAL_DEFAULTS_KEY, null)
                || GM_getValue(LEGACY_GLOBAL_DEFAULTS_KEY, null)
                || null;
        } catch (e) {
            console.warn('[BM] Could not read shared defaults:', e);
            return null;
        }
    }
    function cleanLines(value, fallback) {
        if (Array.isArray(value)) {
            const arr = value.map(v => String(v).trim()).filter(Boolean);
            return arr.length ? arr : fallback.slice();
        }
        if (typeof value === 'string') {
            const arr = value.split('\n').map(s => s.trim()).filter(Boolean);
            return arr.length ? arr : fallback.slice();
        }
        return fallback.slice();
    }
    function loadLines(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback.slice();
            const arr = raw.split('\n').map(s => s.trim()).filter(Boolean);
            return arr.length ? arr : fallback.slice();
        } catch (e) { return fallback.slice(); }
    }

    const savedSiteDefaults = readSiteDefaults();
    let URLS = savedSiteDefaults
        ? cleanLines(savedSiteDefaults.urls, DEFAULT_URLS)
        : loadLines(LS_KEYS.URLS, DEFAULT_URLS);
    let TITLES = savedSiteDefaults
        ? cleanLines(savedSiteDefaults.titles, DEFAULT_TITLES)
        : loadLines(LS_KEYS.TITLES, DEFAULT_TITLES);
    let DESCRIPTIONS = savedSiteDefaults
        ? cleanLines(savedSiteDefaults.descs, DEFAULT_DESCS)
        : loadLines(LS_KEYS.DESCS, DEFAULT_DESCS);
    let TAGS = savedSiteDefaults && typeof savedSiteDefaults.tags === 'string'
        ? savedSiteDefaults.tags.trim()
        : (localStorage.getItem(LS_KEYS.TAGS) || DEFAULT_TAGS).trim();

    function normalizeDefaults(data) {
        if (!data || typeof data !== 'object') return null;
        const urls = cleanLines(data.urls, []);
        if (!urls.length) return null;
        return {
            urls,
            titles: cleanLines(data.titles, DEFAULT_TITLES),
            descs: cleanLines(data.descs, DEFAULT_DESCS),
            tags: typeof data.tags === 'string' && data.tags.trim() ? data.tags.trim() : DEFAULT_TAGS
        };
    }

    function applyDefaultsToThisSite(data, updateGUI = true, resetThisSiteProgress = false) {
        const normalized = normalizeDefaults(data);
        if (!normalized) return false;
        URLS = normalized.urls;
        TITLES = normalized.titles;
        DESCRIPTIONS = normalized.descs;
        TAGS = normalized.tags;
        localStorage.setItem(LS_KEYS.URLS, URLS.join('\n'));
        localStorage.setItem(LS_KEYS.TITLES, TITLES.join('\n'));
        localStorage.setItem(LS_KEYS.DESCS, DESCRIPTIONS.join('\n'));
        localStorage.setItem(LS_KEYS.TAGS, TAGS);
        try { GM_setValue(SITE_DEFAULTS_KEY, normalized); } catch (e) {}
        if (updateGUI && typeof guiContainer !== 'undefined' && guiContainer) {
            const setText = (id, value) => { const el = guiContainer.querySelector('#' + id); if (el) el.value = value; };
            setText('bm-gui-urls', URLS.join('\n'));
            setText('bm-gui-titles', TITLES.join('\n'));
            setText('bm-gui-descs', DESCRIPTIONS.join('\n'));
            setText('bm-gui-tags', TAGS);
        }
        if (resetThisSiteProgress) { setRunning(false); resetProgress(); }
        return true;
    }

    /************************************************************
     * STATE
     ************************************************************/
    // Progress is namespaced by normalized hostname. Shared defaults never
    // share counters, pending submissions, or running state between sites.
    const K = {
        RUN: `${STATE_PREFIX}run`,
        URL_IDX: `${STATE_PREFIX}uidx`,
        TITLE_IDX: `${STATE_PREFIX}tidx`,
        DESC_IDX: `${STATE_PREFIX}didx`,
        DONE: `${STATE_PREFIX}done`,
        SUBMIT_UNTIL: `${STATE_PREFIX}submit_until`,
        SUBMIT_PENDING: `${STATE_PREFIX}submit_pending`
    };
    const isRunning = () => localStorage.getItem(K.RUN) === "1";
    const setRunning = v => localStorage.setItem(K.RUN, v ? "1" : "0");
    const getNum = (k, f) => { const v = parseInt(localStorage.getItem(k), 10); return Number.isFinite(v) ? v : f; };
    const setNum = (k, v) => localStorage.setItem(k, String(v));

    function nextFromList(key, list) {
        if (!list.length) return "";
        let i = getNum(key, 0);
        if (i >= list.length) i = 0;
        setNum(key, i + 1);
        return list[i];
    }
    function resetProgress() {
        [K.URL_IDX, K.TITLE_IDX, K.DESC_IDX, K.DONE, K.SUBMIT_UNTIL, K.SUBMIT_PENDING].forEach(k => localStorage.removeItem(k));
    }

    function finalizePendingSubmission() {
        if (localStorage.getItem(K.SUBMIT_PENDING) !== "1") return false;
        if (Date.now() < getNum(K.SUBMIT_UNTIL, 0)) return false;

        localStorage.removeItem(K.SUBMIT_PENDING);
        localStorage.removeItem(K.SUBMIT_UNTIL);

        const n = getNum(K.DONE, 0) + 1;
        setNum(K.DONE, n);
        log(`📊 Progress: ${n} / ${URLS.length}`);

        if (n >= URLS.length) {
            log("🎉 All URLs have been attempted. Stopping after the final submission wait.");
            setRunning(false);
        } else if (isRunning() && !isOnSubmitPage()) {
            forceReturnToSubmit();
        }
        return true;
    }

    /************************************************************
     * PAGE CLASSIFICATION
     ************************************************************/
    function isOnSubmitPage() {
        return !!(document.querySelector("#url")
            || document.querySelector("#title")
            || document.querySelector("input[type='submit'][value='Continue']"));
    }
    function isOnStoryPage() {
        return /^\/story/i.test(location.pathname);
    }
    function isOnOtherPage() {
        return !isOnSubmitPage() && !isOnStoryPage();
    }

    /************************************************************
     * AGGRESSIVE RETURN-TO-SUBMIT
     ************************************************************/
    function forceReturnToSubmit() {
        if (!isRunning()) return false;
        // Do not redirect away while the website is processing a submission.
        if (localStorage.getItem(K.SUBMIT_PENDING) === "1" && Date.now() < getNum(K.SUBMIT_UNTIL, 0)) {
            return false;
        }
        const doneCount = getNum(K.DONE, 0);
        if (doneCount >= URLS.length) {
            console.log("[BM] ✅ All URLs submitted — stopping. No more redirects.");
            setRunning(false);
            return false;
        }
        const target = location.origin + "/submit";
        if (location.pathname === "/submit") return false;
        console.log("[BM] 🚀 Forcing redirect:", location.pathname, "→", target);
        try { window.stop(); } catch (e) {}
        try { window.location.replace(target); } catch (e) { window.location.href = target; }
        return true;
    }

    // Immediate redirect on load if running and not on submit
    if (isRunning() && !isOnSubmitPage() && location.pathname !== "/submit") {
        console.log("[BM] story/other page detected at load → immediate redirect");
        forceReturnToSubmit();
    }

    /************************************************************
     * HELPERS
     ************************************************************/
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log = (...a) => console.log("[BM]", ...a);

    function setNativeValue(el, value) {
        if (!el) return;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    function setSelectValue(sel, value) {
        if (!sel) return;
        sel.value = value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function visible(el) {
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
    }

    /************************************************************
     * SELECTORS
     ************************************************************/
    const findDeep = sel => document.querySelector(sel);
    const findUrlField = () => findDeep("#url") || findDeep("input[name='url']");
    const findContinue = () => findDeep("input[type='submit'][value='Continue']") || findDeep("input[type='submit'][value*='Continue' i]");
    const findTitleField = () => findDeep("#title") || findDeep("input[name='title']");
    const findTagsField = () => findDeep("#tags") || findDeep("input[name='tags']");
    const findBodyField = () => findDeep("#bodytext") || findDeep("textarea[name='bodytext']") || findDeep("textarea[name='description']");
    const findCategory = () => findDeep("#category") || findDeep("select[name='category']");

    function findSubmitBtn() {
        let el = document.querySelector("input[tabindex='31']");
        if (el) return el;
        el = document.querySelector("input.btn.btn-primary[type='submit']");
        if (el) return el;
        el = document.querySelector("input[type='submit'][value='Save Changes and Submit']");
        if (el) return el;
        for (const b of document.querySelectorAll("input[type='submit']")) {
            const v = (b.value || "").toLowerCase();
            if (v.includes("save changes") || v.includes("save and submit")) return b;
        }
        return null;
    }

    function findCaptchaInput() {
        const selectors = [
            "#adcopy_response",
            "input[name='adcopy_response']",
            "input[name*='adcopy' i]",
            "input[id*='adcopy' i]",
            "input[id*='captcha' i]",
            "input[name*='captcha' i]"
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        const yourAnswer = [...document.querySelectorAll("label, div, span")]
            .find(n => /your\s+answer/i.test(n.textContent || ""));
        if (yourAnswer) {
            const inp = yourAnswer.parentElement?.querySelector("input[type='text']")
                || yourAnswer.nextElementSibling?.querySelector?.("input[type='text']");
            if (inp) return inp;
        }
        return null;
    }

    /************************************************************
     * PER-PAGE FLAGS
     ************************************************************/
    function pageKey() { return location.hostname + location.pathname; }
    let currentPageKey = pageKey();
    let filled = new Set();
    let submitClicked = false;

    const mark = k => filled.add(currentPageKey + "::" + k);
    const done = k => filled.has(currentPageKey + "::" + k);

    function resetPageFlags() {
        currentPageKey = pageKey();
        filled.clear();
        submitClicked = false;
        log("page flags reset for:", currentPageKey);
    }

    /************************************************************
     * SUBMIT ACTION
     ************************************************************/
    let hrefAtClick = location.href;

    function clickSubmitNow(reason) {
        if (submitClicked || !isRunning()) return;
        const submitBtn = findSubmitBtn();
        if (!submitBtn) return;
        submitClicked = true;
        log(`🎯 Captcha filled [${reason}] — clicking Submit`);
        log("   button:", submitBtn.outerHTML.slice(0, 140));
        try {
            submitBtn.removeAttribute("disabled");
            submitBtn.removeAttribute("aria-disabled");
            submitBtn.disabled = false;
        } catch (e) {}
        try { submitBtn.scrollIntoView({ block: "center" }); } catch (e) {}
        try { submitBtn.focus(); } catch (e) {}
        hrefAtClick = location.href;

        // IMPORTANT: save pending state BEFORE clicking Submit. Some sites
        // navigate immediately after the click; writing this afterward can
        // lose the final item's progress during navigation.
        localStorage.setItem(K.SUBMIT_PENDING, "1");
        setNum(K.SUBMIT_UNTIL, Date.now() + 5000);
        log("⏳ Pending state saved. Waiting 5 seconds for the site to process this submission...");

        try { submitBtn.click(); } catch (e) { log("click err:", e.message); }
        setTimeout(() => {
            if (location.href === hrefAtClick) {
                log("still same page — backup submit");
                try {
                    const form = submitBtn.closest("form");
                    if (form) {
                        if (typeof form.requestSubmit === "function") form.requestSubmit(submitBtn);
                        else form.submit();
                    }
                } catch (e) { log("backup err:", e.message); }
            }
        }, 1500);
    }

    /************************************************************
     * CAPTCHA WATCHERS
     ************************************************************/
    setInterval(() => {
        if (!isRunning() || submitClicked) return;
        if (!isOnSubmitPage()) return;
        const inp = findCaptchaInput();
        if (inp && inp.value && inp.value.trim().length >= 3) clickSubmitNow("poll");
    }, 400);

    function attachInputListeners() {
        const handler = (e) => {
            if (!isRunning() || submitClicked) return;
            const t = e.target;
            if (!t) return;
            const id = (t.id || "").toLowerCase();
            const name = (t.name || "").toLowerCase();
            if ((id.includes("adcopy") || id.includes("captcha") ||
                name.includes("adcopy") || name.includes("captcha")) &&
                t.value && t.value.trim().length >= 3) {
                log("input event on captcha field");
                clickSubmitNow("input-event");
            }
        };
        document.addEventListener("input", handler, true);
    }
    attachInputListeners();

    setInterval(() => {
        if (!isRunning() || submitClicked) return;
        if (!isOnSubmitPage()) return;
        for (const inp of document.querySelectorAll("input")) {
            const id = (inp.id || "").toLowerCase();
            const name = (inp.name || "").toLowerCase();
            if ((id.includes("adcopy") || id.includes("captcha") ||
                name.includes("adcopy") || name.includes("captcha")) &&
                inp.value && inp.value.trim().length >= 3) {
                clickSubmitNow("deep-scan");
                return;
            }
        }
    }, 800);

    /************************************************************
     * FILL LOOP
     ************************************************************/
    let busy = false;

    async function tick() {
        if (!isRunning() || busy) return;
        if (!isOnSubmitPage()) return;
        busy = true;
        try {
            const urlField = findUrlField();
            if (urlField && visible(urlField) && !done("url")) {
                // Use completed-submission count as the URL array index.
                // This avoids URL_IDX drifting out of sync and skipping the
                // final URL when the page redirects/reloads between submissions.
                const completed = Math.max(0, getNum(K.DONE, 0));
                if (completed >= URLS.length) {
                    log(`All ${URLS.length} URLs are already completed; not filling another URL.`);
                    setRunning(false);
                    return;
                }
                const urlIndex = completed; // 0-based: 10 URLs => indices 0..9
                const url = URLS[urlIndex];
                setNum(K.URL_IDX, urlIndex + 1);
                if (url) {
                    setNativeValue(urlField, url);
                    mark("url");
                    log(`filled URL ${urlIndex + 1}/${URLS.length}:`, url);
                    await sleep(600);
                    const cont = findContinue();
                    if (cont && visible(cont)) {
                        log("clicking Continue");
                        cont.click();
                    } else {
                        log("Continue button not found/visible yet; URL remains selected for this submission.");
                    }
                }
            }
            const titleField = findTitleField();
            if (titleField && visible(titleField) && !done("title")) {
                const title = nextFromList(K.TITLE_IDX, TITLES);
                if (title) {
                    setNativeValue(titleField, title);
                    mark("title");
                    log("filled Title:", title);
                }
            }
            const tagsField = findTagsField();
            if (tagsField && visible(tagsField) && !done("tags")) {
                setNativeValue(tagsField, TAGS);
                mark("tags");
                log("filled Tags:", TAGS);
            }
            const bodyField = findBodyField();
            if (bodyField && visible(bodyField) && !done("desc")) {
                const desc = nextFromList(K.DESC_IDX, DESCRIPTIONS);
                if (desc) {
                    setNativeValue(bodyField, desc);
                    mark("desc");
                    log("filled Description:", desc);
                }
            }
            const cat = findCategory();
            if (cat && visible(cat) && !done("cat")) {
                for (const opt of cat.options) {
                    if (opt.textContent.trim().toLowerCase() === "business") {
                        setSelectValue(cat, opt.value);
                        mark("cat");
                        log("selected Category = Business");
                        break;
                    }
                }
            }
        } catch (e) {
            console.error("[BM] error:", e);
        } finally {
            busy = false;
        }
    }

    /************************************************************
     * MAIN LOOP
     ************************************************************/
    let lastPageKey = pageKey();
    setInterval(() => {
        const pk = pageKey();
        if (pk !== lastPageKey) {
            lastPageKey = pk;
            resetPageFlags();
            if (isRunning() && !isOnSubmitPage()) {
                forceReturnToSubmit();
            }
        }
        finalizePendingSubmission();
        if (isRunning() && !isOnSubmitPage()) {
            forceReturnToSubmit();
            return;
        }
        tick();
    }, 700);

    document.addEventListener("DOMContentLoaded", () => {
        if (isRunning() && !isOnSubmitPage()) forceReturnToSubmit();
    });
    window.addEventListener("load", () => {
        if (isRunning() && !isOnSubmitPage()) forceReturnToSubmit();
    });

    /************************************************************
     * KEYBOARD (Play / Stop)
     ************************************************************/
    document.addEventListener("keydown", e => {
        // Ctrl+B = load the shared saved default into this site's GUI/config,
        // reset ONLY this site's progress, then start. Other sites' counters stay untouched.
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "b") {
            e.preventDefault(); e.stopPropagation();
            const defaults = normalizeDefaults(readGlobalDefaults());
            if (!defaults) {
                alert('No shared default found. Open the GUI (Ctrl+Shift+H), enter your details on any site, and click ⭐ Save as Default first.');
                return;
            }
            if (!applyDefaultsToThisSite(defaults, true, true)) {
                alert('Could not load the saved default. Please open the GUI and check your settings.');
                return;
            }
            resetPageFlags();
            log(`▶ Ctrl+B: shared defaults loaded; starting from URL 1/${URLS.length} on ${SITE_HOST}`);
            setRunning(true);
            const status = document.getElementById('bm-gui-status');
            if (status) status.textContent = `Shared default loaded. Starting from URL 1/${URLS.length} on ${SITE_HOST}...`;
            if (!isOnSubmitPage()) {
                forceReturnToSubmit();
            } else {
                setTimeout(tick, 300);
            }
            return;
        }
        // Escape = Stop
        if (e.key === "Escape") {
            e.preventDefault(); e.stopPropagation();
            log("■ STOP");
            setRunning(false);
            busy = false;
            submitClicked = false;
            return;
        }
    }, true);

    /************************************************************
     * GUI (Ctrl+Shift+H to toggle)
     ************************************************************/
    let guiContainer = null;
    let guiVisible = false;

    function createGUI() {
        if (guiContainer) return;

        guiContainer = document.createElement('div');
        guiContainer.id = 'bm-gui-container';
        guiContainer.style.cssText = `
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            width: 420px !important;
            max-height: 90vh !important;
            background: #1e1e2e !important;
            color: #cdd6f4 !important;
            border: 2px solid #89b4fa !important;
            border-radius: 10px !important;
            padding: 15px !important;
            z-index: 2147483647 !important;
            pointer-events: auto !important;
            isolation: isolate !important;
            font-family: 'Segoe UI', Arial, sans-serif !important;
            font-size: 13px !important;
            box-shadow: 0 8px 30px rgba(0,0,0,0.6) !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            overflow-y: auto !important;
        `;

        guiContainer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #45475a; padding-bottom:8px;">
                <strong style="font-size:15px; color:#89b4fa;">⚙️ Bookmark Auto‑Submit GUI</strong>
                <button id="bm-gui-close" style="background:#f38ba8; color:#1e1e2e; border:none; border-radius:4px; padding:2px 8px; cursor:pointer; font-weight:bold;">✕</button>
            </div>

            <label style="font-weight:bold; color:#a6e3a1;">URLs (one per line)</label>
            <textarea id="bm-gui-urls" rows="5" style="width:100%; background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:5px; padding:6px; font-size:12px; resize:vertical; box-sizing:border-box;">${URLS.join('\n')}</textarea>

            <label style="font-weight:bold; color:#f9e2af;">Titles (one per line)</label>
            <textarea id="bm-gui-titles" rows="5" style="width:100%; background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:5px; padding:6px; font-size:12px; resize:vertical; box-sizing:border-box;">${TITLES.join('\n')}</textarea>

            <label style="font-weight:bold; color:#fab387;">Descriptions (one per line)</label>
            <textarea id="bm-gui-descs" rows="5" style="width:100%; background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:5px; padding:6px; font-size:12px; resize:vertical; box-sizing:border-box;">${DESCRIPTIONS.join('\n')}</textarea>

            <label style="font-weight:bold; color:#89dceb;">Tags (single line)</label>
            <input id="bm-gui-tags" type="text" value="${TAGS.replace(/"/g, '&quot;')}" style="width:100%; background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:5px; padding:6px; font-size:12px; box-sizing:border-box;">

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:5px;">
                <button id="bm-gui-save" style="flex:1; background:#89b4fa; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">💾 Save</button>
                <button id="bm-gui-save-default" style="flex:1; background:#cba6f7; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">⭐ Save as Default</button>
                <button id="bm-gui-use-default" style="flex:1; background:#94e2d5; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">📥 Use Saved Default</button>
                <button id="bm-gui-reset" style="flex:1; background:#f9e2af; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">↺ Reset Progress</button>
                <button id="bm-gui-play" style="flex:1; background:#a6e3a1; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">▶ Play</button>
                <button id="bm-gui-stop" style="flex:1; background:#f38ba8; color:#1e1e2e; border:none; border-radius:5px; padding:8px; cursor:pointer; font-weight:bold;">■ Stop</button>
            </div>

            <div id="bm-gui-status" style="font-size:12px; color:#a6adc8; border-top:1px solid #45475a; padding-top:6px; margin-top:2px;">
                Ctrl+Shift+H = show/hide. Ctrl+B = load shared default + start. Esc = Stop.
            </div>
        `;

        document.body.appendChild(guiContainer);

        // Robust capture-phase event delegation: the page cannot swallow GUI button clicks.
        guiContainer.style.pointerEvents = 'auto';
        guiContainer.querySelectorAll('*').forEach(el => { el.style.pointerEvents = 'auto'; });
        guiContainer.addEventListener('click', (event) => {
            const button = event.target.closest('button[id^="bm-gui-"]');
            if (!button || !guiContainer.contains(button)) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

            const status = document.getElementById('bm-gui-status');
            const readField = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
            const readForm = () => ({
                urls: readField('bm-gui-urls'),
                titles: readField('bm-gui-titles'),
                descs: readField('bm-gui-descs'),
                tags: document.getElementById('bm-gui-tags').value.trim()
            });
            const saveLocal = data => {
                localStorage.setItem(LS_KEYS.URLS, data.urls.join('\n'));
                localStorage.setItem(LS_KEYS.TITLES, data.titles.join('\n'));
                localStorage.setItem(LS_KEYS.DESCS, data.descs.join('\n'));
                localStorage.setItem(LS_KEYS.TAGS, data.tags);
                try { GM_setValue(SITE_DEFAULTS_KEY, data); } catch (e) {}
                URLS = data.urls;
                TITLES = data.titles;
                DESCRIPTIONS = data.descs;
                TAGS = data.tags;
            };

            try {
                switch (button.id) {
                    case 'bm-gui-close':
                        toggleGUI(false);
                        break;
                    case 'bm-gui-save': {
                        const data = readForm();
                        if (!data.urls.length) { alert('Please enter at least one URL.'); break; }
                        saveLocal(data);
                        status.textContent = `Saved: ${URLS.length} URLs, ${TITLES.length} Titles, ${DESCRIPTIONS.length} Descs.`;
                        log('GUI data saved.');
                        break;
                    }
                    case 'bm-gui-save-default': {
                        const data = normalizeDefaults(readForm());
                        if (!data) { alert('Please enter at least one URL before saving defaults.'); break; }
                        GM_setValue(GLOBAL_DEFAULTS_KEY, data);
                        GM_setValue(SITE_DEFAULTS_KEY, data);
                        saveLocal(data);
                        status.textContent = `Shared default saved. It can now be loaded on any matched site. ${URLS.length} URLs.`;
                        log(`Shared defaults saved from ${SITE_HOST}; progress remains site-specific.`);
                        break;
                    }
                    case 'bm-gui-use-default': {
                        const defaults = normalizeDefaults(readGlobalDefaults());
                        if (!defaults) {
                            status.textContent = 'No shared default found. Set your details and click Save as Default first.';
                            alert('No saved default found. First enter your details on any site and click ⭐ Save as Default.');
                            break;
                        }
                        applyDefaultsToThisSite(defaults, true, true);
                        status.textContent = `Shared defaults loaded on ${SITE_HOST}. This site's progress was reset; other sites are unchanged.`;
                        log(`Loaded shared defaults on ${SITE_HOST}; reset progress for this site only.`);
                        break;
                    }
                    case 'bm-gui-reset':
                        resetProgress();
                        status.textContent = 'Progress reset.';
                        log('Progress reset via GUI.');
                        break;
                    case 'bm-gui-play':
                        if (!URLS.length) { alert('No URLs configured.'); break; }
                        if (getNum(K.DONE, 0) >= URLS.length) resetProgress();
                        resetPageFlags();
                        setRunning(true);
                        status.textContent = 'Playing...';
                        log('PLAY via GUI');
                        if (!isOnSubmitPage()) forceReturnToSubmit();
                        else setTimeout(tick, 300);
                        break;
                    case 'bm-gui-stop':
                        setRunning(false);
                        busy = false;
                        submitClicked = false;
                        status.textContent = 'Stopped.';
                        log('STOP via GUI');
                        break;
                }
            } catch (error) {
                console.error('[BM] GUI button error:', error);
                if (status) status.textContent = `Button error: ${error.message}`;
            }
        }, true);

        guiVisible = true;
    }

    function toggleGUI(forceState) {
        if (!guiContainer) createGUI();
        if (typeof forceState === 'boolean') {
            guiVisible = forceState;
        } else {
            guiVisible = !guiVisible;
        }
        guiContainer.style.display = guiVisible ? 'flex' : 'none';
    }

    // Keyboard shortcut: Ctrl+Shift+H
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            e.stopPropagation();
            toggleGUI();
        }
    }, true);

    // Also create GUI on page load (but hidden by default)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { createGUI(); toggleGUI(false); });
    } else {
        createGUI();
        toggleGUI(false);
    }

    /************************************************************
     * INIT
     ************************************************************/
    log("loaded on", location.hostname, "| path:", location.pathname);
    log("URLs:", URLS.length, "Titles:", TITLES.length, "Descs:", DESCRIPTIONS.length, "Tags:", TAGS);
    log("Ctrl+B = Load shared default + start from URL 1 on this site | Esc = Stop | Ctrl+Shift+H = Toggle GUI");

    if (isRunning()) {
        const doneCount = getNum(K.DONE, 0);
        log("resuming — progress", doneCount, "/", URLS.length);
        if (doneCount >= URLS.length) {
            log("already complete — stopping");
            setRunning(false);
        } else if (!isOnSubmitPage()) {
            forceReturnToSubmit();
        } else {
            setTimeout(tick, 800);
        }
    }

})();
