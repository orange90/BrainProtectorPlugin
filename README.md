# 🧠 脑力守护 · Brain Protector

> 一款接管 Chrome 新标签页的专注守护扩展：实时追踪所有网站的**浏览 / 创作时间**，对知乎做**深度话题感知**，并内置**番茄专注计时、有害行为自检、认知负荷分析与实时建议**，守护你的大脑免受碎片化分心。

所有数据完全保存在本地 IndexedDB，**绝不上传任何服务器**。

---

## ✨ 功能一览

| 模块 | 说明 |
|------|------|
| 🆕 新标签页仪表盘 | 接管 `newtab`，打开即见今日浏览/创作总览、知乎话题分析、专注工具 |
| ⏱️ 通用计时 | 域名级浏览时间，按 Tab 切换 / 页面导航 / 窗口失焦 / 空闲（5 分钟）自动启停 |
| ✍️ 创作检测 | 焦点落在可编辑元素 + 持续键盘输入 = 创作时间，与浏览时间分开记录 |
| 🔍 知乎深度感知 | 问题页 / 话题页读取官方标签；首页 Feed 用双 Observer 测停留并动态归类；Draft.js 答题编辑器创作检测 |
| 🏷️ 分类规则引擎 | 关键词匹配（标签优先 → 标题兜底），可在设置页自定义分类、颜色、超时阈值 |
| 📊 完整报表 | 网站排行、分类占比、知乎话题排行、创作详情、近 7 天趋势 |
| 🍅 专注计时器 | 番茄 25m / 深度 90m / 自定义，倒计时归零自动弹窗提醒（含提示音；后台标签页则发系统通知），完成自动记入专注会话 |
| ⚠️ 有害行为自检 | 8 项分心行为打勾，联动认知负荷与实时建议 |
| 🧩 认知负荷 | 任务切换损耗、工作记忆压力、注意力恢复成本、前额叶疲劳实时量化 |

---

## 📦 安装

### 方式一：下载 Release（推荐）
1. 前往 [Releases](../../releases) 下载最新 `brain-protector-vX.Y.Z.zip` 并解压
2. 打开 `chrome://extensions`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹
4. 打开任意新标签页，即见仪表盘

### 方式二：从源码加载
```bash
git clone https://github.com/orange90/brainprotectorplugin.git
cd brainprotectorplugin
python3 icons/gen_icons.py   # 生成图标（首次）
```
在 `chrome://extensions` 中「加载已解压的扩展程序」，直接选择项目根目录即可。

---

## 🛠️ 开发与打包

```
browser-time-tracker/
├── manifest.json              # MV3 配置
├── background.js              # Service Worker：计时主逻辑 + 状态机
├── src/
│   ├── db.js                 # 共享 IndexedDB 数据层
│   └── categorize.js         # 分类规则引擎（共享）
├── content-scripts/
│   ├── content-general.js    # 通用层：注入所有网站
│   └── sites/zhihu.js        # 知乎深度感知层
├── newtab/                   # 新标签页仪表盘
├── dashboard/                # 完整报表页（也是工具栏弹窗）
├── options/                  # 分类规则编辑器 + 数据管理
├── rules/                    # 默认分类与域名分组
├── icons/                    # 图标 + 生成脚本
└── scripts/build.sh          # 打包为 zip
```

打包：
```bash
bash scripts/build.sh          # 产出 dist/brain-protector-v<version>.zip
```

---

## 🏗️ 架构

三层互不干扰：

1. **新标签页 Dashboard** — 从 IndexedDB 读取并渲染今日数据 + 专注工具
2. **通用层**（所有网站）— 域名级计时、创作状态检测
3. **深度感知层**（特定网站，插件式）— 知乎话题标签、Feed 卡片、编辑器创作时间

时间分为三种互斥状态：**浏览**（页面激活未创作）、**创作**（持续键盘输入）、**空闲**（离开 ≥5 分钟，不计入）。同一页面内浏览段与创作段作为独立条目分开存储。

### 数据条目
```js
{
  id, url, title, domain, site_group, category,
  tags: [], content_type: "question|topic|article|feed|page",
  time_type: "browsing|creating",
  start_at, duration_seconds, source: "deep|general", day
}
```

---

## 🔒 隐私

- 仅使用 `tabs`、`storage`、`idle`、`scripting`、`notifications` 权限与 `<all_urls>` 以读取页面标题/标签做计时、在专注结束时发出提醒
- 所有记录写入本地 IndexedDB，可在设置页一键**导出**或**清空**
- 无任何网络请求、无遥测、无服务器

---

## 📋 发布新版本

更新 `manifest.json` 的 `version`，提交后打 tag：
```bash
git tag v1.0.0 && git push origin v1.0.0
```
`.github/workflows/release.yml` 会自动打包并创建带 zip 附件的 GitHub Release。
