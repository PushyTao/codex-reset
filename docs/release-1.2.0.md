# 1.2.0 发布说明

新增 `/subscribe` 自助订阅页。访客填写用户名和自己的邮箱、同意接收提醒后，即可加入后台收件人列表；首页、导航和页脚没有入口按钮。

- 页面沿用米白、黑字、绿色的站点样式，支持桌面和手机布局，并显示输入错误和提交成功状态。
- 同一邮箱按大小写和首尾空格归一化，重复提交不新增、不覆盖原名称、不重新启用已停用的邮箱。
- 不公开收件人信息；公开提交要求同源 JSON，校验输入和同意选项，每个 IP 每 15 分钟最多提交 5 次。
- 新订阅使用原有 SMTP 服务和两阶段去重规则，后续预告、正式重置分别提醒；提交时不发送测试邮件或补发历史。

镜像为 `pushytao/codex-reset-watch:1.2.0`，支持 `linux/amd64`。本次复用现有收件人表，无需数据库迁移；数据挂载继续使用 `/data/codex-reset:/app/data`。

## 从 1.1.x 升级

在服务器原部署目录执行：

```sh
cd "$HOME/codex-reset" || exit 1
sed -i 's#pushytao/codex-reset-watch:1\.1\.[012]#pushytao/codex-reset-watch:1.2.0#g' docker-compose.yml
docker compose -f docker-compose.yml config --quiet || exit 1
docker compose -f docker-compose.yml pull reset || exit 1
docker compose -f docker-compose.yml up -d --wait --wait-timeout 90 || exit 1
docker compose -f docker-compose.yml ps
```

`-f docker-compose.yml` 明确选择 Docker Hub 部署配置，避免源码仓库内的 `compose.yaml` 优先被读取。目录只有 `docker-compose.yml` 时可以省略 `-f docker-compose.yml`。使用 `latest` 的部署无需修改标签，直接拉取和启动即可；无需先 `down`。

升级后访问 `http://服务器IP:3000/subscribe`；已有域名时使用该域名加 `/subscribe`。订阅信息可在 `/admin` 的“收件邮箱”中查看。沿用原有 SMTP 和“启用重置邮件通知”设置；提交成功代表登记请求已处理，不代表邮件已送达。

完整行为见 [订阅说明](subscription.md)，备份见 [README](../README.md#备份与运维)，旧预告去重修复见 [1.1.2 发布说明](release-1.1.2.md)。
