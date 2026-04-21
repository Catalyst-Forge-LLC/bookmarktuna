// ==UserScript==
// @name         Bookmarktuna - X Bookmarks Drag & Drop Organizer
// @namespace    https://github.com/Catalyst-Forge-LLC/bookmarktuna
// @version      3.0
// @description  Drag any post onto a top folder tab OR click the blue bookmark icon → instant folder picker. (v3.0: gentler click + stay on bookmarks page)
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

    console.log('%c🐟 Bookmarktuna v3.0 ready — drag & drop + stay on bookmarks page', 'color:#1d9bf0; font-weight:bold; font-size:16px');

    let draggedPost = null;

    // Gentler click to reduce navigation side-effects
    function simulateClick(element) {
        if (!element) return;
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
    }

    // CLICK-TO-FOLDER (unchanged)
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

    // DRAG & DROP
    function makePostsDraggable() {
        document.querySelectorAll('article:not([data-drag-enabled])').forEach(post => {
            post.dataset.dragEnabled = 'true';
            post.setAttribute('draggable', 'true');

            post.addEventListener('dragstart', (e) => {
                draggedPost = post;
            });

            post.addEventListener('dragend', () => { draggedPost = null; });
        });
    }

    function makeFoldersDroppable() {
        const folderItems = document.querySelectorAll('a[data-testid="pivot"]');

        folderItems.forEach(item => {
            const nameSpan = item.querySelector('span') || item;
            const text = (nameSpan.textContent || '').trim();

            if (!text || text === 'All Bookmarks' || text.includes('Create') || text.includes('Search')) return;

            if (item.dataset.droppable) return;
            item.dataset.droppable = 'true';

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.style.backgroundColor = 'rgba(29, 155, 240, 0.2)';
                item.style.borderBottom = '3px solid #1d9bf0';
            });

            item.addEventListener('dragleave', () => {
                item.style.backgroundColor = '';
                item.style.borderBottom = '';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.style.backgroundColor = '';
                item.style.borderBottom = '';

                if (!draggedPost) return;

                const folderName = text;
                const shareBtn = Array.from(draggedPost.querySelectorAll('button, div[role="button"]')).find(el => {
                    const label = el.getAttribute('aria-label') || '';
                    return label.toLowerCase().includes('share');
                });

                if (shareBtn) {
                    shareBtn.click();
                    pollForFolderMenu(true, folderName);
                }
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
            } else if (attempts > 60) {
                clearInterval(poll);
            }
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

                // Force stay on bookmarks page after successful add
                setTimeout(() => {
                    if (!window.location.pathname.includes('/i/bookmarks')) {
                        window.location.href = 'https://x.com/i/bookmarks';
                    }
                }, 800);
            } else if (attempts > 50) {
                clearInterval(poll);
            }
        }, 80);
    }

    const observer = new MutationObserver(() => {
        makePostsDraggable();
        makeFoldersDroppable();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        makePostsDraggable();
        makeFoldersDroppable();
    }, 1000);
})();
