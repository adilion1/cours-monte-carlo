/* demos.js — demonstrations interactives du site du cours (vanilla JS, sans dependance).
   - rend les formules deposees par le generateur (span.math / div.math-display) avec KaTeX local ;
   - monte les demos declarees par <div class="demo" data-demo="cle"> ;
   - anime le laboratoire de la page d'accueil.
   Les donnees viennent de assets/data/fil_rouge.js (window.FIL_ROUGE, derive des CSV
   du cours) : aucun fetch, donc le site fonctionne aussi en double-clic (file://). */

(() => {
  "use strict";

  const ROOT = document.body.dataset.root || "";
  const NB = " ";

  /* ---------------------------------------------------------------- *
   * 0. Formules KaTeX
   * ---------------------------------------------------------------- */

  function renderFormulas() {
    if (typeof window.katex === "undefined") return;
    document.querySelectorAll(".math").forEach((el) => {
      if (el.dataset.rendered === "1") return;
      const tex = el.textContent;
      try {
        window.katex.render(tex, el, {
          displayMode: el.classList.contains("math-display"),
          throwOnError: false,
          output: "html"
        });
        el.dataset.rendered = "1";
      } catch (_) { /* la source TeX reste lisible */ }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFormulas);
  } else {
    renderFormulas();
  }
  window.addEventListener("load", renderFormulas);

  /* ---------------------------------------------------------------- *
   * 1. Logo de l'institution (depose par l'auteur, jamais telecharge)
   * ---------------------------------------------------------------- */

  const slots = document.querySelectorAll("[data-logo-slot]");
  if (slots.length) {
    const probe = new Image();
    probe.onload = () => {
      slots.forEach((slot) => {
        const img = document.createElement("img");
        img.src = probe.src;
        img.alt = "Universite Sorbonne Paris Nord";
        slot.textContent = "";
        slot.appendChild(img);
      });
    };
    probe.src = ROOT + "assets/logo_uspn.png";
  }

  /* ---------------------------------------------------------------- *
   * 2. Outils communs
   * ---------------------------------------------------------------- */

  const SVGNS = "http://www.w3.org/2000/svg";

  function el(name, attrs, text) {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function html(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function num(value, digits) {
    const s = Math.abs(value).toFixed(digits === undefined ? 2 : digits);
    const parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NB);
    return (value < 0 ? "−" : "") + parts.join(",");
  }

  function pct(value, digits) {
    return num(value * 100, digits === undefined ? 2 : digits) + NB + "%";
  }

  function scale(d0, d1, r0, r1) {
    const span = d1 - d0 || 1;
    return (v) => r0 + ((v - d0) / span) * (r1 - r0);
  }

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(t);
    return out;
  }

  /** Cadre de graphique : grille legere, axes fins, deux couleurs. */
  function frame(width, height, pad) {
    const svg = el("svg", {
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img"
    });
    svg.style.maxHeight = height + "px";
    const g = el("g");
    svg.appendChild(g);
    return {
      svg,
      g,
      pad,
      w: width,
      h: height,
      clear() { while (g.firstChild) g.removeChild(g.firstChild); },
      axes(xs, ys, xfmt, yfmt, xTicks, yTicks) {
        (yTicks || []).forEach((t) => {
          const y = ys(t);
          g.appendChild(el("line", { class: "grid", x1: pad.l, x2: width - pad.r, y1: y, y2: y }));
          g.appendChild(el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end" }, yfmt(t)));
        });
        (xTicks || []).forEach((t) => {
          const x = xs(t);
          g.appendChild(el("text", { x, y: height - pad.b + 18, "text-anchor": "middle" }, xfmt(t)));
        });
        g.appendChild(el("line", { class: "axis", x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b }));
      },
      path(points, cls) {
        if (!points.length) return null;
        let d = "M" + points[0][0].toFixed(1) + " " + points[0][1].toFixed(1);
        for (let i = 1; i < points.length; i++) d += "L" + points[i][0].toFixed(1) + " " + points[i][1].toFixed(1);
        const p = el("path", { class: cls, d });
        g.appendChild(p);
        return p;
      },
      add(node) { g.appendChild(node); return node; }
    };
  }

  function control(label) {
    const wrap = html("label", "demo-control");
    wrap.appendChild(html("span", null, label));
    return wrap;
  }

  function slider(labelText, min, max, step, value) {
    const wrap = control(labelText);
    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step; input.value = value;
    const out = document.createElement("output");
    wrap.appendChild(input);
    wrap.appendChild(out);
    return { wrap, input, out };
  }

  function checkbox(labelText, checked) {
    const wrap = html("label", "demo-control");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    wrap.appendChild(input);
    wrap.appendChild(html("span", null, labelText));
    return { wrap, input };
  }

  function select(labelText, options, value) {
    const wrap = control(labelText);
    const input = document.createElement("select");
    options.forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      input.appendChild(o);
    });
    input.value = value;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function readout(items) {
    const wrap = html("div", "demo-readout");
    const outs = {};
    items.forEach(([key, label]) => {
      const d = html("div");
      d.appendChild(html("small", null, label));
      const o = document.createElement("output");
      outs[key] = o;
      d.appendChild(o);
      wrap.appendChild(d);
    });
    return { wrap, outs };
  }

  function legend(items) {
    const wrap = html("div", "demo-legend");
    items.forEach(([cls, text]) => wrap.appendChild(html("span", cls, text)));
    return wrap;
  }

  /* Generateur pseudo-aleatoire reproductible (memes graines, memes resultats). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normals(rng) {
    let spare = null;
    return function () {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do {
        u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const f = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * f;
      return u * f;
    };
  }

  function normalCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }

  function blackScholesCall(S0, K, sigma, r, T) {
    if (T <= 0 || sigma <= 0) return Math.max(S0 - K, 0);
    const v = sigma * Math.sqrt(T);
    const d1 = (Math.log(S0 / K) + (r + (sigma * sigma) / 2) * T) / v;
    return S0 * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d1 - v);
  }

  /* ---------------------------------------------------------------- *
   * 3. Donnees du fil rouge
   * ---------------------------------------------------------------- */

  const targets = document.querySelectorAll("[data-demo]");
  if (!targets.length) return;

  targets.forEach((node) => {
    if (!node.querySelector(".demo-loading")) node.appendChild(html("p", "demo-loading demo-note", "Chargement des donnees du fil rouge…"));
  });

  function mountAll(data) {
    targets.forEach((node) => {
      const key = node.dataset.demo;
      const build = DEMOS[key];
      node.textContent = "";
      if (!build) return;
      try {
        build(node, data);
      } catch (err) {
        node.appendChild(html("p", "demo-note", "Cette demonstration n'a pas pu demarrer : " + err.message));
      }
    });
  }

  function failAll(message) {
    targets.forEach((node) => {
      node.textContent = "";
      node.appendChild(html("p", "demo-note", message));
    });
  }

  /* Cas normal : assets/data/fil_rouge.js a defini window.FIL_ROUGE avant ce script.
     On monte dans une micro-tache : les constructeurs DEMOS sont declares plus bas. */
  if (window.FIL_ROUGE) {
    Promise.resolve().then(() => mountAll(window.FIL_ROUGE));
  } else {
    /* Aucun repli par reseau : le site ne fait aucune requete, pour que le
       double-clic (file://) fonctionne partout. Si le script de donnees manque,
       on le dit, c'est tout. */
    failAll("Les donnees du fil rouge (assets/data/fil_rouge.js) n'ont pas ete chargees : "
      + "regenerez le site avec outils/build_site.py.");
  }

  /* En-tete commun d'une demo : titre-affirmation + ce qu'il faut voir. */
  function header(node, title, see) {
    node.appendChild(html("span", "demo-label", "Demonstration interactive"));
    node.appendChild(html("h3", null, title));
    node.appendChild(html("p", "demo-see", see));
    const controls = html("div", "demo-controls");
    node.appendChild(controls);
    const plot = html("div", "demo-plot");
    node.appendChild(plot);
    return { controls, plot };
  }

  /* Series utiles, calculees une fois. */
  function simpleReturns(logs) {
    const out = new Float64Array(logs.length);
    for (let i = 0; i < logs.length; i++) out[i] = Math.exp(logs[i]) - 1;
    return out;
  }

  function yearsOf(dates) {
    return dates.map((d) => d.slice(0, 4));
  }

  /* ---------------------------------------------------------------- *
   * 4. Les demonstrations
   * ---------------------------------------------------------------- */

  const DEMOS = {};

  /* ---- ch00 u01 : la courbe des huit actifs ----------------------- */
  DEMOS["ch00-u01"] = function (node, data) {
    const labels = data.labels;
    const ui = header(node,
      "Changer un mot change l'actif, pas le geste.",
      "Ce qu'il faut voir : les niveaux ne sont pas comparables d'un actif a l'autre — l'echelle logarithmique, elle, rend les formes comparables.");

    const sel = select("Actif", data.assets.map((a) => [a, labels[a] || a]), "SP500");
    const log = checkbox("Echelle logarithmique", false);
    ui.controls.appendChild(sel.wrap);
    ui.controls.appendChild(log.wrap);

    const out = readout([["first", "Premiere cloture"], ["last", "Derniere cloture"], ["mult", "Multiple"]]);
    node.appendChild(out.wrap);
    const panelDates = data.return_dates;
    node.appendChild(html("p", "demo-note", "Panel aligne de " + num(panelDates.length, 0)
      + " seances, du " + panelDates[0] + " au " + panelDates[panelDates.length - 1]
      + " : les huit actifs sont ramenes au meme calendrier, la case numero 300 designe la meme seance pour chacun."));

    const f = frame(760, 300, { l: 62, r: 16, t: 14, b: 30 });
    ui.plot.appendChild(f.svg);

    function draw() {
      const asset = sel.input.value;
      const series = data.prices[asset].slice(1);  /* le panel des 4 151 seances */
      const useLog = log.input.checked;
      const vals = useLog ? series.map((v) => Math.log10(v)) : series;
      let lo = Infinity, hi = -Infinity;
      for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const padY = (hi - lo) * 0.06;
      const xs = scale(0, series.length - 1, f.pad.l, f.w - f.pad.r);
      const ys = scale(lo - padY, hi + padY, f.h - f.pad.b, f.pad.t);
      f.clear();
      const yTicks = niceTicks(lo - padY, hi + padY, 5);
      const years = yearsOf(panelDates);
      const xTicks = [];
      let seen = "";
      years.forEach((y, i) => {
        if (y !== seen && (+y) % 4 === 0) { xTicks.push(i); seen = y; }
      });
      f.axes(xs, ys, (i) => years[i], (t) => useLog ? num(Math.pow(10, t), 0) : num(t, 0), xTicks, yTicks);
      const pts = [];
      const stride = Math.max(1, Math.floor(series.length / 1400));
      for (let i = 0; i < series.length; i += stride) pts.push([xs(i), ys(vals[i])]);
      pts.push([xs(series.length - 1), ys(vals[series.length - 1])]);
      f.path(pts, "serie");
      f.svg.setAttribute("aria-label", "Cours de cloture de " + (labels[asset] || asset)
        + (useLog ? ", echelle logarithmique" : "") + ", de " + panelDates[0] + " a " + panelDates[panelDates.length - 1] + ".");
      out.outs.first.textContent = num(series[0], 2);
      out.outs.last.textContent = num(series[series.length - 1], 2);
      out.outs.mult.textContent = "×" + num(series[series.length - 1] / series[0], 2);
    }

    sel.input.addEventListener("change", draw);
    log.input.addEventListener("change", draw);
    draw();
  };

  /* ---- ch00 u04 : la pire annee --------------------------------- */
  DEMOS["ch00-u04"] = function (node, data) {
    const ui = header(node,
      "Deux annees seulement passent sous zero.",
      "Ce qu'il faut voir : deplacez le seuil, comptez les annees qui tombent en dessous — la pire, 2022, est a −15,28 %, et 2020, l'annee du krach, finit a +21,16 %.");

    const w = data.weights;
    const keys = Object.keys(w);
    const n = data.log_returns[keys[0]].length;
    const perYear = new Map();
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (const k of keys) r += w[k] * (Math.exp(data.log_returns[k][i]) - 1);
      const y = data.return_dates[i].slice(0, 4);
      perYear.set(y, (perYear.get(y) === undefined ? 1 : perYear.get(y)) * (1 + r));
    }
    const years = [...perYear.keys()].sort();
    const perf = years.map((y) => perYear.get(y) - 1);

    const s = slider("Seuil de perte", -20, 5, 0.5, 0);
    ui.controls.appendChild(s.wrap);
    const out = readout([["count", "Annees sous le seuil"], ["worst", "Pire annee"], ["best", "Meilleure annee"]]);
    node.appendChild(out.wrap);
    node.appendChild(legend([["", "Au-dessus du seuil"], ["k2", "Sous le seuil"]]));

    const f = frame(760, 300, { l: 52, r: 16, t: 16, b: 34 });
    ui.plot.appendChild(f.svg);

    function draw() {
      const thr = parseFloat(s.input.value) / 100;
      s.out.value = pct(thr, 1);
      const lo = Math.min(-0.2, Math.min.apply(null, perf) - 0.03);
      const hi = Math.max.apply(null, perf) + 0.03;
      const xs = scale(0, years.length, f.pad.l, f.w - f.pad.r);
      const ys = scale(lo, hi, f.h - f.pad.b, f.pad.t);
      f.clear();
      f.axes(xs, ys, () => "", (t) => pct(t, 0), [], niceTicks(lo, hi, 6));
      const bw = (f.w - f.pad.l - f.pad.r) / years.length;
      let count = 0;
      years.forEach((y, i) => {
        const v = perf[i];
        const under = v <= thr;
        if (under) count++;
        const y0 = ys(0), y1 = ys(v);
        f.add(el("rect", {
          class: under ? "bar-neg" : "bar",
          x: xs(i) + bw * 0.16,
          y: Math.min(y0, y1),
          width: bw * 0.68,
          height: Math.max(1, Math.abs(y1 - y0)),
          opacity: under ? 1 : 0.75
        }));
        f.add(el("text", { x: xs(i) + bw / 2, y: f.h - f.pad.b + 16, "text-anchor": "middle" }, y.slice(2)));
      });
      f.add(el("line", { class: "dashed", x1: f.pad.l, x2: f.w - f.pad.r, y1: ys(thr), y2: ys(thr) }));
      f.add(el("text", { class: "annot", x: f.w - f.pad.r, y: ys(thr) - 6, "text-anchor": "end" }, "seuil " + pct(thr, 1)));
      f.add(el("line", { class: "axis", x1: f.pad.l, x2: f.w - f.pad.r, y1: ys(0), y2: ys(0) }));
      const iw = perf.indexOf(Math.min.apply(null, perf));
      const ib = perf.indexOf(Math.max.apply(null, perf));
      out.outs.count.textContent = String(count);
      out.outs.worst.textContent = years[iw] + " " + pct(perf[iw], 2);
      out.outs.best.textContent = years[ib] + " +" + pct(perf[ib], 2);
      f.svg.setAttribute("aria-label", "Performances annuelles du portefeuille, " + count + " annees sous " + pct(thr, 1) + ".");
    }

    s.input.addEventListener("input", draw);
    draw();
  };

  /* ---- ch00 u06 : boucle contre tableau -------------------------- */
  DEMOS["ch00-u06"] = function (node, data) {
    const ui = header(node,
      "Le meme calcul, ecrit deux fois : le chronometre tranche.",
      "Ce qu'il faut voir : les deux colonnes donnent le meme compte ; l'ecart est le temps, et il grandit avec N. Le chronometre est reel, dans votre navigateur.");

    const s = slider("N (valeurs)", 4, 7, 0.25, 6);
    ui.controls.appendChild(s.wrap);
    const btn = html("button", "demo-button", "Relancer la mesure");
    btn.type = "button";
    ui.controls.appendChild(btn);
    const out = readout([["n", "N"], ["loop", "Boucle"], ["vec", "Tableau"], ["ratio", "Facteur"], ["share", "Part sous −2 %"]]);
    node.appendChild(out.wrap);
    node.appendChild(html("p", "demo-note",
      "Les valeurs sont les 4 151 rendements du S&P 500 du fil rouge, repetes jusqu'a N. A gauche, chaque valeur est un objet et la "
      + "comparaison passe par une recherche de l'operation a appliquer, valeur par valeur : c'est le travail qu'un interprete refait a "
      + "chaque tour de boucle. A droite, les memes nombres sont ranges bruts dans un tableau et compares directement. Le rapport affiche "
      + "est celui de votre navigateur, pas celui de Python — l'unite, elle, mesure 0,35 s contre 0,01 s, soit un facteur 35."));

    const f = frame(760, 200, { l: 92, r: 22, t: 20, b: 34 });
    ui.plot.appendChild(f.svg);

    const base = data.log_returns.SP500;

    /* Cote "boucle" : chaque valeur est un objet, et la comparaison passe par une
       recherche de l'operation a appliquer — c'est ce que fait un interprete, a
       chaque tour. Cote "tableau" : des nombres bruts et une comparaison directe. */
    const OPS = [
      { nom: "lt", appliquer: function (a, b) { return a < b; } },
      { nom: "lt2", appliquer: function (a, b) { return !(a >= b); } },
      { nom: "lt3", appliquer: function (a, b) { return Math.min(a, b) === a && a !== b; } },
      { nom: "lt4", appliquer: function (a, b) { return b - a > 0; } }
    ];
    const REGISTRE = new Map(OPS.map((o) => [o.nom, o]));

    function run() {
      const N = Math.round(Math.pow(10, parseFloat(s.input.value)));
      s.out.value = num(N, 0);
      const list = new Array(N);
      const buf = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const v = base[i % base.length];
        list[i] = { valeur: v, nom: OPS[i & 3].nom };
        buf[i] = v;
      }

      let t0 = performance.now();
      const retenus = [];
      for (let i = 0; i < N; i++) {
        const item = list[i];
        const op = REGISTRE.get(item.nom);
        if (op.appliquer(item.valeur, -0.02)) retenus.push(item.valeur);
      }
      const count = retenus.length;
      const tLoop = performance.now() - t0;

      t0 = performance.now();
      let count2 = 0;
      for (let i = 0; i < N; i++) count2 += buf[i] < -0.02 ? 1 : 0;
      const tVec = performance.now() - t0;

      out.outs.n.textContent = num(N, 0);
      out.outs.loop.textContent = num(tLoop, 1) + NB + "ms";
      out.outs.vec.textContent = num(tVec, 1) + NB + "ms";
      out.outs.ratio.textContent = "×" + num(tLoop / Math.max(tVec, 0.001), 1);
      out.outs.share.textContent = pct(count / N, 2) + (count === count2 ? "" : " (!)");

      const hi = Math.max(tLoop, tVec, 0.5) * 1.15;
      const xs = scale(0, hi, f.pad.l, f.w - f.pad.r);
      f.clear();
      [["Boucle", tLoop, "bar-neg", 46], ["Tableau", tVec, "bar", 106]].forEach(([label, t, cls, y]) => {
        f.add(el("text", { x: f.pad.l - 10, y: y + 16, "text-anchor": "end", class: "annot" }, label));
        f.add(el("rect", { class: cls, x: f.pad.l, y, width: Math.max(2, xs(t) - f.pad.l), height: 30 }));
        f.add(el("text", { x: Math.max(2, xs(t) - f.pad.l) + f.pad.l + 8, y: y + 20, class: "annot" }, num(t, 1) + " ms"));
      });
      f.add(el("line", { class: "axis", x1: f.pad.l, x2: f.w - f.pad.r, y1: 152, y2: 152 }));
      f.svg.setAttribute("aria-label", "Temps mesures : boucle " + num(tLoop, 1) + " ms, tableau " + num(tVec, 1) + " ms, pour N = " + N + ".");
    }

    s.input.addEventListener("input", run);
    btn.addEventListener("click", run);
    run();
  };

  /* ---- ch01 u02 : la fenetre de la volatilite -------------------- */
  DEMOS["ch01-u02"] = function (node, data) {
    const ui = header(node,
      "Le meme actif donne 6,7 % ou 34,8 % : la fenetre fait partie du chiffre.",
      "Ce qu'il faut voir : la volatilite glissante du S&P 500 n'est pas une constante ; la fenetre courte suit les crises, la fenetre longue les moyenne.");

    const logs = data.log_returns.SP500;
    const dates = data.return_dates;
    const sel = select("Fenetre", [["63", "63 seances (un trimestre)"], ["252", "252 seances (un an)"], ["1260", "1 260 seances (cinq ans)"]], "252");
    ui.controls.appendChild(sel.wrap);
    const out = readout([["last", "Derniere valeur"], ["min", "Minimum"], ["max", "Maximum"], ["full", "Panel entier"]]);
    node.appendChild(out.wrap);
    node.appendChild(html("p", "demo-note",
      "Volatilite annualisee : ecart-type des log-rendements sur la fenetre, multiplie par la racine de 252. "
      + "Les deux chiffres de reference du cours sont la fenetre 252 (12,84 %) et la fenetre 1 260 (16,96 %)."));

    const f = frame(760, 300, { l: 56, r: 16, t: 16, b: 30 });
    ui.plot.appendChild(f.svg);

    function rolling(win) {
      const out2 = new Float64Array(logs.length);
      out2.fill(NaN);
      let sum = 0, sum2 = 0;
      for (let i = 0; i < logs.length; i++) {
        sum += logs[i]; sum2 += logs[i] * logs[i];
        if (i >= win) { sum -= logs[i - win]; sum2 -= logs[i - win] * logs[i - win]; }
        if (i >= win - 1) {
          const mean = sum / win;
          const varr = (sum2 - win * mean * mean) / (win - 1);
          out2[i] = Math.sqrt(Math.max(varr, 0)) * Math.sqrt(252);
        }
      }
      return out2;
    }

    function fullVol() {
      let sum = 0;
      for (const v of logs) sum += v;
      const mean = sum / logs.length;
      let acc = 0;
      for (const v of logs) acc += (v - mean) * (v - mean);
      return Math.sqrt(acc / (logs.length - 1)) * Math.sqrt(252);
    }

    const FULL = fullVol();

    function draw() {
      const win = parseInt(sel.input.value, 10);
      const series = rolling(win);
      let lo = Infinity, hi = -Infinity;
      for (const v of series) { if (!isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      const xs = scale(0, series.length - 1, f.pad.l, f.w - f.pad.r);
      const ys = scale(0, hi * 1.1, f.h - f.pad.b, f.pad.t);
      f.clear();
      const years = yearsOf(dates);
      const xTicks = [];
      let seen = "";
      years.forEach((y, i) => { if (y !== seen && (+y) % 4 === 0) { xTicks.push(i); seen = y; } });
      f.axes(xs, ys, (i) => years[i], (t) => pct(t, 0), xTicks, niceTicks(0, hi * 1.1, 5));
      const pts = [];
      for (let i = 0; i < series.length; i++) if (!isNaN(series[i])) pts.push([xs(i), ys(series[i])]);
      f.path(pts, "serie");
      f.add(el("line", { class: "dashed", x1: f.pad.l, x2: f.w - f.pad.r, y1: ys(FULL), y2: ys(FULL) }));
      f.add(el("text", { class: "annot", x: f.pad.l + 6, y: ys(FULL) - 6 }, "panel entier " + pct(FULL, 2)));
      const last = series[series.length - 1];
      out.outs.last.textContent = pct(last, 2);
      out.outs.min.textContent = pct(lo, 2);
      out.outs.max.textContent = pct(hi, 2);
      out.outs.full.textContent = pct(FULL, 2);
      f.svg.setAttribute("aria-label", "Volatilite annualisee glissante sur " + win + " seances, de " + pct(lo, 2) + " a " + pct(hi, 2) + ".");
    }

    sel.input.addEventListener("change", draw);
    draw();
  };

  /* ---- ch01 u03 : diversifier n'est pas moyenner ----------------- */
  DEMOS["ch01-u03"] = function (node, data) {
    const ui = header(node,
      "Six lignes melangees passent sous la plus prudente des six.",
      "Ce qu'il faut voir : la volatilite du melange (barre verte) reste sous la moyenne ponderee (trait orange) tant que les lignes ne bougent pas ensemble.");

    const keys = Object.keys(data.weights);
    const refW = keys.map((k) => data.weights[k]);
    const n = data.log_returns[keys[0]].length;

    /* Rendements simples, convention de reference du cours (13,40 %). */
    const R = keys.map((k) => simpleReturns(data.log_returns[k]));
    const means = R.map((s) => { let a = 0; for (let i = 0; i < n; i++) a += s[i]; return a / n; });
    const cov = [];
    for (let i = 0; i < keys.length; i++) {
      cov.push(new Float64Array(keys.length));
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        let acc = 0;
        for (let t = 0; t < n; t++) acc += (R[i][t] - means[i]) * (R[j][t] - means[j]);
        const c = acc / (n - 1);
        cov[i][j] = c; cov[j][i] = c;
      }
    }
    const solo = keys.map((_, i) => Math.sqrt(cov[i][i] * 252));

    const sliders = keys.map((k, i) => {
      const s = slider(data.labels[k] || k, 0, 100, 1, Math.round(refW[i] * 100));
      ui.controls.appendChild(s.wrap);
      return s;
    });
    const reset = html("button", "demo-button", "Poids de reference");
    reset.type = "button";
    ui.controls.appendChild(reset);

    const out = readout([["vol", "Volatilite du melange"], ["avg", "Moyenne ponderee"], ["gain", "Points gagnes"], ["low", "Ligne la plus prudente"]]);
    node.appendChild(out.wrap);
    node.appendChild(html("p", "demo-note",
      "Les poids sont normalises pour sommer a 100 %. La matrice de covariance est calculee ici, dans le navigateur, "
      + "sur les 4 151 rendements du panel. Aux poids de reference (40/20/10/10/10/10), la volatilite du melange vaut 13,40 %."));

    const f = frame(760, 300, { l: 52, r: 16, t: 20, b: 40 });
    ui.plot.appendChild(f.svg);

    function draw() {
      let raw = sliders.map((s) => parseFloat(s.input.value));
      let total = raw.reduce((a, b) => a + b, 0);
      if (total <= 0) { raw = refW.map((v) => v * 100); total = 100; }
      const w = raw.map((v) => v / total);
      sliders.forEach((s, i) => { s.out.value = pct(w[i], 1); });

      let varr = 0;
      for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) varr += w[i] * w[j] * cov[i][j];
      const vol = Math.sqrt(Math.max(varr, 0) * 252);
      const avg = w.reduce((a, wi, i) => a + wi * solo[i], 0);
      const lowest = Math.min.apply(null, solo);

      const hi = Math.max(avg, Math.max.apply(null, solo)) * 1.12;
      const xs = scale(0, keys.length + 2, f.pad.l, f.w - f.pad.r);
      const ys = scale(0, hi, f.h - f.pad.b, f.pad.t);
      f.clear();
      f.axes(xs, ys, () => "", (t) => pct(t, 0), [], niceTicks(0, hi, 5));
      const bw = (f.w - f.pad.l - f.pad.r) / (keys.length + 2);
      keys.forEach((k, i) => {
        f.add(el("rect", { class: "bar", x: xs(i) + bw * 0.18, y: ys(solo[i]), width: bw * 0.64, height: f.h - f.pad.b - ys(solo[i]), opacity: 0.55 }));
        f.add(el("text", { x: xs(i) + bw / 2, y: f.h - f.pad.b + 16, "text-anchor": "middle" }, data.labels[k] || k));
        f.add(el("text", { x: xs(i) + bw / 2, y: f.h - f.pad.b + 30, "text-anchor": "middle" }, pct(w[i], 0)));
      });
      const im = keys.length;
      f.add(el("rect", { class: "bar-neg", x: xs(im) + bw * 0.18, y: ys(avg), width: bw * 0.64, height: f.h - f.pad.b - ys(avg) }));
      f.add(el("text", { x: xs(im) + bw / 2, y: f.h - f.pad.b + 16, "text-anchor": "middle" }, "moyenne"));
      const ip = keys.length + 1;
      f.add(el("rect", { class: "bar", x: xs(ip) + bw * 0.18, y: ys(vol), width: bw * 0.64, height: f.h - f.pad.b - ys(vol) }));
      f.add(el("text", { class: "annot", x: xs(ip) + bw / 2, y: ys(vol) - 8, "text-anchor": "middle" }, pct(vol, 2)));
      f.add(el("text", { x: xs(ip) + bw / 2, y: f.h - f.pad.b + 16, "text-anchor": "middle" }, "melange"));
      f.add(el("line", { class: "dashed", x1: f.pad.l, x2: f.w - f.pad.r, y1: ys(lowest), y2: ys(lowest) }));
      f.add(el("text", { class: "annot", x: f.pad.l + 6, y: ys(lowest) - 6 }, "la plus prudente des lignes " + pct(lowest, 2)));

      out.outs.vol.textContent = pct(vol, 2);
      out.outs.avg.textContent = pct(avg, 2);
      out.outs.gain.textContent = num((avg - vol) * 100, 2) + NB + "pt";
      out.outs.low.textContent = pct(lowest, 2);
      f.svg.setAttribute("aria-label", "Volatilite du melange " + pct(vol, 2) + " contre moyenne ponderee " + pct(avg, 2) + ".");
    }

    sliders.forEach((s) => s.input.addEventListener("input", draw));
    reset.addEventListener("click", () => {
      sliders.forEach((s, i) => { s.input.value = Math.round(refW[i] * 100); });
      draw();
    });
    draw();
  };

  /* ---- ch01 u05 : le dessin du besoin ---------------------------- */
  DEMOS["ch01-u05"] = function (node, data) {
    const S0 = data.params.S0;
    const ui = header(node,
      "Le payoff est un dessin ; le profit, le meme dessin descendu de la prime.",
      "Ce qu'il faut voir : le coude est exactement au prix d'exercice, et le point mort n'est pas le prix d'exercice — il en est distant de la prime capitalisee.");

    const type = select("Contrat", [["call", "Call (droit d'acheter)"], ["put", "Put (droit de vendre)"]], "call");
    const side = select("Position", [["long", "Longue (acheteur)"], ["short", "Courte (vendeur)"]], "long");
    const K = slider("Prix d'exercice K", Math.round(S0 * 0.7), Math.round(S0 * 1.3), 0.1, S0);
    const prem = slider("Prime", 0, 1200, 0.05, 567.15);
    [type.wrap, side.wrap, K.wrap, prem.wrap].forEach((w) => ui.controls.appendChild(w));

    const out = readout([["breakeven", "Point mort"], ["maxloss", "Perte maximale"], ["maxgain", "Gain maximal"], ["intrinsic", "Valeur intrinseque en S0"]]);
    node.appendChild(out.wrap);
    node.appendChild(legend([["", "Payoff a l'echeance"], ["k2", "Profit (payoff − prime)"]]));
    node.appendChild(html("p", "demo-note",
      "S0 = " + num(S0, 2) + " (S&P 500 du fil rouge). La prime est comptee sans capitalisation dans ce dessin ; "
      + "le cours rappelle qu'un point mort exact la capitalise a l'echeance."));

    const f = frame(760, 320, { l: 62, r: 16, t: 18, b: 32 });
    ui.plot.appendChild(f.svg);

    function draw() {
      const k = parseFloat(K.input.value);
      const p = parseFloat(prem.input.value);
      const isCall = type.input.value === "call";
      const sign = side.input.value === "long" ? 1 : -1;
      K.out.value = num(k, 2);
      prem.out.value = num(p, 2);

      const lo = S0 * 0.55, hi = S0 * 1.45;
      const payoff = (s) => (isCall ? Math.max(s - k, 0) : Math.max(k - s, 0)) * sign;
      const profit = (s) => payoff(s) - sign * p;

      const grid = [];
      for (let i = 0; i <= 240; i++) grid.push(lo + ((hi - lo) * i) / 240);
      const vals = grid.map(profit).concat(grid.map(payoff));
      let ymin = Math.min.apply(null, vals), ymax = Math.max.apply(null, vals);
      const padY = (ymax - ymin) * 0.12 || 100;
      ymin -= padY; ymax += padY;

      const xs = scale(lo, hi, f.pad.l, f.w - f.pad.r);
      const ys = scale(ymin, ymax, f.h - f.pad.b, f.pad.t);
      f.clear();
      f.axes(xs, ys, (t) => num(t, 0), (t) => num(t, 0), niceTicks(lo, hi, 5), niceTicks(ymin, ymax, 5));
      f.add(el("line", { class: "axis", x1: f.pad.l, x2: f.w - f.pad.r, y1: ys(0), y2: ys(0) }));
      f.path(grid.map((s) => [xs(s), ys(payoff(s))]), "serie");
      f.path(grid.map((s) => [xs(s), ys(profit(s))]), "serie-2");
      f.add(el("line", { class: "grid", x1: xs(k), x2: xs(k), y1: f.pad.t, y2: f.h - f.pad.b }));
      f.add(el("text", { class: "annot", x: xs(k) + 6, y: f.pad.t + 12 }, "K = " + num(k, 2)));

      const be = isCall ? k + p : k - p;
      if (be >= lo && be <= hi) {
        f.add(el("circle", { class: "mark", cx: xs(be), cy: ys(0), r: 4 }));
        f.add(el("text", { class: "annot", x: xs(be) + 8, y: ys(0) - 8 }, "point mort " + num(be, 2)));
      }

      out.outs.breakeven.textContent = num(be, 2);
      if (sign === 1) {
        out.outs.maxloss.textContent = "−" + num(p, 2);
        out.outs.maxgain.textContent = isCall ? "illimite" : num(k - p, 2);
      } else {
        out.outs.maxloss.textContent = isCall ? "illimitee" : "−" + num(k - p, 2);
        out.outs.maxgain.textContent = num(p, 2);
      }
      out.outs.intrinsic.textContent = num(isCall ? Math.max(S0 - k, 0) : Math.max(k - S0, 0), 2);
      f.svg.setAttribute("aria-label", "Payoff et profit d'un " + type.input.value + " " + side.input.value
        + ", prix d'exercice " + num(k, 2) + ", prime " + num(p, 2) + ".");
    }

    [type.input, side.input, K.input, prem.input].forEach((i) => i.addEventListener("input", draw));
    type.input.addEventListener("change", draw);
    side.input.addEventListener("change", draw);
    draw();
  };

  /* ---------------------------------------------------------------- *
   * 5. Page d'accueil : graphique signature, sparkline, laboratoire
   * ---------------------------------------------------------------- */

  const REDUCE = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /** Un jeu de trajectoires GBM exactes (pas hebdomadaires ou plus fins). */
  function gbmPaths(spot, mu, sigma, T, steps, count, seed) {
    const gauss = normals(mulberry32(seed));
    const dt = T / steps;
    const drift = (mu - (sigma * sigma) / 2) * dt;
    const vol = sigma * Math.sqrt(dt);
    const out = [];
    for (let p = 0; p < count; p++) {
      const row = new Float64Array(steps + 1);
      row[0] = spot;
      for (let t = 1; t <= steps; t++) row[t] = row[t - 1] * Math.exp(drift + vol * gauss());
      out.push(row);
    }
    return out;
  }

  /* ---- Graphique signature du hero ------------------------------- */

  DEMOS["hero-signature"] = function (node, data) {
    const P = data.params;
    const S0 = P.S0, K = P.S0, r = P.r, sigma = P.sigma_1y, T = 1;
    const refBS = blackScholesCall(S0, K, sigma, r, T);

    const card = html("div", "lp-sigcard");
    const head = html("div", "lp-sig-head");
    head.appendChild(html("p", "lp-sig-title",
      "15 trajectoires simulées · S₀ = " + num(S0, 2) + " · T = 1 an"));
    const count = html("div", "lp-sig-count");
    const nOut = html("span", "n", "N = 100");
    const priceOut = html("span", "price", num(refBS, 2));
    const ciOut = html("span", "ci", "± 0,00");
    const refOut = html("span", "ref", "Black-Scholes " + num(refBS, 2));
    count.appendChild(nOut);
    count.appendChild(priceOut);
    count.appendChild(ciOut);
    count.appendChild(refOut);
    head.appendChild(count);
    card.appendChild(head);

    const plot = html("div", "lp-sig-plot");
    card.appendChild(plot);

    const foot = html("div", "lp-sig-foot");
    foot.appendChild(html("span", null, "K = " + num(K, 2) + " · à la monnaie"));
    foot.appendChild(html("span", null, "payoff = max(S_T − K, 0), actualisé"));
    card.appendChild(foot);
    node.appendChild(card);

    /* --- le dessin, une fois pour toutes --- */
    const W = 560, H = 320;
    const padL = 8, padR = 74, padT = 14, padB = 26;
    const steps = 52, pathCount = 15;
    const paths = gbmPaths(S0, r, sigma, T, steps, pathCount, 20260904);

    let lo = Infinity, hi = -Infinity;
    paths.forEach((row) => { for (let i = 0; i < row.length; i++) { if (row[i] < lo) lo = row[i]; if (row[i] > hi) hi = row[i]; } });
    lo = Math.min(lo, K) * 0.995;
    hi = Math.max(hi, K) * 1.005;

    const xs = scale(0, steps, padL, W - padR);
    const ys = scale(lo, hi, H - padB, padT);
    const f = frame(W, H, { l: padL, r: padR, t: padT, b: padB });

    /* zone de payoff : la fin du chemin, au-dessus de K */
    const bandX = xs(steps * 0.8);
    f.add(el("rect", {
      class: "payzone", x: bandX, y: padT,
      width: (W - padR) - bandX, height: Math.max(0, ys(K) - padT)
    }));
    f.add(el("line", { class: "payedge", x1: bandX, x2: bandX, y1: padT, y2: ys(K) }));

    /* graduations discretes a droite ; on saute celle qui heurterait K */
    niceTicks(lo, hi, 3).forEach((t) => {
      if (t < lo || t > hi) return;
      if (Math.abs(ys(t) - ys(K)) < 16) return;
      f.add(el("text", { x: W - padR + 8, y: ys(t) + 4 }, num(t, 0)));
    });

    /* la trajectoire mise en avant : celle dont S_T est la plus proche de la moyenne */
    let mean = 0;
    paths.forEach((row) => { mean += row[steps]; });
    mean /= paths.length;
    let heroIndex = 0, best = Infinity;
    paths.forEach((row, i) => {
      const d = Math.abs(row[steps] - mean);
      if (d < best) { best = d; heroIndex = i; }
    });

    paths.forEach((row, i) => {
      if (i === heroIndex) return;
      const pts = [];
      for (let t = 0; t <= steps; t++) pts.push([xs(t), ys(row[t])]);
      f.path(pts, "traj");
    });
    const heroPts = [];
    for (let t = 0; t <= steps; t++) heroPts.push([xs(t), ys(paths[heroIndex][t])]);
    f.path(heroPts, "traj-hero");

    /* le prix d'exercice */
    f.add(el("line", { class: "kline", x1: padL, x2: W - padR, y1: ys(K), y2: ys(K) }));
    f.add(el("text", { class: "k", x: padL + 3, y: ys(K) - 7 }, "K = " + num(K, 2)));
    f.add(el("text", { class: "pay", x: bandX + 6, y: padT + 14 }, "S_T > K"));

    f.svg.style.maxHeight = "none";
    f.svg.setAttribute("aria-label",
      "Quinze trajectoires simulées du portefeuille sur un an, autour du prix d’exercice "
      + num(K, 2) + " ; la zone où l’option paie est marquée à droite.");
    plot.appendChild(f.svg);

    /* --- le compteur qui monte --- */
    const checkpoints = [];
    (function build() {
      const targets = [];
      for (let k = 0; k <= 59; k++) targets.push(Math.round(Math.pow(10, 2 + (3 * k) / 59)));
      const gauss = normals(mulberry32(7718));
      const drift = (r - (sigma * sigma) / 2) * T;
      const vol = sigma * Math.sqrt(T);
      const disc = Math.exp(-r * T);
      let sum = 0, sum2 = 0, next = 0;
      const total = targets[targets.length - 1];
      for (let i = 1; i <= total; i++) {
        const ST = S0 * Math.exp(drift + vol * gauss());
        const g = ST > K ? (ST - K) * disc : 0;
        sum += g; sum2 += g * g;
        while (next < targets.length && targets[next] === i) {
          const m = sum / i;
          const v = Math.max((sum2 - i * m * m) / Math.max(i - 1, 1), 0);
          checkpoints.push([i, m, 1.96 * Math.sqrt(v / i)]);
          next += 1;
        }
      }
    })();

    function show(index) {
      const c = checkpoints[Math.max(0, Math.min(checkpoints.length - 1, index))];
      nOut.textContent = "N = " + num(c[0], 0);
      priceOut.textContent = num(c[1], 2);
      ciOut.textContent = "± " + num(c[2], 2) + " (IC 95 %)";
    }

    show(checkpoints.length - 1);
    node.setAttribute("data-signature-ready", "1");

    if (REDUCE()) return;

    const PERIOD = 6000, HOLD = 1400;
    let paused = false, raf = 0, origin = performance.now();

    function tick(now) {
      if (!paused) {
        const t = (now - origin) % (PERIOD + HOLD);
        const p = Math.min(1, t / PERIOD);
        const eased = p * p * (3 - 2 * p);
        show(Math.round(eased * (checkpoints.length - 1)));
      }
      raf = requestAnimationFrame(tick);
    }

    card.addEventListener("mouseenter", () => { paused = true; });
    card.addEventListener("mouseleave", () => { paused = false; origin = performance.now(); });
    card.addEventListener("focusin", () => { paused = true; });
    raf = requestAnimationFrame(tick);
    window.addEventListener("pagehide", () => cancelAnimationFrame(raf));
  };

  /* ---- Sparkline 2020 : le repli sous le plus haut ---------------- */
  /* Bande illustree d'une carte « idee a emporter » : 320 x 116, un seul accent
     (le point ocre du creux et son etiquette). Aucun axe, aucune legende : la
     categorie et la phrase de la carte disent deja de quoi il s'agit. */

  DEMOS["note-sparkline"] = function (node, data) {
    const weights = data.weights;
    const keys = Object.keys(weights);
    const dates = data.return_dates;
    const n = dates.length;

    let nav = 1, peak = 1;
    const xsDate = [], drawdown = [];
    for (let i = 0; i < n; i++) {
      let step = 0;
      for (let k = 0; k < keys.length; k++) step += weights[keys[k]] * (Math.exp(data.log_returns[keys[k]][i]) - 1);
      nav *= 1 + step;
      if (nav > peak) peak = nav;
      if (dates[i].slice(0, 4) === "2020") {
        xsDate.push(dates[i]);
        drawdown.push(nav / peak - 1);
      }
    }
    if (!drawdown.length) { node.appendChild(html("p", "demo-note", "Série 2020 indisponible.")); return; }

    let lowIndex = 0;
    for (let i = 1; i < drawdown.length; i++) if (drawdown[i] < drawdown[lowIndex]) lowIndex = i;

    const W = 320, H = 116;
    const padL = 10, padR = 10, padT = 10, padB = 26;
    const lo = Math.min(-0.12, drawdown[lowIndex] * 1.30);
    const xs = scale(0, drawdown.length - 1, padL, W - padR);
    const ys = scale(lo, 0.012, H - padB, padT);
    const f = frame(W, H, { l: padL, r: padR, t: padT, b: padB });

    f.add(el("line", { class: "sparkzero", x1: padL, x2: W - padR, y1: ys(0), y2: ys(0) }));
    const pts = [];
    for (let i = 0; i < drawdown.length; i++) pts.push([xs(i), ys(drawdown[i])]);
    f.path(pts, "spark");

    const lx = xs(lowIndex), ly = ys(drawdown[lowIndex]);
    f.add(el("circle", { class: "lowdot", cx: lx, cy: ly, r: 3.6 }));
    const label = pct(drawdown[lowIndex], 1);
    const anchor = lx > W * 0.62 ? "end" : "start";
    f.add(el("text", { class: "low", x: lx + (anchor === "end" ? -8 : 8), y: ly + 15, "text-anchor": anchor }, label));

    const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
      "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const lowDate = xsDate[lowIndex];
    f.svg.style.maxHeight = "none";
    f.svg.setAttribute("aria-label",
      "Repli du portefeuille sous son plus haut en 2020 ; creux de " + label + " le "
      + parseInt(lowDate.slice(8, 10), 10) + " " + MOIS[parseInt(lowDate.slice(5, 7), 10) - 1] + ".");
    node.appendChild(f.svg);
  };

  /* ---- Laboratoire « Essayez » ------------------------------------ */

  DEMOS["laboratoire"] = function (node, data) {
    const P = data.params;
    const S0 = P.S0, K = P.S0, r = P.r, T = 1;

    const SCENARIOS = [
      { id: "calme", label: "Marche calme", detail: "σ = 12,84 %", sigma: P.sigma_1y, shock: 1, mu: r,
        see: "À 10 000 tirages, l’estimation tombe déjà dans l’intervalle : le bon prix, et sa marge. Essayez 1 000." },
      { id: "nerveux", label: "Marche nerveux", detail: "σ = 25 %", sigma: 0.25, shock: 1, mu: r,
        see: "Plus de volatilité, plus de chemins loin de K : le call vaut plus cher, et l’intervalle s’élargit." },
      { id: "krach", label: "Krach", detail: "−30 % puis σ = 40 %", sigma: 0.40, shock: 0.7, mu: r,
        see: "Le sous-jacent part de 30 % plus bas : l’option est loin de la monnaie, et la plupart des chemins ne paient rien." },
      { id: "sousP", label: "Simuler sous ℙ", detail: "μ = 12,2 %", sigma: P.sigma_1y, shock: 1, mu: P.mu_sp500, trap: true,
        see: "Le prix monte de plus de 90 % et rien ne l’a signalé : c’est le piège de la séance 2." }
    ];

    let current = 0;
    let seed = 20260904;

    /* ---------- colonne gauche ---------- */
    const side = html("div", "lp-lab-side");

    const figures = html("div", "lp-figures");

    function figureBox(label, tag) {
      const box = html("div", "lp-figure");
      box.appendChild(html("span", null, label));
      const value = document.createElement(tag);
      box.appendChild(value);
      const sub = html("small", null, "");
      box.appendChild(sub);
      figures.appendChild(box);
      return { box, value, sub };
    }

    const fPrice = figureBox("Prix estimé", "output");
    const fRef = figureBox("Référence Black-Scholes", "strong");
    const fGap = figureBox("Écart à la référence", "output");
    side.appendChild(figures);

    const seg = html("div", "lp-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Scénario de marché");
    const segButtons = SCENARIOS.map((s, i) => {
      const b = html("button", s.trap ? "trap" : null);
      b.type = "button";
      b.innerHTML = "";
      b.appendChild(document.createTextNode(s.label));
      b.appendChild(document.createElement("br"));
      const d = html("small", null, s.detail);
      d.style.opacity = "0.8";
      b.appendChild(d);
      b.setAttribute("aria-pressed", String(i === 0));
      b.addEventListener("click", () => {
        current = i;
        segButtons.forEach((x, j) => x.setAttribute("aria-pressed", String(i === j)));
        refresh(true);
      });
      seg.appendChild(b);
      return b;
    });
    side.appendChild(seg);

    const controls = html("div", "lp-lab-controls");
    const sl = html("div", "lp-slider");
    const row = html("div", "row");
    row.appendChild(html("span", null, "Nombre de tirages N"));
    const nOut = document.createElement("output");
    row.appendChild(nOut);
    sl.appendChild(row);
    const range = document.createElement("input");
    range.type = "range";
    /* N = 10 000 par defaut : a ce nombre de tirages, le premier chiffre affiche
       tombe deja dans l'intervalle, donc juste. Les jalons gardent 1 000 a un
       clic, pour montrer l'effet de N sans manipuler le curseur. */
    range.min = "2"; range.max = "5"; range.step = "0.05"; range.value = "4";
    range.setAttribute("aria-label", "Nombre de tirages, échelle logarithmique de 100 à 100 000");
    sl.appendChild(range);
    const marks = html("div", "lp-marks");
    marks.setAttribute("role", "group");
    marks.setAttribute("aria-label", "Nombre de tirages, valeurs repères");
    [["1 000", "3"], ["10 000", "4"], ["100 000", "5"]].forEach(([label, value]) => {
      const b = html("button", null, label);
      b.type = "button";
      b.dataset.value = value;
      b.addEventListener("click", () => { range.value = value; refresh(false); });
      marks.appendChild(b);
    });
    sl.appendChild(marks);
    controls.appendChild(sl);

    const seedBtn = html("button", "lp-seedbtn", "Nouvelle graine");
    seedBtn.type = "button";
    controls.appendChild(seedBtn);
    side.appendChild(controls);

    const see = html("p", "lp-lab-see", "");
    side.appendChild(see);

    /* ---------- colonne droite ---------- */
    const plotBox = html("div", "lp-lab-plot");
    const plotHost = html("div", null);
    plotBox.appendChild(plotHost);
    plotBox.appendChild(html("p", "lp-lab-note",
      "Mouvement brownien géométrique, 64 pas, S₀ = " + num(S0, 2) + ", r = " + pct(r, 2)
      + ", T = 1 an. Le prix est la moyenne actualisée des gains max(S_T − K, 0) ; la référence "
      + "est calculée par la formule de Black-Scholes, ici même."));

    node.appendChild(side);
    node.appendChild(plotBox);

    /* ---------- calcul ---------- */

    function estimate(sc, N) {
      const spot = S0 * sc.shock;
      const gauss = normals(mulberry32(seed));
      const drift = (sc.mu - (sc.sigma * sc.sigma) / 2) * T;
      const vol = sc.sigma * Math.sqrt(T);
      const disc = Math.exp(-r * T);
      const zLo = -2.878, zHi = 2.878;
      const qLo = Math.min(spot * Math.exp(drift + vol * zLo), K * 0.97);
      const qHi = Math.max(spot * Math.exp(drift + vol * zHi), K * 1.03);
      const BINS = 30;
      const bins = new Float64Array(BINS);
      let sum = 0, sum2 = 0;
      for (let i = 0; i < N; i++) {
        const ST = spot * Math.exp(drift + vol * gauss());
        const g = ST > K ? (ST - K) * disc : 0;
        sum += g; sum2 += g * g;
        let b = Math.floor(((ST - qLo) / (qHi - qLo)) * BINS);
        if (b < 0) b = 0;
        if (b >= BINS) b = BINS - 1;
        bins[b] += 1;
      }
      const m = sum / N;
      const v = Math.max((sum2 - N * m * m) / Math.max(N - 1, 1), 0);
      const se = Math.sqrt(v / N);
      /* Une seule regle sur la page : l'intervalle affiche est estimation ± 2 SE,
         et c'est lui qui decide de la couleur de l'ecart. */
      return { mean: m, se: se, half: 2 * se, bins, qLo, qHi, spot, N };
    }

    let paths = [];

    function buildPaths(sc) {
      paths = gbmPaths(S0 * sc.shock, sc.mu, sc.sigma, T, 64, 30, seed ^ 0x9e3779b9);
    }

    function draw(sc, est) {
      const W = 620, H = 400;
      const padL = 52, padT = 44, padB = 38;
      const histW = 132, gap = 14, padR = 10;
      const plotRight = W - padR - histW - gap;
      const lo = est.qLo, hi = est.qHi;
      const xs = scale(0, 64, padL, plotRight);
      const ys = scale(lo, hi, H - padB, padT);
      const f = frame(W, H, { l: padL, r: padR, t: padT, b: padB });

      /* grille et graduations : quatre en y, quatre en x */
      const yTicks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);
      yTicks.forEach((t) => {
        f.add(el("line", { class: "grid", x1: padL, x2: plotRight, y1: ys(t), y2: ys(t) }));
        f.add(el("text", { x: padL - 9, y: ys(t) + 4, "text-anchor": "end" }, num(t, 0)));
      });
      [[0, "0"], [16, "3 mois"], [32, "6 mois"], [48, "9 mois"], [64, "1 an"]].forEach(([t, lbl]) => {
        f.add(el("text", { x: xs(t), y: H - padB + 19, "text-anchor": t === 0 ? "start" : (t === 64 ? "end" : "middle") }, lbl));
      });
      f.add(el("line", { class: "axis", x1: padL, x2: plotRight, y1: H - padB, y2: H - padB }));

      /* trajectoires */
      paths.forEach((rowp) => {
        const pts = [];
        for (let t = 0; t <= 64; t++) pts.push([xs(t), ys(Math.max(lo, Math.min(hi, rowp[t])))]);
        f.path(pts, "traj");
      });

      /* prix d'exercice */
      f.add(el("line", { class: "kline", x1: padL, x2: W - padR, y1: ys(K), y2: ys(K) }));
      f.add(el("text", { class: "annot", x: padL + 6, y: ys(K) - 8 }, "K = " + num(K, 2)));

      /* histogramme vertical des prix finaux */
      const BINS = est.bins.length;
      let maxCount = 0;
      for (let i = 0; i < BINS; i++) if (est.bins[i] > maxCount) maxCount = est.bins[i];
      const hx = plotRight + gap;
      const binH = (ys(lo) - ys(hi)) / BINS;
      for (let i = 0; i < BINS; i++) {
        const v0 = lo + ((hi - lo) * i) / BINS;
        const v1 = lo + ((hi - lo) * (i + 1)) / BINS;
        const len = maxCount ? (est.bins[i] / maxCount) * histW : 0;
        if (len < 0.4) continue;
        f.add(el("rect", {
          class: v0 >= K ? "hbar pay" : "hbar",
          x: hx, y: ys(v1), width: Math.max(0.8, len), height: Math.max(1, binH - 1.6)
        }));
      }
      f.add(el("text", { class: "annot", x: hx, y: padT - 26 }, "prix finaux, N = " + num(est.N, 0)));
      f.add(el("text", { class: "annot-accent", x: hx, y: padT - 10 }, "en ocre : l’option paie"));
      f.add(el("line", { class: "axis", x1: hx, x2: hx, y1: padT, y2: H - padB }));

      f.svg.style.maxHeight = "none";
      f.svg.setAttribute("aria-label",
        "Trente trajectoires simulées sur un an, scénario " + sc.label + ", et l’histogramme des prix finaux ; "
        + "prix estime " + num(est.mean, 2) + " plus ou moins " + num(est.half, 2) + ".");
      plotHost.textContent = "";
      plotHost.appendChild(f.svg);
    }

    function refresh(newPaths) {
      const sc = SCENARIOS[current];
      const N = Math.round(Math.pow(10, parseFloat(range.value)));
      nOut.value = num(N, 0);
      Array.prototype.forEach.call(marks.children, (b) => {
        b.setAttribute("aria-pressed",
          String(Math.abs(parseFloat(range.value) - parseFloat(b.dataset.value)) < 0.001));
      });
      const est = estimate(sc, N);
      const ref = blackScholesCall(sc.shock * S0, K, sc.sigma, r, T);

      fPrice.value.textContent = num(est.mean, 2);
      fPrice.sub.textContent = "± " + num(est.half, 2) + " (2 erreurs-types) · graine " + seed;
      fRef.value.textContent = num(ref, 2);
      fRef.sub.textContent = sc.trap
        ? "formule fermée sous ℚ : c’est elle qui a raison"
        : "formule fermée, même σ, même r, même K";

      const gap = ref > 0 ? (est.mean - ref) / ref : 0;
      const inside = Math.abs(est.mean - ref) <= est.half;
      fGap.value.textContent = (gap >= 0 ? "+" : "−") + num(Math.abs(gap) * 100, 1) + " %";
      fGap.box.classList.toggle("is-ok", inside);
      fGap.box.classList.toggle("is-off", !inside);
      fGap.sub.textContent = inside
        ? "la référence est dans l’intervalle"
        : "la référence est hors de l’intervalle";

      see.textContent = sc.see;

      if (newPaths) buildPaths(sc);
      draw(sc, est);
    }

    range.addEventListener("input", () => refresh(false));
    seedBtn.addEventListener("click", () => {
      seed = (seed * 1103515245 + 12345) % 2147483647;
      refresh(true);
    });

    refresh(true);
  };
})();
