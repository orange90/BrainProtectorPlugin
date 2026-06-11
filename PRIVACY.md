# Privacy Policy / 隐私权政策

**Last updated / 最后更新：2026-06-11**

---

## 中文版

### 一、我们收集什么数据

「脑力守护 · Brain Protector」是一款本地化的专注力管理 Chrome 扩展。本扩展在你的浏览器内被动记录以下信息，用于在本地生成你的浏览、创作与专注统计：

- 你访问的网页的 URL、域名与页面标题
- 你在页面中处于可编辑元素时的键盘活跃状态（仅记录"是否在输入"，**不记录任何按键内容或文字内容**）
- 标签页的切换、激活、空闲等浏览器事件
- 你在扩展设置中自行填写的配置（分类规则、分心域名清单、AI 接口地址与 API Key 等）

### 二、数据存储位置

所有数据**仅存储在你本机浏览器**的 IndexedDB 与 chrome.storage 中。我们**不运营任何服务器**，**不上传、不收集、不共享**你的任何数据。

### 三、唯一的网络请求

扩展默认不发出任何网络请求。**唯一可选的联网行为**是：当你在「设置」中自行配置一个 OpenAI 兼容的 Chat Completions 接口，并主动点击「开始 AI 分析」按钮时，扩展会将本地行为指标的摘要（JSON）发送到**你自己填写的那个 API 地址**，以换取一份 Markdown 格式的分析报告。该请求的目标地址、API Key 与所有内容均由你本人完全控制；不点击则永不联网。

### 四、第三方共享

我们**不与任何第三方共享**你的数据。我们也**不出售、不转让**你的数据用于任何与本扩展核心功能无关的目的，**不用于广告、信用评估或贷款评估**等用途。

### 五、权限使用说明

本扩展申请的权限仅用于实现其核心功能：

- `tabs` / `<all_urls>`：追踪标签页切换并读取页面 URL/标题以进行本地分类计时
- `storage`：在本机保存你的配置与状态
- `idle`：检测空闲以暂停计时，避免把离开时间错误计入
- `alarms`：驱动番茄/深度专注计时器
- `notifications`：在你勾选"完成后提醒"且专注会话结束时发出系统通知
- `scripting`：动态注入专注期遮罩脚本与 SPA 路由重检脚本
- `tabGroups`：仅在你主动点击"一键应用为 Chrome 标签组"时调用

### 六、你的权利

你可以在扩展的「设置」页面中随时**导出**或**一键清空**所有本地数据。卸载扩展会自动清除其在浏览器中存储的所有数据。

### 七、联系方式

如有任何隐私相关问题，请通过 GitHub Issues 联系：
https://github.com/orange90/brainprotectorplugin/issues

---

## English Version

### 1. What We Collect

"Brain Protector" is a local-first focus management Chrome extension. It passively records the following data inside your browser to generate local browsing, creation, and focus statistics:

- URLs, domains, and page titles of the pages you visit
- Whether you are actively typing inside an editable element (only the "is typing" state; **no keystrokes or text content are ever recorded**)
- Browser events such as tab activation, switching, and idle state
- Configuration you enter yourself (category rules, distracting-domain list, AI API endpoint and key, etc.)

### 2. Where Data Is Stored

All data is stored **exclusively in your local browser** (IndexedDB and chrome.storage). We **do not operate any server**, and we **do not upload, collect, or share** any of your data.

### 3. The Only Optional Network Request

The extension makes no network requests by default. The **only optional network behavior** is: when you configure an OpenAI-compatible Chat Completions endpoint in Settings and explicitly click "Start AI Analysis", the extension sends a JSON summary of your local behavior metrics to **the API endpoint you configured yourself**, in exchange for a Markdown report. The destination, API key, and content are fully under your control. Without clicking, no network request is ever made.

### 4. Third-Party Sharing

We **do not share** your data with any third party. We **do not sell or transfer** your data for any purpose unrelated to the extension's core functionality, including but not limited to **advertising, creditworthiness, or lending**.

### 5. Permission Usage

The permissions requested by this extension are used solely to implement its core features:

- `tabs` / `<all_urls>`: track tab switches and read page URL/title for local categorization and timing
- `storage`: save your configuration and state locally
- `idle`: detect idle state to pause timing and avoid counting away-from-keyboard time
- `alarms`: drive the Pomodoro / deep-focus timers
- `notifications`: deliver a system notification when a focus session ends (only if you opt in)
- `scripting`: inject the focus-block overlay and SPA-route re-check scripts on demand
- `tabGroups`: only invoked when you actively click "Apply as Chrome Tab Groups"

### 6. Your Rights

You can **export** or **clear all local data** at any time from the extension's Settings page. Uninstalling the extension automatically removes all of its stored data from your browser.

### 7. Contact

For any privacy-related questions, please open a GitHub Issue:
https://github.com/orange90/brainprotectorplugin/issues
