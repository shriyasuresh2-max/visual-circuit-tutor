const zigzag = [[-26, 0], [-20, -9], [-12, 9], [-4, -9], [4, 9], [12, -9], [20, 9], [26, 0]];

export const RESISTOR_ZIGZAG = zigzag.map((point) => point.join(',')).join(' ');

export function resistorGeometry(component) {
  const { x1, y1, x2, y2, center } = component;
  const from = { x: x1, y: y1 };
  const to = { x: x2, y: y2 };
  const x = center?.x ?? Math.round((x1 + x2) / 2);
  const y = center?.y ?? Math.round((y1 + y2) / 2);
  const angle = component.angle ?? Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const scale = component.symbolScale ?? 1;
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const body = zigzag.map(([u, v]) => ({ x: x + u * scale * cos - v * sin, y: y + u * scale * sin + v * cos }));
  if ((x2 - x1) * cos + (y2 - y1) * sin < 0) body.reverse();
  return { from, to, body, angle, scale };
}
