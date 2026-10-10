(() => {
  const SAFE_TAGS = new Set(["B", "BR", "CODE", "EM", "I", "SPAN", "STRONG", "SUB", "SUP"]);
  const SAFE_CLASSES = new Set(["eq", "note-formula", "note-definition", "note-topic"]);

  function formatted(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value ?? "");
    const clean = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      if (!SAFE_TAGS.has(node.tagName)) {
        const fragment = document.createDocumentFragment();
        if (!["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG"].includes(node.tagName)) {
          [...node.childNodes].forEach((child) => fragment.append(clean(child)));
        }
        return fragment;
      }
      const el = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === "SPAN") {
        const classes = [...node.classList].filter((name) => SAFE_CLASSES.has(name));
        if (classes.length) el.className = classes.join(" ");
      }
      [...node.childNodes].forEach((child) => el.append(clean(child)));
      return el;
    };
    const fragment = document.createDocumentFragment();
    [...template.content.childNodes].forEach((child) => fragment.append(clean(child)));
    return fragment;
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(value ?? "");
    return element;
  }

  function richElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.append(formatted(value));
    return element;
  }

  function lineList(lines, ordered = false) {
    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "section-lesson-list";
    lines.forEach((line) => list.append(richElement("li", "", line)));
    return list;
  }

  function blockElement(block) {
    switch (block.type) {
      case "paragraph":
        return richElement("p", "section-lesson-paragraph", block.text);
      case "bullets":
        return lineList(block.items);
      case "numbered":
        return lineList(block.items, true);
      case "definition": {
        const card = document.createElement("dl");
        card.className = "section-lesson-definition";
        card.append(richElement("dt", "", block.term), richElement("dd", "", block.text));
        return card;
      }
      case "rule": {
        const card = document.createElement("article");
        card.className = "section-lesson-callout rule";
        card.append(textElement("h3", "", block.title), lineList(block.lines));
        return card;
      }
      case "tip":
      case "flag": {
        const card = document.createElement("aside");
        card.className = "section-lesson-callout " + block.type;
        card.setAttribute("role", block.type === "flag" ? "note" : "complementary");
        card.append(textElement("h3", "", block.type === "flag" ? "Check with your teacher" : "Exam tip"), lineList(block.lines));
        return card;
      }
      case "table": {
        const wrap = document.createElement("div");
        wrap.className = "section-lesson-table-wrap";
        const table = document.createElement("table");
        table.className = "section-lesson-table";
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");
        block.columns.forEach((column) => headerRow.append(richElement("th", "", column)));
        head.append(headerRow);
        const body = document.createElement("tbody");
        block.rows.forEach((row) => {
          const tr = document.createElement("tr");
          row.forEach((cell) => tr.append(richElement("td", "", cell)));
          body.append(tr);
        });
        table.append(head, body);
        wrap.append(table);
        return wrap;
      }
      case "worked_example": {
        const card = document.createElement("article");
        card.className = "section-lesson-example";
        card.append(textElement("h3", "", block.title), lineList(block.lines, true));
        return card;
      }
      case "hands_on":
        return handsOnBlock(block);
      case "qa":
        return questionBlock(block);
      case "figure": {
        const figure = document.createElement("figure");
        figure.className = "section-lesson-figure";
        const img = document.createElement("img");
        img.src = "/assets/lesson-figures/" + encodeURIComponent(block.src);
        img.alt = block.alt;
        img.loading = "lazy";
        img.decoding = "async";
        figure.append(img, richElement("figcaption", "", block.caption));
        return figure;
      }
      default:
        return textElement("p", "section-lesson-callout flag", "This content block is not supported.");
    }
  }

  function handsOnBlock(block) {
    const card = document.createElement("article");
    card.className = "section-lesson-hands-on";
    const heading = document.createElement("div");
    heading.className = "section-lesson-block-heading";
    heading.append(textElement("h3", "", block.title));
    if (block.exam_likelihood === "very_likely") heading.append(textElement("span", "pill section-lesson-likelihood", "Very likely question"));
    card.append(heading, richElement("p", "section-lesson-task", block.task));

    const solution = document.createElement("section");
    solution.className = "section-lesson-solution";
    solution.setAttribute("aria-label", "Solution");
    solution.append(textElement("h4", "", "Solution"));

    const steps = document.createElement("ol");
    steps.className = "section-lesson-steps";
    const stepButton = textElement("button", "btn ghost sm", `Reveal solution step 1 of ${block.steps.length}`);
    stepButton.type = "button";
    stepButton.setAttribute("aria-expanded", "false");
    let shown = 0;
    stepButton.addEventListener("click", () => {
      if (shown < block.steps.length) {
        steps.append(richElement("li", "", block.steps[shown]));
        shown++;
      }
      stepButton.setAttribute("aria-expanded", String(shown > 0));
      if (shown < block.steps.length) stepButton.textContent = `Reveal solution step ${shown + 1} of ${block.steps.length}`;
      else stepButton.remove();
      if (shown === block.steps.length) answerButton.hidden = false;
    });
    solution.append(steps, stepButton);

    const answer = document.createElement("div");
    answer.className = "section-lesson-final-answer";
    answer.hidden = true;
    answer.append(textElement("h5", "", "Final answer"), richElement("div", "section-lesson-answer", block.answer));
    const answerButton = textElement("button", "btn primary sm", "Show final answer");
    answerButton.type = "button";
    answerButton.hidden = true;
    answerButton.setAttribute("aria-expanded", "false");
    answerButton.addEventListener("click", () => {
      answer.hidden = !answer.hidden;
      answerButton.textContent = answer.hidden ? "Show final answer" : "Hide final answer";
      answerButton.setAttribute("aria-expanded", String(!answer.hidden));
    });
    solution.append(answerButton, answer);
    card.append(solution);

    if (block.try_it) {
      const tryCard = document.createElement("div");
      tryCard.className = "section-lesson-try";
      tryCard.append(textElement("h4", "", "Now you try"), richElement("p", "", block.try_it.question));
      const tryAnswer = richElement("div", "section-lesson-answer", block.try_it.answer);
      tryAnswer.hidden = true;
      const tryButton = textElement("button", "btn ghost sm", "Show answer");
      tryButton.type = "button";
      tryButton.setAttribute("aria-expanded", "false");
      tryButton.addEventListener("click", () => {
        tryAnswer.hidden = !tryAnswer.hidden;
        tryButton.textContent = tryAnswer.hidden ? "Show answer" : "Hide answer";
        tryButton.setAttribute("aria-expanded", String(!tryAnswer.hidden));
      });
      tryCard.append(tryButton, tryAnswer);
      card.append(tryCard);
    }
    return card;
  }

  function questionBlock(block) {
    const card = document.createElement("article");
    card.className = "section-lesson-qa";
    card.append(richElement("h3", "", block.question));
    const answer = richElement("div", "section-lesson-answer", block.answer);
    answer.hidden = true;
    const button = textElement("button", "btn ghost sm", "Show answer");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      answer.hidden = !answer.hidden;
      button.textContent = answer.hidden ? "Show answer" : "Hide answer";
      button.setAttribute("aria-expanded", String(!answer.hidden));
    });
    card.append(button, answer);
    return card;
  }

  function render(container, lesson, options = {}) {
    container.replaceChildren();
    const doc = document.createElement("article");
    doc.className = "section-lesson-document";
    const header = document.createElement("header");
    header.className = "section-lesson-header";
    header.append(textElement("p", "eyebrow", lesson.subject === "organic" ? "Organic chemistry" : "Physical chemistry"));
    header.append(textElement("h1", "", lesson.title));
    header.append(textElement("p", "muted", "Revision resource · interactive answers · does not award XP"));
    doc.append(header);

    lesson.sections.forEach((section) => {
      const sectionNode = document.createElement("section");
      sectionNode.className = "section-lesson-section";
      sectionNode.dataset.sectionId = section.id;
      const title = section.number > 0 ? `${section.number}. ${section.title}` : section.title;
      sectionNode.append(textElement("h2", "", title));
      if (section.tags && section.tags.length) {
        const tags = textElement("p", "section-lesson-tags", section.tags.join(" · "));
        sectionNode.append(tags);
      }
      section.blocks.forEach((block) => sectionNode.append(blockElement(block)));
      doc.append(sectionNode);
    });

    const complete = textElement("button", "btn primary", options.completed ? "Completed on this device" : "Mark revision complete");
    complete.type = "button";
    complete.disabled = !!options.completed;
    complete.addEventListener("click", () => {
      if (complete.disabled) return;
      complete.disabled = true;
      complete.textContent = "Completed on this device";
      if (typeof options.onComplete === "function") options.onComplete();
    });
    const footer = document.createElement("footer");
    footer.className = "section-lesson-footer";
    footer.append(complete, textElement("p", "muted small", "Completion is saved on this device. These reference notes do not award XP."));
    doc.append(footer);
    container.append(doc);
  }

  window.WRSectionLesson = { render };
})();
