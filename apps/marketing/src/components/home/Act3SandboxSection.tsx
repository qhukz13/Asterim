import React from 'react';
import { AsterimWorkstationSandbox } from './AsterimWorkstationSandbox';

export const Act3SandboxSection: React.FC = () => {
  return (
    <section id="workstation-sandbox" className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">ACT 3 // INTERACTIVE WORKSTATION SANDBOX</span>
        <h2 className="section-title">Experience the Workstation.</h2>
        <p className="section-lead">
          Test real product capabilities live in your browser. Click through live agent streams, approve an AST security clearance, switch environment scopes, and monitor multi-agent telemetry.
        </p>
      </div>

      <AsterimWorkstationSandbox />
    </section>
  );
};
