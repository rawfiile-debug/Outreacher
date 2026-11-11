'use client';
// Reads the text out of uploaded files in the browser, so Claude's scheduled runs (which cannot download files)
// can use it. PDFs with pdf.js, Word files with mammoth, screenshots with Tesseract OCR. Libraries load on demand.

const MAX = 20000;
const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, MAX);

export async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      line += item.str ?? '';
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return tidy(pages.join('\n\n'));
}

export async function docxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return tidy(res.value);
}

export async function imageText(files: File[]): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const out: string[] = [];
    for (const f of files) out.push(tidy((await worker.recognize(f)).data.text));
    return out;
  } finally { await worker.terminate(); }
}

/** Text from a CV or form: PDF, Word (.docx) or plain text. Old .doc files cannot be read in the browser. */
export async function documentText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfText(file);
  if (name.endsWith('.docx')) return docxText(file);
  if (file.type.startsWith('text/') || name.endsWith('.txt')) return tidy(await file.text());
  throw new Error('Please upload a PDF, a Word (.docx) file or a text file.');
}
