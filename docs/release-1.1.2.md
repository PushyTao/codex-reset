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

## 发布验收（2026-10-28）

镜像构建自提交 `fbf8182b6a167d5b5f65cb8447b7f07d3a95f59d`。下列检查全部通过后才推送 Docker Hub；随后读取远端清单确认 `1.1.2` 与 `latest` 指向同一镜像。

| 检查 | 结果 |
| --- | --- |
| 本地与实际镜像中的回归测试 | 分别通过 41 / 41 项，包含 6 项新增通知回归测试 |
| JavaScript、Compose 与部署文档 | 17 个应用文件及通知探针语法通过；3 组 Compose 配置有效；31 段 Bash 命令语法通过 |
| 真实应用调度器与隔离 SMTP | SMTPS 预告、STARTTLS 正式提醒各收到一次；认证与加密有效 |
| 同轮预告、正式提醒后重启 | 交替同步两条同预计时间预告不重发；正式提醒后重建容器、回放两条旧预告，收件箱仍为两封 |
| 从实际 1.1.1 数据升级 | 旧镜像生成“预告待发、正式提醒已发送”数据；1.1.2 启动后旧预告取消、收件箱为空，已发记录、密钥和 SMTP 配置保留 |
| SMTP 暂时拒绝 | 模拟 451 后等待实际重试间隔，成功接收一次后停止重试 |
| HTTP、权限与镜像内容 | 首页、后台及 3 个静态资源与源码逐字节一致，修复后的 store.js 哈希一致；健康检查与登录保护通过；无本地配置、数据库和测试产物打包入镜像 |

验收使用内部 Docker 网络、独立测试数据卷和测试收件地址，没有联系生产 SMTP 或向真实邮箱发信。升级断言直接只读查询数据库，避免验证脚本本身触发修复。运行环境为 `linux/amd64`、Node.js `v24.22.1`、非 root 用户 `node`（UID 1000）。

已发布标签：`pushytao/codex-reset-watch:1.1.2` 和 `pushytao/codex-reset-watch:latest`。

- 两个标签的 OCI 索引摘要：`sha256:3b5fe93dde88cf468f06d42f76bf1a1306f076ef6a781f643c65d683dee4fc59`
- `linux/amd64` 运行镜像清单摘要：`sha256:90adccb590ff166e5851fcbf12cdb3d4bd69bed85b3e11e03d3edfa181757804`
