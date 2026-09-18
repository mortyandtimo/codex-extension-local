# 让 ChatGPT / Codex 的 Chrome 扩展走你自己的模型端点

> 开源了一个可以直接加载的扩展构建 + 一套配置热加载工具。顺便把逆向过程中踩到的几个坑写出来。

仓库：https://github.com/mortyandtimo/codex-extension-local

---

## 起因

官方那个 ChatGPT Chrome 扩展（现在的 Codex side panel），模型请求其实不走浏览器 cookie，而是交给**本地 codex app-server** 处理。完整链路是：

```
Chrome 扩展 (side panel)
   │  native messaging
   ▼
extension-host.exe
   │
   ▼
codex app-server  ──读取──▶  ~/.codex/config.toml
   │
   ▼
实际推理请求 → 你配置的端点
```

也就是说，**它本来就能走你自己的中转**，只要 `~/.codex/config.toml` 配置正确。

但实际用起来有几个坑，导致很多人以为"这扩展不支持 API 方式"。我把坑填了，工具也一起开源了。

---

## 坑一：它真的会拒绝 API key 登录

扩展的 sidepanel 走 app-server 的 `account/*` 协议。反编译后能看到这段：

```js
if (e === `account/login/start`) {
  if (e.type === `apiKey`)
    return { error: { code: -32e3,
      message: `Browser API key sign-in is not supported. Use a ChatGPT bearer token for this dev host.` } };
  if (e.type === `chatgptAuthTokens`) { ... }
}
```

登录入口提供了"用 API key 登录"，但代码里**直接拒绝**，只认 ChatGPT bearer token。

更麻烦的是浏览器控制类工具（`cua_repl` 的 `browser.*`）还会再检查一次 auth method：

```
unsupported Codex auth method: apikey
```

这行来自 `@oai/sky/bin/windows/codex-computer-use.exe`，二进制里的判定表只接受 `chatgpt` 和 `chatgptAuthTokens`。

**结论**：身份校验这关绕不过去，`codex login` 走一次浏览器 OAuth 就行。

**但重点来了**：登录 ChatGPT **不会**把你的推理请求切走。`auth.json` 管的是 OpenAI 服务认证，`config.toml` 里的 provider 管的是模型请求，两条通道独立。实测确认过，即使 `auth_mode` 是 `chatgpt`，发往自定义 provider 的请求带的仍然是 `config.toml` 里的 token。

---

## 坑二：`requires_openai_auth = true` 是个陷阱

很多第三方中转教程会教你这么写：

```toml
[model_providers.custom]
base_url = "https://your-relay.example/v1"
requires_openai_auth = true
```

**这行是错的。**

它的真实含义是「这个 provider 借用 OpenAI 登录态」。加上之后 codex 会认为你在用官方服务，把 **OpenAI 官方模型清单**也塞进扩展的模型选择器。于是你的侧边栏里会出现 `gpt-5.6-sol` 这种东西，你选中它、发出去，请求打到你的中转，而中转根本没有这个模型 —— 报错。

官方文档明确说 `auth` / `env_key` / `experimental_bearer_token` / `requires_openai_auth` 这几种认证方式不能混用。

**正确写法**：

```toml
model_provider = "custom"
model = "your-model-name"

[model_providers.custom]
name = "MyProvider"
base_url = "http://127.0.0.1:8317/v1"
wire_api = "responses"
experimental_bearer_token = "your-token"
```

去掉那行之后，扩展的模型列表就会正确地从你的端点拉取。

---

## 坑三：改了配置不生效

这是最烦的。codex app-server **只在启动时读一次** `config.toml`，之后你改文件它完全不知道。

我把 codex 二进制翻了一遍确认：`ConfigWatcher`、`reload_config`、`watch_config` 出现次数**全是 0**，没有任何文件监听机制。

而扩展内部其实**有**重启 app-server 的能力（内部消息 `codex-app-server-restart`），只是它永远不知道文件变了。

所以缺的就是中间那一环。

---

## 解决方案

### 1. 完整可加载的扩展

仓库里的 `extension/` 是一份可以直接加载的构建，省去自己改压缩代码的麻烦。

**它保留了原始 manifest `key`**，这点很重要：native messaging host 的 `allowed_origins` 是**按扩展 ID 校验**白名单的。ID 一变，扩展就连不上本地 codex app-server，整个功能废掉。

代价是它和商店版 ID 相同，无法共存，加载前需要先禁用商店版。

### 2. 配置热加载器

`tools/watcher.mjs` 监听 `config.toml`，变更时只 cycle 命令行含 `app-server` 的 `codex.exe`，扩展会在几秒内自动重连并把新进程拉起来。

```
改 config.toml → watcher 检测 → cycle app-server → 扩展自动重连 → 新配置生效
```

实测日志：

```
[04:58:25] change detected in config.toml
[04:58:27] cycled app-server pid 41008 (restart #1); extension respawns it
```

几个设计上的取舍：

**只跟踪影响推理的字段**，不监控整文件。因为 app-server 启动后会把自身 UI 状态**回写**进 `config.toml`，全量比对会陷入「回写触发重启、重启又回写」的死循环。

**12 秒冷却期**，进一步防这个。

**只动 app-server**，不碰 `codex exec` 会话，也不碰 `auth.json`。

### 3. 两个配套脚本

`edit-config.mjs`：UTF-8 安全的配置编辑器。原因见下面那个坑。

`fix-config.mjs`：修复已经被损坏的配置。

---

## 坑四（我自己踩的）：PowerShell 会毁掉你的配置

我一开始图省事，用这种方式改配置：

```powershell
$t = Get-Content $cfg -Raw
[System.IO.File]::WriteAllText($cfg, $t.Replace('a','b'))
```

**这个管道会把非 ASCII 内容重新编码**，结果是把含中文路径的表头搞坏了：

```
[projects.'c:\users\administrator\documents\chatgpt\小说']     ← 正常
[projects.'c:\users\administrator\documents\chatgpt\缁夊瀚?]    ← 单引号被吃掉
```

然后 codex 直接报：

```
Error loading config.toml: unclosed table, expected ']'
```

配置全废。

**教训**：改 `config.toml` 要么用编辑器直接保存，要么用 `edit-config.mjs`（全程 UTF-8，只做精确正则替换，不重排文件，改完还会复查表头完整性）。

如果你已经踩了，`fix-config.mjs` 能修。

---

## 还有一个坑：别装多个 watcher

我有一次不小心启动了三个 watcher 实例，它们互相干扰。如果你也遇到"改了配置没反应"，先查一下：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'config-watcher' }
```

多于一个就杀掉多余的。

---

## 使用步骤

需要 Node.js 18+ 和已安装的 Codex CLI。

```bash
git clone https://github.com/mortyandtimo/codex-extension-local.git
cd codex-extension-local
```

**配置端点**，编辑 `~/.codex/config.toml`：

```toml
model_provider = "custom"
model = "your-model-name"

[model_providers.custom]
name = "MyProvider"
base_url = "http://127.0.0.1:8317/v1"
wire_api = "responses"
experimental_bearer_token = "your-token"
```

> `model` 必须是端点上真实存在的 ID，先访问 `<base_url>/models` 确认。

**加载扩展**：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `extension/` 目录。

**启动热加载**：

```bash
node tools/watcher.mjs
```

之后随便改配置，两秒生效。

---

## 一些额外说明

**关于 auth 和推理的隔离**：前面说过，ChatGPT 登录只影响高权限功能（浏览器控制等），推理请求始终走 `config.toml` 的 provider。你可以放心登录。

**关于模型列表**：扩展和 CLI 共用**同一份** `config.toml`，没有第二套配置。在扩展 UI 里换模型会通过 `config/value/write` 写回文件，CLI 也跟着变；反过来改文件，watcher 会让扩展立刻看到。

**一个 provider 只能有一套模型列表**。想在同一个选择器里同时看到官方 GPT 模型和你中转的模型是做不到的，必须二选一。

---

## 仓库

https://github.com/mortyandtimo/codex-extension-local

文档：

- `docs/usage.md` — 字段说明、配置场景、触发规则
- `docs/troubleshooting.md` — 上面所有坑的详细排查步骤

`tools/` 和 `docs/` 是 MIT。`extension/` 是 OpenAI 的扩展构建，版权归 OpenAI，这里只作学习研究用途分发。

---

## 鸣谢

感谢 [LINUX DO](https://linux.do/) 社区的技术讨论氛围。
