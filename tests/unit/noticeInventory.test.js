'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar');
const { collectRust, lockedRegistryCrates, dependencyNames } = require('../../scripts/notice-inventory');

describe('notice inventory completeness', () => {
    let temp;
    const source = 'registry+https://github.com/rust-lang/crates.io-index';
    const block = (name, version = '1.0.0') =>
        `\n[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "${source}"\nchecksum = "verified-package-checksum"\n`;
    beforeEach(() => {
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-inventory-'));
    });
    afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
    function fixture(name, license, texts = {}, version = '1.0.0') {
        const dir = path.join(temp, 'index.crates.io-fixture', `${name}-${version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'Cargo.toml'),
            `[package]\nname = "${name}"\nversion = "${version}"\nlicense = "${license}"\nauthors = ["Declared author"]\n`
        );
        const files = Object.fromEntries(Object.entries(texts).map(([file, text]) => [file, crypto.createHash('sha256').update(text).digest('hex')]));
        fs.writeFileSync(path.join(dir, '.cargo-checksum.json'), JSON.stringify({ package: 'verified-package-checksum', files }));
        for (const [file, text] of Object.entries(texts)) fs.writeFileSync(path.join(dir, file), text);
        return dir;
    }
    function collect(text) {
        const lock = path.join(temp, 'Cargo.lock');
        fs.writeFileSync(lock, text);
        return collectRust(lock, temp);
    }
    test('includes all registry packages, with local helper excluded', () => {
        const text = 'version = 4\n[[package]]\nname = "local"\nversion = "0.1.0"\n' + block('target-only') + block('build-only');
        fixture('target-only', 'MIT', { LICENSE: 'target license' });
        fixture('build-only', 'MIT OR Apache-2.0', { 'LICENSE-MIT': 'MIT original\n', 'LICENSE-APACHE': 'Apache' });
        const entries = collect(text);
        expect(entries).toHaveLength(lockedRegistryCrates(text).length);
        expect(entries[0].texts).toEqual([{ file: 'LICENSE-MIT', text: 'MIT original\n' }]);
    });
    test('missing locked crate fails instead of silently reducing the count', () => {
        expect(() => collect(block('missing'))).toThrow('Missing locked Rust crate');
    });
    test('missing and empty license texts fail', () => {
        const dir = fixture('empty', 'MIT');
        expect(() => collect(block('empty'))).toThrow('Missing MIT license');
        fixture('empty', 'MIT', { LICENSE: ' ' });
        expect(() => collect(block('empty'))).toThrow('Empty Rust license');
    });
    test('MIT selection retains required Unicode conjunct', () => {
        const dir = fixture('unicode', '(MIT OR Apache-2.0) AND Unicode-3.0', { 'LICENSE-MIT': 'MIT', 'LICENSE-UNICODE': 'Unicode' });
        expect(collect(block('unicode'))[0]).toMatchObject({ selected: 'MIT AND Unicode-3.0', texts: [{ text: 'MIT' }, { text: 'Unicode' }] });
        fs.unlinkSync(path.join(dir, 'LICENSE-UNICODE'));
        expect(() => collect(block('unicode'))).toThrow('Missing Unicode license');
    });
    test('only pinned realfft exception permits explicitly labeled template', () => {
        fixture('realfft', 'MIT', {}, '3.5.0');
        const entry = collect(block('realfft', '3.5.0'))[0];
        expect(entry.note).toContain('Declared author');
        expect(entry.note).toContain('not verbatim');
        expect(entry.texts[0].text).toContain('<year> <copyright holders>');
        fixture('realfft', 'MIT', {}, '3.5.1');
        expect(() => collect(block('realfft', '3.5.1'))).toThrow('Missing MIT license');
    });
    test('cache identity/checksum mismatch fails closed', () => {
        const dir = fixture('bad', 'MIT', { LICENSE: 'text' });
        fs.writeFileSync(path.join(dir, '.cargo-checksum.json'), '{"package":"wrong"}');
        expect(() => collect(block('bad'))).toThrow('Cargo checksum mismatch');
    });
    test('modified extracted license fails its source integrity check', () => {
        const dir = fixture('changed', 'MIT', { LICENSE: 'Original license' });
        fs.writeFileSync(path.join(dir, 'LICENSE'), 'Altered license');
        expect(() => collect(block('changed'))).toThrow('Rust license file checksum mismatch');
    });
    test('modern Cargo cache without checksum JSON verifies archive and rejects modified license', () => {
        const dir = fixture('archived', 'MIT', { LICENSE: 'Original archived license\n' });
        fs.unlinkSync(path.join(dir, '.cargo-checksum.json'));
        const src = path.join(temp, 'src');
        const registry = 'index.crates.io-fixture';
        fs.mkdirSync(src);
        fs.renameSync(path.join(temp, registry), path.join(src, registry));
        const cache = path.join(temp, 'cache', registry);
        fs.mkdirSync(cache, { recursive: true });
        const archive = path.join(cache, 'archived-1.0.0.crate');
        tar.c({ file: archive, cwd: path.join(src, registry), sync: true, gzip: true }, ['archived-1.0.0']);
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
        const lock = path.join(temp, 'Cargo.lock');
        fs.writeFileSync(lock, block('archived').replace('verified-package-checksum', checksum));
        expect(collectRust(lock, src)[0].texts[0].text).toBe('Original archived license\n');
        fs.writeFileSync(path.join(src, registry, 'archived-1.0.0', 'LICENSE'), 'Altered license');
        expect(() => collectRust(lock, src)).toThrow('Rust license differs from locked crate archive');
    });
    test('optional dependency edges join and deduplicate production edges', () => {
        expect(
            dependencyNames({
                dependencies: { sharp: '*', shared: '*' },
                optionalDependencies: { '@img/sharp-win32-x64': '0.35.3', shared: '*' },
                devDependencies: { test: '*' },
            })
        ).toEqual(['@img/sharp-win32-x64', 'shared', 'sharp']);
    });
});

describe('generated notice contract', () => {
    const root = path.join(__dirname, '../..');
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    test('every Cargo.lock registry package has exactly one notice', () => {
        const crates = lockedRegistryCrates(fs.readFileSync(path.join(root, 'native/daddy-audio-capture/Cargo.lock'), 'utf8'));
        expect(notices).toContain(`Rust registry crates: ${crates.length}`);
        for (const crate of crates) expect(notices.split(`### ${crate.name}@${crate.version}\n`)).toHaveLength(2);
    });
    test('installed Windows optional package and complete README are retained', () => {
        const packageDir = path.join(root, 'node_modules/@img/sharp-win32-x64');
        if (!fs.existsSync(packageDir)) return;
        const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
        expect(notices).toContain(`## ${pkg.name}@${pkg.version}\n`);
        expect(notices).toContain(fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8').replace(/\r\n/g, '\n'));
    });
    test('all pinned bundled-library texts and unresolved statuses are rendered', () => {
        const packageDir = path.join(root, 'node_modules/@img/sharp-win32-x64');
        if (!fs.existsSync(packageDir)) return;
        const { version } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
        const libraries = require(`../../scripts/licenses/sharp-win32-x64-${version}.json`);
        for (const library of libraries) {
            if (library.text) expect(notices).toContain(library.text.replace(/\r\n/g, '\n'));
            if (library.unavailable) expect(notices).toContain(`**UNRESOLVED:** ${library.unavailable}`);
            for (const extra of library.additionalTexts || []) expect(notices).toContain(extra.text.replace(/\r\n/g, '\n'));
        }
    });
});
