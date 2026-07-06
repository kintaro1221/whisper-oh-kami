'use strict';

// Generates THIRD_PARTY_NOTICES.md from the production dependency tree.
//
// Walks the `dependencies` of each production package (starting from the root
// package.json), resolving each from node_modules (npm hoists almost everything
// to the top level, with a fallback to nested node_modules), and collects the
// name, version, declared license, and the license text. Output is sorted and
// timestamp-free so re-running produces a stable, git-friendly file.
//
// When a package's tarball ships no LICENSE/LICENCE/COPYING file, falls back to
// MANUAL_LICENSE_TEXTS keyed by name@version. The fallback is **version-pinned**
// and hand-curated — we never fetch /main/LICENSE at runtime (per codex review
// v2 §H4: main can diverge from the version installed, and a 404 / repo rename
// would silently regress).
//
// Each manual entry separates the **license text** (which goes inside the code
// fence, verbatim or as the SPDX canonical template) from the **provenance
// note** (which goes outside the code fence and explains how the entry was
// constructed). The note is required for every manual entry.
//
// Caveats (codex Track A review §P1-1):
// - This walker covers `dependencies` only. `optionalDependencies`, peer
//   edges, and non-npm bundled artefacts (Rust helpers, prebuilt binaries
//   shipped via `extraResource`) are NOT inventoried by this script. Track
//   them in a separate manifest as part of the GPL Corresponding Source
//   work (LP plan v3 Phase B1).
// - Hand-vendored browser bundles under `src/assets/*.min.{js,css}`
//   (highlight.js + its github-dark theme CSS, lit, marked) are NOT npm
//   dependencies — they are committed directly to the repo and never appear
//   in package.json / node_modules. They are inventoried separately via
//   VENDORED_ASSETS below and rendered as their own "Vendored assets"
//   section (GPL §4 attribution gap fix).
// - The MANUAL_LICENSE_TEXTS map represents one of two distinct provenance
//   tiers: (a) verbatim license text reproduced from an upstream source
//   (README, repository LICENSE at the version's tag, etc.), or (b) the
//   SPDX canonical template populated from the package's declared
//   `license` field and `author` metadata when the upstream ships no
//   LICENSE file at all. Type (b) entries should be treated as a
//   best-effort attribution, not as legally-vetted verbatim text.
//
// Run with:
//   npm run notices              — generate, warn (exit 0) on missing texts
//   npm run notices -- --fail-closed
//                                — exit non-zero if any package has no text
//                                  (CI gate for B1)

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const rootNodeModules = path.join(repoRoot, 'node_modules');

const LICENSE_FILENAMES = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENCE',
    'LICENCE.md',
    'LICENCE.txt',
    'License',
    'License.md',
    'license',
    'license.md',
    'COPYING',
    'COPYING.md',
];

// ── manual license fallbacks (provenance tier (a) — verbatim) ─────────────

const NATHAN_RAJLICH_MIT_2013 = `(The MIT License)

Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const NATHAN_RAJLICH_MIT_2014 = NATHAN_RAJLICH_MIT_2013.replace(
    'Copyright (c) 2013',
    'Copyright (c) 2014'
);

const MS_ONNXRUNTIME_MIT = `MIT License

Copyright (c) Microsoft Corporation

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

// ── manual license fallbacks (provenance tier (b) — SPDX canonical template) ─

const ISC_TEMPLATE_GUID_TYPESCRIPT = `ISC License

Copyright (c) nicolas

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const MANUAL_LICENSE_TEXTS = {
    'agent-base@6.0.2': {
        text: NATHAN_RAJLICH_MIT_2013,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from the upstream package README §License (https://github.com/TooTallNate/node-agent-base, version 6.0.2). Author: Nathan Rajlich <nathan@tootallnate.net>, 2013. SPDX: MIT.',
    },

    'data-uri-to-buffer@4.0.1': {
        text: NATHAN_RAJLICH_MIT_2014,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from the upstream package README §License at https://github.com/TooTallNate/node-data-uri-to-buffer (version 4.0.1). This is a standalone repository, NOT the TooTallNate/proxy-agents monorepo — codex Track A round-5 verify §P1-A corrected the original v1 URL. Author: Nathan Rajlich <nathan@tootallnate.net>, 2014. SPDX: MIT.',
    },

    'guid-typescript@1.0.9': {
        text: ISC_TEMPLATE_GUID_TYPESCRIPT,
        provenance: 'spdx-canonical-template',
        note: 'License text below is the SPDX canonical ISC template populated from the package metadata. The upstream npm tarball at version 1.0.9 ships no LICENSE file; the package.json declares `license: "ISC"` and `author: "nicolas"`. This entry is a best-effort attribution, not a verbatim reproduction of an upstream-authored LICENSE document.',
    },

    'onnxruntime-common@1.24.0-dev.20251116-b39e144322': {
        text: MS_ONNXRUNTIME_MIT,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from the Microsoft onnxruntime monorepo LICENSE at the commit sha embedded in the version string (https://github.com/microsoft/onnxruntime/blob/b39e144322/LICENSE). The monorepo publishes multiple npm packages from one repo; LICENSE lives only at the repo root. SPDX: MIT.',
    },
    'onnxruntime-common@1.24.3': {
        text: MS_ONNXRUNTIME_MIT,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from microsoft/onnxruntime LICENSE at tag v1.24.3 (https://github.com/microsoft/onnxruntime/blob/v1.24.3/LICENSE). SPDX: MIT.',
    },
    'onnxruntime-node@1.24.3': {
        text: MS_ONNXRUNTIME_MIT,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from microsoft/onnxruntime LICENSE at tag v1.24.3 (https://github.com/microsoft/onnxruntime/blob/v1.24.3/LICENSE). SPDX: MIT.',
    },
    'onnxruntime-web@1.26.0-dev.20260416-b7804b056c': {
        text: MS_ONNXRUNTIME_MIT,
        provenance: 'verbatim',
        note: 'License text below reproduced verbatim from the Microsoft onnxruntime monorepo LICENSE at the commit sha embedded in the version string (https://github.com/microsoft/onnxruntime/blob/b7804b056c/LICENSE). SPDX: MIT.',
    },
};

// ── vendored browser assets (src/assets/*.min.{js,css} — not npm deps) ────
//
// These files are hand-vendored (downloaded once, committed directly) rather
// than installed via npm, so the `dependencies` walk above never sees them.
// They are still third-party code shipped in the built app and require the
// same GPL §4 attribution treatment. License text provenance is "verbatim"
// in all four cases: reproduced from the upstream repository's LICENSE file
// at the exact tag matching the vendored version.

const HLJS_BSD_3_CLAUSE = `BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const LIT_BSD_3_CLAUSE = `BSD 3-Clause License

Copyright (c) 2017 Google LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const MARKED_MIT = `Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

const VENDORED_ASSETS = [
    {
        name: 'highlight.js',
        version: '11.9.0',
        file: 'src/assets/highlight-11.9.0.min.js, src/assets/highlight-vscode-dark.min.css',
        license: 'BSD-3-Clause',
        text: HLJS_BSD_3_CLAUSE,
        note: 'License text below reproduced verbatim from the upstream repository LICENSE at tag 11.9.0 (https://github.com/highlightjs/highlight.js/blob/11.9.0/LICENSE). Copyright holder per that file: Ivan Sagalaev. The .min.js file\'s own banner comment confirms version and SPDX identifier ("Highlight.js v11.9.0 ... License: BSD-3-Clause"). The .min.css file is the "GitHub Dark" theme that ships inside the highlight.js repository (src/styles/github-dark.css; banner: Author github.com, Maintainer @Hirse) and is covered by the same repository LICENSE — despite the local "vscode-dark" filename, it is byte-identical (sha256 9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019) to build/styles/github-dark.min.css in the official highlightjs/cdn-release distribution at tag 11.9.0.',
    },
    {
        name: 'lit',
        version: '2.7.4',
        file: 'src/assets/lit-core-2.7.4.min.js, src/assets/lit-all-2.7.4.min.js',
        license: 'BSD-3-Clause',
        text: LIT_BSD_3_CLAUSE,
        note: "License text below reproduced verbatim from the upstream repository LICENSE at tag lit@2.7.4 (https://github.com/lit/lit/blob/lit@2.7.4/LICENSE). Copyright holder per that file: Google LLC. Both vendored files share this single license — each embeds an identical `@license Copyright 2017/2019 Google LLC SPDX-License-Identifier: BSD-3-Clause` banner per bundled module.",
    },
    {
        name: 'marked',
        version: '4.3.0',
        file: 'src/assets/marked-4.3.0.min.js',
        license: 'MIT',
        text: MARKED_MIT,
        note: 'License text below reproduced verbatim from the "Marked" section of the upstream repository LICENSE.md at tag v4.3.0 (https://github.com/markedjs/marked/blob/v4.3.0/LICENSE.md). LICENSE.md also carries a separate BSD-style license for the original Markdown spec (John Gruber) that does not apply to the marked.js code itself, so only the Marked/MIT section is reproduced here. Copyright holders per that section: MarkedJS and Christopher Jeffrey. The vendored file\'s own banner comment confirms version and license ("marked v4.3.0 ... Copyright (c) 2011-2023, Christopher Jeffrey. (MIT Licensed)").',
    },
];

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function licenseString(pkg) {
    if (!pkg) return 'UNKNOWN';
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
    if (Array.isArray(pkg.licenses)) {
        return pkg.licenses.map(l => (l && l.type ? l.type : String(l))).join(', ') || 'UNKNOWN';
    }
    return 'UNKNOWN';
}

function findLicenseText(pkgDir, name, version) {
    for (const filename of LICENSE_FILENAMES) {
        const file = path.join(pkgDir, filename);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            return { text: fs.readFileSync(file, 'utf8').trim(), source: 'package' };
        }
    }
    const key = `${name}@${version}`;
    const manual = MANUAL_LICENSE_TEXTS[key];
    if (manual) {
        return { text: manual.text, source: 'manual', provenance: manual.provenance, note: manual.note };
    }
    return { text: null, source: null };
}

// Resolve a package directory: prefer the consumer's nested node_modules, then
// fall back to the hoisted root node_modules.
function resolvePkgDir(name, fromDir) {
    const candidates = [path.join(fromDir, 'node_modules', name), path.join(rootNodeModules, name)];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    }
    return null;
}

const collected = new Map(); // name@version -> { name, version, license, text, source, provenance, note }

function visit(name, fromDir) {
    const dir = resolvePkgDir(name, fromDir);
    if (!dir) return;
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || !pkg.name) return;

    const key = `${pkg.name}@${pkg.version}`;
    if (collected.has(key)) return;
    const found = findLicenseText(dir, pkg.name, pkg.version || '0.0.0');
    collected.set(key, {
        name: pkg.name,
        version: pkg.version || '0.0.0',
        license: licenseString(pkg),
        text: found.text,
        source: found.source,
        provenance: found.provenance || null,
        note: found.note || null,
    });

    for (const dep of Object.keys(pkg.dependencies || {})) {
        visit(dep, dir);
    }
}

const rootPkg = readJson(path.join(repoRoot, 'package.json'));
if (!rootPkg) {
    console.error('Could not read root package.json');
    process.exit(1);
}

for (const dep of Object.keys(rootPkg.dependencies || {})) {
    visit(dep, repoRoot);
}

const entries = Array.from(collected.values()).sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
);

const lines = [];
lines.push('# Third-Party Notices');
lines.push('');
lines.push(`${rootPkg.productName || rootPkg.name} bundles the third-party open-source packages listed below.`);
lines.push('Each package is the property of its respective authors and is distributed under its own license.');
lines.push('');
lines.push(`Total packages: ${entries.length}`);
lines.push(`Vendored assets: ${VENDORED_ASSETS.length}`);
lines.push('');
lines.push('> **Scope.** "Total packages" inventories the **npm production dependency');
lines.push('> tree** only; "Vendored assets" covers the hand-vendored browser bundles');
lines.push('> under `src/assets/*.min.{js,css}` listed in their own section below. Neither');
lines.push('> count covers Rust-side or prebuilt-binary artefacts shipped via Electron');
lines.push('> Forge `extraResource` (such as `daddyAudioCapture.exe`). Those are tracked');
lines.push('> separately as part of the GPL Corresponding Source manifest.');
lines.push('');
lines.push('> **Manual fallbacks.** Entries marked _License text supplied from MANUAL_LICENSE_TEXTS_');
lines.push('> have a provenance note attached below the License: line and above the code fence.');
lines.push('> "Verbatim" entries reproduce upstream text exactly; "SPDX canonical template" entries');
lines.push('> are populated from `package.json` metadata when the upstream ships no LICENSE file.');
lines.push('');
lines.push('---');
lines.push('');

for (const e of entries) {
    lines.push(`## ${e.name}@${e.version}`);
    lines.push('');
    lines.push(`License: ${e.license}`);
    if (e.source === 'manual') {
        lines.push('');
        lines.push(`_License text supplied from \`scripts/generate-notices.js\` \`MANUAL_LICENSE_TEXTS\` (provenance: ${e.provenance})._`);
        lines.push('');
        lines.push(`_${e.note}_`);
    }
    lines.push('');
    if (e.text) {
        lines.push('```');
        lines.push(e.text);
        lines.push('```');
    } else {
        lines.push('_License text not found in the package; see the declared license above._');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
}

lines.push('## Vendored assets');
lines.push('');
lines.push('The packages below are NOT installed via npm — they are browser bundles');
lines.push('downloaded once and committed directly under `src/assets/`. They are listed');
lines.push('separately because the npm dependency walk above cannot see them.');
lines.push('');

for (const v of VENDORED_ASSETS) {
    lines.push(`## ${v.name}@${v.version}`);
    lines.push('');
    lines.push(`File: \`${v.file}\``);
    lines.push('');
    lines.push(`License: ${v.license}`);
    lines.push('');
    lines.push('_License text supplied from `scripts/generate-notices.js` `VENDORED_ASSETS` (provenance: verbatim)._');
    lines.push('');
    lines.push(`_${v.note}_`);
    lines.push('');
    lines.push('```');
    lines.push(v.text);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
}

const outFile = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');

const missing = entries.filter(e => !e.text);
const manualCount = entries.filter(e => e.source === 'manual').length;
const verbatimCount = entries.filter(e => e.source === 'manual' && e.provenance === 'verbatim').length;
const templateCount = entries.filter(e => e.source === 'manual' && e.provenance === 'spdx-canonical-template').length;
console.log(
    `Wrote ${path.relative(repoRoot, outFile)} (${entries.length} packages, ${manualCount} via manual fallback [verbatim=${verbatimCount}, spdx-template=${templateCount}], ${missing.length} missing; ${VENDORED_ASSETS.length} vendored assets)`
);

if (missing.length > 0) {
    console.warn(`\nWARNING: ${missing.length} package(s) have no license text:`);
    for (const e of missing) {
        console.warn(`  - ${e.name}@${e.version} (declared: ${e.license})`);
    }
    console.warn('\nAdd them to MANUAL_LICENSE_TEXTS in scripts/generate-notices.js.');

    if (process.argv.includes('--fail-closed')) {
        console.error('\nExiting non-zero due to --fail-closed flag.');
        process.exit(1);
    }
}
