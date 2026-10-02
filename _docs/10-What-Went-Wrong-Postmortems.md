---
layout: docs
title: "What Went Wrong & Engineering Post-Mortems"
nav_order: 11
description: "Technical post-mortems of dead ends, solved challenges, and human architectural decisions vs AI recommendations."
---

# What Went Wrong & Engineering Post-Mortems

A core requirement of this engineering write-up is transparently documenting the dead ends, protocol failures, and architectural corrections encountered during development, along with explicit human technical decisions where AI assistance was flawed or overridden.

---

## Human Architectural Decisions vs AI Critique

### 1. Architectural Decisions Made by the Human Engineer
The core design pillars of this platform were established through human engineering analysis rather than following automated LLM suggestions:

1. **Cloud Redroid Hosting over Local USB Mirroring**:
   Early proposals leaned toward local USB debugging on developer laptops. The human engineer recognized that a true production platform required multi-tenant, cloud-accessible infrastructure, driving the adoption of containerized Redroid instances with KVM acceleration on Ubuntu Linux.
2. **Binary WebSockets over Heavy WebRTC Mesh**:
   AI tools initially pushed for WebRTC peer connections with STUN/TURN media servers. The engineer evaluated the protocol overhead and recognized that for 1:1 client-to-container streaming over modern low-latency internet, **raw binary WebSockets with W3C WebCodecs** eliminated SDP negotiation roundtrips, cut connection establishment time from 2,500ms to < 100ms, and radically simplified deployment.
3. **Hardware `MediaCodec` Capture via `scrcpy-server.jar`**:
   The engineer rejected screenshot-based polling (`adb exec-out screencap -p`) and FFmpeg capture wrappers, choosing instead to execute `scrcpy-server.jar` directly inside Android's internal `app_process` runtime. This gave direct zero-overhead access to Android's hardware H.264 encoder.
4. **Unified App UI Structure & Clean Dark-Mode Experience**:
   The engineer designed the dark-mode Flutter interface, ensuring exact aspect-ratio letterboxing, real-time latency HUD telemetry, and amber state handling for pool exhaustion.

### 2. Where the AI Was Wrong & Required Human Correction
During implementation, automated AI code generators proposed several catastrophic or flawed approaches that had to be diagnosed and overturned:

| Flawed AI Proposal | The Critical Failure | Human Engineer Fix |
| :--- | :--- | :--- |
| **Disk-Based MP4 Session Recording** | AI wrote FFmpeg commands to record every session to disk. On our 2 vCPU cloud VM, disk I/O saturated immediately, CPU jumped to 85%, and streaming FPS collapsed to < 5 FPS. | Completely ripped out disk recording. Switched to a **100% in-memory streaming pipeline** with zero disk I/O and < 2% CPU overhead. |
| **Naive Mouse Coordinate Forwarding** | AI forwarded raw browser click coordinates $(X_{\text{mouse}}, Y_{\text{mouse}})$ directly to Android. When windows were resized or displayed on high-DPI screens, touch targets missed by up to 400 pixels. | Formulated mathematical coordinate normalization accounting for pillarbox/letterbox offsets and aspect-ratio scaling factors. |
| **`navigator.clipboard.readText()`** | AI suggested reading client clipboard via the Permissions API, causing intrusive browser permission prompts that failed inside iframes and background tabs. | Replaced with native HTML5 DOM `paste` event listener (`Ctrl+V`), operating seamlessly with zero browser permission prompts. |
| **Single-Field Dumpsys Kiosk Check** | AI proposed checking `mCurrentFocus` to enforce kiosk lockdown. On Android 12 (Redroid), `mCurrentFocus` is frequently null or renamed during window transitions, causing false kiosk resets. | Built a multi-version regex parser inspecting `mCurrentFocus`, `mFocusedApp`, and `mResumedActivity`. |

---

## Technical Post-Mortems: Dead Ends and Solutions

### Post-Mortem 1: Coordinate Serialization & Endianness Bug
- **The Problem**: Initial touch injection packets sent to `scrcpy-server` caused immediate process crashes with `IllegalArgumentException: Invalid coordinate`.
- **Root Cause**: `scrcpy-server` expects unsigned 32-bit big-endian integers for touch coordinates, and unsigned 16-bit integers for screen dimensions. The JavaScript buffer builder had inverted screen dimensions to 32-bit little-endian, misaligning all subsequent packet fields by 4 bytes.
- **The Fix**: Audited `ScrcpyInputAdapter.ts` against the native C/Java struct in scrcpy source code, enforcing strict big-endian `writeUInt32BE` and `writeUInt16BE` offsets.

### Post-Mortem 2: Local Device vs Cloud Container Pivot
- **The Problem**: The project was initially prototyped assuming a physical Android phone connected via USB. When deploying to the public URL (`https://android.aavvvacado.site/`), physical USB hotplugging was impossible.
- **Root Cause**: Architecture lacked a scalable virtualization layer for remote multi-user access.
- **The Fix**: Pivoted to containerized Android using **Redroid 12** on Linux with KVM acceleration. Built `AdbDevicePoolAdapter` to dynamically discover both USB serials and TCP IP:Port endpoints (`127.0.0.1:5555..5557`).

### Post-Mortem 3: Idle Session Device Starvation
- **The Problem**: Testers opened the web app, interacted briefly, and then left the browser tab open in the background, permanently leasing the device and starving other users.
- **Root Cause**: Device leases were tied solely to WebSocket connection closure.
- **The Fix**: Implemented an **Inactivity Watchdog** in `SessionManagerService`. If no touch, key, or scroll event is received for 180 seconds (3 minutes), the server cleanly terminates the session, resets the Android device, and returns it to the pool.

### Post-Mortem 4: CPU Contention on 2 vCPUs (Software Encoding)
- **The Problem**: When 3 users connected simultaneously to the cloud server, streaming framerates dropped from 60 FPS down to 10-15 FPS.
- **Root Cause**: The cloud virtual machine has 2 shared vCPUs without a dedicated hardware GPU. Running 3 parallel Redroid instances forced AOSP to use software video encoding (`c2.android.avc.encoder`), causing severe CPU time-slicing across the 2 cores.
- **The Fix**: Downscaled container resolution from 1080 x 2400 to 720 x 1600 and capped bitrate at 4 Mbps. Documented the physical hardware constraint openly in the evaluation matrix.

### Post-Mortem 5: Minimal AOSP Package Variances in Kiosk Mode
- **The Problem**: Kiosk mode watchdog commands designed for Google Chrome crashed on Redroid containers because Chrome is not pre-installed in vanilla AOSP images.
- **Root Cause**: AOSP uses `org.chromium.webview_shell` or `com.android.browser` rather than `com.android.chrome`.
- **The Fix**: Updated the Kiosk launcher and focus detector to accept either package or target the generic browser intent `android.intent.action.VIEW -d https://www.google.com`.

### Post-Mortem 6: The Disk Recording Catastrophe
- **The Problem**: Attempting to record MP4 files on the cloud server caused disk writes of ~1.8 GB/hour per user and pushed CPU to 85%.
- **Root Cause**: Real-time FFmpeg transcoding and disk flushes oversubscribed VM storage I/O.
- **The Fix**: Completely removed the recording concept from the platform. Shifted to a zero-disk, 100% in-memory streaming pipeline, reducing server CPU overhead to < 2%.

### Post-Mortem 7: WebCodecs Canvas Reset on Window Resize
- **The Problem**: When users resized their browser window, the canvas cleared to pure black and remained blank until the next video I-frame arrived.
- **Root Cause**: Resizing an HTML5 canvas element (`canvas.width = newWidth`) implicitly clears the canvas 2D/WebGL rendering context and invalidates existing frame buffers.
- **The Fix**: Maintained a reference to the most recent decoded `VideoFrame` in memory. On canvas resize, the client immediately repaints the cached frame before accepting new stream chunks.

### Post-Mortem 8: Focus Theft and Physical Keyboard Capture
- **The Problem**: Clicking on the video canvas caused Flutter Web to lose text input focus, preventing subsequent keyboard strokes from registering.
- **Root Cause**: HTML5 canvas elements are non-focusable by default and do not receive keypress events unless explicitly assigned a `tabindex` and managed focus.
- **The Fix**: Wrapped the canvas in a Flutter `Focus` widget with `autofocus: true`, backed by an invisible HTML input proxy ensuring continuous keystroke capture.

### Post-Mortem 9: Pointer Event State Machine & Stuck Drags
- **The Problem**: If a user clicked inside the canvas, dragged outside the browser window, and released the mouse button, Android remained stuck in a permanent "touch down" dragging state.
- **Root Cause**: The browser's native `mouseup` event fired outside the canvas DOM element, dropping the `ACTION_UP` packet.
- **The Fix**: Attached global `pointerup` and `pointercancel` listeners to the `window` object. If the mouse leaves the browser viewport during an active drag, a synthetic `ACTION_UP` packet is automatically dispatched to Android.
