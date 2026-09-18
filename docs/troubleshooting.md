# 故障排查

以下都是实际踩过的坑，按现象组织。

## `Permission mode is unavailable` / `Unable to send message`

**原因**：app-server 没在跑，扩展拿不到权限配置。

```powershell
Get-CimInstance Win32_Process -Filter "Name='codex.exe'" |
  Where-Object { $_.CommandLine -match 'app-server' } |
  Select-Object ProcessId, CreationDate
```

没有输出就是 app-server 没起来。它按需启动：**打开 side panel 时**扩展才会把它拉起来。

**处理**：关闭再打开 side panel。若仍不行，重启扩展（`chrome://extensions` 点刷新）。

**注意**：watcher 重启 app-server 时会有几秒空窗，正好在这时候操作就会看到这个报错。等几秒重试即可。

## 模型列表里出现 `gpt-5.6-sol` 之类官方模型，但端点没有

**原因**：provider 段里写了 `requires_openai_auth = true`。

这行的真实含义是「这个 provider 借用 OpenAI 登录态」。一旦加上，codex 会认为你在用官方服务，把 **OpenAI 官方模型清单**也塞进扩展的选择器。你选中 `gpt-5.x`，请求发到你的本地端点，而端点没有这个模型，于是失败。

**处理**：删掉它。

```bash
node tools/edit-config.mjs ~/.codex/config.toml drop-key requires_openai_auth --apply
```

保留 `experimental_bearer_token` 或 `env_key` 即可。这就是本项目 README 里专门警告这行的原因。

## 扩展显示的 URL 不是我刚改的

按顺序检查：

**1. watcher 是否在跑，有没有检测到**

```powershell
Get-Content "$env:USERPROFILE\.codex\config-watcher.log" -Tail 6
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'config-watcher' }
```

**2. 你改的字段是否在监控列表内**（见 [usage.md](docs/usage.md#什么会触发重启)）。改 `[projects.*]` 之类的不会触发，这是正常的。

**3. 是否存在多个 watcher 实例**。多个实例会互相干扰：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'config-watcher' } |
  Select-Object ProcessId, CreationDate
```

只保留一个，其余的 `Stop-Process -Id <pid> -Force`。

**4. 文件真的落盘了吗**。有些工具（如配置切换器）走 IPC 而非写文件，如果它依赖的管道不可用，切换就不会生效。检查文件本身：

```powershell
Select-String -Path "$env:USERPROFILE\.codex\config.toml" -Pattern 'base_url'
```

## `Error loading config.toml: unclosed table, expected ']'`

**原因**：文件被 PowerShell 文本管道损坏了。

`Get-Content -Raw` 会把非 ASCII 内容重新编码，**吃掉含中文路径的 `[projects.'...']` 表头的结尾单引号**。

**处理**：

```bash
node tools/fix-config.mjs ~/.codex/config.toml          # 诊断
node tools/fix-config.mjs ~/.codex/config.toml --apply  # 修复
```

修复前会自动备份为 `config.toml.pre-repair-<timestamp>`。

**预防**：永远不要用 `Get-Content -Raw | ... | WriteAllText` 改这个文件。用编辑器直接保存，或用 `edit-config.mjs`。

## `unsupported Codex auth method: apikey`

**原因**：浏览器控制类功能（`cua_repl` 的 `browser.*`）硬性要求 `chatgpt` 或 `chatgptAuthTokens` 认证方式，`apikey` 被明确拒绝。这是 codex 的设计，不是配置问题。

**处理**：需要真实的 ChatGPT 登录。

```powershell
& $codex login
```

登录后 `auth.json` 变成 `auth_mode: "chatgpt"`，浏览器控制解锁。

**同时**：模型推理**不会**被切走。实测确认即使 `auth_mode` 是 `chatgpt`，发往自定义 provider 的请求仍然用 `config.toml` 里的 token。两条通道独立。

**并且**：`codex login --with-access-token` 走的是 agent identity 路径，会请求 JWKS 验签，自签 JWT 无法通过。

## 改了配置但扩展还在用旧模型

确认 app-server 真的重启了：

```powershell
Get-CimInstance Win32_Process -Filter "Name='codex.exe'" |
  Where-Object { $_.CommandLine -match 'app-server' } |
  Select-Object ProcessId, CreationDate
```

`CreationDate` 应该是你改配置**之后**的时间。如果还是旧的，说明 watcher 没触发，回上面「扩展显示的 URL 不是我刚改的」逐步排查。

## watcher 启动了但毫无反应

**1. 路径对不对**

```powershell
Test-Path "$env:USERPROFILE\.codex\config.toml"
```

**2. 用绝对路径显式指定**

```powershell
$env:CODEX_CONFIG = "$env:USERPROFILE\.codex\config.toml"
node tools/watcher.mjs
```

**3. 手动验证触发链路**

用临时配置测试，不碰真实文件：

```powershell
Copy-Item "$env:USERPROFILE\.codex\config.toml" "$env:TEMP\test-config.toml"
$env:CODEX_CONFIG = "$env:TEMP\test-config.toml"
node tools/watcher.mjs
```

然后在 `test-config.toml` 里改一下 `model` 字段保存，日志应该出现 `change detected`。

## 重启会不会打断正在进行的对话

会。watcher 是通过 cycle app-server 实现的，所以**改配置时如果模型正在输出，那一轮会中断**。改配置前等当前回答结束。

如果你觉得空窗期难以接受，可以调大防抖，让重启延后到编辑稳定之后：

```powershell
$env:WATCH_DEBOUNCE_MS = "4000"
```

## 如何完全卸载

```powershell
# 停 watcher
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'config-watcher' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 移除开机自启：删掉 shell:startup 里的快捷方式
explorer shell:startup
```

配置文件和扩展都不受影响，`codex` 会回到「改完手动重启」的原始行为。
