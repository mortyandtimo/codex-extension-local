# Codex Extension Local

把 **ChatGPT / Codex Chrome 扩展**（side panel）接到你自己的 OpenAI 兼容端点上，并让配置改动**即时生效**。

开箱即用：clone 下来，加载扩展，改一个配置文件，完事。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

---

## 它解决什么

官方 ChatGPT 扩展的模型请求全部交给本地 codex app-server 处理，而 app-server：

- **只在启动时读一次** `~/.codex/config.toml`，没有任何文件监听
- 被配置错误（比如第三方教程常写的 `requires_openai_auth = true`）带偏时，会把官方模型清单塞进选择器，导致你选中一个端点根本不存在的模型

本项目提供两样东西：

1. **一份打好补丁的扩展**，拿来就能加载（免去手动改压缩代码）
2. **一个配置热加载器**，改完 `config.toml` 两秒生效，不用重启任何东西

## 效果

配置改完保存，日志立刻出现：

```
[2026-09-18T04:58:25.548Z] change detected in config.toml
[2026-09-18T04:58:27.461Z] config.toml changed -> cycled app-server pid 41008 (restart #1); extension respawns it
```

扩展侧边栏自动重连，新配置直接可用。不用关浏览器，不用重装扩展，不用在多个工具间切换。

## 快速开始

### 0. 准备

| 需要 | 说明 |
|---|---|
| Node.js 18+ | 跑热加载器用 |
| Codex CLI 或 Codex App | 提供 `codex.exe`，扩展依赖它 |
| Chrome / Edge | 116 或更高 |
| 一个 OpenAI 兼容端点 | 官方 API、自建中转、本地推理都行 |

### 1. 拿到代码

```bash
git clone https://github.com/mortyandtimo/codex-extension-local.git
cd codex-extension-local
```

### 2. 配置你的端点

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

三个要点：

- `model` 必须是**你端点上真实存在**的模型 ID，先访问 `<base_url>/models` 确认
- `base_url` 填到 `/v1` 为止
- **不要加 `requires_openai_auth = true`**（原因见下）

### 3. 加载扩展

1. 打开 `chrome://extensions`
2. 右上角开启**开发者模式**
3. 点**加载已解压的扩展程序**
4. 选择仓库里的 `extension/` 目录

> **如果已装官方版**：本扩展保留了原始 `key`，与商店版 **ID 相同**，无法共存。先禁用或卸载商店版再加载。
>
> 保留 `key` 是必须的：扩展要连本地 codex，而 native messaging host 的 `allowed_origins` 白名单按 **扩展 ID** 校验，ID 变了就连不上。

### 4. 启动热加载器

```bash
node tools/watcher.mjs
```

看到 `watching ...config.toml` 就成功了。之后改配置保存即生效。

想后台静默运行：

```
wscript tools/start-hidden.vbs
```

想开机自启：`Win+R` 输入 `shell:startup`，把 `start-hidden.vbs` 的快捷方式丢进去。

## 为什么不能加 `requires_openai_auth = true`

很多第三方中转教程会让你加这行。**它是错的。**

这行的真实含义是「这个 provider 借用 OpenAI 登录态」。加上之后：

- codex 认为你在用官方服务
- 扩展的模型选择器里会混入 **OpenAI 官方模型**（`gpt-5.x` 之类）
- 你选中它们，请求发到你的本地端点，而端点没有这些模型 → 报错

正确做法是用 `experimental_bearer_token` 或 `env_key`，两条认证通道保持独立。

## 认证与推理是分开的

`~/.codex/auth.json` 的 `auth_mode` 只影响 OpenAI 服务认证（浏览器控制等高权限功能）。**实测确认**：即使 `auth_mode` 是 `chatgpt`，发往自定义 provider 的请求仍然使用 `config.toml` 里的 token，推理不会被切走。

侧边栏的浏览器控制类工具（`cua_repl` 的 `browser.*`）硬性要求 `chatgpt` 认证，`apikey` 会被拒绝：

```
unsupported Codex auth method: apikey
```

需要时执行 `codex login` 走一次浏览器 OAuth 即可，不影响你的本地模型。

## 项目结构

```
codex-extension-local/
├── extension/              可直接加载的扩展（内含 Codex side panel）
├── tools/
│   ├── watcher.mjs         配置热加载器
│   ├── edit-config.mjs     UTF-8 安全的配置编辑
│   ├── fix-config.mjs      修复被文本管道损坏的配置
│   ├── start.cmd           前台启动（看日志）
│   └── start-hidden.vbs    无窗口后台启动
├── docs/
│   ├── usage.md            完整使用文档
│   └── troubleshooting.md  故障排查
└── README.md
```

## 文档

- [使用文档](docs/usage.md) — 字段说明、配置场景、触发规则
- [故障排查](docs/troubleshooting.md) — 实际踩过的坑与对策

## 热加载器可调参数

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `WATCH_POLL_MS` | `2000` | 轮询间隔 |
| `WATCH_DEBOUNCE_MS` | `1500` | 编辑防抖 |
| `WATCH_COOLDOWN_MS` | `12000` | 重启后冷却，防止回写死循环 |
| `WATCH_FULL_HASH` | 未设置 | 设 `1` 监控整个文件 |
| `CODEX_CONFIG` | `~/.codex/config.toml` | 监控目标 |

## 鸣谢

- [LINUX DO](https://linux.do/) — 感谢社区的技术讨论与分享氛围

## 免责声明

扩展本体（`extension/` 目录）版权归 OpenAI 所有，此处仅作学习与研究用途的分发。Codex、ChatGPT 是 OpenAI 的商标。本项目与 OpenAI 无关联。

`tools/` 与 `docs/` 下的原创内容采用 MIT 协议，见 [LICENSE](LICENSE)。
