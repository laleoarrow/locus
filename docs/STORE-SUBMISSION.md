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
• Select annotation rows to change colour, append or replace notes, delete or
  restore them together. Only the reviewed selection changes.
• Keep editable main content for each page, separate from annotation notes.
  Write it manually or request an AI draft using your own API address, model
  and key. Review and save the draft when ready; the prompt is editable.
• Auto toolbar placement follows late or moving in-page floating controls and
  looks for nearby free space when both above and below are occupied.
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
Annotations and saved page summaries live in your browser's local database.
There is no Locus server, account system or telemetry. The optional features
below transmit only the data required for the action you enable or request.

Three optional, user-controlled features reach the network:
• Sync — you supply a WebDAV folder (Nutstore/坚果云, Nextcloud, any WebDAV
  host). Your annotations and saved page summaries sync through storage you
  control. Credentials stay local and are excluded from backups.
• Update check — fetches release information from GitHub to tell you when a new
  version exists. No annotation content is included.
• AI organisation — off by default. After you configure an API, an explicit
  generation request sends the chosen page's title, URL, saved live excerpts
  and notes to that endpoint. No full article is fetched for this request.
  Results are editable drafts until saved. API keys/configuration stay local
  and are excluded from backups and WebDAV sync; provider terms apply.

You can also export your whole library to a JSON file at any time, and import it
back on another machine.

WHAT IT IS NOT
Not a reference manager: no bibliography or citation formatting. Locus helps
you keep and organise highlights, notes and page content while reading.

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
• 勾选标注后，可统一改色、追加或替换笔记、删除或恢复；操作只影响确认的选中项目。
• 为每个页面保存独立于批注的“主要内容”。可手动编辑，也可配置自己的 API 地址、模型、
  API key 和提示词，请求生成可编辑草稿，检查后再保存。
• 自动位置会跟随延迟出现或移动的网页内浮动工具栏，上下都被占用时寻找附近空位。
• Cmd/Ctrl+Z 撤销上一次高亮；删除可撤销，不会静默丢失。
• 刷新后标注自动恢复，页面结构改变也能重新定位：每条标注同时记录原文、上下文、
  字符位置与 DOM 路径，按可用的线索依次恢复。若原文确实已不存在，标注会显示为
  “detached（已脱锚）”，而不会被悄悄删掉。
• 同一篇论文在不同网站？Locus 会读取页面 DOI，当你打开另一个版本（出版社页面、
  PMC 镜像、预印本）时提示跳回你标注过的那个版本。
• 默认在所有页面可用。不想在某站启用？按住 Cmd/Ctrl 悬停工具条右缘点击 ✕，
  或用弹窗中的开关。

数据归你所有
标注和已保存的页面主要内容保存在浏览器本地数据库中。没有 Locus 服务器、账号系统或
遥测。以下可选功能仅发送你启用或主动请求的操作所需的数据。

三项可选功能会联网，均由你控制：
• 同步——由你提供 WebDAV 目录（坚果云、Nextcloud 等任意 WebDAV 服务），标注和已保存
  的页面主要内容通过你自己的存储空间同步。凭据仅保存在本地，不写入备份。
• 更新检查——从 GitHub 获取版本信息以提示有新版本，不发送批注内容。
• AI 整理——默认关闭。配置 API 后，仅在你主动请求生成时，将所选页面的标题、网址、
  已保存且未删除的摘录和笔记发送到指定 API；不会为此抓取全文。结果先作为草稿展示，
  保存后才写入页面主要内容。API key 和配置仅存本地，不进入备份或 WebDAV 同步；
  服务商的数据处理和计费规则适用。

你也可以随时把整个标注库导出为 JSON 文件，并在另一台设备上导入。

它不是什么
不是文献管理器，不提供参考文献和引文格式功能。Locus 帮助你在阅读时保存和整理
高亮、笔记与页面主要内容。

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
| `host_permissions` (`http://*/*`, `https://*/*`) | Annotation works on arbitrary reading pages, with per-site disable controls. Optional sync and explicitly requested AI generation connect to user-configured HTTP(S) endpoints; AI receives the chosen page's title, URL and saved excerpts/notes only for that request. |

**Remote code:** No. All code is bundled in the package; nothing is fetched and
executed at runtime.

**Data handling disclosures** — describe the user-controlled transfers below
accurately in each store's current questionnaire. Do not use a blanket claim
that no page data ever leaves the device. Supporting statement:

> Locus has no hosted backend, account system or telemetry. Annotations and
> saved page summaries are stored in local IndexedDB. Optional WebDAV sync
> transfers the library to the user's configured server. AI is off by default;
> only an explicit generation request sends the chosen page's title, URL, saved
> live excerpts and notes to the configured API. Generated text is a draft until
> saved. API keys and sync credentials stay in local extension storage and are
> excluded from backups/sync. The optional update check fetches public GitHub
> release metadata without annotation content.

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

- 2026-08-01: v0.7.2 is published as GitHub Latest and the final keyless Edge
  upload package is ready at
  `~/Desktop/locus-store-upload/1-PACKAGE-edge-上传这个.zip` (SHA-256
  `0a8289f29931382c64aa14848211c2b63c6fd16f3a2f88f8beeb47a11344f5b4`).
- Microsoft Partner Center is still at developer **Email Verification — In
  Progress (step 2 of 4)**, so no Edge listing has been submitted and there is
  no store review date yet. The final Submit/Publish action remains with the
  user.
- Chrome Web Store submission is paused by the user.
