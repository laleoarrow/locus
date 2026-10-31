/**
 * Every text field needed to submit Locus to Edge Add-ons and the Chrome Web
 * Store, in submission order. Consumed by scripts/store-copy.mjs, which puts one
 * field at a time on the clipboard so each can be pasted with a single ⌘V.
 *
 * Keep in sync with docs/STORE-SUBMISSION.md (that file explains the process;
 * this one is the literal copy).
 */

const DESCRIPTION_EN = `Locus is an annotation layer for reading on the web. Highlight passages, write Markdown notes and organise each page's main ideas. No Locus account is required.

WHAT IT DOES
• Select text to get a compact toolbar with three colours; press 1, 2 or 3 to pick one from the keyboard. Add page-specific colours without cluttering other pages.
• Set toolbar position to Auto to avoid other in-page floating toolbars, including ones that appear late or live inside nested or shadow DOM elements.
• Click a highlight to write a note in Markdown, with a live preview.
• Select a figure by dragging across it or from just before it to just after it, then ring it in colour. Ordinary clicks still open the page's link or image viewer.
• A side panel lists every annotation on the page; click one to scroll to it.
• Open the Library to search every annotation across sites, travel through a day-by-day timeline, edit notes, restore deleted items, or replace one annotation colour across the whole live library.
• Select individual annotations or groups to change colour, append or replace notes, delete them, or restore selected deleted items.
• Each page has editable main content (主要内容), saved separately from annotation notes. Write it yourself, or optionally generate an editable AI draft and review it before saving.
• AI is off by default. Supply your own OpenAI-compatible API URL, model and API key; edit the prompt or reset it to the default. Generating a draft never saves it automatically.
• Cmd/Ctrl+Z undoes your last highlight. Deletes are undoable, never silent.
• Highlights come back after reload, and keep working when the page changes: each one records its text, surrounding context, character offsets and DOM path, and is re-located by whichever still matches. If a passage is genuinely gone, the annotation is shown as "detached" rather than quietly discarded.
• Same paper on a different site? Locus reads the page's DOI and offers to jump to the version you already annotated — publisher page, PMC mirror, preprint.
• Works on every page by default. Don't want it somewhere? Hold Cmd/Ctrl, hover the right edge of the toolbar and click the ✕ — or use the popup switch.
• Sync annotations and saved page content between devices through a WebDAV folder you own (Nutstore, Nextcloud, a WebDAV host supporting reliable ETags and conditional writes), or export and import a plain JSON backup.

YOUR DATA STAYS YOURS
Annotations and saved page content live in your browser's local database. There is no Locus server, account system or telemetry. Network transfers are limited to the optional features below.

Three optional features reach the network, each switchable off:
• Sync — you supply the WebDAV folder, so your annotations, notes, page URLs and saved main content travel through storage you choose. Credentials are stored locally and are excluded from backups and sync.
• Update check — fetches public release information from GitHub to tell you when a new version exists. It sends no annotations or page content.
• AI organisation — only when you explicitly click Generate, the chosen page's title, URL and all its live saved quotes and notes are sent to your configured API, together with your prompt and model choice. Locus does not additionally fetch or scrape the full page. The API key is used to authenticate with that provider. AI settings and the API key are saved only in local extension storage and are excluded from backups and WebDAV sync. The returned text remains a draft until you choose Save. The Library status panel offers a separate AI connection test using synthetic sample text only, plus verification times and sync payload bytes. WebDAV uses changed page files and a small index; unchanged checks make no upload requests, and connection tests are read-only.

WHAT IT IS NOT
Not a reference manager: no bibliography, citation formatting, tags or collaboration.

Open source: https://github.com/laleoarrow/locus`;

const DESCRIPTION_ZH = `Locus / 文迹 是一个网页阅读标注层。高亮原文、写 Markdown 笔记，并整理每个页面的主要内容，无需注册 Locus 账号。

功能
• 选中文字弹出三色工具条，按 1 / 2 / 3 即可用键盘选色；自定义颜色只属于当前页面，不会挤满其他页面。
• 工具条位置设为 Auto 后，会避让网页内其他浮动工具栏，包括延迟出现以及嵌套、Shadow DOM 内的浮层。
• 点击高亮即可写 Markdown 笔记，带实时预览。
• 在插图上拖动，或从图片前拖到图片后选中它，即可加一圈彩色高亮环；普通单击仍用于打开网页原有的链接或图片查看器。
• 侧边栏列出本页所有标注，点击即滚动定位并闪烁提示。
• 打开资料库可跨网站搜索全部标注，沿逐日时间线回顾阅读历程，编辑笔记、恢复已删除项目，或在整个未删除资料库中批量替换一种标注颜色。
• 勾选一条或多条标注后，可批量改色、追加或替换笔记、删除，也可恢复选中的已删除项目。
• 每个页面都有可编辑的「主要内容」，与各条标注的笔记分开保存。可以手动填写，也可以选择生成 AI 草稿，检查和修改后再保存。
• AI 默认关闭。由你填写兼容 OpenAI 的 API 地址、模型和 API key；提示词可编辑，也可恢复默认。生成草稿不会自动保存。
• Cmd/Ctrl+Z 撤销上一次高亮；删除可撤销，不会静默丢失。
• 刷新后标注自动恢复，页面结构改变也能重新定位：每条标注同时记录原文、上下文、字符位置与 DOM 路径，按可用的线索依次恢复。若原文确实已不存在，标注会显示为「detached（已脱锚）」，而不会被悄悄删掉。
• 同一篇论文在不同网站？Locus 会读取页面 DOI，当你打开另一个版本（出版社页面、PMC 镜像、预印本）时提示跳回你标注过的那个版本。
• 默认在所有页面可用。不想在某站启用？按住 Cmd/Ctrl 悬停工具条右缘点击 ✕，或用弹窗中的开关。
• 标注和已保存的主要内容可通过你自己的 WebDAV 目录（坚果云、Nextcloud 等）在多设备间同步，也可导出/导入 JSON 备份。

数据归你所有
标注和已保存的主要内容保存在浏览器本地数据库中。没有 Locus 服务器、账号系统或遥测。联网传输仅限于下列可选功能。

有三项可选功能会联网，且均可关闭：
• 同步——由你提供 WebDAV 目录，标注、笔记、页面网址和已保存的主要内容传输到你选择的存储空间。凭据保存在本地，不进入备份和同步。
• 更新检查——从 GitHub 获取公开版本信息以提示有新版本，不发送标注或页面内容。
• AI 整理——只有你明确点击 Generate 时，才会将所选页面的标题、网址及该页全部未删除的已保存摘录和笔记，连同提示词与模型选择发送到你配置的 API，不另行抓取页面全文。API key 用于向该服务认证。AI 设置和 API key 仅保存在本地扩展存储中，不进入备份或 WebDAV 同步。返回内容保留为草稿，点击 Save 后才保存。资料库状态区另有连接测试，仅发送示例文字，并分别显示最近验证与实际同步时间。

它不是什么
不是文献管理器：不提供参考文献、引文格式、标签或协作功能。

开源地址：https://github.com/laleoarrow/locus`;

const CERTIFICATION_NOTES = `Locus adds highlighting, notes and editable page summaries to web pages the user reads. Annotations and saved summaries are stored locally in IndexedDB; there is no Locus backend, account system or telemetry. Optional transfers are described below.

HOW TO TEST
1. Open any article (for example https://en.wikipedia.org/wiki/Anesthesiology).
2. Select a sentence — a small toolbar appears with three colour circles. Click one, or press 1/2/3, to highlight.
3. Click the highlight you just made — a note editor opens; type Markdown and press Save (or Enter; Shift+Enter inserts a new line).
4. Reload the page: the highlight and note are restored.
5. Click the extension icon, then "Open annotation panel" to see the side panel list. Clicking an entry scrolls to and flashes that highlight.
6. Click the extension icon, then "All annotations" to open the Library. Search for the saved note and switch between page, site and timeline grouping.
7. Select an image by dragging across it or from just before it to just after it, then choose a colour to ring it. An ordinary click remains available to the page's own link or image viewer.
8. To disable a site: hold Cmd/Ctrl and move the pointer to the right edge of the selection toolbar; an ✕ slides out. Clicking it disables Locus for that origin. The popup has the same switch.
9. In the Library, select annotations and try changing colour, appending/replacing a note, deleting, and restoring selected deleted items. Only the selected rows are edited.
10. On a page card, edit the main content (主要内容) and Save. It is separate from individual annotation notes and is included in backup and WebDAV sync.
11. AI generation is off by default and is not required for annotation or manual page content. To test it, configure an OpenAI-compatible API URL, model and your own API key in LLM settings, then enable it. The prompt is editable and can be reset. Explicitly click Generate for a chosen page: its title, URL and all live saved quotes and notes are sent to that configured service; Locus does not additionally fetch or scrape the full page. Review the returned draft; it is not persisted until Save.
12. Set Toolbar position to Auto. It tracks other in-page floating toolbars while visible, including delayed, nested and shadow DOM toolbars. It does not inspect browser-native or desktop overlays.

ABOUT THE BROAD HOST PERMISSION
Annotation has to work on whatever the user chooses to read, so the extension requests http://*/* and https://*/*. These permissions also allow requests to a user-configured WebDAV host or OpenAI-compatible API endpoint. Page text is read to capture and restore selected highlights. Saved quotes, notes and page metadata are transmitted only through the user-controlled optional features below. Any site can be disabled individually to stop annotation rendering and selection handling there.

NETWORK ACCESS (three optional features, all user-controlled)
- WebDAV sync: off until configured and enabled; transfers changed page/settings JSON files and a small index containing the user's annotations, notes, page URLs and saved main content to the user's chosen server. No default server exists. Sync credentials are excluded from those files.
- Update check: enabled by default so sideloaded users can learn about new versions; requests public release metadata from api.github.com. Sends no annotations or page content and can be switched off at any time.
- AI organisation: off by default and requested only by explicit Generate actions. Sends the chosen page's title, URL and all its live saved quotes and notes, with the configured model and prompt, to the user's configured API. The API key authenticates this request. Locus does not additionally fetch or scrape the full page. AI configuration and API key are stored in chrome.storage.local and excluded from backups and WebDAV sync. Generated content stays a draft until the user saves it.

No remote code is loaded or executed; everything is bundled in the package. Provider JSON is treated as data and the generated text as an editable draft, never executable code.`;

const DATA_STATEMENT = `Locus has no backend, account system or telemetry. Annotations, notes, page metadata and saved page summaries are stored locally in IndexedDB. Three optional features make network requests: enabled WebDAV sync transfers those saved records to a server the user configures; update checking requests public GitHub release metadata without annotations or page content; and AI organisation, off by default, sends a chosen page's title, URL and all its live saved quotes and notes only when the user explicitly clicks Generate. The AI request goes to the user's configured OpenAI-compatible API with their chosen model, prompt and API key for authentication; it does not additionally fetch or scrape the full page. Explicit LLM connection tests send synthetic sample text instead of saved notes or the personal prompt. AI results remain drafts until Save. AI configuration and API key are saved in chrome.storage.local and excluded from backups and sync. Disclose these user-directed transfers, including website content and URLs, in the store's applicable data categories; do not represent all categories as having no transmission.`;

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
      'Highlight, edit notes and organise page summaries. Local-first, with optional WebDAV sync and your own AI API.',
  },
  {
    key: 'summary-zh',
    where: 'both',
    label: '简短说明（中文）',
    value: '高亮原文、编辑笔记并整理页面主要内容。本地优先、无需注册，可选 WebDAV 同步和自有 AI API。',
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
      'Locus helps users record and organise their web reading through highlights, notes and editable page summaries. Records are stored locally, with optional user-configured sync and AI drafting from saved quotes and notes.',
  },
  {
    key: 'data-statement',
    where: 'both',
    label: 'Data handling statement (disclose user-directed sync and AI transfers)',
    value: DATA_STATEMENT,
  },

  // ── Permission justifications (Chrome asks one per permission) ──
  {
    key: 'perm-storage',
    where: 'chrome',
    label: 'Justification: storage',
    value: "Stores local preferences, sync configuration and optional AI settings/API key. AI configuration and credentials are excluded from backups and sync; annotations and saved page content use local IndexedDB.",
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
      'Annotation must work on any page the user chooses to read, which cannot be listed in advance. Host access also permits requests to user-configured WebDAV and OpenAI-compatible API endpoints. Saved page metadata, quotes and notes are transmitted only for enabled sync or explicit AI generation; the AI feature does not additionally fetch or scrape the full page. Users can disable annotation rendering and selection handling on individual sites.',
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
