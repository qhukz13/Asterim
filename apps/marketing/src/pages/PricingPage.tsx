import React from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface PricingPageProps {
  navigate: (path: string) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ navigate }) => {
  const tiers = [
    {
      name: 'Community',
      status: 'AVAILABLE NOW',
      statusClass: 'available',
      badge: 'Open Core (Free Forever)',
      price: '$0',
      period: 'forever free',
      description: 'The complete local-first workstation control plane for individual software engineers.',
      cta: 'Download Engine',
      ctaAction: () => navigate('/download'),
      highlight: false,
      features: [
        'Full local engine & 100% offline execution',
        'Unlimited local agent sessions (Claude Code, Aider, Ollama)',
        'Hardened AST command safety guard & path traversal protection',
        'Multi-environment presets (Personal, Company, Client)',
        'Real-time Git subsystem & commit generator',
        'AST symbol parser & context indexer',
      ],
    },
    {
      name: 'Pro',
      status: 'BETA / COMING SOON',
      statusClass: 'beta',
      badge: 'Individual Power Users',
      price: '$20',
      period: 'per month (static info)',
      description: 'Convenience cloud features, remote monitoring tunnels, and multi-device session sync.',
      cta: 'Join Public Beta',
      ctaAction: () => navigate('/account/register'),
      highlight: true,
      features: [
        'Everything in Community tier',
        'E2E encrypted cloud relay tunnel',
        'Mobile push notification approval prompts',
        'Cross-device active session sync',
        'Machine-to-machine API key management',
        'Priority agent session recovery',
      ],
    },
    {
      name: 'Enterprise',
      status: 'PLANNED',
      statusClass: 'planned',
      badge: 'Organizations & Teams',
      price: 'Custom',
      period: 'per seat / annual',
      description: 'Granular team governance, immutable security audit streams, and custom relay deployments.',
      cta: 'Contact Sales',
      ctaAction: () => (window.location.href = 'mailto:enterprise@asterim.dev?subject=Asterim%20Enterprise%20Inquiry'),
      highlight: false,
      features: [
        'Everything in Pro tier',
        'SAML / SSO identity provider integration',
        'Immutable security event audit streams',
        'Role-based access control (RBAC)',
        'On-premise cloud relay tunnel options',
        'Dedicated SLA & custom support',
      ],
    },
  ];

  return (
    <div
      style={{
        padding: '64px 24px 96px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Header */}
      <div className="section-header">
        <span className="section-tag">Commercial Strategy</span>
        <h1 className="section-title">Transparent Tier Breakdown</h1>
        <p className="section-lead">
          Asterim gives you the system to control your AI coding agents. Core is 100% open-source and free forever. Commercial tiers unlock convenience features and team governance.
        </p>
      </div>

      {/* Pricing Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '32px',
          marginBottom: '64px',
        }}
      >
        {tiers.map((tier, idx) => (
          <div
            key={idx}
            className="surface-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              borderColor: tier.highlight ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)',
              background: tier.highlight ? 'radial-gradient(circle at 50% 0%, var(--accent-green-subtle), transparent 70%), var(--bg-surface)' : 'var(--bg-surface)',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ color: 'var(--accent-green-hover)', fontSize: '0.8rem', fontWeight: 600 }}>
                  {tier.badge}
                </span>
                <span className={`status-badge ${tier.statusClass}`} style={{ fontSize: '0.65rem' }}>
                  {tier.status}
                </span>
              </div>

              <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
                {tier.name}
              </h3>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '16px' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{tier.price}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>/ {tier.period}</span>
              </div>

              {/* min-height keeps the CTA row aligned across tiers regardless of
                  how long each description runs. */}
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '28px', minHeight: '4.2rem' }}>
                {tier.description}
              </p>

              <button
                onClick={tier.ctaAction}
                className={tier.highlight ? 'btn-primary' : 'btn-secondary'}
                style={{ width: '100%', marginBottom: '32px' }}
              >
                <span>{tier.cta}</span>
                <ArrowRight size={16} />
              </button>

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '24px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '16px' }}>
                  Control Plane Capabilities:
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {tier.features.map((feat, fIdx) => (
                    <li key={fIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.5 }}>
                      <Check size={16} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: '2px' }} />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Scope Disclaimer Box */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 32px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          maxWidth: '800px',
          margin: '0 auto',
        }}
      >
        💡 <strong style={{ color: 'var(--text-primary)' }}>Presentation-Only Notice:</strong> Asterim is currently in Phase 4.5 release testing. Live SaaS billing transactions and Stripe checkout will open during Phase 5. Create an account today to reserve your spot for the public beta.
      </div>
    </div>
  );
};
