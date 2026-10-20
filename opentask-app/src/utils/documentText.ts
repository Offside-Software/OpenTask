export const MIN_TEXT_CHARS = 200;
export const MAX_TEXT_CHARS = 300_000;
export const ACCEPTED_TEXT_FILES = ".txt,.md,.markdown,.docx,.pdf";

const extensionOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

// [^\S\n] is any whitespace except a newline (tabs, non-breaking spaces, ...).
const normalizeWhitespace = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str + (item.hasEOL ? "\n" : " ");
        }
      }
      pages.push(text);
    }
    return pages.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}

/** Throws an Error with a message fit for the user when the file cannot be used. */
export async function extractDocumentText(file: File): Promise<string> {
  const ext = extensionOf(file.name);
  let raw: string;
  if (ext === "docx") {
    raw = await readDocx(file);
  } else if (ext === "pdf") {
    raw = await readPdf(file);
  } else if (ext === "txt" || ext === "md" || ext === "markdown" || file.type.startsWith("text/")) {
    raw = await file.text();
  } else {
    throw new Error("Use a .txt, .md, .docx or .pdf file.");
  }

  const text = normalizeWhitespace(raw);
  if (text.length < MIN_TEXT_CHARS) {
    const found = text.length === 0 ? "no text" : `only ${text.length} characters of text`;
    const hint = ext === "pdf" ? " Scanned PDFs (page images) have no text to read and aren't supported." : "";
    throw new Error(`This file has ${found}; at least ${MIN_TEXT_CHARS} are needed.${hint}`);
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error(`The document is too long (${text.length.toLocaleString()} characters, max ${MAX_TEXT_CHARS.toLocaleString()}).`);
  }
  return text;
}
