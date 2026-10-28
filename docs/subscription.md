# 邮箱自助订阅

此功能从 `1.2.0` 起提供。使用 `pushytao/codex-reset-watch:1.2.0` 或更新版本，升级步骤见 [1.2.0 发布说明](release-1.2.0.md)。

## 访问与填写

直接访问站点的 `/subscribe`，例如 `http://服务器IP:3000/subscribe`。首页、导航栏和页脚不添加订阅入口。页面带有禁止搜索引擎索引的标记；知道地址的访客可以直接使用。

填写用户名（1–80 个字符）和自己的邮箱，勾选接收提醒后提交。用户名用于识别收件人，保存在后台“收件邮箱”的备注名称中。本页直接登记收件信息，无需账号密码或邮箱验证码。

- 新邮箱默认启用，接收后续新预告及正式重置提醒，各阶段按现有规则去重；提交订阅不会发送测试邮件或补发历史公告。
- 同一邮箱忽略首尾空格和大小写。重复提交不会新增收件人、修改原有名称或重新启用已停用的邮箱。
- 所有有效提交使用相同反馈，不向访客透露某个邮箱是否已登记。邮箱和用户名不会出现在公开状态接口或首页。
- 修改已有信息、停用或重新启用邮箱，请联系站点管理员；启停在 `/admin` 的收件邮箱列表中管理。

## 发信与持久化

邮件共用管理员在 `/admin` 配置的 SMTP 服务，只有启用“重置邮件通知”后才会发送。表单提交成功表示订阅请求已处理，不表示邮件已经送达。

订阅信息直接保存在现有 `reset.sqlite` 的收件人表中，无需新数据库或迁移。使用 `/data/codex-reset:/app/data` 部署时，数据文件位于服务器 `/data/codex-reset/reset.sqlite`。备份方式与原有收件人一致。

## 请求保护

公开接口为 `POST /api/subscribe`，仅接受同源 JSON 请求，并校验用户名、邮箱和同意选项。每个来源 IP 每 15 分钟最多提交 5 次，超出时返回 `429` 和 `Retry-After`。此限制保存在进程内，重启后重置。

反向代理部署时，沿用现有 `APP_URL` 与 `TRUST_PROXY` 配置，确保来源校验和访客 IP 识别正确；未配置受信代理时不会采信访客自行填写的 `X-Forwarded-For`。不要将不受信任的代理层数纳入信任范围。

## Docker 验收

按 [通知验收](notifications.md#docker-验收复现) 生成隔离 SMTP 测试证书并构建当前镜像后，执行下列命令。`seed` 使用真实 `1.1.2` 镜像创建旧数据库、SMTP 设置和一个已停用收件人，应用使用当前镜像接管；所有数据和发信均留在测试项目内部。

```sh
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml up -d --wait --wait-timeout 90
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/subscription-probe.js initial
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js announce
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml up -d --force-recreate --no-deps --wait --wait-timeout 90 reset
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/subscription-probe.js restarted
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js restart
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js complete
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml up -d --force-recreate --no-deps --wait --wait-timeout 90 reset
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js verify
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js retry
docker compose -p codex-subscription-check -f tests/docker/notifications.compose.yaml -f tests/docker/subscription.override.yaml down --volumes
```
