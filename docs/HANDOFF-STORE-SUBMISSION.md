# 交接提示词：把 Locus 上架到 Edge Add-ons 与 Chrome Web Store

把下面整段（`---` 之间的内容）复制给 Codex 即可。它是自包含的，不需要之前的对话上下文。

---

## 任务

把浏览器扩展 **Locus / 文迹** 提交到 **Microsoft Edge Add-ons** 和 **Chrome Web Store**。
上架的唯一目的是让用户获得**自动更新**——sideload（开发人员模式加载）的扩展浏览器永远不会自动更新，上架后才会。

仓库：`/Users/leoarrow/Project/mypackage/agents/Locus`（当前源码版本 v0.9.11；发布、安装和上传包状态须在继续前核对，不能沿用下方 v0.7.2 的历史记录）

## 项目背景（够用即止）

Locus 是一个 Manifest V3 扩展（WXT + TypeScript + React + Dexie），提供网页高亮、Markdown 笔记、图片高亮环、侧边栏和资料库。用户可以勾选标注后批量改色、追加或替换笔记、删除、恢复；每个页面另有可编辑的「主要内容」，与标注笔记分开保存。工具条的 Auto 位置会跟踪和避让网页内延迟出现、嵌套或 Shadow DOM 中的浮层，不检测浏览器原生或桌面浮层。

核心卖点是 **local-first**：无需 Locus 账号、无 Locus 后端、无遥测。三项可选联网功能均可关闭：用户配置的 WebDAV 同步、GitHub 版本检查，以及默认关闭的 AI 整理。用户需自行填写兼容 OpenAI 的 API 地址、模型和 API key；提示词可编辑或恢复默认。只有明确点击 Generate，才向所配置服务发送所选页面的标题、网址及该页全部未删除的已保存摘录和笔记，连同提示词、模型选择；API key 用于向该服务认证。不另行抓取页面全文，返回结果只作为可编辑草稿，点击 Save 后才保存。

WebDAV 同步采用 v4 小索引与按页面保存的文件，只发送有标注、删除记录或主要内容的页面；未修改时无上传请求。共享同一网盘目录的设备须全部升级到 0.9.0。

资料库顶部的状态区区分「已配置」与「已验证」，可查看最近检查与实际同步时间。单独的 LLM 连接测试只发送固定示例文字，不发送已保存笔记或用户提示词。

AI 设置和 API key 仅保存在本机的 `chrome.storage.local` 中，不进入 JSON 备份或 WebDAV 同步。保存后的「主要内容」会随标注一起备份和同步。

**不要**在上架材料里把它描述成文献管理器——它不提供参考文献、引文格式、标签或协作功能。也不要再使用「没有 AI」「页面内容从不外传」或「隐私问卷所有项目都选不收集」等旧版表述。

## 当前进度（从这里继续）

v0.9.11 独立审查及候选包验证完成：350 ms 晚到/滑入浮栏的可见跳动从 83 px 降为 0，晚附加开放/关闭 Shadow Root 也能在初显前识别。真实必应自带搜索气泡与受控浮栏组合逐帧通过：单浮栏距选区 10 px，双浮栏 56 px，均无可见位移或重叠。修复旧选区数字误标、响应式与嵌套 Shadow DOM 漏识别；20 次同帧滚动刷新降为 1 次，父子变更重复样式读取 751→251。Auto 设计等待约 400–700 ms，不能称为初显更快。类型检查、497 单元和完整 106 浏览器用例通过，最终生产 ZIP 独立运行版本确认。详见 [独立审查报告](rival-audit-0.9.11/REPORT.md)。本轮严格独立无头浏览器，没有操作用户工作 Edge；稳定安装仍为上轮已验证的 0.9.10，不应自动重启用户浏览器。

v0.9.10 已发布为 [GitHub Latest](https://github.com/laleoarrow/locus/releases/tag/v0.9.10)：Auto 首次隐藏等待约 300 ms，再按当前选区和障碍定位，工具条仅淡入；显式上/下方与数字快捷键保持即时。修复取消、重选和键盘排队任务的竞态，后续动态避让保留。类型检查、481 项单元测试和完整 101 项浏览器回归通过；实际 Edge ZIP 隔离加载后，即时 / 250 ms 浮栏场景全部可见帧均为 0 位移、0 重叠。公开安装包独立下载核验一致，商店候选包 `.output/locus-0.9.10-edge-store.zip` 未提交。详细记录见 [首次显示验证](TOOLBAR-0.9.10.md)，前轮 [距离修复](TOOLBAR-0.9.9.md) 与 [性能优化](PERFORMANCE-0.9.8.md) 均保留。

**用户随后明确授权直接更新至 0.9.10 并重载，现已完成。** 正常退出 Edge 后先完成私密本机备份，再原路径更新并重新启动；固定扩展 ID `dfmekdplmdbjbefchginloeehjonjlan` 保持不变。重启前后副本核验确认：71 条已保存标注记录（含软删除记录）、71 个定位记录、3 篇主要内容、5 项用户设置、全部 6 项本机配置及外部 blob 内容均未改变。原有标签页已通过正常历史记录恢复，用户已继续正常浏览。没有进行真实网盘上传或 LLM 测试，也没有更新桌面商店上传文件。

实际运行验证在普通 HTTP 测试页完成：注入的工具条具备 0.9.10 新 CSS 特征（样式指纹 `13da96f4`，长度 8089），首次可见为 375.7 ms，33 个可见帧内最大位移为 0 px，入场仅改变透明度。本机截图为 `.output/live-update-0.9.10/runtime-proof.jpg`。浏览器仍限制内部扩展页面，本轮遵守了该限制；没有读取 `runtime.getManifest`，也不声称读到了资料库或版本界面。私密备份和用户数据指纹不写入仓库；历史发布记录仍保留。

完整结果、前后截图、尚存能力边界及散列见 [稳健性审查](audit-2026-11-01/REPORT.md) 与 [发行核验](audit-2026-11-01/RELEASE-CHECKS.md)。

### 历史记录：2026-08-01，v0.7.2

以下为当时的发布交接快照，不是 v0.8.0 的完成凭证；商店注册、在线材料和本机状态须重新核验。

- ✅ v0.7.2 已发布为 GitHub Latest：<https://github.com/laleoarrow/locus/releases/tag/v0.7.2>
- ✅ 本机固定 ID `dfmekdplmdbjbefchginloeehjonjlan` 已原位 Reload 到 v0.7.2；Library 保留全部 19 条批注，Timeline 节点已目检与竖线对齐
- ✅ v0.7.2 Edge keyless 上架包已验证并同步到桌面上传目录（SHA-256 `0a8289f29931382c64aa14848211c2b63c6fd16f3a2f88f8beeb47a11344f5b4`）
- ✅ 素材已生成并归置到 `~/Desktop/locus-store-upload/`（按提交顺序编号）
- ✅ 第 5 张 Library 截图已按 v0.7.2 的紧凑卡片、批量改色入口与站点族界面重新生成
- ✅ 第 4 张侧栏截图已按 v0.7.2 的对齐操作区和版本显示重新生成
- ✅ v0.7.2 中英文商店文案、权限说明、隐私问卷材料已撰写完毕；当前上传须使用本次更新后的文案
- ✅ 隐私政策已上线：<https://github.com/laleoarrow/locus/blob/main/docs/PRIVACY.md>（返回 200）
- ⏳ Microsoft Edge 开发者注册已开始，但 Partner Center 仍停在 **Step 2 of 4 — Email Verification / In Progress**。邮箱验证完成前无法继续扩展表单。
- ⏸️ 用户明确决定暂不做 Chrome Web Store；不要支付费用或准备 Chrome 提交。

## 你要做的事

### 第一阶段：Edge Add-ons（免费，优先）

1. 引导用户在 `My access` 点 `+` → 选 **Microsoft Edge** → 完成开发者注册。
   账号类型问"个人 / 公司"时选**个人（Individual）**，公司账号需要额外资质验证会拖延数天。
2. 先确认 `~/Desktop/locus-store-upload/1-PACKAGE-edge-上传这个.zip` 已替换为当前版本并通过商店包校验，再进入 Edge 扩展管理页：**New extension** → 上传该文件。
3. 填写商店列表信息（文案见下方"文案与素材"）。
4. 上传 logo 与 5 张截图。
5. Availability 选全部市场；隐私问卷按下方说明作答。
6. 让用户点 Submit。

### 第二阶段：Chrome Web Store（已暂停）

用户已明确决定暂不提交 Chrome。只有用户以后重新提出时，才重新构建 Chrome store 包并恢复此流程。

## 文案与素材

**所有文本内容**都在 `scripts/store-fields.mjs` 里（结构化，带 `where: edge|chrome|both` 标记）。
配套脚本把内容逐条送进剪贴板，避免在长文档里来回找：

```bash
cd /Users/leoarrow/Project/mypackage/agents/Locus

node scripts/store-copy.mjs                 # 列出 Edge 的 10 个字段及顺序
node scripts/store-copy.mjs --chrome        # 列出 Chrome 的 16 个字段
node scripts/store-copy.mjs 1               # 复制第 1 项到剪贴板
node scripts/store-copy.mjs description-en  # 按字段名复制
node scripts/store-copy.mjs next            # 复制下一项
```

如果你有可用的浏览器自动化能力（能读取页面并填表），**优先直接填**，不必走剪贴板。
读取内容用 `node -e "import('./scripts/store-fields.mjs').then(m=>console.log(JSON.stringify(m.FIELDS)))"`。

**流程说明文档**：`docs/STORE-SUBMISSION.md`（含完整字段清单、权限逐项说明、隐私披露原文、两个商店的提交步骤）
**待上传文件**：`~/Desktop/locus-store-upload/`

| 文件 | 用途 |
|---|---|
| `1-PACKAGE-edge-上传这个.zip` | 当前版本 Edge 扩展包（keyless，商店上传专用）；本次目标 v0.9.10，上传前必须核验并替换历史包 |
| `2-LOGO-300x300.png` | Edge 商店 logo |
| `4-截图1~5-*.png` | 5 张 1280×800 Edge 截图；历史素材来自 v0.7.2，本次提交前须复核并与最终版本保持一致 |

素材需要重新生成时：

```bash
node e2e/serve.mjs &
pnpm build:e2e && node scripts/store-shots.mjs   # 重截前 4 张截图
pnpm build && node scripts/readme-shots.mjs      # 重截 README 与第 5 张资料库截图
```

## 边界：以下操作必须由用户本人完成，你不要代做

- **输入账号密码 / 登录**
- **同意开发者协议**（法律上由用户签署）
- **支付 Chrome 的 $5 注册费**
- **最终点击 Submit / Publish**（对外发布）

其余（上传文件、粘贴文案、勾选分类、回答隐私问卷）可以代做，但在点提交前请把填好的内容让用户过一遍。

## 已知坑（务必注意）

1. **真正的约束是商店包的 manifest 不能含 `key`，不是桌面文件名是否带 `-store`。** GitHub Release 里的 `locus-<version>-edge.zip` / `-chrome.zip` 是 sideload 包，manifest 带固定 ID 用的 `key`，不能上传商店。应从当前源码运行 `pnpm zip:store:edge`，通过校验后再替换桌面的 `1-PACKAGE-edge-上传这个.zip`；v0.7.2 的历史 SHA-256 不能用于验证 v0.8.0。
2. **Edge 审核最常卡在全站权限**（`host_permissions: http://*/*, https://*/*`）。
   字段「Notes for certification」说明了测试步骤、为何需要任意网页的标注权限、向用户配置的 WebDAV/API 地址发起请求，以及用户可逐站关闭标注。AI 请求仅在明确生成时发送所选页面的标题、网址和该页全部未删除的已保存摘录、笔记，不另行抓取页面全文。**这一项不要省略或简写。**
3. **按实际数据流回答隐私问卷，不一律选择「不收集」。** 配套声明见字段 `data-statement`。应披露三项可选联网功能：WebDAV 向用户配置的服务器同步标注、笔记、页面网址和已保存的主要内容；更新检查只请求 GitHub 公开版本信息，不发送标注或页面内容；AI 默认关闭，只有明确点击 Generate 才发送所选页面标题、网址及该页全部未删除的已保存摘录、笔记，连同提示词和模型选择到所配置 API。依据当前表单的具体定义勾选网页内容、网址等适用类别，并说明这些由用户控制的传输。AI 配置与 API key 仅本地保存，不进入备份或同步；API key 只用于向用户配置的服务认证。
4. **Remote code：选 No**。所有代码都打包在扩展内，运行时不拉取执行任何远端代码。服务返回的 JSON 作为数据解析，生成文本只作为草稿显示和编辑，不作为代码执行。
5. **上架后扩展 ID 会再变一次**。用户当前是 sideload 安装，商店安装会得到商店分配的新 ID，数据库是空的。**提醒用户在切换前**先在侧边栏 Backup → Export 导出备份，装好商店版本再 Import 导入。

## 完成后的收尾

1. 把商店链接写进 `README.md`，替换现在的 sideload 安装说明（保留 sideload 说明作为备选）。
2. 在 `docs/STORE-SUBMISSION.md` 末尾记下提交日期与审核状态。
3. 提交 commit（信息用英文，说明上架完成与 README 变更）。
4. 告知用户：商店版本会自动更新，插件内的更新检查对商店用户变成冗余功能，但对仍在 sideload 的用户保留。

## 质量门槛（如果你改了任何代码，必须全部通过）

```bash
pnpm typecheck    # TS strict
pnpm test         # Vitest，数量与结果以本次实际输出为准
pnpm e2e          # Playwright 扩展测试，数量与结果以本次实际输出为准
pnpm build && pnpm build:edge   # Chrome / Edge 同源构建
```

---
