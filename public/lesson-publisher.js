import { createDeploymentPatch, mergeLessonManifest, readLessonArchive } from "./lesson-publisher-core.js";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const fileInput = $("#lessonZip");
  const releaseInput = $("#lessonRelease");
  const buildButton = $("#lessonBuild");
  const downloadButton = $("#lessonDownload");
  const note = $("#lessonPublishNote");
  const preview = $("#lessonPublishPreview");
  let downloadUrl = "";
  let pendingPatch = null;

  const localDateTime = (date) => {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 16);
  };
  releaseInput.value = localDateTime(new Date());

  const releaseIso = () => {
    const value = releaseInput.value;
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  };
  const setNote = (text, error = false) => {
    note.textContent = text;
    note.classList.toggle("err", error);
  };
  const clearPatch = () => {
    pendingPatch = null;
    downloadButton.hidden = true;
    preview.hidden = true;
    preview.replaceChildren();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = "";
  };

  fileInput.addEventListener("change", () => {
    clearPatch();
    const file = fileInput.files && fileInput.files[0];
    buildButton.disabled = !file;
    setNote(file ? `${file.name} selected. Check it to prepare the patch.` : "");
  });

  buildButton.addEventListener("click", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return setNote("Choose a ZIP file first.", true);
    clearPatch();
    buildButton.disabled = true;
    fileInput.disabled = true;
    setNote("Checking lesson files and loading the current lesson index…");
    try {
      const zipLibrary = window.JSZip;
      const engine = window.WRLesson;
      if (!zipLibrary || !engine) throw new Error("The lesson tools did not load. Refresh the page and try again.");
      const uploaded = await readLessonArchive(file, zipLibrary, engine, releaseIso());
      const response = await fetch("content/lessons/index.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not read the live lesson index (HTTP ${response.status}).`);
      const current = await response.json();
      const merged = mergeLessonManifest(current, uploaded.manifest);
      pendingPatch = await createDeploymentPatch(zipLibrary, merged, uploaded.lessons, uploaded.assets);
      const list = document.createElement("ul");
      uploaded.lessons.forEach(({ file: filename, lesson }) => {
        const item = document.createElement("li");
        item.textContent = `${lesson.title} — ${filename}`;
        list.append(item);
      });
      const bundleHeading = document.createElement("b");
      bundleHeading.textContent = "Bundle contents";
      const bundleHeadingLine = document.createElement("p");
      bundleHeadingLine.append(bundleHeading);
      preview.replaceChildren(
        Object.assign(document.createElement("p"), { textContent: `${uploaded.lessons.length} lesson(s) checked and added to the merged index.` }),
        bundleHeadingLine,
        list,
        ...(uploaded.assets.length ? [Object.assign(document.createElement("p"), { textContent: `${uploaded.assets.length} figure asset(s) included.` })] : []),
        Object.assign(document.createElement("p"), { textContent: "The patch ZIP is ready. It has not been published to Firebase." }),
      );
      preview.hidden = false;
      downloadButton.hidden = false;
      setNote("Validation passed. Download the deployment patch when ready.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not prepare the lesson patch.", true);
    } finally {
      buildButton.disabled = false;
      fileInput.disabled = false;
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!pendingPatch) return setNote("Prepare a bundle before downloading.", true);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(pendingPatch);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "white-room-lesson-deployment-patch.zip";
    link.click();
    setNote("Deployment patch downloaded. Extract it into your project, run npm run validate, then deploy.");
  });
})();
