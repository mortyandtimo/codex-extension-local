# 让 ChatGPT / Codex 的 Chrome 扩展使用你自己的模型端点

仓库：https://github.com/mortyandtimo/codex-extension-local

## 它做什么

官方 ChatGPT 扩展的 side panel 并不自己发模型请求，而是交给本地 codex app-server 处理，配置全部来自 `~/.codex/config.toml`。

本项目提供两样东西：

- 一份**可以直接加载的扩展构建**，省去自己改压缩代码的麻烦
- 一个**配置热加载器**，改完配置文件两秒生效，不用重启任何东西

## 和官方版的区别

|  | 官方扩展 | 这个版本 |
|---|---|---|
| 模型列表 | 来自 OpenAI 官方 | 来自你自己的端点 `/v1/models` |
| 改完配置 | 需要重启扩展才生效 | 保存后自动生效 |
| 扩展 ID | `hehggadaopoacecdllhhajmbjkdcmajg` | 相同（保留原 key，必须一致才能连上本地 codex） |
| 界面 | Codex side panel | 完全一样，没有改动 UI |

界面上看不出区别，只是模型请求的去向变了。

## 使用

**1. 克隆**

```bash
git clone https://github.com/mortyandtimo/codex-extension-local.git
cd codex-extension-local
```

需要 Node.js 18+ 以及已安装的 Codex CLI。

**2. 配置你的端点**

编辑 `~/.codex/config.toml`：

```toml
model_provider = "custom"
model = "your-model-name"

[model_providers.custom]
name = "MyProvider"
base_url = "http://127.0.0.1:8317/v1"
wire_api = "responses"
experimental_bearer_token = "your-token"
```

`model` 填你端点上真实存在的模型 ID，可以先访问 `<base_url>/models` 看有哪些。

**3. 加载扩展**

打开 `chrome://extensions`，开启开发者模式，点「加载已解压的扩展程序」，选择仓库里的 `extension/` 目录。

如果已经装了商店版，需要先禁用它：两者扩展 ID 相同，无法共存。ID 之所以必须保持一致，是因为 native messaging host 按扩展 ID 校验白名单，ID 变了就连不上本地 codex。

**4. 启动热加载**

```bash
node tools/watcher.mjs
```

看到 `watching ... config.toml` 就好了。之后随时改配置，两秒内自动生效。

想后台静默运行用 `wscript tools/start-hidden.vbs`，想开机自启就把它的快捷方式放进 `shell:startup`。

## 两点说明

**登录和推理是分开的**。`~/.codex/auth.json` 管 OpenAI 服务认证（浏览器控制这类高权限功能需要），`config.toml` 里的 provider 管模型请求。所以登录 ChatGPT 不会把推理切走，侧边栏用的还是你自己的端点。

**扩展和 CLI 共用同一份配置**。在扩展界面里换模型会写回 `config.toml`，CLI 也跟着变；反过来改文件，扩展会立刻看到。

## 目录

```
extension/          可直接加载的扩展
tools/watcher.mjs   配置热加载器
tools/edit-config.mjs
tools/fix-config.mjs
docs/usage.md
docs/troubleshooting.md
```

`tools/` 和 `docs/` 是 MIT。`extension/` 是 OpenAI 的扩展构建，版权归 OpenAI，此处仅作学习研究用途分发。

## 鸣谢

感谢 [LINUX DO](https://linux.do/) 社区。
