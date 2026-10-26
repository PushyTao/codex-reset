# Docker 环境验收

这套验收使用生产 Dockerfile 和应用进程，另起隔离 SMTP 容器。数据卷、邮件和证书只用于测试，不使用本地 `data/`，不向真实邮箱发信。

## 准备（当前 Windows 工作区）

```powershell
powershell -NoProfile -File tests/docker/create-cert.ps1
docker compose -p codex-reset-validation build
docker compose --env-file tests/docker/validation.env -p codex-reset-validation -f compose.yaml -f tests/docker/compose.override.yaml up -d --wait --wait-timeout 90
```

证书有效期两天，生成在被 Git / Docker 忽略的 `artifacts/docker-validation/certs/`。只通过验收容器的 `NODE_EXTRA_CA_CERTS` 信任，不更改操作系统信任库，也不关闭证书验证。SMTP 服务不映射宿主机端口，且不会转发收到的邮件。

## 顺序执行

```powershell
docker exec codex-reset-validation-reset-1 node /fixtures/scripts/probe.js initial
docker compose --env-file tests/docker/validation.env -p codex-reset-validation -f compose.yaml -f tests/docker/compose.override.yaml up -d --force-recreate --no-deps --wait --wait-timeout 90 reset
docker exec codex-reset-validation-reset-1 node /fixtures/scripts/probe.js restarted
docker exec codex-reset-validation-reset-1 node /fixtures/scripts/probe.js negative
docker exec codex-reset-validation-reset-1 node /fixtures/scripts/probe.js live
```

- `initial`：非 root、密钥权限、页面与 API、登录与 CSRF、设置保密、SMTPS 测试邮件、真实定时队列、重复公告拒绝。
- `restarted`：容器替换后的数据卷、凭据与密钥、旧会话失效、已发送邮件不重发、STARTTLS 认证与投递。
- `negative`：明文 SMTP 被拒绝，模拟 451 临时失败，等待真实的一分钟退避和下一次调度，验证只有一次成功投递。
- `live`：额外验证真实公开 API，同步成功必须返回非空记录；上游或当前网络超时会明确失败，不能视为应用功能通过的替代证据。

每轮使用全新验收数据卷。`negative` 需要约 90 秒，其余步骤通常数秒至一分钟。`initial` 会记录实时源状态，但不会把外部超时掩饰为成功。全部记录在生产应用自己的 SQLite 与测试 SMTP 收件箱中。

清理本次验收资源（仅项目名 `codex-reset-validation`）：

```powershell
docker compose --env-file tests/docker/validation.env -p codex-reset-validation -f compose.yaml -f tests/docker/compose.override.yaml down --volumes
```

不要把上述测试 SMTP、临时证书、虚构邮箱或虚构重置记录用于生产环境。
