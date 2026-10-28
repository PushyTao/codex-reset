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

## 发布验收（2026-10-28）

镜像构建自提交 `bddc12b6395686061bd1612b4cc4047be030937a`。先完成本地验证和提交，再构建镜像；下列镜像验收全部通过后才推送 Docker Hub。

| 检查 | 结果 |
| --- | --- |
| 本地与实际镜像回归测试 | 分别通过 48 / 48 项，包含 7 项订阅测试及现有通知去重回归 |
| 语法与部署文档 | 19 个 JavaScript 文件、两个修改的 Docker 探针语法通过；3 组 Compose 配置、33 段 Bash 命令语法通过 |
| 从真实 1.1.2 数据升级 | 旧镜像创建数据库、加密 SMTP 设置和停用收件人；1.2.0 接管后信息完整保留 |
| 公开订阅接口 | 新用户保存并启用；重复提交不覆盖名称；停用邮箱不重新启用；未同意或跨站请求被拒绝；不泄露收件人、不补发历史 |
| 容器重建 | 订阅用户名、邮箱、启用状态、既有收件人和密钥保留；重复提交不改变记录 |
| 实际调度器与隔离 SMTP | 通过公开接口登记的邮箱收到 SMTPS 预告、STARTTLS 正式提醒各一封，均经认证和加密 |
| 重复通知与失败重试 | 两次容器重建及旧预告回放没有产生第三封邮件；后续新预告遇到 SMTP 451 后按实际间隔重试，成功接收一次后停止 |
| 页面和运行环境 | 8 个 HTTP 资源及 3 个修改的服务端文件与源码一致；健康检查、后台认证和私有文件隔离通过；镜像不包含本地数据库、配置或测试数据 |

开发阶段已验证桌面和 390px 手机布局、表单校验、提交结果及后台收件人显示。镜像验收使用独立数据卷、内部 Docker 网络与测试邮箱，未向真实邮箱发信。运行环境为 `linux/amd64`、Node.js `v24.22.1`、用户 `node`（UID 1000）。

已发布 `pushytao/codex-reset-watch:1.2.0`，并同步 `latest`。发布后重新读取 Docker Hub 远端清单，两个标签与实际验收镜像的摘要一致：

- OCI 索引：`sha256:bc27b62ed03a02eb2b8769db4d3bc009a20eef0836acd8b8047dde5809c50c00`
- `linux/amd64` 运行清单：`sha256:66edb1e1befae3ea905d1bb66b431370d6c53f468fc0149eef8bd613a3fbc550`
