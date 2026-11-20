/*
 * Gestio — shared UI dictionary for extension pages
 * (options.html, popup.html, guide.html).
 *
 * Translation strategy: English source strings are the keys; the ZH map
 * provides their Simplified Chinese equivalents. T(en, lang) returns the
 * translated string only when the effective language is Chinese, otherwise
 * it returns the original English — so the English UI is always intact.
 *
 * Effective language:
 *   "auto"   -> follow the browser UI language (chrome.i18n.getUILanguage)
 *   "zh_CN"  -> force Chinese
 *   "en"     -> force English
 */
(function (global) {
  "use strict";

  const ZH = {
    /* ---- general ---- */
    "Basics": "基础",
    "Master switch and interface language.": "主开关与界面语言。",
    "Brightness & volume lock": "亮度与音量锁定",
    "The starting state for a new page. After that, two fingers on the video toggle one slider at a time — the half they land on decides which — and every page keeps its own.":
      "这里设定新页面的初始状态；之后双指在视频上轻点可逐个滑条开关锁定，落点在哪半屏就锁哪个，且每个页面各自独立。",
    "Left half = brightness · Right half = volume · Tap the same half again to release that slider.":
      "左半屏 = 亮度，右半屏 = 音量；在同一半屏再点一次即解除该滑条的锁定。",
    "Feedback & compatibility": "反馈与兼容",
    "Touch feedback and how the page's own player events are handled.": "触觉反馈，以及如何处理网页播放器自身的事件。",
    "Pick which slider a two-finger tap protects. Seek and speed gestures keep working either way.": "选择双指轻点要保护哪个滑条；进度跳转与长按倍速始终不受影响。",
    "Gesture control": "手势控制",
    "Master switch — enable gesture control on videos.": "主开关——在视频上启用手势控制。",
    "Gesture shield": "手势护盾",
    "Block the page's own touch events on the player to avoid conflicts.": "拦截播放器上网页自身的触摸事件，避免冲突。",
    "Native event blocking": "原生事件拦截",
    "Play while paused (gesture preview)": "暂停时也播放（手势预览）",
    "Off (default): a gesture on a paused video only changes the value — nothing starts playing. On: the video runs during the stroke so a speed / seek change is visible, then pauses again on release.":
      "关闭（默认）：暂停时手势只改变数值，不会开始播放。开启：手势期间让视频跑起来，便于看到倍速 / 跳转的效果，松手后恢复暂停。",
    "Stronger event blocking for stubborn players (global; see Advanced for per-site).": "针对顽固播放器的更强事件拦截（全局；按站点见“高级”）。",
    "Stronger blocking for stubborn players (global; per-site in Advanced).": "针对顽固播放器的更强拦截（全局；按站点可在“高级”中设置）。",
    "Haptic feedback": "触觉反馈",
    "Subtle vibration when a gesture triggers (mobile).": "手势触发时的轻微振动（移动端）。",
    "First-run guide": "首次运行引导",
    "Show the one-handed setup guide on first run.": "首次运行时显示单手设置引导。",
    "Interface language": "界面语言",
    "Language for this page and the on-video messages.": "本界面与视频上提示消息所使用的语言。",
    "Auto": "跟随浏览器",
    "English": "英语",
    "中文": "中文",

    /* ---- long press & speed ---- */
    "Long press for speed": "长按倍速",
    "Hold on the video to temporarily raise the playback speed (it does not start a paused video).":
      "长按视频即可临时提高播放倍速（不会让暂停的视频开始播放）。",
    "Turning this off removes the long-press gesture entirely: a hold-then-release becomes a normal tap, so the player itself toggles play/pause. To keep the speed gesture but stop a paused video from starting, leave it on and turn off Play while paused (gesture preview) above.":
      "关闭后长按手势整体失效：按住再抬起会被当作一次普通点击，由播放器自己切换播放/暂停。若想保留长按加速、只是不让暂停的视频动起来，请保持开启，并关闭上方的「暂停时也播放（手势预览）」。",
    "Long-press speed": "长按倍速值",
    "Playback speed while holding.": "长按期间的播放速度。",
    "Speed adjust step": "调速步长",
    "Drag sensitivity (px per tier)": "拖动灵敏度（像素/档）",
    "Step size when dragging to adjust speed.": "拖动调速时每次变化的步长。",
    "Long-press delay (ms)": "长按延迟（毫秒）",
    "Hold time before speed kicks in (desktop).": "触发倍速前的按住时长（桌面端）。",
    "Long-press delay on mobile (ms)": "移动端长按延迟（毫秒）",
    "Hold time on touch devices.": "触摸设备上的按住时长。",
    "Swipe up to lock speed": "上滑锁定倍速",
    "After a long press, swipe up to pin the current speed.": "长按后向上滑动可固定当前倍速。",
    "Lock swipe distance (px)": "锁定滑动距离（像素）",
    "Vertical travel needed for the lock gesture.": "锁定手势所需的垂直滑动距离。",
    "Drag to adjust speed": "拖动调速",
    "Long-press then drag left/right to fine-tune speed.": "长按后左右拖动可精细调整倍速。",
    "Keep tuning a locked speed": "锁定时仍可继续调速",
    "Long-press again while the speed is locked to re-tune it; the new value stays locked.": "倍速锁定后再次长按仍可左右拖动调速，松手后按新倍速保持锁定。",
    "Higher = finer control: how far the finger travels to move one speed tier.": "数值越大越精细：手指移动多少像素才跳动一个倍速档。",
    "Drag deadzone (px)": "拖动死区（像素）",
    "Ignore small movements while dragging speed.": "调速拖动时忽略的微小位移。",
    "Drag direction ratio": "拖动方向比",
    "How dominant horizontal movement must be.": "水平方向位移需要达到的优势比例。",

    /* ---- swipe seek ---- */
    "Swipe to seek": "滑动跳转",
    "Swipe horizontally to seek backward / forward.": "水平滑动可快退 / 快进。",
    "Swipe sensitivity (px)": "滑动灵敏度（像素）",
    "Lower = seeks faster for the same travel.": "数值越小，相同距离跳转越快。",
    "Max seek per swipe": "单次最大跳转比例",
    "Maximum fraction of the video one swipe can jump.": "一次滑动最多可跳转的视频比例。",
    "Velocity boost": "速度增益",
    "A fast flick seeks further than a slow drag.": "快速轻扫比慢速拖动跳转更远。",
    "Flick sensitivity": "轻扫灵敏度",
    "Speed above which a flick multiplier applies.": "超过该速度时启用轻扫倍率。",
    "Flick smoothing": "轻扫平滑",
    "Smoothing for velocity measurement.": "速度测量的平滑系数。",
    "Unlimited swipe range": "不限滑动幅度",
    "One swipe can span the whole video. Turn off to cap each swipe at ±10s.": "一次滑动可跨越整个视频；关闭后每次最多只跳 ±10 秒。",
    "Cancel swipe distance (px)": "取消滑动距离（像素）",
    "Swipe down this far to cancel a seek.": "向下滑动该距离可取消跳转。",
    "Time preview": "时间预览",
    "Show the target time while seeking.": "跳转时显示目标时间。",
    "Show the target time and position while seeking.": "跳转时显示目标时间与进度位置。",

    /* ---- brightness / volume lock ---- */
    "Two-finger lock": "双指锁定",
    "Two fingers tapped on the video turn the lock for that half on and off.":
      "双指在视频上轻点，按落点所在半屏开关对应滑条的锁定。",
    "Brightness locked by default": "默认锁定亮度",
    "Vertical swipes stop changing the picture brightness.": "竖滑不再改变画面亮度。",
    "A newly opened page starts with brightness swipes locked. After that each page keeps its own state — the two-finger tap changes only the page you are on.":
      "新打开的页面初始即锁定亮度竖滑；之后每个页面各自保持自己的状态，双指轻点只改变当前页面。",
    "Volume locked by default": "默认锁定音量",
    "Vertical swipes stop changing the volume.": "竖滑不再改变音量。",
    "A newly opened page starts with volume swipes locked. After that each page keeps its own state — the two-finger tap changes only the page you are on.":
      "新打开的页面初始即锁定音量竖滑；之后每个页面各自保持自己的状态，双指轻点只改变当前页面。",
    "Left half = brightness · Right half = volume · Tap the same half again to release that slider. The two switches above are only the starting state: a page you already have open keeps its own lock, and a two-finger tap there never changes this setting.":
      "左半屏 = 亮度，右半屏 = 音量；在同一半屏再点一次即解除该滑条的锁定。上方两个开关只是新页面的初始状态：已经打开的页面各自保持自己的锁定，双指轻点也不会改变这里的设置。",

    /* ---- windowed playback ---- */
    "Windowed playback": "非全屏播放",
    "Where vertical volume / brightness swipes are allowed when the video is not fullscreen. Horizontal seek, double tap and long press keep working.":
      "视频未全屏时，音量 / 亮度的竖滑在什么范围内生效。水平滑动跳转、双击与长按始终不受影响。",
    "Vertical swipes": "竖滑生效范围",
    "Where volume / brightness swipes work when the video is not fullscreen. The rest of the page keeps scrolling either way.":
      "未全屏时音量 / 亮度竖滑的生效范围；范围之外的竖滑会正常滚动页面。",
    "Fullscreen only": "仅全屏",
    "Edges only": "仅左右边缘",
    "Everywhere": "任意位置",

    /* ---- double tap & wheel ---- */
    "Double tap": "双击",
    "Enable zone-based double-tap actions.": "启用分区双击动作。",
    "Double-tap interval (ms)": "双击间隔（毫秒）",
    "Max gap between the two taps.": "两次点击之间的最大间隔。",
    "Seek duration": "跳转时长",
    "Seconds jumped per double tap.": "每次双击跳转的秒数。",
    "Accumulate taps": "连击累加",
    "Repeated taps in the same zone add up, and the jump is applied once the burst ends (3rd tap = 20s, 4th = 30s…).":
      "同一区域连续轻点会累加，等连击结束后一次性跳转（第 3 次 20 秒、第 4 次 30 秒……）。",
    "Double tap to fullscreen": "双击切换全屏",
    "Double-tapping the center toggles fullscreen.": "双击中央区域切换全屏。",
    "Alt + scroll to seek": "Alt + 滚轮跳转",
    "Hold Alt and scroll to seek.": "按住 Alt 并滚动滚轮即可跳转。",
    "Seconds per wheel step": "每格滚轮秒数",
    "Seek amount per wheel notch.": "每滚动一格跳转的秒数。",
    "Wheel debounce (ms)": "滚轮防抖（毫秒）",
    "Delay before applying accumulated wheel seek.": "应用累积滚轮跳转前的延迟。",

    /* ---- one-handed ---- */
    "Preferred hand": "惯用手",
    "Right: the default mapping. Left: the same thumb motion, mirrored. Custom: you decide what each zone does.":
      "右手：默认映射。左手：同样的拇指动作，左右镜像。自定义：每个分区做什么由你决定。",
    "Right = default mapping; Left = mirrored; Custom = use the zone actions below.": "右手=默认映射；左手=镜像；自定义=使用下方分区动作。",
    "Which hand holds the phone, and how the player is split into gesture zones. The diagram below updates as you choose.":
      "用哪只手拿手机，以及播放器如何划分手势分区。下方示意图会随选择实时更新。",
    "Grid layout": "网格布局",
    "3×1: three columns — left / center / right. 3×2: the side columns split top and bottom, so one thumb reaches six actions.":
      "3×1：左 / 中 / 右三列。3×2：左右两列再各分上下，拇指可触达六个动作。",
    "3×1: three columns. 3×2: side columns split top/bottom.": "3×1：三列。3×2：两侧列分为上 / 下。",
    "Gesture area height": "手势区域高度",
    "How much of the video height responds to gestures. 100% = the whole player; higher means less accidental swiping near the controls.":
      "视频高度中有多少区域响应手势。100% = 整个播放器；比例越高，越不容易在控件附近误触。",
    "Fraction of the video height treated as the gesture area.": "视频高度中作为手势区域的比例。",
    "Lock button position": "锁定按钮位置",
    "Which corner the button sits in. Match hand keeps it on the side of your preferred hand.": "按钮所在的角落。“随惯用手”= 跟惯用手同侧。",
    "Match hand": "随惯用手",
    "Left side": "左侧",
    "Right side": "右侧",
    "Where the lock button sits.": "锁定按钮所在的位置。",
    "What a double tap or a vertical swipe does in each zone. Editable only in Custom hand mode — the Right / Left presets mirror the zones for you.":
      "每个分区双击、上下滑分别做什么。仅在“自定义”惯用手模式下可编辑；右手 / 左手预设会自动镜像分区。",
    "Custom mode: each zone below is used exactly as set here.": "自定义模式：下方每个分区完全按此处设定生效。",
    "Right / Left presets mirror the zones automatically — switch Preferred hand to Custom to edit them.":
      "右手 / 左手预设会自动镜像分区；把“惯用手”切到“自定义”后才能逐区修改。",
    "Right": "右手",
    "Left": "左手",
    "Custom": "自定义",

    /* ---- zone actions ---- */
    "Left · double tap": "左 · 双击",
    "Center · double tap": "中 · 双击",
    "Right · double tap": "右 · 双击",
    "Left · vertical swipe": "左 · 上下滑",
    "Center · vertical swipe": "中 · 上下滑",
    "Right · vertical swipe": "右 · 上下滑",
    "None": "无",
    "Seek backward": "快退",
    "Seek forward": "快进",
    "Play / Pause": "播放 / 暂停",
    "Fullscreen": "全屏",
    "Volume": "音量",
    "Brightness": "亮度",

    /* ---- volume / brightness ---- */
    "Volume boost": "音量增强",
    "Boost beyond 100% via Web Audio (up to 600%).": "通过 Web Audio 突破 100%（最高 600%）。",
    "Max volume (%)": "最大音量（%）",
    "Upper limit for volume boost.": "音量增强的上限。",
    "Brightness min (%)": "最小亮度（%）",
    "Lowest brightness the swipe can reach.": "滑动可达到的最低亮度。",
    "Brightness max (%)": "最大亮度（%）",
    "Highest brightness the swipe can reach.": "滑动可达到的最高亮度。",
    "Side bar width (px)": "侧栏宽度（像素）",
    "Width of the volume/brightness indicator.": "音量 / 亮度指示条的宽度。",
    "Track width of the two meters.": "两个指示条的滑轨宽度（亮度在左、音量在右）。",
    "Side bar height": "侧栏高度",
    "Height of the indicator bar.": "指示条的高度。",
    "Height of each meter, as a fraction of the video.": "每个指示条的高度占视频高度的比例。",
    "Side bar margin (px)": "侧栏边距（像素）",
    "Distance from the screen edge.": "距离屏幕边缘的距离。",
    "Distance from the video edge.": "距离视频边缘的距离。",
    "Indicator fade delay (ms)": "指示条淡出延迟（毫秒）",
    "How long the bar stays visible.": "指示条保持显示的时间。",

    /* ---- A-B / lock ---- */
    "A-B loop": "A-B 循环",
    "Repeat a chosen segment; adds an on-screen control panel.": "重复选定片段；附带屏幕控制面板。",
    "A-B keyboard shortcuts": "A-B 键盘快捷键",
    "Enable the keyboard shortcuts (editable in Advanced).": "启用键盘快捷键（可在“高级”中编辑）。",
    "Panel opacity while looping": "循环播放时面板不透明度",
    "The bar fades while the loop runs, so it stays out of the picture.":
      "循环播放时面板会变淡，减少遮挡。",
    "Panel opacity when idle": "未循环时面板不透明度",
    "When the loop is paused or off the bar is drawn more clearly, because then it is a control.":
      "循环暂停或关闭时面板更清楚——此时它是操作面板。",
    "A-B control panel": "A-B 控制面板",
    "Shown over the video. Turn it off to tuck it away on this page only — the loop keeps running.":
      "显示在视频上。关闭后仅在本页临时收起，循环仍继续运行。",
    "Lock button": "锁定按钮",
    "Pin a lock button to the corner of the video. Tap it to freeze the screen against accidental touches; the same button unlocks.":
      "在视频角落常驻一个锁定按钮；点一下即可锁定画面、避免误触，再点同一位置的按钮解锁。",
    "Show a full-screen touch guard during playback.": "播放时显示全屏触控保护。",
    "Lock playback": "锁定画面",
    "Pins a lock button to the video corner — tap it to freeze the screen. Play / skip stay available while locked.":
      "在视频角落固定一个锁定按钮——点一下即可冻结画面；锁定时播放 / 跳转仍然可用。",
    "Quick menu on lock": "锁定时的快捷菜单",
    "Keep play / skip controls available while locked.": "锁定时仍保留播放 / 跳转控制。",
    "Lock button size (px)": "锁定按钮尺寸（像素）",
    "Size of the lock / unlock button.": "锁定 / 解锁按钮的尺寸。",

    /* ---- detection / JSON ---- */
    "Min video size (px)": "最小视频尺寸（像素）",
    "Ignore videos smaller than this.": "忽略小于此尺寸的视频。",
    "Min video area (px²)": "最小视频面积（像素²）",
    "Ignore very small players.": "忽略极小的播放器。",
    "Move threshold (px)": "移动阈值（像素）",
    "Movement before a gesture is recognized.": "识别为手势前需移动的距离。",
    "Axis lock threshold (px)": "轴向锁定阈值（像素）",
    "Movement before horizontal/vertical is locked.": "锁定水平 / 垂直方向前需移动的距离。",
    "Click suppression (ms)": "点击抑制（毫秒）",
    "Suppress the next click after a gesture.": "手势后抑制下一次点击的时长。",
    "A-B shortcuts (JSON)": "A-B 快捷键（JSON）",
    "Disabled domains (JSON array)": "禁用域名（JSON 数组）",
    "Per-site rules (JSON array)": "站点规则（JSON 数组）",
    "Per-site event blocking (JSON)": "站点事件拦截（JSON）",

    /* ---- static UI: options ---- */
    "Video gesture control — settings (changes save instantly)": "视频手势控制 — 设置（更改即时保存）",
    "General": "常规",
    "Gestures": "手势",
    "One-handed": "单手",
    "Volume & brightness": "音量与亮度",
    "A-B loop & lock": "A-B 循环与锁定",
    "Advanced": "高级",
    "Master switches and feedback.": "主开关与反馈。",
    "Long press & speed": "长按与倍速",
    "Hold to speed up, drag or lock the rate — and whether a paused video runs during the gesture.": "长按加速、拖动或锁定倍速，以及暂停时手势期间是否让视频跑起来。",
    "Horizontal swipe seeks; flick for extra distance.": "水平滑动跳转；轻扫可跳转更远。",
    "Double tap & wheel": "双击与滚轮",
    "Zone taps and Alt + scroll seeking.": "分区双击与 Alt + 滚轮跳转。",
    "One-handed layout": "单手布局",
    "Pick your hand and grid — the diagram updates live.": "选择惯用手与布局——示意图实时更新。",
    "Zone actions": "分区动作",
    "Only used in \"Custom\" hand mode. In Right/Left presets the zones are mirrored automatically.": "仅在“自定义”手型下使用。右手 / 左手预设下分区会自动镜像。",
    "Web Audio boost can exceed 100%.": "Web Audio 增强可超过 100%。",
    "Brightness & indicators": "亮度与指示条",
    "On-screen brightness filter and side bars.": "屏幕亮度滤镜与侧边指示条。",
    "Repeat any segment; on-screen panel and shortcuts.": "重复任意片段；含屏幕面板与快捷键。",
    "Playback lock": "播放锁定",
    "Full-screen touch guard with quick controls.": "全屏触控保护，含快捷控制。",
    "Detection & tuning": "检测与调校",
    "Video detection thresholds and gesture sensitivity.": "视频检测阈值与手势灵敏度。",
    "Site rules (JSON)": "站点规则（JSON）",
    "Invalid JSON is ignored; valid values save instantly. See the install guide for examples.": "无效 JSON 会被忽略；有效值即时保存。示例见安装说明。",
    "Reset to defaults": "恢复默认",
    "Gesture cheat sheet": "手势速查",
    "✓ Saved": "✓ 已保存",
    "Layout:": "布局：",
    "3×2 — side columns split top / bottom": "3×2 — 两侧列分上 / 下",
    "3×1 — three vertical columns": "3×1 — 三列",
    "Hand:": "惯用手：",
    "Tap = double-tap action \u00a0 ↕ = vertical swipe": "点击 = 双击动作 \u00a0 ↕ = 上下滑",
    "Mirrored automatically in Right / Left presets. Choose Custom to edit zone actions.": "右手 / 左手预设下自动镜像。选择“自定义”以编辑分区动作。",
    "Full": "全屏",
    "—": "—",
    "LEFT": "左",
    "CENTER": "中",
    "RIGHT": "右",
    "L·TOP": "左上",
    "C·TOP": "中上",
    "R·TOP": "右上",
    "L·BOT": "左下",
    "C·BOT": "中下",
    "R·BOT": "右下",
    "Saved": "已保存",
    "Save failed: ": "保存失败：",
    "Restored defaults": "已恢复默认",
    "Could not load settings: ": "加载设置失败：",

    /* ---- static UI: popup ---- */
    "Video gesture control": "视频手势控制",
    "Checking this tab…": "正在检查此标签页…",
    "Enable gestures": "启用手势",
    "Long-press speed boost": "长按倍速",
    "Double-tap actions": "双击动作",
    "Volume boost (>100%)": "音量增强（>100%）",
    "Gesture shield (anti-conflict)": "手势护盾（防冲突）",
    "Lock video": "锁定视频",
    "Unlock video": "解锁视频",
    "All settings": "全部设置",
    "Reset": "重置",
    "Open a normal web page (http/https) with a video to use gestures.": "请打开含视频的普通网页（http/https）以使用手势。",
    "Active on this page ✓ — make a gesture over the video.": "已在此页面生效 ✓ — 在视频上做手势即可。",
    "Loaded, but gestures are disabled. Turn on “Enable gestures”.": "已加载，但手势被关闭。请打开“启用手势”。",
    "Not responding. Reload the page after enabling the extension.": "无响应。启用扩展后请刷新页面。",
    "Not active here. Reload the page, then try again.": "此处未生效。请刷新页面后重试。",
    "This is the browser’s own player for local files (content://). Extensions can’t run here — play the video from an http(s) link instead.":
      "这是浏览器自带的本地文件播放页（content://），扩展无法在此运行。请改用 http(s) 链接播放该视频。",
    "Android browsers do not let extensions read local files. Play the video from an http(s) link instead.":
      "安卓浏览器不允许扩展读取本地文件。请改用 http(s) 链接播放该视频。",
    "Local files: enable “Allow access to file URLs” for this extension, then reload the page.":
      "本地文件页面：请在该扩展的详情页打开“允许访问文件网址”，然后刷新页面。",
    "Gestures only work on real web pages. Android plays a downloaded file in the browser's own player (content://), and file:// pages need file access — neither can be scripted. Play the video from an http(s) link instead.":
      "手势只作用于真正的网页。安卓会用浏览器自带的播放器打开已下载的文件（content://），file:// 页面则需要文件访问权限——这两类页面都无法注入脚本。请改用 http(s) 链接播放视频。",
    "Browser-internal pages (edge://, chrome://…) can’t be scripted. Open the video in a normal tab.":
      "浏览器内部页面（edge://、chrome:// 等）无法注入脚本。请在普通标签页中打开视频。",

    /* ---- static UI: guide ---- */
    "Gesture guide": "手势速查",
    "Gestio — gesture guide": "Gestio — 手势速查",
    "Applies to any page with an HTML5 <video> element": "适用于任何含 HTML5 <video> 元素的页面",
    "3×1 grid (default)": "3×1 网格（默认）",
    "3×2 grid (one-handed)": "3×2 网格（单手）",
    "Back": "快退",
    "Forward": "快进",
    "Play": "播放",
    "Gestures": "手势说明",
    "Left-handed mode mirrors the zones automatically. Choose ": "左手模式会自动镜像分区。在单手设置中选择",
    " in One-handed settings to assign each zone yourself.": "可自行分配每个分区的动作。",
    "Left-handed mode mirrors the zones automatically. Choose Custom in One-handed settings to assign each zone yourself.": "左手模式会自动镜像分区。在单手设置中选择“自定义”可自行分配每个分区的动作。",
    "Custom": "自定义",
    "Long press": "长按",
    "Hold to boost; drag left/right to adjust, swipe up to lock the speed. Hold again to keep tuning at the locked speed; swipe down to exit.": "长按加速；左右拖动调速，上滑锁定倍速。再次长按会在已锁定的倍速上接着调，下滑退出倍速。",
    "Horizontal swipe": "水平滑动",
    "Seek by a fraction of the video; a fast flick seeks further. Swipe down to cancel.": "按比例跳转视频；快速轻扫跳转更远。下滑取消。",
    "Seek by a fraction of the video. A preview card shows the landing time; swipe down to cancel.": "按比例跳转视频，预览卡会显示落点时间；下滑取消。",
    "Two-finger tap": "双指轻点",
    "Lock or unlock brightness & volume only — seek and long-press speed keep working.": "仅锁定/解除亮度与音量，进度跳转和长按倍速照常可用。",
    "Two fingers on the left half toggle the brightness lock, on the right half the volume lock — each half switches on its own.":
      "双指轻点左半屏开关亮度锁定，右半屏开关音量锁定——两半各自独立。",
    "Vertical swipe": "垂直滑动",
    "Left half = brightness, right half = volume (boost past 100% optional).": "左半屏=亮度，右半屏=音量（可选增强至 100% 以上）。",
    "Left half = brightness, right half = volume (boost past 100% optional). Windowed: only in fullscreen by default, so the page keeps scrolling.":
      "左半屏=亮度，右半屏=音量（可选增强至 100% 以上）。未全屏时默认只在全屏生效，页面可以正常滚动。",
    "Left zone = brightness, right zone = volume (boost past 100% optional).": "左区=亮度，右区=音量（可选增强至 100% 以上）。",
    "Double tap": "双击",
    "Left back / center play-pause / right forward. Repeated taps accumulate when enabled.": "左侧快退 / 中间播放暂停 / 右侧快进。启用后连击可累加。",
    "Alt + scroll": "Alt + 滚轮",
    "Seek step by step without leaving the cursor over the video.": "无需将光标停留在视频上即可逐步跳转。",
    "Use the on-screen panel (drag it anywhere), or <kbd>[</kbd> set A, <kbd>]</kbd> set B, <kbd>\\</kbd> clear, <kbd>P</kbd> pause, <kbd>Alt+L</kbd> toggle.":
      "用屏幕面板（可拖动到任意位置），或按 <kbd>[</kbd> 设 A、<kbd>]</kbd> 设 B、<kbd>\\</kbd> 清除、<kbd>P</kbd> 暂停、<kbd>Alt+L</kbd> 切换。",
    "Use the on-screen panel or ": "使用屏幕面板，或用 ",
    " set A, ": " 设置 A，",
    " set B, ": " 设置 B，",
    " clear, ": " 清除，",
    " pause, ": " 暂停，",
    " toggle.": " 切换。",
    "Full-screen touch guard with play / skip quick controls while locked.": "全屏触控保护，锁定时仍可用播放 / 跳转快捷控制。",
    "Lock button": "锁定按钮",
    "A-B loop": "A-B 循环"
  };

  function resolve(lang) {
    if (lang === "en" || lang === "zh_CN") return lang;
    let ui = "";
    try {
      if (global.chrome && global.chrome.i18n && global.chrome.i18n.getUILanguage) {
        ui = global.chrome.i18n.getUILanguage() || "";
      }
    } catch (_) {}
    if (!ui) { try { ui = global.navigator.language || ""; } catch (_) {} }
    return /^zh/i.test(ui) ? "zh_CN" : "en";
  }

  function T(en, lang) {
    if (resolve(lang) !== "zh_CN") return en;
    return ZH[en] || en;
  }

  // Apply translations to every element carrying data-i18n / data-i18n-html /
  // data-i18n-title. The -html variant exists for strings that embed markup
  // (keyboard chips in the shortcut description), where textContent would strip
  // the <kbd> elements.
  function apply(root, lang) {
    const doc = root || global.document;
    if (!doc) return;
    doc.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = T(el.getAttribute("data-i18n"), lang);
    });
    doc.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = T(el.getAttribute("data-i18n-html"), lang);
    });
    doc.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", T(el.getAttribute("data-i18n-title"), lang));
    });
    try { doc.documentElement.lang = resolve(lang) === "zh_CN" ? "zh-CN" : "en"; } catch (_) {}
  }

  global.VW_I18N = { ZH, resolve, T, apply };
})(typeof window !== "undefined" ? window : globalThis);
