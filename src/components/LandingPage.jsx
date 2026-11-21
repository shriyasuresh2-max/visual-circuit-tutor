import React, { useRef, useState } from 'react';
import { Upload, FileImage, ArrowRight, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import AnalysisResultPanel from './AnalysisResultPanel.jsx';
import { analysisIsPending, canOpenWorkspace } from '../hooks/useCircuitAnalysis.js';

export default function LandingPage({
  imageFile,
  imagePreviewUrl,
  onImageSelected,
  onImageRemoved,
  onContinueToWorkspace,
  onRetryAnalysis,
  analysisState,
  questionText = '',
  onQuestionChange,
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const pending = analysisIsPending(analysisState?.status);
  const ready = canOpenWorkspace(analysisState, imageFile);
  const actions = (
    <div className="landing-action-buttons">
      {analysisState?.status === 'error' && analysisState.canRetry && (
        <button type="button" className="btn-replace-image" onClick={onRetryAnalysis}>Retry Analysis</button>
      )}
      <button type="button" onClick={onContinueToWorkspace} className="btn-continue-workspace"
        disabled={!ready} aria-busy={pending}>
        <span>{pending ? 'Analyzing Circuit…' : 'Continue to Workspace'}</span>
        {pending ? <Loader2 size={16} className="analysis-spinner" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      </button>
    </div>
  );

  const acceptedFormats = ['image/png', 'image/jpeg', 'image/webp'];

  const validateAndProcessFile = (file) => {
    setErrorMessage(null);
    if (!file) return;

    if (!acceptedFormats.includes(file.type)) {
      onImageRemoved?.();
      setErrorMessage('Unsupported format. Please select a PNG, JPG, or WebP image.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      onImageRemoved?.();
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
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) validateAndProcessFile(file);
  };

  const handleTriggerBrowse = () => {
    fileInputRef.current?.click();
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
            Upload an image of a textbook circuit problem to explore step-by-step visual analysis.
          </p>
        </div>

        {/* Step 1 — the question to answer, carried into the workspace */}
        <section className="landing-question-section" aria-label="Your question">
          <label className="landing-question-label" htmlFor="landing-problem-question">
            What would you like to find out?
          </label>
          <textarea
            id="landing-problem-question"
            className="landing-question-input"
            value={questionText}
            onChange={(e) => onQuestionChange?.(e.target.value)}
            placeholder="Example: What is the current through R1? Leave blank for a step-by-step nodal analysis."
            rows={4}
          />
        </section>

        {/* Step 2 — Central Prominent Upload Area */}
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

              {actions}

              {/* Analysis results shown inline on the landing page */}
              {analysisState && analysisState.status !== 'idle' && (
                <div className="landing-analysis-result">
                  <AnalysisResultPanel analysisState={analysisState} />
                </div>
              )}
            </div>
          ) : (
            /* Empty Drag & Drop Zone */
            <>
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
              {actions}
            </>
          )}

          {errorMessage && (
            <div className="landing-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Unobtrusive Honest Limitation Notice */}
          <div className="landing-limitation-notice">
            <p>
              <strong>Please note:</strong> Circuit recognition identifies components and
              connections visible in your image using AI vision.
              It does not numerically solve the circuit — use the interactive
              workspace to work through the solution step by step.
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
