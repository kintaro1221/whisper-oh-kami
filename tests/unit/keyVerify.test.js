'use strict';
const { verifyGeminiKey, verifyDeepgramKey } = require('../../src/utils/keyVerify');

const fakeRes = status => ({ ok: status >= 200 && status < 300, status });

describe('keyVerify.verifyGeminiKey', () => {
    test('200 → ok', async () => {
        expect(await verifyGeminiKey('AIzaXXXX', async () => fakeRes(200))).toEqual({ ok: true });
    });
    test('400/403 → invalid', async () => {
        expect(await verifyGeminiKey('bad', async () => fakeRes(403))).toEqual({ ok: false, reason: 'invalid' });
    });
    test('429 → rate', async () => {
        expect(await verifyGeminiKey('AIzaXXXX', async () => fakeRes(429))).toEqual({ ok: false, reason: 'rate' });
    });
    test('thrown error → network', async () => {
        const boom = async () => {
            throw new Error('offline');
        };
        expect(await verifyGeminiKey('AIzaXXXX', boom)).toEqual({ ok: false, reason: 'network' });
    });
    test('empty key → invalid, no fetch call', async () => {
        let called = false;
        const spy = async () => {
            called = true;
            return fakeRes(200);
        };
        expect(await verifyGeminiKey('', spy)).toEqual({ ok: false, reason: 'invalid' });
        expect(called).toBe(false);
    });
    test('sends the key in the query string', async () => {
        let url = '';
        await verifyGeminiKey('AIzaTESTKEY', async u => {
            url = u;
            return fakeRes(200);
        });
        expect(url).toContain('generativelanguage.googleapis.com');
        expect(url).toContain('AIzaTESTKEY');
    });
});

describe('keyVerify.verifyDeepgramKey', () => {
    test('200 → ok', async () => {
        expect(await verifyDeepgramKey('abc', async () => fakeRes(200))).toEqual({ ok: true });
    });
    test('401 → invalid', async () => {
        expect(await verifyDeepgramKey('bad', async () => fakeRes(401))).toEqual({ ok: false, reason: 'invalid' });
    });
    test('thrown error → network', async () => {
        const boom = async () => {
            throw new Error('offline');
        };
        expect(await verifyDeepgramKey('abc', boom)).toEqual({ ok: false, reason: 'network' });
    });
    test('sends Authorization: Token header', async () => {
        let opts = null;
        await verifyDeepgramKey('DGKEY', async (u, o) => {
            opts = o;
            return fakeRes(200);
        });
        expect(opts.headers.Authorization).toBe('Token DGKEY');
    });
});
