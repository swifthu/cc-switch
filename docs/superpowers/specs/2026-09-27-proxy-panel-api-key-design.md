# Design: Proxy Panel API Key Display

**Date:** 2026-09-27
**Status:** Approved
**Author:** Claude Code (JimmyHu)

---

## 1. Overview

Add a read-only API Key text box with a copy button to the proxy routing panel in CC-Switch settings. The API Key is the Claude Desktop gateway Bearer token (`ccs-{uuid}` format) used to authenticate Claude Desktop apps connecting to the local proxy server. It is displayed only when routing is active.

---

## 2. Background

The Claude Desktop gateway Bearer token is already generated and stored in the database (`settings` table, key: `claude_desktop_gateway_token`) by the existing `get_or_create_gateway_token()` function. It is used in two places:

1. Written to `~/Library/Application Support/Claude/claude_desktop_config.json` as `inferenceGatewayApiKey`
2. Validated on each incoming request in `validate_claude_desktop_gateway_auth`

However, there is no existing UI to let users view/copy this token. Users must manually locate the database or config file to find it.

---

## 3. Architecture

```
Database settings table (claude_desktop_gateway_token)
        ↑
get_or_create_gateway_token()
        ↓
ProxyStatus.gateway_token  (new field, Option<String>)
        ↓
ProxyPanel.tsx  (UI: readOnly input + copy button)
```

### 3.1 Data Flow

1. Frontend calls `getProxyStatus()` (existing Tauri command)
2. Rust side: `get_status()` reads `gateway_token` from DB via `get_or_create_gateway_token()`
3. Token is injected into `ProxyStatus` response (only when `status.running == true`)
4. Frontend conditionally renders the API Key row

---

## 4. Changes

### 4.1 Rust — Backend

**File:** `src-tauri/src/proxy/types.rs`

Add `gateway_token` field to `ProxyStatus`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyStatus {
    // ... existing fields (running, address, port, etc.) ...
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_token: Option<String>,  // new
}
```

**File:** `src-tauri/src/proxy/server.rs`

In `get_status()`, populate `gateway_token` when running:

```rust
pub async fn get_status(&self) -> ProxyStatus {
    let mut status = self.inner.status.read().await.clone();
    if status.running {
        status.gateway_token = Some(
            crate::claude_desktop_config::get_or_create_gateway_token(self.db.as_ref())
                .unwrap_or_default()
        );
    }
    status
}
```

**No changes needed to:** `src-tauri/src/commands/proxy.rs` (existing `get_proxy_status` command auto-returns new field)

### 4.2 TypeScript — Frontend

**File:** `src/types/proxy.ts`

Sync TypeScript type:

```ts
export interface ProxyStatus {
  // ... existing fields ...
  gateway_token?: string;  // new
}
```

**File:** `src/components/proxy/ProxyPanel.tsx`

Add API Key row below service address (conditional on `status.running`):

```tsx
{/* Service Address — always shown when running */}
<div>
  <p className="text-xs text-muted-foreground mb-2">
    {t("proxy.panel.serviceAddress", { defaultValue: "服务地址" })}
  </p>
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
    <code className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border/60">
      {formatAddressForUrl(status.address, status.port)}
    </code>
    <Button size="sm" variant="outline" onClick={() => copyAddress()}>
      {t("common.copy")}
    </Button>
  </div>
</div>

{/* API Key — only shown when running */}
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

### 4.3 i18n

Add translation key `proxy.panel.apiKey` in all locale files:
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/ja.json`
- `src/locales/de.json`

Value: `{ "proxy": { "panel": { "apiKey": "API Key" } } }` (en), `{ "proxy": { "panel": { "apiKey": "API Key" } } }` (zh)

---

## 5. Design Constraints

- **Read-only:** The API Key text box must be `readOnly` — users cannot edit the token
- **Conditional display:** Only renders when `status.running == true` and `gateway_token` is present
- **Token persistence:** Token is not regenerated on each call — `get_or_create_gateway_token()` creates once, returns existing on subsequent calls
- **Style consistency:** API Key row must visually match the service address row (same padding, border, font)

---

## 6. Testing Checklist

| Scenario | Expected Result |
|---|---|
| Routing OFF | Service address shown, API Key row not rendered |
| Routing ON (fresh) | Service address + API Key both shown |
| Copy button click | Token copied to clipboard, toast shown |
| Routing restart | Same token shown (not regenerated) |
| TypeScript type | `gateway_token?: string` accepted without error |
| `cargo check` | No compilation errors |
| `pnpm typecheck` | No TypeScript errors |

---

## 7. Files Changed

| File | Change |
|---|---|
| `src-tauri/src/proxy/types.rs` | Add `gateway_token: Option<String>` to `ProxyStatus` |
| `src-tauri/src/proxy/server.rs` | Populate `gateway_token` in `get_status()` |
| `src/types/proxy.ts` | Add `gateway_token?: string` to TypeScript `ProxyStatus` |
| `src/components/proxy/ProxyPanel.tsx` | Add conditional API Key row |
| `src/locales/en.json` | Add `proxy.panel.apiKey` |
| `src/locales/zh.json` | Add `proxy.panel.apiKey` |
| `src/locales/ja.json` | Add `proxy.panel.apiKey` |
| `src/locales/de.json` | Add `proxy.panel.apiKey` |
