import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Header from './components/Header.jsx';
import ImageUploader from './components/ImageUploader.jsx';
import CircuitControls from './components/CircuitControls.jsx';
import CircuitDiagram from './components/CircuitDiagram.jsx';
import StepExplainer from './components/StepExplainer.jsx';
import MetricsSummary from './components/MetricsSummary.jsx';
import { solveOhmSeriesCircuit } from './circuit/circuitEngine.js';
import './App.css';

export default function App() {
  // Shared Circuit Parameters (defaults: 12 V and 4 Ω)
  const [voltage, setVoltage] = useState(12);
  const [resistance, setResistance] = useState(4);

  // Active Explanation Step (0 to 3)
  const [activeStep, setActiveStep] = useState(0);

  // Uploaded Image State (for user reference)
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

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

  // Handle image upload with object URL management
  const handleImageSelected = (file, previewUrl) => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(file);
    setImagePreviewUrl(previewUrl);
  };

  // Handle image removal and cleanup
  const handleImageRemoved = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
  };

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
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight') {
        setActiveStep((prev) => Math.min(prev + 1, (circuitResult.steps?.length || 4) - 1));
      } else if (e.key === 'ArrowLeft') {
        setActiveStep((prev) => Math.max(prev - 1, 0));
      }
    },
    [circuitResult.steps]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="tutor-shell">
      <Header onResetDefaults={handleResetDefaults} />

      <main className="tutor-workspace">
        {/* AREA A: Compact Controls & Reference (Sidebar) */}
        <aside className="workspace-area area-controls" aria-label="Circuit Controls and Reference">
          <CircuitControls
            voltage={voltage}
            resistance={resistance}
            onVoltageChange={setVoltage}
            onResistanceChange={setResistance}
            error={circuitResult.error}
          />

          <MetricsSummary circuitResult={circuitResult} />

          <ImageUploader
            imageFile={imageFile}
            imagePreviewUrl={imagePreviewUrl}
            onImageSelected={handleImageSelected}
            onImageRemoved={handleImageRemoved}
          />
        </aside>

        {/* AREA B: Circuit Visualisation (Side-by-side with Area C on desktop) */}
        <section className="workspace-area area-diagram" aria-label="Circuit Visualisation">
          <CircuitDiagram
            circuitResult={circuitResult}
            activeStep={activeStep}
            onSelectStep={setActiveStep}
          />
        </section>

        {/* AREA C: Step-by-Step Explanation (Side-by-side with Area B on desktop) */}
        <section className="workspace-area area-explainer" aria-label="Step-by-Step Explanation">
          <StepExplainer
            steps={circuitResult.steps}
            activeStep={activeStep}
            onStepChange={setActiveStep}
            isValid={circuitResult.isValid}
          />
        </section>
      </main>
    </div>
  );
}
