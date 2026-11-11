'use client';
// Downloads a drafted application as PDF, Word or plain text, made in the browser. Lines in CAPITALS or starting
// with "Q:" / "## " are treated as headings (that is how the drafts are written).

export type Block = { kind: 'heading' | 'para'; text: string };

export function toBlocks(draft: string): Block[] {
  return draft.replace(/\r\n/g, '\n').split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).flatMap((chunk) => {
    const [first, ...rest] = chunk.split('\n');
    const isHeading = /^##\s+/.test(first) || /^Q\d*[:.]/i.test(first) || (first.length <= 120 && first === first.toUpperCase() && /[A-Z]/.test(first));
    if (!isHeading) return [{ kind: 'para' as const, text: chunk }];
    const out: Block[] = [{ kind: 'heading', text: first.replace(/^##\s+/, '') }];
    if (rest.length) out.push({ kind: 'para', text: rest.join('\n') });
    return out;
  });
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(title: string, draft: string, fileBase: string) {
  save(new Blob([`${title}\n\n${draft}\n`], { type: 'text/plain;charset=utf-8' }), `${fileBase}.txt`);
}

export async function downloadPdf(title: string, draft: string, fileBase: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56, width = doc.internal.pageSize.getWidth() - margin * 2, bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  const write = (text: string, size: number, bold: boolean, gapAfter: number) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    // jsPDF's built-in fonts only cover Latin-1: swap the usual typographic characters for plain ones.
    const safe = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF\n]/g, '');
    for (const line of doc.splitTextToSize(safe, width) as string[]) {
      if (y + size > bottom) { doc.addPage(); y = margin; }
      doc.text(line, margin, y + size);
      y += size * 1.4;
    }
    y += gapAfter;
  };
  write(title, 16, true, 10);
  for (const b of toBlocks(draft)) b.kind === 'heading' ? write(b.text, 11.5, true, 4) : write(b.text, 10.5, false, 10);
  save(doc.output('blob'), `${fileBase}.pdf`);
}

export async function downloadWord(title: string, draft: string, fileBase: string) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
  const paras = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] })];
  for (const b of toBlocks(draft)) {
    if (b.kind === 'heading') paras.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun(b.text)] }));
    else {
      const lines = b.text.split('\n');
      paras.push(new Paragraph({ spacing: { after: 160 }, children: lines.map((l, i) => new TextRun({ text: l, break: i ? 1 : 0 })) }));
    }
  }
  const doc = new Document({ styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children: paras }] });
  save(await Packer.toBlob(doc), `${fileBase}.docx`);
}
