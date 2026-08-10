import React from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface PricingPageProps {
  navigate: (path: string) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ navigate }) => {
  const tiers = [
    {
      name: 'Community',
      badge: 'Open Core (Free Forever)',
      price: '$0',
      period: 'forever free',
      description: 'The complete local-first workstation engine for individual software engineers.',
      cta: 'Get Started Free',
      ctaAction: () => navigate('/download'),
      highlight: false,
      features: [
        'Full local engine & offline execution',
        'Unlimited local agent sessions',
        'Hardened AST command safety guard',
        'Sandbox path traversal protection',
        'Multi-environment presets (Personal, Company, Client)',
        'Real-time Git subsystem & commit generator',
        'AST symbol parser & context indexer',
      ],
    },
    {
      name: 'Pro',
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
        'Machine-to-machine API keys',
        'Priority agent session recovery',
      ],
    },
    {
      name: 'Enterprise',
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
      <div style={{ textAlign: 'center', marginBottom: '64px' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#10b981',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '12px',
          }}
        >
          Commercial Strategy
        </div>
        <h1
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
          }}
        >
          Simple, Transparent Tier Breakdown
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.15rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
          Asterim Core is 100% open-source and free forever. Commercial tiers add cloud relay convenience, team governance, and security audit compliance.
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
            style={{
              background: tier.highlight ? 'radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.1), transparent 70%), #0f172a' : '#0f172a',
              border: tier.highlight ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '20px',
              padding: '40px 32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: tier.highlight ? '0 20px 40px rgba(16, 185, 129, 0.12)' : 'none',
              position: 'relative',
            }}
          >
            {tier.highlight && (
              <div
                style={{
                  position: 'absolute',
                  top: '-14px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#10b981',
                  color: '#042114',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '4px 14px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Most Popular
              </div>
            )}

            <div>
              <div style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 600, marginBottom: '8px' }}>
                {tier.badge}
              </div>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', marginBottom: '8px' }}>
                {tier.name}
              </h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '16px' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff' }}>{tier.price}</span>
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>/ {tier.period}</span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '28px' }}>
                {tier.description}
              </p>

              <button
                onClick={tier.ctaAction}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  background: tier.highlight ? 'linear-gradient(135deg, #34d399, #10b981)' : 'transparent',
                  border: tier.highlight ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
                  color: tier.highlight ? '#042114' : '#f8fafc',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '32px',
                  transition: 'all 0.15s ease',
                }}
              >
                {tier.cta} <ArrowRight size={16} />
              </button>

              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '24px' }}>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '16px' }}>
                  Included Capabilities:
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {tier.features.map((feat, fIdx) => (
                    <li key={fIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.5 }}>
                      <Check size={16} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
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
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '28px 32px',
          textAlign: 'center',
          color: '#94a3b8',
          fontSize: '0.9rem',
          maxWidth: '800px',
          margin: '0 auto',
        }}
      >
        💡 <strong style={{ color: '#f8fafc' }}>Presentation-Only Notice:</strong> Asterim is currently in Phase 4.5 release testing. Live SaaS billing transactions and Stripe checkout will open during Phase 5. Create an account today to reserve your spot for the public beta.
      </div>
    </div>
  );
};
