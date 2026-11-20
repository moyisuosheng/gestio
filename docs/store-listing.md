# Edge Add-ons — store listing copy

Copy-paste material for the Partner Center submission. Everything below is plain text (the store
renders no markdown).

- **Privacy policy URL** (live, GitHub Pages from `main` / `docs`): `https://moyisuosheng.github.io/gestio/privacy-policy.html`
- **Support URL**: `https://github.com/moyisuosheng/gestio/issues`
- **Website**: `https://moyisuosheng.github.io/gestio/` (the repository URL also works)

---

## Metadata

| Field | Value |
| --- | --- |
| Name | `Gestio — video gesture control` |
| Short description (≤ 132 chars) | `Control any web video with swipes and long-press: speed, seek, brightness, volume. No buttons, no clutter, no tracking.` |
| Category | `Productivity` (alternative: `Entertainment`) |
| Languages | English (United States), Chinese (Simplified) |
| Search terms (≤ 7, each ≤ 30 chars) | `video gestures`, `speed control`, `brightness volume`, `player controls`, `视频手势`, `倍速`, `手势控制` |

Suggested screenshot order and captions:

1. `speed-tiers.png` — “Hold to boost, drag to tune, swipe up to lock”
2. `seek-preview.png` — “Swipe to seek with a live landing-time preview”
3. `options.png` — “Every gesture is configurable, in English or Chinese”
4. `guide.png` — “A built-in cheat sheet, in your language”
5. `quick-panel.png` — “Quick toggles one click away”

Store logo: `docs/screenshots/logo-300.png` (300×300).
Optional tiles: `promo-440x280.png`, `promo-1400x560.png`.

---

## English description

```
Gestio puts the playback controls back under your thumb.

Any page that plays an HTML5 video gets a full gesture layer: swipe, hold and tap on the video
instead of aiming for a tiny button at the bottom of a mobile player.

WHAT YOU CAN DO
• Long press — boost playback speed. Drag left/right to tune it, swipe up to lock the speed, swipe
  down to drop back to the rate you had before.
• Horizontal swipe — seek, with a preview card showing exactly where you will land. Swipe down to
  cancel before letting go.
• Vertical swipe — left half adjusts brightness, right half adjusts volume, each with an on-screen
  bar that does not cover the picture.
• Double tap — back 10 s / play-pause / forward 10 s. Repeated taps accumulate (20 s, 30 s, …).
• Two-finger tap — lock brightness or volume independently, so a stray swipe cannot move it.
• Alt + scroll — step through a video without moving the pointer back over it.
• A-B loop — an on-screen panel plus editable keyboard shortcuts.
• Lock button — a full-screen touch guard for pocket mode, with play and skip still available.

BUILT FOR PHONES, FINE ON DESKTOPS
Gestures work with touch, pen and mouse. One-handed mode re-maps the zones (right, left or custom),
the grid can be 3×1 or 3×2, and the gesture area height is adjustable — useful on tall phones where
the top of the video is out of reach.

YOUR SETTINGS, YOUR CHOICE
Every gesture can be switched off, re-mapped or tuned: axis-lock thresholds, seek sensitivity, speed
tiers, indicator size and position, per-site rules. Interface language follows your browser or can be
pinned to English or Chinese.

PRIVATE BY DESIGN
• No network requests at all — the extension never contacts a server.
• No analytics, no accounts, no advertising, no third-party code.
• Settings live in your browser profile and nowhere else.
• The only page access it needs is to find the <video> element and read pointer events.

OPEN SOURCE
MIT licensed, source on GitHub. Read every line before you install it if you like.

NOTES
Gestures run on real web pages (http/https). A downloaded file opened in the browser's own player
(content://) or a file:// page cannot be scripted by any extension; play the video from a web page
instead. Video inside a cross-origin iframe is not covered.
```

---

## 中文描述

```
Gestio 把播放控制键还给你的拇指。

任何渲染 HTML5 视频的网页都会多出一层手势：在画面上滑、长按、双击，而不是去点手机播放器底部
那个十几像素的小按钮。

能做什么
• 长按 —— 提升倍速。左右拖动调档，上滑锁定当前倍速，下滑回到锁定前的速率。
• 横滑 —— 拖动进度，预览卡会显示落点时间；不想跳了就往下一滑取消。
• 竖滑 —— 左半屏调亮度、右半屏调音量，指示条贴着屏幕边缘，不挡画面。
• 双击 —— 左区后退 10 秒、中区播放/暂停、右区前进 10 秒；连点可累加（20 秒、30 秒……）。
• 双指轻点 —— 分别锁定亮度或音量，锁定后误触不会改动数值。
• Alt + 滚轮 —— 不用把鼠标移回视频上方也能逐步跳转。
• A-B 循环 —— 屏幕面板操作，也可以自定义键盘快捷键。
• 锁定按钮 —— 全屏触摸护盾，防误触，锁定期间仍能播放和快进快退。

为手机设计，桌面上也好用
触摸、手写笔、鼠标都支持。单手模式可切换右手 / 左手 / 自定义分区，网格可选 3×1 或 3×2，
手势区域高度可调——大屏手机上画面顶部够不着的时候很有用。

每一项都能改
每个手势都能单独关闭、改映射或调参数：轴锁定阈值、拖进度灵敏度、倍速档位、指示条大小与位置、
按站点规则。界面语言跟随浏览器，也可以固定为中文或英文。

隐私
• 完全不联网，不向任何服务器发送数据。
• 没有统计、没有账号、没有广告、没有第三方代码。
• 设置只存在你自己的浏览器里。
• 唯一的页面访问权限，用于找到 <video> 元素并读取指针事件。

开源
MIT 协议，源码在 GitHub，装之前可以逐行读。

说明
手势只在真实网页（http/https）上生效。用浏览器自带播放器打开的本地文件（content://）或 file://
页面，任何扩展都无法注入；请从网页播放视频。跨域 iframe 里的视频不在覆盖范围内。
```

---

## Answers for the review form

**Single purpose**

> Gesture-based control of HTML5 video playback on web pages: speed, seeking, brightness and volume.

**Permission justification**

| Permission | Justification |
| --- | --- |
| `storage` | Persist the user's gesture settings locally. No data leaves the device. |
| `activeTab` | The popup controls the tab the user opened it from. |
| `tabs` | Read the active tab's URL to show whether gestures can run there and to apply user-defined per-site rules; open the options page. |
| `scripting` | After install or update, inject the gesture content script into tabs that were already open, so the user does not have to reload each one manually. |
| `host_permissions: <all_urls>` | Video players exist on arbitrary sites; the gesture layer cannot work from a fixed host list. The script only queries `<video>` elements and pointer/touch/keyboard events, and never reads or transmits page content. |

**Remote code**

> No. All code is bundled in the package; nothing is fetched or evaluated at runtime.

**Data usage**

> The extension collects no user data and makes no network requests. Settings are stored with
> `chrome.storage.local` only.

**Notes for certification (test instructions)**

```
1. Install the extension. Open any page with an HTML5 video that is a normal http(s) page, e.g.
   https://interactive-examples.mdn.mozilla.net/pages/tabbed/video.html
   or https://www.w3schools.com/html/html5_video.asp
2. Click the toolbar icon: the status line should read "Active on this page".
3. Long-press the video for ~0.6 s and drag right: a speed tier row appears at the top and the
   playback rate changes.
4. Drag horizontally over the video: a preview card shows the landing time; release to seek.
5. Drag vertically on the left half: the picture dims (brightness). On the right half: the volume bar
   appears.
6. Double-tap the left/right side of the video: it seeks back/forward 10 s.
7. Open "All settings" from the popup to see every option.

Notes: gestures are intentionally disabled on browser-internal pages, on file:// pages and in the
browser's own media player (content://) — no extension can script those. The extension makes no
network requests, so no test account is needed.
```
