# Project Specification: Web Sampler (Looper)

## Vision
To create a simple, intuitive web-based looper/sampler that allows users to build music by layering microphone recordings in the browser. The experience should mimic a hardware loop pedal.

## Core Functionality

### 1. Loop Logic
*   **Loop Length Constraint**: Maximum loop duration is **10 seconds**.
*   **Master Loop (Track 1)**: The length is determined by the duration of the first recording (Hold REC -> Release REC).
    *   If recording exceeds 10 seconds, it automatically stops and sets the loop length to 10s.
*   **Overdubbing**: Subsequent recordings are added on top.
    *   User holds REC to record over the playing loop.
    *   Recording stops when REC is released or loop wraps around (design decision: allow wrapping recording? For simplicity MVP, maybe just "play loop, record while holding").

### 2. Audio Control
*   **Input**: Microphone access via `navigator.mediaDevices.getUserMedia`.
*   **Engine**: Web Audio API.
*   **Latency Compensation**: Critical for tight loops.

### 3. User Interface (UI)
*   **Main Controls**:
    *   **[REC] Button (Momentary)**:
        *   **Action**: **Hold to Record, Release to Stop/Play**.
        *   *First Press*: Defines loop length (up to 10s).
        *   *Subsequent Presses*: Overdubs audio onto the playing loop while held.
    *   **[PLAY/STOP] Button**: Toggles playback.
    *   **[CLEAR] Button**: Resets everything.
    *   **[EXPORT] Button**: Mixes down current loops and downloads as a **.WAV** file.
    *   **[UNDO] Button**: Removes the last recorded layer (Essential for performative layering).
*   **Keyboard Controls (Ed Sheeran Style)**:
    *   **Spacebar**: Triggers [REC] (Momentary). Allows for easier timing than clicking code.
    *   **Enter**: Triggers [PLAY/STOP].
    *   **Backspace**: Triggers [UNDO] or [CLEAR].
*   **Visual Feedback**:
    *   **Loop Progress**: A circular or linear progress bar.
    *   **Status Indicator**: "Ready", "Recording", "Playing".
    *   **Track List**: Stacked layers visualization.

## Technical Stack
*   **HTML5/CSS3**: Clean, responsive layout.
*   **Vanilla JavaScript**: No heavy frameworks.
*   **Deployment**: GitHub Pages.
*   **Export**: WAV encoding.
*   **Audio Architecture**:
    *   Maintain separate `AudioBuffers` for each recording layer to enable **Undo** and potential future mixing.
    *   Synchronized playback of all buffers.

## Future Considerations (v2+)
*   Metronome / Click track.
*   Individual track volume/mute controls (Mixing).
*   A/B Song Sections (Verse/Chorus switching).
