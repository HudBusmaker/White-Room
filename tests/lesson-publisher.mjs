import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { createDeploymentPatch, mergeLessonManifest, readLessonArchive } from "../public/lesson-publisher-core.js";

const engineSource = await readFile(new URL("../public/lesson-engine.js", import.meta.url), "utf8");
const engine = new Function(engineSource + "\nreturn WRLesson;")();

const lesson = {
  id: "test-topic",
  title: "Test topic",
  level: "Form 5",
  subject: "Chemistry",
  topic: "Test",
  summary: "A test lesson summary.",
  notes: [{
    title: "First idea",
    text: "A short example: {a} + {b} = {c}.",
    gen: { a: [2, 4], b: [1, 3] },
    calc: { c: "a+b" },
    tasks: [{ t: "num", m: 1, q: "Calculate {c}.", f: [{ l: "value", v: "c" }] }],
    working: ["Add the values."],
  }],
};
const manifest = { lessons: [{ id: lesson.id, file: "test-topic.json", title: lesson.title, subject: lesson.subject, level: lesson.level, release: "2026-10-09T17:00:00+01:00" }] };
async function sourceArchive(entries = {}) {
  const zip = new JSZip();
  zip.file("lessons/index.json", JSON.stringify(manifest));
  zip.file("lessons/test-topic.json", JSON.stringify(lesson));
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array" });
}

test("reads a nested lesson archive and validates generated tasks", async () => {
  const result = await readLessonArchive(await sourceArchive(), JSZip, engine);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].lesson.id, "test-topic");
});

test("merges incoming lessons without dropping live entries or runtime fields", () => {
  const existing = { now: 1, expiredCount: 0, lessons: [{ id: "old", file: "old.json", title: "Old", subject: "Maths", level: "Form 5", release: "2026-10-01T17:00:00Z", locked: false, expires: "2026-10-11T17:00:00Z" }] };
  const result = mergeLessonManifest(existing, manifest);
  assert.equal(result.lessons.length, 2);
  assert.equal("now" in result, false);
  assert.equal("locked" in result.lessons[0], false);
  assert.equal(result.lessons[1].id, "test-topic");
});

test("rejects unsafe lesson filenames and existing-id collisions", async () => {
  const unsafe = structuredClone(manifest);
  unsafe.lessons[0].file = "../test-topic.json";
  const zip = new JSZip();
  zip.file("index.json", JSON.stringify(unsafe));
  zip.file("test-topic.json", JSON.stringify(lesson));
  await assert.rejects(readLessonArchive(await zip.generateAsync({ type: "uint8array" }), JSZip, engine), /unsafe lesson filename/);
  assert.throws(() => mergeLessonManifest({ lessons: manifest.lessons }, manifest), /already exists/);
});

test("rejects case-insensitive filename collisions in uploaded manifests", async () => {
  const duplicate = structuredClone(manifest);
  duplicate.lessons.push({ ...duplicate.lessons[0], id: "test-topic-copy", file: "TEST-TOPIC.JSON" });
  const zip = new JSZip();
  zip.file("index.json", JSON.stringify(duplicate));
  zip.file("test-topic.json", JSON.stringify(lesson));
  zip.file("TEST-TOPIC.JSON", JSON.stringify({ ...lesson, id: "test-topic-copy" }));
  await assert.rejects(readLessonArchive(await zip.generateAsync({ type: "uint8array" }), JSZip, engine), /more than one file named/);
});

test("imports the supplied section-document chemistry ZIP layout", async () => {
  const zip = new JSZip();
  const lessonsDir = new URL("../public/content/lessons/", import.meta.url);
  const figuresDir = new URL("../public/assets/lesson-figures/", import.meta.url);
  const names = ["organic_exam_notes.json", "physical_exam_notes.json"];
  for (const name of names) zip.file(name, await readFile(new URL(name, lessonsDir)));
  const figures = [
    "benzene-hydrogenation-energy-levels.svg",
    "born-haber-cycle-nacl.svg",
    "maximum-boiling-azeotrope.svg",
    "minimum-boiling-azeotrope.svg",
    "water-phase-diagram.svg",
  ];
  for (const name of figures) zip.file(name, await readFile(new URL(name, figuresDir)));
  const result = await readLessonArchive(
    await zip.generateAsync({ type: "uint8array" }),
    JSZip,
    engine,
    "2026-10-09T06:00:00.000Z",
  );
  assert.deepEqual(result.manifest.lessons.map((entry) => entry.id), ["organic-exam-notes", "physical-exam-notes"]);
  assert.equal(result.lessons.length, 2);
  assert.equal(result.assets.length, 5);
  assert.ok(result.manifest.lessons.every((entry) => entry.format === "section-document"));
  const countBlocks = (document, type) => document.sections.flatMap((section) => section.blocks).filter((block) => block.type === type).length;
  assert.equal(result.lessons[0].lesson.sections.length, 12);
  assert.equal(countBlocks(result.lessons[0].lesson, "table"), 11);
  assert.equal(countBlocks(result.lessons[0].lesson, "hands_on"), 22);
  assert.equal(result.lessons[1].lesson.sections.length, 12);
  assert.equal(countBlocks(result.lessons[1].lesson, "hands_on"), 9);
  assert.equal(countBlocks(result.lessons[1].lesson, "table"), 9);
  assert.equal(countBlocks(result.lessons[1].lesson, "qa"), 5);
  assert.equal(countBlocks(result.lessons[1].lesson, "figure"), 5);
  const bundleBlob = await createDeploymentPatch(JSZip, result.manifest, result.lessons, result.assets);
  const bundle = await JSZip.loadAsync(await bundleBlob.arrayBuffer());
  assert.ok(bundle.file("public/content/lessons/organic_exam_notes.json"));
  assert.ok(bundle.file("public/content/lessons/physical_exam_notes.json"));
  assert.ok(bundle.file("public/assets/lesson-figures/water-phase-diagram.svg"));
});

test("creates an overlay patch with the merged index and lesson files", async () => {
  const blob = await createDeploymentPatch(JSZip, { lessons: manifest.lessons }, [{ file: "test-topic.json", lesson }]);
  const patch = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(patch.file("public/content/lessons/index.json"));
  assert.ok(patch.file("public/content/lessons/test-topic.json"));
  assert.ok(patch.file("LESSON-DEPLOY-INSTRUCTIONS.txt"));
});
