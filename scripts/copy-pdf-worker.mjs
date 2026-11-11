// Copies pdf.js's worker into public/ so the browser can load it when reading PDFs.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/vendor/pdf.worker.min.mjs');
