# Root Rules

本项目是前后端分离 monorepo。

## 项目结构：
.
├── AGENTS.md
├── README.md
├── .github/
├── apps/
│   ├── api/
│   └── web/
├── docs/
└── specs/

# Codex Rules

- 每次只做一个 Issue
- 不要直接改 main
- 不要做无关重构
- 不要擅自修改 package.json
- 不要擅自修改 .github/
- 做完后开 PR
- GitHub 相关操作统一走 GitHub 插件
- PR 里说明：改了什么、没改什么、怎么验证

## MUST NOT:

### 架构相关：
- 不允许在 apps/web 中实现后端业务规则
- 不允许在 apps/api 中写前端展示逻辑
- 不允许绕过 packages/contracts 私自约定字段

## 文档相关：
- 极短
- 极具体
- 极明确
- 禁止解释
- 禁止背景
- 禁止最佳实践
- 禁止未来规划
- 每条规则不超过1行
- 总长度不超过30行

优先使用：
- 必须
- 禁止
- 只能
- 统一

禁止使用：
- 可扩展性
- 高内聚
- 低耦合
- 企业级
- 最佳实践
- 模块化

## PowerShell 命令规则

- 当前默认终端是 Windows PowerShell。
- 不要使用 Bash one-liner。
- 避免复杂 jq / sed / awk。
- GitHub API 数据优先用 `gh --json`、`gh --template` 或 `ConvertFrom-Json`。
- 复杂命令拆成多行 PowerShell 或 `.ps1` 脚本。
- 不要写容易被 PowerShell 吃掉引号的命令。

修改任何 UI 前，必须先阅读 docs/design/ui-contract.md。
完成任何 UI 修改后，必须按照 docs/design/visual-acceptance.md 做视觉自检。
如果自检未通过，必须先修复再提交。

## UI 审查

- UI 审查必须按 `docs/ui-review-workflow.md` 执行。
- UI 审查产物只能写入 `output/ui-review/`。
