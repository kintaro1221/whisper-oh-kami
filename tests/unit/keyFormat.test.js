'use strict';
const { isValidGeminiKeyFormat, isValidDeepgramKeyFormat } = require('../../src/utils/keyFormat');

describe('keyFormat', () => {
    test('gemini: AIza + 30+ chars is valid', () => {
        expect(isValidGeminiKeyFormat('AIza' + 'a'.repeat(35))).toBe(true);
    });
    test('gemini: trims whitespace', () => {
        expect(isValidGeminiKeyFormat('  AIza' + 'b'.repeat(30) + '  ')).toBe(true);
    });
    test('gemini: wrong prefix or too short is invalid', () => {
        expect(isValidGeminiKeyFormat('sk-123')).toBe(false);
        expect(isValidGeminiKeyFormat('AIzaShort')).toBe(false);
        expect(isValidGeminiKeyFormat('')).toBe(false);
        expect(isValidGeminiKeyFormat(null)).toBe(false);
    });
    test('deepgram: 32+ hex is valid, case-insensitive', () => {
        expect(isValidDeepgramKeyFormat('a'.repeat(32))).toBe(true);
        expect(isValidDeepgramKeyFormat('ABCDEF' + '0'.repeat(26))).toBe(true);
    });
    test('deepgram: non-hex or short is invalid', () => {
        expect(isValidDeepgramKeyFormat('xyz')).toBe(false);
        expect(isValidDeepgramKeyFormat('a'.repeat(10))).toBe(false);
        expect(isValidDeepgramKeyFormat('')).toBe(false);
    });
});
