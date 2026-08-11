import React from 'react';
import { IconLock, IconShield, IconCheck } from '../common/MarketingIcons';

export const Act5EnvironmentSection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">ACT 5 // SCOPED ENVIRONMENTS &amp; ZERO-LEAK ISOLATION</span>
        <h2 className="section-title">Strict Boundaries for Every Project.</h2>
        <p className="section-lead">
          Never leak corporate secrets, client API keys, or private workspace paths. Asterim automatically scopes environment variables, secret enclaves, and file system boundaries per workspace.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        <div style={{ background: '#0d1424', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <IconLock size={20} color="#10b981" />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>Enclave Secret Scoping</h3>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6' }}>
            Secrets are decrypted only in-memory inside the active workstation process. Agents receive masked reference pointers, preventing accidental token exposure in chat logs.
          </p>
        </div>

        <div style={{ background: '#0d1424', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <IconShield size={20} color="#10b981" />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>Project Jail Boundaries</h3>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6' }}>
            Each agent thread is constrained to its designated repository root. Attempts to traverse outside the workspace tree (`cd ../..`) are automatically intercepted and blocked.
          </p>
        </div>

        <div style={{ background: '#0d1424', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <IconCheck size={20} color="#10b981" />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>Preset Profile Switching</h3>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6' }}>
            Seamlessly toggle between Personal, Company, and Client profiles. Switching workspace presets immediately swaps active secret enclaves and attached MCP tool configs.
          </p>
        </div>
      </div>
    </section>
  );
};
