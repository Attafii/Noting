import { triggerBlobDownload } from './api';

/** Escape HTML for the standalone .html export. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal markdown→HTML for single-note export (lazy path avoids pulling react-dom/server into the main chunk for preview). */
function markdownToHtmlBody(text: string): string {
  // Reuse the fenced-code + heading + paragraph subset; full GFM stays in-app.
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      out.push(`<p>${escapeHtml(para.join(' '))}</p>`);
      para = [];
    }
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      out.push(inFence ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inFence) {
      out.push(escapeHtml(line));
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      out.push(`<h${level}>${escapeHtml(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*-\s\[ \]/.test(line)) {
      flush();
      out.push(`<p>☐ ${escapeHtml(line.replace(/^\s*-\s\[ \]\s?/, ''))}</p>`);
      continue;
    }
    if (/^\s*-\s/.test(line)) {
      flush();
      out.push(`<p>• ${escapeHtml(line.replace(/^\s*-\s+/, ''))}</p>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

function download(filename: string, content: string, type: string) {
  triggerBlobDownload(new Blob([content], { type }), filename);
}

export function exportNoteMarkdown(title: string, text: string) {
  const safe = title.trim() || 'note';
  download(`${safe}.md`, text, 'text/markdown');
}

export function exportNoteHtml(title: string, text: string) {
  const safe = title.trim() || 'note';
  const body = markdownToHtmlBody(text);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(safe)}</title><style>body{font-family:system-ui,sans-serif;max-width:65ch;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#18181b}pre{background:#f4f4f5;padding:1rem;overflow-x:auto}code{font-family:ui-monospace,monospace}</style></head><body><h1>${escapeHtml(safe)}</h1>${body}</body></html>`;
  download(`${safe}.html`, html, 'text/html');
}

export function printNote(title: string, text: string) {
  const popup = window.open('', '_blank', 'width=800,height=900');
  if (!popup) return;
  const body = markdownToHtmlBody(text);
  popup.document.write(
    `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:65ch;margin:2rem auto;padding:0 1rem;line-height:1.6}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
}
