'use strict';

const createDOMPurify = require('dompurify');
const { normalizeExternalUrl } = require('./externalUrlPolicy');
const sanitizers = new WeakMap();

function renderResponseMarkdown(content, window) {
    const document = window.document;
    const text = typeof content === 'string' ? content : '';
    const plainText = () => {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(document.createTextNode(text));
        return fragment;
    };
    try {
        if (typeof window.marked?.parse !== 'function') return plainText();
        const html = window.marked.parse(text, { breaks: true, gfm: true });
        if (typeof html !== 'string') return plainText();
        if (!sanitizers.has(window)) sanitizers.set(window, createDOMPurify(window));
        const fragment = sanitizers.get(window).sanitize(html, {
            RETURN_DOM_FRAGMENT: true,
            ALLOWED_TAGS: [
                'p',
                'br',
                'hr',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'strong',
                'b',
                'em',
                'i',
                'del',
                's',
                'blockquote',
                'ul',
                'ol',
                'li',
                'pre',
                'code',
                'a',
                'table',
                'thead',
                'tbody',
                'tr',
                'th',
                'td',
                'input',
            ],
            ALLOWED_ATTR: ['href', 'title', 'class', 'align', 'start', 'type', 'checked', 'disabled'],
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false,
        });
        for (const element of fragment.querySelectorAll('*')) {
            // Task-list checkboxes remain inert. No other form control survives.
            if (element.tagName === 'INPUT') {
                if (element.getAttribute('type') !== 'checkbox') {
                    element.remove();
                    continue;
                }
                element.setAttribute('disabled', '');
            }
            for (const attribute of Array.from(element.attributes)) {
                const name = attribute.name;
                const allowed =
                    name === 'title' ||
                    (name === 'href' && element.tagName === 'A') ||
                    (name === 'class' && element.tagName === 'CODE' && /^language-[\w-]+$/.test(attribute.value)) ||
                    (name === 'align' && ['TH', 'TD'].includes(element.tagName) && /^(left|center|right)$/.test(attribute.value)) ||
                    (name === 'start' && element.tagName === 'OL' && /^\d+$/.test(attribute.value)) ||
                    (['type', 'checked', 'disabled'].includes(name) && element.tagName === 'INPUT');
                if (!allowed) element.removeAttribute(name);
            }
            if (element.tagName === 'A') {
                const url = normalizeExternalUrl(element.getAttribute('href'));
                if (url) element.setAttribute('href', url);
                else element.removeAttribute('href');
            }
        }
        // Only add text nodes/spans after sanitization; never reparse HTML.
        function wrap(node) {
            if (node.nodeType === window.Node.TEXT_NODE && node.textContent.trim()) {
                const words = document.createDocumentFragment();
                for (const word of node.textContent.split(/(\s+)/)) {
                    if (!word.trim()) words.appendChild(document.createTextNode(word));
                    else {
                        const span = document.createElement('span');
                        span.setAttribute('data-word', '');
                        span.textContent = word;
                        words.appendChild(span);
                    }
                }
                node.replaceWith(words);
            } else if (!['PRE', 'CODE'].includes(node.nodeName)) {
                Array.from(node.childNodes).forEach(wrap);
            }
        }
        wrap(fragment);
        return fragment;
    } catch (error) {
        console.warn('Could not render response Markdown:', error);
        return plainText();
    }
}

function handleResponseLink(event, container, openExternal) {
    const anchor = event.target?.closest?.('a');
    if (!anchor || !container.contains(anchor)) return;
    event.preventDefault();
    if (event.type === 'auxclick' && event.button !== 1) return;
    const url = normalizeExternalUrl(anchor.getAttribute('href'));
    if (url) Promise.resolve(openExternal(url)).catch(error => console.warn('Could not open response link:', error));
}

module.exports = { renderResponseMarkdown, handleResponseLink };
