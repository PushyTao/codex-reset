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
