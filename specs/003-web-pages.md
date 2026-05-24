# 页面技术规格 v2

## 范围
- 只能覆盖 `/` 首页和 `/tier-list` TierList。
- 只能用于静态原型，不定义真实 API。
- 禁止修改 `docs/`、`apps/web/`、`package.json`、`.github/`。
- 静态原型只能放在 `prototypes/003-web-pages`。

## 总体代码约束
- UI 禁止露出内部组件名、接口名、验收稿用语。
- 禁止展示需要人工补写的标题、理由、描述、点评。
- Hero 标题必须由 `updatedAt` 或统计区间生成。
- 排序依据必须由 `rankScore`、`winRate`、`usageRate`、`sampleSize` 生成。
- 禁止新增必须人工维护的 `reason`、`description`、`editorNote` 字段。
- 外链图片必须有 `alt` 和失败态。
- 图片只能外链公开资源，禁止提交官方图片到仓库。
- 页面禁止出现页面级横向滚动。
- 文字禁止重叠、截断、溢出按钮或卡片。

## 视觉约束
- 风格必须是浅色战术情报 Dashboard。
- 页面背景必须使用米白纸感色。
- 顶部导航必须是深棕横条。
- 主 CTA 必须使用暗红按钮。
- 强调色必须使用金色。
- 禁止黑暗模式、页游活动页、大面积黑金厚边框。
- 禁止复杂炫光、3D 图表、装饰性饼图。
- 只能使用 CSS 变量管理颜色、字体、间距、阴影。

## Design Tokens
- `--color-bg`：页面背景。
- `--color-panel`：内容台和卡片背景。
- `--color-text`：主文字。
- `--color-muted`：次级文字。
- `--color-brown`：顶部导航和品牌结构。
- `--color-gold`：强调、激活、分隔。
- `--color-red`：主 CTA。
- `--color-border`：浅金棕边框。
- `--shadow-soft`：柔和阴影。

## 布局约束
- 主容器最大宽度必须约 `1180px`。
- 桌面左右 padding 必须约 `16px`。
- Section 间距必须约 `24px`。
- 卡片 padding 必须优先使用 `16px` 或 `24px`。
- 间距 token 只能使用 `4/8/12/16/24/32/48`。
- Header 高度必须约 `64px`。
- Hero 桌面必须左右两栏。
- Hero 右栏必须展示当前第一和 Top 3。
- TierList 指标列必须固定宽度。
- 表格列宽必须服务扫描，不允许平均铺满导致重点不清。

## 字体约束
- 大标题必须使用 serif / 明朝气质字体。
- 数据数字必须使用清晰数字字体。
- H1 桌面字号必须在 `36px-52px`。
- Section 标题必须约 `28px`。
- 正文字号必须在 `15px-16px`。
- 辅助标签字号只能在 `12px-13px`。
- 指标数字必须在 `20px-32px`。
- 字间距必须为 `0`。
- 行高必须保证中文可读。

## 首页结构
- 首页必须按 Header、Hero、状态栏、势力占比、代表卡组、注目单卡、字段说明排列。
- Header 只能保留品牌和 TierList 强入口。
- 注目单卡、注目组合、字段说明只能作为弱目录入口。
- Hero 必须展示环境数据概览、生成标题、更新时间、主导势力、TierList CTA。
- Hero 必须展示当前第一卡组和 Top 3 卡组。
- 状态栏必须展示正常、过热中、无数据、缺乏新构筑。
- 状态栏可展示静态筛选项：全部势力、全部段位、最近 7 天。
- 无数据状态必须隐藏数据内容并显示空状态。
- 缺更新时间状态必须明确展示缺失状态。

## 势力占比
- 势力占比必须使用横向堆叠条。
- 禁止使用饼图、环图、3D 图、海报式图像扇区。
- 每个区块必须显示势力名和百分比。
- 必须显示 `0/25/50/75/100%` 刻度。
- Top3 合计必须由 `factionShare` 前三项计算。
- 代表条目只能来自 `factionShare.representatives`。

## 代表卡组
- 代表卡组必须展示 4 条横向卡组情报行。
- 每行必须包含 Rank、头像、势力、卡组名、指标依据、核心构成、胜率、使用率、查看构筑。
- 核心构成必须支持 8 张卡。
- 卡位禁止显示 `1/2/3/4/5/6/7/8` 人工排序号。
- 桌面核心构成必须横向完整可扫。
- 移动端核心构成必须不造成页面级横向滚动。
- 查看构筑按钮必须统一暗红样式。
- 指标依据必须由综合 Rank、胜率、使用率生成。

## 注目单卡
- 注目单卡必须展示 Rank、卡图、卡名、使用率、胜率、综合 Rank 趋势、指标依据。
- 指标依据必须由数据生成标签。
- 允许标签：综合 Rank 高、使用率高、胜率高、构筑常客、综合观察。
- 禁止展示人工影响说明和关注理由。
- 趋势可用静态折线占位，但禁止写成真实接口数据。
- 移动端必须使用可读行块，不依赖横向表格。

## TierList
- TierList 必须按标题区、筛选排序栏、榜单主体、详情入口、字段说明排列。
- 默认排序必须按 `rankScore` 降序。
- 筛选必须支持势力、命名来源、排序项。
- 命名来源必须支持 `single`、`combo`、`type`。
- 桌面必须使用表格。
- 移动端必须使用榜单行块。
- 每行必须展示综合 Rank、胜率、使用率、倾奇点、样本数、分类名。
- 每行指标依据必须由数据生成。
- 详情入口只能跳转或占位，禁止定义详情页内容。

## 数据字段
- 首页必须包含 `factionShare`、`representativeDecks`、`featuredCards`、`updatedAt`。
- TierList 必须包含 `deckId`、`deckName`、`categoryId`、`categoryName`、`rankScore`、`winRate`、`usageRate`、`kabukiPoints`、`sampleSize`。
- 静态视觉可包含 `imageUrl`、`imageUrls`、`imageAlt`、`deckCards`、`faction`、`namingSource`、`representatives`。
- 分类字段只能复用 `deckId`、`categoryId`、`categoryName`、`status`、`confidence`、`classifierVersion`。
- 禁止把目标数据写成已存在接口。

## 组件约束
- Button 必须有 default、hover、active、disabled、focus 状态。
- Tag / Badge 必须用于状态、势力、指标依据。
- Metric 必须突出数字，标签弱化。
- Table 必须有表头、固定指标列、空状态。
- Filter Bar 必须有 selected、focus、disabled 状态。
- Deck Row 必须对齐 Rank、头像、卡组名、核心构成、指标、按钮。
- Chart Card 只能用于横向堆叠条。
- Loading State 必须使用骨架，不显示假数据。
- Empty State 必须说明当前无数据。
- Error State 必须不破坏布局。
- Modal / Drawer 不在本规格范围内，禁止新增。
- 禁止卡片套卡片。

## 响应式约束
- `1440px` 桌面必须居中显示 `1180px` 主容器。
- `1024px` 平板必须压缩两栏但保持 CTA 可见。
- `768px` 小屏必须切成单栏。
- `390px` 手机必须无页面级横向溢出。
- 手机首页首屏必须看到标题、更新时间、主 CTA、当前第一。
- 手机 TierList 必须显示行块，不显示横向表格。

## 验收
- `1280x720` 首页首屏必须看到环境结论、当前第一、Top 3、TierList CTA。
- `1280x720` TierList 首屏必须看到标题、筛选区、表头或首行。
- `390x844` 首页必须无横向溢出。
- `390x844` TierList 行块必须可读。
- 首页状态切换必须正常。
- TierList 筛选和排序必须正常。
- 控制台必须 0 JS 错误。
- 页面不得出现人工理由、人工标题、人工影响说明。
