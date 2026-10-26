/**
 * Generates an SVG-based Blob and File representing a sample textbook circuit problem.
 * Used for instant testing and the "Try a sample circuit" user flow.
 */
export function createSampleCircuitFile() {
  const sampleSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="560" height="360" viewBox="0 0 560 360">
      <rect width="560" height="360" fill="#ffffff" rx="8"/>
      <rect x="18" y="18" width="524" height="324" fill="none" stroke="#cbd5e1" stroke-width="1.5" rx="6"/>
      <text x="36" y="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#0f172a">
        Textbook Example 2.4: Ideal DC Series Loop
      </text>
      <text x="36" y="76" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#475569">
        A 12 V battery is connected across a 4 Ω resistor. Calculate the loop current (I) and total power (P).
      </text>
      
      <!-- Circuit Conductor Loop -->
      <rect x="130" y="120" width="300" height="160" fill="none" stroke="#1e293b" stroke-width="2.5"/>
      
      <!-- DC Voltage Source Symbol (Battery) -->
      <circle cx="130" cy="200" r="24" fill="#ffffff" stroke="#1e293b" stroke-width="2.5"/>
      <text x="130" y="195" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#0284c7">+</text>
      <text x="130" y="214" font-family="sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#0f172a">−</text>
      <text x="80" y="206" font-family="monospace" font-size="14" font-weight="700" fill="#0284c7">12 V</text>
      
      <!-- Resistor Symbol -->
      <rect x="250" y="108" width="60" height="24" fill="#ffffff" stroke="#1e293b" stroke-width="2.5"/>
      <text x="280" y="124" font-family="monospace" font-size="13" font-weight="700" text-anchor="middle" fill="#d97706">4 Ω</text>
      
      <!-- Current Arrow -->
      <path d="M 360 120 L 385 120" stroke="#059669" stroke-width="2.5" marker-end="url(#arrow)"/>
      <text x="372" y="108" font-family="monospace" font-size="13" font-weight="700" fill="#059669">I →</text>
    </svg>
  `;

  const blob = new Blob([sampleSvg], { type: 'image/svg+xml' });
  const file = new File([blob], 'sample_textbook_circuit.svg', { type: 'image/svg+xml' });
  const previewUrl = URL.createObjectURL(file);

  return { file, previewUrl };
}
