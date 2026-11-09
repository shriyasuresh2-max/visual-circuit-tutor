/**
 * useCircuitAnalysis — custom hook that POSTs an image file to
 * /api/analyze-image and manages loading, success, and error state.
 *
 * Handles:
 * - Cancelling in-flight requests when a new image is selected
 * - SVG files (rejected by backend) with a helpful UI message
 * - Stale response prevention via AbortController
 * - Detailed error extraction from backend JSON responses
 * - Accurate distinction between network/CORS issues and API errors
 */
import { useState, useRef, useCallback } from 'react';

const API_URL = 'http://127.0.0.1:8000/api/analyze-image';

/** MIME types the backend's vision endpoint accepts. */
const BACKEND_ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function useCircuitAnalysis() {
  const [analysisState, setAnalysisState] = useState({
    status: 'idle', // 'idle' | 'loading' | 'success' | 'error' | 'unsupported'
    result: null,
    error: null,
  });

  // Keep a ref to the current AbortController so we can cancel stale requests.
  const abortRef = useRef(null);

  /** Reset analysis state (call when image is removed or replaced). */
  const clearAnalysis = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAnalysisState({ status: 'idle', result: null, error: null });
  }, []);

  /**
   * Submit a file for analysis. SVG files are detected early and the user
   * gets a helpful message rather than a cryptic backend error.
   */
  const analyzeImage = useCallback(async (file) => {
    if (!file) return;

    // Cancel any in-flight request before starting a new one.
    if (abortRef.current) {
      abortRef.current.abort();
    }

    // SVG: the vision model cannot process vector markup.
    if (file.type === 'image/svg+xml' || file.name?.toLowerCase().endsWith('.svg')) {
      setAnalysisState({
        status: 'unsupported',
        result: null,
        error: null,
      });
      return;
    }

    // Other non-raster formats.
    if (!BACKEND_ACCEPTED_TYPES.has(file.type)) {
      setAnalysisState({
        status: 'error',
        result: null,
        error: `Unsupported file type "${file.type}". Upload a PNG, JPG, or WebP image.`,
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setAnalysisState({ status: 'loading', result: null, error: null });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      // Guard against stale responses after abort.
      if (controller.signal.aborted) return;

      let data = null;
      try {
        data = await response.json();
      } catch {
        // Response was not JSON
      }

      if (!response.ok) {
        let errorMessage = `Server error ${response.status}`;
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            errorMessage = data.detail;
          } else if (Array.isArray(data.detail)) {
            // FastAPI validation error detail array
            errorMessage = data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
          } else {
            errorMessage = JSON.stringify(data.detail);
          }
        }
        throw new Error(errorMessage);
      }

      setAnalysisState({ status: 'success', result: data, error: null });
    } catch (err) {
      if (err.name === 'AbortError') return; // Request was intentionally cancelled.

      let displayMessage = err.message || 'An unexpected error occurred.';
      if (err instanceof TypeError) {
        // Modern browsers throw TypeError for network disconnects, refused connections, and CORS failures
        displayMessage =
          'Cannot connect to backend at http://127.0.0.1:8000. Please ensure the FastAPI backend is running and CORS allows your port.';
      }

      setAnalysisState({
        status: 'error',
        result: null,
        error: displayMessage,
      });
    } finally {
      // Clear the ref only if this controller is still the current one.
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  return { analysisState, analyzeImage, clearAnalysis };
}
