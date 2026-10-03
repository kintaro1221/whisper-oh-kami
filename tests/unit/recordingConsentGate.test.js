'use strict';

const { RecordingConsentGate } = require('../../src/utils/recordingConsentGate');

describe('RecordingConsentGate', () => {
    test('accept() resolves the pending request with true', async () => {
        const gate = new RecordingConsentGate();
        const onOpen = jest.fn();

        const pending = gate.request(onOpen);
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(gate.isOpen).toBe(true);

        gate.accept();

        await expect(pending).resolves.toBe(true);
        expect(gate.isOpen).toBe(false);
    });

    test('cancel() resolves the pending request with false and leaves no pending state', async () => {
        const gate = new RecordingConsentGate();
        const onOpen = jest.fn();

        const pending = gate.request(onOpen);
        gate.cancel();

        await expect(pending).resolves.toBe(false);
        expect(gate.isOpen).toBe(false);
        // No side effects beyond the render callback that already ran to
        // open the modal — cancel() itself must not call onOpen again or
        // trigger anything else.
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    test('cancel() with no request pending is a no-op (does not throw)', () => {
        const gate = new RecordingConsentGate();
        expect(() => gate.cancel()).not.toThrow();
        expect(gate.isOpen).toBe(false);
    });

    test('a second request() while one is already open returns the same promise and does not re-open (de-dup)', async () => {
        const gate = new RecordingConsentGate();
        const onOpen = jest.fn();

        const first = gate.request(onOpen);
        const second = gate.request(onOpen);

        expect(second).toBe(first);
        // onOpen (which would show the modal) must only fire once — a
        // second confirmRecordingConsent() call while showing must not
        // spawn a second modal.
        expect(onOpen).toHaveBeenCalledTimes(1);

        gate.accept();
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
    });

    test('after a request settles, a new request() opens again (not permanently de-duped)', async () => {
        const gate = new RecordingConsentGate();
        const onOpen = jest.fn();

        const first = gate.request(onOpen);
        gate.accept();
        await first;

        const second = gate.request(onOpen);
        expect(second).not.toBe(first);
        expect(onOpen).toHaveBeenCalledTimes(2);

        gate.cancel();
        await expect(second).resolves.toBe(false);
    });

    test('fails closed (resolves false) when onOpen throws — e.g. modal cannot be rendered', async () => {
        const gate = new RecordingConsentGate();
        const onOpen = jest.fn(() => {
            throw new Error('no shadowRoot');
        });

        const pending = gate.request(onOpen);

        await expect(pending).resolves.toBe(false);
        expect(gate.isOpen).toBe(false);
    });

    test('request() without an onOpen callback does not throw and stays pending until settled', async () => {
        const gate = new RecordingConsentGate();
        const pending = gate.request();
        expect(gate.isOpen).toBe(true);
        gate.accept();
        await expect(pending).resolves.toBe(true);
    });
});

test('two gate instances are independent (consent vs experimental)', async () => {
    const a = new RecordingConsentGate();
    const b = new RecordingConsentGate();
    const pa = a.request(() => {});
    const pb = b.request(() => {});
    a.accept();
    b.cancel();
    expect(await pa).toBe(true);
    expect(await pb).toBe(false);
});
