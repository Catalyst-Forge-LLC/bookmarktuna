# 🐟 Bookmarktuna

**The drag-and-drop bookmark organizer X (Twitter) should have shipped.**

Tired of the painful **Share → Bookmark to Folder** dance with hundreds (or thousands) of bookmarks?  
Bookmarktuna turns the All Bookmarks page into a delightful, fast, and actually usable organizer.

### ✨ Key Features

- **Floating draggable panel** — always visible, even after scrolling far down
- **True drag & drop** — drag any post onto a folder in the panel (or onto the top tabs)
- **Click the blue bookmark icon** — instantly opens the folder picker (no more accidental removal)
- **Auto-hide organized posts** — cleaned-up list so you only see what still needs organizing
- **Undo** — accidentally dropped in the wrong folder? Press `U` (or click the toast) within 8 seconds
- **Pinned folders** — pin your most-used folders so they stay fixed at the top
- **Keyboard shortcuts** — `1–9` and `0` to quick-file to pinned folders, `H` to hide, `?` for help
- **Create new folders** inline without leaving the flow
- **Persistent cache** — your folders are remembered even after heavy scrolling
- **Lightweight & fast** — uses direct GraphQL calls where possible

### 🚀 Installation (30 seconds)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
2. Click this direct link to install:  
   **[Install Bookmarktuna](https://raw.githubusercontent.com/Catalyst-Forge-LLC/bookmarktuna/main/bookmarktuna.user.js)**
3. Go to [x.com/i/bookmarks](https://x.com/i/bookmarks) and refresh

Done. Start dragging! 🐟

### How to Use

- **Drag & drop** — Drag any post onto the floating panel or a top folder tab
- **Click a folder** in the floating panel to file the top visible post instantly
- **Pin or unpin** folders with the pin icon in the panel
- **Blue bookmark icon** — click it to open the normal folder picker (improved behavior)
- **Auto-hide** — successfully organized posts fade and hide automatically
- **Undo** — press `U` or click the undo toast if you make a mistake
- **Keyboard** — `1`–`9` and `0` for pinned folders, `H` to hide current post

### Keyboard Shortcuts

| Shortcut     | Action                          |
|--------------|---------------------------------|
| `1`–`9`, `0` | Add to pinned folders 1–10      |
| `H`          | Hide current post               |
| `U`          | Undo last action                |
| `?`          | Show this help                  |

### Why Bookmarktuna?

Because we already have [finetuna](https://github.com/Catalyst-Forge-LLC/finetuna) — same playful energy, same “make painful things delightful” philosophy.

Made with ❤️ by AcmeGeek + Grok + Claude.

**License:** MIT  
**Status:** Actively used and maintained

---

*Enjoy finally being able to organize your bookmarks like a sane person.*


### Pinning

- Click the pin icon on any folder in the floating panel to pin or unpin it
- Pinned folders are shown first, alphabetically, with stable shortcut badges
- Shortcut mapping is fixed: `1` through `9`, then `0` for the 10th pinned folder
- Unpinned folders remain fully clickable and draggable, and still sort by recent use
