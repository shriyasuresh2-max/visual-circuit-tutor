import React from 'react';
import { AlertCircle, Eye, Info } from 'lucide-react';

export default function DemoBanner({ hasUploadedImage }) {
  return (
    <aside className="demo-banner" aria-label="Demo mode announcement">
      <div className="demo-banner-content">
        <div className="demo-banner-badge">
          <Info size={16} />
          <span>DEMO MODE ACTIVE</span>
        </div>
        <p className="demo-banner-text">
          <strong>Built-in Educational Lesson:</strong> The interactive SVG schematic and step-by-step solver below analyze a <strong>calibrated 12 V / 4 Ω ideal closed DC circuit</strong>. 
          {hasUploadedImage ? (
            <span className="demo-banner-highlight">
              {' '}Your uploaded textbook image is displayed alongside as a visual reference; automated AI diagram recognition is reserved for future milestones.
            </span>
          ) : (
            <span>
              {' '}Image upload preview is enabled for reference comparison. (Full computer vision circuit extraction will be introduced in upcoming milestones).
            </span>
          )}
        </p>
      </div>
      <div className="demo-banner-tag">
        <Eye size={13} />
        <span>Pre-calibrated Sample Circuit</span>
      </div>
    </aside>
  );
}
