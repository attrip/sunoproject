# Implementation Plan - Web Sampler v1

## Goal
Build a minimal, intuitive web-based audio sampler/looper. The UI should be clean and "web-native", avoiding complex hardware skeuomorphism in favor of clear, large controls and visual feedback.

## User Review Required
> [!IMPORTANT]
> **Audio Latency**: Web Audio API can have input latency. I will implement a basic compensation, but it might vary by device.
> **Mobile limitations**: `getUserMedia` on mobile sometimes has constraints (requires HTTPS, screen tap to start AudioContext). GitHub Pages provides HTTPS, so this should work.

## Proposed Changes

### Core Logic (`script.js`)
*   **AudioContext Setup**: Initialize on first interaction (Click/Key).
*   **State Machine**: `READY` -> `RECORDING_MASTER` -> `PLAYING` -> `OVERDUBBING`.
*   **Audio Buffers**: Array to store `[MasterBuffer, Layer1, Layer2...]`.
*   **Loop Scheduler**: Use `AudioContext.currentTime` to schedule precise playback and loop points.
*   **Shortcuts**: Event listeners for Space (Rec), Enter (Play/Stop), Backspace (Undo).

### UI/UX Design (`index.html`, `style.css`)
*   **Concept**: "Big Button" interface.
*   **Central Element**: A large, pulsing Circle that acts as the visual timer/progress and main status indicator.
    *   *Red Pulse*: Recording.
    *   *Green Rotation*: Playing.
    *   *Grey*: Stopped/Ready.
*   **Layout**:
    *   Header: Title & Status Text.
    *   Center: The "Loop Circle" (Visualizer).
    *   Bottom: Control Bar (Export, Undo, Clear).
*   **Responsiveness**: Centered layout works well on both Desktop and Mobile.

### Implementation Steps

#### [NEW] [index.html](file:///Users/flex-pc0705/sunoproject/index.html)
- Main container, Canvas for visualization, Control buttons.

#### [NEW] [style.css](file:///Users/flex-pc0705/sunoproject/style.css)
- CSS Variables for themes (using a modern dark theme).
- Flexbox/Grid for layout.
- Animations for the recording state.

#### [NEW] [script.js](file:///Users/flex-pc0705/sunoproject/script.js)
- `Looper` class to manage audio state.
- `UI` class to handle DOM and Canvas.
- Event wiring.

## Verification Plan
### Automated Tests
- None for v1 (Audio logic is hard to unit test without mocks).

### Manual Verification
1.  **Permission**: Confirm microphone prompt works.
2.  **Master Loop**: Record ~2s sound. Verify it loops cleanly.
3.  **Overdub**: Record a layer. Verify sync.
4.  **Undo**: Record layer 3, Undo. Verify layer 2 plays, layer 3 acts deleted.
5.  **Export**: Click Export, verify .wav download, play file locally.
6.  **Mobile**: Test on simulated mobile view (touch events).
