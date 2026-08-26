## PeerPlay — Minimal Implementation Roadmap

### Target architecture

```text
                         PeerPlay
                            │
                   Connection Mode
                    ┌───────┴───────┐
                    │               │
               Internet          Local Wi-Fi
               Trystero          WebRTC LAN
                    │               │
                    └───────┬───────┘
                            │
                    Shared Peer Layer
                            │
              ┌─────────────┼─────────────┐
              │             │             │
           Media          NTP          Commands
              │             │             │
              └─────────────┼─────────────┘
                            │
                   Precision Scheduler
                            │
                       Web Audio API
                            │
                         🔊  🔊
```

The **existing Trystero path remains intact**.

---

# Stage 0 — Baseline & Repository Audit

### Goal

Understand exactly what `pearplay-p2p` already provides before touching it.

### Tasks

Big-Pickle should inspect:

- Trystero initialization
- room creation/join
- peer messaging
- media transfer
- IndexedDB
- NTP implementation
- clock-offset calculation
- playback scheduling
- Web Audio
- queue
- host/admin functionality
- existing UI
- tests/build configuration

### Important

Do **not** modify functionality yet.

Run:

```bash
npm install
npm run build
npm test
```

or the equivalent commands discovered in the repository.

### Deliverable

Create:

```text
docs/PEERPLAY_BASELINE.md
```

containing:

```text
Existing architecture
Existing transport
Existing synchronization
Existing media flow
Existing UI flow
Files to extend
Files that should remain untouched
```

---

# Stage 1 — Rebrand to PeerPlay

Do this **before networking changes**.

The application should visually become PeerPlay while behavior remains unchanged.

### Change

```text
Beatsync
    ↓
PeerPlay
```

Update:

- application name
- document title
- UI branding
- metadata
- README
- package metadata where appropriate
- favicon/app icon references where applicable
- visible "BeatSync" text

### Do NOT rename internal technical concepts unnecessarily.

For example, if:

```text
useBeatSyncRoom()
```

works correctly, don't rename it just for cosmetics.

We want:

> **Product rebrand, not codebase churn.**

### Acceptance

Run the existing application.

It must behave exactly as before.

---

# Stage 2 — Introduce Transport Boundary

This is the most important architectural stage.

Currently the application likely assumes:

```text
Trystero = networking
```

We want:

```text
Room / Sync / Media
       │
       ▼
 PeerTransport
       │
 ┌─────┴──────┐
 │            │
Trystero    LAN WebRTC
```

Create the smallest possible abstraction.

For example:

```ts
interface PeerTransport {
  connect(): Promise<void>;
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  close(): void;
}
```

But **inspect the actual code first** and adapt the interface to what Beatsync already needs.

Don't force this exact API if a better existing abstraction exists.

### Existing implementation

```text
TrysteroTransport
```

must reproduce current behavior.

### New implementation

```text
LanWebRTCTransport
```

will come later.

### Acceptance

Internet mode still works exactly as before.

---

# Stage 3 — Build the LAN WebRTC Transport

Now add:

```text
LanWebRTCTransport
```

Use:

```ts
new RTCPeerConnection({
  iceServers: [],
});
```

No:

```text
STUN
TURN
Trystero
backend
WebSocket
cloud signaling
```

The connection should be:

```text
Browser A
    │
    │ direct WebRTC
    │
Browser B
```

on the same LAN.

---

# Stage 4 — Manual Signaling First

Before QR, don't make debugging harder.

Implement:

```text
Host
 ↓
Create Offer
 ↓
Copy offer
```

Peer:

```text
Paste offer
 ↓
Create answer
 ↓
Copy answer
```

Host:

```text
Paste answer
 ↓
Connected
```

This proves the actual transport.

### Test

Two devices:

```text
Laptop
   │
   │ same Wi-Fi
   │
Phone
```

Then:

```text
Internet OFF
```

The WebRTC connection must still establish.

### This stage is extremely important.

Don't proceed to QR until:

> **Direct LAN WebRTC works with Internet disabled.**

---

# Stage 5 — QR Pairing

Once manual SDP exchange works, replace the ugly debugging UI with:

```text
Host
 ↓
Create Room
 ↓
QR
```

Peer:

```text
Scan QR
 ↓
Generate Answer
 ↓
Answer QR
```

Host:

```text
Scan Answer
 ↓
Connected
```

### UI

Add:

```text
Local Wi-Fi
```

and:

```text
Create Room
Join Room
```

---

# Stage 6 — Add Connection Mode to PeerPlay

Now the UI gets the **one major feature you mentioned**.

```text
┌──────────────────────────────┐
│          PeerPlay            │
│                              │
│       Choose connection      │
│                              │
│   🌐 Internet P2P            │
│                              │
│   📶 Local Wi-Fi             │
│                              │
└──────────────────────────────┘
```

### Internet P2P

```text
TrysteroTransport
```

### Local Wi-Fi

```text
LanWebRTCTransport
```

Everything above them remains shared.

---

# Stage 7 — Integrate Existing Room/Peer Logic

This is where we connect the new transport to the existing Beatsync system.

We want:

```text
Internet:

Trystero
   ↓
PeerTransport
   ↓
Room
```

and:

```text
Wi-Fi:

WebRTC
   ↓
PeerTransport
   ↓
Room
```

The room shouldn't care.

For example:

```ts
room.sendPlay(...)
```

should work regardless of transport.

---

# Stage 8 — Integrate Media Transfer

**Do not build a new music system.**

Use the existing Beatsync implementation.

Target:

```text
Host selects song
       ↓
IndexedDB
       ↓
LAN WebRTC
       ↓
Peer
       ↓
IndexedDB
```

Once both devices possess the same audio file:

```text
        Host
         │
         │ synchronized command
         ▼
     START @ T
         │
         ├──────────────┐
         │              │
         ▼              ▼
      Host             Peer
    Web Audio        Web Audio
```

This is much better for synchronization than trying to continuously stream the audio in real time.

---

# Stage 9 — Preserve & Improve NTP

This is where **"very precise synchronized playback"** becomes the core feature.

Do **not** simply send:

```text
PLAY
```

and have the peer start when the message arrives.

That's exactly the behavior that causes the lag you're complaining about.

Instead:

```text
Host
 │
 ├── NTP request ──────► Peer
 │◄── NTP response ─────┤
 │
 ▼
estimate clock offset
```

Then:

```text
Host clock:

10:00:00.000

Schedule:

10:00:03.000
```

Send:

```text
PLAY_AT = 10:00:03.000
```

Both peers schedule against their local synchronized clocks.

---

# Stage 10 — Improve Playback Precision

This is the stage I would **not skip**.

The goal isn't merely:

> "Both devices receive PLAY at roughly the same time."

The goal is:

> **Both AudioContexts schedule playback for the same target timeline.**

Use Web Audio scheduling.

Conceptually:

```ts
audioContext.currentTime;
```

should be used for actual playback scheduling.

Instead of:

```ts
setTimeout(() => audio.play(), delay);
```

prefer:

```text
Shared timeline
      ↓
calculate target
      ↓
AudioContext time
      ↓
source.start(targetTime)
```

This avoids JavaScript event-loop jitter.

---

# Stage 11 — Measure Synchronization

Don't just say:

> "It seems synchronized."

Add diagnostics.

For each peer:

```text
Transport
──────────────
LAN WebRTC

Network
──────────────
RTT: 7 ms

Clock
──────────────
Offset: +1.8 ms

Playback
──────────────
Scheduled: 102.500s
Actual:    102.501s
Error:     1 ms
```

The exact metrics depend on what the existing code exposes.

---

# Stage 12 — Drift Detection

After playback begins:

```text
Host
 │
 ├──── sync ────► Peer
 │
 ├──── sync ────► Peer
 │
 └──── sync ────► Peer
```

Measure whether the peer gradually drifts.

If:

```text
Host: 30.000000 s
Peer: 30.006000 s
```

then drift exists.

The first MVP should **measure it**, not aggressively correct it.

Later we can introduce controlled correction.

---

# Stage 13 — Offline LAN Acceptance Test

This is the final MVP test.

Two devices:

```text
        Wi-Fi Router
        /          \
       /            \
   Host              Peer
```

Then:

```text
Internet = OFF
```

PeerPlay should still do:

```text
Create room
     ↓
QR pairing
     ↓
WebRTC connection
     ↓
Media transfer
     ↓
NTP
     ↓
PLAY_AT
     ↓
Web Audio
     ↓
Synchronized playback
```

If this works:

**we have the actual PeerPlay LAN MVP.**

---

# Stage 14 — Final UI Cleanup

Only after the networking and synchronization work.

UI:

```text
PeerPlay

Choose connection:

🌐 Internet P2P
Uses Internet connectivity

📶 Local Wi-Fi
Same Wi-Fi network
No Internet required
```

Room screen:

```text
PeerPlay
──────────────

📶 Local Wi-Fi

🟢 Connected

Host
Swarg

Peer
Phone

──────────────

🎵 Now Playing

Song Name

00:42 ━━━━━━━ 03:45

        ▶
```

Keep the existing Beatsync UI wherever possible.

---

# The resulting architecture

```text
                         PEERPLAY
                            │
                    ┌───────┴────────┐
                    │                │
              Internet P2P       Local Wi-Fi
                    │                │
                Trystero          WebRTC
                    │                │
                    └───────┬────────┘
                            │
                    PeerTransport
                            │
                ┌───────────┼───────────┐
                │           │           │
              Room        Media        NTP
                │           │           │
                └───────────┼───────────┘
                            │
                    Precision Timeline
                            │
                     Web Audio API
                            │
                         🔊 🔊
```

## And the most important rule

**Don't delete functionality just because we're adding Wi-Fi.**

We're evolving Beatsync:

```text
Beatsync
   │
   ├── existing Internet transport
   │
   └── NEW Wi-Fi transport
          │
          └── same precise sync engine
```

So your implementation target becomes:

> **PeerPlay = Beatsync's existing synchronized playback system + Local Wi-Fi transport + QR pairing + improved precision diagnostics.**

And yes — **the "very precise synchronized playback" should be treated as a first-class requirement, not just a side effect of adding Wi-Fi.** The LAN transport gets the packets there quickly; the NTP + future-timestamp + Web Audio scheduler is what makes the actual playback precise.
