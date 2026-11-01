# Locus / 文迹 0.9.7

## 图片标注与笔记保存更可靠

- 图片重排、内层滚动、隐藏、替换和延迟加载后，标记跟随可确认的目标；无法确认时脱离定位，避免误标另一张图。
- 中文输入确认不再触发保存；保存失败会保留草稿供重试。窄窗口仍能访问保存按钮。
- 单条与批量笔记在提交前检查版本，避免覆盖另一窗口的新修改。Library 切换分组、筛选或折叠时保留当前页面中的未保存草稿。
- 校验损坏备份与锚点，同时兼容早期版本数据。同步遇到损坏远程记录时停止迁移，不上传残缺替代文件。
- 页面打开较久后仍可恢复标注；无关动态文字不再反复触发全页恢复和状态报告。

图片仍保存 URL 与定位信息，不默认上传图片文件。现有定时同步、未修改零上传、用户主动调用 LLM 的行为保持不变。

审查过程、截图和能力边界见 [完整报告](audit-2026-11-01/REPORT.md)。本轮测试使用隔离的无头浏览器与本地模拟服务，没有操作用户浏览器、真实笔记或网盘，也没有替换正在使用的扩展目录。

## Validation

- Typecheck and 432 unit tests passed.
- All 91 browser cases verified: 90 passed in the full run; one existing drag test needed to wait for live-query layout replacement, then passed three consecutive runs.
- Chrome/Edge production packages and the keyless Edge store candidate are checked separately; see the audit release-check record.
