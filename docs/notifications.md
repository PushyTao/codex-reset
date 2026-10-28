# 预告与正式重置的两阶段提醒

从 `1.1.0` 起，后台的“启用重置邮件通知”同时控制两种提醒，无需增加新的开关：

| 数据源变化 | 邮件行为 |
| --- | --- |
| 发现一条新预告 | 发送一封“重置预告”，显示预计时间和原帖链接 |
| 同一条预告反复同步、修改原文或预计时间 | 不重复发送 |
| 数据源确认正式重置 | 再发送一封正式重置提醒 |
| 正式记录反复同步、程序重启或容器重建 | 已接受的邮件不重发 |
| 仅到达预告的预计时间 | 不自行认定重置完成，继续等待数据源确认 |
| 首次导入已完成的历史 | 不群发历史；当前有效预告可以提醒一次 |

预告和正式记录按来源身份、阶段、收件邮箱分别持久化去重。数据源在两个接口中使用数字 ID、`observed-` ID 或同一条已验证 X 原帖链接时，会识别已证实的别名。发送日志显示通知阶段和投递状态。

从 `1.1.2` 起，同一轮重置内，不同原帖只要重置类型和已知预计时间相同，就共用一条预告投递记录。已有公告时间更晚的同类型正式重置时，早于它的预告视为过期，不再展示或排队；启动时也会取消旧版遗留的相关待发任务。正式重置之后新发布的预告属于新一轮，不会因预计时间相同而被合并。不同类型、不同预计时间及未知预计时间的不同原帖不按时间合并。

历史接口失败时仍会处理状态接口中的预告和最新已完成重置；状态接口失败时，完整历史仍能同步。未完成的历史分页不写入，单条状态快照不推进历史水位。若预告已确认完成或撤下，会取消尚未发送的预告任务。

关闭通知时已经收录的阶段不会在重新开启后补发；之前已经排队但尚未完成的任务仍可继续。升级前只展示、从未生成投递任务的当前预告，在新版首次读取时可以提醒一次。收件邮箱、SMTP 参数和定时同步设置见 [邮箱配置指南](email-setup.md)。

## 从 1.0.0 升级

以下适用于此前的部署目录 `~/codex-reset`、服务名 `reset`、服务器数据目录 `/data/codex-reset`。目录中应使用单独的 `docker-compose.yml`；源码仓库同时有 `compose.yaml` 时，请显式加 `-f docker-compose.yml`。

先停止应用并备份完整数据，避免数据库与 WAL 不一致：

```sh
cd "$HOME/codex-reset" || exit 1
docker compose stop reset || exit 1
umask 077
mkdir -p backups || exit 1
sudo tar -C /data -czf "backups/codex-reset-before-1.1.2-$(date +%Y%m%d-%H%M%S).tar.gz" codex-reset || exit 1
```

将镜像版本从 `1.0.0` 改为 `1.1.2`，拉取并启动：

```sh
cd "$HOME/codex-reset" || exit 1
sed -i 's#pushytao/codex-reset-watch:1.0.0#pushytao/codex-reset-watch:1.1.2#g' docker-compose.yml
docker compose config --quiet || exit 1
docker compose pull reset || exit 1
docker compose up -d --wait --wait-timeout 90 || exit 1
docker compose ps
```

如果原配置使用 `latest`，请直接把 `image` 改成 `pushytao/codex-reset-watch:1.1.2`，再执行拉取和启动命令。保持 `/data/codex-reset:/app/data` 挂载不变，新版会自动增补数据库字段，保留密码、SMTP 配置、收件邮箱、历史及已有投递记录。重新登录后台，确认通知和定时同步开关已开启。

## 结果待确认

SMTP 回执可能在邮件已接收之后丢失。为避免同一封邮件再次发送，发送过程中断或结果不明时，程序会标记“结果待确认”，不自动重发。请核对收件箱、垃圾箱和服务商日志；这种选择可能留下未送达的邮件，不能同时保证绝不重复与必达。

明确的连接建立失败或 SMTP 拒收仍按既有退避策略重试，最多五次。预告和正式提醒是两个独立任务：一阶段失败或结果不明，不阻止另一阶段在数据源确认后排队。

## Docker 验收复现

在 Windows 工作区先按 `tests/docker/create-cert.ps1` 生成隔离 SMTP 测试证书，再执行：

```sh
docker build -t pushytao/codex-reset-watch:1.1.2 .
docker compose -f tests/docker/notifications.compose.yaml up -d --wait --wait-timeout 90
docker compose -f tests/docker/notifications.compose.yaml exec -T reset node /fixtures/scripts/notification-probe.js announce
docker compose -f tests/docker/notifications.compose.yaml up -d --force-recreate --no-deps --wait --wait-timeout 90 reset
docker compose -f tests/docker/notifications.compose.yaml exec -T reset node /fixtures/scripts/notification-probe.js restart
docker compose -f tests/docker/notifications.compose.yaml exec -T reset node /fixtures/scripts/notification-probe.js complete
docker compose -f tests/docker/notifications.compose.yaml up -d --force-recreate --no-deps --wait --wait-timeout 90 reset
docker compose -f tests/docker/notifications.compose.yaml exec -T reset node /fixtures/scripts/notification-probe.js verify
docker compose -f tests/docker/notifications.compose.yaml exec -T reset node /fixtures/scripts/notification-probe.js retry
docker compose -f tests/docker/notifications.compose.yaml down --volumes
```

该验收使用独立数据卷与内部网络，关闭真实源定时访问，邮件只发送到不会转发邮件的模拟 SMTP 服务。覆盖实际应用调度器、SMTPS、STARTTLS、不同预告帖合并、正式公告后旧预告回流、两次容器重建、来源别名去重及一次真实 451 拒收退避。

### 从真实旧版数据验证升级

在生成测试证书后，使用旧镜像 `1.1.1` 创建含遗留待发预告的独立测试卷，再由 `1.1.2` 应用启动并清理。验证脚本以只读方式检查数据库，避免由脚本自己触发清理：

```sh
docker compose -p codex-reset-legacy-check -f tests/docker/notifications.compose.yaml -f tests/docker/legacy-notifications.override.yaml up -d --wait --wait-timeout 90
docker compose -p codex-reset-legacy-check -f tests/docker/notifications.compose.yaml -f tests/docker/legacy-notifications.override.yaml exec -T reset node /fixtures/scripts/notification-probe.js verify-legacy
docker compose -p codex-reset-legacy-check -f tests/docker/notifications.compose.yaml -f tests/docker/legacy-notifications.override.yaml down --volumes
```

两阶段提醒初版的实际结果及镜像标识见 [1.1.0 验收记录](release-1.1.0.md)，当前修订版见 [1.1.2 发布说明](release-1.1.2.md)。
