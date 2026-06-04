# 本地 UI 自动审查工作流

## 目标

- 必须先由工具主动审查截图。
- 必须支持人工裁决候选问题。
- 必须输出固定格式审查报告。
- 禁止把审查产物提交到 Git。

## 命令

```powershell
cd apps/web
npm run ui:review:capture
npm run ui:review:audit
npm run ui:review:serve
npm run ui:review:packet
```

## 产物

- `output/ui-review/<runId>/manifest.json`
- `output/ui-review/<runId>/themes.json`
- `output/ui-review/<runId>/findings.json`
- `output/ui-review/<runId>/annotations.json`
- `output/ui-review/<runId>/review-input.md`
- `output/ui-review/<runId>/screenshots/*.png`

## 自动审查

- `manifest.json` 保存截图、DOM 摘要和视觉信号。
- `themes.json` 保存主题候选问题。
- `findings.json` 保存原始候选证据。
- 自动检测 console error、请求失败、图片失败、横向溢出、文字溢出、控件过小、元素重叠、首屏关键元素缺失、大块空白容器。

## 人工裁决

- 打开 `npm run ui:review:serve` 输出的本地地址。
- 优先处理“主题候选问题”列表。
- 候选问题可标记为确认修复、误报、合法变体、疑似新规范、需要判断。
- 原始 findings 只作为证据查看。
- 手动画框只作为补充标注。
- 保存后写回 `themes.json`、`findings.json` 和 `annotations.json`。

## Codex 输入

把以下内容交给 Codex：

```text
请读取 output/ui-review/<runId>/review-input.md，
主动审查所有截图、DOM 摘要和自动 findings，
只输出 UI一致性审查报告，
不要修改代码。
```

## Windows 查看

- PowerShell 读取 JSON 必须加 `-Encoding utf8`。

## 报告格式

```markdown
# UI一致性审查报告

## 1. 审查范围
- 涉及文件：
- 涉及界面：
- 涉及组件：

## 2. 组件一致性问题
| 组件 | 路径 | 问题 | 严重度 | 建议 |
|---|---|---|---|---|

## 3. 布局一致性问题
| 位置 | 问题 | 违反规则 | 建议 |
|---|---|---|---|

## 4. 交互一致性问题
| 组件 | 问题 | 影响 | 建议 |
|---|---|---|---|

## 5. 未授权组件变体
| 组件 | 异常点 | 可能原因 | 建议归类 |
|---|---|---|---|

## 6. 需要设计师确认
| 问题 | 可选决策 |
|---|---|

## 7. 最终结论
符合规范：X项
合法变体：X项
疑似新规范：X项
违规实现：X项

## 8. 是否建议阻塞合入
结论：
- 阻塞 / 不阻塞

理由：
```

## 严重度

- P0：无法操作、误操作、核心流程中断。
- P1：明显违反组件规范或交互规范。
- P2：视觉或布局不一致。
- P3：优化建议。

## 分类

- 符合规范
- 合法变体
- 疑似新规范
- 违规实现

## 默认页面

- `/leaderboard/`
- `/tier-list/`
- `/match-search/`
- `/leaderboard-status/`

## 默认视口

- `1440x900`
- `390x844`
- `430x932`

## 设计文档

- 优先读取 `docs/003-web-pages/ui-contract.md`。
- 优先读取 `docs/003-web-pages/visual-acceptance.md`。
- 优先读取 `docs/003-web-pages/design-tokens.md`。
- 优先读取 `docs/003-web-pages/component-contract.md`。
- 优先读取 `docs/003-web-pages/page-patterns.md`。
