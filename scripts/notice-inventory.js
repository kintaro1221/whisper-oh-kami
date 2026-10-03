'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const tar = require('tar');

function field(text, key) {
    const match = text.match(new RegExp(`^${key} = "([^"]+)"`, 'm'));
    if (!match) throw new Error(`Missing Cargo metadata field: ${key}`);
    return match[1];
}

function lockedRegistryCrates(lockText) {
    const blocks = lockText.split(/^\[\[package\]\]\s*$/m).slice(1);
    if (!blocks.length) throw new Error('Cargo.lock contains no packages');
    return blocks
        .filter(block => /^source = "registry\+/m.test(block))
        .map(block => ({
            name: field(block, 'name'),
            version: field(block, 'version'),
            source: field(block, 'source'),
            checksum: field(block, 'checksum'),
        }));
}

const REALFFT_TEMPLATE = `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function collectRust(lockFile, registryRoot = path.join(process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'registry', 'src')) {
    const locked = lockedRegistryCrates(fs.readFileSync(lockFile, 'utf8'));
    const registries = fs.existsSync(registryRoot) ? fs.readdirSync(registryRoot).sort() : [];
    const entries = locked.map(crate => {
        // A cache from another registry must never silently stand in for crates.io.
        if (crate.source !== 'registry+https://github.com/rust-lang/crates.io-index') throw new Error(`Unsupported Cargo registry: ${crate.source}`);
        const dirs = registries
            .filter(name => name.startsWith('index.crates.io-'))
            .map(name => path.join(registryRoot, name, `${crate.name}-${crate.version}`));
        const dir = dirs.find(candidate => fs.existsSync(path.join(candidate, 'Cargo.toml')));
        if (!dir)
            throw new Error(
                `Missing locked Rust crate ${crate.name}@${crate.version}; run cargo fetch --locked --manifest-path native/daddy-audio-capture/Cargo.toml`
            );
        const metadata = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8');
        if (field(metadata, 'name') !== crate.name || field(metadata, 'version') !== crate.version) throw new Error('Cargo cache identity mismatch');
        const checksumFile = path.join(dir, '.cargo-checksum.json');
        const archive = path.join(registryRoot, '..', 'cache', path.basename(path.dirname(dir)), `${crate.name}-${crate.version}.crate`);
        const checksum = fs.existsSync(checksumFile)
            ? JSON.parse(fs.readFileSync(checksumFile, 'utf8')).package
            : crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
        if (checksum !== crate.checksum) throw new Error(`Cargo checksum mismatch: ${crate.name}@${crate.version}`);
        function readLicense(file) {
            const text = fs.readFileSync(path.join(dir, file), 'utf8');
            if (fs.existsSync(archive)) {
                const chunks = [];
                tar.t({
                    file: archive,
                    sync: true,
                    onentry: entry => {
                        if (entry.path === `${crate.name}-${crate.version}/${file}`) entry.on('data', chunk => chunks.push(chunk));
                    },
                });
                const original = Buffer.concat(chunks).toString('utf8');
                if (text !== original) throw new Error(`Rust license differs from locked crate archive: ${crate.name}/${file}`);
            } else {
                const files = JSON.parse(fs.readFileSync(checksumFile, 'utf8')).files;
                const actual = crypto.createHash('sha256').update(text).digest('hex');
                if (!files || files[file] !== actual) throw new Error(`Rust license file checksum mismatch: ${crate.name}/${file}`);
            }
            return text;
        }
        const license = field(metadata, 'license');
        const supported = ['MIT', 'MIT OR Apache-2.0', 'Apache-2.0 OR MIT', 'Unlicense OR MIT', '(MIT OR Apache-2.0) AND Unicode-3.0'];
        if (!supported.includes(license)) throw new Error(`Review Rust license selection: ${crate.name} ${license}`);
        const files = fs.readdirSync(dir).filter(file => /^(license|licence|copying)([.-]|$)/i.test(file));
        const mit =
            files.find(file => /^license-mit$/i.test(file)) || (license === 'MIT' && files.find(file => /^license(\.txt|\.md)?$/i.test(file)));
        const texts = [];
        if (mit) texts.push({ file: mit, text: readLicense(mit) });
        else if (crate.name === 'realfft' && crate.version === '3.5.0' && license === 'MIT') {
            const authors = metadata.match(/^authors = (.+)$/m)?.[1];
            if (!authors) throw new Error('Missing realfft author provenance');
            texts.push({ file: 'SPDX MIT canonical template (not an upstream LICENSE)', text: REALFFT_TEMPLATE });
            crate.note = `The realfft 3.5.0 crate ships no license file. SPDX MIT template: https://spdx.org/licenses/MIT.html. Cargo.toml declares license = "MIT" and authors = ${authors}. Copyright year and holder are unverified; template placeholders are intentionally unfilled. This is not verbatim upstream license text.`;
        } else throw new Error(`Missing MIT license text: ${crate.name}@${crate.version}`);
        if (license.includes('AND Unicode-3.0')) {
            const unicode = files.find(file => /^license-unicode$/i.test(file));
            if (!unicode) throw new Error(`Missing Unicode license: ${crate.name}`);
            texts.push({ file: unicode, text: readLicense(unicode) });
        }
        if (texts.some(item => !item.text.trim())) throw new Error(`Empty Rust license: ${crate.name}`);
        return { ...crate, license, selected: license.includes('AND Unicode-3.0') ? 'MIT AND Unicode-3.0' : 'MIT', texts };
    });
    if (entries.length !== locked.length || new Set(entries.map(e => `${e.name}@${e.version}`)).size !== locked.length)
        throw new Error('Rust notice count invariant failed');
    return entries.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function dependencyNames(pkg) {
    return [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})])].sort();
}

module.exports = { collectRust, lockedRegistryCrates, dependencyNames };
