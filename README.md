# Antigravity Proxy 🚀

[🇨🇳 简体中文 (Simplified Chinese)](#中文说明)

**Antigravity Proxy** is an advanced, lightweight, Electron-based HTTP/HTTPS interception proxy specifically designed for seamless API traffic monitoring, logging, and token usage analytics.

## Features
- **HTTPS Decryption & Interception**: Automatically generates local CA certificates to intercept, decrypt, and manipulate secure HTTPS traffic.
- **Real-Time Token Analytics**: Sniffs payload traffic to calculate and display Prompt Tokens, Output Tokens, and Cache Hit Rates directly in the UI.
- **Granular Traffic Control**: One-click toggle for "Intercept Mode" (Proxy ON) vs "Passthrough Mode" (Proxy OFF).
- **Intelligent Error Handling**: Automatically catches `503 Capacity Exhausted` or `ECONNRESET` errors and retries silently using an exponential backoff algorithm.
- **Advanced Logging**: Detailed request/response payload logging with automatic rotation (retains the latest 50 entries) stored cleanly in the user data directory.
- **System Tray Integration**: Quietly runs in the background. Close the window to minimize it to the system tray.
- **Single-Instance Lock**: Prevents port-clashing and memory bloat by ensuring only a single proxy engine is allowed to run at a time.

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/weilimao/antigravityProxy.git
   cd antigravityProxy
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application:**
   ```bash
   npm run start
   ```

## Usage

1. Open the **Antigravity Proxy** application.
2. Click **Install CA** to trust the local dynamically generated Root Certificate (required for HTTPS interception).
3. Toggle the **Intercept Mode** to `ON`.
4. Point your IDE, HTTP Client, or System Proxy to the local proxy port (default is `127.0.0.1:18443`).
5. Monitor your API requests, responses, and token consumption natively inside the application dashboard!

---

<br/>

<h1 id="中文说明">Antigravity Proxy 🚀 (中文说明)</h1>

**Antigravity Proxy** 是一款基于 Electron 构建的高级、轻量级 HTTP/HTTPS 拦截代理工具，专为无缝监控 API 流量、记录日志和分析 Token 消耗而量身定制。

## 核心特性
- **HTTPS 解密与拦截**：自动生成并信任本地 CA 证书，实现对 HTTPS 加密流量的无缝拦截、解密和重写。
- **实时 Token 统计**：深度嗅探 API 请求体和响应体，在 UI 面板实时展示您的输入 Token (Prompt Tokens)、输出 Token (Output Tokens) 以及缓存命中率 (Cache Hit Rate)。
- **一键流量管控**：提供直观的开关切换“拦截模式”（开启代理处理）与“直通模式”（关闭拦截纯转发）。
- **智能重试机制**：针对 `503 Capacity Exhausted` 或网络异常断开，代理层会在静默状态下通过指数退避算法自动进行重试，保障请求成功率。
- **高级日志系统**：独立的请求 (Requests) 与响应 (Responses) 详细日志记录，自带轮转清理功能（仅保留最新 50 条），防止磁盘空间占用过大。
- **系统托盘驻留**：关闭主窗口后自动隐藏至系统托盘，保持后台静默运行。
- **单例运行锁**：严格限制只允许启动一个代理实例，避免端口冲突或唤起多个重复窗口。

## 安装指南

1. **克隆代码库：**
   ```bash
   git clone https://github.com/weilimao/antigravityProxy.git
   cd antigravityProxy
   ```

2. **安装依赖：**
   ```bash
   npm install
   ```

3. **启动程序：**
   ```bash
   npm run start
   ```

## 使用方法

1. 启动 **Antigravity Proxy** 客户端程序。
2. 点击右上角的 **Install CA**（安装证书），一键信任本地动态生成的根证书（解密 HTTPS 流量的必须步骤）。
3. 将 **Intercept Mode**（拦截模式）开关拨至 `ON`。
4. 将您的 IDE、HTTP 客户端或系统代理设置指向本机的代理端口（默认 `127.0.0.1:18443`）。
5. 在仪表盘上实时监控您的 API 请求、日志详情以及 Token 消耗情况！
