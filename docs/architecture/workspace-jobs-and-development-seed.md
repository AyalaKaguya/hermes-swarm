# Workspace Jobs 与开发 Seed 基线

## Workspace-aware Jobs

所有工作空间任务必须使用 `WorkspaceJobEnvelope`，并显式携带：

- `workspaceId`：唯一工作空间执行边界；缺失时在访问 Redis 或数据库前失败。
- `name`：稳定任务名称。
- `idempotencyKey`：调用方提供的稳定投递键。
- `payload`：任务数据，不能依赖进程全局的“当前工作空间”。

`WorkspaceJobExecutor` 在执行 handler 前完成：

1. 使用 `jobs:workspace:{workspaceId}:{name}:...` Redis key 获取带 TTL 的所有权锁。
2. 检查同一 workspace/name/idempotencyKey 的完成标记。
3. 从受验证的 envelope 建立只含 `workspaceId` 与 scope 的 `WorkspaceContext`。
4. handler 对每个数据访问显式传入该 `workspaceId`；需要原子性的业务操作自行使用局部事务。
5. 成功后写入完成标记；失败只释放锁，允许重试。

平台任务不能在一个 handler 内遍历工作空间数据。`WorkspaceJobFanoutService` 只在受信任的平台编排路径查询 active Workspace，然后产生逐工作空间 envelope。首个 handler 是 `tickets.archive-expired`；它复用幂等的条件 UPDATE，不安装 `setInterval`、Cron 或进程内全表 timer。外部 scheduler 应为每个调度周期提供稳定 `runId`。

## Migration 后开发 Seed

空库执行顺序：

```powershell
pnpm nx run @hermes-swarm/api:migration:run
$env:DEV_SEED_ADMIN_PASSWORD='<至少 8 位>'
pnpm nx run @hermes-swarm/api:seed:development
```

Seed 使用唯一的 application datasource 幂等创建/更新：

- controller + navigation 权限目录；
- `platform-admin`、单一开发管理员及其权限；
- 主工作空间与实验工作空间。

随后使用显式 `workspaceId` 和必要的局部事务幂等创建/更新：

- workspace-owner / workspace-admin / workspace-member 系统角色及默认权限；
- 同一个全局管理员账号在主工作空间的 Owner Membership；
- 同一个全局管理员账号在实验工作空间的 Admin Membership。

密码没有开发默认值，必须通过 `DEV_SEED_ADMIN_PASSWORD` 明确提供。邮箱、显示名和 workspace slug 可使用 `DEV_SEED_ADMIN_*` 与 `DEV_SEED_WORKSPACE_*` 变量覆盖。旧的 `DEV_SEED_OWNER_*` 与 `DEV_SEED_PLATFORM_ADMIN_*` 不再兼容。生产环境默认拒绝运行；紧急显式执行还需要 `ALLOW_PRODUCTION_SEED=true`。
