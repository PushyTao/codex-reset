# 使用服务器目录保存数据

项目根目录的 `docker-compose.yml` 现在把 Linux 服务器上的 `/data/codex-reset` 挂载到容器内 `/app/data`。不需要额外的顶层 `volumes` 声明。`compose.hub.yaml` 仍保留命名数据卷部署方式。

## 首次部署，没有需要保留的旧数据

先在服务器创建目录并设置权限。镜像内应用用户的 UID 和 GID 都是 1000：

```sh
sudo mkdir -p /data/codex-reset
sudo chown 1000:1000 /data/codex-reset
sudo chmod 700 /data/codex-reset
```

把新的 `docker-compose.yml` 单独放在服务器的部署目录中，不与其他默认 Compose 文件混放，然后在该目录执行：

```sh
docker compose up -d
docker compose exec reset cat /app/data/admin-password.txt
```

首页为 `http://服务器IP:3000`，后台为 `/admin`。直接 HTTP 访问需要防火墙和安全组允许 TCP 3000。域名和 HTTPS 部署请参阅主 README。

## 从之前的 codex-reset-data 数据卷迁移

本节适用于普通 Linux Docker 宿主机，在服务器上执行。不要先用空目录启动新容器。目标目录必须为空；有其他数据时请选择一个新的目标目录。

1. 使用原来的 Compose 配置停止服务，保留数据卷：

```sh
docker compose down
```

如果原来通过 `docker run --name codex-reset` 启动，则改为执行 `docker stop codex-reset`。必须停止所有使用旧数据的应用实例，才能一致地复制 SQLite 数据。

2. 在同一个 shell 中执行以下命令。复制整个旧目录，包括数据库、可能存在的 WAL 文件、`secret.key` 和 `admin-password.txt`：

```sh
sudo mkdir -p /data/codex-reset
test -z "$(sudo ls -A /data/codex-reset)" || { echo '目标目录不是空目录，请先确认已有数据。'; exit 1; }
OLD_RESET_DATA="$(docker volume inspect codex-reset-data --format '{{.Mountpoint}}')" || exit 1
test -n "$OLD_RESET_DATA" || exit 1
sudo test -f "$OLD_RESET_DATA/reset.sqlite" || { echo '旧数据卷中未找到数据库，停止迁移。'; exit 1; }
sudo cp -a "$OLD_RESET_DATA/." /data/codex-reset/ || exit 1
sudo chown -R 1000:1000 /data/codex-reset
sudo chmod 700 /data/codex-reset
```

3. 用本项目新版 `docker-compose.yml` 替换服务器部署目录中的旧文件，然后启动并查看日志：

```sh
docker compose up -d
docker compose logs --tail 100 reset
```

用原来的后台密码登录，核对历史记录、收件人和 SMTP 设置。旧命名卷保留作为迁移前备份，不要立即删除。

## 后续管理

- `docker compose down` 会停止并删除容器，服务器目录中的文件会保留。
- `docker compose up -d` 会继续使用这个目录中的数据。
- 修改映射左侧的路径即可选择其他服务器目录；容器内路径保持 `/app/data`。
- 当前配置下，服务器的 `reset.sqlite`、`secret.key`、`admin-password.txt` 都位于 `/data/codex-reset/`。
- 备份前停止应用，备份整个目录并保留权限。`secret.key` 丢失后，原来的 SMTP 密码将无法解密。
