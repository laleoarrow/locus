# Store submission pack — Locus / 文迹

Everything needed to publish to **Microsoft Edge Add-ons** and the **Chrome Web
Store**. Publishing is what makes updates automatic: sideloaded (unpacked)
extensions are never auto-updated by the browser, store-installed ones are.

Only you can perform the submission itself — it needs your Microsoft / Google
account. Everything up to the upload is prepared here.

## 1. Build the packages

```bash
pnpm zip:store        # → .output/locus-<version>-chrome-store.zip  (Chrome Web Store)
pnpm zip:store:edge   # → .output/locus-<version>-edge-store.zip    (Edge Add-ons)
```

The store scripts keep WXT in production mode and use a separate build flag to
omit the manifest `key`: the stores assign and manage the extension ID
themselves. They also verify the ZIP before returning successfully. Do **not**
upload the sideload zips from the GitHub release — those carry a pinned key.

## 2. Assets (already generated in `assets/`)

| Asset | Size | File | Used by |
|---|---|---|---|
| Icon | 128×128 | `public/icon/128.png` | both |
| Store logo | 300×300 | `store-logo-300.png` | Edge |
| Small promo tile | 440×280 | `store-promo-440x280.png` | Chrome |
| Screenshot 1 | 1280×800 | `store-shot-1-toolbar.png` | both |
| Screenshot 2 | 1280×800 | `store-shot-2-note.png` | both |
| Screenshot 3 | 1280×800 | `store-shot-3-figure.png` | both |
| Screenshot 4 | 1280×800 | `store-shot-4-panel.png` | both |
| Screenshot 5 | 1280×800 | `store-shot-5-library.png` | both |

Regenerate screenshots after UI changes:

```bash
# README/gallery assets plus the 1280×800 Library store screenshot
pnpm build && node scripts/readme-shots.mjs

# Store screenshots 1–4
node e2e/serve.mjs &
pnpm build:e2e && node scripts/store-shots.mjs
```

## 3. Listing copy

**Name:** `Locus / 文迹`

**Short description (English, ≤132 chars):**

> Highlight and annotate what you read. Local-first, no account required, with
> optional WebDAV sync you control.

**简短说明（中文）：**

> 阅读时高亮与做笔记。数据本地优先、无需注册，可选自建 WebDAV 同步。

**Category:** Productivity · **Language:** English, 中文（简体）

### Detailed description (English)

```
Locus is a quiet annotation layer for reading on the web. Select text, pick a
colour, and write a note in Markdown. That's it — no account, no dashboard, no
upsell.

WHAT IT DOES
• Select text to get a compact toolbar with three colours; press 1, 2 or 3 to
  pick one from the keyboard. Add page-specific colours without cluttering
  other pages.
• Click a highlight to write a note in Markdown, with a live preview.
• Select a figure by dragging across it or from just before it to just after it,
  then ring it in colour. Ordinary clicks still open the page's link or image
  viewer.
• A side panel lists every annotation on the page; click one to scroll to it.
• Open the Library to search every annotation across sites, travel through a
  day-by-day timeline, edit notes, restore deleted items, or replace one
  annotation colour across the whole live library.
• Cmd/Ctrl+Z undoes your last highlight. Deletes are undoable, never silent.
• Highlights come back after reload, and keep working when the page changes:
  each one records its text, surrounding context, character offsets and DOM
  path, and is re-located by whichever still matches. If a passage is genuinely
  gone, the annotation is shown as "detached" rather than quietly discarded.
• Same paper on a different site? Locus reads the page's DOI and offers to jump
  to the version you already annotated — publisher page, PMC mirror, preprint.
• Works on every page by default. Don't want it somewhere? Hold Cmd/Ctrl, hover
  the right edge of the toolbar and click ✕ — or use the popup switch.

YOUR DATA STAYS YOURS
Annotations live in your browser's local database. There is no Locus server and
no account. Nothing about the pages you read is sent anywhere.

Two optional features reach the network, both switchable off:
• Sync — you supply a WebDAV folder (Nutstore/坚果云, Nextcloud, any WebDAV
  host). Your annotations sync through storage you own. Credentials are stored
  locally and are never included in exported backup files.
• Update check — fetches release information from GitHub to tell you when a new
  version exists. No information about you is sent.

You can also export your whole library to a JSON file at any time, and import it
back on another machine.

WHAT IT IS NOT
Not a reference manager: no bibliography, no citation formatting, no AI, no
tags, no collaboration. Just highlights and notes that stay where you put them.

Open source: https://github.com/laleoarrow/locus
```

### 详细说明（中文）

```
Locus / 文迹 是一个安静的网页阅读标注层。选中文字、选颜色、用 Markdown 写笔记，
就这些——不需要注册，没有仪表盘，不推销任何东西。

功能
• 选中文字弹出三色工具条，按 1 / 2 / 3 即可用键盘选色；自定义颜色只属于当前页面，不会挤满其他页面。
• 点击高亮即可写 Markdown 笔记，带实时预览。
• 在插图上拖动，或从图片前拖到图片后选中它，即可加一圈彩色高亮环；普通单击仍用于打开
  网页原有的链接或图片查看器。
• 侧边栏列出本页所有标注，点击即滚动定位并闪烁提示。
• 打开资料库可跨网站搜索全部标注，沿逐日时间线回顾阅读历程，编辑笔记、恢复已删除项目，
  或在整个未删除资料库中批量替换一种标注颜色。
• Cmd/Ctrl+Z 撤销上一次高亮；删除可撤销，不会静默丢失。
• 刷新后标注自动恢复，页面结构改变也能重新定位：每条标注同时记录原文、上下文、
  字符位置与 DOM 路径，按可用的线索依次恢复。若原文确实已不存在，标注会显示为
  “detached（已脱锚）”，而不会被悄悄删掉。
• 同一篇论文在不同网站？Locus 会读取页面 DOI，当你打开另一个版本（出版社页面、
  PMC 镜像、预印本）时提示跳回你标注过的那个版本。
• 默认在所有页面可用。不想在某站启用？按住 Cmd/Ctrl 悬停工具条右缘点击 ✕，
  或用弹窗中的开关。

数据归你所有
标注保存在浏览器本地数据库中。没有 Locus 服务器，也没有账号系统。你读了什么页面，
不会被发送到任何地方。

只有两项可选功能会联网，且都可关闭：
• 同步——由你提供 WebDAV 目录（坚果云、Nextcloud 等任意 WebDAV 服务），标注通过
  你自己的存储空间同步。凭据仅保存在本地，且永不写入导出的备份文件。
• 更新检查——从 GitHub 获取版本信息以提示有新版本，不发送任何你的信息。

你也可以随时把整个标注库导出为 JSON 文件，并在另一台设备上导入。

它不是什么
不是文献管理器：没有参考文献、没有引文格式、没有 AI、没有标签、没有协作。
只有留在原处的高亮和笔记。

开源地址：https://github.com/laleoarrow/locus
```

## 4. Privacy & permission justifications

Both stores require a reason for every permission. Copy these verbatim.

**Single purpose:**

> Locus lets the user highlight passages and attach notes to web pages they
> read, and stores those annotations locally so they reappear on the next visit.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's annotations, colours and preferences locally. |
| `sidePanel` | Shows the list of annotations for the current page in the browser's side panel. |
| `scripting` | Registers the content script that renders highlights on pages the user has enabled. |
| `tabs` | Reads the active tab's URL so the side panel can show that page's annotations, and messages the tab to scroll to a highlight. |
| `alarms` | Schedules the periodic WebDAV sync and the optional update check. |
| `host_permissions` (`http://*/*`, `https://*/*`) | Annotation must work on any article the user chooses to read; the user can disable any site individually. Page content is only read to locate highlights and is never transmitted. |

**Remote code:** No. All code is bundled in the package; nothing is fetched and
executed at runtime.

**Data collection disclosures** — declare *none* for every category. Supporting
statement:

> Locus has no backend and no account system. Annotations are stored in the
> browser's local IndexedDB. Page content never leaves the device. WebDAV sync
> is off until the user configures a server and enables it. Update checking is
> enabled by default and requests only public release metadata from the GitHub
> API; it sends no user data and can be switched off at any time.

**Privacy policy URL:** `https://github.com/laleoarrow/locus/blob/main/docs/PRIVACY.md`

## 5. Submission steps

**Edge Add-ons** (free, no registration fee)
1. Sign in at <https://partner.microsoft.com/dashboard/microsoftedge/overview>.
2. *Create new extension* → upload `locus-<version>-edge-store.zip`.
3. Fill in listing copy (§3), upload the 300×300 logo and the five screenshots.
4. Availability: all markets. Answer the privacy questions with §4.
5. Submit. First review is typically a few days to about two weeks.

**Chrome Web Store** (one-time US$5 developer registration)
1. Sign in at <https://chrome.google.com/webstore/devconsole>, pay the one-time fee if this is a first submission.
2. *New item* → upload `locus-<version>-chrome-store.zip`.
3. Fill in listing copy (§3), upload the 440×280 promo tile and screenshots.
4. Complete *Privacy practices* using §4, and set the privacy policy URL.
5. Submit for review (usually a few days).

## 6. After going live

- Add the store links to `README.md` in place of the sideload instructions.
- Store-installed extensions auto-update, so the in-app update check becomes
  redundant for those users; it stays for anyone still sideloading.
- **One-off migration:** installing from the store creates a new extension ID,
  so its database starts empty. Before switching, export a backup from the side
  panel (Backup → Export) and import it after installing from the store.

## 7. Current submission status

- 2026-08-01: v0.7.1 is published as GitHub Latest and the final keyless Edge
  upload package is ready at
  `~/Desktop/locus-store-upload/1-PACKAGE-edge-上传这个.zip` (SHA-256
  `8dcb6351822d898fb19582522faed51b26e9c6cea475795ce98e64240d116066`).
- Microsoft Partner Center is still at developer **Email Verification — In
  Progress (step 2 of 4)**, so no Edge listing has been submitted and there is
  no store review date yet. The final Submit/Publish action remains with the
  user.
- Chrome Web Store submission is paused by the user.
