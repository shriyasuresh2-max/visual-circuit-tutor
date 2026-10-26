import React, { useRef, useState } from 'react';
import { Upload, FileImage, ArrowRight, RefreshCw, BookOpen, AlertCircle } from 'lucide-react';
import { createSampleCircuitFile } from '../utils/sampleCircuit.js';

export default function LandingPage({
  imageFile,
  imagePreviewUrl,
  onImageSelected,
  onImageRemoved,
  onContinueToWorkspace
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const acceptedFormats = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

  const validateAndProcessFile = (file) => {
    setErrorMessage(null);
    if (!file) return;

    if (!acceptedFormats.includes(file.type)) {
      setErrorMessage('Unsupported format. Please select a PNG, JPG, or WebP image.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 10 MB limit.');
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
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const handleTriggerBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleLoadSample = () => {
    const { file, previewUrl } = createSampleCircuitFile();
    onImageSelected(file, previewUrl);
  };

  const handleSampleAndContinue = () => {
    const { file, previewUrl } = createSampleCircuitFile();
    onImageSelected(file, previewUrl);
    onContinueToWorkspace();
  };

  return (
    <div className="landing-page-container">
      {/* Minimal Header */}
      <header className="landing-header">
        <div className="landing-brand">
          <span className="brand-logo-symbol">⚡</span>
          <span className="brand-name">Visual Circuit Tutor</span>
        </div>
      </header>

      {/* Main Hero & Upload Area */}
      <main className="landing-main-content">
        <div className="landing-hero-copy">
          <h1 className="landing-title">Understand circuits, one step at a time.</h1>
          <p className="landing-subtitle">
            Upload an image of a textbook circuit problem or start with a sample to explore step-by-step visual analysis.
          </p>
        </div>

        {/* Central Prominent Upload Area */}
        <section className="central-upload-container" aria-label="Circuit problem image upload">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/jpg, image/webp"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {imagePreviewUrl ? (
            /* Selected Image Preview State */
            <div className="upload-preview-card">
              <div className="preview-image-box">
                <img
                  src={imagePreviewUrl}
                  alt="Selected circuit problem preview"
                  className="selected-preview-img"
                />
              </div>

              <div className="preview-meta-row">
                <div className="preview-file-text">
                  <FileImage size={18} className="text-secondary" />
                  <span className="preview-file-name">{imageFile?.name || 'circuit-diagram.png'}</span>
                  {imageFile?.size && (
                    <span className="preview-file-size">
                      ({(imageFile.size / 1024).toFixed(1)} KB)
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleTriggerBrowse}
                  className="btn-replace-image"
                  title="Choose a different image"
                >
                  <RefreshCw size={14} />
                  <span>Replace image</span>
                </button>
              </div>

              <div className="landing-action-buttons">
                <button
                  type="button"
                  onClick={onContinueToWorkspace}
                  className="btn-continue-workspace"
                >
                  <span>Continue to workspace</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            /* Empty Drag & Drop Zone */
            <div
              className={`landing-dropzone ${dragActive ? 'dropzone-active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={handleTriggerBrowse}
              role="button"
              tabIndex={0}
              aria-label="Upload circuit image"
            >
              <div className="dropzone-icon-wrap">
                <Upload size={32} className="dropzone-upload-icon" />
              </div>
              <h2 className="dropzone-main-text">Drop your circuit problem here</h2>
              <p className="dropzone-sub-text">or click to browse files from your computer</p>
              <span className="dropzone-badge-formats">Supports PNG, JPG, or WebP (up to 10 MB)</span>

              <div className="dropzone-action-row">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTriggerBrowse();
                  }}
                  className="btn-browse-files"
                >
                  Browse files
                </button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="landing-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Secondary Sample Action (when no image selected) */}
          {!imagePreviewUrl && (
            <div className="landing-secondary-actions">
              <span className="secondary-divider-text">Don't have a circuit diagram handy?</span>
              <button
                type="button"
                onClick={handleSampleAndContinue}
                className="btn-try-sample"
              >
                <BookOpen size={15} />
                <span>Try a sample circuit</span>
              </button>
            </div>
          )}

          {/* Unobtrusive Honest Limitation Notice */}
          <div className="landing-limitation-notice">
            <p>
              <strong>Please note:</strong> Automated circuit recognition is in active development.
              Your uploaded diagram will be displayed as a visual reference alongside the interactive solver,
              allowing you to align parameters and follow the solution step by step.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <p>Visual Circuit Tutor • Educational Engineering Analysis</p>
      </footer>
    </div>
  );
}
