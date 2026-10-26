import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LandingPage from './components/LandingPage.jsx';
import WorkspaceHeader from './components/WorkspaceHeader.jsx';
import WorkspaceParametersStrip from './components/WorkspaceParametersStrip.jsx';
import WorkspaceCalculatedStrip from './components/WorkspaceCalculatedStrip.jsx';
import CircuitDiagram from './components/CircuitDiagram.jsx';
import StepExplainer from './components/StepExplainer.jsx';
import ReferenceViewer from './components/ReferenceViewer.jsx';
import { solveOhmSeriesCircuit } from './circuit/circuitEngine.js';
import './App.css';

export default function App() {
  // Page Navigation State: 'landing' (Page One) | 'workspace' (Page Two)
  const [currentView, setCurrentView] = useState('landing');

  // Shared Circuit Parameters (defaults: 12 V and 4 Ω)
  const [voltage, setVoltage] = useState(12);
  const [resistance, setResistance] = useState(4);

  // Active Explanation Step (0 to 3)
  const [activeStep, setActiveStep] = useState(0);

  // Uploaded Image State (persisted across pages)
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // Reference Viewer Drawer State (in workspace)
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);

  // Derive circuit solution using pure engine logic
  const circuitResult = useMemo(() => {
    return solveOhmSeriesCircuit({ voltage, resistance });
  }, [voltage, resistance]);

  // Handle resetting back to standard circuit values
  const handleResetDefaults = () => {
    setVoltage(12);
    setResistance(4);
    setActiveStep(0);
  };

  // Handle returning to landing page for a new problem
  const handleNewProblem = () => {
    setCurrentView('landing');
    setIsReferenceOpen(false);
  };

  // Handle image upload and memory cleanup
  const handleImageSelected = (file, previewUrl) => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(file);
    setImagePreviewUrl(previewUrl);
  };

  // Handle image removal
  const handleImageRemoved = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    setIsReferenceOpen(false);
  };

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  // Keyboard navigation for step progression (ArrowLeft / ArrowRight)
  const handleKeyDown = useCallback(
    (e) => {
      if (currentView !== 'workspace') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'ArrowRight') {
        setActiveStep((prev) => Math.min(prev + 1, (circuitResult.steps?.length || 4) - 1));
      } else if (e.key === 'ArrowLeft') {
        setActiveStep((prev) => Math.max(prev - 1, 0));
      }
    },
    [currentView, circuitResult.steps]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="app-root">
      {currentView === 'landing' ? (
        /* PAGE ONE: LANDING AND UPLOAD */
        <LandingPage
          imageFile={imageFile}
          imagePreviewUrl={imagePreviewUrl}
          onImageSelected={handleImageSelected}
          onImageRemoved={handleImageRemoved}
          onContinueToWorkspace={() => setCurrentView('workspace')}
        />
      ) : (
        /* PAGE TWO: CIRCUIT LEARNING WORKSPACE */
        <div className="workspace-screen">
          {/* 1. Top Compact Header */}
          <WorkspaceHeader
            onNewProblem={handleNewProblem}
            onResetDefaults={handleResetDefaults}
            hasReferenceImage={Boolean(imagePreviewUrl)}
            isReferenceOpen={isReferenceOpen}
            onToggleReference={() => setIsReferenceOpen((prev) => !prev)}
          />

          {/* 2. Horizontal Circuit Parameters Strip */}
          <WorkspaceParametersStrip
            voltage={voltage}
            resistance={resistance}
            onVoltageChange={setVoltage}
            onResistanceChange={setResistance}
            error={circuitResult.error}
          />

          {/* 3. Horizontal Calculated Values Strip */}
          <WorkspaceCalculatedStrip circuitResult={circuitResult} />

          {/* 4. Main Two-Column Area: Circuit (55-60%) and Explanation (40-45%) Side by Side */}
          <main className="workspace-main-grid">
            <section className="circuit-column" aria-label="Circuit Schematic Visualisation">
              <CircuitDiagram
                circuitResult={circuitResult}
                activeStep={activeStep}
                onSelectStep={setActiveStep}
              />
            </section>

            <section className="explanation-column" aria-label="Step-by-Step Educational Explanation">
              <StepExplainer
                steps={circuitResult.steps}
                activeStep={activeStep}
                onStepChange={setActiveStep}
                isValid={circuitResult.isValid}
              />
            </section>
          </main>

          {/* Expandable Reference Diagram Drawer */}
          <ReferenceViewer
            isOpen={isReferenceOpen}
            onClose={() => setIsReferenceOpen(false)}
            imageFile={imageFile}
            imagePreviewUrl={imagePreviewUrl}
          />
        </div>
      )}
    </div>
  );
}
