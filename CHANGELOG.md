# Changelog

All notable changes to Gestio. The extension version in `manifest.json` follows this file.

## 1.0.33 — 2026-11-21

- **The Hide flag lives in sessionStorage.** It is transient view state ("not
  right now"), not a preference, so it belongs to the tab: it survives a reload
  of that tab, two tabs of the same video no longer share it, and it is gone
  when the tab closes — nothing is left on disk to accumulate. Same origin in
  the same tab still shares one store across paths, so the page stays part of
  the key. Every tucked-away page of a tab shares a single entry, showing the
  card deletes its own entry again, and nothing else is touched.
- **A page always opens not looping.** Reloading, or opening a new tab on the
  same video, used to come back already repeating the remembered segment. The
  marks are still restored (A, B and the highlighted span are exactly as they
  were); the loop itself is started by the button and by nothing else.
- **The loop button has two states.** There were three (running, paused, off),
  and a press on the running button only paused it, leaving an amber "resume"
  glyph that read as a half-selected icon. Stopping is what a lit loop button
  should do, and it now does: filled green chip while the loop runs, outlined
  neutral chip with the same ring while it does not. The marks stay, so pressing
  it again picks the same segment up. `P` (bound to the old pause) now starts
  and stops the loop like the button.

## 1.0.32 — 2026-11-21

- **Dragging the card no longer drives the player.** A drag on the A-B bar was
  also read by the page: the picture jumped to the finger, the volume and
  brightness meters appeared and the native control bar popped up. The stroke
  now stops at the window in the capture phase — press, moves, release and the
  duplicate touch stream — so nothing below the overlay sees it. A press that
  lands on the card is likewise no longer forwarded to the player.
- **Switching "A-B loop" off stops the loop.** It used to freeze the bar with
  the run state still on: turning the feature back on showed a green ring that
  looped nothing. A and B are kept, and the button comes back as "not playing".
- **The card's Hide button is per page.** Hiding it on one site (or one video)
  used to hide it everywhere, because the state was a browser-wide setting. It
  is a per-page flag now, and the popup switch reads and writes the tab it is
  showing — one page cannot silence another.
- **The A-B pair reads as one group in the popup.** The nested "A-B control
  panel" switch now sits in a card under "A-B loop", joined by a short rail,
  and it is dimmed and disabled whenever the loop above it is off (or the page
  cannot be scripted at all).

## 1.0.31 — 2026-11-21

- **The bar works in fullscreen.** The card could be on screen and dead: the
  player promotes its own overlay into the top layer after us (and on Android
  the media surface sits above the page), so the tap was delivered to something
  else and no control on the card ever saw a press. Two fixes, in order — a
  press that lands on the card while its target is not the card is taken over
  and resolved against the button rectangles, and after a fullscreen transition
  the card checks whether it is actually hit-testable and moves itself back to
  the end of the top layer if it is not. A hold is also closed on a fullscreen
  transition now: a cancelled pointer sequence used to leave the card wedged,
  so every later press was ignored.
- **Clear is a broom.** A bin, and before that an ✕, both read as "delete the
  loop" / "close the panel"; a broom says it only wipes the A and B marks.
- **Hide.** A new control after it tucks the card away without touching the
  loop, which keeps playing. The way back is a new switch in the extension
  popup ("A-B control panel"), so the card cannot be lost for good.
- The panel's start/pause control keeps working while the card is buried: a
  press the player swallowed is resolved by geometry instead of being dropped.

## 1.0.30 — 2026-11-21

- **The A-B bar only exists where there is a video.** It used to be built from
  the setting alone, so every page with A-B enabled got a floating bar — an
  article, a listing, a page whose player had not been swapped in yet. It is
  now bound to a real player and removed again when that player goes away.
- **It can be dragged anywhere, and it no longer dies on the first frame.** The
  stroke was tracked on the card itself, which is only ~226×54px: the finger
  left it within a frame or two and the moves went to the `<video>` underneath,
  so dragging felt broken (and in fullscreen, where the picture fills the
  screen, it never worked at all). The stroke is tracked on the window now, and
  the card may be moved outside the picture — the only limit is the screen.
- **Start and pause are one control.** A ring of two chasing arrows starts the
  loop, pauses it and resumes it; a play-in-circle takes over while paused. The
  separate power and pause buttons made two states look like three.
- **The clear button is a bin, not an ✕.** The cross read as "close the panel".
- **The read-out is fixed-width (`A --:--:--`, `A 0:02:00`).** B crossing ten
  minutes used to widen the label and shove the timeline sideways mid-drag.
- **Two opacity settings for the bar.** While the loop runs it fades (55% by
  default) so it stays out of the picture; when it is paused or idle it is
  drawn clearly (95%). Any hover or drag brings it back to full strength.

## 1.0.29 — 2026-11-21

- **The A-B bar has been redrawn.** It was one flat row of ten small round
  buttons with a 12px label — the times had no context, the loop window was
  invisible, and the emoji glyphs it used (`⏻ ○ ⏸ ✕`) render as tofu on some
  Android builds. It is now a two-row glass card: the loop read-out and a mini
  timeline (A/B pins plus a playhead dot, the loop window filled in) on top, and
  grouped controls below — `A − +` and `B − +` for marking and nudging each
  point, then loop on/off, pause and clear as inline SVG icons.
- **Too large in a windowed player.** The card was ~380px wide with a fixed 12px
  font and only ever shrank to 62%, so over a 640px player it covered almost
  half the picture. It is now 276px at design size, scales with the smaller of
  the player's width and height, and never grows past its design size.
- **The bar drifted right on every fullscreen toggle.** Its position was stored
  as a centre *fraction* of the player, so a narrow windowed player clamped it
  inwards while a fullscreen one did not — every trip to fullscreen slid it
  sideways, and back. The position is now an inset in pixels from the two
  nearest edges, so it is exactly where you left it at any size; positions saved
  by earlier versions are migrated.
- **The bar can be moved.** Drag it by the body or the grip; on top of a button,
  hold for a moment first (a quick tap still just taps). The card follows the
  finger without jumping its centre under it, and is kept inside the player.
- **Android popped its own control bar on every lap.** The loop jump went
  through `fastSeek()`, which snaps to the nearest keyframe — often a second or
  two *before* A. The watch loop read that as "the user seeked behind A" and
  seeked again, lap after lap; that burst of `seeking` events is what made the
  browser reveal its native progress bar (and stuttered the picture). The jump
  is now one precise seek aimed at already-buffered data, with a short settle
  window before the next lap can be detected.
- **A restored loop did not loop.** After a reload the bar came back showing A/B
  but nothing repeated until a control was touched.

## 1.0.28 — 2026-11-21

- **The "Lock button" never appeared on its own.** Turning it on only built the
  overlay *after* the popup had locked the page, so the setting named "Lock
  button" produced no button until you had already found the lock entry
  somewhere else. A small button is now pinned to the corner of the video
  while the feature is on: tap it to lock, and the overlay's own button unlocks.
- **"Lock button position" did nothing unless Preferred hand was Custom.** The
  resolver returned the hand mode for that key unconditionally, silently
  overwriting whatever the options page had stored — the selector was dead on
  every Right / Left preset. It now honours an explicit choice and adds an
  **Auto** value (the new default) that follows the preferred hand.
- **Lock button settings were split across two tabs.** Position lived under
  *One-handed*, the on/off switch and the size under *A-B loop & lock*. All
  three now sit together in **Playback lock**.
- **One-handed tab is easier to read.** Preferred hand / grid descriptions say
  what actually changes; the height slider explains that 100% is the whole
  player; and the six zone actions are disabled with an explanatory note unless
  *Custom* is selected (in the presets they are mirrored for you, so editing
  them changed nothing).

## 1.0.27 — 2026-11-20

- **Long press → swipe up/down (lock / release speed) did nothing on a windowed
  player once *Vertical swipes* was anything other than "everywhere".** A
  windowed player keeps `touch-action: pan-y` so a normal vertical swipe can
  still scroll the page, which means the browser is free to start panning the
  moment the finger moves. The hold only cancelled the default once it reached
  the 40px lock distance — by then the page had already started scrolling and
  the browser had fired `pointercancel`/`touchcancel`, so the stroke was dead
  and the up-swipe never locked anything (the release down-swipe had the same
  fate). A speed hold now owns the stroke from its first move: the default is
  cancelled immediately, and the duplicate `touchmove` stream is cancelled too —
  `preventDefault` on `pointermove` cannot stop a touch scroll. A swipe that is
  *not* a hold is untouched, so the page still scrolls normally.

## 1.0.26 — 2026-11-20

- **The two lock switches are now a starting state, as the card claims.** They
  were meant to be the initial lock for a new page, but the content script also
  wrote them back on every two-finger tap: locking brightness in one tab made
  every *later* tab start locked, while tabs already open kept their old state —
  neither global nor per page, and the settings page showed whatever the last tap
  happened to set. Now each page snapshots `lockVerticalSwipe` /
  `lockVerticalTarget` at boot and then owns a private copy, so a tap changes
  only the page you are on and never rewrites what the next page starts from.
  The two switches were renamed (*Brightness/Volume locked by default*) and the
  card subtitle/note reworded to say "starting state for a new page".

## 1.0.25 — 2026-11-20

- **Accumulating double taps were wrong twice over.** With *Accumulate taps* on,
  the first pair already jumped `2 × step` (the tap counter was seeded at 1 and
  then incremented), and the record was reset after every pair, so a burst could
  never grow: every burst jumped +20s / −20s with the base set to 10s. Now a
  burst counts taps (2 taps = one step, 3 = two steps…) and the seek is applied
  **once, when the burst ends** — seeking on every tap would add the same
  distance twice (3 taps: +10 then +20 = +30 while the hint says +20). The hint
  shows the running total while the burst is open.
- Settings layout: in the stacked (≤760px) layout the cards no longer take their
  width from the panel's own content. `.layout` aligns items to the start, so in
  column mode `main` shrank to max-content and *A-B loop* / *Advanced* rendered
  narrower cards than the other panels; `main` now spans the column.
- Lock wording: the two lock switches describe what actually happens — the state
  belongs to the video you are on, and changing it here leaves the pages you
  already have open alone (it is not mirrored into them). The card note no
  longer claims "every page".

## 1.0.24 — 2026-11-19

- Settings layout: **Play while paused (gesture preview)** moved from
  *Feedback & compatibility* to **Long press & speed**, right under the
  long-press switch it mostly affects. Same key, same default, no behaviour
  change — only the place you find it. The card note and the *Feedback &
  compatibility* subtitle were reworded so neither points at the old location.

## 1.0.23 — 2026-11-19

- Wording only: the two playback-related switches were too easy to confuse.
  "Long press for speed" now says it raises the playback speed and explicitly
  that it does not start a paused video, and the card carries a note pointing at
  the other switch (turning *this* one off removes the long-press gesture
  outright, so a hold-then-release becomes a plain tap and the player's own
  play/pause takes over — not a regression).
- The preview switch is now "Play while paused (gesture preview)", which names
  the state instead of repeating "gesture".

## 1.0.22 — 2026-11-19

- **Gestures no longer start a paused video.** Long press (speed) and swipe
  (seek) used to call `play()` at the start of the stroke and `pause()` on
  release, so the speed change was visible on a moving picture. On a paused
  element that reads as a glitch: the picture moves under the finger for no
  reason and stops again on release. The rate / seek target is
  applied either way, so it takes effect the moment playback resumes.
  New switch under *Feedback & compatibility* → **Play a paused video while
  gesturing** (off by default) restores the old preview behaviour.
- Volume / brightness swipes already behaved this way since 1.0.20; the whole
  gesture set is now consistent.

## 1.0.21 — 2026-11-19

- The volume / brightness meter no longer changes width when the number gains a
  digit: `99%` -> `100%` widened the card by ~1.4px and nudged it sideways. The
  label now has a fixed 34px box (wide enough for a boosted `600%`), so the card
  stays put from `0%` all the way through the boost range.

## 1.0.20 — 2026-11-19

- Volume and brightness now have their own on-video meter: brightness on the left
  edge, volume on the right, each with a percentage. With volume boost on, the
  volume bar fills towards the boosted maximum and a notch marks plain 100%.
  `sideBarWidth` / `sideBarMargin` / `sideBarHeightRatio` now size that meter.
- The whole on-video UI is laid out inside the video while windowed instead of
  across the viewport, and follows the page when it scrolls. The playback-lock
  veil and the A-B panel are clamped to the video the same way.
- **Windowed vertical swipes no longer steal the page scroll.** New setting
  "Windowed playback → Vertical swipes": `Fullscreen only` (default — the page
  scrolls normally), `Edges only` (only from the video's side lanes) or
  `Everywhere`. Desktop is unaffected, since a mouse drag cannot scroll a page.
- A volume / brightness swipe no longer starts a paused video: nothing is played
  for a slider move, so there is no more "it plays while I swipe and pauses when
  I let go".
- Settings: the brightness / volume lock switches are described as the live,
  saved state they are — the same switches the two-finger tap flips — instead of
  sounding like a per-load default.

## 1.0.19 — 2026-11-19

- **Volume boost is now off by default.** Swiping up stops at 100% and no `AudioContext` is created
  at all, because routing a `<video>` through Web Audio is irreversible for that element and some
  players react badly to it. Opt in from Settings → Volume when you need it.
- Default changes are now migrated once, keyed on the previous version. The 1.0.11 gesture-shield
  migration used to re-run on every update and would silently re-enable a shield the user had
  turned off.

## 1.0.18 — 2026-11-19

- Internal identifiers (storage keys, DOM markers, click-replay flag) moved to the `gestio_*`
  namespace. Settings therefore start from defaults once after this update.
- Source tree consolidated under a single repository root.

## 1.0.17 — 2026-11-19

- Renamed to **Gestio** (display name, page titles, store metadata, package names). Extension ID
  unchanged, so this installs as an update.

## 1.0.16 — 2026-11-18

- UI language resolved once and cached: losing the extension context no longer flips on-video hints
  to English until the page is reloaded.
- Quick panel: fixed a race where it could render before settings arrived, sticky action bar, and
  explicit messages for `content://` and `file://` pages, which cannot be scripted.

## 1.0.15 — 2026-11-18

- Quick panel: "All settings" is now clickable the moment the panel opens; it also closes the
  Android popup drawer behind it.

## 1.0.14 — 2026-11-18

- Downloaded videos opened in the browser's own player are detected and explained instead of
  appearing broken.

## 1.0.13 — 2026-11-18

- Volume: the Web Audio chain is created lazily and the limiter is only inserted above 100%. At
  unity gain the compressor still removed ~18 dB of dynamics, which is what made the sound change
  after any volume swipe.
- Boost level is cached per element, so the first swipe after boosting no longer snaps back to 100%.

## 1.0.12 — 2026-11-18

- Speed lock is a single source of truth: re-holding tunes from the locked value, dragging while
  locked updates the lock, and swiping down restores the pre-lock rate (a site already playing at
  1.25× no longer drops to 1×).

## 1.0.11 — 2026-11-18

- Gesture shield on by default, with a one-time migration for existing profiles.
- Cheat sheet: the language bootstrap moved out of an inline `<script>`, which MV3's default CSP
  silently discards — the root cause of it staying English.
- Cheat sheet reads a synchronous `localStorage` cache, so it paints in the right language on the
  first frame.

## 1.0.10 — 2026-11-18

- Single tap is no longer swallowed: click suppression keys off `claimed` (axis locked / long press /
  speed drag) instead of a velocity threshold, so finger jitter no longer looks like a gesture.
- Desktop: clicks that arrive while a double-tap is still possible are replayed instead of dropped.

## 1.0.9 — 2026-11-18

- Cheat sheet: an explicit language is no longer overwritten by a late `auto` reply from a waking
  service worker.
- Two-finger tap rewritten as a chord state machine: either finger lifting settles it, 900 ms
  window, lenient hit test (midpoint or either finger), three fingers ignored.

## 1.0.8 — 2026-11-17

- Cheat sheet follows the UI language, reading `chrome.storage.local` and falling back to a message
  when the background worker has been reclaimed.

## 1.0.7 — 2026-11-17

- Mobile settings layout: brightness and volume locks are independent per half, sliders use the full
  row, ratios are edited as percentages, and the tab strip scrolls the active tab into view.

## 1.0.0 — 2026-11-15

- First working build: long-press speed, swipe seek, vertical brightness/volume, double-tap zones,
  options page, cheat sheet.
