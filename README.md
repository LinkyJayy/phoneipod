# PhoneiPod

A music player that looks like the classic iPod menu, minus the device and click wheel: just the screen, full size. Each person signs in to their own account, uploads their own audio files, and can play them from any device.

- **Accounts.** Create an account with a username and password. Your tracks, theme, and shuffle/repeat/volume settings are tied to the account and follow you between devices. Settings → Account lets you change your password (this signs out your other devices), sign out, or delete the account along with its tracks.
- **Your own music.** Add audio files (MP3, M4A/AAC, WAV, OGG, Opus, FLAC, WebM — whatever your browser can play) with **Add Tracks**, or drag them onto the window. They're uploaded to the server and streamed back, so seeking works without downloading the whole file.
- **Library.** Browse by Artists, Albums, Songs and Recently Added. Title, artist, album, track number and cover art are read from ID3 tags. Files without tags use the filename (`Artist - Title.mp3`).
- **Now Playing.** Cover art, a seekable progress bar, previous / play-pause / next, shuffle and repeat, and lock-screen controls through the Media Session API.
- **Fully themeable.** The default accent is pastel purple. In **Settings → Theme** you can change the accent or any single color: selection gradient, selection text, background, text, arrows, title bar, play icon, battery outline / fill / low / charging, progress bar, and scroll bar. Colors marked "Accent" follow the accent color until you set them yourself. There are presets, and themes can be exported and imported as JSON.

## Deploying on Railway

1. Create a new Railway project from this GitHub repo. `railway.json` sets the start command (`npm start`) and a health check at `/api/health`.
2. **Attach a volume.** Without one, every account and uploaded track is wiped on each redeploy.
   - Dashboard: right-click the project canvas (or open the ⌘K command palette), choose **Volume**, attach it to this service, and set the mount path to `/data`.
   - CLI: `railway volume add --mount-path /data`
   
   Railway sets `RAILWAY_VOLUME_MOUNT_PATH` automatically once the volume is attached, and the server stores its database and audio files there. You don't need to set any variables. If the server starts on Railway without a volume, it logs a warning.
3. Under **Settings → Networking**, generate a domain, then open it and create your account.
4. Optional: once your own accounts exist, set `ALLOW_SIGNUPS=false` so strangers can't sign up on your server.

Keep the service at **one replica**. The SQLite database and the files live on the volume, and a volume attaches to a single instance. Size the volume for your music: the uploaded files are stored as-is.

### Environment variables

All optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATA_DIR` | `RAILWAY_VOLUME_MOUNT_PATH`, else `./data` | Where the database and audio files are stored |
| `ALLOW_SIGNUPS` | `true` | Set to `false` to stop new accounts being created |
| `MAX_UPLOAD_MB` | `300` | Largest single audio file accepted |
| `USER_QUOTA_MB` | `0` (unlimited) | Total storage allowed per account |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `PORT` | `3000` | Set by Railway automatically |

## Running locally

Requires Node 22 or newer.

```sh
npm install
npm start          # http://localhost:3000, data stored in ./data
```

## How it's built

- `server/` — Express app. SQLite (`better-sqlite3`) holds users, sessions and track metadata; audio and cover art are files under `DATA_DIR/media/<user id>/`. Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie, with only a hash stored in the database. Failed sign-ins are rate limited per IP. Every track request is checked against the signed-in user.
- `public/` — the front end, plain HTML/CSS/JS with no build step. A service worker caches the app shell; API requests always go to the server.

## Controls

| Action | Touch / mouse | Keyboard |
| --- | --- | --- |
| Move selection | — | ↑ ↓ |
| Open item | Tap | Enter or → |
| Back (MENU) | Swipe right, or tap the title bar | Esc, Backspace or ← |
| Play / pause | Play button | Space (Enter on Now Playing) |
| Previous / next | Buttons | ← → on Now Playing |
| Volume | Device buttons | ↑ ↓ on Now Playing |
