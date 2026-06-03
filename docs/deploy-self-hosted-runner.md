# Self-hosted Deploy Runner

## Runner
- 必须装在生产 VPS。
- 必须使用标签：`self-hosted`、`linux`、`eiketsu-prod`。
- 推荐用户：`ubuntu` 或 `eiketsu-runner`。

## GitHub Secrets
- 必须设置：`DEPLOY_PATH`。
- 推荐设置：`SITE_ANALYTICS_ADMIN_TOKEN`。
- 不再需要：`DEPLOY_SSH_KEY`、`DEPLOY_SSH_KEY_B64`、`DEPLOY_HOST`、`DEPLOY_USER`。

## Server Commands
- 进入 runner 目录。
- 执行 `./config.sh` 注册 runner。
- 执行 `sudo ./svc.sh install`。
- 执行 `sudo ./svc.sh start`。

## Deploy
- merge 到 `main` 后自动触发。
- 也可以手动运行 `Deploy` workflow。
- 部署脚本：`scripts/deploy/self-hosted-main.sh`。
