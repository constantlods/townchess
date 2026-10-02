import { Noise2D } from '../render/noise';

/**
 * Small procedural avatar portraits (original): a hooded, caged-mask silhouette for the opponent,
 * a gaunt patient-ID photo style for the player. Drawn once into a canvas.
 */
export function drawPortrait(c: HTMLCanvasElement, kind: 'patient' | 'masked' | 'unknown', seed = 1) {
  const S = 104;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const n = new Noise2D(seed);
  // background: grimy wall
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = n.fbm(x / 18, y / 18, 3) * 12;
    const vig = 1 - Math.hypot(x - S / 2, y - S / 2) / S;
    const i = (y * S + x) * 4;
    const base = kind === 'masked' ? [46, 20, 16] : [40, 38, 30];
    img.data[i] = (base[0] + v) * (0.5 + vig);
    img.data[i + 1] = (base[1] + v) * (0.5 + vig);
    img.data[i + 2] = (base[2] + v) * (0.5 + vig);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const cx = S / 2;
  // shoulders
  g.fillStyle = kind === 'masked' ? '#1a1612' : '#3c3a2c';
  g.beginPath(); g.ellipse(cx, S + 8, 46, 34, 0, 0, Math.PI * 2); g.fill();
  // head / hood
  if (kind === 'masked' || kind === 'unknown') {
    g.fillStyle = '#16130f';
    g.beginPath(); g.ellipse(cx, 50, 30, 36, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a201a';
    g.beginPath(); g.ellipse(cx, 52, 19, 25, 0, 0, Math.PI * 2); g.fill();
    if (kind === 'masked') {
      g.strokeStyle = '#8a8070'; g.lineWidth = 1.6;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx + i * 5.5, 30); g.quadraticCurveTo(cx + i * 6.5, 52, cx + i * 4, 76); g.stroke(); }
      for (const y of [38, 52, 66]) { g.beginPath(); g.moveTo(cx - 20, y); g.quadraticCurveTo(cx, y + 4, cx + 20, y); g.stroke(); }
    } else {
      g.fillStyle = '#d8ccb2'; g.font = 'bold 28px "Courier Prime", monospace'; g.textAlign = 'center'; g.fillText('?', cx, 62);
    }
  } else {
    // gaunt face, shaved head, institutional photo
    const skin = g.createRadialGradient(cx - 6, 44, 4, cx, 50, 30);
    skin.addColorStop(0, '#a88a72'); skin.addColorStop(1, '#4a3a2e');
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(cx, 50, 21, 27, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c1612';
    g.beginPath(); g.ellipse(cx - 8, 47, 4.2, 2.4, 0, 0, Math.PI * 2); g.ellipse(cx + 8, 47, 4.2, 2.4, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a20'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - 6, 64); g.lineTo(cx + 6, 64); g.stroke();
    g.beginPath(); g.moveTo(cx, 50); g.lineTo(cx - 2, 58); g.lineTo(cx + 2, 58); g.stroke();
    // ID tape
    g.fillStyle = 'rgba(200,190,160,0.75)'; g.fillRect(8, S - 18, 44, 11);
    g.fillStyle = '#2a2018'; g.font = '8px "Courier Prime", monospace'; g.fillText('No. 07', 12, S - 10);
  }
  // photo grain + fade
  const im = g.getImageData(0, 0, S, S);
  for (let i = 0; i < im.data.length; i += 4) { const r = (Math.random() - 0.5) * 18; im.data[i] += r; im.data[i + 1] += r; im.data[i + 2] += r; }
  g.putImageData(im, 0, 0);
}
