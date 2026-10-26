import React from 'react';
import { X, FileText, Info } from 'lucide-react';

export default function ReferenceViewer({
  isOpen,
  onClose,
  imageFile,
  imagePreviewUrl
}) {
  if (!isOpen || !imagePreviewUrl) return null;

  return (
    <aside className="reference-drawer-overlay" role="dialog" aria-label="Textbook problem reference">
      <div className="reference-drawer-card">
        <div className="reference-drawer-header">
          <div className="reference-header-title-row">
            <FileText size={16} className="text-secondary" />
            <h3 className="reference-title">Textbook Problem Reference</h3>
            <span className="reference-filename">
              ({imageFile?.name || 'reference-diagram.png'})
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-close-drawer"
            aria-label="Close reference view"
          >
            <X size={16} />
          </button>
        </div>

        <div className="reference-image-stage">
          <img
            src={imagePreviewUrl}
            alt="Uploaded textbook reference circuit"
            className="reference-full-img"
          />
        </div>

        <div className="reference-drawer-footer">
          <Info size={14} className="text-muted flex-shrink-0" />
          <p className="reference-footer-note">
            Visual reference only. Use the parameter strip above to align the simulator's voltage and resistance with your textbook problem.
          </p>
        </div>
      </div>
    </aside>
  );
}
