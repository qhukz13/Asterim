import React from 'react';
import { Check } from 'lucide-react';
import { DISCUSSIONS_URL, LICENSE } from '../site';

interface PricingPageProps {
  navigate: (path: string) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ navigate }) => {
  return (
    <main className="page">
      <div className="container">
        <span className="eyebrow">Pricing</span>
        <h1 className="section-title">Free, and honest about what comes next</h1>
        <p className="section-lead">
          The whole product is free and {LICENSE}-licensed. A paid tier exists only as a list of things
          people have asked for; it ships when the list is long enough.
        </p>
        <div className="plans">
          <div className="plan featured">
            <div className="plan-name">Asterim</div>
            <div className="plan-price">
              $0<small>no account</small>
            </div>
            <ul>
              {[
                'Claude Code adapter with the approval gate',
                'Antigravity adapter (best effort)',
                'Transcript, Terminal, Changes views',
                'Threads that resume after restart',
                'The record, in a SQLite file you own',
                'Sovereign mode: no outbound connections'
              ].map(item => (
                <li key={item}>
                  <Check size={14} />
                  {item}
                </li>
              ))}
            </ul>
            <a
              href="/docs#install"
              className="btn btn-primary"
              onClick={e => {
                e.preventDefault();
                navigate('/docs#install');
              }}
            >
              Install
            </a>
          </div>
          <div className="plan">
            <div className="plan-name">Pro (waitlist)</div>
            <div className="plan-price">
              TBD<small>expected $12 to $19 / month</small>
            </div>
            <ul>
              {[
                'Reach your workstation from outside your network',
                'More than one machine in one dashboard',
                'Priority support'
              ].map(item => (
                <li key={item}>
                  <Check size={14} />
                  {item}
                </li>
              ))}
            </ul>
            <div className="note">
              Nothing here is built for sale yet. When ten people have asked, it gets built and priced.
            </div>
            <a href={DISCUSSIONS_URL} className="btn" target="_blank" rel="noopener noreferrer">
              Ask for Pro
            </a>
          </div>
        </div>
      </div>
    </main>
  );
};
