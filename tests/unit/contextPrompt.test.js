const { buildCustomPromptFromContext, normalizeContextProfile } = require('../../src/utils/contextPrompt');

describe('normalizeContextProfile', () => {
    test('trims known fields and drops unknown keys', () => {
        const out = normalizeContextProfile({
            companyProduct: '  業務自動化SaaS  ',
            targetCustomer: '  従業員300名以上の製造業  ',
            meetingGoal: '  初回ヒアリング  ',
            customerBackground: '  月末処理が重い  ',
            constraints: '  ROIを断定しない  ',
            freeInstruction: '  敬語で短く  ',
            unexpected: 'ignore me',
            updatedAt: 123,
        });

        expect(out).toEqual({
            companyProduct: '業務自動化SaaS',
            targetCustomer: '従業員300名以上の製造業',
            meetingGoal: '初回ヒアリング',
            customerBackground: '月末処理が重い',
            constraints: 'ROIを断定しない',
            freeInstruction: '敬語で短く',
            updatedAt: 123,
        });
    });

    test('returns an empty profile for null or non-object input', () => {
        expect(normalizeContextProfile(null)).toEqual({});
        expect(normalizeContextProfile('text')).toEqual({});
    });
});

describe('buildCustomPromptFromContext', () => {
    test('builds Japanese labeled context in the intended order and skips blanks', () => {
        const prompt = buildCustomPromptFromContext({
            companyProduct: '業務自動化SaaS',
            targetCustomer: '製造業の管理部門',
            meetingGoal: '次回提案に必要な課題/KPIを確認する',
            customerBackground: '',
            constraints: 'ROIを断定しない',
            freeInstruction: '相手の発言を一度受け止める',
        });

        expect(prompt).toContain('自社・商材:\n業務自動化SaaS');
        expect(prompt).toContain('想定顧客:\n製造業の管理部門');
        expect(prompt).toContain('商談ゴール:\n次回提案に必要な課題/KPIを確認する');
        expect(prompt).toContain('制約・禁止事項:\nROIを断定しない');
        expect(prompt).toContain('自由指示:\n相手の発言を一度受け止める');
        expect(prompt).not.toContain('顧客背景');

        expect(prompt.indexOf('自社・商材')).toBeLessThan(prompt.indexOf('想定顧客'));
        expect(prompt.indexOf('想定顧客')).toBeLessThan(prompt.indexOf('商談ゴール'));
        expect(prompt.indexOf('商談ゴール')).toBeLessThan(prompt.indexOf('制約・禁止事項'));
        expect(prompt.indexOf('制約・禁止事項')).toBeLessThan(prompt.indexOf('自由指示'));
    });

    test('falls back to legacy customPrompt when structured context is empty', () => {
        expect(buildCustomPromptFromContext({}, '  旧メモ  ')).toBe('旧メモ');
    });

    test('keeps legacy customPrompt as compatibility note when structured context exists', () => {
        const prompt = buildCustomPromptFromContext({ companyProduct: 'SaaS' }, '旧メモ');

        expect(prompt).toContain('自社・商材:\nSaaS');
        expect(prompt).toContain('従来の自由メモ:\n旧メモ');
    });
});
