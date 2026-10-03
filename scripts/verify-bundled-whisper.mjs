#!/usr/bin/env node
'use strict';

// Standalone proof that the bundled Xenova/whisper-small model loads and
// transcribes fully OFFLINE — env.allowRemoteModels = false, so any attempt
// to reach Hugging Face throws instead of silently falling back to a network
// fetch. Mirrors the resolution src/utils/localai.js's
// getBundledWhisperModelsRoot() + loadWhisperPipeline() perform in dev mode
// (env.localModelPath = <repoRoot>/resources/whisper-models), without
// needing Electron.
//
// Case 2 (external review should-fix, 2026-09) additionally proves that a
// corrupt/stale entry under a pre-existing filesystem cache directory does
// NOT shadow the bundled model. transformers.js's hub.js resolution order
// checks env.cacheDir FIRST when env.useFSCache is true, and only falls
// back to env.localModelPath on a cache miss — so an existing user's old or
// corrupt cache for this model name would otherwise silently defeat the
// "bundled model always loads offline" guarantee. src/utils/localai.js now
// sets env.useFSCache = false for bundled models specifically to avoid
// this; this script proves that setting actually works, not just that it's
// present in the source.
//
// Usage: node scripts/verify-bundled-whisper.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const transformersEntry = pathToFileURL(path.join(repoRoot, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')).href;
const modelName = 'Xenova/whisper-small';

async function loadAndTranscribeSilence(pipeline) {
    const t0 = Date.now();
    const whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
        dtype: 'q8',
        device: 'cpu',
    });
    const loadMs = Date.now() - t0;

    // 1 second of silence at 16kHz.
    const silence = new Float32Array(16000);
    const t1 = Date.now();
    const result = await whisperPipeline(silence, { sampling_rate: 16000, language: 'ja', task: 'transcribe' });
    const inferenceMs = Date.now() - t1;

    return { loadMs, inferenceMs, result };
}

async function runCase1_offlineBundledLoad(transformersModule) {
    console.log('\n[verify-bundled-whisper] === Case 1: offline bundled load (no network, no cache) ===');
    const { pipeline, env } = transformersModule;

    env.allowLocalModels = true;
    env.allowRemoteModels = false; // fail hard on any network attempt
    env.localModelPath = path.join(repoRoot, 'resources', 'whisper-models');
    env.useFSCache = false;
    env.cacheDir = undefined;
    console.log(`[verify-bundled-whisper] env.localModelPath = ${env.localModelPath}`);
    console.log(`[verify-bundled-whisper] env.allowRemoteModels = ${env.allowRemoteModels}`);
    console.log(`[verify-bundled-whisper] env.useFSCache = ${env.useFSCache}`);

    console.log(`[verify-bundled-whisper] loading pipeline for ${modelName} (dtype=q8, device=cpu)...`);
    const { loadMs, inferenceMs, result } = await loadAndTranscribeSilence(pipeline);
    console.log(`[verify-bundled-whisper] pipeline loaded in ${loadMs}ms — no network access occurred.`);
    console.log(`[verify-bundled-whisper] inference completed in ${inferenceMs}ms`);
    console.log('[verify-bundled-whisper] result:', JSON.stringify(result));
    console.log('[verify-bundled-whisper] Case 1 OFFLINE BUNDLED LOAD + INFERENCE: OK');
}

async function runCase2_corruptCacheDoesNotShadowBundled(transformersModule) {
    console.log('\n[verify-bundled-whisper] === Case 2: corrupt filesystem cache must not shadow the bundled model ===');
    const { pipeline, env } = transformersModule;

    const tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-verify-corrupt-cache-'));
    const corruptConfigPath = path.join(tmpCacheDir, modelName, 'config.json');
    fs.mkdirSync(path.dirname(corruptConfigPath), { recursive: true });
    fs.writeFileSync(corruptConfigPath, '{ this is not valid JSON, deliberately corrupted for verify-bundled-whisper.mjs', 'utf8');
    console.log(`[verify-bundled-whisper] planted corrupt cache entry: ${corruptConfigPath}`);

    try {
        env.allowLocalModels = true;
        env.allowRemoteModels = false; // still offline — this case is about cache precedence, not network
        env.localModelPath = path.join(repoRoot, 'resources', 'whisper-models');
        env.cacheDir = tmpCacheDir;
        // The fix under test: bundled models must set useFSCache = false so
        // hub.js's cache-first resolution never even looks at cacheDir.
        env.useFSCache = false;
        console.log(`[verify-bundled-whisper] env.cacheDir = ${env.cacheDir} (contains a corrupt config.json for ${modelName})`);
        console.log(`[verify-bundled-whisper] env.useFSCache = ${env.useFSCache}`);

        console.log(`[verify-bundled-whisper] loading pipeline for ${modelName} with a corrupt cacheDir present...`);
        const { loadMs, inferenceMs, result } = await loadAndTranscribeSilence(pipeline);
        console.log(
            `[verify-bundled-whisper] pipeline loaded in ${loadMs}ms despite the corrupt cache entry — resolved from the bundled model instead.`
        );
        console.log(`[verify-bundled-whisper] inference completed in ${inferenceMs}ms`);
        console.log('[verify-bundled-whisper] result:', JSON.stringify(result));
        console.log('[verify-bundled-whisper] Case 2 CORRUPT CACHE DID NOT SHADOW BUNDLED MODEL: OK');
    } finally {
        fs.rmSync(tmpCacheDir, { recursive: true, force: true });
    }
}

async function main() {
    console.log(`[verify-bundled-whisper] importing @huggingface/transformers from ${transformersEntry}`);
    const transformersModule = await import(transformersEntry);

    await runCase1_offlineBundledLoad(transformersModule);
    await runCase2_corruptCacheDoesNotShadowBundled(transformersModule);

    console.log('\n[verify-bundled-whisper] ALL CASES OK');
}

main().catch(error => {
    console.error('[verify-bundled-whisper] FAILED:', error);
    process.exit(1);
});
