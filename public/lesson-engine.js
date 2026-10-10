/* White Room lesson engine.
   Makes examples that are different every time a note is opened, yet always correct:
   numbers are drawn at random, answers are COMPUTED from them, and multiple-choice
   options are shuffled so the right one can be anywhere.
   Runs in the browser and in Node (validate.mjs loads this same file to test every lesson). */
const WRLesson = (() => {
  const MINUS = "−";

  /* ---------- tiny safe expression evaluator (no eval) ---------- */
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const mod = (a, n) => ((a % n) + n) % n;
  const inv = (a, n) => { for (let x = 1; x < n; x++) if (mod(a * x, n) === 1) return x; return NaN; };
  const FN = {
    floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt,
    min: Math.min, max: Math.max, pow: Math.pow, gcd, mod, inv, sgn: Math.sign,
  };

  function tokenize(src) {
    const out = []; let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      let m;
      if ((m = /^\d+(\.\d+)?/.exec(src.slice(i)))) { out.push({ n: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)))) { out.push({ id: m[0] }); i += m[0].length; continue; }
      if ((m = /^(==|!=|<=|>=)/.exec(src.slice(i)))) { out.push({ op: m[0] }); i += 2; continue; }
      if ("+-*/%(),<>".includes(ch)) { out.push({ op: ch }); i++; continue; }
      throw new Error("Unexpected '" + ch + "' in expression: " + src);
    }
    return out;
  }

  function evalExpr(src, vars) {
    const t = tokenize(String(src)); let p = 0;
    const peek = () => t[p]; const isOp = (o) => t[p] && t[p].op === o;
    function cmp() {
      let l = add();
      while (t[p] && ["==", "!=", "<", ">", "<=", ">="].includes(t[p].op)) {
        const o = t[p++].op; const r = add();
        l = o === "==" ? +(l === r) : o === "!=" ? +(l !== r) : o === "<" ? +(l < r) : o === ">" ? +(l > r) : o === "<=" ? +(l <= r) : +(l >= r);
      }
      return l;
    }
    function add() { let l = mul(); while (isOp("+") || isOp("-")) { const o = t[p++].op; const r = mul(); l = o === "+" ? l + r : l - r; } return l; }
    function mul() {
      let l = unary();
      while (isOp("*") || isOp("/") || isOp("%")) { const o = t[p++].op; const r = unary(); l = o === "*" ? l * r : o === "/" ? l / r : mod(l, r); }
      return l;
    }
    function unary() { if (isOp("-")) { p++; return -unary(); } if (isOp("+")) { p++; return unary(); } return prim(); }
    function prim() {
      const k = t[p++]; if (!k) throw new Error("Unexpected end of expression: " + src);
      if (k.n !== undefined) return k.n;
      if (k.op === "(") { const v = cmp(); if (!isOp(")")) throw new Error("Missing ) in " + src); p++; return v; }
      if (k.id) {
        if (isOp("(")) {
          p++; const args = [];
          if (!isOp(")")) { args.push(cmp()); while (isOp(",")) { p++; args.push(cmp()); } }
          if (!isOp(")")) throw new Error("Missing ) in " + src); p++;
          if (!FN[k.id]) throw new Error("Unknown function " + k.id);
          return FN[k.id](...args);
        }
        if (!(k.id in vars)) throw new Error("Unknown variable " + k.id + " in " + src);
        return vars[k.id];
      }
      throw new Error("Unexpected token in " + src);
    }
    const v = cmp(); if (p < t.length) throw new Error("Unexpected trailing text in " + src);
    return v;
  }

  /* ---------- number + template formatting ---------- */
  const fmt = (v, ascii) => {
    const r = Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
    const s = String(Math.abs(r));
    return r < 0 ? (ascii ? "-" : MINUS) + s : s;
  };
  // {expr} -> number;  {expr|s} -> "+ 3" or "− 3" (for writing  x {b|s}y  ->  x − 3y)
  function fill(str, vars, ascii) {
    return String(str).replace(/\{([^{}]+)\}/g, (m, body) => {
      let expr = body, sign = false; const i = body.lastIndexOf("|");
      if (i >= 0 && body.slice(i + 1).trim() === "s") { expr = body.slice(0, i); sign = true; }
      const v = evalExpr(expr, vars);
      if (!Number.isFinite(v)) throw new Error("Not a number: {" + body + "}");
      if (sign) return (v < 0 ? (ascii ? "- " : MINUS + " ") : "+ ") + fmt(Math.abs(v), ascii);
      return fmt(v, ascii);
    });
  }
  function deepFill(x, vars, asKey) {
    if (typeof x === "string") return fill(x, vars, asKey);
    if (Array.isArray(x)) return x.map((y) => deepFill(y, vars));
    if (x && typeof x === "object") { const o = {}; for (const k of Object.keys(x)) o[fill(k, vars, true)] = deepFill(x[k], vars); return o; }
    return x;
  }

  /* ---------- random ---------- */
  const randInt = (lo, hi, rnd = Math.random) => lo + Math.floor(rnd() * (hi - lo + 1));
  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ---------- build one random, checked instance of a note / exercise ---------- */
  const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const META = ["gen", "calc", "where"];
  function instantiate(spec, rnd = Math.random, tries = 400) {
    let lastErr = null;
    for (let n = 0; n < tries; n++) {
      try {
        const v = {};
        for (const [k, r] of Object.entries(spec.gen || {})) v[k] = randInt(r[0], r[1], rnd);
        for (const [k, e] of Object.entries(spec.calc || {})) v[k] = evalExpr(e, v);
        if (spec.where && !evalExpr(spec.where, v)) continue;
        const body = {}; for (const k of Object.keys(spec)) if (!META.includes(k)) body[k] = spec[k];
        const out = deepFill(body, v);
        const tasks = out.tasks || [out];
        let ok = true;
        for (const t of tasks) {
          if (t.t === "num") {
            t.f.forEach((f) => { if (typeof f.v === "string") f.v = evalExpr(f.v, v); if (!Number.isFinite(f.v)) ok = false; });
          } else if (t.t === "mc") {
            const seen = new Set(t.o.map(plain)); if (seen.size !== t.o.length) ok = false;
          }
        }
        if (!ok) continue;
        out._vars = v;
        return out;
      } catch (e) { lastErr = e; }
    }
    throw new Error("Could not build a valid example" + (lastErr ? ": " + lastErr.message : " (conditions never satisfied)"));
  }

  return { evalExpr, fill, instantiate, shuffle, randInt, fmt, plain };
})();
if (typeof window !== "undefined") window.WRLesson = WRLesson;
