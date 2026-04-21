// ==UserScript==
// @name         Bookmarktuna - X Bookmarks Drag & Drop Organizer
// @namespace    https://github.com/Catalyst-Forge-LLC/bookmarktuna
// @version      4.10
// @description  Drag or keyboard-shortcut posts into folders. Create folders inline. Auto-hides filed posts. Recently-used folders bubble to top.
// @author       AcmeGeek + Grok + Claude
// @match        https://x.com/i/bookmarks*
// @match        https://twitter.com/i/bookmarks*
// @grant        none
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/Catalyst-Forge-LLC/bookmarktuna
// @supportURL   https://github.com/Catalyst-Forge-LLC/bookmarktuna/issues
// @updateURL    https://raw.githubusercontent.com/Catalyst-Forge-LLC/bookmarktuna/main/bookmarktuna.user.js
// @downloadURL  https://raw.githubusercontent.com/Catalyst-Forge-LLC/bookmarktuna/main/bookmarktuna.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '4.10';

    const isAllBookmarksPage = /^\/i\/bookmarks\/?$/.test(location.pathname);
    if (!isAllBookmarksPage) {
        console.log(`🐟 Bookmarktuna v${VERSION}: not on All Bookmarks page, idle.`);
        return;
    }

    console.log(
        `%c🐟 Bookmarktuna v${VERSION} loaded — direct-API filing`,
        'color:#1d9bf0; font-weight:bold; font-size:16px'
    );

    // ---------- API constants ----------

    const BEARER_TOKEN =
        'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    // Read: which folders contains this tweet?
    const OP_FOLDERS_FOR_TWEET = {
        hash: 'i78YDd0Tza-dV4SYs58kRg',
        name: 'BookmarkFoldersSlice',
    };
    // Mutation: add tweet to folder.
    const OP_ADD_TO_FOLDER = {
        hash: '4KHZvvNbHNf07bsgnL9gWA',
        name: 'bookmarkTweetToFolder',
    };
    // Mutation: remove tweet from folder.
    const OP_REMOVE_FROM_FOLDER = {
        hash: '2Qbj9XZvtUvyJB4gFwWfaA',
        name: 'RemoveTweetFromBookmarkFolder',
    };
    // Mutation: create a new folder.
    const OP_CREATE_FOLDER = {
        hash: '6Xxqpq8TM_CREYiuof_h5w',
        name: 'createBookmarkFolder',
    };

    const MANUAL_FOLDER_ID = '__manual__';

    const STORAGE_KEY_FILED = 'bookmarktuna:filed';
    const STORAGE_KEY_CHECKED = 'bookmarktuna:checked';
    const STORAGE_KEY_FOLDERS = 'bookmarktuna:folders';
    const STORAGE_KEY_PANEL_POS = 'bookmarktuna:panel-pos';
    const STORAGE_KEY_FOLDER_USAGE = 'bookmarktuna:folder-usage'; // { [id]: lastUsedTimestamp }

    const CHECK_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
    const MAX_CONCURRENT = 3;
    const MIN_REQUEST_INTERVAL_MS = 120;
    const UNDO_WINDOW_MS = 8000;

    // ---------- state ----------

    let draggedPost = null;
    let floatingPanel = null;
    let panelContent = null;
    let showHidden = false;
    let lastAction = null; // { type: 'file' | 'hide', tweetId, folder?, article? } — for keyboard undo

    const folderCache = Object.create(null);
    loadFoldersFromStorage();

    let filedIndex = loadFiledIndex();
    let checkedIndex = loadCheckedIndex();
    const inFlight = new Set();

    // ---------- storage ----------

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    }
    function saveJSON(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (e) { console.warn(`🐟 failed to save ${key}`, e); }
    }

    function loadFiledIndex() { return loadJSON(STORAGE_KEY_FILED, {}); }
    function saveFiledIndex() { saveJSON(STORAGE_KEY_FILED, filedIndex); }
    function loadCheckedIndex() { return loadJSON(STORAGE_KEY_CHECKED, {}); }
    function saveCheckedIndex() { saveJSON(STORAGE_KEY_CHECKED, checkedIndex); }

    function loadFoldersFromStorage() {
        const list = loadJSON(STORAGE_KEY_FOLDERS, []);
        list.forEach(f => {
            if (f && f.id) folderCache[f.id] = { id: f.id, name: f.name || f.id, href: `/i/bookmarks/${f.id}` };
        });
    }
    function saveFoldersToStorage() {
        const list = Object.values(folderCache).map(f => ({ id: f.id, name: f.name }));
        saveJSON(STORAGE_KEY_FOLDERS, list);
    }

    function loadPanelPos() { return loadJSON(STORAGE_KEY_PANEL_POS, null); }
    function savePanelPos(pos) { saveJSON(STORAGE_KEY_PANEL_POS, pos); }

    function markFiled(tweetId, folderId, folderName) {
        if (!tweetId) return;
        filedIndex[tweetId] = {
            folderId: folderId || MANUAL_FOLDER_ID,
            folderName: folderName || 'Manually hidden',
            filedAt: Date.now(),
        };
        saveFiledIndex();
    }
    function unmarkFiled(tweetId) {
        if (filedIndex[tweetId]) {
            delete filedIndex[tweetId];
            saveFiledIndex();
        }
        // Force a re-check next time it appears.
        if (checkedIndex[tweetId]) {
            delete checkedIndex[tweetId];
            saveCheckedIndex();
        }
    }
    function markChecked(tweetId, inFolder) {
        checkedIndex[tweetId] = { checkedAt: Date.now(), inFolder: !!inFolder };
        saveCheckedIndex();
    }
    function isCheckFresh(tweetId) {
        const c = checkedIndex[tweetId];
        return !!(c && (Date.now() - c.checkedAt) < CHECK_TTL_MS);
    }
    function clearAllFiled() {
        filedIndex = {};
        checkedIndex = {};
        saveFiledIndex();
        saveCheckedIndex();
    }

    // ---------- utilities ----------

    function debounce(fn, wait) {
        let t = null;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function tweetIdFromArticle(article) {
        if (!article) return null;
        const links = article.querySelectorAll('a[href*="/status/"]');
        for (const a of links) {
            const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    // ---------- API: GraphQL helpers ----------

    function commonHeaders() {
        const csrf = getCookie('ct0');
        if (!csrf) throw new Error('no ct0 cookie — are you signed in?');
        return {
            'authorization': BEARER_TOKEN,
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': 'en',
        };
    }

    async function gqlGet(op, variables) {
        const vars = encodeURIComponent(JSON.stringify(variables));
        const url = `https://${location.host}/i/api/graphql/${op.hash}/${op.name}?variables=${vars}`;
        const res = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: commonHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function gqlPost(op, variables) {
        const url = `https://${location.host}/i/api/graphql/${op.hash}/${op.name}`;
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: commonHeaders(),
            body: JSON.stringify({ variables, queryId: op.hash }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    // ---------- API: specific operations ----------

    async function queryTweetFolders(tweetId) {
        const json = await gqlGet(OP_FOLDERS_FOR_TWEET, { tweet_id: tweetId });
        const items =
            json?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items || [];

        let foldersChanged = false;
        items.forEach(item => {
            if (!item || !item.id || !item.name) return;
            const existing = folderCache[item.id];
            if (!existing || existing.name !== item.name) {
                folderCache[item.id] = {
                    id: item.id,
                    name: item.name,
                    href: `/i/bookmarks/${item.id}`,
                };
                foldersChanged = true;
            }
        });
        if (foldersChanged) {
            saveFoldersToStorage();
            if (floatingPanel) renderPanel();
        }

        const filedItem = items.find(it => it.contains_requested_tweet);
        return filedItem ? { folderId: filedItem.id, folderName: filedItem.name } : null;
    }

    async function apiAddTweetToFolder(tweetId, folderId) {
        const json = await gqlPost(OP_ADD_TO_FOLDER, {
            bookmark_collection_id: folderId,
            tweet_id: tweetId,
        });
        if (json?.data?.bookmark_collection_tweet_put !== 'Done') {
            throw new Error('unexpected add response: ' + JSON.stringify(json).slice(0, 200));
        }
        return true;
    }

    async function apiRemoveTweetFromFolder(tweetId, folderId) {
        const json = await gqlPost(OP_REMOVE_FROM_FOLDER, {
            bookmark_collection_id: folderId,
            tweet_id: tweetId,
        });
        if (json?.data?.bookmark_collection_tweet_delete !== 'Done') {
            throw new Error('unexpected remove response: ' + JSON.stringify(json).slice(0, 200));
        }
        return true;
    }

    async function apiCreateFolder(name) {
        const json = await gqlPost(OP_CREATE_FOLDER, { name });
        const created = json?.data?.bookmark_collection_create;
        if (!created || !created.id || !created.name) {
            throw new Error('unexpected create response: ' + JSON.stringify(json).slice(0, 200));
        }
        return { id: created.id, name: created.name };
    }

    // ---------- throttled check queue (lazy, viewport-driven) ----------

    const queue = [];
    let activeRequests = 0;
    let lastRequestAt = 0;

    function enqueueCheck(tweetId) {
        if (!tweetId) return;
        if (isCheckFresh(tweetId)) return;
        if (inFlight.has(tweetId)) return;
        if (queue.includes(tweetId)) return;
        queue.push(tweetId);
        drain();
    }

    function drain() {
        while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
            const now = Date.now();
            const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - now);
            if (wait > 0) {
                setTimeout(drain, wait);
                return;
            }
            const tweetId = queue.shift();
            if (inFlight.has(tweetId)) continue;
            inFlight.add(tweetId);
            activeRequests++;
            lastRequestAt = Date.now();

            queryTweetFolders(tweetId)
                .then(result => {
                    markChecked(tweetId, !!result);
                    if (result) markFiled(tweetId, result.folderId, result.folderName);
                    applyFiltering();
                })
                .catch(err => {
                    console.warn(`🐟 folder check failed for ${tweetId}:`, err.message || err);
                })
                .finally(() => {
                    inFlight.delete(tweetId);
                    activeRequests--;
                    drain();
                });
        }
        updateStatus();
    }

    // ---------- viewport-based lazy checking ----------

    // Observe tweets as they come into view; queue checks for ones we don't know about.
    // This keeps API traffic proportional to what the user is actually reading, not
    // to the size of their entire bookmarks list.
    const viewportObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const article = entry.target;
            const id = tweetIdFromArticle(article);
            if (!id) return;
            if (filedIndex[id]) return;
            if (isCheckFresh(id)) return;
            enqueueCheck(id);
        });
    }, {
        // Start checking a bit before the tweet is actually on-screen so the hide
        // happens before the user sees it flash in.
        rootMargin: '300px 0px 300px 0px',
        threshold: 0.01,
    });

    function observeArticleForViewport(article) {
        if (article.dataset.btObserved === '1') return;
        article.dataset.btObserved = '1';
        viewportObserver.observe(article);
    }

    // ---------- filtering ----------

    function applyFiltering() {
        const articles = document.querySelectorAll('article');
        let hiddenOnScreen = 0;

        articles.forEach(article => {
            const id = tweetIdFromArticle(article);
            if (!id) return;

            // Ensure it's being watched for lazy check.
            observeArticleForViewport(article);

            const isFiled = !!filedIndex[id];
            if (isFiled && !showHidden) {
                if (article.style.display !== 'none') {
                    article.style.display = 'none';
                    article.dataset.btHidden = '1';
                }
                hiddenOnScreen++;
            } else if (article.dataset.btHidden === '1') {
                article.style.display = '';
                delete article.dataset.btHidden;
            }
        });

        updateHiddenCount(hiddenOnScreen);
    }

    // ---------- folder cache from DOM (fallback) ----------

    function folderIdFromHref(href) {
        if (!href) return null;
        const m = href.match(/^\/i\/bookmarks\/(\d+)(?:[/?#]|$)/);
        return m ? m[1] : null;
    }

    function readFolderLabel(anchor) {
        const dirSpan = anchor.querySelector('span[dir]');
        if (dirSpan && dirSpan.textContent.trim()) return dirSpan.textContent.trim();
        const aria = anchor.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const anySpan = anchor.querySelector('span');
        if (anySpan && anySpan.textContent.trim()) return anySpan.textContent.trim();
        return (anchor.textContent || '').trim();
    }

    function scanFoldersFromDOM() {
        let changed = false;
        document.querySelectorAll('a[href^="/i/bookmarks/"]').forEach(a => {
            const href = a.getAttribute('href');
            const id = folderIdFromHref(href);
            if (!id) return;
            const name = readFolderLabel(a);
            if (!name) return;
            if (!folderCache[id]) {
                folderCache[id] = { id, name, href };
                changed = true;
            }
        });
        if (changed) {
            saveFoldersToStorage();
            if (floatingPanel) renderPanel();
        }
    }

    // Recently-used tracker. Folders used recently bubble to the top so the
    // ones you're actively working with are closest to the cursor.
    let folderUsage = loadJSON(STORAGE_KEY_FOLDER_USAGE, {});
    function recordFolderUse(folderId) {
        if (!folderId) return;
        folderUsage[folderId] = Date.now();
        saveJSON(STORAGE_KEY_FOLDER_USAGE, folderUsage);
    }

    function getFolders() {
        const all = Object.values(folderCache);
        return all.sort((a, b) => {
            const ua = folderUsage[a.id] || 0;
            const ub = folderUsage[b.id] || 0;
            if (ua !== ub) return ub - ua; // recent first
            return a.name.localeCompare(b.name);
        });
    }

    // ---------- toast / undo ----------

    let toastEl = null;
    let toastTimer = null;

    function showToast(text, { actionLabel = null, onAction = null, duration = 4000 } = {}) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                background: #0f1419; color: #fff; padding: 10px 16px;
                border-radius: 999px; font-size: 14px; z-index: 9999999;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                display: flex; align-items: center; gap: 12px;
            `;
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML = '';
        const msg = document.createElement('span');
        msg.textContent = text;
        toastEl.appendChild(msg);

        if (actionLabel && onAction) {
            const btn = document.createElement('button');
            btn.textContent = actionLabel;
            btn.style.cssText = `
                background: transparent; color: #1d9bf0; border: 0;
                font-weight: 700; cursor: pointer; font-size: 14px; padding: 0;
            `;
            btn.addEventListener('click', () => {
                hideToast();
                onAction();
            });
            toastEl.appendChild(btn);
        }

        toastEl.style.display = 'flex';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, duration);
    }

    function hideToast() {
        if (toastEl) toastEl.style.display = 'none';
        clearTimeout(toastTimer);
    }

    // ---------- filing: the one true path ----------

    // Atomic: file one tweet in one folder via API. Optimistic UI.
    async function fileTweet(tweetId, folder, sourceArticle) {
        if (!tweetId || !folder) return;

        // Optimistic: mark & hide immediately.
        const prevFiled = filedIndex[tweetId]; // may be undefined
        markFiled(tweetId, folder.id, folder.name);
        if (sourceArticle) {
            sourceArticle.style.transition = 'opacity 0.3s ease';
            sourceArticle.style.opacity = '0.1';
            sourceArticle.style.pointerEvents = 'none';
        }
        setTimeout(applyFiltering, 350);

        try {
            await apiAddTweetToFolder(tweetId, folder.id);
            recordFolderUse(folder.id);
            lastAction = { type: 'file', tweetId, folder, article: sourceArticle };
            // Re-render panel so the freshly-used folder bubbles to the top.
            if (floatingPanel) renderPanel();
            showToast(`Filed in “${folder.name}”`, {
                actionLabel: 'Undo',
                onAction: () => unfileTweet(tweetId, folder, sourceArticle),
                duration: UNDO_WINDOW_MS,
            });
        } catch (err) {
            // Revert optimistic changes.
            console.warn('🐟 filing failed:', err);
            if (prevFiled) {
                filedIndex[tweetId] = prevFiled;
                saveFiledIndex();
            } else {
                unmarkFiled(tweetId);
            }
            if (sourceArticle) {
                sourceArticle.style.opacity = '';
                sourceArticle.style.pointerEvents = '';
            }
            applyFiltering();
            showToast(`Failed to file: ${err.message || err}`, { duration: 5000 });
        }
    }

    async function unfileTweet(tweetId, folder, sourceArticle) {
        try {
            await apiRemoveTweetFromFolder(tweetId, folder.id);
            unmarkFiled(tweetId);
            if (sourceArticle) {
                sourceArticle.style.opacity = '';
                sourceArticle.style.pointerEvents = '';
                sourceArticle.style.display = '';
                delete sourceArticle.dataset.btHidden;
            }
            applyFiltering();
            showToast(`Removed from “${folder.name}”`, { duration: 2500 });
        } catch (err) {
            console.warn('🐟 undo failed:', err);
            showToast(`Undo failed: ${err.message || err}`, { duration: 5000 });
        }
    }

    // ---------- panel: draggable, persists position ----------

    function ensurePanel() {
        if (floatingPanel) return;

        floatingPanel = document.createElement('div');
        const savedPos = loadPanelPos();
        const baseStyle = `
            position: fixed; z-index: 999999;
            background: #ffffff; border: 3px solid #1d9bf0;
            border-radius: 12px; box-shadow: 0 15px 35px rgba(29,155,240,0.3);
            padding: 14px;
            min-width: 300px; max-width: 360px; max-height: 75vh; overflow-y: auto;
            font-size: 14px; color: #0f1419;
            user-select: none;
        `;

        // If we have a saved position, clamp it to the current viewport so a
        // smaller window (or a saved off-screen drag) doesn't strand the panel.
        let posStyle;
        if (savedPos) {
            const pad = 8;
            const approxW = 360;
            const approxH = 200;
            const maxLeft = Math.max(pad, window.innerWidth - approxW - pad);
            const maxTop = Math.max(pad, window.innerHeight - approxH - pad);
            const left = Math.max(pad, Math.min(maxLeft, savedPos.left));
            const top = Math.max(pad, Math.min(maxTop, savedPos.top));
            posStyle = `top: ${top}px; left: ${left}px; right: auto;`;
        } else {
            posStyle = `top: 20%; right: 40px;`;
        }
        floatingPanel.style.cssText = baseStyle + posStyle;

        floatingPanel.innerHTML = `
            <div id="bt-dragbar" style="font-weight:bold; margin-bottom:10px; color:#1d9bf0; text-align:center; cursor:grab;">
                🐟 Bookmarktuna <span style="color:#cfd9de; font-weight:normal; font-size:11px;">⋮⋮ drag</span>
            </div>
            <div id="bt-controls" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #eee;"></div>
            <div id="bt-panel-content"></div>
        `;
        document.body.appendChild(floatingPanel);
        panelContent = floatingPanel.querySelector('#bt-panel-content');
        buildControls();
        makePanelDraggable();
        renderPanel(); // draw folder list (or "no folders yet" fallback) immediately

        // Panel itself is NOT a drop target for filing — only specific folder buttons are.
        // (Accidental-drop-on-first-folder was a footgun.)
        floatingPanel.addEventListener('dragover', e => {
            if (!draggedPost) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
    }

    function makePanelDraggable() {
        const bar = floatingPanel.querySelector('#bt-dragbar');
        let dragging = false;
        let startX = 0, startY = 0;
        let startLeft = 0, startTop = 0;

        bar.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            bar.style.cursor = 'grabbing';
            const rect = floatingPanel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            floatingPanel.style.right = 'auto';
            floatingPanel.style.left = `${startLeft}px`;
            floatingPanel.style.top = `${startTop}px`;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const pad = 8;
            const maxLeft = window.innerWidth - floatingPanel.offsetWidth - pad;
            const maxTop = window.innerHeight - 40 - pad;
            const left = Math.max(pad, Math.min(maxLeft, startLeft + dx));
            const top = Math.max(pad, Math.min(maxTop, startTop + dy));
            floatingPanel.style.left = `${left}px`;
            floatingPanel.style.top = `${top}px`;
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            bar.style.cursor = 'grab';
            const rect = floatingPanel.getBoundingClientRect();
            savePanelPos({ left: rect.left, top: rect.top });
        });
    }

    function makeBtn(label, onClick, { primary = false, small = false } = {}) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `
            padding: ${small ? '6px 10px' : '8px 12px'};
            border-radius: 6px;
            border: 1px solid ${primary ? '#1d9bf0' : '#cfd9de'};
            background: ${primary ? '#1d9bf0' : '#ffffff'};
            color: ${primary ? '#ffffff' : '#0f1419'};
            cursor: pointer;
            font-size: ${small ? '12px' : '13px'};
            font-weight: 600;
        `;
        b.addEventListener('click', onClick);
        return b;
    }

    function buildControls() {
        const controls = floatingPanel.querySelector('#bt-controls');
        controls.innerHTML = '';

        const count = document.createElement('div');
        count.id = 'bt-hidden-count';
        count.style.cssText = 'font-size:12px; color:#536471; text-align:center;';
        controls.appendChild(count);

        const status = document.createElement('div');
        status.id = 'bt-status';
        status.style.cssText = 'font-size:11px; color:#536471; text-align:center; min-height:1em;';
        controls.appendChild(status);

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px;';
        row.appendChild(makeBtn(showHidden ? '🙈 Re-hide' : '👁 Show hidden', () => {
            showHidden = !showHidden;
            buildControls();
            applyFiltering();
        }));
        row.appendChild(makeBtn('🗑 Clear', () => {
            if (confirm('Clear all hidden-post memory? Everything will re-check via the API as you scroll.')) {
                clearAllFiled();
                applyFiltering();
            }
        }, { small: true }));
        controls.appendChild(row);

        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex; gap:6px;';
        row2.appendChild(makeBtn('? Shortcuts', () => toggleHelpOverlay(), { small: true }));
        row2.appendChild(makeBtn('🩺 Diagnose', async () => {
            showToast('Running diagnostics…', { duration: 2000 });
            try {
                const results = await runDiagnostics();
                showDiagnostics(results);
            } catch (err) {
                showToast(`Diagnostics failed: ${err.message || err}`, { duration: 4000 });
            }
        }, { small: true }));
        controls.appendChild(row2);
    }

    function updateHiddenCount(nHiddenNow) {
        const el = floatingPanel && floatingPanel.querySelector('#bt-hidden-count');
        if (!el) return;
        const total = Object.keys(filedIndex).length;
        el.textContent = showHidden
            ? `Showing hidden — ${total} in index`
            : `${total} posts hidden (${nHiddenNow} on screen)`;
    }

    function updateStatus() {
        const el = floatingPanel && floatingPanel.querySelector('#bt-status');
        if (!el) return;
        const pending = queue.length + activeRequests;
        el.textContent = pending > 0 ? `Checking ${pending} post${pending === 1 ? '' : 's'}…` : '';
    }

    // Inline "+ New folder" row. Starts collapsed; click to reveal an input.
    function buildNewFolderRow() {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin: 4px 0 8px;';

        const collapsed = document.createElement('div');
        collapsed.textContent = '＋ New folder';
        collapsed.style.cssText = `
            padding: 8px 14px;
            background: transparent; border-radius: 8px; cursor: pointer;
            border: 1px dashed #cfd9de; color: #1d9bf0;
            font-weight: 600; text-align: center;
        `;

        const expanded = document.createElement('div');
        expanded.style.cssText = 'display:none; gap:6px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Folder name';
        input.maxLength = 30;
        input.style.cssText = `
            flex: 1; padding: 8px 10px; font-size: 13px;
            border: 1px solid #cfd9de; border-radius: 6px;
            color: #0f1419; background: #fff;
            outline: none;
        `;
        input.addEventListener('focus', () => {
            input.style.borderColor = '#1d9bf0';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = '#cfd9de';
        });

        const confirmBtn = makeBtn('Create', () => submit(), { primary: true, small: true });
        const cancelBtn = makeBtn('✕', () => collapse(), { small: true });

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px;';
        row.appendChild(input);
        row.appendChild(confirmBtn);
        row.appendChild(cancelBtn);
        expanded.appendChild(row);

        function expand() {
            collapsed.style.display = 'none';
            expanded.style.display = 'block';
            setTimeout(() => input.focus(), 0);
        }
        function collapse() {
            input.value = '';
            expanded.style.display = 'none';
            collapsed.style.display = 'block';
        }

        async function submit() {
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            // Optimistic: disable while pending.
            confirmBtn.disabled = true;
            confirmBtn.textContent = '…';
            try {
                const created = await apiCreateFolder(name);
                // Hydrate cache and re-render.
                folderCache[created.id] = {
                    id: created.id,
                    name: created.name,
                    href: `/i/bookmarks/${created.id}`,
                };
                saveFoldersToStorage();
                collapse();
                renderPanel();
                showToast(`Created folder “${created.name}”`, { duration: 2500 });
            } catch (err) {
                console.warn('🐟 create folder failed:', err);
                showToast(`Create failed: ${err.message || err}`, { duration: 4000 });
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Create';
            }
        }

        collapsed.addEventListener('click', expand);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); collapse(); }
        });

        wrap.appendChild(collapsed);
        wrap.appendChild(expanded);
        return wrap;
    }

    function renderPanel() {
        if (!panelContent) return;
        panelContent.innerHTML = '';

        const folders = getFolders();
        const title = document.createElement('div');
        title.style.cssText = 'font-size:12px; color:#536471; margin-bottom:6px;';
        title.textContent = folders.length
            ? 'Drop on a folder to file:'
            : 'No folders yet — they’ll populate as the page loads.';
        panelContent.appendChild(title);

        // "+ New folder" row — expands into an inline input on click.
        panelContent.appendChild(buildNewFolderRow());

        // Folder list. Two columns when there are enough folders to benefit
        // from it; single column otherwise.
        const useGrid = folders.length >= 6;
        const grid = document.createElement('div');
        grid.style.cssText = useGrid
            ? 'display:grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px;'
            : 'display:flex; flex-direction:column; gap:4px; margin-top: 4px;';
        panelContent.appendChild(grid);

        folders.forEach((folder, idx) => {
            const btn = document.createElement('div');
            btn.style.cssText = `
                position: relative;
                padding: 10px 14px 10px ${idx < 9 ? '28px' : '14px'};
                background: #f8f9fa; border-radius: 8px; cursor: pointer;
                border: 1px solid #e0e0e0;
                font-size: 13px; line-height: 1.3;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            `;
            btn.textContent = folder.name;
            btn.title = `Folder ID: ${folder.id}${idx < 9 ? ` — press ${idx + 1} to file top post here` : ''}`;

            // Shortcut number badge for folders 1-9
            if (idx < 9) {
                const badge = document.createElement('span');
                badge.textContent = String(idx + 1);
                badge.style.cssText = `
                    position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
                    display: inline-block; min-width: 14px; padding: 1px 4px;
                    background: #e8f0fa; color: #1d9bf0; border-radius: 3px;
                    font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700;
                    text-align: center;
                `;
                btn.appendChild(badge);
            }

            btn.addEventListener('click', () => {
                if (!draggedPost) {
                    showToast('Drag a post onto a folder to file it.', { duration: 2500 });
                }
            });
            btn.addEventListener('dragover', e => {
                if (!draggedPost) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                btn.style.backgroundColor = 'rgba(29, 155, 240, 0.2)';
            });
            btn.addEventListener('dragleave', () => { btn.style.backgroundColor = ''; });
            btn.addEventListener('drop', e => {
                e.preventDefault();
                e.stopPropagation();
                btn.style.backgroundColor = '';
                const post = draggedPost;
                if (!post) return;
                const tweetId = tweetIdFromArticle(post);
                fileTweet(tweetId, folder, post);
            });
            grid.appendChild(btn);
        });
    }

    // ---------- per-post "hide" button ----------

    function addHideButtons() {
        document.querySelectorAll('article:not([data-bt-hide-btn])').forEach(article => {
            article.dataset.btHideBtn = '1';

            const btn = document.createElement('button');
            btn.textContent = '🙈 Hide';
            btn.title = 'Hide from All Bookmarks (does not remove from X)';
            btn.style.cssText = `
                position: absolute; top: 8px; right: 8px; z-index: 10;
                padding: 4px 8px; font-size: 11px;
                background: rgba(255,255,255,0.92); border:1px solid #cfd9de;
                border-radius: 6px; cursor: pointer; color: #536471;
            `;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = tweetIdFromArticle(article);
                if (!id) return;
                markFiled(id, MANUAL_FOLDER_ID, 'Manually hidden');
                applyFiltering();
            });

            if (getComputedStyle(article).position === 'static') {
                article.style.position = 'relative';
            }
            article.appendChild(btn);
        });
    }

    // ---------- draggable posts / droppable sidebar folders ----------

    function makePostsDraggable() {
        document.querySelectorAll('article:not([data-bt-drag])').forEach(post => {
            post.dataset.btDrag = '1';
            post.setAttribute('draggable', 'true');
            post.addEventListener('dragstart', () => {
                draggedPost = post;
                ensurePanel();
                renderPanel();
            });
            post.addEventListener('dragend', () => {
                draggedPost = null;
            });
        });
    }

    function makeFoldersDroppable() {
        document.querySelectorAll('a[href^="/i/bookmarks/"]').forEach(a => {
            const id = folderIdFromHref(a.getAttribute('href'));
            if (!id) return;
            if (a.dataset.btDrop) return;
            const folder = folderCache[id];
            if (!folder) return;

            a.dataset.btDrop = '1';
            a.addEventListener('dragover', e => {
                if (!draggedPost) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            a.addEventListener('drop', e => {
                e.preventDefault();
                if (!draggedPost) return;
                const post = draggedPost;
                const tweetId = tweetIdFromArticle(post);
                fileTweet(tweetId, folderCache[id] || folder, post);
            });
        });
    }

    // ---------- keyboard shortcuts ----------

    // Return the post currently "active" for a keyboard action — the topmost
    // article whose top edge is below the sticky header. Matches what the
    // user is looking at. Skips already-hidden posts.
    function getTopVisiblePost() {
        const articles = document.querySelectorAll('article');
        const HEADER_OFFSET = 60; // X's sticky header height
        let best = null;
        let bestTop = Infinity;
        articles.forEach(article => {
            if (article.style.display === 'none') return;
            const rect = article.getBoundingClientRect();
            if (rect.bottom < HEADER_OFFSET) return; // above viewport
            if (rect.top > window.innerHeight) return; // below viewport
            // We want the first article whose top is at or below the header.
            const effectiveTop = Math.max(rect.top, HEADER_OFFSET);
            if (effectiveTop < bestTop) {
                bestTop = effectiveTop;
                best = article;
            }
        });
        return best;
    }

    // Briefly pulse an article so the user sees which post the keystroke hit.
    function flashArticle(article, color = '#1d9bf0') {
        if (!article) return;
        const prev = article.style.boxShadow;
        article.style.transition = 'box-shadow 0.2s ease';
        article.style.boxShadow = `inset 0 0 0 3px ${color}`;
        setTimeout(() => { article.style.boxShadow = prev; }, 300);
    }

    function handleKeydown(e) {
        // Ignore when the user is typing in an input/textarea or using modifiers.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        // 1–9 → file top-visible post into folder N
        if (/^[1-9]$/.test(e.key)) {
            const idx = parseInt(e.key, 10) - 1;
            const folders = getFolders();
            if (idx >= folders.length) return;
            const article = getTopVisiblePost();
            if (!article) return;
            const tweetId = tweetIdFromArticle(article);
            if (!tweetId) return;
            e.preventDefault();
            flashArticle(article);
            fileTweet(tweetId, folders[idx], article);
            return;
        }

        // H → hide top-visible post (manual)
        if (e.key === 'h' || e.key === 'H') {
            const article = getTopVisiblePost();
            if (!article) return;
            const tweetId = tweetIdFromArticle(article);
            if (!tweetId) return;
            e.preventDefault();
            flashArticle(article, '#536471');
            markFiled(tweetId, MANUAL_FOLDER_ID, 'Manually hidden');
            lastAction = { type: 'hide', tweetId, article };
            applyFiltering();
            showToast('Hidden', {
                actionLabel: 'Undo',
                onAction: () => {
                    unmarkFiled(tweetId);
                    applyFiltering();
                },
                duration: 4000,
            });
            return;
        }

        // U → undo last action (file or hide)
        if (e.key === 'u' || e.key === 'U') {
            if (!lastAction) return;
            e.preventDefault();
            if (lastAction.type === 'file') {
                unfileTweet(lastAction.tweetId, lastAction.folder, lastAction.article);
            } else if (lastAction.type === 'hide') {
                unmarkFiled(lastAction.tweetId);
                applyFiltering();
                showToast('Un-hidden', { duration: 2000 });
            }
            lastAction = null;
            return;
        }

        // ? → help overlay
        if (e.key === '?') {
            e.preventDefault();
            toggleHelpOverlay();
            return;
        }

        // Escape → close help overlay if open
        if (e.key === 'Escape' && helpOverlay) {
            e.preventDefault();
            toggleHelpOverlay();
        }
    }
    window.addEventListener('keydown', handleKeydown);

    // ---------- help overlay ----------

    let helpOverlay = null;

    function toggleHelpOverlay() {
        if (helpOverlay) {
            helpOverlay.remove();
            helpOverlay = null;
            return;
        }
        helpOverlay = document.createElement('div');
        helpOverlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(15,20,25,0.65);
            z-index: 9999998; display: flex; align-items: center; justify-content: center;
        `;
        const card = document.createElement('div');
        card.style.cssText = `
            background: #fff; color: #0f1419; padding: 24px 28px; border-radius: 12px;
            min-width: 320px; max-width: 440px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);
            font-size: 14px; line-height: 1.6;
        `;
        card.innerHTML = `
            <div style="font-weight:bold; font-size:16px; margin-bottom:12px; color:#1d9bf0;">
                🐟 Bookmarktuna keyboard shortcuts
            </div>
            <div style="display:grid; grid-template-columns:auto 1fr; gap:8px 16px;">
                <kbd style="${kbdStyle()}">1</kbd><span>–</span>
                <kbd style="${kbdStyle()}">9</kbd><span>File top-visible post into folder 1–9 (panel order)</span>
                <kbd style="${kbdStyle()}">H</kbd><span>Hide top-visible post from All Bookmarks</span>
                <kbd style="${kbdStyle()}">U</kbd><span>Undo last file / hide action</span>
                <kbd style="${kbdStyle()}">?</kbd><span>Toggle this help</span>
                <kbd style="${kbdStyle()}">Esc</kbd><span>Close this help</span>
            </div>
            <div style="margin-top:14px; font-size:12px; color:#536471;">
                Recently used folders bubble to the top automatically, so “1” is usually the folder you just used.
            </div>
        `;
        // Override the grid layout for the horizontal 1-9 span
        card.querySelector('div:nth-child(2)').style.gridTemplateColumns = 'auto auto 1fr';
        helpOverlay.appendChild(card);
        helpOverlay.addEventListener('click', (e) => {
            if (e.target === helpOverlay) toggleHelpOverlay();
        });
        document.body.appendChild(helpOverlay);
    }

    function kbdStyle() {
        return `
            display:inline-block; padding:2px 8px; border-radius:4px;
            background:#f8f9fa; border:1px solid #cfd9de;
            font-family: ui-monospace, monospace; font-size:12px;
            min-width: 22px; text-align:center;
        `.replace(/\s+/g, ' ');
    }

    // ---------- self-diagnose ----------

    async function runDiagnostics() {
        const results = [];

        // Pick a sample tweet ID from the current page for the read test.
        const sampleArticle = document.querySelector('article');
        const sampleTweetId = sampleArticle ? tweetIdFromArticle(sampleArticle) : null;

        // Test 1: BookmarkFoldersSlice (read)
        if (sampleTweetId) {
            try {
                await gqlGet(OP_FOLDERS_FOR_TWEET, { tweet_id: sampleTweetId });
                results.push({ name: 'Folder lookup', op: OP_FOLDERS_FOR_TWEET, ok: true });
            } catch (err) {
                results.push({ name: 'Folder lookup', op: OP_FOLDERS_FOR_TWEET, ok: false, err });
            }
        } else {
            results.push({ name: 'Folder lookup', op: OP_FOLDERS_FOR_TWEET, ok: null, err: 'no sample tweet on page' });
        }

        // Tests 2-4: mutations — send intentionally invalid data, check we get a
        // server-level error (400/5xx) rather than a 404 that means "endpoint gone."
        async function probeMutation(op, bogusVars) {
            try {
                await gqlPost(op, bogusVars);
                // Unexpected success, but endpoint works.
                return { ok: true };
            } catch (err) {
                const msg = String(err.message || err);
                // HTTP 404 = endpoint hash is rotated / gone.
                if (msg.includes('404')) return { ok: false, err };
                // Any other error means the endpoint exists and responded.
                return { ok: true };
            }
        }

        results.push({ name: 'File to folder', op: OP_ADD_TO_FOLDER,
            ...(await probeMutation(OP_ADD_TO_FOLDER, { bookmark_collection_id: '0', tweet_id: '0' })) });
        results.push({ name: 'Remove from folder', op: OP_REMOVE_FROM_FOLDER,
            ...(await probeMutation(OP_REMOVE_FROM_FOLDER, { bookmark_collection_id: '0', tweet_id: '0' })) });
        results.push({ name: 'Create folder', op: OP_CREATE_FOLDER,
            ...(await probeMutation(OP_CREATE_FOLDER, { name: '' })) });

        return results;
    }

    function showDiagnostics(results) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(15,20,25,0.65);
            z-index: 9999998; display: flex; align-items: center; justify-content: center;
        `;
        const card = document.createElement('div');
        card.style.cssText = `
            background: #fff; color: #0f1419; padding: 20px 24px; border-radius: 12px;
            min-width: 360px; max-width: 520px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);
            font-size: 13px;
        `;
        const header = document.createElement('div');
        header.style.cssText = 'font-weight:bold; font-size:16px; margin-bottom:12px; color:#1d9bf0;';
        header.textContent = '🐟 Endpoint diagnostics';
        card.appendChild(header);

        results.forEach(r => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:10px; align-items:start; padding:6px 0; border-bottom:1px solid #eee;';
            const icon = document.createElement('div');
            icon.textContent = r.ok === true ? '✅' : r.ok === false ? '❌' : '⚠️';
            icon.style.cssText = 'font-size:16px; flex-shrink:0;';
            const body = document.createElement('div');
            body.style.cssText = 'flex:1;';
            const label = document.createElement('div');
            label.style.cssText = 'font-weight:600;';
            label.textContent = r.name;
            body.appendChild(label);
            const detail = document.createElement('div');
            detail.style.cssText = 'font-size:11px; color:#536471; font-family:ui-monospace,monospace; word-break:break-all;';
            detail.textContent = `${r.op.name} @ ${r.op.hash}${r.err ? ` — ${r.err.message || r.err}` : ''}`;
            body.appendChild(detail);
            row.appendChild(icon);
            row.appendChild(body);
            card.appendChild(row);
        });

        const anyBroken = results.some(r => r.ok === false);
        const note = document.createElement('div');
        note.style.cssText = `margin-top:12px; font-size:12px; color:${anyBroken ? '#b35900' : '#536471'};`;
        note.textContent = anyBroken
            ? 'One or more endpoints returned 404 — X may have rotated the GraphQL hash. You’ll need to capture the new fetch URL and update the script constants.'
            : 'All endpoints responding normally.';
        card.appendChild(note);

        const close = document.createElement('button');
        close.textContent = 'Close';
        close.style.cssText = `
            margin-top: 14px; padding: 8px 14px; border-radius: 6px;
            border: 1px solid #1d9bf0; background: #1d9bf0; color: #fff;
            cursor: pointer; font-weight: 600;
        `;
        close.addEventListener('click', () => overlay.remove());
        card.appendChild(close);

        overlay.appendChild(card);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ---------- observers & kickoff ----------

    const onMutation = debounce(() => {
        scanFoldersFromDOM();
        makePostsDraggable();
        makeFoldersDroppable();
        addHideButtons();
        applyFiltering();
    }, 200);

    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });

    function initialPass() {
        ensurePanel();
        scanFoldersFromDOM();
        makePostsDraggable();
        makeFoldersDroppable();
        addHideButtons();
        applyFiltering();
    }
    setTimeout(initialPass, 500);
    setTimeout(initialPass, 1500);
    setTimeout(initialPass, 3500);

    console.log(`%c✅ Bookmarktuna v${VERSION} ready.`, 'color:#1d9bf0');
})();
