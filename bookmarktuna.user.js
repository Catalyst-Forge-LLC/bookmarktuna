// ==UserScript==
// @name         Bookmarktuna - X Bookmarks Drag & Drop Organizer
// @namespace    https://github.com/Catalyst-Forge-LLC/bookmarktuna
// @version      4.3
// @description  Persistent folder cache (works even after scrolling far) + fully droppable panel + hover + auto-hide
// @author       AcmeGeek + Grok
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

    console.log('%c🐟 Bookmarktuna v4.3 loaded — persistent folder cache (scroll-proof)', 'color:#1d9bf0; font-weight:bold; font-size:16px');

    let draggedPost = null;
    let floatingPanel = null;
    let folderNames = [];   // ← cached forever once found

    function simulateClick(element) {
        if (!element) return;
        element.scrollIntoView({ block: 'center' });
        element.click();
    }

    // Collect folders once (with retries)
    function collectFolders() {
        if (folderNames.length > 0) return; // already cached

        const tabs = document.querySelectorAll('a[href^="/i/bookmarks/"], a[data-testid="pivot"], a[role="tab"]');

        console.log(`🔍 v4.3: Found ${tabs.length} potential folder tabs`);

        tabs.forEach(tab => {
            const nameSpan = tab.querySelector('span.css-1jxf684') || tab.querySelector('span');
            const name = (nameSpan ? nameSpan.textContent : tab.textContent || '').trim();
            if (name && name !== 'All Bookmarks' && !name.includes('Create') && !name.includes('Search')) {
                folderNames.push(name);
            }
        });

        folderNames = [...new Set(folderNames)];
        console.log(`📋 v4.3: Cached ${folderNames.length} folders:`, folderNames);
    }

    function createFloatingPanel() {
        if (floatingPanel) return;

        floatingPanel = document.createElement('div');
        floatingPanel.style.cssText = `
            position: fixed; top: 20%; right: 40px; background: #ffffff; border: 3px solid #1d9bf0;
            border-radius: 12px; box-shadow: 0 15px 35px rgba(29,155,240,0.3); padding: 16px; z-index: 999999;
            min-width: 260px; max-height: 70vh; overflow-y: auto; font-size: 15px;`;
        floatingPanel.innerHTML = `<div style="font-weight: bold; margin-bottom: 12px; color: #1d9bf0; text-align: center;">📌 Drop here or click a folder</div><div id="panel-content"></div>`;
        document.body.appendChild(floatingPanel);

        const content = floatingPanel.querySelector('#panel-content');

        content.innerHTML = '';

        folderNames.forEach(name => {
            const btn = document.createElement('div');
            btn.style.cssText = `padding: 12px 16px; margin: 6px 0; background: #f8f9fa; border-radius: 8px; cursor: pointer; border: 1px solid #e0e0e0;`;
            btn.textContent = name;

            btn.addEventListener('click', () => handleAddToFolder(name));

            btn.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                btn.style.backgroundColor = 'rgba(29, 155, 240, 0.2)';
            });
            btn.addEventListener('dragleave', () => btn.style.backgroundColor = '');
            btn.addEventListener('drop', e => {
                e.preventDefault();
                btn.style.backgroundColor = '';
                handleAddToFolder(name);
            });

            content.appendChild(btn);
        });

        // Whole panel is also droppable
        floatingPanel.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            floatingPanel.style.borderColor = '#1d9bf0';
        });
        floatingPanel.addEventListener('dragleave', () => floatingPanel.style.borderColor = '');
        floatingPanel.addEventListener('drop', e => {
            e.preventDefault();
            floatingPanel.style.borderColor = '';
            if (folderNames.length > 0) handleAddToFolder(folderNames[0]);
        });
    }

    function removeFloatingPanel() {
        if (floatingPanel) {
            floatingPanel.remove();
            floatingPanel = null;
        }
    }

    function handleAddToFolder(folderName) {
        if (!draggedPost) return;
        const shareBtn = Array.from(draggedPost.querySelectorAll('button, div[role="button"]')).find(el => {
            const label = el.getAttribute('aria-label') || '';
            return label.toLowerCase().includes('share');
        });
        if (shareBtn) {
            shareBtn.click();
            pollForFolderMenu(true, folderName);
        }
    }

    // CLICK-TO-FOLDER
    document.addEventListener('click', function (e) {
        const removeBtn = e.target.closest('[data-testid="removeBookmark"]');
        if (!removeBtn) return;
        e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();

        const post = removeBtn.closest('article');
        if (!post) return;

        const shareBtn = Array.from(post.querySelectorAll('button, div[role="button"]')).find(el => {
            const label = el.getAttribute('aria-label') || '';
            return label.toLowerCase().includes('share');
        });

        if (shareBtn) {
            shareBtn.click();
            pollForFolderMenu();
        }
    }, true);

    // DRAG & DROP
    function makePostsDraggable() {
        document.querySelectorAll('article:not([data-drag-enabled])').forEach(post => {
            post.dataset.dragEnabled = 'true';
            post.setAttribute('draggable', 'true');

            post.addEventListener('dragstart', (e) => {
                draggedPost = post;
                createFloatingPanel();
            });

            post.addEventListener('dragend', () => {
                draggedPost = null;
                removeFloatingPanel();
            });
        });
    }

    function makeFoldersDroppable() {
        const tabs = document.querySelectorAll('a[href^="/i/bookmarks/"]');
        tabs.forEach(tab => {
            const nameSpan = tab.querySelector('span');
            const text = (nameSpan ? nameSpan.textContent : tab.textContent || '').trim();
            if (!text || text === 'All Bookmarks' || text.includes('Create') || text.includes('Search')) return;

            if (tab.dataset.droppable) return;
            tab.dataset.droppable = 'true';

            tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
            tab.addEventListener('drop', e => {
                e.preventDefault();
                if (!draggedPost) return;
                handleAddToFolder(text);
            });
        });
    }

    function pollForFolderMenu(autoSelect = false, folderName = null) {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            const menuItems = document.querySelectorAll('div[role="menuitem"], [role="menu"] div[role="button"]');
            const folderOption = Array.from(menuItems).find(el => (el.textContent || '').includes('Bookmark to Folder'));

            if (folderOption) {
                clearInterval(poll);
                folderOption.click();
                if (autoSelect && folderName) {
                    setTimeout(() => autoSelectFolderInModal(folderName), 900);
                }
            } else if (attempts > 60) clearInterval(poll);
        }, 40);
    }

    function autoSelectFolderInModal(folderName) {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            const buttons = document.querySelectorAll('button[role="button"]');
            const target = Array.from(buttons).find(btn => {
                const text = (btn.textContent || '').trim();
                return text === folderName || text.includes(folderName);
            });

            if (target) {
                clearInterval(poll);
                simulateClick(target);

                if (draggedPost) {
                    draggedPost.style.transition = 'opacity 0.8s ease';
                    draggedPost.style.opacity = '0.1';
                    draggedPost.style.pointerEvents = 'none';
                }
            } else if (attempts > 50) clearInterval(poll);
        }, 80);
    }

    const observer = new MutationObserver(() => {
        makePostsDraggable();
        makeFoldersDroppable();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        collectFolders();
        makePostsDraggable();
        makeFoldersDroppable();
    }, 1500);

    console.log('%c✅ Bookmarktuna v4.2 ready! Drag any post — the floating panel should now always show your folders.', 'color:#1d9bf0');
})();
