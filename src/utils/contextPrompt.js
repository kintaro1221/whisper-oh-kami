'use strict';

const CONTEXT_FIELDS = [
    ['companyProduct', '自社・商材'],
    ['targetCustomer', '想定顧客'],
    ['meetingGoal', '商談ゴール'],
    ['customerBackground', '顧客背景'],
    ['constraints', '制約・禁止事項'],
    ['freeInstruction', '自由指示'],
];

function normalizeText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function normalizeContextProfile(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const out = {};
    for (const [key] of CONTEXT_FIELDS) {
        const text = normalizeText(input[key]);
        if (text) out[key] = text;
    }
    if (Number.isFinite(input.updatedAt)) {
        out.updatedAt = input.updatedAt;
    }
    return out;
}

function buildCustomPromptFromContext(contextProfile, legacyCustomPrompt = '') {
    const normalized = normalizeContextProfile(contextProfile);
    const sections = [];

    for (const [key, label] of CONTEXT_FIELDS) {
        if (normalized[key]) {
            sections.push(`${label}:\n${normalized[key]}`);
        }
    }

    const legacy = normalizeText(legacyCustomPrompt);
    if (sections.length === 0) return legacy;
    if (legacy && !normalized.freeInstruction) {
        sections.push(`従来の自由メモ:\n${legacy}`);
    }

    return sections.join('\n\n');
}

module.exports = {
    CONTEXT_FIELDS,
    buildCustomPromptFromContext,
    normalizeContextProfile,
};
