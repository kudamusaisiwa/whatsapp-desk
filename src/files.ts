export async function readKnowledge(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error(`${file.name} is larger than 10 MB.`);
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  let text = "";
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 150)
        throw new Error("Use a PDF of 150 pages or fewer.");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((x: any) => x.str ?? "").join(" "));
      }
      text = pages.join("\n\n");
    } finally {
      await task.destroy();
    }
    if (text.trim().length < 20)
      throw new Error(
        "This PDF has no readable text. Export it as text or use a searchable PDF. Scanned images need OCR first.",
      );
  } else if (ext === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    text = result.value;
  } else if (["txt", "md", "csv", "json"].includes(ext ?? ""))
    text = await file.text();
  else throw new Error("Choose PDF, DOCX, TXT, Markdown, CSV or JSON.");
  if (!text.trim()) throw new Error("This document has no readable text.");
  if (text.length > 300000)
    throw new Error(
      "This document is too long. Split it into smaller files of up to 300,000 characters.",
    );
  return text.trim();
}
