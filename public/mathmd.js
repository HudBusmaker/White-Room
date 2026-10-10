/* White Room: maths + markdown rendering for practice questions and corrections.
   KaTeX and marked are loaded only when a student first opens Practice (text-first: students pay for data).
   Safety: question text is built with DOM nodes (never innerHTML). Markdown from the AI has raw HTML removed. */
(function () {
  let loading = null;
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.append(s); });
  function ensure() {
    if (window.katex && window.marked) return Promise.resolve();
    if (!loading) {
      if (!document.querySelector('link[href="vendor/katex.min.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/katex.min.css'; document.head.append(l); }
      loading = Promise.all([loadScript('vendor/katex.min.js'), loadScript('vendor/marked.min.js')]).then(() => {
        window.marked.use({ renderer: {
          html() { return ''; },                                   // raw HTML in a correction is dropped
          image() { return ''; },
          link(href, title, text) { return /^https?:\/\//i.test(href) ? '<a href="' + esc(href) + '" rel="noopener noreferrer" target="_blank">' + text + '</a>' : text; },
        } });
      }).catch((e) => { loading = null; throw e; });
    }
    return loading;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

  function mathNode(expr, display) {
    const span = document.createElement(display ? 'div' : 'span');
    span.className = display ? 'dr-mathblock' : 'dr-math';
    if (window.katex) { try { window.katex.render(expr, span, { throwOnError: false, displayMode: display, strict: 'ignore', trust: false }); return span; } catch { /* fall through */ } }
    span.textContent = (display ? '$$' : '$') + expr + (display ? '$$' : '$');
    return span;
  }
  function boldInto(node, str) {
    String(str).split(/\*\*(.+?)\*\*/g).forEach((part, i) => { if (!part) return; if (i % 2) { const b = document.createElement('strong'); b.textContent = part; node.append(b); } else node.append(document.createTextNode(part)); });
  }
  // Fill `node` with plain text, **bold** and $math$. Safe: only text nodes and KaTeX output are created.
  function text(node, str) {
    node.textContent = '';
    const s = String(str ?? ''); let last = 0, m; MATH.lastIndex = 0;
    while ((m = MATH.exec(s))) {
      if (m.index > last) boldInto(node, s.slice(last, m.index));
      node.append(mathNode(m[1] ?? m[2], m[1] != null));
      last = m.index + m[0].length;
    }
    if (last < s.length) boldInto(node, s.slice(last));
    return node;
  }
  // Markdown (reading notes, corrections) to safe HTML. Maths is lifted out first so marked cannot mangle _ and \.
  function md(str) {
    const maths = [], nonce = 'm' + Math.random().toString(36).slice(2, 8);
    const lifted = String(str ?? '').replace(MATH, (m, d, i) => { maths.push({ v: d ?? i, display: d != null }); return '@@' + nonce + (maths.length - 1) + '@@'; });
    let html = window.marked ? window.marked.parse(lifted, { gfm: true }) : '<p>' + esc(lifted) + '</p>';
    return html.replace(new RegExp('@@' + nonce + '(\\d+)@@', 'g'), (m, i) => {
      const x = maths[Number(i)]; if (!x) return '';
      if (!window.katex) return esc((x.display ? '$$' : '$') + x.v + (x.display ? '$$' : '$'));
      try { return window.katex.renderToString(x.v, { throwOnError: false, displayMode: x.display, strict: 'ignore', trust: false }); } catch { return esc(x.v); }
    });
  }
  window.WRMath = { ensure, text, md };
})();
