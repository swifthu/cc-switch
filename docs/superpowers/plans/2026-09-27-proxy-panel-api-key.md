# Proxy Panel API Key Display — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在路由面板的服务地址下方，路由开启时显示 Claude Desktop gateway Bearer token（`ccs-xxx` 格式）只读文本框和复制按钮。

**Architecture:** 通过在 `ProxyStatus` 中新增 `gateway_token: Option<String>` 字段，把数据库中已有的 token 注入到前端。路由关闭时字段为空，前端不渲染；路由开启时返回 token，前端条件显示。

**Tech Stack:** Rust (axum/Tauri) + TypeScript (React) + i18n

---

## Global Constraints

- Token 格式：`ccs-{uuid}`，由 `get_or_create_gateway_token()` 生成，存在 `settings` 表 `claude_desktop_gateway_token` key 下
- API Key 文本框必须 `readOnly`，不可编辑
- 只在 `status.running == true && gateway_token != None` 时渲染
- 样式须与服务地址行完全一致（padding、border、font）

---

## Task 1: Rust — ProxyStatus 新增 gateway_token 字段

**Files:**
- Modify: `src-tauri/src/proxy/types.rs`

**Interfaces:**
- Produces: `ProxyStatus.gateway_token: Option<String>`

- [ ] **Step 1: Read types.rs 确认 ProxyStatus 结构体位置**

Run: `grep -n "pub struct ProxyStatus" src-tauri/src/proxy/types.rs`
预期：找到结构体定义行号

- [ ] **Step 2: 在 ProxyStatus 结构体末尾添加 gateway_token 字段**

在 `active_targets: Vec<ActiveTarget>` 字段后添加：

```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_token: Option<String>,
```

- [ ] **Step 3: cargo check 验证编译**

Run: `CARGO_TARGET_DIR=/Users/jimmyhu/ccswitch-target cargo check --message-format=short 2>&1 | grep -E "error|ProxyStatus" | head -20`
预期：无 error，`ProxyStatus` 相关编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/proxy/types.rs
git commit -m "feat(proxy): add gateway_token field to ProxyStatus

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: Rust — server.rs 在 get_status() 中填充 gateway_token

**Files:**
- Modify: `src-tauri/src/proxy/server.rs`

**Interfaces:**
- Consumes: `ProxyStatus.gateway_token`（Task 1 产出）
- Calls: `crate::claude_desktop_config::get_or_create_gateway_token(self.db.as_ref())`

- [ ] **Step 1: Read get_status() 函数，确认结构**

Run: `grep -n "pub async fn get_status" src-tauri/src/proxy/server.rs`
预期：找到函数定义，查看其返回类型和当前实现

- [ ] **Step 2: 在 get_status() 函数中，状态为 running 时填充 gateway_token**

在 `let mut status = ...` 后、`return Ok(status)` 前插入：

```rust
    if status.running {
        status.gateway_token = Some(
            crate::claude_desktop_config::get_or_create_gateway_token(self.db.as_ref())
                .unwrap_or_default()
        );
    }
```

- [ ] **Step 3: cargo check 验证编译**

Run: `CARGO_TARGET_DIR=/Users/jimmyhu/ccswitch-target cargo check --message-format=short 2>&1 | grep -E "^error" | head -10`
预期：无 error

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/proxy/server.rs
git commit -m "feat(proxy): populate gateway_token in get_status() when running

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: TypeScript — ProxyStatus 类型新增 gateway_token

**Files:**
- Modify: `src/types/proxy.ts`

**Interfaces:**
- Produces: TypeScript `ProxyStatus.gateway_token?: string`

- [ ] **Step 1: Read proxy.ts 确认 TypeScript ProxyStatus 结构**

Run: `grep -n "interface ProxyStatus" src/types/proxy.ts`
预期：找到行号

- [ ] **Step 2: 在 TypeScript ProxyStatus 接口末尾添加 gateway_token 字段**

在 `active_targets?: ActiveTarget[]` 后添加：

```ts
  gateway_token?: string;
```

- [ ] **Step 3: pnpm typecheck 验证**

Run: `pnpm typecheck 2>&1 | tail -10`
预期：退出码 0，无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/types/proxy.ts
git commit -m "feat(types): add gateway_token to TypeScript ProxyStatus

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: 前端 — ProxyPanel.tsx 新增 API Key 显示

**Files:**
- Modify: `src/components/proxy/ProxyPanel.tsx`
- Modify: `src/locales/en.json`, `src/locales/zh.json`, `src/locales/ja.json`, `src/locales/de.json`

**Interfaces:**
- Consumes: `status.gateway_token`（Task 3 产出）
- i18n key: `proxy.panel.apiKey`

- [ ] **Step 1: Read ProxyPanel.tsx 确认服务地址区块结构**

Run: `grep -n "服务地址\|serviceAddress\|formatAddressForUrl\|status.address" src/components/proxy/ProxyPanel.tsx | head -10`
预期：找到服务地址渲染位置的行号

- [ ] **Step 2: 在服务地址区块后、条件渲染外层 div 内，新增 API Key 区块**

在服务地址 `</div>` 后、`{/* [5] ...}` 前插入：

```tsx
{/* [4b] API Key — only shown when running */}
{status.running && status.gateway_token && (
  <div>
    <p className="text-xs text-muted-foreground mb-2">
      {t("proxy.panel.apiKey", { defaultValue: "API Key" })}
    </p>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        readOnly
        className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border/60 font-mono"
        value={status.gateway_token}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard.writeText(status.gateway_token!);
          toast.success(t("common.copied"));
        }}
      >
        {t("common.copy")}
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 3: 确认已导入 toast（已在第 18 行从 `sonner` 导入，无需添加）**

Run: `grep -n "toast" src/components/proxy/ProxyPanel.tsx | head -3`
预期：`import { toast } from "sonner";` 已存在

- [ ] **Step 4: pnpm typecheck 验证**

Run: `pnpm typecheck 2>&1 | tail -10`
预期：退出码 0

- [ ] **Step 5: 添加 i18n key**

在 `src/locales/en.json` 的 `proxy.panel` 对象中添加：
```json
"apiKey": "API Key"
```
在 `src/locales/zh.json` 的 `proxy.panel` 对象中添加：
```json
"apiKey": "API Key"
```
在 `src/locales/ja.json` 的 `proxy.panel` 对象中添加：
```json
"apiKey": "API Key"
```
在 `src/locales/de.json` 的 `proxy.panel` 对象中添加：
```json
"apiKey": "API Key"
```

- [ ] **Step 6: Commit**

```bash
git add src/components/proxy/ProxyPanel.tsx src/locales/en.json src/locales/zh.json src/locales/ja.json src/locales/de.json
git commit -m "feat(proxy): display gateway API key in panel when routing is active

- Add readOnly API Key input with copy button below service address
- Only visible when routing is running and token exists
- Add i18n keys for en/zh/ja/de locales

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: 最终验证

**Files:**
- (no file changes)

- [ ] **Step 1: cargo check 全量编译验证**

Run: `CARGO_TARGET_DIR=/Users/jimmyhu/ccswitch-target cargo check --message-format=short 2>&1 | grep "^error" | head -10`
预期：无 error

- [ ] **Step 2: pnpm typecheck 全量类型验证**

Run: `pnpm typecheck 2>&1 | tail -5`
预期：退出码 0

- [ ] **Step 3: Release build 验证二进制正常**

Run: `CARGO_TARGET_DIR=/Users/jimmyhu/ccswitch-target pnpm tauri build --no-bundle 2>&1 | tail -5`
预期：`Built application at: .../cc-switch`，版本 3.20.4

- [ ] **Step 4: git log 确认所有 commit**

Run: `git log --oneline -5`
预期：4 个新 commit 依次为 Task 1-4 的提交
