# 战祭上传检查清单

## 事故结论
- 必须有 `festival_period_source=official`，否则战祭快照跳过周期。
- 上传窗口只能表示采集范围，不能当作 Run 周期。

## 上传前
- 必须使用含 #84 之后逻辑的客户端。
- 必须保持会员登录态可打开官方战祭页。
- 必须确认官方页能检测到开放期。

## 上传日志
- 必须看到 `battle_festival` 采集启动。
- 必须看到来源 `official_period`。
- 必须看到上传场数大于 0。
- 必须看到 player 侧 `戦功` 样本大于 0。

## 上传后
- 必须检查 `/api/leaderboard-refresh-status`。
- 必须检查 `/api/battle-festival-snapshot`。
- `battleFestivalSnapshot.periodStatus` 必须等于 `official`。
- `battleFestivalSnapshot.festivalPeriodSource` 必须等于 `official`。
- `battleFestivalSnapshot.sourceUploadId` 必须等于最新战祭上传 id。
- `metadata.dateFrom/dateTo` 必须等于官方战祭开放期。
- `/battle-festival/` 必须显示同一 Run 日期。

## 失败判定
- `skipped_missing_official_period` 表示上传包没有可信官方周期。
- `festivalPeriodSource` 为空表示本地工具或上传包不是新链路。
- `戦功` 样本为 0 表示本地旧详情缓存或未重抓 player 侧戦功。
