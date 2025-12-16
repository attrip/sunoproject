/**
 * Web Sampler - Core Logic
 * Handles AudioContext, Recording, Looping, and UI interaction.
 */

class Looper {
    constructor() {
        this.ctx = null;
        this.stream = null;
        this.input = null;
        this.recorder = null;
        this.isPlaying = false;

        // Audio State
        this.masterBuffer = null;
        this.layers = []; // Array of AudioBuffers
        this.loopDuration = 0; // in seconds
        this.loopStartTime = 0; // audioContext time when loop started playing

        // Recording State
        this.isRecording = false;
        this.recordingStartTime = 0;
        this.recordedChunks = [];

        // Settings
        this.maxLoopLength = 10; // seconds
        this.latencyCompensationS = 0.05; // 50ms manual tweak for input latency

        // UI Callbacks
        this.onStateChange = () => { };
        this.onProgress = () => { };

        this.recordingLoopOffset = 0;
        this.autoStopTimer = null;

        // Visualizer
        this.analyser = null;
        this.dataArray = null;
    }

    async init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();

            // Resume if suspended (browser autoplay policy)
            if (this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }

            try {
                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true, // Fix for speaker feedback (stops re-recording playback)
                        noiseSuppression: true, // Helps with feedback squeal
                        autoGainControl: false, // Keep false to preserve dynamics
                        latency: 0
                    }
                });
                this.input = this.ctx.createMediaStreamSource(this.stream);

                // Analyser Setup
                this.analyser = this.ctx.createAnalyser();
                this.analyser.fftSize = 256;
                this.input.connect(this.analyser);
                const bufferLength = this.analyser.frequencyBinCount;
                this.dataArray = new Uint8Array(bufferLength);

                console.log("Audio Initialized");
            } catch (err) {
                console.error("Mic Error:", err);
                alert("Could not access microphone. Ensure site is HTTPS and permitted.");
            }
        }
    }

    /**
     * Start recording a new layer.
     * If no master loop, this starts the Master Loop recording.
     */
    async startRecording() {
        if (this.isRecording) return;

        // Ensure AudioContext and Stream are ready
        if (!this.ctx || !this.stream) {
            await this.init();
            if (!this.stream) {
                console.error("No stream available");
                return;
            }
        }

        // Double check state after await
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        this.mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            this.mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            this.mimeType = 'audio/mp4';
        }

        console.log("Using MIME Type:", this.mimeType);

        this.isRecording = true;
        this.recordedChunks = [];
        try {
            this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
        } catch (e) {
            console.error("MediaRecorder init failed:", e);
            alert("Microphone recording failed. Check console.");
            this.isRecording = false;
            return;
        }

        this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };

        this.recorder.start();
        this.recordingStartTime = this.ctx.currentTime;

        // Track where in the loop we started recording (for alignment)
        if (this.masterBuffer && this.isPlaying) {
            this.recordingLoopOffset = (this.ctx.currentTime - this.loopStartTime) % this.loopDuration;
        } else {
            this.recordingLoopOffset = 0;
            // Auto-stop if Master exceeds max length
            this.autoStopTimer = setTimeout(() => {
                if (this.isRecording && !this.masterBuffer) {
                    this.stopRecording();
                }
            }, this.maxLoopLength * 1000);
        }

        this.onStateChange('RECORDING');
    }

    /**
     * Stop recording.
     * If Master, sets loop length and starts playing.
     * If Overdub, creates a layer synced to the loop.
     */
    async stopRecording() {
        if (!this.isRecording) return;

        if (this.autoStopTimer) clearTimeout(this.autoStopTimer);

        return new Promise(resolve => {
            this.recorder.onstop = async () => {
                this.isRecording = false;

                const blob = new Blob(this.recordedChunks, { type: this.mimeType });

                try {
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

                    if (!this.masterBuffer) {
                        // === MASTER LOOP LOGIC ===
                        // Trim to exact recorded duration (or clamp to 10s)
                        let duration = this.ctx.currentTime - this.recordingStartTime;
                        // Use actual buffer duration to be safe, but clamp if absurdly long
                        if (duration > this.maxLoopLength) duration = this.maxLoopLength;

                        // Sanity check: verify audioBuffer duration matches 'duration' closely
                        // Use the Buffer's play time as the source of truth for loop length to avoid gaps
                        console.log("Master Loop Created. Duration:", audioBuffer.duration);
                        this.masterBuffer = audioBuffer;
                        this.loopDuration = audioBuffer.duration;

                        // Immediately start playing
                        this.play();
                    } else {
                        // === OVERDUB LOGIC ===
                        // Align the new recording to the Master Loop
                        // Create a silence-padded buffer matching the Master length
                        if (this.masterBuffer) {
                            const newLayer = this.ctx.createBuffer(
                                this.masterBuffer.numberOfChannels,
                                this.masterBuffer.length,
                                this.masterBuffer.sampleRate
                            );

                            // Calculate sample offset
                            // offsetTime / loopDuration * totalSamples
                            const ratio = this.recordingLoopOffset / this.loopDuration;
                            const sampleOffset = Math.floor(ratio * this.masterBuffer.length);

                            // Copy data
                            // Handle Loop Wrap-around?
                            // For V1, if it spills over, we just truncate or let it wrap (simple: truncate for now)
                            for (let ch = 0; ch < this.masterBuffer.numberOfChannels; ch++) {
                                const destData = newLayer.getChannelData(ch);
                                const srcData = audioBuffer.getChannelData(ch < audioBuffer.numberOfChannels ? ch : 0);

                                // Simple copy with boundary check
                                for (let i = 0; i < srcData.length; i++) {
                                    const targetIdx = (sampleOffset + i) % newLayer.length; // Wrap around!
                                    destData[targetIdx] += srcData[i]; // Mix? Or Overwrite?
                                    // Spec implies layering, so mixing is better if we are destructively adding?
                                    // No, 'layers' logic keeps them separate. So we just set the value.
                                    destData[targetIdx] = srcData[i];
                                }
                            }

                            this.layers.push(newLayer);
                        }

                        // Sync up: If we are playing, the new layer needs to start NOW?
                        // Actually, since we padded it to be full loop length, we can just start it
                        // synchronized with the Master Node's loop cycle.
                        // But changing nodes mid-flight is tricky.
                        // Simplest V1: Restart all loops to resync (might cause a click).
                        // smooth playback: create just this node and start it at the correct offset?
                        // "source.start(0, currentLoopTime)"

                        if (this.isPlaying) {
                            const elapsedTime = (this.ctx.currentTime - this.loopStartTime) % this.loopDuration;
                            // Add just this layer
                            const source = this.ctx.createBufferSource();
                            source.buffer = this.layers[this.layers.length - 1]; // The new one
                            source.loop = true;
                            source.connect(this.ctx.destination);
                            source.start(0, elapsedTime);
                            this.layerNodes.push(source);
                        }
                    }
                } catch (err) {
                    console.error("Audio Decode Error:", err);
                    alert("Failed to process audio. Format might be unsupported.");
                }
                resolve();
            };

            this.recorder.stop();
        });
    }

    play() {
        if (this.isPlaying) this.stop();

        if (!this.masterBuffer) return;

        this.isPlaying = true;
        this.loopStartTime = this.ctx.currentTime;
        this.scheduleLoops();
        this.onStateChange('PLAYING');

        // Start animation loop
        this.tick();
    }

    stop() {
        this.isPlaying = false;
        if (this.ctx && this.ctx.state === 'running') {
            // Stop specific nodes in v2, for now suspend is okay but aggressive.
            // Better: Stop all tracked nodes.
            if (this.masterNode) { try { this.masterNode.stop(); } catch (e) { } }
            this.layers.forEach(node => { try { node.stop(); } catch (e) { } });
            this.layerNodes = []; // Clear references
        }
        this.onStateChange('STOPPED');
    }

    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    scheduleLoops() {
        if (!this.isPlaying) return;
        this.layerNodes = []; // Reset tracker

        const playSource = (buffer) => {
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(this.ctx.destination);
            source.start(0, 0);
            return source;
        };

        // Play Master
        this.masterNode = playSource(this.masterBuffer);

        // Play Layers
        this.layers.forEach(buf => {
            this.layerNodes.push(playSource(buf));
        });
    }

    undo() {
        if (this.layers.length > 0) {
            this.layers.pop();
            // Restarts playback to reflect change if playing
            if (this.isPlaying) {
                this.stop();
                this.play();
            }
        } else if (this.masterBuffer) {
            this.clear();
        }
    }

    clear() {
        this.stop();
        this.masterBuffer = null;
        this.layers = [];
        this.loopDuration = 0;
        this.onStateChange('READY');
    }

    exportWav() {
        if (!this.masterBuffer) {
            alert("Nothing to export!");
            return;
        }

        // Mix down all buffers to a single buffer
        // 1. Determine total length (Master loop length)
        const length = this.masterBuffer.length;
        const channels = 2;
        const sampleRate = this.ctx.sampleRate;

        // 2. Create offline context to render the mix
        const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);

        const addToMix = (buf) => {
            const source = offlineCtx.createBufferSource();
            source.buffer = buf;
            source.connect(offlineCtx.destination);
            source.start(0);
        };

        addToMix(this.masterBuffer);
        this.layers.forEach(l => addToMix(l));

        offlineCtx.startRendering().then(renderedBuffer => {
            // 3. Encode to WAV
            const wavData = this.audioBufferToWav(renderedBuffer);
            const blob = new Blob([wavData], { type: "audio/wav" });
            const url = URL.createObjectURL(blob);

            // 4. Download
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = "my-loop.wav";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        });
    }

    // Simple WAV Encoder
    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        let result;
        if (numChannels === 2) {
            result = this.interleave(buffer.getChannelData(0), buffer.getChannelData(1));
        } else {
            result = buffer.getChannelData(0);
        }

        return this.encodeWAV(result, numChannels, sampleRate, bitDepth);
    }

    interleave(inputL, inputR) {
        const length = inputL.length + inputR.length;
        const result = new Float32Array(length);
        let index = 0;
        let inputIndex = 0;
        while (index < length) {
            result[index++] = inputL[inputIndex];
            result[index++] = inputR[inputIndex];
            inputIndex++;
        }
        return result;
    }

    encodeWAV(samples, numChannels, sampleRate, bitDepth) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        /* RIFF identifier */
        writeString(view, 0, 'RIFF');
        /* RIFF chunk length */
        view.setUint32(4, 36 + samples.length * 2, true);
        /* RIFF type */
        writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (raw) */
        view.setUint16(20, 1, true);
        /* channel count */
        view.setUint16(22, numChannels, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, sampleRate * 4, true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, numChannels * 2, true);
        /* bits per sample */
        view.setUint16(34, bitDepth, true);
        /* data chunk identifier */
        writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, samples.length * 2, true);

        const floatTo16BitPCM = (output, offset, input) => {
            for (let i = 0; i < input.length; i++, offset += 2) {
                const s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        };

        floatTo16BitPCM(view, 44, samples);

        return view;
    }

    tick() {
        if (!this.isPlaying) return;

        // Calculate progress 0.0 - 1.0
        const elapsed = (this.ctx.currentTime - this.loopStartTime) % this.loopDuration;
        const progress = elapsed / this.loopDuration;

        this.onProgress(progress);
        requestAnimationFrame(() => this.tick());
    }
}

// === UI Logic ===
const looper = new Looper();
const circle = document.getElementById('loop-circle');
const statusText = document.getElementById('status-text');
const recIndicator = document.getElementById('recording-indicator');
const canvas = document.getElementById('visualizer-canvas');
const canvasCtx = canvas.getContext('2d');

// visual updates
looper.onStateChange = (state) => {
    // console.log("State:", state);
    circle.classList.remove('recording', 'playing', 'flash-white');

    if (state === 'RECORDING') {
        statusText.innerText = "Recording...";
        circle.classList.add('recording');
        recIndicator.innerText = "REC";
    } else if (state === 'PLAYING') {
        statusText.innerText = "Playing Loop";
        circle.classList.add('playing');
        recIndicator.innerText = "PLAY";
    } else if (state === 'STOPPED') {
        statusText.innerText = "Stopped";
        recIndicator.innerText = "PAUSE";
        circle.style.transform = `rotate(0deg)`; // Reset rotation
    } else {
        statusText.innerText = "Ready to Loop";
        recIndicator.innerText = "REC";
        circle.style.transform = `rotate(0deg)`;
    }
};

let lastProgress = 0;
looper.onProgress = (p) => {
    // Rotate the circle based on progress
    const deg = p * 360;
    circle.style.transform = `rotate(${deg}deg)`;

    // Detect Loop Wrap (progress drops from near 1.0 to near 0.0)
    if (p < lastProgress && looper.isPlaying) {
        // Flash!
        circle.classList.remove('flash-white');
        void circle.offsetWidth; // Trigger reflow
        circle.classList.add('flash-white');
    }
    lastProgress = p;
};

// Visualizer Animation Loop
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);

    if (!looper.analyser) return;

    looper.analyser.getByteTimeDomainData(looper.dataArray);

    canvasCtx.fillStyle = 'rgba(30, 30, 30, 0.2)'; // Fade out effect
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = looper.isRecording ? 'rgb(255, 77, 77)' : 'rgb(77, 255, 136)';
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / looper.analyser.fftSize;
    let x = 0;

    for (let i = 0; i < looper.analyser.fftSize; i++) {
        const v = looper.dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
}

drawVisualizer();


// === Inputs ===

const handleRecordDown = () => {
    if (!looper.masterBuffer) {
        // Start Master
        looper.startRecording();
    } else if (looper.isPlaying) {
        // Overdub
        looper.startRecording();
    }
};

const handleRecordUp = () => {
    looper.stopRecording();
};

// Mouse/Touch
circle.addEventListener('mousedown', handleRecordDown);
circle.addEventListener('mouseup', handleRecordUp);
circle.addEventListener('touchstart', (e) => { e.preventDefault(); handleRecordDown(); });
circle.addEventListener('touchend', (e) => { e.preventDefault(); handleRecordUp(); });

// Keyboard
document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
        handleRecordDown();
    }
    if (e.code === 'Enter') {
        looper.togglePlay();
    }
    if (e.code === 'Backspace') {
        looper.undo();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        handleRecordUp();
    }
});

// Buttons
document.getElementById('btn-play-stop').addEventListener('click', () => looper.togglePlay());
document.getElementById('btn-undo').addEventListener('click', () => looper.undo());
document.getElementById('btn-clear').addEventListener('click', () => looper.clear());
document.getElementById('btn-export').addEventListener('click', () => looper.exportWav());
