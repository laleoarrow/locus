# 交接提示词：把 Locus 上架到 Edge Add-ons 与 Chrome Web Store

把下面整段（`---` 之间的内容）复制给 Codex 即可。它是自包含的，不需要之前的对话上下文。

---

## 任务

把浏览器扩展 **Locus / 文迹** 提交到 **Microsoft Edge Add-ons** 和 **Chrome Web Store**。
上架的唯一目的是让用户获得**自动更新**——sideload（开发人员模式加载）的扩展浏览器永远不会自动更新，上架后才会。

仓库：`/Users/leoarrow/Project/mypackage/agents/Locus`（git 干净，已发布 v0.6.1）

## 项目背景（够用即止）

Locus 是一个 Manifest V3 扩展（WXT + TypeScript + React + Dexie），功能是网页阅读时高亮划词、写 Markdown 笔记、图片加高亮环、侧边栏管理标注。核心卖点是 **local-first**：无账号、无后端、不采集任何数据；只有两个可选联网功能（用户自建的 WebDAV 同步、GitHub 版本检查），默认可关。

**不要**在上架材料里把它描述成文献管理器——它刻意不做参考文献、引文格式、AI、标签、协作。

## 当前进度（从这里继续）

- ✅ v0.6.1 已发布到 GitHub 且为 Latest；全部质量门槛通过
- ✅ v0.6.1 Edge keyless 上架包已验证并更新到桌面上传目录
- ✅ 素材已生成并归置到 `~/Desktop/locus-store-upload/`（按提交顺序编号）
- ✅ 第 5 张 Library 截图已按 v0.6.1 的紧凑卡片与站点族界面重新生成
- ✅ 中英文商店文案、权限说明、隐私问卷答案已全部撰写完毕
- ✅ 隐私政策已上线：<https://github.com/laleoarrow/locus/blob/main/docs/PRIVACY.md>（返回 200）
- ⏳ Microsoft Edge 开发者注册已开始，但 Partner Center 仍停在 **Step 2 of 4 — Email Verification / In Progress**。邮箱验证完成前无法继续扩展表单。
- ⏸️ 用户明确决定暂不做 Chrome Web Store；不要支付费用或准备 Chrome 提交。

## 你要做的事

### 第一阶段：Edge Add-ons（免费，优先）

1. 引导用户在 `My access` 点 `+` → 选 **Microsoft Edge** → 完成开发者注册。
   账号类型问"个人 / 公司"时选**个人（Individual）**，公司账号需要额外资质验证会拖延数天。
2. 进入 Edge 扩展管理页后：**New extension** → 上传
   `~/Desktop/locus-store-upload/1-PACKAGE-edge-上传这个.zip`
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
| `1-PACKAGE-edge-上传这个.zip` | v0.6.1 Edge 扩展包（keyless，商店上传专用） |
| `2-LOGO-300x300.png` | Edge 商店 logo |
| `4-截图1~5-*.png` | 5 张 1280×800 Edge 截图；`4-截图5-资料库.png` 已更新为 v0.6.1 Library |

素材需要重新生成时：

```bash
node e2e/serve.mjs &
pnpm build:e2e && node scripts/store-shots.mjs   # 重截前 4 张截图
# 资料库截图由 scripts/library-shots.mjs 生成
```

## 边界：以下操作必须由用户本人完成，你不要代做

- **输入账号密码 / 登录**
- **同意开发者协议**（法律上由用户签署）
- **支付 Chrome 的 $5 注册费**
- **最终点击 Submit / Publish**（对外发布）

其余（上传文件、粘贴文案、勾选分类、回答隐私问卷）可以代做，但在点提交前请把填好的内容让用户过一遍。

## 已知坑（务必注意）

1. **真正的约束是商店包的 manifest 不能含 `key`，不是桌面文件名是否带 `-store`。** GitHub Release 里的 `locus-0.6.1-edge.zip` / `-chrome.zip` 是 sideload 包，manifest 带固定 ID 用的 `key`，不能上传商店。桌面的 `1-PACKAGE-edge-上传这个.zip` 已由 `pnpm zip:store:edge` 生成并验证为 v0.6.1、无 `key`。
2. **Edge 审核最常卡在全站权限**（`host_permissions: http://*/*, https://*/*`）。
   字段清单第 9 项「Notes for certification」专门写了：测试步骤、为何必须全站权限（用户读什么文章无法预先枚举）、页面文字仅用于定位高亮且从不外传、用户可逐站禁用。**这一项不要省略或简写。**
3. **数据收集问卷全部声明"不收集"**。配套声明文本见字段 `data-statement`。两个可选联网功能要如实说明：WebDAV 同步发到用户自己配置的服务器；更新检查只请求 GitHub 公开的 release 信息，不含任何用户数据。
4. **Remote code：选 No**。所有代码都打包在扩展内，运行时不拉取执行任何远端代码。
5. **上架后扩展 ID 会再变一次**。用户当前是 sideload 安装，商店安装会得到商店分配的新 ID，数据库是空的。**提醒用户在切换前**先在侧边栏 Backup → Export 导出备份，装好商店版本再 Import 导入。

## 完成后的收尾

1. 把商店链接写进 `README.md`，替换现在的 sideload 安装说明（保留 sideload 说明作为备选）。
2. 在 `docs/STORE-SUBMISSION.md` 末尾记下提交日期与审核状态。
3. 提交 commit（信息用英文，说明上架完成与 README 变更）。
4. 告知用户：商店版本会自动更新，插件内的更新检查对商店用户变成冗余功能，但对仍在 sideload 的用户保留。

## 质量门槛（如果你改了任何代码，必须全部通过）

```bash
pnpm typecheck    # TS strict
pnpm test         # Vitest，当前 113 个
pnpm e2e          # Playwright 扩展测试，当前 33 个
pnpm build && pnpm build:edge   # Chrome / Edge 同源构建
```

---
