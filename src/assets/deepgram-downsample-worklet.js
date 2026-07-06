// AudioWorkletProcessor: 48kHz mono Float32 → 16kHz Int16 LE PCM (3:1 decimation).
// Loaded as a real file (not blob:) so CSP "script-src 'self' 'unsafe-inline'" allows it.
// Mirrors C:\my-fs-pj\sokuroku\src\renderer\App.tsx workletCode.
class DeepgramDownsampleProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
    }
    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const frameLength = input[0].length;
        const mono = new Float32Array(frameLength);
        for (let ch = 0; ch < input.length; ch++) {
            for (let i = 0; i < frameLength; i++) mono[i] += input[ch][i];
        }
        if (input.length > 1) {
            for (let i = 0; i < frameLength; i++) mono[i] /= input.length;
        }
        for (let i = 0; i < mono.length; i++) this.buffer.push(mono[i]);
        const ratio = 3; // 48kHz → 16kHz
        const downsampledLength = Math.floor(this.buffer.length / ratio);
        if (downsampledLength > 0) {
            const int16 = new Int16Array(downsampledLength);
            for (let i = 0; i < downsampledLength; i++) {
                let s = this.buffer[i * ratio];
                s = Math.max(-1, Math.min(1, s));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            this.buffer = this.buffer.slice(downsampledLength * ratio);
            this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true;
    }
}
registerProcessor('deepgram-downsample-processor', DeepgramDownsampleProcessor);
