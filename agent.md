# Mercari Blocklist Extension Agent Notes

## 目标

开发一个用于 Mercari Japan 的浏览器扩展，帮助用户备份和恢复拉黑用户列表。

主要使用环境：

- 桌面 Chrome：开发、调试、确认 DOM 结构。
- Android 模拟器里的 Yandex Browser：目标运行环境之一。

核心需求：

1. 在 Mercari 已登录状态下读取当前账号的拉黑用户列表。
2. 将拉黑用户缓存到扩展本地存储。
3. 支持导出/导入 JSON。
4. 换账号、换设备或重装环境后，可以按导入名单自动恢复拉黑。
5. 再次备份时做增量合并，只追加新拉黑用户，不覆盖整份名单。

## 已验证页面和 DOM 结构

### 拉黑列表页

URL:

```text
https://jp.mercari.com/mypage/personal_info/blocked_users
```

列表容器：

```js
document.querySelector('[data-testid="blocked-account-list"]')
```

被拉黑用户链接：

```js
[data-testid="blocked-account-list"] a[href^="/user/profile/"],
[data-testid="blocked-account-list"] a[href*="/user/profile/"]
```

已验证示例：

```json
{
  "id": "595874810",
  "name": "隣の佐藤さん",
  "url": "https://jp.mercari.com/user/profile/595874810",
  "imageUrl": "https://static.mercdn.net/thumb/members/webp/595874810.jpg?1596077379"
}
```

建议提取逻辑：

```js
function extractMercariBlockedUsers() {
  const list = document.querySelector('[data-testid="blocked-account-list"]');
  if (!list) return [];

  const seen = new Set();

  return [...list.querySelectorAll('a[href^="/user/profile/"], a[href*="/user/profile/"]')]
    .map((link) => {
      const url = new URL(link.getAttribute('href'), location.origin).href;
      const id = url.match(/\/user\/profile\/(\d+)/)?.[1] || '';
      const name = (link.querySelector('p')?.textContent || link.textContent || '')
        .trim()
        .replace(/\s+/g, ' ');
      const imageUrl = link.querySelector('img')?.src || '';

      return { id, name, url, imageUrl };
    })
    .filter((user) => user.id && !seen.has(user.id) && seen.add(user.id));
}
```

### 用户主页拉黑入口

用户主页 URL:

```text
https://jp.mercari.com/user/profile/{userId}
```

三点菜单按钮：

```js
document.querySelector('[data-testid="user-actions-menu-button"] button')
```

菜单展开后的拉黑按钮：

```js
[...document.querySelectorAll('[data-testid="merActionRow"] button')]
  .find((button) => button.textContent.includes('このユーザーをブロック'))
```

已拉黑状态可能出现的文本：

```text
ブロック中
ブロックを解除
```

未拉黑状态菜单项：

```text
このユーザーをブロック
```

## Yandex Android 兼容策略

Yandex Android 官方支持安装和测试自研扩展：

- 通过 `browser://extensions` 打开扩展管理页。
- 开启 Developer Mode。
- 选择 unpacked extension 的 `manifest.json`。
- 可通过桌面 Yandex 的 `browser://inspect/#devices` 调试移动端扩展页面。

但官方没有逐项承诺 Android 端完整兼容所有 `chrome.tabs` API。

因此恢复流程不要设计成“批量同时打开很多 tab”。最稳路线是：

- 只维护一个工作标签页。
- 串行处理用户列表。
- 每次通过当前 tab 跳转到一个用户主页。
- 等 DOM 元素确认出现后再执行下一步。

建议使用的 tabs API 范围：

```js
chrome.tabs.query()
chrome.tabs.update()
chrome.tabs.sendMessage()
```

尽量避免第一版依赖：

```js
chrome.tabs.create() // 大量并发开页
chrome.tabs.remove() // 大量并发关页
chrome.windows.*
多 tab 并发自动化
```

## 自动恢复流程

建议第一版使用单 tab 串行队列：

```text
导入名单
取第一个 pending 用户
跳转当前工作 tab 到用户主页
等待用户主页加载完成
等待三点菜单按钮出现
点击三点菜单
等待菜单项出现
如果已经拉黑，标记 alreadyBlocked
如果出现“このユーザーをブロック”，点击拉黑
等待状态变化或结果提示
标记 blocked 或 failed
继续下一个用户
```

恢复前不做整表覆盖。`一键拉黑` 不能只根据插件本地任务状态决定跳过，因为用户可能已经切换账号，本地的 `blocked/alreadyBlocked` 可能来自旧账号。

正确逻辑：

```text
读取插件本地缓存名单
跳转到当前登录账号的 blocked_users 页面
扫描当前账号真实已拉黑 ID
候选名单 = 本地缓存名单 - 当前账号真实已拉黑 ID
当前账号已存在的 ID 标记为 alreadyBlocked
候选名单统一重置为 pending 并进入串行拉黑流程
```

恢复过程中如果目标用户已经是拉黑状态，直接标记为 `alreadyBlocked`，不重复操作。

元素等待是允许且必要的。不要依赖固定 sleep 完成业务判断，应使用“等待条件 + 超时”的方式。

示例：

```js
async function waitForElement(selector, timeout = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const element = document.querySelector(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timeout waiting for selector: ${selector}`);
}
```

按钮文本等待：

```js
async function waitForButtonText(text, timeout = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.includes(text));
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timeout waiting for button text: ${text}`);
}
```

## 数据模型

黑名单用户：

```js
{
  id: '595874810',
  name: '隣の佐藤さん',
  url: 'https://jp.mercari.com/user/profile/595874810',
  imageUrl: 'https://static.mercdn.net/thumb/members/webp/595874810.jpg?1596077379',
  savedAt: '2026-06-08T00:00:00.000Z',
  source: 'blocked_users_page'
}
```

## 增量合并逻辑

备份和导入都使用 `id` 去重：

```text
已有缓存 + 新扫描结果 -> 按 user.id 合并
新 ID -> 追加
旧 ID -> 更新 name/imageUrl/updatedAt，保留 savedAt
```

这能支持以下场景：

```text
第一次备份 A 批拉黑用户
过一段时间用户又手动拉黑 B 批
再次扫描 blocked_users 页面
插件只把 B 批追加进去
导出时导出 A + B 的合并名单
```

恢复也按增量处理：

```text
一键拉黑先扫描当前账号 blocked_users
以“当前账号真实已拉黑 ID”排除重复
本地 blocked/alreadyBlocked 只作为显示和进度记录，不作为一键拉黑的跳过依据
pending/failed -> 在差集候选中可处理或重试
```

恢复任务项：

```js
{
  id: '595874810',
  status: 'pending',
  attempts: 0,
  lastError: '',
  updatedAt: '2026-06-08T00:00:00.000Z'
}
```

任务状态：

```text
pending
processing
blocked
alreadyBlocked
failed
skipped
```

失败原因：

```text
profile_not_found
menu_not_found
block_button_not_found
confirm_failed
timeout
unknown
```

## 推荐扩展结构

```text
manifest.json
background.js
content.js
popup.html
popup.js
options.html
options.js
storage.js
```

职责：

```text
content.js
识别 Mercari 页面类型，抓取拉黑列表，执行用户页菜单点击和状态判断。

background.js
维护恢复队列，控制当前工作 tab 跳转，和 content script 通信。

popup.js / popup.html
提供快捷状态、开始/暂停恢复、当前进度入口。

options.js / options.html
管理黑名单，导入 JSON，导出 JSON，重试失败项。

storage.js
封装 chrome.storage.local 的读写、去重、状态更新。
```

## 第一版范围

第一版只做稳的主链路：

- 从 blocked users 页面自动抓取黑名单。
- 保存到 `chrome.storage.local`。
- 支持 JSON 导出。
- 支持 JSON 导入。
- 单 tab 串行恢复拉黑。
- 失败项可重试。
- Mercari 页面内注入移动端悬浮球，作为 Yandex Android 的主要控制入口。

## 移动端页面内控制面板

Yandex Android 或雷电模拟器小窗口里，不应依赖扩展 popup 作为主入口。content script 需要在 Mercari 页面注入一个悬浮球。

用户打开 Mercari 任意页面后：

```text
content script 自动注入悬浮球
点击悬浮球
页面底部打开抽屉式控制面板
```

面板交互：

```text
顶部有拖拽条
向上拖 -> 面板变高
向下拖 -> 面板变矮
松手后吸附到 mini / normal / large 三档高度
面板打开状态和高度档位都保存到 chrome.storage.local
```

面板保留分步按钮，但日常使用入口应突出两个一键按钮：

```text
一键采集
  自动跳转 blocked_users 页面，等待加载，执行采集，增量合并本地缓存

一键拉黑
  启动批量拉黑队列，从本地缓存名单里取 pending/failed 用户，单 tab 串行处理
```

分步按钮：

```text
跳转到拉黑界面
  跳转到 https://jp.mercari.com/mypage/personal_info/blocked_users

批量拉黑
  从本地缓存名单里取 pending/failed 用户，单 tab 串行进入用户主页并拉黑

采集拉黑数据
  只在 blocked_users 页面执行扫描，将当前页面拉黑用户增量合并到本地缓存
```

辅助信息和操作：

```text
显示名单总数、完成数、失败数
显示当前队列状态
暂停
查看进度/刷新
数据管理
  点击后显示四个选择：导出 JSON、复制 JSON、导入 JSON、粘贴导入
  复制失败时显示 JSON 文本框作为手动复制兜底
  文件导入失败或不方便时，可打开粘贴导入文本框导入 JSON
```

第一版暂不做：

- 云同步。
- 多 tab 并发。
- 网络接口拦截。
- 直接调用 Mercari 内部 API。
- 复杂窗口管理。

## 关键原则

1. 优先使用稳定语义选择器，例如 `data-testid` 和 URL 结构。
2. 不依赖 hash class，例如 `sc-xxx`、`content__xxxx`。
3. 所有自动点击前必须确认页面、用户 ID、目标按钮文本。
4. 每一步都要有 timeout 和失败记录。
5. Yandex Android 上优先单 tab 串行，避免移动端 tabs API 差异。
6. JSON 导入导出是跨设备主链路，浏览器同步只能作为后续增强。
