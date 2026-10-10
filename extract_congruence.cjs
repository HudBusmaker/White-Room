const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");

const pdfPath = "C:/Users/user/Downloads/congruence_quick_notes.pdf";
const data = new Uint8Array(fs.readFileSync(pdfPath));

(async () => {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    out +=
      textContent.items.map((item) => item.str).join(" ") + "\n---PAGE---\n";
  }
  console.log(out.slice(0, 20000));
})();
