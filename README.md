# Codex Reset

一个可自托管的 Codex 额度重置记录站。首页借鉴 Quota Reset 的米白、黑字、绿色状态风格；数据通过 [Codex Resets 免费公开 API](https://codex-resets.com/api/docs) 同步，保留原帖链接和“社区观测 / 原帖公告”标识。

## 已包含

- 最新重置、90 天日历、真实统计、公告检索与类型筛选、北京 / 洛杉矶 / 本地时间。
- `/admin` 管理后台，首页没有入口；密码登录、会话过期、请求来源与 CSRF 校验。
- 收件邮箱添加与启停、SMTP 设置、指定收件人的测试邮件、发送日志。
- 默认每 5 分钟同步，首次导入历史不发邮件；后续新记录按邮箱去重提醒。
- SQLite 数据持久化，SMTP 密码加密存储，Docker 单容器部署。

## 本地运行

需要 Node.js 24 或更高版本。

```sh
npm ci --registry=https://registry.npmjs.org
npm start
```

打开 <http://127.0.0.1:3000>；后台为 <http://127.0.0.1:3000/admin>。

没有设置 `ADMIN_PASSWORD` 时，首次启动生成随机密码并保存到 `data/admin-password.txt`。终端只显示文件路径，不打印密码。也可复制 `.env.example` 为 `.env` 并填写至少 12 个字符的管理员密码。修改后重启，现有登录会话会失效。

默认仅监听本机。程序启动后自动进行一次同步；网络不可用时显示空状态或已有缓存，不生成演示记录。运行期间每 5 分钟继续同步，可在后台调整。

## Docker 部署

```sh
cp .env.example .env
# 按需编辑 .env
docker compose up -d --build
docker compose logs -f reset
```

首次密码（仅未配置 `ADMIN_PASSWORD` 时）：

```sh
docker compose exec reset cat /app/data/admin-password.txt
```

默认宿主机映射 `127.0.0.1:3000`，适合通过 Nginx / Caddy 转发 HTTPS。数据库、密钥和初始密码都存放在 `reset_data` 命名数据卷中。仅运行一个副本；不要同时启动多个实例共享数据卷。

如果需要直接通过服务器 IP 访问，在 `.env` 增加 `BIND_ADDRESS=0.0.0.0`，并设置 `APP_URL=http://你的服务器IP:3000`、`SECURE_COOKIE=false`、`TRUST_PROXY=0`。通过服务器防火墙控制开放范围。对公网正式使用推荐 HTTPS。

使用域名和 HTTPS 反向代理时：

```dotenv
APP_URL=https://reset.example.com
SECURE_COOKIE=true
TRUST_PROXY=1
```

`APP_URL` 必须和浏览器地址的协议、域名、端口一致，否则后台写入会被拒绝。`TRUST_PROXY=1` 仅适用于应用前只有一层可信反向代理的部署；应用端口应只允许代理连接。Caddy 示例：

```caddyfile
reset.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## 配置邮件提醒

1. 打开 `/admin`，使用管理员密码登录。
2. 在收件邮箱页添加需要接收提醒的邮箱。
3. 在邮件设置填写 SMTP 主机、端口、账号、密码或授权码、发件地址。常见端口：465 使用隐式 TLS；587 使用 STARTTLS。服务器始终验证证书，STARTTLS 连接必须升级为 TLS。
4. 保存后，为已启用的邮箱发送测试邮件。状态显示“SMTP 已接受”表示发信服务器接收了邮件；仍需检查收件箱 / 垃圾箱确认最终送达。
5. 打开邮件提醒开关并保存。只有开关开启时收录的新记录会创建投递项；添加邮箱或打开开关不会补发以前的历史记录。

SMTP 密码在表单留空表示保留；“清除已保存密码”会移除已有密码。公开 API 永远不返回收件邮箱、SMTP 设置和投递日志。SMTP 授权码不能替代收件邮箱；例如 QQ、163 等邮箱通常需要专用 SMTP 授权码。

系统不会在未配置 SMTP 的情况下发送真实邮件。一次发送仅包含一个收件人，其他订阅地址不会被暴露。每个“重置记录 + 邮箱”最多创建一个任务。投递失败按 1、2、4、8 分钟间隔重试，最多尝试 5 次；发送日志保留结果。全局关闭提醒会暂停队列，重新开启后待处理队列会继续。停用邮箱期间不会投递，重新启用后尚未处理的队列也会继续。

SMTP 没有通用的恰好一次协议：如果进程在邮件已被 SMTP 接受、但数据库尚未记录成功的瞬间退出，恢复重试可能产生重复邮件。系统使用稳定 Message-ID 降低重复风险，但不承诺收件服务器一定去重。

## 数据来源与语义

- 使用 `GET https://codex-resets.com/api/v1/resets?limit=100`，按接口返回的游标遍历；`GET /api/v1/status` 读取已公告、尚待执行的重置。
- 来源无需 API key。页面和邮件均附 [Codex Resets](https://codex-resets.com/) 链接以遵守其使用要求。
- `x_post` 表示 Tibo 的原帖，`observed` 表示数据源的社区观测，不冒充官方推文确认。
- 第一次同步只建立基线。之后只有时间晚于已有同步水位的新记录会产生提醒，较早补录的历史不会群发。
- 预告不计入已执行重置的统计，也不触发已重置提醒；预告时间已过仍不会自行转成已执行。平均间隔仅作历史统计。
- 网络、分页或字段校验失败时，本次批次不会写入；页面保留最近一次成功同步的数据，后台记录错误。上游 HTTP 限流会遵守退避窗口。
- 后台支持手动录入 Tibo 原帖，并可选择是否通知。归档记录从公开页移除，未来同步不会重新发布该记录。
- 本站无法读取你的个人 Codex 额度，也不能执行额度重置。实际额度以账户页面为准。

## 备份与运维

本地备份整个 `data/`；Docker 备份整个 `reset_data` 卷。应先停止容器，或使用 SQLite 在线备份工具，以保持 WAL 文件的一致性。`secret.key` 必须和数据库一起备份，丢失后无法解密 SMTP 密码。不要把数据卷、`.env` 或初始密码提交到 Git。

```sh
docker compose stop
# 备份 reset_data 数据卷
docker compose start
```

`GET /healthz` 用于进程健康检查。同步状态在后台“数据同步”页查看。Node.js 24 可能打印 `node:sqlite` ExperimentalWarning，这是运行时对内置 SQLite API 的提示。

## 验证

```sh
npm test
npm run check
docker compose config --quiet
```

测试使用独立内存数据库和本机 SMTP 协议服务器，不会发送真实邮件。覆盖鉴权、同源与 CSRF、秘密掩码、历史基线、分页原子性、归档、公告类型、重复投递和失败重试。

Docker 实际构建、数据持久化、容器重建、SMTPS / STARTTLS、自动队列与故障重试已验收。可复现步骤见 [Docker 验收说明](tests/docker/README.md)，结果与外部数据源连接限制见 [验证记录](docs/verification.md)。邮件依赖锁定为 Nodemailer 10.2.1。

主要代码：`server/source.js` 同步、`server/mail.js` 投递、`server/store.js` 存储、`server/app.js` HTTP 接口；前台和后台位于 `public/`。
