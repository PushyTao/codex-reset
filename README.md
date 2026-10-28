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

### 服务器首次部署：从创建目录到启动

服务器需要安装 Docker Engine 和 Docker Compose 插件，并能执行 `docker compose version`。镜像支持 Linux amd64，来自 [pushytao/codex-reset-watch](https://hub.docker.com/r/pushytao/codex-reset-watch)，部署文件固定使用 `1.1.1`。已有 `1.1.0` 部署见 [1.1.1 升级说明](docs/release-1.1.1.md)，已有 `1.0.0` 部署请参照 [两阶段提醒与升级说明](docs/notifications.md)。

下面的命令可以在 Linux 服务器上直接执行：创建部署目录和数据目录，写入完整配置，拉取镜像并启动。无需安装 Node.js、下载源码或创建 `.env` 文件。已有旧数据时，先完成下方“从旧命名数据卷迁移”，再启动。

```sh
# 创建独立的部署目录，保存 docker-compose.yml
mkdir -p "$HOME/codex-reset"
cd "$HOME/codex-reset" || exit 1

# 创建服务器数据目录；镜像以 UID/GID 1000 运行
sudo mkdir -p /data/codex-reset
sudo chown 1000:1000 /data/codex-reset
sudo chmod 700 /data/codex-reset

# 写入完整的 Compose 配置
cat > docker-compose.yml <<'YAML'
name: codex-reset

services:
  reset:
    image: pushytao/codex-reset-watch:1.1.1
    restart: unless-stopped
    init: true
    ports:
      - "3000:3000"
    environment:
      SECURE_COOKIE: "false"
      TRUST_PROXY: "0"
      NETWORK_FAMILY: "4"
    volumes:
      - /data/codex-reset:/app/data
    stop_grace_period: 90s
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
YAML

# 检查配置、拉取镜像、后台启动并查看状态
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

也可以把仓库中的 [docker-compose.yml](docker-compose.yml) 上传到上述部署目录，替代 `cat` 写入配置这一步。部署目录只放这一份 Compose 文件：仓库同时包含用于源码构建的 `compose.yaml`，Docker 会优先读取它；如果直接在源码仓库内使用预构建镜像，每条命令都需显式加上 `-f docker-compose.yml`。

首页：`http://服务器IP:3000`；管理后台：`http://服务器IP:3000/admin`。服务器防火墙和云平台安全组需允许 TCP 3000。后台首次启动会自动生成密码，在部署目录读取：

```sh
docker compose exec reset cat /app/data/admin-password.txt
```

服务器 `/data/codex-reset` 对应容器内 `/app/data`，其中包含 `reset.sqlite`、`secret.key` 和 `admin-password.txt`。管理员密码、收件邮箱、SMTP 配置和历史记录都会保留。仅运行一个应用实例访问这份数据。

### 后续启动、停止与日志

在同一个部署目录执行：

```sh
cd "$HOME/codex-reset" || exit 1

# 后台启动；配置变更后也使用这条命令
docker compose up -d

# 查看最近日志；Ctrl+C 只退出日志查看
docker compose logs --tail 100 -f reset
```

停止并删除容器：

```sh
docker compose down
```

`down` 保留服务器 `/data/codex-reset` 中的文件；再次 `up -d` 会继续使用原数据。若只想停止容器而不删除，可使用 `docker compose stop`，之后用 `docker compose start` 启动。

### 从旧命名数据卷迁移

此前的 `docker run` 命令和旧版 Compose 使用 `codex-reset-data` 命名卷，切换到服务器目录不会自动复制数据。先在旧部署目录执行 `docker compose down`，不添加 `-v`。如果原来使用 `docker run --name codex-reset`，则执行 `docker stop codex-reset`。停止所有访问旧数据的实例后，在同一服务器、同一个 shell 中执行：

```sh
sudo mkdir -p /data/codex-reset
test -z "$(sudo ls -A /data/codex-reset)" || { echo '目标目录非空，请先确认已有数据。'; exit 1; }
OLD_RESET_DATA="$(docker volume inspect codex-reset-data --format '{{.Mountpoint}}')" || exit 1
test -n "$OLD_RESET_DATA" || exit 1
sudo test -f "$OLD_RESET_DATA/reset.sqlite" || { echo '旧数据卷中未找到数据库，停止迁移。'; exit 1; }
sudo cp -a "$OLD_RESET_DATA/." /data/codex-reset/ || exit 1
sudo chown -R 1000:1000 /data/codex-reset
sudo chmod 700 /data/codex-reset
```

随后执行本节的部署命令，用原来的后台密码登录，核对历史、邮箱和 SMTP 设置。完整复制目录才能保留 SQLite 相关文件、加密密钥和初始密码；旧命名卷可暂时保留作为迁移前备份。

更多目录挂载与迁移说明见 [服务器数据目录指南](docs/bind-mount.md)；遇到 `EACCES` 或容器持续重启，见 [常见问题](docs/faq.md)。

### 域名与 HTTPS

以上配置用于通过服务器 IP 直接访问 HTTP。通过宿主机 Nginx / Caddy 转发 HTTPS 时，将 `docker-compose.yml` 中该服务的端口与环境变量改为以下内容，替换为自己的域名，再执行 `docker compose up -d`：

```yaml
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      APP_URL: "https://reset.example.com"
      SECURE_COOKIE: "true"
      TRUST_PROXY: "1"
      NETWORK_FAMILY: "4"
```

`APP_URL` 必须和浏览器地址的协议、域名、端口一致，否则后台写入会被拒绝。`TRUST_PROXY=1` 仅适用于应用前只有一层可信反向代理的部署。Caddy 示例：

```caddyfile
reset.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### 从源码构建

在源码仓库目录执行以下命令，使用原有 `compose.yaml`。该方式默认只映射 `127.0.0.1:3000`，数据保存在 Compose 的 `reset_data` 命名卷中，与上述目录挂载方式不同：

```sh
cp .env.example .env
# 按需编辑 .env
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml logs -f reset
```

采用源码构建方式时，后续所有 Compose 命令都加上 `-f compose.yaml`。不要与上面的预构建镜像同时占用同一端口。

### 可选：预构建镜像与命名数据卷

如需使用 Docker 管理的命名卷，可在仓库目录使用 [compose.hub.yaml](compose.hub.yaml)。它使用相同的 1.1.1 镜像，默认只监听 `127.0.0.1:3000`；可按 `.env.example` 配置地址等参数：

```sh
docker compose -f compose.hub.yaml pull reset
docker compose -f compose.hub.yaml up -d
```

后续命令都需加上 `-f compose.hub.yaml`，并在同一个目录执行以保持 Compose 项目名一致。数据保存在项目的 `reset_data` 命名卷中，不会自动读取或迁移 `/data/codex-reset`；请按现有数据位置选择部署方式。停止时使用 `docker compose -f compose.hub.yaml down`，保留数据时不要加 `--volumes`。

## 配置邮件提醒

详细步骤见 [邮箱配置指南](docs/email-setup.md)，包括全部表单字段、QQ / 163 / Gmail 示例、授权码获取、测试投递、自动提醒条件和故障排查。

1. 准备一个用于发信的邮箱，并按服务商要求开启 SMTP、生成授权码或应用专用密码。
2. 登录 `/admin`，在“收件邮箱”添加并启用接收提醒的地址；收件人不需要提供密码。
3. 在“邮件设置”填写发件账户的 SMTP 参数，点击“保存邮件设置”。465 端口勾选“使用隐式 TLS”，587 端口不勾选并使用 STARTTLS；以服务商要求为准。
4. 返回“收件邮箱”，选择测试对象并发送测试邮件；确认真实收件箱或垃圾箱收到邮件。
5. 在“邮件设置”勾选“启用重置邮件通知”并保存，在“数据同步”确认自动同步已开启。

SMTP 配置通过后台保存，立即用于后续发送，无需修改 Compose 或重启容器。开启通知后，新预告发送一次提醒，正式重置后再发送一次；同一阶段对同一邮箱不会重复排队。测试邮件可以在自动提醒关闭时发送；首次导入历史、重复同步已有记录，以及开启开关前已经收录的阶段不会补发。自动通知结果在“发送日志”查看，测试结果在“收件邮箱”的“最近测试”查看。

## 数据来源与语义

- 使用 `GET https://codex-resets.com/api/v1/resets?limit=100`，按接口返回的游标遍历；`GET /api/v1/status` 读取已公告、尚待执行的重置。
- 来源无需 API key。页面和邮件均附 [Codex Resets](https://codex-resets.com/) 链接以遵守其使用要求。
- `x_post` 表示 Tibo 的原帖，`observed` 表示数据源的社区观测，不冒充官方推文确认。
- 第一次完整同步只为已完成的历史建立基线，不群发历史。当前有效预告可提醒一次，之后该预告正式重置再提醒一次；已有预告转为正式重置时，即使上游沿用预告时间也不会漏发。
- 预告与正式重置分别持久化去重，不计入同一阶段。重复轮询、重启、修改预告时间或原文不会重复提醒；预告不计入已执行统计，到达预计时间也不会自行认定重置完成。平均间隔仅作历史统计。
- 历史列表与状态接口独立处理：历史接口失败时，仍可读取状态接口中的预告和最新已完成重置；状态接口失败时，完整历史仍可更新。分页失败不会提交不完整历史，也不会用单条状态快照推进历史基线。后台保留错误，各接口分别遵守限流退避窗口。
- 已完成或撤下的预告会取消尚未发送的预告邮件。SMTP 明确拒收可重试；发送时进程中断或回执不明会标为“结果待确认”，为避免重复邮件不自动重发，需检查收件箱或 SMTP 服务商日志。
- 后台支持手动录入 Tibo 原帖，并可选择是否通知。归档记录从公开页移除，未来同步不会重新发布该记录。
- 本站无法读取你的个人 Codex 额度，也不能执行额度重置。实际额度以账户页面为准。

## 备份与运维

本地 Node.js 运行时备份整个 `data/`；使用 `docker-compose.yml` 部署时备份整个服务器目录 `/data/codex-reset`；从源码 `compose.yaml` 部署时备份其 `reset_data` 命名卷。应先停止容器，或使用 SQLite 在线备份工具，以保持 WAL 文件的一致性。`secret.key` 必须和数据库一起备份，丢失后无法解密 SMTP 密码。不要把数据目录、数据卷、`.env` 或初始密码提交到 Git。

```sh
cd "$HOME/codex-reset" || exit 1
docker compose stop
# 备份整个 /data/codex-reset 目录，并保留文件权限
docker compose start
```

`GET /healthz` 用于进程健康检查。同步状态在后台“数据同步”页查看。Node.js 24 可能打印 `node:sqlite` ExperimentalWarning，这是运行时对内置 SQLite API 的提示。

## 验证

```sh
npm test
npm run check
docker compose -f docker-compose.yml config --quiet
docker compose -f compose.yaml config --quiet
docker compose -f compose.hub.yaml config --quiet
```

测试使用独立内存数据库和本机 SMTP 协议服务器，不会发送真实邮件。覆盖鉴权、同源与 CSRF、秘密掩码、历史基线、分页原子性、归档、公告类型、重复投递和失败重试。

Docker 实际构建、数据持久化、容器重建、SMTPS / STARTTLS、自动队列与故障重试已验收。通用步骤见 [Docker 验收说明](tests/docker/README.md)，两阶段提醒的复现步骤见 [通知验收说明](docs/notifications.md)。本次更新见 [1.1.1 发布说明](docs/release-1.1.1.md)，初版历史记录见 [1.0.0 验证记录](docs/verification.md)。邮件依赖锁定为 Nodemailer 10.2.1。

主要代码：`server/source.js` 同步、`server/mail.js` 投递、`server/store.js` 存储、`server/app.js` HTTP 接口；前台和后台位于 `public/`。
