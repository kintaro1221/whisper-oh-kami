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

// Concrete pain, second form: a symptom stated together with a frequency /
// volume / process marker in the same sentence, in either order
// (「毎週入力ミスが起きています」「手入力に5時間かかって困っています」
// 「受信箱に分散していて、返信漏れが出ています」). A bare symptom
// (「ミスが心配です」) has no marker and stays a keyword hit. Words listed in
// both sets (手作業 / 属人 / 分散 …) need two separate occurrences, since the
// symptom and the marker cannot overlap.
const PAIN_DEPARTMENT_RE =
    /(?:営業|経理|開発|人事|総務|事務|現場|工場|店舗|物流|サポート|顧客対応|採用|請求|決算|月次|年次).{0,20}(?:困|大変|疲弊|属人|遅|止|手作業|ミス|漏れ)|できない|難しい/;
const PAIN_SYMPTOM_RE = /困|大変|疲弊|属人|遅れ|止ま|手作業|手入力|二重入力|ミス|漏れ|分散|滞|抜け|重複|手間|工数がかか|時間がかか/;
const PAIN_MARKER_RE = /毎日|毎週|毎月|月\d+件|週\d+件|(?:週|月|日)\d+回|\d+件|\d+人|二重|手入力|手作業|分散|属人/;
const PAIN_SYMPTOM_WITH_MARKER_SRC =
    `(?:${PAIN_SYMPTOM_RE.source}).{0,30}(?:${PAIN_MARKER_RE.source})` + `|(?:${PAIN_MARKER_RE.source}).{0,30}(?:${PAIN_SYMPTOM_RE.source})`;

// Relative deadline forms a customer states as a commitment (「今月30日」
// 「来月末」「年内」「2週間以内」). Kept as said — resolving them to absolute
// dates is a display concern, not detection.
const TIMELINE_ABSOLUTE_RE =
    /(?:\d+|[一二三四五六七八九十百千万億]+)\s*月(?:末|まで|頃)?|\d+\/\d+|(?:\d+|[一二三四五六七八九十百千万億]+)\s*年度|までに.{0,20}(?:したい|必要|決めたい|入れたい)/;
const TIMELINE_RELATIVE_RE =
    /(?:今月|来月|再来月|翌月)\s*(?:\d+|[一二三四五六七八九十]+)\s*日|(?:今月|来月|再来月)末|今月中|年内|今年中|今期中|来期(?:中|初|末)|上期末|下期末|(?:\d+|[一二三四五六七八九十]+)\s*週間以内|(?:\d+|[一二三四五六七八九十]+)\s*[かヶケカ]?月以内/;

// Numeric matchers accept either ASCII digits or 漢数字 (一二三四五六七八九十百千万億).
// Real Japanese sales speech mixes both forms ("一千万円" vs "10000000円").
const FILLED_PATTERNS = {
    pain: new RegExp(`${PAIN_DEPARTMENT_RE.source}|${PAIN_SYMPTOM_WITH_MARKER_SRC}`),
    kpi: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:件|時間|工数|％|%)/,
    authority: /(?:役員|取締役|部長|課長|マネージャ|社長|常務|専務|本部長).{0,12}(?:が|は|で)?(?:決め|決裁(?:し|す|され)|判断|承認|です|になり|担当)/,
    budget: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:円|万円|千万|億|億円)/,
    timeline: new RegExp(`${TIMELINE_ABSOLUTE_RE.source}|${TIMELINE_RELATIVE_RE.source}`),
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
    /ではな[いく]|じゃな[いく]|わけではな|ありません|ございません|未定|白紙|決まって(?:い)?ません|決められません|決まりません|まだ(?:決|な)|ない(?:です|ので|んです)?[。．、]?$/;
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
// Hearsay from inside the customer's own organization (「別の部門では年間
// 80万円と聞いています」) is the customer's own figure, not someone else's:
// a hearsay marker alone does not make it third-party when the sentence
// names an internal unit and no outside party (v0.7.8 T8).
const THIRD_PARTY_EXTERNAL_RE = /他社|隣の|よそ|別の会社|別会社|他の会社|ほかの会社|競合他社|同業|競合/;
const INTERNAL_SOURCE_RE = /部門|部署|事業部|本部|社内|弊社|当社|自社/;
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
    if (THIRD_PARTY_RE.test(text) && (THIRD_PARTY_EXTERNAL_RE.test(text) || !INTERNAL_SOURCE_RE.test(text))) return 'third_party';
    if (NEGATION_RE.test(text.replace(NEGATION_EXCLUSION_RE, ''))) return 'negated';
    return null;
}

function isRetraction(text) {
    return !!text && typeof text === 'string' && RETRACTION_RE.test(text);
}

// Pain is itself voiced in the negative (「できない」「減らない」「余裕があり
// ません」), so the 'negated' tag would downgrade the very signal it should
// detect. Negation therefore only applies to pain when the sentence denies
// the symptom itself (「毎週ミスが出ているわけではありません」「困っては
// いません」「ミスは起きていません」); hypothetical / third-party framing
// always applies to pain. The denial forms are narrow on purpose: a bare
// 「出ていない」 is itself a pain (「成果が出ていない」), so the verb form
// only counts after a symptom noun.
const PAIN_DENIAL_RE =
    /(?:わけ|ほど)(?:では|じゃ)(?:な|あり|ござ)|困って(?:は|も)?(?:い)?(?:ません|ない)|(?:ミス|漏れ|遅れ|抜け|重複|トラブル)(?:は|が|も)?(?:特に)?(?:起きて|出て|発生して)(?:は|も)?(?:い)?(?:ません|ない)/;

function effectivePolarity(key, polarity, sentence) {
    if (key === 'pain') {
        const denied = typeof sentence === 'string' && PAIN_DENIAL_RE.test(sentence);
        // NEGATION_RE does not catch every denial (「…いません」), so a pain
        // denial is tagged here even when classifyPolarity found none.
        if (polarity === 'negated' || polarity === null) return denied ? 'negated' : null;
    }
    return polarity;
}

// ── Qualifiers (v0.7.8): a neutral concrete statement (polarity null) can
// still be short of a commitment. Three kinds:
//   tentative    — unapproved / proposed / wished / not agreed
//                  (「申請する案」「希望としては」「合意しておらず」) → candidate
//   current      — a KPI's present value with no target (「いまの転換率は8％」)
//                  → partial only
//   sales_action — a date the customer sets for the SELLER's deliverable
//                  (「提案資料は10月15日までに送ってください」) → goes to the
//                  element's `actions` channel, never to timeline evidence
// Polarity always wins: a hypothetical / third-party / negated sentence
// never gets a qualifier. 「仮に」 is hypothetical (HYPOTHETICAL_RE), so
// TENTATIVE_RE excludes it.
const TENTATIVE_RE =
    /仮(?!に|説|想|定|名|払|設)|未申請|未承認|申請も承認もこれから|承認はこれから|申請する案|検討中|社内検討|(?<!提)案です|(?<!提)案として|希望として|希望です|使い始めたい|したいと(?:考え|思っ)|合意しておらず|未合意|合意は(?:まだ|これから)|変更になるかも|変わるかも|変更の可能性|確定ではな|決定ではな/;
// A following sentence of the same utterance that points back at the value
// sentence (「ただ、その時期は…」「それは…」).
const REFERENCE_RE =
    /^(?:ただ|ただし|なお|しかし)?[、,]?\s*(?:その|この)(?:時期|日程|金額|額|予算|数字|件)|^(?:ただ|ただし)?[、,]?\s*それ(?:は|も|が)/;
// いま only as the word 「いま」, never inside a verb ending: 「処理して
// います」「100人いまして」 must not read as a current value.
const KPI_CURRENT_RE = /現在|(?<![てで])いま(?![すせし])|今の|現状|現時点|足元|これまで/;
const KPI_TARGET_RE = /目標|以上|以下|にする|達成|合意|成功指標|KPI|ゴール/;
const SALES_ACTION_RE = /資料|提案書|見積|お見積|送って|送付|提出|お送り|ご提出|ご提案/;
// The hearsay part of THIRD_PARTY_RE. A sentence that reaches
// classifyQualifier has polarity null, so a hearsay marker here means
// in-house hearsay (「別の部門では年間80万円と聞いています」): the customer's
// own figure, but second-hand — a candidate, never detected (v0.7.8 spec
// decision 1).
const HEARSAY_RE = /と聞い|と聞き|と伺|とのこと|だそう|(?<!晴)らしい/;

// `utteranceSentences[index] === sentence`; reference resolution only looks
// at the next two sentences of the same utterance.
function classifyQualifier(key, sentence, utteranceSentences = [sentence], index = 0) {
    if (!sentence) return null;
    if (key === 'timeline' && SALES_ACTION_RE.test(sentence)) return 'sales_action';
    if (key === 'kpi' && KPI_CURRENT_RE.test(sentence) && !KPI_TARGET_RE.test(sentence)) return 'current';
    if (HEARSAY_RE.test(sentence)) return 'tentative';
    if (TENTATIVE_RE.test(sentence)) return 'tentative';
    for (let i = index + 1; i < Math.min(utteranceSentences.length, index + 3); i++) {
        const next = utteranceSentences[i];
        if (REFERENCE_RE.test(next) && TENTATIVE_RE.test(next)) return 'tentative';
    }
    return null;
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

// The parsed amounts of a budget row's values (v0.7.8): every amount the
// sentence states (`values.amounts`), each with its own period / scope.
// Values without `amounts` fall back to the single `amount`. [] when none.
function amountEntries(values) {
    if (!values || typeof values !== 'object') return [];
    if (Array.isArray(values.amounts) && values.amounts.length > 0) {
        return values.amounts.filter(a => a && Number.isFinite(a.yen));
    }
    if (!values.amount || !Number.isFinite(values.amount.yen)) return [];
    return [{ text: values.amountText, yen: values.amount.yen, period: values.amount.period, scope: values.amount.scope }];
}

// Budget rows a retraction targets by amount: the text before the
// retraction keyword states an amount (「100万円の方は撤回します」).
//   { rows }            — some, not all, live concrete rows state it
//   { ambiguous: true } — it is stated as more than one distinct value
//                         (「初期費用50万円」 and 「月額50万円」): the store
//                         does not guess which one the customer meant
//                         (spec decision 3). Restatements of the same value
//                         (same amount, period and scope) are one value,
//                         not an ambiguity.
//   null                — no amount named, nothing matches, or every live
//                         row matches: the whole element is withdrawn.
function rowsStatingAmount(el, text) {
    const found = findAmount(toHalfWidth(text || ''));
    if (!found) return null;
    const live = el.evidence.filter(e => isLiveRow(e) && e.specificity === 'concrete' && amountEntries(e.values).length > 0);
    const hits = [];
    const meanings = new Set();
    for (const e of live) {
        const matching = amountEntries(e.values).filter(a => a.yen === found.yen);
        if (matching.length === 0) continue;
        hits.push(e);
        for (const a of matching) meanings.add(`${a.period || ''}|${a.scope || ''}`);
    }
    if (hits.length === 0) return null;
    if (meanings.size > 1) return { ambiguous: true };
    if (hits.length === live.length) return null;
    return { rows: hits };
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
    if (effectivePolarity(key, classifyPolarity(after), after)) return null;
    return after;
}

// ── Values (v0.7.8): every row carries the value its sentence states,
// parsed for comparison only. Display always stays the original wording
// (`raw` / `amountText`); relative dates and amounts are never resolved to
// absolute values for display.
const KANJI_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNITS = { 十: 10, 百: 100, 千: 1000 };
const KANJI_BIG = { 万: 1e4, 億: 1e8 };

function toHalfWidth(s) {
    return String(s)
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/，/g, ',')
        .replace(/．/g, '.');
}

// 「一千万」→ 10,000,000, 「三百」→ 300, 「十二」→ 12, 「二〇」→ 20,
// 「1,000」/「１０」→ Number. NaN when the text is not a number.
function kanjiToNumber(s) {
    if (s == null) return NaN;
    const str = toHalfWidth(s).replace(/,/g, '').trim();
    if (!str) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(str)) return Number(str);
    let total = 0;
    let section = 0;
    let current = 0;
    for (const t of str.match(/\d+(?:\.\d+)?|\D/g)) {
        if (/^\d/.test(t)) current = Number(t);
        else if (t in KANJI_DIGITS) current = current * 10 + KANJI_DIGITS[t];
        else if (t in KANJI_UNITS) {
            section += (current || 1) * KANJI_UNITS[t];
            current = 0;
        } else if (t in KANJI_BIG) {
            total += (section + current || 1) * KANJI_BIG[t];
            section = 0;
            current = 0;
        } else return NaN;
    }
    return total + section + current;
}

const AMOUNT_NUM_SRC = '\\d+(?:,\\d{3})*(?:\\.\\d+)?|[一二三四五六七八九十百千〇零]+';
const AMOUNT_UNIT_YEN = { 億円: 1e8, 億: 1e8, 千万円: 1e7, 千万: 1e7, 万円: 1e4, 万: 1e4, 円: 1 };
// 「1億2000万円」 is one amount; 「数百万円」「何万円」 are vague and skipped.
const AMOUNT_RE = new RegExp(
    `(?<![数何幾\\d.,])(?:(${AMOUNT_NUM_SRC})\\s*億(?:\\s*(${AMOUNT_NUM_SRC})\\s*(千万|万))?\\s*円?` +
        `|(${AMOUNT_NUM_SRC})\\s*(千万円|千万|万円|万|円))`,
    'g'
);
// A bare 万 / 億 without 円 followed by a counter is a count (「1万件」).
const AMOUNT_COUNTER_RE = /^[件人回個社台本枚通時名]/;
const PERIOD_ANNUAL_RE = /年間|年額|\/年|年あたり|年ごと/g;
const PERIOD_MONTHLY_RE = /月額|月々|毎月|\/月|月あたり/g;
const PERIOD_ONE_TIME_RE = /初期費用|初期|導入費|イニシャル|一括|初回/g;
const SCOPE_RECURRING_RE = /月額|年額|ランニング|保守|利用料|サブスク/;
// A subset / breakdown of a larger figure (「そのうち今回使えるのは200万円」)
// is not a competing total: such rows get scope 'breakdown' and are only
// ever compared with other breakdown rows.
const SCOPE_BREAKDOWN_RE = /そのうち|のうち|内訳|残り|差し引|差額/;
const TAX_RE = /税抜|税別|税込/;

function normalizeAmount(num, unit, tailNum, tailUnit) {
    const base = kanjiToNumber(num) * AMOUNT_UNIT_YEN[unit];
    const tail = tailNum ? kanjiToNumber(tailNum) * AMOUNT_UNIT_YEN[tailUnit] : 0;
    const yen = Math.round(base + tail);
    return Number.isFinite(yen) ? yen : null;
}

// Every amount of the (half-width) text, in order: [{ index, end, text, yen }].
function findAmounts(text) {
    const out = [];
    AMOUNT_RE.lastIndex = 0;
    let m;
    while ((m = AMOUNT_RE.exec(text))) {
        const yen = m[1] != null ? normalizeAmount(m[1], '億', m[2], m[3]) : normalizeAmount(m[4], m[5]);
        const end = m.index + m[0].length;
        if (yen == null || (!m[0].endsWith('円') && AMOUNT_COUNTER_RE.test(text.slice(end)))) continue;
        out.push({ index: m.index, end, text: m[0], yen });
    }
    return out;
}

// First amount of the (half-width) text: { index, end, text, yen } or null.
function findAmount(text) {
    return findAmounts(text)[0] || null;
}

// The period whose marker occurs last in the text, or null.
function lastPeriod(text) {
    let best = null;
    for (const [period, re] of [
        ['annual', PERIOD_ANNUAL_RE],
        ['monthly', PERIOD_MONTHLY_RE],
        ['one_time', PERIOD_ONE_TIME_RE],
    ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            if (!best || m.index >= best.index) best = { period, index: m.index };
        }
    }
    return best ? best.period : null;
}

// Every amount of the sentence, each read with its own clause (spec
// decision 6: 「初期費用50万円、月額5万円です」 is two amounts, 「予算は100万円
// か50万円です」 is two competing ones). An amount's clause runs from the
// previous comma or the previous amount, whichever is later, to the next
// comma or the next amount, whichever is earlier. Period: a marker in the
// lead (「月額5万円」) wins over one in the tail (「5万円を年額で」); failing
// both, the last marker since the previous amount. `amount` / `amountText`
// stay the FIRST entry for older readers.
function extractBudgetValues(sentence) {
    const found = findAmounts(sentence);
    if (found.length === 0) return null;
    const amounts = found.map((f, i) => {
        const prevEnd = i > 0 ? found[i - 1].end : 0;
        const nextStart = i + 1 < found.length ? found[i + 1].index : sentence.length;
        const before = sentence.slice(prevEnd, f.index);
        const comma = Math.max(before.lastIndexOf('、'), before.lastIndexOf(','));
        const lead = sentence.slice(comma >= 0 ? prevEnd + comma + 1 : prevEnd, f.end);
        const rest = sentence.slice(f.end, nextStart);
        const restEnd = rest.search(/[、,]/);
        const tail = restEnd < 0 ? rest : rest.slice(0, restEnd);
        const clause = lead + tail;
        const period = lastPeriod(lead) || lastPeriod(tail) || lastPeriod(sentence.slice(prevEnd, f.end));
        const scope = SCOPE_BREAKDOWN_RE.test(clause)
            ? 'breakdown'
            : period === 'one_time'
              ? 'initial'
              : SCOPE_RECURRING_RE.test(clause)
                ? 'recurring'
                : null;
        return { text: f.text, yen: f.yen, period, scope };
    });
    const first = amounts[0];
    const tax = TAX_RE.exec(sentence);
    return {
        amountText: first.text,
        amount: { yen: first.yen, period: first.period, scope: first.scope },
        amounts,
        taxNote: tax ? (tax[0] === '税込' ? '税込' : '税抜') : null,
    };
}

const KPI_PERCENT_RE = new RegExp(`(${AMOUNT_NUM_SRC})\\s*(?:％|%|パーセント)`);
const KPI_COUNT_RE = new RegExp(`(${AMOUNT_NUM_SRC})\\s*(件|時間|人|回|社)`);
const KPI_PERIOD_RE =
    /(?:導入後|開始後|導入から|運用開始から|今後|直近|過去)?(?:\d+|[一二三四五六七八九十]+)\s*(?:[かヶケカ]月|年|週間)間?|今期|来期|今年度|来年度|年内|上期|下期/;

function extractKpiValues(sentence) {
    const out = {};
    const pct = KPI_PERCENT_RE.exec(sentence);
    if (pct && Number.isFinite(kanjiToNumber(pct[1]))) out.percent = kanjiToNumber(pct[1]);
    const cnt = KPI_COUNT_RE.exec(sentence);
    if (cnt && Number.isFinite(kanjiToNumber(cnt[1]))) out.count = { n: kanjiToNumber(cnt[1]), unit: cnt[2] };
    out.role = KPI_TARGET_RE.test(sentence) ? 'target' : KPI_CURRENT_RE.test(sentence) ? 'current' : null;
    const period = KPI_PERIOD_RE.exec(sentence);
    if (period) out.period = period[0];
    return out;
}

// Value shape per element:
//   budget   { raw, amountText, amount: { yen, period, scope },
//              amounts: [{ text, yen, period, scope }], taxNote }
//            (amount / amountText = amounts[0])
//   kpi      { raw, percent?, count?: { n, unit }, role, period? }
//   timeline { raw, date }
//   other, or no value found  { raw }
// `raw` is the sentence as said; parsing runs on a half-width copy.
function extractValues(key, sentence) {
    const raw = typeof sentence === 'string' ? sentence : '';
    if (!raw) return { raw };
    const text = toHalfWidth(raw);
    if (key === 'budget') {
        const budget = extractBudgetValues(text);
        return budget ? { raw, ...budget } : { raw };
    }
    if (key === 'kpi') return { raw, ...extractKpiValues(text) };
    if (key === 'timeline') {
        const m = FILLED_PATTERNS.timeline.exec(text);
        return m ? { raw, date: m[0] } : { raw };
    }
    return { raw };
}

// Comparison value of one amount entry ({ yen, period }): one-time and
// annual amounts as said, monthly ×12, unknown period → null.
// `periodOverride` fills an unknown period from a later basis hint
// (「どちらも年額です」).
function annualYen(entry, periodOverride = null) {
    if (!entry || entry.yen == null) return null;
    const period = entry.period || periodOverride;
    if (period === 'annual' || period === 'one_time') return entry.yen;
    if (period === 'monthly') return entry.yen * 12;
    return null;
}

// 「どちらも年額の予算です」: a budget sentence with no amount that fixes the
// period of the amounts already stated. Returns 'annual' | 'monthly' | null.
const BASIS_HINT_ALL_RE = /どちらも|いずれも|両方|すべて/;
const BASIS_HINT_PERIOD_RE = /年額|年間|月額|月々/;
function basisHintPeriod(sentence) {
    if (!sentence) return null;
    if (!(PARTIAL_PATTERNS.budget.test(sentence) || /金額|額/.test(sentence))) return null;
    if (findAmount(toHalfWidth(sentence))) return null;
    if (!BASIS_HINT_ALL_RE.test(sentence)) return null;
    const m = BASIS_HINT_PERIOD_RE.exec(sentence);
    if (!m) return null;
    if (classifyPolarity(sentence)) return null;
    return m[0] === '年額' || m[0] === '年間' ? 'annual' : 'monthly';
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
    const loc = locateQuoteSentence(quote, transcript);
    return loc ? loc.sentences[loc.index] : null;
}

// Same search as sentenceContainingQuote, but also returns the sentences of
// the utterance (transcript line, one turn per line as built by
// turnEvents.recentTurnsForPrompt) that carries the quote, and the index of
// the carrying sentence in it — the input classifyQualifier needs to
// resolve an in-utterance reference (「…11月中に。ただ、その時期は未合意」).
// Keeping the scope to one line means a reference is never resolved
// across speakers.
function locateQuoteSentence(quote, transcript) {
    const nq = normalizeForGrounding(quote);
    if (!nq || typeof transcript !== 'string') return null;
    const lines = transcript.split('\n');
    for (let l = lines.length - 1; l >= 0; l--) {
        const sentences = splitSentences(lines[l]);
        for (let i = sentences.length - 1; i >= 0; i--) {
            if (normalizeForGrounding(sentences[i]).includes(nq)) return { sentences, index: i };
        }
    }
    return null;
}

// The 「[相手] 」 / 「[自分] 」 tag the prompt transcript puts on each turn.
const SPEAKER_TAG_RE = /^\[(?:相手|自分)\]\s*/;

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
        acc[key] = {
            status: 'empty',
            evidence: [],
            selfMentions: [],
            actions: [],
            lastUpdate: null,
            confirmed: false,
            confirmation: null,
            confirmedClearedBy: null,
            confirmationHistory: [],
            conflict: null,
            // Internal (not dumped): { period, rowIds } from a sentence such
            // as 「どちらも年額です」 that fixes the period of earlier
            // amounts stated without one.
            basisHint: null,
        };
        return acc;
    }, {});
}

// Defaults every evidence row carries from v0.7.8 on. Later stages set
// them (qualifier / conflict basis / selection / supersession / normalized
// values); a row built here is a plain, unqualified, live statement.
//   retractedBy / retractedQuote — why and by which sentence a row was
//     withdrawn: 'correction' (「A ではなく B」), 'retraction' (an explicit
//     retraction, a global correction or a grounded LLM empty) or 'manual'
//     (the user's ✕). Set once, when the row is first retracted.
//   retractionTarget — on a retraction marker row only: 'row' (an amount
//     named one value), 'element' (the whole element was withdrawn) or
//     'ambiguous' (the named amount matched more than one value, so
//     nothing was withdrawn — spec decision 3).
const ROW_DEFAULTS = Object.freeze({
    qualifier: null,
    conflictBasis: null,
    selection: null,
    superseded: false,
    values: null,
    retractedBy: null,
    retractedQuote: null,
    retractionTarget: null,
});

// Withdraws a row and records why (spec decision 2: the history keeps the
// old value, its evidence and the reason). A row already retracted keeps
// its first reason.
function retractRow(e, by, quote = null) {
    if (e.retracted) return;
    e.retracted = true;
    e.retractedBy = by;
    e.retractedQuote = typeof quote === 'string' && quote ? quote : null;
}

// A live row is one that can still support the element's status. Retracted
// and superseded rows are history, and a retraction marker row
// (polarity 'retraction') only records that a withdrawal happened — so an
// element whose only rows are a marker plus retracted rows is `empty`.
function isLiveRow(e) {
    return !e.retracted && !e.superseded && e.polarity !== 'retraction';
}

// Returns `'concrete'` (filled hit), `'keyword'` (partial hit only), or null.
function matchElement(key, text) {
    if (!text || typeof text !== 'string') return null;
    if (FILLED_PATTERNS[key].test(text)) return 'concrete';
    if (PARTIAL_PATTERNS[key].test(text)) return 'keyword';
    return null;
}

// Status precedence (5 tiers, v0.7.8):
//   confirmed (user's manual ✓) > detected (live neutral concrete row with
//   no qualifier) > candidate (live neutral concrete row qualified as
//   tentative or conflict) > partial (any other live row) > empty.
// Vocabulary: the validation team's "confirmed" (a positive statement in
// the conversation) is the product's `detected`; the product's `confirmed`
// is only the user's ✓. Non-live rows (see isLiveRow) never count;
// polarity-tagged rows and `current`-qualified rows count only as partial.
function computeStatus(element) {
    if (element.confirmed) return 'confirmed';
    const live = element.evidence.filter(isLiveRow);
    if (live.length === 0) return 'empty';
    const neutralConcrete = live.filter(e => e.specificity === 'concrete' && !e.polarity);
    if (neutralConcrete.some(e => !e.qualifier)) return 'detected';
    if (neutralConcrete.some(e => e.qualifier === 'tentative' || e.qualifier === 'conflict')) return 'candidate';
    return 'partial';
}

function cloneConflict(conflict) {
    if (!conflict) return null;
    return {
        ...conflict,
        values: Array.isArray(conflict.values) ? conflict.values.map(v => ({ ...v })) : conflict.values,
    };
}

function cloneValues(v) {
    if (!v || typeof v !== 'object') return v;
    const out = { ...v };
    if (v.amount && typeof v.amount === 'object') out.amount = { ...v.amount };
    if (Array.isArray(v.amounts)) out.amounts = v.amounts.map(a => ({ ...a }));
    if (v.count && typeof v.count === 'object') out.count = { ...v.count };
    return out;
}

function cloneRow(e) {
    return { ...e, values: cloneValues(e.values) };
}

function deepCloneState(state) {
    return ELEMENT_KEYS.reduce((acc, key) => {
        const el = state[key];
        acc[key] = {
            status: el.status,
            evidence: el.evidence.map(cloneRow),
            selfMentions: el.selfMentions.map(e => ({ ...e })),
            actions: el.actions.map(a => ({ ...a })),
            lastUpdate: el.lastUpdate,
            confirmed: el.confirmed,
            confirmation: el.confirmation
                ? {
                      ...el.confirmation,
                      rowIds: Array.isArray(el.confirmation.rowIds) ? [...el.confirmation.rowIds] : el.confirmation.rowIds,
                  }
                : null,
            confirmedClearedBy: el.confirmedClearedBy,
            confirmationHistory: el.confirmationHistory.map(h => ({ ...h })),
            conflict: cloneConflict(el.conflict),
        };
        return acc;
    }, {});
}

// Clears the user's ✓ (v0.7.8 policy §0-2: an explicit retraction, a new
// unresolved conflict or the user's ✕ demotes a confirmed element). The
// history entry keeps when and why, the quote of the event that cleared it
// (the confirmation's own quote when none is given) and the value that had
// been confirmed. No-op when the element is not confirmed.
function clearConfirmation(el, reason, ts, quote) {
    if (!el.confirmed) return false;
    const prev = el.confirmation;
    el.confirmed = false;
    el.confirmedClearedBy = reason;
    el.confirmation = null;
    el.confirmationHistory.push({
        kind: 'cleared',
        reason,
        at: ts,
        quote: typeof quote === 'string' && quote ? quote : prev ? prev.quote : '',
        value: prev ? prev.value : null,
    });
    return true;
}

// The 5-element bar: detected + confirmed only. `candidate` is surfaced
// separately through candidateCount and never fills the bar.
function totalScore(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'detected' || state[key].status === 'confirmed').length;
}

function candidateCount(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'candidate').length;
}

// The user's ✓ only.
function confirmedCount(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'confirmed').length;
}

function createDiscoveryEvidence(options = {}) {
    const now = options.now || (() => Date.now());
    let state = createInitialState();
    // Per-store row id counter. Never reset (not even by reset()) so an id
    // seen by the renderer is never reused for a different row.
    let nextRowId = 1;

    // Every evidence row is created here: it gets a fresh id and the
    // v0.7.8 row defaults, which `fields` may override.
    function makeRow(fields) {
        return { id: nextRowId++, ...ROW_DEFAULTS, ...fields };
    }

    // A seller-side follow-up the customer asked for (sales_action). Shares
    // the row id counter. The same sentence (regex and LLM both seeing it,
    // or the LLM re-reading the transcript window) is recorded once.
    // Returns true when an entry was added.
    function addAction(el, text, timestamp, source) {
        const nt = normalizeForGrounding(text);
        if (!nt || el.actions.some(a => normalizeForGrounding(a.text) === nt)) return false;
        el.actions.push({ id: nextRowId++, text, timestamp, kind: 'sales_action', source });
        if (el.actions.length > MAX_EVIDENCE_PER_ELEMENT) {
            el.actions = el.actions.slice(-MAX_EVIDENCE_PER_ELEMENT);
        }
        return true;
    }

    // Budget rows that take part in conflict detection: live, neutral,
    // concrete, with a parsed amount, and either unqualified or already in
    // conflict. Tentative / current rows, polarity rows (hypothetical /
    // third-party / negated) and retraction markers never conflict.
    function conflictEligibleRows(el) {
        return el.evidence.filter(
            e =>
                isLiveRow(e) &&
                e.specificity === 'concrete' &&
                !e.polarity &&
                (e.qualifier == null || e.qualifier === 'conflict') &&
                amountEntries(e.values).length > 0
        );
    }

    // Recomputes `el.conflict` and the rows' `qualifier: 'conflict'` /
    // `conflictBasis` (budget only in this version). Every amount entry of
    // every eligible row takes part (spec decision 6): entries are compared
    // pairwise inside the same cost scope (initial / recurring / unknown —
    // different scopes are never compared, also inside one row): both
    // annualized amounts known and different → 'comparable'; either period
    // unknown and the said amounts different → 'unknown'. Equal amounts
    // (monthly 10万 = annual 120万) are a restatement, not a conflict. Two
    // entries of the same row with the same scope and different values
    // (「100万円か50万円」) are a within-row conflict. A row is in conflict
    // when any of its entries is; `el.conflict.values` lists the entries.
    //
    // A value left alone in conflict stays in conflict (still 要確認) until a
    // neutral row with the same amount affirms it — when the other side was
    // pushed out of the evidence window, when the customer retracted the
    // value the user had kept (T11: the set-aside value was never affirmed,
    // keptRowId → null), or when the customer retracted the set-aside value
    // while a kept value remains (T11b: the user's selection is not the
    // customer's confirmation, so the kept value stays candidate with its
    // keptRowId — spec decision 4b). Only when no value was ever selected
    // and the customer explicitly retracted the other side(s) is the
    // leftover the stated value and the conflict resolves to detected (T7,
    // never to confirmed).
    // `keptRowId` survives only while no new entry joins the conflict and
    // the kept row is still a member; a new conflicting entry resets it (T8)
    // and clears the user's ✓ (T9). Row `selection` always mirrors
    // keptRowId. `ts` is the time of the triggering event (history entries).
    function reconcileConflicts(key, el, ts = now()) {
        if (key !== 'budget') return;
        const prev = el.conflict;
        const prevValues = prev && Array.isArray(prev.values) ? prev.values : [];
        const prevIds = new Set(prevValues.map(v => v.rowId));
        const prevKeys = new Set(prevValues.map(v => `${v.rowId}:${v.amountIndex || 0}`));
        const hint = el.basisHint;
        for (const e of el.evidence) {
            if (isLiveRow(e) && e.qualifier === 'conflict') {
                e.qualifier = null;
                e.conflictBasis = null;
            }
        }
        const info = [];
        for (const e of conflictEligibleRows(el)) {
            const hinted = hint && hint.rowIds.includes(e.id) ? hint.period : null;
            amountEntries(e.values).forEach((a, amountIndex) => {
                const period = a.period || hinted || null;
                info.push({
                    key: `${e.id}:${amountIndex}`,
                    row: e,
                    amountIndex,
                    text: a.text,
                    scope: a.scope || null,
                    period,
                    yen: a.yen,
                    annual: annualYen(a, hinted),
                });
            });
        }
        const sameValue = (a, b) => (a.annual != null && b.annual != null ? a.annual === b.annual : a.yen === b.yen);

        const basisByKey = new Map();
        const mark = (k, basis) => {
            if (basisByKey.get(k) !== 'unknown') basisByKey.set(k, basis);
        };
        for (let i = 0; i < info.length; i++) {
            for (let j = i + 1; j < info.length; j++) {
                const a = info[i];
                const b = info[j];
                if (a.scope !== b.scope || sameValue(a, b)) continue;
                const basis = a.annual != null && b.annual != null ? 'comparable' : 'unknown';
                mark(a.key, basis);
                mark(b.key, basis);
            }
        }
        let leftover = false;
        if (basisByKey.size === 0 && prev) {
            const departed = [...prevIds].filter(id => !info.some(r => r.row.id === id));
            const departedRows = departed.map(id => el.evidence.find(e => e.id === id));
            // T7: no value was selected and every departed side was
            // explicitly retracted (still in the window, marked retracted)
            // → the leftover is the stated value.
            const resolvedByRetraction = prev.keptRowId == null && departedRows.length > 0 && departedRows.every(e => e && e.retracted);
            if (!resolvedByRetraction) {
                for (const r of info) {
                    if (!prevKeys.has(r.key)) continue;
                    if (info.some(o => o !== r && o.scope === r.scope && sameValue(o, r))) continue;
                    basisByKey.set(r.key, prev.basis);
                    leftover = true;
                }
            }
        }

        const clearSelections = () => {
            for (const e of el.evidence) {
                if (isLiveRow(e)) e.selection = null;
            }
        };
        if (basisByKey.size === 0) {
            el.conflict = null;
            clearSelections();
            return;
        }
        const members = info.filter(r => basisByKey.has(r.key));
        const memberRows = [...new Set(members.map(r => r.row))];
        for (const row of memberRows) {
            row.qualifier = 'conflict';
            row.conflictBasis = members.some(r => r.row === row && basisByKey.get(r.key) === 'unknown') ? 'unknown' : 'comparable';
        }
        const fresh = members.filter(r => !prevKeys.has(r.key));
        const keptRowId =
            fresh.length === 0 && prev && prev.keptRowId != null && memberRows.some(row => row.id === prev.keptRowId) ? prev.keptRowId : null;
        clearSelections();
        if (keptRowId != null) {
            for (const row of memberRows) row.selection = row.id === keptRowId ? 'kept' : 'set_aside';
        }
        el.conflict = {
            basis: [...basisByKey.values()].every(b => b === 'comparable') ? 'comparable' : 'unknown',
            // One entry per conflicting amount (a row stating two amounts can
            // contribute two). `raw` is the amount as said; `period` is the
            // period used for the comparison (as said, or from a basis hint).
            values: members.map(r => ({
                rowId: r.row.id,
                amountIndex: r.amountIndex,
                raw: r.text || r.row.values.amountText || r.row.values.raw,
                yenAnnual: r.annual,
                period: r.period,
                scope: r.scope,
            })),
            keptRowId,
            // The user's earlier choice, kept for the history ("以前の選択")
            // once a new value (T8) or a retraction of the kept value (T11)
            // voided it.
            previousKeptRowId: prev && prev.keptRowId != null && keptRowId == null ? prev.keptRowId : prev ? prev.previousKeptRowId || null : null,
            // Set when a lone value stays in conflict after its counterpart
            // left (T11 / T11b / window eviction): it needs the customer's
            // affirmation, not an automatic return to detected.
            unresolvedSince: leftover ? (prev && prev.unresolvedSince) || ts : null,
        };
        if (fresh.length > 0) {
            clearConfirmation(el, 'conflict', ts, fresh[fresh.length - 1].row.text);
        }
    }

    function dump() {
        return {
            elements: deepCloneState(state),
            totalScore: totalScore(state),
            candidateCount: candidateCount(state),
            confirmedCount: confirmedCount(state),
            updatedAt: now(),
        };
    }

    // Row ranking inside one utterance: a neutral unqualified concrete
    // statement beats a tentative one (candidate), which beats a current
    // value (partial), which beats a tagged concrete one, which beats a bare
    // keyword mention.
    function rowRank(specificity, polarity, qualifier) {
        const base = (specificity === 'concrete' ? 2 : 0) + (polarity ? 0 : 1);
        if (qualifier === 'tentative') return base - 0.5;
        if (qualifier === 'current') return base - 0.75;
        return base;
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
            el.evidence.push(makeRow({ text, timestamp: ts, source: 'regex', retracted: false, ...row }));
            touched = true;
        };
        const flush = () => {
            if (!pending) return;
            push({
                specificity: pending.specificity,
                polarity: pending.polarity,
                qualifier: pending.qualifier,
                values: extractValues(key, pending.sentence),
            });
            pending = null;
        };
        let hintChanged = false;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            if (isGlobalCorrection(sentence)) {
                flush();
                // Every live concrete row of every element belonged to
                // someone else / is undecided — an explicit retraction, so
                // it also clears the user's ✓ (v0.7.8 policy §0-2).
                const live = el.evidence.filter(e => isLiveRow(e) && e.specificity === 'concrete');
                if (live.length === 0) continue;
                for (const e of live) retractRow(e, 'retraction', sentence);
                push({ specificity: 'keyword', polarity: 'retraction', retractionTarget: 'element' });
                clearConfirmation(el, 'retraction', ts, sentence);
                continue;
            }

            const parts = splitAtRetraction(sentence);
            if (parts && retractionNamesElement(key, sentence)) {
                const hadLive = !!pending || el.evidence.some(isLiveRow);
                if (!hadLive && !matchElement(key, sentence)) continue;
                flush();
                // 「100万円の方は撤回します」 names one of several stated
                // amounts: only the rows stating it are withdrawn (T7 / T11).
                // Otherwise the whole element is.
                const byAmount = key === 'budget' ? rowsStatingAmount(el, parts.before) : null;
                if (byAmount && byAmount.ambiguous) {
                    // The named amount fits more than one stated value: keep
                    // every row live, the status and the ✓ as they are, and
                    // log the unresolved retraction for the history.
                    push({ text: sentence, specificity: 'keyword', polarity: 'retraction', retracted: true, retractionTarget: 'ambiguous' });
                    continue;
                }
                const targeted = byAmount ? byAmount.rows : null;
                const retractedRows = targeted || el.evidence.filter(e => !e.retracted);
                for (const e of retractedRows) retractRow(e, 'retraction', sentence);
                push({ specificity: 'keyword', polarity: 'retraction', retractionTarget: targeted ? 'row' : 'element' });
                // An explicit retraction clears the user's ✓ (T10) when it
                // withdraws the confirmed value or leaves nothing standing.
                const confirmedIds = el.confirmation && Array.isArray(el.confirmation.rowIds) ? el.confirmation.rowIds : [];
                if (!targeted || retractedRows.some(e => confirmedIds.includes(e.id)) || !el.evidence.some(isLiveRow)) {
                    clearConfirmation(el, 'retraction', ts, sentence);
                }
                if (FILLED_PATTERNS[key].test(parts.after) && !effectivePolarity(key, classifyPolarity(parts.after), parts.after)) {
                    push({ specificity: 'concrete', polarity: null, values: extractValues(key, parts.after) });
                }
                continue;
            }

            const corrected = correctionAfterDewanaku(key, sentence);
            if (corrected !== null) {
                // 「A ではなく B」 replaces A; it is never a conflict.
                flush();
                for (const e of el.evidence) {
                    if (isLiveRow(e) && e.specificity === 'concrete') retractRow(e, 'correction', sentence);
                }
                push({ specificity: 'concrete', polarity: null, values: extractValues(key, corrected) });
                continue;
            }

            if (key === 'budget') {
                const period = basisHintPeriod(sentence);
                if (period) {
                    const rowIds = conflictEligibleRows(el)
                        .filter(e => amountEntries(e.values).some(a => !a.period))
                        .map(e => e.id);
                    if (rowIds.length > 0) {
                        el.basisHint = { period, rowIds };
                        hintChanged = true;
                    }
                }
            }

            const specificity = matchElement(key, sentence);
            if (!specificity) continue;
            const polarity = effectivePolarity(key, classifyPolarity(sentence), sentence);
            const qualifier = polarity ? null : classifyQualifier(key, sentence, sentences, i);
            if (qualifier === 'sales_action') {
                // The seller's deliverable date, not the customer's deadline:
                // an action entry, and neither a concrete nor a keyword row.
                if (addAction(el, sentence, ts, 'regex')) touched = true;
                continue;
            }
            const rowQualifier = specificity === 'concrete' && !polarity ? qualifier : null;
            const candidate = {
                specificity: polarity ? 'keyword' : specificity,
                polarity,
                qualifier: rowQualifier,
                rank: rowRank(specificity, polarity, rowQualifier),
                sentence,
            };
            if (!pending || candidate.rank > pending.rank) pending = candidate;
        }
        flush();

        if (!touched && !hintChanged) return false;
        if (el.evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
            el.evidence = el.evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
        }
        reconcileConflicts(key, el, ts);
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
    // otherwise it is a no-op (regex remains the floor). When it does
    // retract, it also clears a user confirmation (v0.7.8 policy §0-2).
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
                if (!(isRetraction(quote) || effectivePolarity(key, classifyPolarity(quote), quote) === 'negated')) continue;
                const hadLive = state[key].evidence.some(e => isLiveRow(e) && e.specificity === 'concrete');
                if (!hadLive) continue;
                // A grounded retraction / negation withdraws the rows and,
                // as an explicit retraction, clears the user's ✓ (T10).
                for (const e of state[key].evidence) retractRow(e, 'retraction', quote);
                clearConfirmation(state[key], 'retraction', ts, quote);
                state[key].evidence.push(
                    makeRow({
                        text: quote,
                        timestamp: ts,
                        specificity: 'keyword',
                        source: 'llm',
                        polarity: 'retraction',
                        retracted: false,
                        retractionTarget: 'element',
                    })
                );
            } else if (r.status === 'partial' || r.status === 'filled') {
                if (!quote || !quoteIsGrounded(quote, transcriptStr)) continue;
                if (quoteMatchesRetractedRow(state[key], quote)) continue;
                const loc = locateQuoteSentence(quote, transcriptStr);
                const context = loc ? loc.sentences[loc.index] : quote;
                const polarity = effectivePolarity(key, classifyPolarity(context), context);
                const qualifier = polarity
                    ? null
                    : loc
                      ? classifyQualifier(key, context, loc.sentences, loc.index)
                      : classifyQualifier(key, context, [context], 0);
                if (qualifier === 'sales_action') {
                    if (!addAction(state[key], context.replace(SPEAKER_TAG_RE, ''), ts, 'llm')) continue;
                } else {
                    // The prompt asks for 'partial' on tentative values (with
                    // the condition sentence quoted); a tentative sentence
                    // that does state a concrete value is still a candidate,
                    // exactly as the regex path reads the same sentence.
                    const concrete = !polarity && (r.status === 'filled' || (qualifier === 'tentative' && FILLED_PATTERNS[key].test(context)));
                    const specificity = concrete ? 'concrete' : 'keyword';
                    state[key].evidence.push(
                        makeRow({
                            text: quote,
                            timestamp: ts,
                            specificity,
                            source: 'llm',
                            polarity,
                            qualifier: concrete ? qualifier : null,
                            retracted: false,
                            values: extractValues(key, context.replace(SPEAKER_TAG_RE, '')),
                        })
                    );
                }
            } else {
                continue;
            }
            if (state[key].evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
                state[key].evidence = state[key].evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
            }
            reconcileConflicts(key, state[key], ts);
            state[key].status = computeStatus(state[key]);
            state[key].lastUpdate = ts;
            anyChange = true;
        }
        return { state: dump(), changed: anyChange };
    }

    // Manual user actions. Only the user can promote an element to
    // 'confirmed'; automatic detection tops out at 'detected'. v0.7.8
    // separates two user operations (policy §6):
    //   selectEvidence — 「この値を候補として残す」: picks one value of an
    //     unresolved conflict. It is not the customer's confirmation, so the
    //     conflict qualifier stays and the status stays candidate (T3 / T3').
    //   confirmElement — ✓ 「相手に確認済みにする」: the user attests the
    //     customer confirmed the value. Allowed from detected, from a
    //     tentative-only candidate (C11), and from a conflict only once a
    //     value is selected AND the basis is comparable (T4 / T4' / T5).
    // Every call returns { state, changed, reason? }; reason is set only on
    // a refusal.
    function refuse(reason) {
        return { state: dump(), changed: false, reason };
    }

    function newestRow(rows) {
        return rows.length > 0 ? rows[rows.length - 1] : null;
    }

    function conflictValuesOfRow(el, rowId) {
        return el.conflict && Array.isArray(el.conflict.values) ? el.conflict.values.filter(v => v.rowId === rowId) : [];
    }

    // The value ✓ records: the kept amount of a conflict, every amount of a
    // multi-amount row (「50万円 / 5万円」), the single amount, or the sentence.
    function confirmationValue(el, row) {
        const inConflict = conflictValuesOfRow(el, row.id);
        if (inConflict.length > 0) return inConflict.map(v => v.raw).join(' / ');
        const amounts = amountEntries(row.values);
        if (amounts.length > 1) return amounts.map(a => a.text).join(' / ');
        return (row.values && (row.values.amountText || row.values.raw)) || row.text;
    }

    function selectEvidence(key, rowId) {
        if (!ELEMENT_KEYS.includes(key)) return refuse('unknown_row');
        const el = state[key];
        const row = el.evidence.find(e => e.id === rowId);
        if (!row) return refuse('unknown_row');
        if (!isLiveRow(row)) return refuse('row_not_live');
        const memberIds = el.conflict && Array.isArray(el.conflict.values) ? el.conflict.values.map(v => v.rowId) : [];
        if (!memberIds.includes(rowId) || row.qualifier !== 'conflict') return refuse('no_conflict');
        if (el.conflict.keptRowId === rowId) return { state: dump(), changed: false };
        el.conflict.keptRowId = rowId;
        for (const e of el.evidence) {
            if (!isLiveRow(e)) continue;
            e.selection = memberIds.includes(e.id) ? (e.id === rowId ? 'kept' : 'set_aside') : null;
        }
        el.status = computeStatus(el);
        el.lastUpdate = now();
        return { state: dump(), changed: true };
    }

    function confirmElement(key) {
        if (!ELEMENT_KEYS.includes(key)) return refuse('no_candidate');
        const el = state[key];
        if (el.confirmed) return refuse('already_confirmed');
        const status = computeStatus(el);
        const neutralConcrete = el.evidence.filter(e => isLiveRow(e) && e.specificity === 'concrete' && !e.polarity);
        let row = null;
        // An unresolved conflict anywhere in the element blocks ✓, even when
        // another row (e.g. a different cost scope) would make the status
        // 'detected' (§0-4: a ✓ alone never resolves a conflict).
        // An unknown basis is reported first: even a selection cannot
        // unlock ✓ until the customer states the period / cost scope.
        if (el.conflict) {
            if (el.conflict.basis !== 'comparable') return refuse('basis_unknown');
            if (el.conflict.keptRowId == null) return refuse('conflict_unresolved');
            // A kept row that itself states two conflicting amounts
            // (「100万円か50万円」) does not say which one was kept.
            if (conflictValuesOfRow(el, el.conflict.keptRowId).length > 1) return refuse('conflict_unresolved');
            row = neutralConcrete.find(e => e.id === el.conflict.keptRowId) || null;
            if (!row) return refuse('conflict_unresolved');
        } else if (status === 'detected') {
            row = newestRow(neutralConcrete.filter(e => !e.qualifier));
        } else if (status === 'candidate') {
            row = newestRow(neutralConcrete.filter(e => e.qualifier === 'tentative'));
        }
        if (!row) return refuse('no_candidate');
        const at = now();
        el.confirmed = true;
        el.confirmedClearedBy = null;
        el.confirmation = {
            value: confirmationValue(el, row),
            rowIds: [row.id],
            quote: row.text,
            confirmedAt: at,
            basis: 'customer_confirmed',
        };
        el.confirmationHistory.push({ kind: 'confirmed', reason: null, at, quote: row.text, value: el.confirmation.value });
        el.status = computeStatus(el);
        el.lastUpdate = at;
        return { state: dump(), changed: true };
    }

    function retractElement(key, reason = 'manual') {
        if (!ELEMENT_KEYS.includes(key)) return { state: dump(), changed: false };
        const el = state[key];
        const hadAnything = el.confirmed || el.evidence.some(isLiveRow);
        if (!hadAnything) return { state: dump(), changed: false };
        const ts = now();
        // The user's ✕ (gemini.js always passes 'manual').
        for (const e of el.evidence) retractRow(e, 'manual');
        clearConfirmation(el, reason, ts);
        reconcileConflicts(key, el, ts);
        el.status = computeStatus(el);
        el.lastUpdate = ts;
        el.evidence.push(
            makeRow({
                text: `[${reason}]`,
                timestamp: el.lastUpdate,
                specificity: 'keyword',
                source: 'user',
                polarity: 'retraction',
                retracted: true,
                retractedBy: 'manual',
                retractionTarget: 'element',
            })
        );
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
        selectEvidence,
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
    classifyQualifier,
    extractValues,
    kanjiToNumber,
    splitSentences,
    retractionNamesElement,
    isGlobalCorrection,
    isRetraction,
    computeStatus,
    clearConfirmation,
    isLiveRow,
    candidateCount,
    RETRACTION_TOPIC_PATTERNS,
    PARTIAL_PATTERNS,
    FILLED_PATTERNS,
    MAX_EVIDENCE_PER_ELEMENT,
};
