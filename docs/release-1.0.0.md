# Docker Hub 发布记录：1.0.0

发布日期：2026-10-26（北京时间）。发布顺序：构建 → 完整测试及容器验收 → 推送 → 远端摘要核对。

这是 1.0.0 的历史发布记录。`latest` 已更新到 1.1.0，当前版本与摘要见 [1.1.0 验收记录](release-1.1.0.md)；下列两个标签一致的描述仅对应 1.0.0 发布时。

- 仓库：https://hub.docker.com/r/pushytao/codex-reset-watch
- 标签：`pushytao/codex-reset-watch:1.0.0`、`pushytao/codex-reset-watch:latest`
- 运行平台：`linux/amd64`
- 两个标签的远端摘要均与测试镜像一致：`sha256:45136bee915836e4c861f67aa7b6b5a2d5b24193594f8934aba39d08704ac24c`
- 运行镜像 manifest：`sha256:32ea69bc0da9b82e550034805734f68e7a2e85d048b8a4c9b97360f4534d687e`

镜像内 17 项测试全部通过，依赖审计 0 个已知漏洞。真实数据源成功同步 68 条记录。后台鉴权、CSRF、配置保密、SMTPS、STARTTLS、容器重建持久化、重复投递防护、明文 SMTP 拒绝及真实退避重试均通过。详细结果见 [验证记录](verification.md)。邮件验收使用隔离 SMTP 服务；真实邮箱收件需配置管理员自己的 SMTP 账号后确认。

已执行 `docker push` 发布两个标签，并分别使用 `docker buildx imagetools inspect` 从 Docker Hub 核对摘要。发布前没有改动已经通过测试的应用镜像。

拉取镜像：

```sh
docker pull pushytao/codex-reset-watch:1.0.0
```

当前仓库的 `compose.hub.yaml` 已更新为 1.1.0，不再部署此历史版本。新部署、服务器目录挂载、域名、HTTPS 和管理员密码配置见 [README](../README.md)；已有 1.0.0 部署见 [升级说明](notifications.md)。
