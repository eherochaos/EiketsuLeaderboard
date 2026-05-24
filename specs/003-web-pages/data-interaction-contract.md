# Data And Interaction Contract

## 数据字段
- 首页必须包含 `factionShare`。
- 首页必须包含 `representativeDecks`。
- 首页必须包含 `featuredCards`。
- 首页必须包含 `updatedAt`。
- TierList 必须包含 `deckId`。
- TierList 必须包含 `deckName`。
- TierList 必须包含 `categoryId`。
- TierList 必须包含 `categoryName`。
- TierList 必须包含 `rankScore`。
- TierList 必须包含 `winRate`。
- TierList 必须包含 `usageRate`。
- TierList 必须包含 `kabukiPoints`。
- TierList 必须包含 `sampleSize`。
- 静态视觉字段白名单包含 `imageUrl`。
- 静态视觉字段白名单包含 `imageUrls`。
- 静态视觉字段白名单包含 `imageAlt`。
- 静态视觉字段白名单包含 `deckCards`。
- 静态视觉字段白名单包含 `faction`。
- 静态视觉字段白名单包含 `namingSource`。
- 静态视觉字段白名单包含 `representatives`。

## 派生规则
- Hero 时间段必须由 `updatedAt` 生成。
- Hero 标题禁止手写环境结论。
- 主导势力必须取 `factionShare` 前三项。
- Top3 合计必须取 `factionShare` 前三项占比合计。
- Top3 卡组必须按 `rankScore` 排序。
- 代表卡组指标依据必须由 `rankScore`、`winRate`、`usageRate` 生成。
- TierList 行指标依据必须由 `rankScore`、`winRate`、`usageRate`、`sampleSize` 生成。
- 注目单卡标签必须由阈值生成。
- 综合 Rank 高阈值必须为 `rankScore >= 90`。
- 使用率高阈值必须为 `usageRate >= 15`。
- 胜率高阈值必须为 `winRate >= 54`。
- 构筑常客阈值必须为 `usageRate >= 9`。
- 无命中标签时必须显示综合观察。

## 禁止字段
- 禁止新增 `reason`。
- 禁止新增 `description`。
- 禁止新增 `editorNote`。
- 禁止新增人工补写标题字段。
- 禁止新增人工补写点评字段。

## 首页状态
- `ready` 必须显示完整数据内容。
- `heated` 必须保留数据内容。
- `heated` 必须在更新时间处显示过热观察。
- `empty` 必须隐藏数据内容。
- `empty` 必须显示空状态。
- `missing-builds` 必须保留数据内容。
- `missing-builds` 必须在更新时间处显示缺乏新构筑。

## TierList 筛选
- 势力筛选必须支持全部。
- 势力筛选必须支持数据中出现的势力。
- 命名来源必须支持全部。
- 命名来源必须支持 `single`。
- 命名来源必须支持 `combo`。
- 命名来源必须支持 `type`。
- 排序必须支持 `rankScore`。
- 排序必须支持 `winRate`。
- 排序必须支持 `usageRate`。
- 排序必须支持 `kabukiPoints`。
- 排序必须支持 `sampleSize`。
- 排序方向必须为降序。

## 交互状态
- Hover 背景必须为 `rgba(255, 252, 244, 0.94)`。
- Active 必须有明确视觉状态。
- Active 背景必须使用 `--color-gold-fill`。
- Selected 背景必须使用 `--color-gold-fill`。
- Disabled opacity 必须为 `0.48`。
- Loading 必须使用骨架。
- Empty 必须隐藏数据列表。
- Error 必须保留布局。
- 禁止实现 Success 状态。
- Focus outline 必须为 `2px solid var(--color-gold)`。
- 排序中必须更新摘要。
- 筛选中必须更新表格和移动行块。

## 详情入口
- 首页查看构筑只能跳转 TierList。
- TierList 详情入口只能占位。
- 详情占位文案必须说明当前只展示指标依据。
- 禁止定义真实详情页数据。
