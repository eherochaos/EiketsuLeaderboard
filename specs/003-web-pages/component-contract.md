# Component Contract

## Button
- Button 必须有 default 状态。
- Button 必须有 hover 状态。
- Button 必须有 active 状态。
- Button 必须有 disabled 状态。
- Button 必须有 focus 状态。
- 主 Button 背景必须使用 `--color-red`。
- 次级入口必须使用文字链接。
- 同一视区只能出现一个 `.primary-action`。

## Card
- Card 只能用于独立信息块。
- Card 圆角必须使用 `--radius-panel`。
- Card 边框必须使用 `--color-panel-border`。
- Card 背景必须使用 `--color-panel`。
- Card 阴影必须使用 `--shadow-soft`。
- 禁止卡片套卡片。
- 禁止把整段页面 section 做成多层浮卡。

## Tag / Badge
- Tag 必须用于势力、状态、指标依据。
- Tag 最小高度必须使用 `--tag-min-height`。
- Tag 字号必须使用 `--font-size-label`。
- Tag 边框必须使用 `--color-gold-tag-border`。
- Tag 背景必须使用 `--color-gold-tag-fill`。
- Active Tag 背景必须使用 `--color-gold-fill`。
- Tag 文本长度必须小于等于 `8` 个中文字符。

## Metric
- Metric 必须由标签和数字组成。
- Metric 数字字号必须使用 `--font-size-metric`。
- Metric 标签字号必须使用 `--font-size-label`。
- 数字必须使用 `--font-number`。
- 百分比必须保留一位小数。
- 样本数必须使用千分位。
- 指标名称只能使用：综合 Rank、胜率、使用率、倾奇点、样本数。

## Table
- Table 必须有表头。
- Table 表头背景必须使用 `--color-gold-tag-fill`。
- Table 正文必须使用 `--font-size-table`。
- Table 行分隔线必须为 `1px solid var(--color-panel-border)`。
- Table Rank 必须左侧固定。
- Table 指标列必须使用 `text-align: right`。
- Table 空状态必须占满表格宽度。
- 移动端禁止依赖横向滚动表格。

## Filter Bar
- Filter Bar 背景必须使用 `--color-panel`。
- Filter Bar 边框必须使用 `--color-panel-border`。
- Filter Bar 必须支持 selected。
- Filter Bar 必须支持 focus。
- Filter Bar 必须支持 disabled。
- Filter Bar 高度必须使用 `--state-toolbar-height`。
- Filter Bar select 必须设置 `appearance: none`。
- Filter Bar select 边框必须使用 `--color-panel-border`。

## Deck Row
- Deck Row 必须对齐 Rank、头像、正文、核心构成、指标、按钮。
- Deck Row 桌面 grid 必须固定指标区宽度。
- Deck Row 核心构成必须显示 8 卡。
- Deck Row 卡位禁止显示人工序号。
- Deck Row hover 背景必须为 `rgba(255, 252, 244, 0.94)`。
- Deck Row 移动端必须切成信息区加 4x2 卡组盘。

## Deck Rail
- Deck Rail 必须有明确标签 `核心构成`。
- Deck Rail 背景必须为暗色卡槽。
- Deck Rail 卡图必须等距。
- Deck Rail 桌面必须 8 列。
- Deck Rail 手机必须 4x2。
- Deck Rail 禁止横向撑破页面。

## Chart Card
- Chart Card 只能用于势力占比横向堆叠条。
- Chart Card 必须显示 Top3 合计。
- Chart Card 必须显示百分比刻度。
- Chart Card 必须显示每段势力名和占比。
- Chart Card 禁止使用饼图。
- Chart Card 禁止使用装饰图。

## Loading State
- Loading State 必须使用骨架。
- Loading State 禁止显示假数值。
- Loading State 禁止跳动布局。

## Empty State
- Empty State 必须说明当前无数据。
- Empty State 必须隐藏数据内容。
- Empty State 禁止显示空表格假行。

## Error State
- Error State 必须保留页面结构。
- Error State 必须保留主要导航。
- Error State 必须不造成横向溢出。

## Modal / Drawer
- 禁止实现 Modal。
- 禁止实现 Drawer。
- 禁止新增 Modal。
- 禁止新增 Drawer。
