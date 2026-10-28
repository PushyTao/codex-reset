# 1.1.1 发布说明

本次为修订版本，调整首页“最近一次重置”和“下一次重置”的展示。

- 两张卡片共用尺寸、边框、字体层级和底部来源布局，以浅绿与米白区分状态。
- 预告日期作为主信息展示，预计时间和时区单独列出；未知时间显示“时间待定”。
- 预计时间已过但来源尚未确认时显示“等待确认”，不据此认定重置完成。
- 无预告、空记录、加载和连接失败使用一致的卡片布局。

镜像标签：`pushytao/codex-reset-watch:1.1.1`，平台 `linux/amd64`。与 1.1.0 使用相同的数据目录、数据库结构和邮件配置。

## 从 1.1.0 升级

在服务器部署目录执行。以下适用于单独存放 `docker-compose.yml` 的 `~/codex-reset`，数据继续保存在 `/data/codex-reset`：

```sh
cd "$HOME/codex-reset" || exit 1
sed -i 's#pushytao/codex-reset-watch:1.1.0#pushytao/codex-reset-watch:1.1.1#g' docker-compose.yml
docker compose config --quiet || exit 1
docker compose pull reset || exit 1
docker compose up -d --wait --wait-timeout 90 || exit 1
docker compose ps
```

无需先执行 `down`。如果使用 `latest` 或其他版本，请把 `image` 明确改成 `pushytao/codex-reset-watch:1.1.1` 后再执行拉取和启动；使用源码仓库中的部署文件时，每条命令显式添加 `-f docker-compose.yml`。升级后刷新网页即可看到新卡片，必要时强制刷新浏览器缓存。

数据备份方法见 [README](../README.md#备份与运维)。从 1.0.0 升级请先阅读 [两阶段提醒说明](notifications.md)。

## 验收结果

验收及发布日期：2026-10-28（北京时间）。先提交并推送源码，再构建镜像；下列镜像检查全部通过后才推送 Docker Hub。

| 检查 | 结果 |
| --- | --- |
| 本机 `npm test` | 35 / 35 通过 |
| 最终生产镜像内 `npm test` | 35 / 35 通过 |
| JavaScript 语法 | 17 个文件通过 |
| 构建时依赖审计 | 0 个已知漏洞 |
| 源码 UI 验收 | 320 / 390 / 768 / 1280 px 下卡片等高，无卡片或页面横向溢出；时区切换、无预告、时间未知、预计时间已过、空数据、加载和连接失败显示正常 |
| 镜像中的首页、后台、CSS 与两份 JS | HTTP 200，五份资源与已提交源码逐字节一致，首页包含新版两张状态卡片 |
| 健康与权限 | healthy；node 用户 UID 1000；cap_drop ALL；no-new-privileges |
| 预告和正式重置 | 调度器通过认证的 SMTPS / STARTTLS 各投递 1 封 |
| 两次容器重建、预告编辑与重复同步 | 密钥、配置和投递状态保留，没有重复邮件 |
| SMTP 451 临时拒收 | 等待真实退避后第二次尝试成功，仅增加 1 封已接受邮件 |
| 镜像内容 | 未包含本地数据库、密码、密钥、`.env`、Git、测试脚本或临时产物 |
| 部署说明 | Compose 配置有效；README 内嵌配置一致；31 个本地链接和 29 段 Shell 命令语法通过 |

Docker 验收使用独立的 `codex-reset-release-111` 项目、测试数据卷和内部 SMTP 网络，共接收 3 封预期邮件。测试不使用生产数据、不向外部邮箱投递。邮件验收步骤见 [两阶段提醒说明](notifications.md)。

## 已发布镜像

- 镜像源码提交：[9ec821e](https://github.com/PushyTao/codex-reset/commit/9ec821e071acb7e8abb216349ff7633e2b0d4788)
- Docker Hub：[pushytao/codex-reset-watch](https://hub.docker.com/r/pushytao/codex-reset-watch)
- 标签：`1.1.1`、`latest`
- 平台：`linux/amd64`；Node.js：`v24.22.1`
- 镜像索引：`sha256:7dc69be6ef340b227affbc07225605a39276d417c416d1c958dade290860457a`
- 运行镜像清单：`sha256:beb26c2ee254aad8fb12bca924d8226a9586f699e9e440ed165e086700f31dd3`

两个标签均已推送，并分别通过 Docker Hub 远端清单核对为同一已验证镜像。镜像标签中记录了源码提交和版本；发布后的文档补充不改变镜像内容。
