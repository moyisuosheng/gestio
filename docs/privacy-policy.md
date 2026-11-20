# Privacy policy — Gestio

_Last updated: 19 November 2026_

Gestio is a browser extension that adds touch, mouse and keyboard gestures to HTML5 video played in
a web page. This policy explains exactly what the extension can access and what it does with it.

## Short version

- **No data is collected.**
- **No data leaves your device.** The extension makes no network requests at all.
- **No accounts, no analytics, no advertising, no third-party services.**
- Your settings are stored in your own browser profile.

## What the extension stores

Settings you change (gesture sensitivity, speed values, language, per-site rules, and so on) are
saved with `chrome.storage.local`, which lives inside your browser profile on your device. They are
never transmitted. Removing the extension, or clearing the extension's data, deletes them.

The extension also writes a small language cache and a per-tab lock state through the same
browser-local storage APIs. These exist so the UI can paint in the right language before any
asynchronous call returns, and they never leave the device.

## What the extension reads

- **The page you are on**, only to locate an HTML5 `<video>` element and to observe pointer, touch
  and keyboard events in order to recognise gestures. Element geometry (position and size) is read
  to place the on-screen indicators; page content, text, form values and media are not read,
  stored or transmitted.
- **The current tab's URL**, when you open the popup or the options page, to show whether gestures
  can run on that page and to match your per-site rules (domain names you entered yourself).

## Permissions and why they exist

| Permission | Purpose |
| --- | --- |
| `storage` | Save your settings locally |
| `activeTab` | Let the popup act on the tab you opened it from |
| `tabs` | Read the current tab's URL for the per-site rules and status line; open the options page |
| `scripting` | Re-inject the gesture script into tabs that were already open when the extension was installed or updated |
| `<all_urls>` | The gesture layer must work on any website that plays video; it is not limited to a list of known sites |

## Remote code

The extension contains no remote code. All scripts are bundled in the package and executed as
shipped. Nothing is fetched, evaluated or injected from the network.

## Children

The extension is a general-purpose media control tool. It does not collect personal information
from anyone, including children.

## Changes

If this policy ever changes, the new version will be published at this URL and the extension's
changelog will note it.

## Contact

Questions about this policy: open an issue at
[github.com/moyisuosheng/gestio/issues](https://github.com/moyisuosheng/gestio/issues).

---

## 中文说明

Gestio 是一个给网页视频加触摸 / 鼠标 / 键盘手势的浏览器扩展。

- **不收集任何数据。**
- **数据不出本机。** 扩展不发起任何网络请求。
- **没有账号、没有统计、没有广告、没有第三方服务。**
- 你改的设置（手势灵敏度、倍速、界面语言、按站点规则等）只保存在你自己浏览器的
  `chrome.storage.local` 里，卸载扩展或清除扩展数据即被删除。
- 扩展只读取当前页面里的 `<video>` 元素及其位置尺寸，用于识别手势和摆放指示条；
  不读取、不保存、不发送页面文字、表单内容或媒体数据。
- 打开弹窗或设置页时会读取当前标签页地址，用来显示"此页面是否可用"并匹配你自己填写的站点规则。

权限：`storage` 保存设置；`activeTab` 让弹窗作用于当前标签页；`tabs` 读取当前地址并打开设置页；
`scripting` 在安装/升级后向已打开的标签页补注入脚本；`<all_urls>` 因为任何播放视频的网页都要支持。

扩展内**没有任何远程代码**，全部脚本随安装包一起分发。

有问题请到 [GitHub Issues](https://github.com/moyisuosheng/gestio/issues) 反馈。
