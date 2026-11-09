/**
 * Generates a PNG-based Blob and File representing a sample textbook circuit
 * problem. Uses an offscreen canvas so the output is a raster image that the
 * Gemini vision model can actually process (SVG is rejected by the backend).
 *
 * The sample is a 12 V battery in series with a 4 Ω resistor — a simple,
 * known topology that is easy to verify against the model's output.
 */
export function createSampleCircuitFile() {
  const W = 560;
  const H = 360;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 18, 18, W - 36, H - 36, 6);
  ctx.stroke();

  // Title text
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Textbook Example 2.4: Ideal DC Series Loop', 36, 52);

  ctx.fillStyle = '#475569';
  ctx.font = '13px sans-serif';
  ctx.fillText('A 12 V battery is connected across a 4 \u03A9 resistor.', 36, 76);
  ctx.fillText('Calculate the loop current (I) and total power (P).', 36, 94);

  // --- Circuit conductor loop (rectangle) ---
  const lx = 130, ly = 120, lw = 300, lh = 160;
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.5;
  // Top wire (with a gap for the resistor)
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx + lw / 2 - 36, ly);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lx + lw / 2 + 36, ly);
  ctx.lineTo(lx + lw, ly);
  ctx.stroke();
  // Bottom wire
  ctx.beginPath();
  ctx.moveTo(lx, ly + lh);
  ctx.lineTo(lx + lw, ly + lh);
  ctx.stroke();
  // Left wire (with a gap for the battery)
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx, ly + lh / 2 - 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lx, ly + lh / 2 + 30);
  ctx.lineTo(lx, ly + lh);
  ctx.stroke();
  // Right wire
  ctx.beginPath();
  ctx.moveTo(lx + lw, ly);
  ctx.lineTo(lx + lw, ly + lh);
  ctx.stroke();

  // --- Battery symbol (left branch) ---
  const bx = lx;
  const by = ly + lh / 2;
  ctx.strokeStyle = '#1e293b';
  // Positive plate (long)
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx - 18, by - 10);
  ctx.lineTo(bx + 18, by - 10);
  ctx.stroke();
  // Negative plate (short)
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bx - 10, by + 4);
  ctx.lineTo(bx + 10, by + 4);
  ctx.stroke();
  // Second cell
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx - 18, by + 14);
  ctx.lineTo(bx + 18, by + 14);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bx - 10, by + 24);
  ctx.lineTo(bx + 10, by + 24);
  ctx.stroke();
  // Polarity symbols
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('+', bx, by - 14);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('\u2212', bx, by + 40);
  // Value label
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('12 V', bx - 60, by + 8);

  // --- Resistor symbol (top branch, zigzag box) ---
  const rx = lx + lw / 2;
  const ry = ly;
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(rx - 36, ry);
  ctx.lineTo(rx - 28, ry - 10);
  ctx.lineTo(rx - 18, ry + 10);
  ctx.lineTo(rx - 8, ry - 10);
  ctx.lineTo(rx + 2, ry + 10);
  ctx.lineTo(rx + 12, ry - 10);
  ctx.lineTo(rx + 22, ry + 10);
  ctx.lineTo(rx + 30, ry);
  ctx.lineTo(rx + 36, ry);
  ctx.stroke();
  // Value label
  ctx.fillStyle = '#d97706';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('4 \u03A9', rx, ry - 16);

  // --- Current arrow (bottom wire) ---
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(lx + 200, ly + lh);
  ctx.lineTo(lx + 240, ly + lh);
  ctx.stroke();
  // Arrowhead
  ctx.fillStyle = '#059669';
  ctx.beginPath();
  ctx.moveTo(lx + 240, ly + lh);
  ctx.lineTo(lx + 234, ly + lh - 5);
  ctx.lineTo(lx + 234, ly + lh + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#059669';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('I \u2192', lx + 245, ly + lh - 6);

  // Junction dots
  ctx.fillStyle = '#1e293b';
  [[lx, ly], [lx + lw, ly], [lx + lw, ly + lh], [lx, ly + lh]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const dataUrl = canvas.toDataURL('image/png');
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeString });
  const file = new File([blob], 'sample_textbook_circuit.png', { type: 'image/png' });
  const previewUrl = URL.createObjectURL(file);

  return { file, previewUrl };
}

/** Rounded rectangle path helper (pre-dates Canvas.roundRect in older browsers). */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
