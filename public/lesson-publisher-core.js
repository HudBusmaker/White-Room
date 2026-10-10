const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
const MAX_ENTRIES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9-]+$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const validRelease = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value));

function archivePath(name) {
  if (typeof name !== "string" || !name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("The ZIP contains an invalid file path.");
  }
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new Error("The ZIP contains an unsafe file path.");
  return parts.join("/");
}

function taskError(task, label) {
  if (!isObject(task)) return `${label} must be an object.`;
  if (!["mc", "num"].includes(task.t)) return `${label} must have task type "mc" or "num".`;
  if (!Number.isFinite(task.m) || task.m < 1) return `${label} needs a positive mark value.`;
  if (!hasText(task.q)) return `${label} needs a question.`;
  if (task.t === "mc") {
    if (!Array.isArray(task.o) || task.o.length < 2 || !task.o.every(hasText)) return `${label} needs at least two answer options.`;
    if (!Number.isInteger(task.a) || task.a < 0 || task.a >= task.o.length) return `${label} has an invalid correct-answer index.`;
    if (!Array.isArray(task.why) || task.why.length !== task.o.length || !task.why.every(hasText)) return `${label} needs feedback for every option.`;
  } else {
    if (!Array.isArray(task.f) || !task.f.length || !task.f.every((field) => isObject(field)
      && hasText(field.l) && (Number.isFinite(field.v) || typeof field.v === "string"))) {
      return `${label} needs at least one answer field with a label and value.`;
    }
    if (task.fb !== undefined && !isObject(task.fb)) return `${label} feedback must be an object.`;
  }
  return "";
}

function checkBuilt(spec, label, engine, tries = 40) {
  for (let i = 0; i < tries; i++) {
    let built;
    try {
      built = engine.instantiate(spec);
    } catch (error) {
      return `${label}: ${error.message}`;
    }
    const tasks = built.tasks || [built];
    for (let ti = 0; ti < tasks.length; ti++) {
      const task = tasks[ti];
      if (task.t === "mc" && new Set(task.o.map(engine.plain)).size !== task.o.length) {
        return `${label} task ${ti + 1} can generate duplicate answer options.`;
      }
      if (task.t === "num" && (!Array.isArray(task.f) || task.f.some((field) => !Number.isFinite(field.v)))) {
        return `${label} task ${ti + 1} generates a non-finite answer.`;
      }
    }
  }
  return "";
}

function validateTask(task, label, engine, checkRandom = true) {
  const error = taskError(task, label);
  return error || (checkRandom ? checkBuilt(task, label, engine) : "");
}

function validateSectionLesson(lesson, entry, figureNames) {
  if (!["organic", "physical"].includes(lesson.subject) || !hasText(lesson.title) || lesson.version !== 1
    || lesson.status !== "COMPLETE" || !Array.isArray(lesson.sections) || !lesson.sections.length) {
    return `Lesson ${entry.file} must be a complete version 1 section document.`;
  }
  const ids = new Set(), usedFigures = new Set();
  const idError = (id, label) => {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return `${label} needs a lowercase kebab-case id.`;
    if (ids.has(id)) return `${label} repeats id "${id}".`;
    ids.add(id);
    return "";
  };
  const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
  const lines = (value) => Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
  for (let si = 0; si < lesson.sections.length; si++) {
    const section = lesson.sections[si];
    if (!isObject(section)) return `Lesson ${entry.file}, section ${si + 1} must be an object.`;
    const sidError = idError(section.id, `Lesson ${entry.file}, section ${si + 1}`);
    if (sidError) return sidError;
    if (!Number.isInteger(section.number) || section.number < 0 || !nonEmpty(section.title)
      || !lines(section.tags) || !Array.isArray(section.blocks) || !section.blocks.length) {
      return `Lesson ${entry.file}, section ${section.id} needs a number, title, tags and blocks.`;
    }
    for (let bi = 0; bi < section.blocks.length; bi++) {
      const block = section.blocks[bi], label = `Lesson ${entry.file}, ${section.id} block ${bi + 1}`;
      if (!isObject(block) || typeof block.type !== "string") return `${label} needs a type.`;
      switch (block.type) {
        case "paragraph":
          if (!nonEmpty(block.text)) return `${label} needs text.`;
          break;
        case "bullets":
        case "numbered":
          if (!lines(block.items)) return `${label} needs a non-empty items list.`;
          break;
        case "definition":
          if (!nonEmpty(block.term) || !nonEmpty(block.text)) return `${label} needs a term and text.`;
          break;
        case "rule":
          if (!nonEmpty(block.title) || !lines(block.lines)) return `${label} needs a title and lines.`;
          break;
        case "tip":
        case "flag":
          if (!lines(block.lines)) return `${label} needs non-empty lines.`;
          break;
        case "table":
          if (!lines(block.columns) || !Array.isArray(block.rows) || !block.rows.length
            || block.rows.some((row) => !Array.isArray(row) || row.length !== block.columns.length || !lines(row))) {
            return `${label} has invalid columns or rows.`;
          }
          break;
        case "worked_example": {
          const error = idError(block.id, label);
          if (error) return error;
          if (!nonEmpty(block.title) || !lines(block.lines)) return `${label} needs a title and lines.`;
          break;
        }
        case "hands_on": {
          const error = idError(block.id, label);
          if (error) return error;
          if (!nonEmpty(block.title) || !nonEmpty(block.task) || !lines(block.steps) || !nonEmpty(block.answer)
            || !["very_likely", "normal"].includes(block.exam_likelihood) || block.reveal_mode !== "step_by_step") {
            return `${label} has missing content or invalid exam/reveal metadata.`;
          }
          if (block.try_it !== undefined && (!isObject(block.try_it) || !nonEmpty(block.try_it.question) || !nonEmpty(block.try_it.answer))) {
            return `${label} has an invalid try_it question or answer.`;
          }
          break;
        }
        case "qa": {
          const error = idError(block.id, label);
          if (error) return error;
          if (!nonEmpty(block.question) || !nonEmpty(block.answer) || block.reveal_mode !== "tap_to_show") {
            return `${label} has missing content or invalid reveal metadata.`;
          }
          break;
        }
        case "figure":
          if (typeof block.src !== "string" || !/^[A-Za-z0-9._-]+\.svg$/i.test(block.src)) return `${label} has an unsafe SVG filename.`;
          if (!figureNames.has(block.src.toLowerCase())) return `${label} is missing figure ${block.src} from the ZIP.`;
          if (!nonEmpty(block.caption) || !nonEmpty(block.alt)) return `${label} needs a caption and alt text.`;
          usedFigures.add(block.src.toLowerCase());
          break;
        default:
          return `${label} uses unsupported block type "${block.type}".`;
      }
    }
  }
  return { usedFigures };
}

function validateLesson(lesson, entry, engine, figureNames) {
  if (!isObject(lesson)) return `Lesson ${entry.file} must contain a JSON object.`;
  if (Array.isArray(lesson.sections)) {
    if (entry.format !== "section-document") return `Lesson ${entry.file} must be marked section-document in index.json.`;
    return validateSectionLesson(lesson, entry, figureNames);
  }
  for (const field of ["id", "title", "level", "subject", "topic", "summary"]) {
    if (!hasText(lesson[field])) return `Lesson ${entry.file} is missing "${field}".`;
  }
  if (lesson.id !== entry.id || !ID_PATTERN.test(lesson.id)) return `Lesson ${entry.file} must have the same valid id as its manifest entry (${entry.id}).`;
  if ("question" in lesson || "blocks" in lesson) return `Lesson ${entry.file} uses an unsupported old format; use summary and notes.`;
  if (/\?\s*$/.test(lesson.summary.replace(/<[^>]+>/g, "").trim())) return `Lesson ${entry.file} summary must be a statement, not a question.`;
  if (!Array.isArray(lesson.notes) || lesson.notes.length < 1 || lesson.notes.length > 6) return `Lesson ${entry.file} needs 1 to 6 notes.`;

  for (let ni = 0; ni < lesson.notes.length; ni++) {
    const note = lesson.notes[ni], label = `${entry.file}, note ${ni + 1}`;
    if (!isObject(note) || !hasText(note.title) || !hasText(note.text)) return `${label} needs a title and text.`;
    if (!Array.isArray(note.working) || !note.working.length || !note.working.every(hasText)) return `${label} needs at least one working line.`;
    if (!Array.isArray(note.tasks) || note.tasks.length < 1 || note.tasks.length > 2) return `${label} needs 1 or 2 tasks.`;
    for (let ti = 0; ti < note.tasks.length; ti++) {
      const error = validateTask(note.tasks[ti], `${label}, task ${ti + 1}`, engine, false);
      if (error) return error;
    }
    const error = checkBuilt(note, label, engine);
    if (error) return error;
  }
  if (lesson.exercises !== undefined && !Array.isArray(lesson.exercises)) return `Exercises in ${entry.file} must be an array.`;
  for (let i = 0; i < (lesson.exercises || []).length; i++) {
    const error = validateTask(lesson.exercises[i], `${entry.file}, exercise ${i + 1}`, engine);
    if (error) return error;
  }
  return "";
}

function validateManifestEntry(entry, index) {
  const label = `Manifest lesson ${index + 1}`;
  if (!isObject(entry)) return `${label} must be an object.`;
  for (const field of ["id", "file", "title", "subject", "level"]) {
    if (!hasText(entry[field])) return `${label} is missing "${field}".`;
  }
  if (!ID_PATTERN.test(entry.id)) return `${label} id must use lowercase letters, numbers, and hyphens.`;
  if (!/^[A-Za-z0-9._-]+\.json$/i.test(entry.file) || entry.file.includes("..") || entry.file.toLowerCase() === "index.json") {
    return `${label} has an unsafe lesson filename. Use a simple .json filename.`;
  }
  if (!validRelease(entry.release)) return `${label} needs an ISO release date and time.`;
  if (entry.daily !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(entry.daily)) return `${label} daily date must use YYYY-MM-DD.`;
  return "";
}

export async function readLessonArchive(file, ZipLibrary, engine, release) {
  const fileSize = file && Number.isFinite(file.size) ? file.size : file?.byteLength;
  if (!Number.isFinite(fileSize) || fileSize > MAX_ARCHIVE_BYTES) {
    throw new Error("Choose a ZIP file no larger than 15 MB.");
  }
  const archive = await new ZipLibrary().loadAsync(file, { createFolders: false });
  const files = Object.entries(archive.files).filter(([, item]) => !item.dir);
  if (!files.length || files.length > MAX_ENTRIES) throw new Error(`The ZIP must contain between 1 and ${MAX_ENTRIES} files.`);

  const jsonFiles = new Map();
  const figureFiles = new Map();
  let totalSize = 0;
  for (const [rawName, item] of files) {
    const name = archivePath(rawName);
    if (name.split("/").includes("__MACOSX") || name.endsWith("/.DS_Store") || name === ".DS_Store") continue;
    const size = item._data && Number(item._data.uncompressedSize);
    if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) {
      throw new Error(`${name} exceeds the 2 MB per-file limit or has invalid ZIP metadata.`);
    }
    totalSize += size;
    if (totalSize > MAX_TOTAL_BYTES) throw new Error("The ZIP's expanded contents exceed the 10 MB limit.");
    const basename = name.slice(name.lastIndexOf("/") + 1);
    const key = basename.toLowerCase();
    if (name.toLowerCase().endsWith(".json")) {
      if (jsonFiles.has(key)) throw new Error(`The ZIP contains more than one file named ${basename}.`);
      jsonFiles.set(key, { name: basename, item });
    } else if (name.toLowerCase().endsWith(".svg")) {
      if (figureFiles.has(key)) throw new Error(`The ZIP contains more than one file named ${basename}.`);
      figureFiles.set(key, { name: basename, item });
    } else {
      throw new Error(`${basename} is not a supported lesson JSON or SVG figure.`);
    }
  }

  const manifests = [...jsonFiles.keys()].filter((name) => name.toLowerCase() === "index.json");
  if (manifests.length > 1) throw new Error("The ZIP may contain only one index.json manifest.");
  const parse = async (name) => {
    const archiveFile = jsonFiles.get(name.toLowerCase());
    if (!archiveFile) throw new Error(`${name} is missing from the ZIP.`);
    try { return JSON.parse(await archiveFile.item.async("string")); }
    catch (error) { throw new Error(`${archiveFile.name} is not valid JSON: ${error.message}`); }
  };
  let manifest;
  if (manifests.length) {
    manifest = await parse(manifests[0]);
  } else {
    if (!validRelease(release)) throw new Error("Choose a release date and time when uploading section documents without index.json.");
    const inferred = [];
    for (const [filename, archiveFile] of jsonFiles) {
      const doc = await parse(filename);
      if (!Array.isArray(doc?.sections)) {
        throw new Error(`${archiveFile.name} is not a section document. Include index.json when uploading standard lessons.`);
      }
      const id = archiveFile.name.slice(0, -5).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!ID_PATTERN.test(id)) throw new Error(`${archiveFile.name} cannot be converted to a lesson id.`);
      inferred.push({
        id,
        file: archiveFile.name,
        title: doc.title,
        subject: doc.subject === "organic" ? "Organic Chemistry" : doc.subject === "physical" ? "Physical Chemistry" : "",
        level: "Exam Revision",
        release,
        format: "section-document",
      });
    }
    manifest = { lessons: inferred };
  }
  if (!isObject(manifest) || !Array.isArray(manifest.lessons) || manifest.lessons.length === 0) {
    throw new Error("index.json must contain a non-empty lessons array.");
  }

  const seenIds = new Set(), seenFiles = new Set(), lessons = [], usedFigures = new Set();
  for (let i = 0; i < manifest.lessons.length; i++) {
    const entry = manifest.lessons[i];
    const entryError = validateManifestEntry(entry, i);
    if (entryError) throw new Error(entryError);
    if (seenIds.has(entry.id)) throw new Error(`The uploaded manifest repeats lesson id "${entry.id}".`);
    const normalizedFile = entry.file.toLowerCase();
    if (seenFiles.has(normalizedFile)) throw new Error(`The uploaded manifest repeats filename "${entry.file}".`);
    seenIds.add(entry.id); seenFiles.add(normalizedFile);
    const archiveFile = jsonFiles.get(normalizedFile);
    if (!archiveFile) throw new Error(`${entry.file} is listed in index.json but is missing from the ZIP.`);
    const lesson = await parse(normalizedFile);
    const validation = validateLesson(lesson, entry, engine, new Set(figureFiles.keys()));
    if (typeof validation === "string" && validation) throw new Error(validation);
    if (validation?.usedFigures) validation.usedFigures.forEach((name) => usedFigures.add(name));
    lessons.push({ file: entry.file, lesson });
  }
  for (const [basename, archiveFile] of jsonFiles) {
    if (basename !== "index.json" && !seenFiles.has(basename)) {
      throw new Error(`${archiveFile.name} is a JSON file in the ZIP but is not listed in index.json.`);
    }
  }
  for (const [basename, archiveFile] of figureFiles) {
    if (!usedFigures.has(basename)) throw new Error(`${archiveFile.name} is an SVG figure not referenced by a lesson.`);
  }
  const assets = await Promise.all([...usedFigures].map(async (name) => {
    const archiveFile = figureFiles.get(name);
    return { name: archiveFile.name, bytes: await archiveFile.item.async("uint8array") };
  }));
  return { manifest, lessons, assets };
}

export function mergeLessonManifest(current, incoming) {
  if (!isObject(current) || !Array.isArray(current.lessons)) throw new Error("The live lesson index has an invalid format.");
  const currentIds = new Set(), currentFiles = new Set();
  const existing = current.lessons.map((entry, i) => {
    if (!isObject(entry) || !entry.file) {
      throw new Error(`The live lesson index does not expose a filename for ${entry?.id || `lesson ${i + 1}`}. Use the source index.json instead.`);
    }
    const error = validateManifestEntry({ ...entry, release: entry.release }, i);
    if (error) throw new Error(`The live lesson index cannot be safely merged: ${error}`);
    const normalizedFile = entry.file.toLowerCase();
    if (currentIds.has(entry.id) || currentFiles.has(normalizedFile)) throw new Error("The live lesson index contains duplicate lesson ids or filenames.");
    currentIds.add(entry.id); currentFiles.add(normalizedFile);
    const { expires, locked, ...rawEntry } = entry;
    return rawEntry;
  });
  for (const entry of incoming.lessons) {
    if (currentIds.has(entry.id)) throw new Error(`Lesson id "${entry.id}" already exists in the live index.`);
    if (currentFiles.has(entry.file.toLowerCase())) throw new Error(`Filename "${entry.file}" already exists in the live index.`);
    currentIds.add(entry.id); currentFiles.add(entry.file.toLowerCase());
  }
  const merged = { ...current, lessons: [...existing, ...incoming.lessons] };
  delete merged.now;
  delete merged.expiredCount;
  return merged;
}

export async function createDeploymentPatch(ZipLibrary, manifest, lessons, assets = []) {
  const patch = new ZipLibrary();
  patch.file("public/content/lessons/index.json", JSON.stringify(manifest, null, 2) + "\n");
  for (const item of lessons) {
    patch.file(`public/content/lessons/${item.file}`, JSON.stringify(item.lesson, null, 2) + "\n");
  }
  for (const asset of assets) patch.file(`public/assets/lesson-figures/${asset.name}`, asset.bytes);
  patch.file("LESSON-DEPLOY-INSTRUCTIONS.txt", [
    "White Room lesson deployment patch",
    "",
    "1. Extract this ZIP into the White Room project root, preserving folders.",
    "2. Run: npm run validate",
    "3. If validation passes, deploy the project using your existing Firebase workflow.",
    "",
    "This patch does not publish itself. It contains the merged public lesson index and the new lesson JSON files.",
    "",
  ].join("\n"));
  return patch.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
