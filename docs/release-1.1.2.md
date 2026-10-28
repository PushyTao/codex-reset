# 1.1.2 发布说明

本次修复正式重置后又收到旧预告的问题。此前主要按原帖 ID 去重，同一次重置换用另一条预告帖时，会被识别成新的通知。

- 同一轮重置中，同类型、同一已知预计时间的多条预告帖共用投递记录。
- 已有公告时间更晚的同类型正式重置时，旧预告不再展示或发送。
- 启动时先取消遗留的旧预告待发任务，再启动邮件工作器；已发送记录保持不变。
- 正式重置后新发布的预告仍可提醒。常规与备用额度、不同预计时间，以及没有预计时间的不同原帖不会按时间合并。

镜像：`pushytao/codex-reset-watch:1.1.2`，平台 `linux/amd64`。继续使用现有数据库、密钥和 SMTP 设置，无需删除数据或重新配置邮箱。

## 从 1.1.0 / 1.1.1 升级

以下适用于服务器 `~/codex-reset` 目录单独存放 `docker-compose.yml`，数据挂载仍为 `/data/codex-reset:/app/data`：

```sh
cd "$HOME/codex-reset" || exit 1
sed -i -e 's#pushytao/codex-reset-watch:1.1.0#pushytao/codex-reset-watch:1.1.2#g' -e 's#pushytao/codex-reset-watch:1.1.1#pushytao/codex-reset-watch:1.1.2#g' docker-compose.yml
docker compose config --quiet || exit 1
docker compose pull reset || exit 1
docker compose up -d --wait --wait-timeout 90 || exit 1
docker compose ps
```

无需先 `down`。使用 `latest` 时可以直接拉取和启动；使用源码仓库里的部署文件时，各条命令显式添加 `-f docker-compose.yml`。旧预告尚未发出时会显示为已取消；此前已经送达的重复邮件无法撤回，发送记录会保留。

数据备份见 [README](../README.md#备份与运维)，两阶段提醒规则及 Docker 验收步骤见 [通知说明](notifications.md)。
