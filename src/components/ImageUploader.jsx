import React, { useRef, useState } from 'react';
import { Upload, Trash2, AlertCircle, FileText } from 'lucide-react';

export default function ImageUploader({
  imageFile,
  imagePreviewUrl,
  onImageSelected,
  onImageRemoved
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const acceptedFormats = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

  const processFile = (file) => {
    setUploadError(null);
    if (!file) return;

    if (!acceptedFormats.includes(file.type)) {
      setUploadError('Unsupported format. Please upload PNG, JPG, or WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File exceeds 10 MB limit.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    onImageSelected(file, previewUrl);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Loads a clean sample textbook circuit diagram for testing
  const handleLoadSampleQuestion = () => {
    const sampleSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="500" height="320" viewBox="0 0 500 320">
        <rect width="500" height="320" fill="#ffffff"/>
        <rect x="15" y="15" width="470" height="290" fill="none" stroke="#cbd5e1" stroke-width="1.5" rx="4"/>
        <text x="35" y="45" font-family="sans-serif" font-size="15" font-weight="bold" fill="#0f172a">Textbook Problem 3.1: Closed Loop Series Circuit</text>
        <text x="35" y="70" font-family="sans-serif" font-size="12" fill="#475569">Determine the series current (I) supplied by the 12 V battery through R = 4 Ω.</text>
        
        <rect x="110" y="110" width="280" height="140" fill="none" stroke="#1e293b" stroke-width="2.5"/>
        <circle cx="110" cy="180" r="20" fill="#ffffff" stroke="#1e293b" stroke-width="2.5"/>
        <text x="110" y="176" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="#0f172a">+</text>
        <text x="110" y="193" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#0f172a">−</text>
        <text x="65" y="185" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0284c7">12 V</text>
        
        <rect x="220" y="100" width="60" height="20" fill="#ffffff" stroke="#1e293b" stroke-width="2.5"/>
        <text x="250" y="114" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="#d97706">4 Ω</text>
        
        <text x="310" y="100" font-family="sans-serif" font-size="12" font-weight="bold" fill="#059669">I →</text>
      </svg>
    `;
    const blob = new Blob([sampleSvg], { type: 'image/svg+xml' });
    const file = new File([blob], 'textbook_circuit_sample.svg', { type: 'image/svg+xml' });
    const previewUrl = URL.createObjectURL(file);
    onImageSelected(file, previewUrl);
  };

  return (
    <div className="panel-card upload-panel">
      <div className="panel-header">
        <h2 className="panel-title">Textbook Reference</h2>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png, image/jpeg, image/jpg, image/webp"
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />

      {imagePreviewUrl ? (
        <div className="preview-layout">
          <div className="preview-frame">
            <img
              src={imagePreviewUrl}
              alt="Uploaded textbook circuit problem"
              className="preview-img"
            />
          </div>

          <div className="preview-toolbar">
            <div className="file-details">
              <span className="file-name" title={imageFile?.name}>
                {imageFile?.name || 'Uploaded Diagram'}
              </span>
              {imageFile?.size && (
                <span className="file-size">
                  ({(imageFile.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>

            <div className="preview-actions">
              <button
                type="button"
                onClick={triggerFileInput}
                className="btn-text-action"
                title="Replace image"
              >
                Change
              </button>
              <button
                type="button"
                onClick={onImageRemoved}
                className="btn-text-action action-danger"
                title="Remove image"
              >
                <Trash2 size={13} />
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone-box ${dragActive ? 'dropzone-dragover' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileInput}
          role="button"
          tabIndex={0}
          aria-label="Upload diagram image"
        >
          <Upload size={20} className="dropzone-icon" />
          <p className="dropzone-text">
            Drop diagram image here, or <span className="text-link">browse</span>
          </p>
          <p className="dropzone-formats-note">PNG, JPG, or WebP</p>

          <button
            type="button"
            className="btn-sample-reference"
            onClick={(e) => {
              e.stopPropagation();
              handleLoadSampleQuestion();
            }}
          >
            <FileText size={13} />
            <span>Load Sample Problem</span>
          </button>
        </div>
      )}

      <p className="reference-note">
        Reference preview only. Automated circuit extraction is in development.
      </p>

      {uploadError && (
        <div className="upload-inline-error">
          <AlertCircle size={14} />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}
