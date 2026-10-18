# Office Gateway 迁移到 CC Switch 4.0 —— 实施计划

> 日期：2026-10-13
> 作者：Claude（基于 2026-10-13 深度代码阅读）
> 关联设计：本文同时承担 spec 角色（spec 与 plan 合一，因为功能已在 swifthu v3.20.4 跑过、迁移逻辑不需要再 brainstorm）
> 目标读者：迁移执行者

---

## 0. 目标与边界

### 0.1 背景

用户在 swifthu/cc-switch v3.20.4（`origin/main`）上有 office-gateway 功能（PR #5045），并在其上多打了 6 个 commit（`b153cb59` ~ `ee710770`），其中 4 个是代码改动（`gateway_token` 在 ProxyPanel 显示）。**farion1231/cc-switch v4.0.10** 是另一个 fork，已重写 UI/架构/聚合模式，但完全没有 office-gateway 概念。

用户希望"保留 office 路由的功能，merge 新版本到我这里来"——经核查这本质上是**在 farion 4.0 上从零重建 office-gateway**，不是 merge。

### 0.2 目标（必须做）

1. 在 farion 4.0 上重建 `OfficeGatewayService`，提供与 swifthu 3.20.4 等价的 4 个 HTTP 端点（`/v1/messages`、`/v1/models`、`/models`、`/healthz`）。
2. 提供等价的前端页面 `OfficeGatewayPage`、API 封装、Sidebar 入口、4 语种 i18n。
3. 把用户的 4 个代码 commit（`gateway_token` 显示）一并迁移到 4.0，**数据源语义保留**（即"proxy 面板显示 ClaudeDesktop 用的 gateway token"）。

### 0.3 边界（明确不做）

1. **不**复用 4.0 的 `ProxyServer`、`ProviderRouter`、`RequestForwarder`、`handlers::*` 任何东西——office-gateway 是个独立进程的 axum Router，与主代理无状态共享。
2. **不**改造 `claude_desktop_config.rs` 的 `gateway_token` 语义；用户的 1cecb043 在 swifthu 上是"proxy 状态顺带回 claude_desktop 的 token"，迁移后保持此语义（命令层装配，不污染 `ProxyStatus` 公开结构）。
3. **不**做 office-gateway 与 4.0 故障转移 / 熔断器 / PricingModelSource 的集成——本次只做 1:1 还原。
4. **不**新增 Cargo 依赖——axum 0.7 / tower-http 0.5 / reqwest 0.12 (rustls-tls) / async-stream / bytes / chrono / once_cell / regex / tokio 在 farion 4.0 的 `Cargo.toml` 已声明。
5. **不**删除 swifthu 3.20.4 上的任何代码；本计划在 farion 4.0 的新分支上执行。

### 0.4 仓库状态

- 本地仓库路径：`/Volumes/CC/Fork/ccswitch`
- swifthu origin：`origin/main` (commit `125e9760`)
- farion origin（已添加）：`farion/main` (commit `d9a62313`)，tag `v4.0.10`
- 迁移目标分支：**新建 `office-gateway-port-4.0`**（基于 `farion/main`）

---

## 1. 现状对比

### 1.1 仓库拓扑

| 项 | swifthu 3.20.4 | farion 4.0 |
|---|---|---|
| `merge-base` | `1ee2fdc3`（用户手册刷新） | 同 |
| 体积 | `lib.rs` 2466 行 | `lib.rs` 2435 行（**几乎全重写**） |
| 主代理端口 | 18790 | 15721（127.0.0.1） |
| 主代理栈 | axum only | hyper accept loop + axum Router |
| proxy 模块 | 6 文件 | 30+ 文件 |
| ProviderRouter | 简单列表 | 含熔断器/限流 |
| 辅助代理 | 无 | `/claude-desktop/v1/...`（独立 token） |
| 前端路由 | 受控视图（`App.tsx`） | 同（`App.tsx` 重写） |
| i18n | 5 语种 + 局部硬编码 | 4 语种（`en/zh/zh-TW/ja`，无 de.json） |
| office-gateway | ✅ 完整实现 | ❌ 完全不存在 |

### 1.2 swifthu 3.20.4 的 office-gateway 体量

| 文件 | 行数 | 角色 |
|---|---|---|
| `src-tauri/src/office_gateway.rs` | 2113 | 核心：service / config / logger / handlers / sanitize / SSE shim |
| `src-tauri/src/commands/office_gateway.rs` | 87 | 10 个 `#[tauri::command]` 薄包装 |
| `src-tauri/src/lib.rs` | +19 | 模块声明 + `app.manage` 初始化 + 10 行 invoke_handler |
| `src-tauri/src/commands/mod.rs` | +2 | `mod office_gateway; pub use office_gateway::*;` |
| `src/components/office-gateway/OfficeGatewayPage.tsx` | 693 | 完整 UI（hero / 4 个 ProviderSection / 日志卡） |
| `src/lib/api/officeGateway.ts` | 99 | 10 个 `invoke<T>` 封装 |
| `src/lib/api/index.ts` | +1 | `export { officeGatewayApi }` |
| `src/App.tsx` | +18 | import / View union / VALID_VIEWS / switch case / header / 工具栏按钮 |
| **合计** | **~3032 行** | |

### 1.3 用户 6 commit（4 个代码 + 2 文档）

| commit | 文件 | 改动 |
|---|---|---|
| `8f243119` | `src-tauri/src/proxy/types.rs` | `ProxyStatus` 加 `pub gateway_token: Option<String>` |
| `1cecb043` | `src-tauri/src/proxy/server.rs` | `get_status()` 在 running 时填 gateway_token（从 DB `claude_desktop_gateway_token` 读） |
| `34f240ee` | `src/types/proxy.ts` | 镜像加 `gateway_token?: string` |
| `ee710770` | `src/components/proxy/ProxyPanel.tsx` (+26) + 4 locale (+1) | running && token 存在时显示复制按钮 |
| `bc3e57cb` | `docs/superpowers/plans/2026-09-27-proxy-panel-api-key.md` | 实施计划（不迁移） |
| `b153cb59` | `docs/superpowers/specs/2026-09-27-proxy-panel-api-key-design.md` | 设计规范（不迁移） |

### 1.4 可重用性初判

**可几乎原样搬（5 大块，约 1700/2113 行）**：
- `OfficeGatewayService` 主体（start/stop/restart、graceful shutdown、ring buffer logger、redact）
- `sanitize_request`（白名单 / custom tool 折叠 / thinking 过滤 / probe 抬升）
- `resolve_route` 全部 + `resolve_deepseek/kimi/mimo/minimax`
- SSE shim 整套（`sse_shim_stream`、`process_sse_frame_lines`、`infer_synthetic_block`、`normalize_input_json_for_stream`）
- axum HTTP shell（Router 装配、CORS、4 MiB cap、graceful shutdown oneshot）

**需要适配（约 400/2113 行）**：
- `OfficeGatewayConfig::Default` 的 base URL——需要核对 4.0 时代这些 provider 的 base URL 是否有变（很可能没变，但 `cargo check` 之前先过一遍字符串）
- 初始化路径里的 `app_config_dir` 拿法——4.0 仍用 `app.path().app_config_dir()`，无需改
- 单元测试要保留 11 条 `#[test]`，可能需要更新 `cargo test` 的运行路径

**新增（约 50 行）**：
- 4 语种 i18n key（en/zh/zh-TW/ja），全部从 3.20.4 OfficeGatewayPage 硬编码中文翻译抽取

---

## 2. 核心架构决策

### 2.1 office-gateway 不进 `proxy/` 模块

**理由**：
1. office-gateway 与主代理**无状态共享**（独立 config.json / 独立 ring buffer / 独立端口 / 独立鉴权）
2. office-gateway 的鉴权不查熔断器、不走 `RequestContext`、不走 `ProviderRouter`、不记 usage（无 `usage_cache` 写入）
3. 4.0 已有"独立辅助代理"参照：`/claude-desktop/v1/...`（`claude_desktop_config.rs`），它也是单文件 service + commands 子模块，**与 office-gateway 同质**。照搬这个模式最安全。

**结论**：建独立模块 `src-tauri/src/office_gateway.rs`，不放在 `proxy/` 也不放在 `claude_desktop_config.rs` 旁边（语义不同）。

### 2.2 端口

- swifthu 3.20.4：`0.0.0.0:8790`（默认监听所有接口）
- farion 4.0：主代理 `127.0.0.1:15721`，ClaudeDesktop 另开端口
- **决策**：office-gateway 默认 `127.0.0.1:8790`（不监听公网），与 ClaudeDesktop 一致；用户可配。Office 客户端工具连本机，不需要公网。

### 2.3 gateway_token 数据源

swifthu 3.20.4 用户 commit `1cecb043` 语义：
> "proxy 面板显示 ClaudeDesktop 用的 gateway token"

这语义在 4.0 仍然有效（`claude_desktop_config.rs::get_or_create_gateway_token` 4.0 存在）。**保留此语义**，不另起 `office_gateway_token`。

**注意**：office-gateway 自己的 HTTP 端点鉴权**不**用这个 token（office-gateway 完全开放或按 provider API key 鉴权，见 2.4）。

### 2.4 office-gateway 自身鉴权

参考 swifthu 3.20.4 实现：office-gateway 接受 `Authorization: Bearer`、`x-api-key`、`api-key` 头，但**不强制校验**——它用请求头里的 key 转发到上游（"配置留空就用请求头"）。这个策略原样保留，不引入额外的"office-gateway 自身 token"。

### 2.5 启动 / 停止

- 启动：`OfficeGatewayService::start()` 独立 `tokio::net::TcpListener::bind` + axum serve，与主代理、ClaudeDesktop 完全解耦
- 停止：oneshot 触发 graceful shutdown，2s 超时则 abort（与 3.20.4 一致）
- 不在主代理 `start_proxy_server` 里联动（不需要）

---

## 3. 文件改动清单

### 3.1 新建文件（7 个）

| 路径 | 行数估算 | 角色 |
|---|---|---|
| `src-tauri/src/office_gateway.rs` | ~2150 | 核心 service（从 swifthu 3.20.4 搬） |
| `src-tauri/src/commands/office_gateway.rs` | ~90 | 10 个 tauri command（从 swifthu 3.20.4 搬） |
| `src/components/office-gateway/OfficeGatewayPage.tsx` | ~750 | UI（搬 + 替换硬编码中文为 `t()`） |
| `src/components/office-gateway/index.ts` | ~5 | barrel export |
| `src/lib/api/officeGateway.ts` | ~110 | API 封装（搬 + 字段名映射） |
| `src/types/officeGateway.ts` | ~60 | TS 类型（从 swifthu 搬） |
| **合计** | **~3165** | |

### 3.2 修改文件（12 个）

| 路径 | 改动 |
|---|---|
| `src-tauri/src/lib.rs` | +`mod office_gateway;`（line 29 附近）+ `commands::mod` 块声明 + app.manage 初始化 + `tauri::generate_handler!` 加 10 行（line 1428 附近） |
| `src-tauri/src/commands/mod.rs` | +`mod office_gateway; pub use office_gateway::*;` |
| `src/components/proxy/ProxyPanel.tsx` | 4.0 版本的 ProxyPanel.tsx 已经有"显示 API Key"区域（前面 grep 看到 `claude_desktop_config` 提到 `gateway_token_configured`）。**先验证**：是否已经原生支持显示；如未原生支持，再加用户的 26 行 + 改用 `copyText`（不沿用 `navigator.clipboard.writeText`） |
| `src-tauri/src/proxy/server.rs`（4.0 版） | `get_status()` 末尾注入 gateway_token（参考 swifthu 1cecb043）。**重要**：先 grep 4.0 `commands/proxy.rs::get_proxy_status` 实现位置——若 4.0 已把状态装配放在 commands 层，server.rs 可能不用改，改 commands/proxy.rs |
| `src-tauri/src/proxy/types.rs`（4.0 版） | `ProxyStatus` 加 `pub gateway_token: Option<String>` |
| `src/types/proxy.ts`（4.0 版） | 镜像加 `gateway_token?: string` |
| `src/lib/api/index.ts` | +`export { officeGatewayApi } from "./officeGateway";` |
| `src/lib/navigation.ts` | 加 `"office" as GlobalPage` + `GLOBAL_PAGES` 数组追加 |
| `src/components/shell/Sidebar.tsx`（4.0 版） | `ITEMS` 数组加 `{ page: "office", label: t("nav.office"), icon: Network }` |
| `src/App.tsx`（4.0 版） | 找 `renderGlobalPage()` switch 加 `case "office": return <OfficeGatewayPage />`；header 标题 + 工具栏按钮（按 swifthu 3.20.4 风格） |
| `src/i18n/locales/{en,zh,zh-TW,ja}.json` | 增 `office.*`（约 30-40 个 key）+ `nav.office` + `proxy.panel.apiKey`（已存在则跳过） |
| `src/components/proxy/ProxyPanel.tsx` 配套 | 用 `copyText` 替代 `navigator.clipboard.writeText` |

### 3.3 不改文件

- `src-tauri/Cargo.toml`——所有依赖已声明
- `src-tauri/capabilities/default.json`——`open_path` opener 权限已覆盖
- 主代理、ProviderRouter、handlers、forwarder——零接触
- 4.0 任何 DB schema——不动

---

## 4. 数据流迁移

### 4.1 office-gateway 启动

```
Tauri app.setup
  → app.path().app_config_dir()  (4.0 同样 API)
  → OfficeGatewayService::new(app_config_dir)
    ├─ 读 <app_config_dir>/office-gateway/config.json（不存在用 Default）
    ├─ 初始化 logger（创建目录）
    └─ 构造 OfficeGatewayService
  → app.manage(OfficeGatewayState(Arc::new(...)))
```

### 4.2 启动 HTTP server（响应 `start_office_gateway` command）

```
TcpListener::bind(127.0.0.1:8790)  // 4.0 改默认
  → Router::new()
    .route("/healthz", get(healthz))
    .route("/v1/models", get(models))
    .route("/models", get(models))
    .route("/v1/messages", post(messages).options(messages))
    .fallback(fallback)
    .layer(CorsLayer::permissive())
  → axum::serve(listener, router).with_graceful_shutdown(oneshot::rx)
  → tokio::spawn(server_task)
  → 记录 shutdown_oneshot / server_task / bound_addr / started_at
```

### 4.3 请求生命周期（与 swifthu 一致）

```
POST /v1/messages (Authorization/x-api-key, anthropic-version, body)
  → messages() axum handler
    ├─ 4 MiB body cap + BOM strip + JSON 解析
    ├─ resolve_route(config, headers)  →  Route
    │   ├─ active_provider == Auto → classify_auto_provider(key 前缀)
    │   └─ resolve_{deepseek|kimi|mimo|minimax}
    ├─ sanitize_request(body, config, provider, image_support)
    │   ├─ 字段白名单 + DeepSeek 去 thinking
    │   ├─ 规范化 messages.content 块
    │   ├─ custom tool 折叠为裸 {name, description, input_schema}
    │   ├─ tool_choice "custom" → "tool"
    │   └─ probe 抬升 max_tokens
    ├─ route_model(model, provider, route_kind) 重写
    ├─ reqwest POST upstream_url
    │   bearer_auth(api_key) + x-api-key + anthropic-version
    └─ stream ? sse_shim_stream(bytes_stream) : text() → 透传
```

### 4.4 关键适配点

- 4.0 的 `axum` 版本若升级到 0.8，需要重写 `sse_shim_stream` 签名（`async_stream::try_stream!` 用法不变，类型边界变）
- 4.0 `reqwest::Client::builder().timeout()` API 一致，无需改
- 4.0 `tokio` 仍 v1，oneshot / Mutex / RwLock 用法一致

---

## 5. 数据存储方案

### 5.1 文件系统

| 路径 | 内容 | 写入方 |
|---|---|---|
| `<app_config_dir>/office-gateway/config.json` | `OfficeGatewayConfig` 序列化 | `save_office_gateway_config` |
| `<app_config_dir>/office-gateway/office-gateway.log` | 滚动日志（不限大小、按 ring buffer 截断） | `OfficeGatewayLogger` 每次事件 |

`<app_config_dir>` 在 4.0 仍由 Tauri 提供，**路径可能与 3.20.4 不同**（取决于 4.0 的产品名/identifier）。首次启动时若 config.json 不存在，用 `Default::default()`，**不会**主动迁移 swifthu 配置（本次不做跨版本配置迁移；用户可手动复制）。

### 5.2 DB（仅 gateway_token 一项）

`Database` 的 `settings` 表用 key `claude_desktop_gateway_token`（与 4.0 `claude_desktop_config.rs` 一致），`get_or_create_gateway_token(db)` 自动生成 UUID v4 并落库。

**用户的 1cecb043 迁移路径**：
- 4.0 的 `ProxyServer::get_status()` 与 swifthu 不一定 1:1
- 4.0 的 `get_proxy_status` command 在 `commands/proxy.rs`，且 4.0 已经有"代理状态附 gateway_token"的同类实现（前面 grep 看到 `gateway_token_configured: bool`）
- **建议执行路径**：先 git grep 4.0 的 `gateway_token` / `get_or_create_gateway_token` 调用点，把"proxy 状态顺带回 token"放在 4.0 已有的实现里（保持原有数据结构与权限边界），不要平行实现一份
- 4.0 的 `ProxyStatus` 公开结构**没有** `gateway_token` 字段（agent 2 已确认），所以注入 token 的代码要放在命令层（`commands/proxy.rs::get_proxy_status`），不污染公开类型

### 5.3 不存 DB 的内容

- office-gateway 的 4 个 Provider 全部 API Key / Base URL / 模型名 → JSON 文件
- ring buffer 日志 → 文件 + 内存
- 任何运行时状态（active_provider、started_at）→ 内存

---

## 6. 前端 i18n 改造

### 6.1 抽取策略

从 swifthu 3.20.4 `OfficeGatewayPage.tsx` 硬编码中文抽取 key，命名规范沿用 4.0 风格：`office.<section>.<key>`。

### 6.2 Key 清单（预估 30-40 个）

```
office.title
office.subtitle
office.status.running / .stopped
office.start / .stop / .restart / .save / .test
office.copyBaseUrl / .copied
office.fields.activeProvider / .baseUrl / .defaultMaxTokens / .probeMinTokens / .listenPort
office.testResult.success / .failed / .preview
office.provider.deepseek / .kimi / .mimo / .minimax
office.provider.apiKey / .baseUrl / .baseUrlPrimary / .baseUrlCoding / .baseUrlCn / .baseUrlGlobal / .baseUrlCn / .baseUrlSgp / .baseUrlAms
office.provider.modelPrimary / .modelMid / .modelFast / .modelCoding
office.logs.title / .path / .copy / .clear / .open
office.help.provider
office.empty
```

### 6.3 4 语种翻译

中文（zh）：直接采用 swifthu 3.20.4 的硬编码字符串
繁体（zh-TW）：直译，保留术语
英文（en）：参考 swifthu en.json 的 proxy 相关 key 风格
日文（ja）：参考 swifthu ja.json 风格

**没把握的 key**：`t("office.xxx", { defaultValue: "中文" })` 加 fallback 兜底（沿用 swifthu 用户的 1cecb043 风格）

### 6.4 nav.office

`Sidebar.tsx` 需要在 `nav` 命名空间下加 `office: "Office Gateway"`。4 语种都加。

---

## 7. gateway_token 显示功能迁移（用户的 4 commit）

### 7.1 4.0 是否已原生支持

Agent 2 grep 发现：
- `claude_desktop_config.rs::get_or_create_gateway_token` 4.0 存在
- `claude_desktop_config.rs::gateway_token_configured: bool` 4.0 存在
- 4.0 `ProxyStatus` **没有** `gateway_token` 字段

**结论**：4.0 已有 gateway token 的**生成与存储**逻辑，但**没有**把它"顺带"回给 `ProxyStatus` 的机制。用户的 1cecb043 是补这个能力。

### 7.2 迁移实现

**4.0 实际改动点**（按优先顺序）：

1. **先 git grep** `gateway_token_configured` / `get_or_create_gateway_token` 4.0 仓库，确认它们在 `commands/proxy.rs::get_proxy_status` 的哪一段被调用
2. 若 `get_proxy_status` 已经返回 ClaudeDesktopStatus（含 token），直接在 `ProxyPanel.tsx` 读 `claudeDesktopStatus.gateway_token` 即可——**无需改 Rust 端**
3. 若没有，则在 `get_proxy_status` command 末尾（参考 swifthu 1cecb043）加：
   ```rust
   if status.running {
       status.gateway_token = Some(
           crate::claude_desktop_config::get_or_create_gateway_token(&state.db)
               .unwrap_or_default()
       );
   }
   ```
4. `proxy/types.rs` `ProxyStatus` 加 `pub gateway_token: Option<String>`（与 swifthu 完全一致）
5. `types/proxy.ts` 镜像加 `gateway_token?: string`
6. `ProxyPanel.tsx` 加显示块（与 swifthu 一致，但用 `copyText` 而非 `navigator.clipboard.writeText`）

### 7.3 不要复制 swifthu 的两个不优雅

1. `navigator.clipboard.writeText` → 换成 `copyText` from `@/lib/clipboard`
2. `unwrap_or_default()` 容忍 DB 错误 → 保留（与 3.20.4 一致，避免 status 查询失败）

---

## 8. 分阶段实施计划

每阶段有独立验收点。**严格按阶段推进**，前一阶段通过测试再做下一阶段。

### 阶段 1：环境与脚手架（0.5 天）

**任务**：
1. 切到新分支 `office-gateway-port-4.0`（基于 `farion/main`）
   ```bash
   git fetch farion
   git checkout -b office-gateway-port-4.0 farion/main
   ```
2. 验证 `pnpm tauri dev` / `cargo check` 4.0 干净
3. 验证 `pnpm test:unit` 4.0 干净
4. 添加空文件骨架：
   - `src-tauri/src/office_gateway.rs`（仅 `pub struct OfficeGatewayService;`）
   - `src-tauri/src/commands/office_gateway.rs`（仅 `pub struct OfficeGatewayState;`）
   - `src/components/office-gateway/OfficeGatewayPage.tsx`（空组件 return null）
   - `src/lib/api/officeGateway.ts`（空 export）
5. 注册最小链路：4 个文件 + `lib.rs` + `commands/mod.rs` + `App.tsx` 加一个空入口
6. `cargo check` + `pnpm tsc --noEmit` 通过

**验收**：
- `cargo check` 无错
- `pnpm tsc --noEmit` 无错
- `pnpm tauri dev` 启动，Sidebar 出现 "Office"（即使点击是空白页）

---

### 阶段 2：核心 Rust 移植（2-3 天）

**任务**：
1. 把 swifthu 3.20.4 `office_gateway.rs` 全文复制到 4.0 同名文件
2. 解决 4.0 编译错误（仅 API 改名 / 模块路径调整，不改业务逻辑）
3. 保留 11 条 `#[test]`，**全过**
4. 验证 `cargo check` + `cargo test office_gateway::*` 通过
5. `pnpm tauri dev`，手动验证：`start / stop / restart / save config / test upstream` 5 个 command 调用无 panic

**关键风险**：
- 4.0 内部类型改名（`AppState`、Database path 等）—— 只动引用，不动业务
- axum 0.7 vs 0.8 差异（如有升级，参考 4.0 现有 handler 写法）
- 单元测试中的 mock 路径可能变（如果用了 `tempfile` / `mockito`）

**验收**：
- 11 条单元测试全过
- 命令 5 个能正常 call（手动 `pnpm tauri dev` 验证）

---

### 阶段 3：命令注册与初始化（0.5 天）

**任务**：
1. `lib.rs` 加 `mod office_gateway;`
2. `commands/mod.rs` 加 `mod office_gateway; pub use office_gateway::*;`
3. `lib.rs` 加 `app.manage(commands::OfficeGatewayState(...))`（在现有 app.manage 块附近）
4. `lib.rs` 的 `tauri::generate_handler!` 加 10 个命令（按字母序）
5. `cargo check` 通过
6. `pnpm tauri dev`，手动验证：UI 按钮点击触发命令，控制台有 `✓ Office Gateway service initialized`

**验收**：
- 启动日志含 office-gateway 初始化成功
- 10 个命令在 Tauri 协议里可被 invoke

---

### 阶段 4：前端 API 封装 + 类型（0.5 天）

**任务**：
1. `src/lib/api/officeGateway.ts` 搬 10 个 invoke 封装
2. `src/types/officeGateway.ts` 搬 5 个类型 export
3. `src/lib/api/index.ts` 加 `export { officeGatewayApi }`
4. `pnpm tsc --noEmit` 通过

**验收**：
- 10 个函数在 `window` 调试里能调到对应命令（返回正确结构）

---

### 阶段 5：i18n 4 语种注入（0.5 天）

**任务**：
1. 在 4 份 `locales/*.json` 加 `office.*` 全部 key（约 30-40 个）+ `nav.office` + `proxy.panel.apiKey`
2. `pnpm i18n:check`（如有）或 `pnpm tsc --noEmit` 通过
3. 启动 dev，切换 4 语种，UI 文本全部正常显示（无 key 漏出）

**验收**：
- 4 语种切换无 key 字面值
- 关键文本（"启动"、"停止"、"保存"、"Provider 配置"）翻译合理

---

### 阶段 6：UI 移植（OfficeGatewayPage）（1-1.5 天）

**任务**：
1. 搬 swifthu 3.20.4 `OfficeGatewayPage.tsx` 到 4.0
2. 把硬编码中文替换为 `t("office.xxx", { defaultValue: "原中文" })`
3. 保留 4 个 `ProviderSection`、Field、logEndRef 逻辑
4. 用 `copyText` 替代 `navigator.clipboard.writeText`（如有）
5. `pnpm tsc --noEmit` 通过
6. `pnpm tauri dev`，手动验证：
   - 加载默认 config
   - 切换 activeProvider，UI 切换对应 ProviderSection
   - 输入 API Key，保存，文件落盘
   - 启动 service，UI 显示 running
   - 测试上游，UI 显示结果
   - 日志实时刷新

**验收**：
- 完整 UI 流程跑通
- 4 语种切换无问题
- config.json 文件正确落盘

---

### 阶段 7：Sidebar + App.tsx 入口（0.25 天）

**任务**：
1. `src/lib/navigation.ts` 加 `"office" as GlobalPage` + `GLOBAL_PAGES` 数组追加
2. `src/components/shell/Sidebar.tsx` 的 `ITEMS` 数组加 `{ page: "office", label: t("nav.office"), icon: Network }`
3. `src/App.tsx` 加：
   - import `OfficeGatewayPage`
   - `renderGlobalPage()` switch 加 `case "office": return <OfficeGatewayPage />`
   - header 标题（参考 swifthu 1382 行）
   - 工具栏按钮（参考 swifthu 1355 行）
4. `pnpm tsc --noEmit` 通过
5. 启动验证：Sidebar 显示 Office Gateway 入口，点击进入页面

**验收**：
- Sidebar 入口在 4 语种下都显示正常
- 进入页面能正常显示完整 UI

---

### 阶段 8：gateway_token 显示功能（0.5 天）

**任务**：
1. 先 `git grep gateway_token_configured` 4.0 仓库，确认现有调用点
2. 若 `get_proxy_status` 已含 token：直接读，跳到步骤 5
3. 若没有：4.0 `proxy/types.rs` `ProxyStatus` 加 `pub gateway_token: Option<String>`
4. `commands/proxy.rs::get_proxy_status` 末尾加注入逻辑（参考 swifthu 1cecb043）
5. `types/proxy.ts` 镜像加 `gateway_token?: string`
6. `ProxyPanel.tsx` 加显示块（用 `copyText` 替代 `navigator.clipboard.writeText`）
7. 4 语种加 `proxy.panel.apiKey`（如未存在）
8. `pnpm tsc --noEmit` + `cargo check` 通过
9. 启动验证：proxy 启动后，Panel 出现 "API Key" 块

**验收**：
- proxy 启动时，UI 出现可复制的 API Key
- proxy 停止时，API Key 块消失

---

### 阶段 9：联调 + 回归测试（1 天）

**任务**：
1. `cargo test` 全过（含 11 条 office-gateway 单元测试 + 4.0 原有测试）
2. `pnpm test:unit` 全过
3. `pnpm tauri dev` 完整功能验证：
   - office-gateway start / stop / restart
   - 4 个 Provider 切换 + API key 配置 + 保存
   - 测试上游（4 个 provider 都能连通时返回 ok）
   - 日志显示（error / warn / info 颜色正确）
   - gateway_token 显示
   - 4 语种切换
4. 端到端场景：
   - 启动 office-gateway → 用 curl 调 `POST /v1/messages` → 验证转发到 DeepSeek
   - 启动 office-gateway → 启动主代理 → 两个端口独立工作

**验收**：
- 全测试套件通过
- 端到端场景全部成功

---

### 阶段 10：文档与清理（0.25 天）

**任务**：
1. 更新 `docs/superpowers/specs/` 下的设计文档（新建 `2026-10-13-office-gateway-migration-to-4.0-design.md`，把本文档内容精简为 spec 风格）
2. 写 4 语种用户文档（在 `docs/user-manual/{en,zh,zh-TW,ja}/` 下加章节）
3. 删除调试代码（如有）
4. `git add . && git commit -m "feat(office-gateway): port to v4.0"` 等待 review

**验收**：
- 设计文档和用户文档齐备
- 1 个 commit（或拆 2-3 个按阶段）

---

## 9. 风险与回退

### 9.1 风险点

| 风险 | 等级 | 缓解 |
|---|---|---|
| 4.0 axum 已升级到 0.8（破坏性） | 中 | 先 `grep 'axum = ' Cargo.toml` 确认；若是 0.8，参考 4.0 现有 handler 写法调整 `sse_shim_stream` |
| 4.0 `claude_desktop_config::get_or_create_gateway_token` 签名变了 | 中 | 阶段 8 显式 git grep 确认；按 4.0 现有调用点模式写 |
| 4.0 `commands/proxy.rs` `get_proxy_status` 已存在部分逻辑导致冲突 | 中 | 阶段 8 优先 git grep；如有重复，**复用 4.0 现有**，不平行实现 |
| 4.0 `Sidebar.tsx` 结构 / 名称变了 | 低 | 阶段 7 用 `git grep Sidebar` 找最新位置；参考 4.0 已有 GlobalPage 入口加新行 |
| 4.0 i18n 文件结构变了（拆 / 合） | 低 | 阶段 5 跑 `pnpm i18n:check` 验证 key 存在性 |
| 4.0 Tauri plugin 升级影响 `open_path` opener 调用 | 低 | 阶段 6 启动 dev 手动验证"打开日志"按钮 |
| 用户的 proxy/server.rs 改动在 4.0 不能直接搬 | 高 | 阶段 8 显式 grep 决策（见 7.2） |

### 9.2 回退策略

- 每阶段一个 commit，**回退到上一阶段 commit 即回退到上一阶段状态**
- 不删 swifthu 3.20.4 的本地 main，需要时可切回
- 阶段 1-3 任一失败：放弃，回退到 swifthu 继续用 3.20.4
- 阶段 4+ 任一失败：保留阶段 1-3 的成果，**office-gateway 处于"有 service 无 UI"状态**；可作为后续 PR 慢慢补

---

## 10. 验证清单

执行前逐项打勾。

### 10.1 代码完成度

- [ ] `src-tauri/src/office_gateway.rs` 全文到位（~2150 行）
- [ ] `src-tauri/src/commands/office_gateway.rs` 10 个 tauri command 到位
- [ ] `src/components/office-gateway/OfficeGatewayPage.tsx` UI 完整
- [ ] `src/lib/api/officeGateway.ts` 10 个 API 封装到位
- [ ] `src/types/officeGateway.ts` 5 个类型到位
- [ ] `src/lib/api/index.ts` export 到位
- [ ] `src-tauri/src/lib.rs` 4 处修改到位（mod 声明 / manage / generate_handler）
- [ ] `src-tauri/src/commands/mod.rs` mod 声明到位
- [ ] `src/lib/navigation.ts` 入口到位
- [ ] `src/components/shell/Sidebar.tsx` ITEMS 数组加新行
- [ ] `src/App.tsx` 入口 case 到位
- [ ] 4 份 locale JSON 加 key 到位
- [ ] `ProxyPanel.tsx` API Key 显示块到位
- [ ] `proxy/types.rs` `ProxyStatus.gateway_token` 字段到位
- [ ] `types/proxy.ts` 镜像字段到位

### 10.2 测试

- [ ] `cargo test` 全过（含 11 条 office-gateway 单元测试）
- [ ] `pnpm test:unit` 全过
- [ ] `pnpm tsc --noEmit` 全过
- [ ] `cargo check` 无 warning（除过时依赖）
- [ ] `pnpm tauri dev` 启动无 panic

### 10.3 端到端场景

- [ ] 启动 office-gateway，curl `POST /v1/messages` 成功转发
- [ ] 4 个 provider（DeepSeek/Kimi/MiMo/MiniMax）配置 + 保存 + 重启后保留
- [ ] 测试上游按钮 4 个 provider 都能连通
- [ ] 日志 ring buffer 600 上限正常
- [ ] 日志 redact secrets 正常（不输出明文 API key）
- [ ] 主代理 + office-gateway 同时运行无冲突
- [ ] proxy 启动后 Panel 显示可复制 API Key
- [ ] 4 语种切换 UI 文本无 key 字面值
- [ ] Sidebar 入口在 4 语种都显示

### 10.4 文档

- [ ] `docs/superpowers/specs/2026-10-13-office-gateway-migration-to-4.0-design.md` 到位
- [ ] 4 语种 user-manual 各加一节
- [ ] 阶段 1-10 commit 干净

---

## 11. 总工作量估算

| 阶段 | 估计 |
|---|---|
| 1. 脚手架 | 0.5 天 |
| 2. 核心 Rust 移植 | 2-3 天 |
| 3. 命令注册 | 0.5 天 |
| 4. 前端 API 封装 | 0.5 天 |
| 5. i18n 注入 | 0.5 天 |
| 6. UI 移植 | 1-1.5 天 |
| 7. Sidebar 入口 | 0.25 天 |
| 8. gateway_token 显示 | 0.5 天 |
| 9. 联调 + 回归 | 1 天 |
| 10. 文档 | 0.25 天 |
| **合计** | **7-9 天全职** |

---

## 12. 开放问题（执行前需回答）

**Q1：4.0 仓库的 axum 版本是 0.7 还是 0.8？**
✅ **答：axum 0.7 + tower-http 0.5 (cors)**（已 git show 验证）。与 swifthu 3.20.4 完全一致，**SSE shim 不用改**。

**Q2：4.0 `get_proxy_status` 是否已经返回 ClaudeDesktopStatus（含 token）？**
✅ **答：没有。** 4.0 实现极简：
```rust
pub async fn get_proxy_status(state) -> Result<ProxyStatus, String> {
    state.proxy_service.get_status().await
}
```
不引用 `gateway_token`，4.0 `ProxyStatus` 公开结构也没有 `gateway_token` 字段。**阶段 8 必须在 `proxy_service.get_status()` 内部加注入**（与 swifthu 1cecb043 改的位置一致：`src-tauri/src/proxy/server.rs` 的 `ProxyServer::get_status()` 末尾）。

**Q3：4.0 `Sidebar.tsx` 名字与 API 是否变了？**
✅ **答：是。** 4.0 路径是 `src/components/shell/Sidebar.tsx`（3.20.4 是 `src/components/Sidebar.tsx`），icons 改用 `lucide-react`（3.20.4 用什么待查，但 lucide 提供 `Network` icon 可用）。**阶段 7 适配这两点。**

**Q4：是否自动迁移 swifthu 3.20.4 上的 office-gateway 真实环境配置（API key 等）？**
✅ **答：不迁，用户手动重填。** 4.0 启动时 config.json 不存在就用 `Default::default()`，用户首次进入 Office Gateway 页面手动填 API key。**阶段 1-6 不做配置迁移。**

**Q5：office-gateway panic 是否要保证不影响主代理？**
✅ **答：保持默认。** office-gateway 启动失败/panic 不传播到主代理和 Claude Desktop（4.0 各 service 独立 panic 边界，与 3.20.4 一致）。**阶段 2 不加额外的 Tokio 监视层。**

### 12.1 阶段 1 调整（基于 Q1-Q5 答案）

阶段 1 的"顺手验证 Q1-Q3"已在上文完成（git show farion/main:...）。阶段 1 实际工作收敛为：
1. 切到 `office-gateway-port-4.0` 分支
2. 4 个空文件骨架
3. 最小注册链路
4. 验证 cargo check + tsc 通过
5. **新增**：用 lucide-react 找 `Network` icon 作为 office-gateway Sidebar 入口 icon（提前在 lucide 库中确认存在性）

---

## 13. 参考资料

- 内部：`.omc/oh-my-claudecode.md`（CLAUDE.md）—— 项目规则与 skill 索引
- 内部：`docs/superpowers/plans/2026-09-27-proxy-panel-api-key.md` —— 用户最近一次的设计/实施分离模式
- swifthu commit：`94991557` `feat: add Office Claude gateway` (PR #5045)
- swifthu commit：`1cecb043` `feat(proxy): populate gateway_token in get_status() when running`
- farion tag：`v4.0.10`
- farion 参照实现：`src-tauri/src/claude_desktop_config.rs`（独立 service + Bearer token 模式）
