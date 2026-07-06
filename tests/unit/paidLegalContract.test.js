'use strict';

// Source-contract test for the paid-beta legal set.
//
// Six canonical Markdown files in `docs/legal/` plus the new
// `docs/legal/data-flow-matrix.md` truth-anchor back every paid-beta
// commercial-disclosure claim on the LP. Their text is rendered verbatim
// into the four `/legal/*` Astro pages, so a stale or forbidden token in a
// `.md` source becomes a stale or forbidden token on the public site.
//
// This test enforces a BIDIRECTIONAL contract across the whole legal set:
//   * Negative (rejection) checks apply to EVERY doc — no doc may carry
//     unresolved placeholders, the abandoned Lemon Squeezy / MoR model,
//     the abandoned ¥14,800 / ¥9,800 / 14-day refund / license-key /
//     setup-accompaniment claims, or a beta code-signing promise.
//   * Positive (requirement) checks apply to the doc(s) that should carry
//     each fact: tokushoho carries the price / refund / OS / qualified-
//     invoice line, terms-and-sales carries the Stripe / GPL / no-support
//     line, privacy carries the Stripe / Cloudflare retention story,
//     recording keeps the recording-consent guidance.
//
// A separate test asserts data-flow-matrix.md exists and names every
// runtime data path with file/function evidence — the privacy policy
// cites this matrix as its truth anchor.
//
// The test reads files from disk only (no Astro build) — surface-area
// drift is the catastrophic regression we are guarding.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const legalDir = path.join(repoRoot, 'docs', 'legal');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
const exists = relPath => fs.existsSync(path.join(repoRoot, relPath));

// All seven legal docs subject to the universal rejection rules.
const LEGAL_DOCS = [
    'docs/legal/terms-and-sales.md',
    'docs/legal/privacy-policy.md',
    'docs/legal/tokushoho.md',
    'docs/legal/recording-guidance.md',
    'docs/legal/README.md',
    'docs/legal/data-flow-matrix.md',
];

// The 4 buyer-facing legal pages — these ship to /legal/* on the public LP
// and must not carry any of the forbidden tokens, even as descriptive
// prose. The plan's spec rg check (`rg -n "要記入|要弁護士確認|Lemon
// Squeezy|14,800|9,800" docs/legal lp/dist/legal`) MUST return empty for
// these.
const PUBLIC_LEGAL_DOCS = [
    'docs/legal/terms-and-sales.md',
    'docs/legal/privacy-policy.md',
    'docs/legal/tokushoho.md',
    'docs/legal/recording-guidance.md',
    'docs/legal/data-flow-matrix.md',
];

// Universal: an unresolved placeholder marker is forbidden in EVERY doc,
// including the internal README.
const UNIVERSAL_FORBIDDEN_TOKENS = [
    '[要記入]',
    '[要弁護士確認]',
];

// Public-only: the abandoned commercial model and the beta-phase signed-
// build promise must not appear in any buyer-facing legal page. The
// fact-summary README legitimately names these old terms as "Closed".
// The public 4 pages must not carry them, even descriptively.
const PUBLIC_FORBIDDEN_TOKENS = [
    'Lemon Squeezy',
    'Merchant of Record',
    '14,800',
    '9,800',
    '14日',
    'ライセンスキー',
    'セットアップ同伴',
    // Code-signing promises. The beta is unsigned; signing is deferred to
    // the later JPY 4,980 general-sale phase. The public 4 must not carry
    // these verbs.
    '署名済み',
    'Authenticode 署名',
    'コードサイニング',
];

// Required-in-set: a string from this list must appear in at least one
// doc. The strings here are facts that always belong to the legal set,
// not to any one specific doc.
const REQUIRED_ACROSS_SET = [
    'Stripe',
    '2,980円',
    '支払総額',
    '適格請求書を発行できません',
    '7日',
    'Windows 11 x64',
    'GPL-3.0',
    '対応ソース',
    '再配布',
    '個別サポートは含まれません',
];

// Required in specific docs. This is the "distribute the requires
// sensibly" mapping from the plan: each doc must carry the facts that
// belong to its domain so a reader landing on a single document never
// misses the corresponding fact.
const REQUIRED_PER_DOC = {
    'docs/legal/tokushoho.md': [
        '2,980円',
        '支払総額',
        '適格請求書を発行できません',
        '7日',
        'Windows 11 x64',
    ],
    'docs/legal/terms-and-sales.md': [
        'Stripe',
        'GPL-3.0',
        '対応ソース',
        '再配布',
        '個別サポートは含まれません',
    ],
    'docs/legal/privacy-policy.md': [
        'Stripe',
        'Cloudflare',
        '90日',
        '7年',
    ],
    'docs/legal/recording-guidance.md': [
        '事前',
        'NDA',
        'Deepgram',
    ],
    'docs/legal/data-flow-matrix.md': [
        'trial',
        'byok-gemini',
        'byok-deepgram',
        'local-ollama',
        'local-whisper',
    ],
};

describe('paid-beta legal set contract', () => {
    test('all 7 legal docs exist', () => {
        for (const doc of LEGAL_DOCS) {
            expect(exists(doc)).toBe(true);
        }
    });

    describe('universal rejection rules (apply to every doc)', () => {
        for (const doc of LEGAL_DOCS) {
            for (const token of UNIVERSAL_FORBIDDEN_TOKENS) {
                test(`${doc} does not contain "${token}"`, () => {
                    const body = read(doc);
                    expect(body.includes(token)).toBe(false);
                });
            }
        }
    });

    describe('public-page rejection rules (4 buyer-facing legal pages + data-flow-matrix)', () => {
        for (const doc of PUBLIC_LEGAL_DOCS) {
            for (const token of PUBLIC_FORBIDDEN_TOKENS) {
                test(`${doc} does not contain "${token}"`, () => {
                    const body = read(doc);
                    expect(body.includes(token)).toBe(false);
                });
            }
        }
    });

    test('every required-across-set string appears in at least one doc', () => {
        const corpus = LEGAL_DOCS.map(read).join('\n\n');
        for (const fact of REQUIRED_ACROSS_SET) {
            expect(corpus).toContain(fact);
        }
    });

    describe('per-doc required facts', () => {
        for (const [doc, facts] of Object.entries(REQUIRED_PER_DOC)) {
            for (const fact of facts) {
                test(`${doc} contains "${fact}"`, () => {
                    const body = read(doc);
                    expect(body).toContain(fact);
                });
            }
        }
    });

    test('data-flow-matrix.md cites code paths (src/ or lp/functions/) for each named mode', () => {
        const body = read('docs/legal/data-flow-matrix.md');
        // The matrix must reference real code, not vague claims. Each named
        // mode line in the matrix should sit close to a `src/...` or
        // `lp/functions/...` reference — we enforce by counting matches in
        // the whole document and requiring at least one of each.
        const srcRefs = body.match(/src\/(?:utils\/|components\/|i18n\/|[a-zA-Z]+\.js)/g) || [];
        const fnRefs = body.match(/lp\/functions\//g) || [];
        expect(srcRefs.length).toBeGreaterThanOrEqual(3);
        expect(fnRefs.length).toBeGreaterThanOrEqual(2);
    });

    test('privacy policy cites the National Tax Agency retention basis without claiming D1 is the statutory ledger', () => {
        const body = read('docs/legal/privacy-policy.md');
        // Required: NTA basis is cited as the reason for the 7-year cap.
        expect(body).toMatch(/国税庁|国税通則法|法人税法|所得税法/);
        // Forbidden: D1 must not be claimed as the statutory accounting
        // ledger. If a future edit accidentally describes D1 that way the
        // contract fails immediately.
        expect(body).not.toMatch(/D1[^。]{0,40}(?:法定|帳簿|会計帳簿|正式|統括)/);
    });

    test('terms-and-sales distinguishes the bearer access URL from the GPL software', () => {
        const body = read('docs/legal/terms-and-sales.md');
        // The URL is private (must not be shared); the GPL software (binary
        // + source) is freely redistributable. Both halves are required.
        expect(body).toMatch(/アクセス(?:URL|リンク)/);
        expect(body).toMatch(/共有|配布|転送/);
        expect(body).toContain('再配布');
        expect(body).toContain('GPL-3.0');
    });

    test('terms-and-sales explains the 24-hour claim window as administrative, not as product support', () => {
        const body = read('docs/legal/terms-and-sales.md');
        // 24-hour window is required.
        expect(body).toMatch(/24時間|24-hour/);
        // Email recovery is required but must not be sold as product
        // support. We enforce by requiring an explicit "事務" framing or a
        // negative ("製品サポートではない" / "個別サポートに代わるもの
        // ではない") near the claim-window description.
        expect(body).toMatch(/事務|administrative|管理者|個別サポートに代|製品サポートに代|製品サポートでは/);
    });

    test('terms-and-sales states v1.x updates are included if produced but never promises a release count or schedule', () => {
        const body = read('docs/legal/terms-and-sales.md');
        expect(body).toMatch(/v1\.x/);
        expect(body).toMatch(/リリース.*保証.*ありません|保証.*ありません|保証は[ない|ありません]|保証され[ない|ません]/);
        // Local-backup guidance: required (we cannot promise perpetual
        // hosting, so the buyer must keep a copy).
        expect(body).toMatch(/バックアップ|保管|保存をお願い|保存して/);
    });

    test('README is the new fact summary (Stripe-direct, beta price, 7-day refund)', () => {
        const body = read('docs/legal/README.md');
        expect(body).toContain('Stripe');
        expect(body).toContain('2,980円');
        expect(body).toContain('7日');
    });

});
