/**
 * Every text field needed to submit Locus to Edge Add-ons and the Chrome Web
 * Store, in submission order. Consumed by scripts/store-copy.mjs, which puts one
 * field at a time on the clipboard so each can be pasted with a single ⌘V.
 *
 * Keep in sync with docs/STORE-SUBMISSION.md (that file explains the process;
 * this one is the literal copy).
 */

const DESCRIPTION_EN = `Locus is a quiet annotation layer for reading on the web. Select text, pick a colour, and write a note in Markdown. That's it — no account, no dashboard, no upsell.

WHAT IT DOES
• Select text to get a compact toolbar with three colours; press 1, 2 or 3 to pick one from the keyboard. Add page-specific colours without cluttering other pages.
• Click a highlight to write a note in Markdown, with a live preview.
• Click a figure to ring it in colour — images are annotatable too.
• A side panel lists every annotation on the page; click one to scroll to it.
• Open the Library to search every annotation across sites, group by page, site or timeline, edit notes, and restore deleted items.
• Cmd/Ctrl+Z undoes your last highlight. Deletes are undoable, never silent.
• Highlights come back after reload, and keep working when the page changes: each one records its text, surrounding context, character offsets and DOM path, and is re-located by whichever still matches. If a passage is genuinely gone, the annotation is shown as "detached" rather than quietly discarded.
• Same paper on a different site? Locus reads the page's DOI and offers to jump to the version you already annotated — publisher page, PMC mirror, preprint.
• Works on every page by default. Don't want it somewhere? Hold Cmd/Ctrl, hover the right edge of the toolbar and click the ✕ — or use the popup switch.
• Sync between devices through a WebDAV folder you own (Nutstore, Nextcloud, any WebDAV host), or export and import a plain JSON backup.

YOUR DATA STAYS YOURS
Annotations live in your browser's local database. There is no Locus server and no account. Nothing about the pages you read is sent anywhere.

Two optional features reach the network, both switchable off:
• Sync — you supply the WebDAV folder, so your annotations travel through storage you control. Credentials are stored locally and are never included in exported backup files.
• Update check — fetches release information from GitHub to tell you when a new version exists. No information about you is sent.

WHAT IT IS NOT
Not a reference manager: no bibliography, no citation formatting, no AI, no tags, no collaboration. Just highlights and notes that stay where you put them.

Open source: https://github.com/laleoarrow/locus`;

const DESCRIPTION_ZH = `Locus / 文迹 是一个安静的网页阅读标注层。选中文字、选颜色、用 Markdown 写笔记，就这些——不需要注册，没有仪表盘，不推销任何东西。

功能
• 选中文字弹出三色工具条，按 1 / 2 / 3 即可用键盘选色；自定义颜色只属于当前页面，不会挤满其他页面。
• 点击高亮即可写 Markdown 笔记，带实时预览。
• 点击插图可为图片加一圈彩色高亮环。
• 侧边栏列出本页所有标注，点击即滚动定位并闪烁提示。
• 打开资料库可跨网站搜索全部标注，按页面、站点或时间线分组，编辑笔记并恢复已删除项目。
• Cmd/Ctrl+Z 撤销上一次高亮；删除可撤销，不会静默丢失。
• 刷新后标注自动恢复，页面结构改变也能重新定位：每条标注同时记录原文、上下文、字符位置与 DOM 路径，按可用的线索依次恢复。若原文确实已不存在，标注会显示为「detached（已脱锚）」，而不会被悄悄删掉。
• 同一篇论文在不同网站？Locus 会读取页面 DOI，当你打开另一个版本（出版社页面、PMC 镜像、预印本）时提示跳回你标注过的那个版本。
• 默认在所有页面可用。不想在某站启用？按住 Cmd/Ctrl 悬停工具条右缘点击 ✕，或用弹窗中的开关。
• 可通过你自己的 WebDAV 目录（坚果云、Nextcloud 等）在多设备间同步，也可导出/导入 JSON 备份。

数据归你所有
标注保存在浏览器本地数据库中。没有 Locus 服务器，也没有账号系统。你读了什么页面，不会被发送到任何地方。

只有两项可选功能会联网，且都可关闭：
• 同步——由你提供 WebDAV 目录，标注通过你自己的存储空间同步。凭据仅保存在本地，且永不写入导出的备份文件。
• 更新检查——从 GitHub 获取版本信息以提示有新版本，不发送任何你的信息。

它不是什么
不是文献管理器：没有参考文献、没有引文格式、没有 AI、没有标签、没有协作。只有留在原处的高亮和笔记。

开源地址：https://github.com/laleoarrow/locus`;

const CERTIFICATION_NOTES = `Locus adds highlighting and notes to web pages the user reads. All data is stored locally in IndexedDB; there is no backend and no account.

HOW TO TEST
1. Open any article (for example https://en.wikipedia.org/wiki/Anesthesiology).
2. Select a sentence — a small toolbar appears with three colour circles. Click one, or press 1/2/3, to highlight.
3. Click the highlight you just made — a note editor opens; type Markdown and press Save (or Cmd/Ctrl+Enter).
4. Reload the page: the highlight and note are restored.
5. Click the extension icon, then "Open annotation panel" to see the side panel list. Clicking an entry scrolls to and flashes that highlight.
6. Click the extension icon, then "All annotations" to open the Library. Search for the saved note and switch between page, site and timeline grouping.
7. Click an image on the page to ring it in colour.
8. To disable a site: hold Cmd/Ctrl and move the pointer to the right edge of the selection toolbar; an ✕ slides out. Clicking it disables Locus for that origin. The popup has the same switch.

ABOUT THE BROAD HOST PERMISSION
Annotation has to work on whatever the user chooses to read, so the extension requests http://*/* and https://*/*. Page text is read only to locate a highlight and is never transmitted. Any site can be disabled individually, and disabled sites are left untouched.

NETWORK ACCESS (both optional and user-controlled)
- WebDAV sync: uploads/downloads one JSON file of the user's own annotations to a WebDAV server the user configures. No default server exists.
- Update check: enabled by default so sideloaded users can learn about new versions; sends a GET to api.github.com for the latest release tag. Sends no user data and can be switched off at any time.

No remote code is loaded or executed; everything is bundled in the package.`;

const DATA_STATEMENT = `Locus has no backend and no account system. Annotations are stored in the browser's local IndexedDB. Page content never leaves the device. WebDAV sync is off until the user configures a server and enables it. Update checking is enabled by default and requests only public release metadata from the GitHub API; it sends no user data and can be switched off at any time.`;

export const FIELDS = [
  // ── Listing basics ──
  {
    key: 'name',
    where: 'both',
    label: 'Extension name / 名称',
    value: 'Locus / 文迹',
  },
  {
    key: 'summary-en',
    where: 'both',
    label: 'Short description (English, ≤132 chars)',
    value:
      'Highlight and annotate what you read. Local-first, no account required, with optional WebDAV sync you control.',
  },
  {
    key: 'summary-zh',
    where: 'both',
    label: '简短说明（中文）',
    value: '阅读时高亮与做笔记。数据本地优先、无需注册，可选自建 WebDAV 同步。',
  },
  {
    key: 'description-en',
    where: 'both',
    label: 'Detailed description (English)',
    value: DESCRIPTION_EN,
  },
  {
    key: 'description-zh',
    where: 'both',
    label: '详细说明（中文）',
    value: DESCRIPTION_ZH,
  },
  {
    key: 'search-terms',
    where: 'edge',
    label: 'Search terms (Edge, up to 7)',
    value: 'annotation, highlighter, notes, reading, markdown, academic, research',
  },
  {
    key: 'privacy-url',
    where: 'both',
    label: 'Privacy policy URL',
    value: 'https://github.com/laleoarrow/locus/blob/main/docs/PRIVACY.md',
  },
  {
    key: 'homepage-url',
    where: 'both',
    label: 'Homepage / support URL',
    value: 'https://github.com/laleoarrow/locus',
  },

  // ── Review / privacy ──
  {
    key: 'certification-notes',
    where: 'edge',
    label: 'Notes for certification (Edge reviewer instructions)',
    value: CERTIFICATION_NOTES,
  },
  {
    key: 'single-purpose',
    where: 'chrome',
    label: 'Single purpose description (Chrome)',
    value:
      'Locus lets the user highlight passages and attach notes to web pages they read, and stores those annotations locally so they reappear on the next visit.',
  },
  {
    key: 'data-statement',
    where: 'both',
    label: 'Data collection statement (declare NO collection for every category)',
    value: DATA_STATEMENT,
  },

  // ── Permission justifications (Chrome asks one per permission) ──
  {
    key: 'perm-storage',
    where: 'chrome',
    label: 'Justification: storage',
    value: "Stores the user's annotations, colours and preferences locally on the device.",
  },
  {
    key: 'perm-sidepanel',
    where: 'chrome',
    label: 'Justification: sidePanel',
    value:
      "Shows the list of annotations for the current page in the browser's side panel.",
  },
  {
    key: 'perm-scripting',
    where: 'chrome',
    label: 'Justification: scripting',
    value:
      'Registers the content script that renders highlights on the pages the user has enabled.',
  },
  {
    key: 'perm-tabs',
    where: 'chrome',
    label: 'Justification: tabs',
    value:
      "Reads the active tab's URL so the side panel can show that page's annotations, and messages the tab to scroll to a highlight when the user clicks one.",
  },
  {
    key: 'perm-alarms',
    where: 'chrome',
    label: 'Justification: alarms',
    value:
      'Schedules the periodic WebDAV sync and the optional update check, both of which the user can switch off.',
  },
  {
    key: 'perm-host',
    where: 'chrome',
    label: 'Justification: host permissions (http://*/*, https://*/*)',
    value:
      'Annotation must work on any article the user chooses to read, which is not a list that can be known in advance. Page text is read only to locate the user\'s highlights and is never transmitted. The user can disable any individual site, and disabled sites are left completely untouched.',
  },
  {
    key: 'remote-code',
    where: 'chrome',
    label: 'Remote code use (answer: No)',
    value:
      'No. All code is bundled in the package; nothing is fetched and executed at runtime.',
  },
];

export const UPLOADS = [
  { step: 1, where: 'edge', label: 'Package (Edge)', file: '1-PACKAGE-edge-上传这个.zip' },
  { step: 1, where: 'chrome', label: 'Package (Chrome)', file: '1-PACKAGE-chrome-上传这个.zip' },
  { step: 2, where: 'edge', label: 'Store logo 300×300', file: '2-LOGO-300x300.png' },
  { step: 3, where: 'chrome', label: 'Small promo tile 440×280', file: '3-PROMO-440x280-仅Chrome需要.png' },
  { step: 4, where: 'both', label: 'Screenshot 1 (toolbar)', file: '4-截图1-工具条.png' },
  { step: 4, where: 'both', label: 'Screenshot 2 (note)', file: '4-截图2-笔记.png' },
  { step: 4, where: 'both', label: 'Screenshot 3 (figure ring)', file: '4-截图3-图片高亮.png' },
  { step: 4, where: 'both', label: 'Screenshot 4 (side panel)', file: '4-截图4-侧边栏.png' },
  { step: 4, where: 'both', label: 'Screenshot 5 (Library)', file: '4-截图5-资料库.png' },
];
