# PhoneiPod

A local music player that looks like the classic iPod menu, minus the device and click wheel: just the screen, full size.

- **Your own music.** Add audio files (MP3, M4A/AAC, WAV, OGG, Opus, FLAC, WebM — whatever your browser can play) with **Add Tracks**, or drag them onto the window. They're stored on your device in IndexedDB; nothing is uploaded anywhere.
- **Library.** Browse by Artists, Albums, Songs and Recently Added. Title, artist, album, track number and cover art are read from ID3 tags. Files without tags use the filename (`Artist - Title.mp3`).
- **Now Playing.** Cover art, a seekable progress bar, previous / play-pause / next, shuffle and repeat, and lock-screen controls through the Media Session API.
- **Fully themeable.** The default accent is pastel purple. In **Settings → Theme** you can change the accent or any single color: selection gradient, selection text, background, text, arrows, title bar, play icon, battery outline / fill / low / charging, progress bar, and scroll bar. Colors marked "Accent" follow the accent color until you set them yourself. There are presets, and themes can be exported and imported as JSON.

## Running it

It's a static site with no build step. Serve the folder and open it:

```sh
npx serve .        # or: python3 -m http.server
```

On a phone, open the page and use **Add to Home Screen** to get a full-screen app that works offline.

## Controls

| Action | Touch / mouse | Keyboard |
| --- | --- | --- |
| Move selection | — | ↑ ↓ |
| Open item | Tap | Enter or → |
| Back (MENU) | Swipe right, or tap the title bar | Esc, Backspace or ← |
| Play / pause | Play button | Space (Enter on Now Playing) |
| Previous / next | Buttons | ← → on Now Playing |
| Volume | Device buttons | ↑ ↓ on Now Playing |
