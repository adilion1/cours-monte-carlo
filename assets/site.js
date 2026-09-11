(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const euro = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const svgNS = "http://www.w3.org/2000/svg";

  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function setTheme(theme, persist = true) {
    root.dataset.theme = theme;
    const dark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Activer le thème clair" : "Activer le thème sombre");
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0F1524" : "#FBFAF7");
    if (persist) {
      try { localStorage.setItem("adil-site-theme", theme); } catch (_) { /* file previews may deny storage */ }
    }
    window.dispatchEvent(new CustomEvent("site-theme-change"));
  }

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));
  });
  setTheme(root.dataset.theme === "dark" ? "dark" : "light", false);

  const menuButton = document.querySelector("[data-menu-toggle]");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuButton && mobileMenu) {
    const closeMenu = () => {
      mobileMenu.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
    };
    menuButton.addEventListener("click", () => {
      const opening = mobileMenu.hidden;
      mobileMenu.hidden = !opening;
      menuButton.setAttribute("aria-expanded", String(opening));
    });
    mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        menuButton.focus();
      }
    });
  }

  if (!reduceMotion && "IntersectionObserver" in window) {
    document.body.classList.add("motion-ready");
    const revealObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cumulativeMeans(seed, length) {
    const random = mulberry32(seed);
    const means = [];
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += random() < 0.2 ? 1000 : 0;
      means.push(sum / (i + 1));
    }
    return means;
  }

  function initTrajectoryFigure() {
    const canvas = document.querySelector("[data-trajectory-canvas]");
    if (!canvas) return;
    const frame = canvas.parentElement;
    const button = document.querySelector("[data-redraw-trajectories]");
    let seed = 5403;
    let animationFrame = 0;

    function paint(progress = 1) {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const left = 20;
      const right = width - 8;
      const top = 15;
      const bottom = height - 20;
      const yMax = 650;
      const x = (index, count) => left + (right - left) * index / (count - 1);
      const y = (value) => bottom - (bottom - top) * Math.min(yMax, Math.max(0, value)) / yMax;

      context.strokeStyle = css("--line");
      context.lineWidth = 1;
      context.globalAlpha = 0.75;
      for (let i = 0; i <= 4; i += 1) {
        const py = top + (bottom - top) * i / 4;
        context.beginPath();
        context.moveTo(left, py);
        context.lineTo(right, py);
        context.stroke();
      }
      context.globalAlpha = 1;

      const length = 120;
      const visible = Math.max(4, Math.round(length * progress));
      for (let pathIndex = 0; pathIndex < 10; pathIndex += 1) {
        const values = cumulativeMeans(seed + pathIndex * 97, length);
        context.beginPath();
        for (let i = 3; i < visible; i += 1) {
          const px = x(i, length);
          const py = y(values[i]);
          if (i === 3) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.strokeStyle = css("--blue");
        context.globalAlpha = pathIndex === 0 ? 0.95 : 0.17;
        context.lineWidth = pathIndex === 0 ? 2.2 : 1;
        context.stroke();
      }

      const referenceY = y(200);
      context.globalAlpha = 1;
      context.strokeStyle = css("--orange");
      context.lineWidth = 1.7;
      context.setLineDash([6, 6]);
      context.beginPath();
      context.moveTo(left, referenceY);
      context.lineTo(right, referenceY);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = css("--orange-text") || css("--orange");
      context.font = `11px ${css("--mono")}`;
      context.fillText("E[G] = 200 €", left + 7, referenceY - 8);
      context.globalAlpha = 1;
    }

    function animate() {
      cancelAnimationFrame(animationFrame);
      if (reduceMotion) {
        paint(1);
        return;
      }
      const start = performance.now();
      const duration = 1050;
      function step(now) {
        const raw = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - raw, 3);
        paint(eased);
        if (raw < 1) animationFrame = requestAnimationFrame(step);
      }
      animationFrame = requestAnimationFrame(step);
    }

    button?.addEventListener("click", () => {
      seed = (seed + 137) >>> 0;
      animate();
    });
    window.addEventListener("site-theme-change", () => paint(1));
    if ("ResizeObserver" in window) new ResizeObserver(() => paint(1)).observe(frame);
    else window.addEventListener("resize", () => paint(1));
    animate();
  }

  function initReadingProgress() {
    const bar = document.querySelector("[data-reading-progress]");
    if (!bar) return;
    function update() {
      const range = document.documentElement.scrollHeight - window.innerHeight;
      const progress = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
      bar.style.width = `${progress * 100}%`;
    }
    document.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();

    const sections = [...document.querySelectorAll("[data-section]")];
    const links = [...document.querySelectorAll(".lesson-outline a")];
    if (!sections.length || !("IntersectionObserver" in window)) return;
    const activeObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => {
        if (link.hash === `#${visible.target.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.1, 0.35] });
    sections.forEach((section) => activeObserver.observe(section));
  }

  function initPrediction() {
    const prediction = document.querySelector("[data-prediction]");
    if (!prediction) return;
    const buttons = [...prediction.querySelectorAll("[data-prediction-value]")];
    const feedback = prediction.querySelector("[data-prediction-feedback]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        buttons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
        const value = Number(button.dataset.predictionValue);
        prediction.dataset.choice = String(value);
        feedback.textContent = `Prédiction enregistrée : plus proche de ${integer.format(value)} €. Gardez-la en tête avant de comparer avec l’expérience.`;
      });
    });
  }

  function svgElement(name, attributes = {}, text = "") {
    const element = document.createElementNS(svgNS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    return element;
  }

  function sampleStats(payments) {
    const n = payments.length;
    const mean = payments.reduce((sum, value) => sum + value, 0) / n;
    if (n < 2) return { n, mean, sd: NaN, se: NaN, low: NaN, high: NaN };
    const variance = payments.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
    const sd = Math.sqrt(Math.max(0, variance));
    const se = sd / Math.sqrt(n);
    return { n, mean, sd, se, low: mean - 1.96 * se, high: mean + 1.96 * se };
  }

  function cumulativeStats(payments) {
    let sum = 0;
    let sumSquares = 0;
    return payments.map((value, index) => {
      const n = index + 1;
      sum += value;
      sumSquares += value * value;
      const mean = sum / n;
      const variance = n > 1 ? Math.max(0, (sumSquares - sum * sum / n) / (n - 1)) : NaN;
      const se = n > 1 ? Math.sqrt(variance / n) : NaN;
      return {
        n,
        mean,
        low: Number.isFinite(se) ? mean - 1.96 * se : NaN,
        high: Number.isFinite(se) ? mean + 1.96 * se : NaN
      };
    });
  }

  function drawMonteCarloChart(chart, points) {
    const title = chart.querySelector("title")?.cloneNode(true);
    const description = chart.querySelector("desc")?.cloneNode(true);
    chart.replaceChildren();
    if (title) chart.append(title);
    if (description) chart.append(description);

    const width = 820;
    const height = 310;
    const margin = { top: 24, right: 40, bottom: 38, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const n = points.length;
    const finiteLows = points.map((point) => point.low).filter(Number.isFinite);
    const finiteHighs = points.map((point) => point.high).filter(Number.isFinite);
    let yMin = Math.min(0, ...finiteLows, 200);
    let yMax = Math.max(300, ...finiteHighs, 200);
    yMin = Math.floor(yMin / 100) * 100;
    yMax = Math.ceil(yMax / 100) * 100;
    if (yMax - yMin < 400) yMax = yMin + 400;

    const x = (index) => margin.left + (n === 1 ? plotWidth / 2 : plotWidth * index / (n - 1));
    const y = (value) => margin.top + plotHeight * (yMax - value) / (yMax - yMin);

    const grid = svgElement("g", { "aria-hidden": "true" });
    for (let i = 0; i <= 4; i += 1) {
      const value = yMax - (yMax - yMin) * i / 4;
      const py = y(value);
      grid.append(svgElement("line", { class: "grid", x1: margin.left, x2: width - margin.right, y1: py, y2: py }));
      grid.append(svgElement("text", { x: margin.left - 10, y: py + 4, "text-anchor": "end" }, `${integer.format(value)} €`));
    }
    chart.append(grid);

    const referenceY = y(200);
    chart.append(svgElement("line", { class: "reference", x1: margin.left, x2: width - margin.right, y1: referenceY, y2: referenceY }));
    chart.append(svgElement("text", { x: width - margin.right, y: referenceY - 8, "text-anchor": "end" }, "référence 200 €"));

    const maxPoints = 280;
    const step = Math.max(1, Math.ceil(n / maxPoints));
    const selected = points.filter((_, index) => index % step === 0 || index === n - 1);
    const selectedIndices = selected.map((point) => point.n - 1);
    const bandPoints = selected.filter((point) => Number.isFinite(point.low) && Number.isFinite(point.high));
    if (bandPoints.length > 1) {
      const upper = bandPoints.map((point, index) => `${index ? "L" : "M"}${x(point.n - 1).toFixed(2)},${y(point.high).toFixed(2)}`).join(" ");
      const lower = bandPoints.slice().reverse().map((point) => {
        return `L${x(point.n - 1).toFixed(2)},${y(point.low).toFixed(2)}`;
      }).join(" ");
      chart.append(svgElement("path", { class: "band", d: `${upper} ${lower} Z`, "aria-hidden": "true" }));
    }

    const path = selected.map((point, index) => `${index ? "L" : "M"}${x(selectedIndices[index]).toFixed(2)},${y(point.mean).toFixed(2)}`).join(" ");
    chart.append(svgElement("path", { class: "estimate", d: path, "aria-hidden": "true" }));
    const last = points[n - 1];
    chart.append(svgElement("circle", { class: "endpoint", cx: x(n - 1), cy: y(last.mean), r: 5, "aria-hidden": "true" }));

    chart.append(svgElement("text", { x: margin.left, y: height - 10, "text-anchor": "start" }, "1"));
    chart.append(svgElement("text", { x: width - margin.right, y: height - 10, "text-anchor": "end" }, integer.format(n)));
    chart.append(svgElement("text", { x: width / 2, y: height - 10, "text-anchor": "middle" }, "nombre de tirages"));
  }

  function initMonteCarloLab() {
    const lab = document.querySelector("[data-monte-carlo-lab]");
    if (!lab) return;
    const sizeButtons = [...lab.querySelectorAll("[data-sample-size]")];
    const rerun = lab.querySelector("[data-rerun]");
    const chart = lab.querySelector("[data-mc-chart]");
    const outputN = lab.querySelector("[data-metric-n]");
    const outputMean = lab.querySelector("[data-metric-mean]");
    const outputSE = lab.querySelector("[data-metric-se]");
    const outputCI = lab.querySelector("[data-metric-ci]");
    const observation = lab.querySelector("[data-lab-observation]");
    let sampleSize = 5;
    let experimentIndex = 0;
    let seed = 2026;
    let lastPoints = [];

    function run() {
      const random = mulberry32(seed);
      const payments = Array.from({ length: sampleSize }, () => random() < 0.2 ? 1000 : 0);
      const stats = sampleStats(payments);
      const positives = payments.filter((value) => value > 0).length;
      lastPoints = cumulativeStats(payments);

      outputN.textContent = integer.format(stats.n);
      outputMean.textContent = `${euro.format(stats.mean)} €`;
      outputSE.textContent = Number.isFinite(stats.se) ? `${euro.format(stats.se)} €` : "non définie";
      outputCI.textContent = Number.isFinite(stats.se) ? `[${euro.format(stats.low)} ; ${euro.format(stats.high)}]\u202f€` : "N ≥ 2 requis";
      drawMonteCarloChart(chart, lastPoints);

      const difference = stats.mean - 200;
      if (stats.n === 1) {
        observation.textContent = `Une seule réalisation donne ${integer.format(payments[0])} €. Elle montre un résultat possible, pas le versement moyen du modèle.`;
      } else if (positives === 0) {
        observation.textContent = `Aucune baisse dans ces ${integer.format(stats.n)} tirages : la moyenne observée vaut 0 € et l’intervalle dégénère en [0 ; 0]. Ce petit échantillon n’a pourtant pas supprimé le risque du modèle.`;
      } else {
        const direction = Math.abs(difference) < 0.05 ? "sur la référence" : difference > 0 ? "au-dessus de la référence" : "sous la référence";
        observation.textContent = `${integer.format(positives)} baisse${positives > 1 ? "s" : ""} observée${positives > 1 ? "s" : ""} sur ${integer.format(stats.n)} tirages. La moyenne finit ${direction}. Une autre graine produira un autre écart.`;
      }
      chart.setAttribute("aria-label", `Expérience de ${integer.format(stats.n)} tirages. Moyenne estimée ${euro.format(stats.mean)} euros, référence exacte 200 euros. La zone représente des intervalles normaux ponctuels approximatifs, pas une bande simultanée.`);

      const prediction = document.querySelector("[data-prediction]");
      const feedback = prediction?.querySelector("[data-prediction-feedback]");
      if (prediction?.dataset.choice && feedback) {
        feedback.textContent = `Votre prédiction : plus proche de ${integer.format(Number(prediction.dataset.choice))} €. Référence exacte du modèle : 200 €.`;
      }
    }

    sizeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sampleSize = Number(button.dataset.sampleSize);
        sizeButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
        run();
      });
    });
    rerun.addEventListener("click", () => {
      experimentIndex += 1;
      seed = (2026 + Math.imul(experimentIndex, 0x85EBCA6B)) >>> 0;
      run();
    });
    window.addEventListener("site-theme-change", () => {
      if (lastPoints.length) drawMonteCarloChart(chart, lastPoints);
    });
    run();
  }

  function renderMath() {
    if (typeof window.renderMathInElement !== "function") return;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false
    });
  }

  initTrajectoryFigure();
  initReadingProgress();
  initPrediction();
  initMonteCarloLab();
  renderMath();
})();

/* ------------------------------------------------------------------ *
 * Reperage « ou suis-je ? » — ajoute a site.js par outils/build_site.py.
 *
 * Trois cles de localStorage, toutes prefixees mcdp. :
 *   mcdp.lastUnit           JSON {ch, unit, title, chTitle, url}
 *   mcdp.read.<chXX>.<uYY>  "1" quand l'unite est lue
 *   mcdp.pred.<chXX>.<uYY>  JSON {text, date} : la prediction ecrite avant
 *                           d'essayer, rappelee dans « Verifiez-vous »
 *
 * Aucun reseau, aucun cookie : tout est local au navigateur, et chaque
 * acces est protege (une fenetre privee ou un file:// verrouille peut
 * refuser localStorage sans que la page cesse de fonctionner).
 * ------------------------------------------------------------------ */

(() => {
  "use strict";

  const KEY_LAST = "mcdp.lastUnit";
  const KEY_READ = "mcdp.read.";
  const KEY_PRED = "mcdp.pred.";

  function getItem(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function setItem(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function readKey(ch, unit) { return KEY_READ + ch + "." + unit; }

  function isRead(ch, unit) { return getItem(readKey(ch, unit)) === "1"; }

  function markRead(ch, unit) { setItem(readKey(ch, unit), "1"); }

  function lastUnit() {
    const raw = getItem(KEY_LAST);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value.url === "string" && value.url) return value;
    } catch (_) { /* valeur illisible : on l'ignore */ }
    return null;
  }

  const body = document.body;
  const root = body.dataset.root || "";
  const here = {
    ch: body.dataset.ch || "",
    unit: body.dataset.unit || "",
    title: body.dataset.unitTitle || "",
    chTitle: body.dataset.chTitle || "",
    url: body.dataset.unitUrl || ""
  };

  /* --- 1. memoriser la derniere unite visitee --------------------- */

  if (here.ch && here.unit && here.url) {
    setItem(KEY_LAST, JSON.stringify(here));
  }

  /* --- 2. bouton « Reprendre » ------------------------------------ */

  const resume = lastUnit();
  document.querySelectorAll("[data-resume]").forEach((node) => {
    if (!resume) { node.hidden = true; return; }
    node.hidden = false;
    node.href = root + resume.url;
    const label = node.querySelector("[data-resume-label]");
    if (label) {
      label.textContent = "ch. " + String(resume.ch || "").replace("ch", "") + " · unité " + resume.unit.replace("u", "");
    }
    node.title = "Reprendre : " + (resume.title || resume.url);
  });

  /* --- 3. etats « lue » deja enregistres -------------------------- */

  function paintReadStates() {
    document.querySelectorAll("[data-read-key]").forEach((node) => {
      const parts = String(node.dataset.readKey).split(".");
      if (parts.length !== 2) return;
      node.classList.toggle("is-read", isRead(parts[0], parts[1]));
    });
    paintProgress();
    paintGlobal();
  }

  function countRead(pairs) {
    let n = 0;
    pairs.forEach((p) => { if (isRead(p[0], p[1])) n += 1; });
    return n;
  }

  function paintProgress() {
    document.querySelectorAll("[data-progress-ch]").forEach((node) => {
      const ch = node.dataset.progressCh;
      const units = String(node.dataset.progressUnits || "").split(",").filter(Boolean);
      if (!ch || !units.length) return;
      const done = countRead(units.map((u) => [ch, u]));
      const bar = node.querySelector("[data-progress-bar]");
      if (bar) bar.style.width = Math.round((done / units.length) * 100) + "%";
      const text = node.querySelector("[data-progress-text]");
      if (text) text.textContent = done + "/" + units.length + " lues";
      node.setAttribute("aria-valuenow", String(done));
    });
  }

  function paintGlobal() {
    document.querySelectorAll("[data-global-units]").forEach((node) => {
      const keys = String(node.dataset.globalUnits || "").split(",").filter(Boolean);
      if (!keys.length) return;
      const done = countRead(keys.map((k) => k.split(".")));
      const out = node.querySelector("[data-global-count]");
      if (out) out.textContent = String(done);
      const total = node.querySelector("[data-global-total]");
      if (total) total.textContent = String(keys.length);
    });
  }

  paintReadStates();

  /* --- 4. marquer l'unite courante comme lue ---------------------- */

  const buttons = Array.prototype.slice.call(document.querySelectorAll("[data-mark-read]"));

  function refreshButtons() {
    if (!here.ch || !here.unit) return;
    const done = isRead(here.ch, here.unit);
    buttons.forEach((btn) => {
      btn.classList.toggle("is-read", done);
      const label = btn.querySelector("[data-mark-label]");
      if (label) label.textContent = done ? "Unité lue" : String(btn.dataset.markRead || "Marquer comme lue");
      btn.setAttribute("aria-pressed", String(done));
    });
  }

  if (here.ch && here.unit) {
    refreshButtons();
    buttons.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const next = btn.dataset.markNext || "";
        if (!isRead(here.ch, here.unit)) markRead(here.ch, here.unit);
        refreshButtons();
        paintReadStates();
        if (next) {
          event.preventDefault();
          window.location.href = next;
        }
      });
    });

    /* Fin de l'unite atteinte : on marque sans rien demander. */
    const sentinel = document.querySelector("[data-unit-end]");
    if (sentinel && "IntersectionObserver" in window) {
      const watcher = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          markRead(here.ch, here.unit);
          refreshButtons();
          paintReadStates();
          watcher.disconnect();
        }
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.25 });
      watcher.observe(sentinel);
    }
  }

  /* --- 5. page de chapitre : « Commencer » ou « Reprendre a l'unite X » --- */

  document.querySelectorAll("[data-chapter-start]").forEach((node) => {
    const ch = node.dataset.ch;
    const units = String(node.dataset.units || "").split(",").filter(Boolean);
    if (!ch || !units.length) return;
    const first = units.find((u) => !isRead(ch, u));
    const label = node.querySelector("[data-chapter-start-label]");
    if (!first) {
      node.href = units[0] + ".html";
      if (label) label.textContent = "Relire l’unité " + units[0].replace("u", "");
      return;
    }
    node.href = first + ".html";
    if (label) {
      label.textContent = first === units[0]
        ? "Commencer l’unité " + first.replace("u", "")
        : "Reprendre à l’unité " + first.replace("u", "");
    }
  });

  /* --- 5 bis. champ de prediction --------------------------------- *
   * Le cours tient sur « predire, simuler, confronter ». La carte posee a la
   * fin de « La question » recueille la prediction ; celle posee en tete de
   * « Verifiez-vous » la rappelle. Rien ne sort du navigateur : ni reseau, ni
   * cookie, seulement mcdp.pred.<chXX>.<uYY>. Les deux cartes sont ecrites
   * `hidden` par le generateur et ne s'affichent qu'ici : sans JavaScript,
   * la page se lit exactement comme avant. */

  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
                "août", "septembre", "octobre", "novembre", "décembre"];

  function predKey(key) { return KEY_PRED + key; }

  function readPred(key) {
    const raw = getItem(predKey(key));
    if (!raw) return null;
    let value = null;
    try { value = JSON.parse(raw); } catch (_) { value = null; }
    if (value && typeof value === "object" && typeof value.text === "string") {
      return value.text.trim() ? { text: value.text.trim(), date: value.date || "" } : null;
    }
    /* Valeur deposee a la main (texte nu) : on l'accepte telle quelle. */
    return raw.trim() ? { text: raw.trim(), date: "" } : null;
  }

  function frenchDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return "";
    const jour = d.getDate();
    return (jour === 1 ? "1er" : String(jour)) + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  function paintRecall() {
    document.querySelectorAll("[data-pred-recall]").forEach((node) => {
      const key = node.dataset.predRecall;
      if (!key) return;
      const value = readPred(key);
      const quote = node.querySelector("[data-pred-quote]");
      const empty = node.querySelector("[data-pred-empty]");
      const shown = node.querySelector("[data-pred-text]");
      if (value && shown) shown.textContent = value.text;
      if (quote) quote.hidden = !value;
      if (empty) empty.hidden = !!value;
      node.hidden = false;
    });
  }

  document.querySelectorAll("[data-pred]").forEach((card) => {
    const key = card.dataset.pred;
    const form = card.querySelector("[data-pred-form]");
    const input = card.querySelector("[data-pred-input]");
    const save = card.querySelector("[data-pred-save]");
    const noted = card.querySelector("[data-pred-noted]");
    const when = card.querySelector("[data-pred-when]");
    const shown = card.querySelector("[data-pred-text]");
    const modify = card.querySelector("[data-pred-modify]");
    if (!key || !form || !input || !save || !noted) return;

    function paint(editing) {
      const value = readPred(key);
      const done = !!value && !editing;
      if (value) {
        if (shown) shown.textContent = value.text;
        if (when) when.textContent = "Noté le " + frenchDate(value.date);
        if (input !== document.activeElement) input.value = value.text;
      }
      form.hidden = done;
      noted.hidden = !done;
      card.classList.toggle("is-noted", done);
    }

    card.hidden = false;
    paint(false);

    save.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      setItem(predKey(key), JSON.stringify({ text: text, date: new Date().toISOString() }));
      paint(false);
      paintRecall();
    });

    if (modify) {
      modify.addEventListener("click", () => { paint(true); input.focus(); });
    }
  });

  paintRecall();

  /* --- 6. page d'accueil : barre collante et section active -------- */

  const topbar = document.querySelector(".lp-topbar");
  if (topbar && "IntersectionObserver" in window) {
    /* (a) le filet et l'ombre n'apparaissent qu'une fois la page defilee :
       une sentinelle de 1 px posee avant la barre suffit, sans ecouter le scroll. */
    const sentinel = document.querySelector("[data-topbar-sentinel]");
    if (sentinel) {
      new IntersectionObserver((entries) => {
        topbar.classList.toggle("is-stuck", !entries[0].isIntersecting);
      }, { threshold: 0 }).observe(sentinel);
    }

    /* (b) l'ancre de la section visible est soulignee. */
    const links = Array.prototype.slice.call(topbar.querySelectorAll('.lp-topnav a[href^="#"]'));
    const sections = links
      .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
      .filter(Boolean);
    if (sections.length) {
      const seen = new Map();
      const mark = () => {
        let best = null;
        sections.forEach((s) => {
          const ratio = seen.get(s) || 0;
          if (ratio > 0 && (!best || ratio >= (seen.get(best) || 0))) best = s;
        });
        links.forEach((a) => {
          const on = best && a.getAttribute("href") === "#" + best.id;
          a.classList.toggle("is-current", !!on);
          if (on) { a.setAttribute("aria-current", "true"); } else { a.removeAttribute("aria-current"); }
        });
      };
      const watcher = new IntersectionObserver((entries) => {
        entries.forEach((e) => seen.set(e.target, e.isIntersecting ? e.intersectionRatio : 0));
        mark();
      }, { rootMargin: "-76px 0px -55% 0px", threshold: [0, 0.02, 0.2, 0.5] });
      sections.forEach((s) => watcher.observe(s));
    }
  }

  /* --- 7. barre de cours : fermeture du menu deroulant ------------- */

  const menu = document.querySelector(".cb-menu");
  if (menu) {
    document.addEventListener("click", (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") menu.open = false;
    });
  }
})();
