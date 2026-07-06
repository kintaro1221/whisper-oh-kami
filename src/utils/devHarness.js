// devHarness.js — Phase 1g extracted dev scenarios + assertions + replay loop.
//
// Pure CommonJS module with **no** Electron / Gemini / IPC / Deepgram imports.
// All cross-cutting state (turnEvents, aiResponseInFlight, conversationHistory,
// currentSystemPrompt, getSystemPrompt, lastAiErrorKind, processGenerationComplete)
// is injected via createDevHarness(deps), so the harness can run inside Jest
// without spinning up the production orchestration.
//
// gemini.js retains the existing exported names (`runDevScenario`,
// `DEV_SCENARIOS`) by delegating to a single harness instance returned from
// createDevHarness(). Existing DevTools API names (`window.devRunScenario`,
// `window.devListScenarios`) keep their semantics — the dev IPC handlers in
// gemini.js are unchanged.
//
// Phase note: `aiResponseInFlight` is read via the injected getter, never
// written by the harness. Mutex behavior stays in production code paths.

'use strict';

const path = require('path');

// ── DEV_SCENARIOS — fixed inputs that exercise the production turnEvents /
//    shouldSkipAiResponse / sendTo* path with deterministic decisions.
const DEV_SCENARIOS = {
    opponent_question_self_yes: {
        description: '相手のクローズドクエスチョンに自分が「はい」と短答',
        turns: [
            { speaker: 'opponent', text: '来週水曜の打ち合わせは可能ですか？', source: 'gemini_live' },
            { speaker: 'self', text: 'はい', source: 'deepgram' },
        ],
        triggerText: 'はい',
        expected: {
            fired: true,
            eventKind: 'self_finished',
            classification: 'closed_question_reply',
            // Self has already answered ("はい") so don't preempt with another
            // reply suggestion; only the deep-dive section should be present.
            // The opponent context still flows into the prompt so the deep-dives
            // are about confirming the meeting details (参加者・資料・目的 etc.).
            sectionsRequired: ['次に聞くとよいこと:'],
            sectionsForbidden: ['返答候補:'],
        },
    },
    self_short_no_context: {
        description: '相手の発話が無い状態で自分が「うん」とだけ呟く',
        turns: [{ speaker: 'self', text: 'うん', source: 'deepgram' }],
        triggerText: 'うん',
        expected: {
            fired: false,
            reason: 'skipped',
            classification: 'noise',
        },
    },
    opponent_statement_self_yes: {
        description: '相手が状況説明（質問でも痛みでもない）→ 自分「はい」 → noise として skip',
        turns: [
            { speaker: 'opponent', text: '本日はお時間いただきありがとうございます。', source: 'gemini_live' },
            { speaker: 'self', text: 'はい', source: 'deepgram' },
        ],
        triggerText: 'はい',
        expected: {
            fired: false,
            reason: 'skipped',
            classification: 'noise',
        },
    },
    opponent_pain_self_ack: {
        description: '相手が課題吐露 → 自分「うん」 → ack_after_pain_point として AI 起動',
        turns: [
            { speaker: 'opponent', text: '正直、今のチームは人手が足りなくて疲弊しています。', source: 'gemini_live' },
            { speaker: 'self', text: 'うん', source: 'deepgram' },
        ],
        triggerText: 'うん',
        expected: {
            fired: true,
            eventKind: 'self_finished',
            classification: 'ack_after_pain_point',
            sectionsRequired: ['次に聞くとよいこと:'],
            sectionsForbidden: ['返答候補:'],
        },
    },
    bant_followup_after_pitch: {
        description: 'Need 確認済 (相手が課題吐露) → 自分が長尺ピッチ → AI が BANT 残項目 (予算/決裁/時期) を提案',
        turns: [
            { speaker: 'opponent', text: '実は、現場のエンジニアが疲弊していて、もう離職者も出ているんです。', source: 'gemini_live' },
            {
                speaker: 'self',
                text: '弊社のソリューションは、御社の課題である業務の属人化を、テンプレート化と自動化で解決します。同業界での導入実績は20社以上です。',
                source: 'deepgram',
            },
        ],
        triggerText: '弊社のソリューションは、御社の課題である業務の属人化を、テンプレート化と自動化で解決します。同業界での導入実績は20社以上です。',
        expected: {
            fired: true,
            eventKind: 'self_finished',
            sectionsRequired: ['次に聞くとよいこと:'],
            sectionsForbidden: ['返答候補:'],
            // Need is already established (opponent shared pain, self pitched).
            // BANT prompt should push the model toward Budget / Authority / Timeline.
            // Keyword set covers each axis with several common phrasings:
            //   Budget: 予算 / コスト / 投資
            //   Authority: 決裁 / 決定 / 判断
            //   Timeline: 時期 / スケジュール / 導入 / いつ / までに
            responseContainsAny: ['予算', 'コスト', '投資', '決裁', '決定', '判断', '時期', 'スケジュール', '導入', 'いつ', 'までに'],
        },
    },
    self_long_pitch: {
        description: '自分が長尺のピッチを話し終える',
        turns: [
            {
                speaker: 'self',
                text: '弊社のソリューションは、御社の課題である業務の属人化を、テンプレート化と自動化で解決します。同業界での導入実績は20社以上です。',
                source: 'deepgram',
            },
        ],
        triggerText: '弊社のソリューションは、御社の課題である業務の属人化を、テンプレート化と自動化で解決します。同業界での導入実績は20社以上です。',
        expected: {
            fired: true,
            eventKind: 'self_finished',
            sectionsRequired: ['次に聞くとよいこと:'],
            // Self has just finished pitching; the next move is the opponent's,
            // so the AI must NOT preempt with another reply suggestion.
            sectionsForbidden: ['返答候補:'],
        },
    },
    opponent_pain_point: {
        description: '相手が課題感を吐露する',
        turns: [{ speaker: 'opponent', text: '実は、現場のエンジニアが疲弊していて、もう離職者も出ているんです。', source: 'gemini_live' }],
        triggerText: '実は、現場のエンジニアが疲弊していて、もう離職者も出ているんです。',
        expected: {
            fired: true,
            eventKind: 'opponent_finished',
            sectionsRequired: ['返答候補:'],
        },
    },
    // ── Phase 2.D scenarios (conversation-first suggestion policy) ─────
    // These pin the reframe: a single pain mention from opponent must NOT
    // trigger BANT-first questioning. Pair with bant_followup_after_pitch
    // (which intentionally stays — that scenario is the "Phase 2" timing
    // where BANT residuals are appropriate, after self has pitched).
    opponent_pain_then_dig_not_bant: {
        description: '相手が初めて pain 吐露 → AI は原因・影響・具体例を聞く（BANT へ飛ばない、Phase 2.D 核心）',
        turns: [{ speaker: 'opponent', text: '正直、現場のエンジニアが疲弊していて、離職も出ています。', source: 'gemini_live' }],
        triggerText: '正直、現場のエンジニアが疲弊していて、離職も出ています。',
        expected: {
            fired: true,
            eventKind: 'opponent_finished',
            sectionsRequired: ['返答候補:'],
            // Positive: response must contain a pain-deepening keyword
            // (digging into 事象 / 要因 / 影響 / 切迫度 / 既存対応).
            responseContainsAny: ['具体', '原因', '影響', '範囲', '頻度', 'どの', 'いつから', 'なぜ', '業務', '対応'],
            // Negative: response must NOT contain BANT-first phrasings.
            // Deliberately specific to BANT Authority/Budget/Timeline
            // surface forms — "関係者 / 関係部署" is impact-scope digging
            // and stays allowed (per the conversation-first policy nuance).
            responseContainsNone: ['ご予算', '予算規模', '決裁者', '決裁プロセス', '導入時期', '投資判断', 'スケジュール感'],
        },
    },
    opponent_mentions_budget: {
        description: '相手が自発的に予算に触れる → AI はその話題を自然に拾う（Phase 2.D 限定 BANT surfacing）',
        turns: [{ speaker: 'opponent', text: '予算は来期で500万くらいを想定しています。', source: 'gemini_live' }],
        triggerText: '予算は来期で500万くらいを想定しています。',
        expected: {
            fired: true,
            eventKind: 'opponent_finished',
            sectionsRequired: ['返答候補:'],
            // Should pick up the volunteered budget topic. Any of these
            // signals "AI noticed the budget mention and kept the thread".
            responseContainsAny: ['予算', '500', '来期', '想定', '投資', '範囲', 'ご予算'],
        },
    },
};

// ── Pure assertion helper. Exported so unit tests can drive it directly
//    without instantiating a harness. Mutates nothing.
function assertScenario(scenario, result, aiResponse, aiErrorKind) {
    const expected = scenario.expected || {};
    const checks = [];
    // When the AI call failed due to a rate-limit (Gemini Free Tier RPD), we
    // can still verify the deterministic decision logic (fired / eventKind /
    // classification) but the response-content assertions are meaningless.
    const skipResponseChecks = aiErrorKind === 'rate_limited';
    if (expected.fired !== undefined) {
        checks.push({ name: 'fired', expected: expected.fired, actual: result.fired, pass: result.fired === expected.fired });
    }
    if (expected.reason !== undefined) {
        checks.push({ name: 'reason', expected: expected.reason, actual: result.reason, pass: result.reason === expected.reason });
    }
    if (expected.eventKind !== undefined) {
        checks.push({ name: 'eventKind', expected: expected.eventKind, actual: result.eventKind, pass: result.eventKind === expected.eventKind });
    }
    if (expected.classification !== undefined) {
        checks.push({
            name: 'classification',
            expected: expected.classification,
            actual: result.classification,
            pass: result.classification === expected.classification,
        });
    }
    if (expected.sectionsRequired && Array.isArray(expected.sectionsRequired)) {
        if (!aiResponse) {
            if (skipResponseChecks) {
                checks.push({ name: 'sections', expected: expected.sectionsRequired, actual: 'rate_limited (skipped)', pass: true });
            } else if (expected.fired) {
                // Can't assert sections without a response — record as fail when we expected fire.
                checks.push({ name: 'sections', expected: expected.sectionsRequired, actual: 'no response captured', pass: false });
            }
        } else {
            for (const section of expected.sectionsRequired) {
                const present = aiResponse.includes(section);
                checks.push({ name: `section "${section}"`, expected: 'present', actual: present ? 'present' : 'missing', pass: present });
            }
        }
    }
    if (expected.sectionsForbidden && aiResponse) {
        for (const section of expected.sectionsForbidden) {
            const present = aiResponse.includes(section);
            checks.push({ name: `forbidden "${section}"`, expected: 'absent', actual: present ? 'present' : 'absent', pass: !present });
        }
    }
    // Loose semantic check: at least one of the listed keywords must appear in
    // the AI response. Used for BANT-style assertions where exact wording is
    // brittle but presence of the topic should be observable.
    if (expected.responseContainsAny && Array.isArray(expected.responseContainsAny)) {
        if (!aiResponse && skipResponseChecks) {
            checks.push({
                name: `responseContainsAny (${expected.responseContainsAny.join('|')})`,
                expected: 'at least one match',
                actual: 'rate_limited (skipped)',
                pass: true,
            });
        } else if (aiResponse) {
            const hits = expected.responseContainsAny.filter(kw => aiResponse.includes(kw));
            checks.push({
                name: `responseContainsAny (${expected.responseContainsAny.join('|')})`,
                expected: 'at least one match',
                actual: hits.length > 0 ? `matched: ${hits.join(',')}` : 'no match',
                pass: hits.length > 0,
            });
        }
    }
    // Negative semantic check: none of the listed keywords may appear in the
    // AI response. Used by Phase 2.D conversation-first scenarios to pin
    // "must NOT jump to BANT first" — e.g. when opponent has only just
    // mentioned a pain, the response must not contain "ご予算 / 決裁プロセス
    // / 導入時期" etc. Symmetric with responseContainsAny: rate-limited
    // explicitly skips with pass:true (so a missing response cannot
    // vacuously satisfy a negative assertion — that would let real
    // regressions hide behind a rate-limit error).
    if (expected.responseContainsNone && Array.isArray(expected.responseContainsNone)) {
        if (!aiResponse && skipResponseChecks) {
            checks.push({
                name: `responseContainsNone (${expected.responseContainsNone.join('|')})`,
                expected: 'no match',
                actual: 'rate_limited (skipped)',
                pass: true,
            });
        } else if (aiResponse) {
            const hits = expected.responseContainsNone.filter(kw => aiResponse.includes(kw));
            checks.push({
                name: `responseContainsNone (${expected.responseContainsNone.join('|')})`,
                expected: 'no match',
                actual: hits.length === 0 ? 'no match' : `unexpectedly matched: ${hits.join(',')}`,
                pass: hits.length === 0,
            });
        }
    }
    const allPass = checks.length > 0 && checks.every(c => c.pass);
    return { allPass, checks };
}

// ── Harness factory. All Electron-y dependencies are injected.
function createDevHarness(deps) {
    if (!deps) throw new Error('createDevHarness requires a deps object');
    const {
        turnEvents,
        processGenerationComplete,
        isAiResponseInFlight,
        getCurrentSystemPrompt,
        setCurrentSystemPrompt,
        getCurrentProfile,
        getCurrentCustomPrompt,
        getSystemPrompt,
        getConversationHistory,
        clearLastAiErrorKind,
        getLastAiErrorKind,
    } = deps;
    const now = deps.now || (() => Date.now());
    const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const fs = deps.fs || require('fs');
    const homedir = deps.homedir || require('os').homedir;
    // Override-able save path for tests / docs builds; default is the original
    // ~/cheating-daddy-dev-runs directory used by the live harness.
    const saveDir = deps.saveDir || (() => path.join(homedir(), 'cheating-daddy-dev-runs'));

    async function waitForAiResponse(timeoutMs = 60000) {
        const start = now();
        while (isAiResponseInFlight() && now() - start < timeoutMs) {
            await sleep(200);
        }
        if (isAiResponseInFlight()) {
            console.warn('[dev] waitForAiResponse timed out after', timeoutMs, 'ms');
            return false;
        }
        return true;
    }

    function saveDevRun(summary) {
        try {
            const dir = saveDir();
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${now()}-${summary.scenario}.json`);
            fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
            console.log(`[dev] saved: ${file}`);
            return file;
        } catch (e) {
            console.error('[dev] saveDevRun failed:', e.message);
            return null;
        }
    }

    async function runDevScenario(name) {
        const scenario = DEV_SCENARIOS[name];
        if (!scenario) {
            const keys = Object.keys(DEV_SCENARIOS).join(', ');
            console.warn(`[dev] unknown scenario "${name}". Available: ${keys}`);
            return { ok: false, error: 'unknown', available: Object.keys(DEV_SCENARIOS) };
        }
        console.log(`\n===== [dev scenario] ${name} =====`);
        console.log(`description: ${scenario.description}`);
        clearLastAiErrorKind();
        // Ensure currentSystemPrompt is populated. Without this, harness runs that
        // never started a Gemini Live session would fall back to "You are a helpful
        // assistant." and miss the Japanese / 2-section output rules baked into
        // buildSystemPrompt — which made early dev runs return free-form English.
        if (!getCurrentSystemPrompt()) {
            const seeded = getSystemPrompt(getCurrentProfile() || 'discovery', getCurrentCustomPrompt() || '', false);
            setCurrentSystemPrompt(seeded);
            console.log(`[dev] seeded currentSystemPrompt from profile=${getCurrentProfile() || 'discovery'} (${seeded.length} chars)`);
        }
        // Wait for any prior production response to drain so scenarios run truly
        // sequentially. DO NOT mutate the in-flight flag here — that would mask
        // real mutex behavior.
        if (isAiResponseInFlight()) {
            console.log('[dev] waiting for prior AI response to drain before starting');
            await waitForAiResponse(60000);
        }
        turnEvents.seedForDevScenario(scenario.turns);
        console.log(`[dev] turnEvents seeded: ${turnEvents.length}`);

        const conversationHistory = getConversationHistory();
        const beforeHistoryLen = conversationHistory.length;
        const result = processGenerationComplete(scenario.triggerText);
        console.log(
            `[dev] processGenerationComplete result:`,
            JSON.stringify(result, (k, v) => (k === 'prompt' ? `${(v || '').slice(0, 200)}…` : v))
        );

        let aiResponse = null;
        if (result.fired) {
            const drained = await waitForAiResponse(60000);
            const after = getConversationHistory();
            if (drained && after.length > beforeHistoryLen) {
                aiResponse = after[after.length - 1].ai_response || null;
            }
        }

        const aiErrorKind = getLastAiErrorKind(); // 'rate_limited' | 'error' | null
        const assertions = assertScenario(scenario, result, aiResponse, aiErrorKind);
        const summary = {
            ok: true,
            scenario: name,
            description: scenario.description,
            timestamp: now(),
            result,
            aiResponse,
            aiErrorKind,
            assertions,
        };
        const tag = aiErrorKind === 'rate_limited' ? 'SKIP (rate_limited)' : assertions.allPass ? 'PASS' : 'FAIL';
        console.log(`[dev] assertions ${tag}:`, JSON.stringify(assertions.checks));
        saveDevRun(summary);
        return summary;
    }

    function listScenarios() {
        return Object.entries(DEV_SCENARIOS).map(([name, def]) => ({
            name,
            description: def.description,
        }));
    }

    return {
        DEV_SCENARIOS,
        runDevScenario,
        waitForAiResponse,
        saveDevRun,
        listScenarios,
        // Re-exposed pure helper for parity with prior call sites / tests.
        assertScenario,
    };
}

module.exports = { createDevHarness, DEV_SCENARIOS, assertScenario };
