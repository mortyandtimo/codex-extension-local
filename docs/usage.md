# 使用文档

## 前置条件

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows（脚本针对 Windows 编写，核心逻辑可移植到 macOS / Linux） |
| Node.js | 18 或更高 |
| Codex | 已安装 Codex CLI 或 Codex App（提供 `codex.exe`） |
| 扩展 | ChatGPT / Codex Chrome 扩展（side panel） |
| 端点 | 任意 OpenAI 兼容服务（官方 API、自建中转、本地推理均可） |

确认 Codex 位置：

```powershell
Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe |
  Select-Object -First 5 FullName
```

## 安装

```bash
git clone https://github.com/mortyandtimo/codex-extension-local.git
cd codex-config-watcher
node tools/watcher.mjs
```

启动成功后日志会立刻打印监听目标。建议先设开机自启（见 README）。

## 配置文件

一切真相都在 `~/.codex/config.toml`。**扩展和 CLI 读的是同一份文件**，没有第二套配置。

### 指向自定义端点

```toml
model_provider = "custom"
model = "your-model-name"
model_reasoning_effort = "high"

[model_providers.custom]
name = "MyProvider"                                  # 显示名
base_url = "http://127.0.0.1:8317/v1"                # 端点，填到 /v1 为止
wire_api = "responses"                               # responses 或 chat
experimental_bearer_token = "your-token"             # 认证 token
http_headers = { "x-custom-header" = "value" }       # 可选
```

保存后约两秒生效。

### 字段说明

| 字段 | 作用 |
|---|---|
| `model_provider` | 选用哪个 provider 段，必须与 `[model_providers.<name>]` 对应 |
| `model` | 实际发给端点的模型 ID，必须是端点上真实存在的 |
| `wire_api` | `responses` 走 `/v1/responses`，`chat` 走 `/v1/chat/completions` |
| `base_url` | 端点地址，末尾带 `/v1` |
| `experimental_bearer_token` | 直接写在配置里的 token，简单但不便共享 |
| `env_key` | 从环境变量读 token，更安全，推荐 |
| `http_headers` | 额外请求头，某些中转需要 |
| `model_reasoning_effort` | 推理强度 `low` / `medium` / `high` / `xhigh` |

### 用环境变量代替明文 token

```toml
[model_providers.custom]
env_key = "MY_PROVIDER_KEY"
```

然后设系统环境变量 `MY_PROVIDER_KEY`。

> `env_key`、`experimental_bearer_token`、`requires_openai_auth`、`auth` 这几者是**互斥**的认证方式，同一 provider 里只留一个。

## 认证与登录

`~/.codex/auth.json` 决定 `auth_mode`。它和模型推理是**两条独立的通道**：

| 文件 | 管什么 |
|---|---|
| `config.toml` 的 provider 段 | 模型请求发往哪里、用什么 token |
| `auth.json` | OpenAI 服务认证（浏览器控制等高权限功能） |

实测确认：即使 `auth_mode` 是 `chatgpt`，发往自定义 provider 的请求仍然使用 `config.toml` 里的 token，**推理不会被切走**。

### 切换登录方式

```powershell
$codex = "$env:LOCALAPPDATA\OpenAI\Codex\bin\<hash>\codex.exe"

# 用 ChatGPT 账号登录（浏览器 OAuth）
& $codex login

# 用 API key
"sk-xxxx" | & $codex login --with-api-key

# 查看当前状态
& $codex login status
```

## 扩展与 CLI 的关系

```
Chrome 扩展 (side panel)
        │  native messaging
        ▼
  extension-host.exe
        │
        ▼
  codex app-server  ──读取──▶  ~/.codex/config.toml
        │                              │
        │                              └──▶ 你的端点（如 127.0.0.1:8317/v1）
        ▼
  实际推理请求
```

互通是双向的：

- 在扩展 UI 里换模型 → 通过 `config/value/write` 写回 `config.toml` → CLI 下次也用新模型
- 直接改 `config.toml` → watcher 触发 app-server 重启 → 扩展立刻看到新配置

**一个 provider 只能有一套模型列表**。选择器里显示的就是你端点上的模型。想看到官方 `gpt-5.x`，必须把 provider 指回 `openai` 并用 ChatGPT 订阅，那样就不再走自定义端点了。

## 什么会触发重启

默认只跟踪这些键（任一变化即触发）：

```
model  model_provider  model_reasoning_effort  model_context_window
model_auto_compact_token_limit  plan_mode_reasoning_effort
approval_policy  sandbox_mode  disable_response_storage  network_access
profile  openai_base_url
wire_api  base_url  env_key  env_key_instructions  experimental_bearer_token
requires_openai_auth  http_headers  env_http_headers  query_params
request_max_retries  stream_max_retries  stream_idle_timeout_ms
supports_websockets  supports_standalone_web_search
[model_providers.*] 段内任意行
```

**不触发**的：`[projects.*]`、`[tui.*]`、`[hooks.*]`、UI 状态回写等。这是刻意的，因为 app-server 会在启动后把自己的状态写回 `config.toml`，全量比对会陷入重启死循环。

需要监控整个文件时设 `WATCH_FULL_HASH=1`。

## 安全编辑配置

**不要**用 PowerShell 文本管道改 `config.toml`：

```powershell
# 危险：会损坏含非 ASCII 路径的表头
$t = Get-Content $cfg -Raw
[System.IO.File]::WriteAllText($cfg, $t.Replace('a','b'))
```

改用附带脚本：

```bash
node tools/edit-config.mjs ~/.codex/config.toml show-key model
node tools/edit-config.mjs ~/.codex/config.toml drop-key requires_openai_auth --apply
```

或者直接用编辑器保存（保留原编码即可）。

## 验证是否生效

改完配置后，看最新会话记录里的模型字段：

```powershell
$f = Get-ChildItem "$env:USERPROFILE\.codex\sessions" -Recurse -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $f.FullName -Pattern '"model":"[^"]+"' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```

对照 `config.toml` 里的 `model`，一致即生效。

## 日志

控制台输出，同时追加到 `~/.codex/config-watcher.log`：

```
[2026-09-18T04:58:25.548Z] change detected in config.toml
[2026-09-18T04:58:27.461Z] config.toml changed -> cycled app-server pid 41008 (restart #1); extension respawns it
```

超过 1MB 不会截断（本工具日志量极小，通常可忽略）。
