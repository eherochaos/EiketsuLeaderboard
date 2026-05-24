# 首页 + TierList 页面设计 v1

## 范围
- 只能设计首页环境总览和 TierList 榜单页。
- 禁止实现页面、接口、采集、统计规则。
- 禁止修改 `apps/web/`、`package.json`、`.github/`。

## 视觉
- 必须偏榜单媒体页，兼顾高频数据扫描。
- 必须突出当前环境、热门卡组、注目单卡。
- 必须少用装饰卡片，多用榜单、分区、图表、紧凑指标。

## 首页
- 必须展示当前环境势力占比饼图。
- 每个势力必须展示 1-2 个代表卡组或关键单卡。
- 必须展示环境注目单卡列表。
- 注目单卡必须展示使用率、胜率、综合Rank、简短理由。
- 必须提供 TierList、注目单卡、注目组合、卡组分类说明入口。

## TierList
- 默认必须按综合Rank排序。
- 必须支持单卡命名、组合命名、类型命名的卡组。
- 每行必须展示综合Rank、胜率、使用率、倾奇点、样本数、分类名。
- 卡组详情页只能保留入口，不设计详情内容。

## 数据
- 首页目标字段：`factionShare`、`representativeDecks`、`featuredCards`、`updatedAt`。
- TierList 目标字段：`deckId`、`deckName`、`categoryId`、`categoryName`、`rankScore`、`winRate`、`usageRate`、`kabukiPoints`、`sampleSize`。
- 现有契约字段：`deckId`、`categoryId`、`categoryName`、`status`、`confidence`、`classifierVersion`。
- 禁止把目标字段描述成已存在 API。

## 旧服务数据迁移
- 数据迁移核心文件夹必须是 `apps/api`。
- 迁移工具入口必须是 `apps/api/data-migration/legacy_service_migration.py`。
- 旧库只能作为一次性导入源。
- 运行时数据必须读取 `apps/api/data/legacy-service`。
- 必须迁移新网页需要的完整服务数据。
- 必须优先使用榜单物化数据生成首页和 TierList。
- 必须迁移卡牌 lookup 和版本配置。
- 必须迁移上传、邀请、用户、token hash 的状态数据。
- 禁止迁移明文 token、管理口令、cookies、浏览器 profile。
- 禁止把 `data/raw` HTML 作为新网页运行时依赖。
- 禁止复用旧 FastAPI HTML 页面。
- 只能把导出报表用于校验和分类输入。

## 验收
- 首页必须回答当前环境由哪些势力和卡组主导。
- TierList 必须回答哪个卡组值得关注以及为什么排在这里。
- 实现者必须能按本文直接制作静态原型。
