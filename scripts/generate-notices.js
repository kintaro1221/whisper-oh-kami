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
// and hand-curated — we never fetch /main/LICENSE at runtime (main can diverge
// from the version installed, and a 404 / repo rename would silently regress).
//
// Each manual entry separates the **license text** (which goes inside the code
// fence, verbatim or as the SPDX canonical template) from the **provenance
// note** (which goes outside the code fence and explains how the entry was
// constructed). The note is required for every manual entry.
//
// Scope: production dependencies and installed optionalDependencies, every
// registry crate in the audio helper Cargo.lock, sharp's bundled-library
// inventory, and the vendored browser assets below. Peer-only edges and other
// external binaries remain outside this inventory.
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
const { collectRust, dependencyNames } = require('./notice-inventory');

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

const NATHAN_RAJLICH_MIT_2014 = NATHAN_RAJLICH_MIT_2013.replace('Copyright (c) 2013', 'Copyright (c) 2014');

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
        note: 'License text below reproduced verbatim from the upstream package README §License at https://github.com/TooTallNate/node-data-uri-to-buffer (version 4.0.1). This is a standalone repository, NOT the TooTallNate/proxy-agents monorepo — the URL was corrected accordingly. Author: Nathan Rajlich <nathan@tootallnate.net>, 2014. SPDX: MIT.',
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

const OPENAI_WHISPER_MIT = `MIT License

Copyright (c) 2022 OpenAI

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

const APACHE_2_0_TEMPLATE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.`;

const VENDORED_ASSETS = [
    {
        name: 'openai/whisper (model weights: tiny, small)',
        version: 'tiny, small',
        file: 'resources/whisper-models/Xenova/whisper-tiny/**, resources/whisper-models/Xenova/whisper-small/**',
        license: 'MIT',
        text: OPENAI_WHISPER_MIT,
        note: 'License text below reproduced verbatim from the openai/whisper repository LICENSE (https://github.com/openai/whisper/blob/main/LICENSE, confirmed 2026-09-10). SPDX: MIT. Copyright (c) 2022 OpenAI. This installer bundles the tiny and small Whisper model weights as ONNX exports (see the separate "Xenova ONNX conversion" entry below for the conversion-layer license); OpenAI\'s MIT grant on the whisper repository covers the model itself regardless of the serialized weight format, and no separate model-specific license is published by OpenAI beyond this repository LICENSE.',
    },
    {
        name: 'Xenova ONNX conversion (whisper-tiny, whisper-small)',
        version: 'whisper-tiny, whisper-small',
        file: 'resources/whisper-models/Xenova/whisper-tiny/**, resources/whisper-models/Xenova/whisper-small/**',
        license: 'Apache-2.0',
        text: APACHE_2_0_TEMPLATE,
        provenance: 'spdx-canonical-template',
        note: 'License text below is the unfilled SPDX canonical Apache License 2.0 template, matching the `license: apache-2.0` field declared in the Hugging Face model card metadata for both Xenova/whisper-tiny and Xenova/whisper-small (confirmed 2026-09-10 via https://huggingface.co/Xenova/whisper-tiny and https://huggingface.co/Xenova/whisper-small). Neither repository ships a LICENSE file; both model cards state "https://huggingface.co/openai/whisper-{tiny,small} with ONNX weights to be compatible with Transformers.js" and list the corresponding openai/whisper-{tiny,small} repo as base_model. Declared fact: the model card metadata declares `license: apache-2.0`. Our interpretation, not an upstream statement: we read this declaration as applying to the ONNX conversion artefacts/metadata Xenova adds, distinct from and in addition to OpenAI\'s MIT license on the underlying original model weights (see the "openai/whisper" entry above) — the model cards do not themselves state the scope of the Apache-2.0 declaration. Because no repository-specific copyright line is published to populate the template\'s Appendix, the Appendix (`Copyright {yyyy} {name of copyright owner}`) is left unfilled per SPDX convention; treat this as a best-effort attribution, not a verbatim upstream LICENSE reproduction.',
    },
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
        note: 'License text below reproduced verbatim from the upstream repository LICENSE at tag lit@2.7.4 (https://github.com/lit/lit/blob/lit@2.7.4/LICENSE). Copyright holder per that file: Google LLC. Both vendored files share this single license — each embeds an identical `@license Copyright 2017/2019 Google LLC SPDX-License-Identifier: BSD-3-Clause` banner per bundled module.',
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
    const candidates = [];
    let current = fromDir;
    while (current.startsWith(repoRoot)) {
        candidates.push(path.join(current, 'node_modules', name));
        if (current === repoRoot) break;
        current = path.dirname(current);
    }
    candidates.push(path.join(rootNodeModules, name));
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
        dir,
    });

    for (const dep of dependencyNames(pkg)) {
        visit(dep, dir);
    }
}

const rootPkg = readJson(path.join(repoRoot, 'package.json'));
if (!rootPkg) {
    console.error('Could not read root package.json');
    process.exit(1);
}

for (const dep of dependencyNames(rootPkg)) {
    visit(dep, repoRoot);
}

const entries = Array.from(collected.values()).sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
);
const rustEntries = collectRust(path.join(repoRoot, 'native/daddy-audio-capture/Cargo.lock'));
const sharp = entries.find(e => e.name === '@img/sharp-win32-x64');
if (process.platform === 'win32' && process.arch === 'x64' && !sharp)
    throw new Error('Installed optional dependency @img/sharp-win32-x64 is required');
let sharpReadme;
let sharpLibraries = [];
if (sharp) {
    sharpReadme = fs.readFileSync(path.join(sharp.dir, 'README.md'), 'utf8');
    sharpLibraries = readJson(path.join(__dirname, 'licenses', `sharp-win32-x64-${sharp.version}.json`));
    if (!Array.isArray(sharpLibraries)) throw new Error(`Missing pinned sharp bundled-library inventory for ${sharp.version}`);
    const tableNames = [...sharpReadme.matchAll(/^\|\s*([a-z][a-z0-9-]*)\s*\|/gm)].map(match => match[1]);
    if (
        new Set(sharpLibraries.map(e => e.library)).size !== tableNames.length ||
        sharpLibraries.length !== tableNames.length ||
        tableNames.some(name => !sharpLibraries.some(e => e.library === name))
    )
        throw new Error('Sharp bundled-library count invariant failed');
    for (const library of sharpLibraries) {
        if ((!library.text && !library.unavailable) || (library.text && !library.source))
            throw new Error(`Missing sharp license provenance/status: ${library.library}`);
    }
    const versions = readJson(path.join(sharp.dir, 'versions.json'));
    if (!versions) throw new Error('Missing sharp bundled library versions');
    const aliases = {
        libarchive: 'archive',
        libexif: 'exif',
        libffi: 'ffi',
        libheif: 'heif',
        libimagequant: 'imagequant',
        libpng: 'png',
        librsvg: 'rsvg',
        libtiff: 'tiff',
        libultrahdr: 'uhdr',
        libvips: 'vips',
        libwebp: 'webp',
        libxml2: 'xml2',
    };
    for (const library of sharpLibraries) {
        const version = versions[aliases[library.library] || library.library];
        if (version && library.version !== version) throw new Error(`Sharp pinned library version mismatch: ${library.library}`);
        if (!version && !library.unavailable) throw new Error(`Unverified sharp library version: ${library.library}`);
    }
}

const lines = [];
lines.push('# Third-Party Notices');
lines.push('');
lines.push(`${rootPkg.productName || rootPkg.name} bundles the third-party open-source packages listed below.`);
lines.push('Each package is the property of its respective authors and is distributed under its own license.');
lines.push('');
lines.push(`Total packages: ${entries.length}`);
lines.push(`Vendored assets: ${VENDORED_ASSETS.length}`);
lines.push(`Rust registry crates: ${rustEntries.length}`);
lines.push(`Sharp bundled libraries: ${sharpLibraries.length}`);
lines.push('');
lines.push(
    `> **Generation platform: ${process.platform}/${process.arch}.** The committed release inventory is generated on Windows x64 (win32/x64).`
);
lines.push('');
lines.push('> **Scope.** "Total packages" inventories the **npm production dependency');
lines.push('> tree including installed optional dependencies**; "Vendored assets" covers');
lines.push('> the listed browser bundles. "Rust registry crates" covers ALL registry entries');
lines.push('> in `native/daddy-audio-capture/Cargo.lock`, including target-specific and build');
lines.push('> dependencies, for the bundled audio helper (`daddyAudioCapture.exe`).');
lines.push('> "Sharp bundled libraries" reproduces the installed Windows x64 package inventory.');
lines.push('> Missing bundled-library texts are explicitly identified below; this inventory');
lines.push('> does not establish complete binary attribution or corresponding-source compliance.');
lines.push('> Peer-only npm edges and other external binaries are outside this inventory.');
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
    lines.push(`_License text supplied from \`scripts/generate-notices.js\` \`VENDORED_ASSETS\` (provenance: ${v.provenance || 'verbatim'})._`);
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

lines.push('## Rust audio helper registry crates', '');
lines.push(
    'Source: `native/daddy-audio-capture/Cargo.lock`. License files are reproduced from the exact locked crates in Cargo registry source cache; line endings normalize to LF. MIT is selected where offered as an alternative. Additional conjunctive licenses are retained.',
    ''
);
for (const crate of rustEntries) {
    lines.push(
        `### ${crate.name}@${crate.version}`,
        '',
        `Declared license: ${crate.license}`,
        '',
        `Selected license: ${crate.selected}`,
        '',
        `Source: https://crates.io/crates/${crate.name}/${crate.version}`,
        '',
        `Registry checksum: \`${crate.checksum}\``,
        ''
    );
    if (crate.note) lines.push(crate.note, '');
    for (const license of crate.texts) lines.push(`License file: \`${license.file}\``, '', '```', license.text, '```', '');
}
if (sharp) {
    lines.push(
        `## Bundled libraries in @img/sharp-win32-x64@${sharp.version}`,
        '',
        'The following package README is reproduced verbatim (line endings normalized). Its upstream links are attribution, not pinned license-text provenance.',
        '',
        sharpReadme,
        ''
    );
    for (const library of sharpLibraries) {
        lines.push(`### ${library.library}@${library.version || 'version-unavailable'}`, '');
        if (library.source) lines.push(`Pinned source: ${library.source}`, '');
        if (library.text) lines.push('```', library.text, '```', '');
        for (const extra of library.additionalTexts || []) {
            if (!extra.source || !extra.text) throw new Error(`Missing additional sharp license provenance/text: ${library.library}`);
            lines.push(`Additional pinned source: ${extra.source}`, '', '```', extra.text, '```', '');
        }
        if (library.unavailable) lines.push(`**UNRESOLVED:** ${library.unavailable}`, '');
    }
}
const unresolvedSharp = sharpLibraries.filter(e => e.unavailable);
if (unresolvedSharp.length)
    console.warn(
        `WARNING: ${unresolvedSharp.length} sharp bundled-library license records unresolved: ${unresolvedSharp.map(e => e.library).join(', ')}`
    );

const outFile = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
// Normalize to LF. The joiner below is already '\n', but license texts are
// embedded verbatim from each package's LICENSE file and some of those ship
// CRLF, so the rendered document ends up mixed. Git stores this file as LF
// (`*.md text eol=lf` in .gitattributes), which means an un-normalized
// working-tree copy hashes differently from the committed one — and
// build-paid-release copies the working tree while source.zip comes from
// `git archive` HEAD. That divergence shipped in a 0.7.2 candidate: the
// bundle's top-level notices file disagreed with its own source.zip copy,
// so the release was not reproducible from its tag. Normalizing at write
// time keeps working tree, HEAD, and both release copies byte-identical.
fs.writeFileSync(outFile, lines.join('\n').replace(/\r\n/g, '\n'), 'utf8');

const missing = entries.filter(e => !e.text);
const manualCount = entries.filter(e => e.source === 'manual').length;
const verbatimCount = entries.filter(e => e.source === 'manual' && e.provenance === 'verbatim').length;
const templateCount = entries.filter(e => e.source === 'manual' && e.provenance === 'spdx-canonical-template').length;
console.log(
    `Wrote ${path.relative(repoRoot, outFile)} (${entries.length} packages, ${manualCount} via manual fallback [verbatim=${verbatimCount}, spdx-template=${templateCount}], ${missing.length} missing; ${VENDORED_ASSETS.length} vendored assets; ${rustEntries.length} Rust crates; ${sharpLibraries.length} sharp bundled libraries, ${unresolvedSharp.length} unresolved)`
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
