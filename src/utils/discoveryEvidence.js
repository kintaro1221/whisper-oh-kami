// discoveryEvidence.js — Phase 1.A Discovery 5-element evidence extraction.
//
// Pure CommonJS module with no Electron / Gemini / IPC dependencies — same
// shape as turnEvents.js. gemini.js holds the only instance via
// createDiscoveryEvidence() and re-pushes the snapshot to the renderer over
// the new `discovery-evidence-update` IPC channel whenever a turn matches.
//
// Goal: surface a Japanese-only progress bar for the 5 hearing elements that
// the Discovery / Sales prompts already track internally (see prompts.js
// L55-62 and the BANT block at L347-378). regex stays as the instant
// first-pass — LLM hybrid refinement (Phase 1.A+) lands via applyLLMResult()
// and overrides regex state when grounded against the transcript.
//
// Vocabulary policy: keyword / regex stay Japanese-focused with a small set
// of business acronyms (KPI / ROI / KGI / CVR) used verbatim in Japanese B2B
// speech. Generic English fallbacks (problem / deadline / cost) remain
// forbidden — the long tail of business vocabulary (利益率 / 継続率 / 単価 /
// NPS / シェア etc.) is delegated to LLM refinement, NOT to regex expansion.

'use strict';

const ELEMENT_KEYS = ['pain', 'kpi', 'authority', 'budget', 'timeline'];

// Partial: opponent mentioned the topic (keyword hit) but specifics may be
// missing. Filled: opponent quantified or named concrete decision-makers /
// dates / amounts. Both regex sets are evaluated against opponent.text only.
// KPI vocab is intentionally narrow (件 / 工数 / リードタイム / 稼働 / 商談数 /
// 受注率 etc.) — bare 日 / 月 / 年 belong to timeline, 円 / 万 / 億 to budget,
// and 人 / 人手 to pain. Letting any of those bleed into KPI causes "3月末" or
// "500万円" to falsely fill the KPI badge alongside the correct element.
const PARTIAL_PATTERNS = {
    pain: /困っ|悩|課題|問題|大変|疲弊|限界|属人|手作業|ミス|漏れ|失敗|遅[いれ]|止ま|追いつか|不足|離職|人手|人材/,
    // KPI / ROI / KGI literals are accepted because real B2B Japanese
    // transcripts use these acronyms verbatim. The actual figure (利益率,
    // CVR, 継続率, 単価, NPS, シェア etc.) is left to LLM refinement.
    kpi: /件|工数|リードタイム|稼働|商談数|受注率|解約率|離職率|CVR|工程|業務量|処理量|生産性|時間|KPI|ROI|KGI/,
    // 決済 is accepted as an STT homophone of 決裁 — Deepgram nova-3 commonly
    // mis-transcribes 決裁 as 決済 in Japanese business speech.
    authority: /決裁|決済|決定|承認|役員|取締役|部長|課長|マネージャ|社長|稟議|経営会議|常務|専務|本部長|関係部署/,
    budget: /予算|コスト|費用|投資|ROI|回収|償却|申請|稟議枠|既存予算/,
    timeline: /来月|今期|期末|来年度|上期|下期|Q[1-4]|期限|締切|スケジュール|急ぎ|緊急|までに|今年中|年内/,
};

// Numeric matchers accept either ASCII digits or 漢数字 (一二三四五六七八九十百千万億).
// Real Japanese sales speech mixes both forms ("一千万円" vs "10000000円").
const FILLED_PATTERNS = {
    pain: /(?:営業|経理|開発|人事|総務|事務|現場|工場|店舗|物流|サポート|顧客対応|採用|請求|決算|月次|年次).{0,20}(?:困|大変|疲弊|属人|遅|止|手作業|ミス|漏れ)|できない|難しい/,
    kpi: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:件|時間|工数|％|%)/,
    authority: /(?:役員|取締役|部長|課長|マネージャ|社長|常務|専務|本部長).{0,12}(?:が|は|で)?(?:決め|決裁(?:し|す|され)|判断|承認|です|になり|担当)/,
    budget: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:円|万円|千万|億|億円)/,
    timeline:
        /(?:\d+|[一二三四五六七八九十百千万億]+)\s*月(?:末|まで|頃)?|\d+\/\d+|(?:\d+|[一二三四五六七八九十百千万億]+)\s*年度|までに.{0,20}(?:したい|必要|決めたい|入れたい)/,
};

// ── Polarity (v0.7.5): a concrete match inside a negated / hypothetical /
// third-party sentence must NOT count as detection. The patterns are
// deliberately narrow and Japanese-specific; anything they miss falls
// through to the old behaviour (detected), which the LLM refiner or the
// user's manual retract can still correct.
//
// Everything below is evaluated per SENTENCE (split on 。．！？!? and
// newlines), never on the whole utterance: 「はい、問題ありません。予算は
// 500万円です」 must not let the first sentence's wording tag the budget
// stated in the second.
const SENTENCE_SPLIT_RE = /[。．！？!?\n]+/;

function splitSentences(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .split(SENTENCE_SPLIT_RE)
        .map(s => s.trim())
        .filter(Boolean);
}

const NEGATION_RE =
    /ではな[いく]|じゃな[いく]|わけではな|ありません|ございません|未定|白紙|決まって(?:い)?ません|まだ(?:決|な)|ない(?:です|ので|んです)?[。．、]?$/;
// Set phrases that contain a negative form but are agreement / politeness,
// not a negation of the stated value. Removed before NEGATION_RE runs.
const NEGATION_EXCLUSION_RE =
    /問題(?:は)?(?:ありません|ございません|ない(?:です)?)|申し訳(?:ございません|ありません|ない)|間違い(?:は)?(?:ありません|ございません|ない(?:です)?)|構いません|差し支え(?:は)?(?:ありません|ございません)/g;
const HYPOTHETICAL_RE = /仮に|もし(?:も)?|例えば|たとえば|だとしたら|とすれば|であれば|あれば/;
// Polite requests, not hypothetical framing. Removed before HYPOTHETICAL_RE.
const HYPOTHETICAL_EXCLUSION_RE = /もし(?:よければ|よろしければ|良ければ)/g;
// (?<!晴)らしい / (?<!て)みたい keep 「素晴らしい」 and 「試してみたい」 out of
// the third-party bucket.
const THIRD_PARTY_RE =
    /他社|隣の|よそ|別の会社|別会社|他の会社|ほかの会社|競合他社|同業|競合|(?<!晴)らしい|と聞い|と聞き|と伺|とのこと|だそう|(?<!て)みたい/;
// 忘れて only as an explicit request to disregard (「忘れてください」); a
// speaker who 「伝え忘れて / 言い忘れて」 something is adding it, not
// retracting it.
const RETRACTION_RE = /撤回|取り消|取消|やっぱり(?:な|や)|なしに|白紙に|(?<!伝え|言い)忘れて(?:ください|いただいて|もらって)|無かったこと/;

// A whole-utterance correction that says every figure so far belonged to
// someone else (「すべてその別会社の話です」) or that the speaker's own case
// is entirely undecided (「当社の案件は各項目とも未定です」). Retracts every
// live concrete row in every element. The "other company" form must end
// the sentence so 「他社の話ですが、…」 (an aside that continues) does not
// wipe the board; the 「当社は…未定」 form only counts when the sentence
// names no single element (「当社は予算が未定です」 is a budget negation).
const GLOBAL_OTHER_COMPANY_RE =
    /(?:すべて|全部|いずれも|どれも)?(?:その|あの)?(?:別会社|他社|別の会社|よそ|他の会社)の話(?:です|でした|だ|になります)?(?:よ|ね)?$/;
const GLOBAL_OWN_UNDECIDED_RE = /当社(?:の案件)?は.{0,12}(?:未定|白紙|決まって(?:い)?ません)/;

// Precedence: hypothetical > third_party > negated. A sentence that frames
// a figure as hypothetical or as someone else's number often goes on to
// state the speaker's own position in the negative ("…まだ予算はありま
// せん" / "…弊社の予算は未定です"); the framing of the concrete figure is
// what the tag should describe, so the more specific tags win.
function classifyPolarity(text) {
    if (!text || typeof text !== 'string') return null;
    if (HYPOTHETICAL_RE.test(text.replace(HYPOTHETICAL_EXCLUSION_RE, ''))) return 'hypothetical';
    if (THIRD_PARTY_RE.test(text)) return 'third_party';
    if (NEGATION_RE.test(text.replace(NEGATION_EXCLUSION_RE, ''))) return 'negated';
    return null;
}

function isRetraction(text) {
    return !!text && typeof text === 'string' && RETRACTION_RE.test(text);
}

// Pain is itself voiced in the negative (「できない」「減らない」「余裕があり
// ません」), so the 'negated' tag would downgrade the very signal it should
// detect. Negation therefore only applies to the value-bearing elements;
// hypothetical / third-party framing still applies to pain.
function effectivePolarity(key, polarity) {
    if (key === 'pain' && polarity === 'negated') return null;
    return polarity;
}

// An automatic (regex) retraction only touches the element the speaker
// names, and only inside the sentence that carries the retraction phrase:
//   1. If the part of that sentence BEFORE the retraction keyword states a
//      concrete value of some element (「80万円の予算は…撤回」), exactly the
//      element(s) whose value is stated there are retracted — topic words
//      are ignored, so 「承認が取り消された」 does not drag the authority in.
//   2. Otherwise a topic word before the keyword names the element
//      (「先ほどの予算は撤回します」).
// Text after the keyword is the correction and never names a target.
// 「先ほどの件は撤回します」 names nothing and retracts nothing — the user
// can still retract manually.
const RETRACTION_TOPIC_PATTERNS = {
    pain: /課題|問題/,
    kpi: /件数|KPI|数字|工数|目標|指標/,
    authority: /決裁|承認|判断|決め/,
    budget: /予算|金額|費用|コスト/,
    timeline: /期限|時期|スケジュール|納期|日程|期日/,
};

// Splits a sentence at its first retraction keyword. `before` is where the
// retracted value is named; `after` is where a corrected value lives
// (「500万円は撤回して、300万円でお願いします」). null when the sentence
// carries no retraction phrase.
function splitAtRetraction(sentence) {
    const m = RETRACTION_RE.exec(sentence || '');
    if (!m) return null;
    return { before: sentence.slice(0, m.index), after: sentence.slice(m.index + m[0].length) };
}

function retractionNamesElement(key, sentence) {
    const parts = splitAtRetraction(sentence);
    if (!parts) return false;
    const valueKeys = ELEMENT_KEYS.filter(k => FILLED_PATTERNS[k].test(parts.before));
    if (valueKeys.length > 0) return valueKeys.includes(key);
    return RETRACTION_TOPIC_PATTERNS[key].test(parts.before);
}

function isGlobalCorrection(sentence) {
    if (!sentence) return false;
    if (GLOBAL_OTHER_COMPANY_RE.test(sentence)) return true;
    if (GLOBAL_OWN_UNDECIDED_RE.test(sentence)) {
        return !ELEMENT_KEYS.some(k => RETRACTION_TOPIC_PATTERNS[k].test(sentence));
    }
    return false;
}

// 「成功目標は30％ではなく10％削減に訂正します」: a value of the same element
// on both sides of ではなく is a correction to the second value, not a
// negation. Returns the text after ではなく when it applies (and reads
// neutral), else null — a value on one side only stays a plain negation.
function correctionAfterDewanaku(key, sentence) {
    const idx = sentence.indexOf('ではなく');
    if (idx < 0) return null;
    const before = sentence.slice(0, idx);
    const after = sentence.slice(idx + 'ではなく'.length);
    if (!FILLED_PATTERNS[key].test(before) || !FILLED_PATTERNS[key].test(after)) return null;
    if (effectivePolarity(key, classifyPolarity(after))) return null;
    return after;
}

const MAX_EVIDENCE_PER_ELEMENT = 10;

// Quote-grounding normalizer: strips whitespace and Japanese / ASCII
// punctuation so STT and LLM rephrasings of the same quote still match
// against the underlying transcript. Used by quoteIsGrounded() to defend
// against LLM hallucinations (the LLM occasionally invents quotes that
// were not actually said).
const GROUNDING_NORMALIZE_RE = /[\s　、。．，「」『』()（）\[\]【】〈〉《》]/g;

function normalizeForGrounding(s) {
    if (typeof s !== 'string') return '';
    return s.replace(GROUNDING_NORMALIZE_RE, '');
}

function quoteIsGrounded(quote, transcript) {
    const nq = normalizeForGrounding(quote);
    if (nq.length === 0) return false;
    const nt = normalizeForGrounding(transcript);
    return nt.includes(nq);
}

// The transcript sentence that carries an LLM quote — polarity is judged
// on it, not on the (often trimmed) quote: 「広告費は100万円」 quoted from
// 「隣の会社の広告費は100万円らしいです」 is third-party. When the quote
// occurs more than once the latest occurrence wins; when it spans
// sentences, the quote itself is used.
function sentenceContainingQuote(quote, transcript) {
    const nq = normalizeForGrounding(quote);
    if (!nq) return null;
    const sentences = splitSentences(transcript);
    for (let i = sentences.length - 1; i >= 0; i--) {
        if (normalizeForGrounding(sentences[i]).includes(nq)) return sentences[i];
    }
    return null;
}

// True when the quote is the text (or one sentence of the text) of a row
// that has been retracted for this element — the LLM must not resurrect a
// value the customer or the user already withdrew.
function quoteMatchesRetractedRow(element, quote) {
    const nq = normalizeForGrounding(quote);
    if (!nq) return false;
    return element.evidence.some(
        e => e.retracted && (normalizeForGrounding(e.text) === nq || splitSentences(e.text).some(s => normalizeForGrounding(s) === nq))
    );
}

function createInitialState() {
    return ELEMENT_KEYS.reduce((acc, key) => {
        acc[key] = { status: 'empty', evidence: [], selfMentions: [], lastUpdate: null, confirmed: false };
        return acc;
    }, {});
}

// Returns `'concrete'` (filled hit), `'keyword'` (partial hit only), or null.
function matchElement(key, text) {
    if (!text || typeof text !== 'string') return null;
    if (FILLED_PATTERNS[key].test(text)) return 'concrete';
    if (PARTIAL_PATTERNS[key].test(text)) return 'keyword';
    return null;
}

// Status precedence: confirmed (user action) > detected (live concrete row
// with neutral polarity) > partial (any live row) > empty. Retracted rows
// never count; polarity-tagged rows count only as partial.
function computeStatus(element) {
    if (element.confirmed) return 'confirmed';
    const live = element.evidence.filter(e => !e.retracted);
    if (live.length === 0) return 'empty';
    if (live.some(e => e.specificity === 'concrete' && !e.polarity)) return 'detected';
    return 'partial';
}

function deepCloneState(state) {
    return ELEMENT_KEYS.reduce((acc, key) => {
        acc[key] = {
            status: state[key].status,
            evidence: state[key].evidence.map(e => ({ ...e })),
            selfMentions: state[key].selfMentions.map(e => ({ ...e })),
            lastUpdate: state[key].lastUpdate,
            confirmed: state[key].confirmed,
        };
        return acc;
    }, {});
}

function totalScore(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'detected' || state[key].status === 'confirmed').length;
}

function confirmedCount(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'confirmed').length;
}

function createDiscoveryEvidence(options = {}) {
    const now = options.now || (() => Date.now());
    let state = createInitialState();

    function dump() {
        return {
            elements: deepCloneState(state),
            totalScore: totalScore(state),
            confirmedCount: confirmedCount(state),
            updatedAt: now(),
        };
    }

    // Row ranking inside one utterance: a neutral concrete statement beats a
    // tagged concrete one, which beats a bare keyword mention.
    function rowRank(specificity, polarity) {
        return (specificity === 'concrete' ? 2 : 0) + (polarity ? 0 : 1);
    }

    // Opponent turn for one element, walked sentence by sentence so that
    // polarity, retraction and corrections are decided from the sentence
    // that actually carries the element. Within a run of ordinary sentences
    // only the strongest match becomes a row (one row per element per
    // utterance segment, as before). Returns true when the element changed.
    function applyOpponentSentences(key, sentences, text, ts) {
        const el = state[key];
        let touched = false;
        let pending = null;
        const push = row => {
            el.evidence.push({ text, timestamp: ts, source: 'regex', retracted: false, ...row });
            touched = true;
        };
        const flush = () => {
            if (!pending) return;
            push({ specificity: pending.specificity, polarity: pending.polarity });
            pending = null;
        };

        for (const sentence of sentences) {
            if (isGlobalCorrection(sentence)) {
                flush();
                // Every live concrete row of every element belonged to
                // someone else / is undecided. Never clears `confirmed`.
                const live = el.evidence.filter(e => !e.retracted && e.specificity === 'concrete');
                if (live.length === 0) continue;
                for (const e of live) e.retracted = true;
                push({ specificity: 'keyword', polarity: 'retraction' });
                continue;
            }

            const parts = splitAtRetraction(sentence);
            if (parts && retractionNamesElement(key, sentence)) {
                const hadLive = !!pending || el.evidence.some(e => !e.retracted);
                if (!hadLive && !matchElement(key, sentence)) continue;
                flush();
                // Automatic retraction never clears `confirmed` — only the
                // user's retractElement() does.
                for (const e of el.evidence) e.retracted = true;
                push({ specificity: 'keyword', polarity: 'retraction' });
                if (FILLED_PATTERNS[key].test(parts.after) && !effectivePolarity(key, classifyPolarity(parts.after))) {
                    push({ specificity: 'concrete', polarity: null });
                }
                continue;
            }

            if (correctionAfterDewanaku(key, sentence) !== null) {
                flush();
                for (const e of el.evidence) {
                    if (!e.retracted && e.specificity === 'concrete') e.retracted = true;
                }
                push({ specificity: 'concrete', polarity: null });
                continue;
            }

            const specificity = matchElement(key, sentence);
            if (!specificity) continue;
            const polarity = effectivePolarity(key, classifyPolarity(sentence));
            const candidate = { specificity: polarity ? 'keyword' : specificity, polarity, rank: rowRank(specificity, polarity) };
            if (!pending || candidate.rank > pending.rank) pending = candidate;
        }
        flush();

        if (!touched) return false;
        if (el.evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
            el.evidence = el.evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
        }
        el.status = computeStatus(el);
        return true;
    }

    function processNewTurn(event) {
        if (!event || !event.text) return { state: dump(), changed: false };
        const speaker = event.speaker;
        if (speaker !== 'opponent' && speaker !== 'self') {
            return { state: dump(), changed: false };
        }
        const text = String(event.text).trim();
        if (!text) return { state: dump(), changed: false };
        const ts = event.timestamp != null ? event.timestamp : now();

        let anyMatch = false;
        const sentences = speaker === 'opponent' ? splitSentences(text) : [];

        for (const key of ELEMENT_KEYS) {
            if (speaker === 'opponent') {
                if (!applyOpponentSentences(key, sentences, text, ts)) continue;
                anyMatch = true;
            } else {
                const specificity = matchElement(key, text);
                if (!specificity) continue;
                anyMatch = true;
                // speaker === 'self' — track to selfMentions channel only.
                // No source field (always regex here); no status mutation
                // (status reflects opponent-confirmed evidence per Phase 2.B
                // contract — self never upgrades the badge).
                state[key].selfMentions.push({ text, timestamp: ts, specificity });
                if (state[key].selfMentions.length > MAX_EVIDENCE_PER_ELEMENT) {
                    state[key].selfMentions = state[key].selfMentions.slice(-MAX_EVIDENCE_PER_ELEMENT);
                }
            }
            state[key].lastUpdate = ts;
        }

        return { state: dump(), changed: anyMatch };
    }

    // Apply LLM refinement output. llmResult shape:
    //   { pain: { status, quote }, kpi: ..., authority: ..., budget: ..., timeline: ... }
    // (The LLM schema stays 'empty' | 'partial' | 'filled'.) Each element
    // with status 'partial' or 'filled' contributes a new evidence row IFF
    // the quote can be grounded against the supplied transcript; 'filled'
    // maps to store status 'detected' unless the transcript sentence that
    // carries the quote has a polarity tag. A quote equal to an already
    // retracted row of the element is ignored (no resurrection). status 'empty' retracts rows ONLY when its quote is grounded,
    // reads as a negation / retraction, and live concrete evidence exists —
    // otherwise it is a no-op (regex remains the floor). It never clears a
    // user confirmation.
    function applyLLMResult(llmResult, transcript) {
        if (!llmResult || typeof llmResult !== 'object') {
            return { state: dump(), changed: false };
        }
        const ts = now();
        const transcriptStr = typeof transcript === 'string' ? transcript : '';
        let anyChange = false;
        for (const key of ELEMENT_KEYS) {
            const r = llmResult[key];
            if (!r || typeof r !== 'object') continue;
            const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
            if (r.status === 'empty') {
                // Grounded downgrade only: the quote must exist in the
                // transcript AND read as a negation / retraction.
                if (!quote || !quoteIsGrounded(quote, transcriptStr)) continue;
                if (!(isRetraction(quote) || effectivePolarity(key, classifyPolarity(quote)) === 'negated')) continue;
                const hadLive = state[key].evidence.some(e => !e.retracted && e.specificity === 'concrete');
                if (!hadLive) continue;
                // Retract the rows but keep a user confirmation intact.
                for (const e of state[key].evidence) e.retracted = true;
                state[key].evidence.push({
                    text: quote,
                    timestamp: ts,
                    specificity: 'keyword',
                    source: 'llm',
                    polarity: 'retraction',
                    retracted: false,
                });
            } else if (r.status === 'partial' || r.status === 'filled') {
                if (!quote || !quoteIsGrounded(quote, transcriptStr)) continue;
                if (quoteMatchesRetractedRow(state[key], quote)) continue;
                const context = sentenceContainingQuote(quote, transcriptStr) || quote;
                const polarity = effectivePolarity(key, classifyPolarity(context));
                const specificity = r.status === 'filled' && !polarity ? 'concrete' : 'keyword';
                state[key].evidence.push({ text: quote, timestamp: ts, specificity, source: 'llm', polarity, retracted: false });
            } else {
                continue;
            }
            if (state[key].evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
                state[key].evidence = state[key].evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
            }
            state[key].status = computeStatus(state[key]);
            state[key].lastUpdate = ts;
            anyChange = true;
        }
        return { state: dump(), changed: anyChange };
    }

    // Manual user actions (v0.7.5). Only the user can promote an element to
    // 'confirmed'; automatic detection tops out at 'detected'.
    function confirmElement(key) {
        if (!ELEMENT_KEYS.includes(key)) return { state: dump(), changed: false };
        if (state[key].confirmed) return { state: dump(), changed: false };
        state[key].confirmed = true;
        state[key].status = computeStatus(state[key]);
        state[key].lastUpdate = now();
        return { state: dump(), changed: true };
    }

    function retractElement(key, reason = 'manual') {
        if (!ELEMENT_KEYS.includes(key)) return { state: dump(), changed: false };
        const el = state[key];
        const hadAnything = el.confirmed || el.evidence.some(e => !e.retracted);
        if (!hadAnything) return { state: dump(), changed: false };
        for (const e of el.evidence) e.retracted = true;
        el.confirmed = false;
        el.status = computeStatus(el);
        el.lastUpdate = now();
        el.evidence.push({
            text: `[${reason}]`,
            timestamp: el.lastUpdate,
            specificity: 'keyword',
            source: 'user',
            polarity: 'retraction',
            retracted: true,
        });
        if (el.evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
            el.evidence = el.evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
        }
        return { state: dump(), changed: true };
    }

    function getState() {
        return dump();
    }

    function reset() {
        state = createInitialState();
    }

    return {
        processNewTurn,
        applyLLMResult,
        confirmElement,
        retractElement,
        getState,
        dump,
        reset,
        get totalScore() {
            return totalScore(state);
        },
    };
}

module.exports = {
    createDiscoveryEvidence,
    ELEMENT_KEYS,
    matchElement,
    normalizeForGrounding,
    quoteIsGrounded,
    classifyPolarity,
    splitSentences,
    retractionNamesElement,
    isGlobalCorrection,
    isRetraction,
    computeStatus,
    RETRACTION_TOPIC_PATTERNS,
    PARTIAL_PATTERNS,
    FILLED_PATTERNS,
    MAX_EVIDENCE_PER_ELEMENT,
};
