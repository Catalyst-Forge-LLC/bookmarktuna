// ==UserScript==
// @name         Bookmarktuna - X Bookmarks Drag & Drop Organizer
// @namespace    https://github.com/Catalyst-Forge-LLC/bookmarktuna
// @version      2.1
// @description  Drag any post onto a sidebar folder OR click the blue bookmark icon → instant folder picker. Makes organizing hundreds of bookmarks actually fun (finetuna-style).
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

    console.log('%c🐟 Bookmarktuna v2.1 loaded — drag & drop + click-to-folder ready', 'color:#1d9bf0; font-weight:bold; font-size:16px');

    let draggedPost = null;
    let targetFolderName = null;

    // ==================== CLICK-TO-FOLDER ====================
    document.addEventListener('click', function (e) {
        const removeBtn = e.target.closest('[data-testid="removeBookmark"]');
        if (!removeBtn) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();

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

    // ==================== DRAG & DROP ====================
    function makePostsDraggable() {
        document.querySelectorAll('article:not([data-drag-enabled])').forEach(post => {
            post.dataset.dragEnabled = 'true';
            post.setAttribute('draggable', 'true');

            post.addEventListener('dragstart', (e) => {
                draggedPost = post;
                e.dataTransfer.effectAllowed = 'move';
                console.log('📤 Bookmarktuna: Drag started');
            });

            post.addEventListener('dragend', () => {
                draggedPost = null;
                targetFolderName = null;
            });
        });
    }

    function makeFoldersDroppable() {
        const folderItems = document.querySelectorAll('a[role="link"], div[role="link"]');
        
        folderItems.forEach(item => {
            const text = (item.textContent || '').trim();
            if (!text || text === 'All Bookmarks' || text.includes('Create')) return;

            if (item.dataset.droppable) return;
            item.dataset.droppable = 'true';

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.style.backgroundColor = 'rgba(29, 155, 240, 0.15)';
            });

            item.addEventListener('dragleave', () => {
                item.style.backgroundColor = '';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.style.backgroundColor = '';

                if (!draggedPost) return;

                targetFolderName = text;
                console.log(`📥 Bookmarktuna: Dropped on folder "${targetFolderName}"`);

                const shareBtn = Array.from(draggedPost.querySelectorAll('button, div[role="button"]')).find(el => {
                    const label = el.getAttribute('aria-label') || '';
                    return label.toLowerCase().includes('share');
                });

                if (shareBtn) {
                    shareBtn.click();
                    pollForFolderMenu(true);
                }
            });
        });
    }

    function pollForFolderMenu(autoSelect = false) {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            const menuItems = document.querySelectorAll('div[role="menuitem"], [role="menu"] div[role="button"]');
            const folderOption = Array.from(menuItems).find(el =>
                (el.textContent || '').includes('Bookmark to Folder')
            );

            if (folderOption) {
                clearInterval(poll);
                folderOption.click();

                if (autoSelect && targetFolderName) {
                    setTimeout(() => autoSelectFolderInModal(targetFolderName), 120);
                }
            } else if (attempts > 50) {
                clearInterval(poll);
            }
        }, 40);
    }

    function autoSelectFolderInModal(folderName) {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            const items = document.querySelectorAll('div[role="menuitem"], div[role="listitem"]');
            const target = Array.from(items).find(el =>
                (el.textContent || '').trim() === folderName
            );

            if (target) {
                clearInterval(poll);
                target.click();
                targetFolderName = null;
            } else if (attempts > 30) {
                clearInterval(poll);
            }
        }, 50);
    }

    // Auto-refresh on infinite scroll
    const observer = new MutationObserver(() => {
        makePostsDraggable();
        makeFoldersDroppable();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        makePostsDraggable();
        makeFoldersDroppable();
    }, 1000);

    console.log('%c✅ Bookmarktuna ready! Drag posts to sidebar folders or click the blue bookmark icon.', 'color:#1d9bf0');
})();
