# PinoyTV - Premium IPTV Entertainment Platform

A mystical, enchanted IPTV streaming platform with a unique dual-book authentication system, comprehensive admin controls, and multi-format video player support.

## Features

### Authentication System
- **Enchanted Book Login**: Dual mystical books (Devil for signup, Angel for login)
- **Padlock Challenge**: Answer "GamayPototoy ka ba?" with "YES" to unlock
- **Device Fingerprinting**: One account per device enforcement
- **Session Management**: Automatic session tracking and management

### Video Player
- **Multi-Format Support**:
  - MPD (DASH) with ClearKey DRM
  - M3U8 (HLS) with adaptive bitrate
  - Widevine DRM with license URL
  - MP4 direct playback
  - YouTube embed (online/offline)
  - TS streams
  - Direct streaming
- **Shaka Player 4.7.11** for DASH/DRM content
- **HLS.js 1.5.7** for HLS streams
- **Optimized Buffering**: 10s buffer goal, 30s buffer behind
- **Quality Selection**: Auto-adaptive or manual quality selection
- **Wooden Forest UI**: Custom controls with enchanted theme

### Channel Categories
- Cignal
- Converge
- Movies
- Kids
- News
- Sports
- Comedy
- Music
- Documentary

### Admin Panel
- **Channel Management**: Add, edit, delete, lock/unlock channels
- **User Management**: View users, ban/unban, monitor activity
- **Activity Monitoring**: Real-time user activity tracking
- **Notifications**: Send push notifications to all users
- **Stream Type Support**: All formats configurable per channel

### Security Features
- Anti-DevTools detection
- Right-click disabled
- Keyboard shortcuts blocked (F12, Ctrl+Shift+I, etc.)
- View source disabled
- Device fingerprint tracking
- One account per device enforcement
- Rate limiting for brute force protection

### Responsive Design
- Mobile-first approach
- Tablet optimized
- Desktop/Laptop support
- TV/Large screen support (1920p, 4K)
- Touch-friendly controls

## Default Credentials

**Admin Account:**
- Email: admin@pinoytv.com
- Password: admin123

## Database Schema

### Tables
- `users` - User accounts with device tracking
- `channels` - Channel information and stream URLs
- `user_sessions` - Active session management
- `user_activity` - Activity logging
- `notifications` - System notifications

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Video Players**: Shaka Player, HLS.js
- **Icons**: Lucide React
- **State Management**: React Context API

## Stream Format Configuration

### M3U8 (HLS)
```
Stream URL: https://example.com/stream.m3u8
Stream Type: m3u8
```

### MPD with ClearKey
```
Stream URL: https://example.com/stream.mpd
Stream Type: mpd
ClearKey KID: <key_id_hex>
ClearKey Key: <key_hex>
```

### Widevine
```
Stream URL: https://example.com/stream.mpd
Stream Type: widevine
License URL: https://license.example.com/widevine
```

### YouTube
```
Stream URL: https://youtube.com/watch?v=VIDEO_ID
Stream Type: youtube
```

## Environment Variables

The Supabase configuration is already set up in `src/lib/supabase.ts`.

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## License

Private - All rights reserved
