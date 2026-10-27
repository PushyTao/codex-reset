# 常见问题

## 启动后容器一直 restarting，无法读取管理员密码

### 报错现象

执行：

```sh
docker compose exec reset cat /app/data/admin-password.txt
```

Docker 提示容器正在重启：

```text
Container ... is restarting, wait until the container is running
```

此时仍可读取容器日志：

```sh
docker compose logs --tail=80 reset
```

本次实际日志中的关键错误为：

```text
Error: EACCES: permission denied, open '/app/data/secret.key'
    at writeFileSync (node:fs:2496:35)
    at file:///app/server/index.js:14:25
```

### 原因

日志确认应用在创建加密密钥 `secret.key` 时被文件系统拒绝访问，启动进程因此退出。Compose 的 `restart: unless-stopped` 会再次启动容器，于是形成重启循环；读取密码时出现的 `Container is restarting` 是这个启动失败的后续表现。

镜像使用 `node` 用户运行，其 UID/GID 为 `1000:1000`。服务器终端以 `root` 登录，并不意味着容器中的应用也以 root 运行。当前配置将服务器目录绑定到容器数据目录：

```yaml
volumes:
  - /data/codex-reset:/app/data
```

挂载后实际使用的是服务器目录的权限。镜像构建时对 `/app/data` 设置的所有权，不会自动应用到服务器的 `/data/codex-reset`。如果该目录由 root 创建，但未授予容器 UID 1000 写权限，应用就无法创建密钥、密码文件或数据库。

本次日志能确定的是数据路径访问被拒绝；是否由目录属主、权限或额外的宿主机访问限制导致，还需结合服务器目录信息判断。下面先修正当前部署需要的属主与目录权限。

### 修复命令

以下命令在 Linux 服务器的 **root 终端**执行，按当前部署目录 `~/codex-reset`、数据目录 `/data/codex-reset` 编写。普通管理员执行 `mkdir`、`chown`、`chmod` 时需加 `sudo`。如果修改过挂载路径，请使用实际的服务器目录。

```sh
cd "$HOME/codex-reset" || exit 1

# 停止重启中的应用，保留容器和数据
docker compose stop reset || exit 1

# 修正数据目录及已有文件的属主
mkdir -p /data/codex-reset || exit 1
chown -R 1000:1000 /data/codex-reset || exit 1
chmod 700 /data/codex-reset || exit 1

# 启动并等待健康检查通过，失败时先查看日志
docker compose up -d --wait --wait-timeout 90 || exit 1

# 确认状态，再读取初始管理员密码
docker compose ps
docker compose exec reset cat /app/data/admin-password.txt
```

这些命令调整文件属主和目录权限，保留已有数据内容。不要通过删除 `secret.key` 处理权限问题：它用于解密已保存的 SMTP 密码，必须与原数据库一起保留。当前目录无需设置为 `777`，应用用户拥有读写权限即可。

### 如何确认恢复

```sh
stat -c '%u:%g %a %n' /data/codex-reset
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

在当前配置下，目录信息应为 `1000:1000 700 /data/codex-reset`；容器应持续运行并通过健康检查，健康接口应返回成功响应，读取初始密码不再出现 restarting 错误。若自行设置了 `ADMIN_PASSWORD`，程序不会生成初始密码文件，直接使用自己设置的密码登录。

`up --wait` 超时或再次出现权限错误，表示问题尚未解决，不应直接认定为启动成功。

### 修正权限后仍失败

先收集新日志和实际目录信息：

```sh
docker compose logs --tail=40 reset
ls -ldn /data/codex-reset
ls -ln /data/codex-reset
```

再检查运行容器实际挂载到 `/app/data` 的来源及读写状态，避免修改了另一个目录的权限：

```sh
docker inspect "$(docker compose ps --all --quiet reset)" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}} {{.Source}} -> {{.Destination}} rw={{.RW}}{{end}}{{end}}'
```

当前配置应显示 `bind /data/codex-reset -> /app/data rw=true`。若来源不同，先核对部署目录中实际使用的 Compose 文件。把这些输出与新日志一起用于进一步排查；目录属主正确并不能排除其他宿主机访问限制。

完整部署、目录创建和数据迁移步骤见 [README](../README.md)；邮件配置和密钥备份说明见 [邮箱配置指南](email-setup.md)。
