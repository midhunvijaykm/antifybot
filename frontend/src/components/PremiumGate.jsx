import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2, ArrowRight } from 'lucide-react';
import './PremiumGate.css';

const PremiumGate = ({
  locked = false,
  featureName = 'Premium Feature',
  description = 'This advanced module is locked.',
  benefits = [],
  freeLimit = '',
  children
}) => {
  const navigate = useNavigate();

  // If not locked, render contents directly
  if (!locked) {
    return <>{children}</>;
  }

  return (
    <div className="premium-gate-container">
      {/* Blurred background of children to make it feel rich and premium */}
      <div className="premium-gate-background-blur">
        {children}
      </div>
      
      {/* Lock Card Overlay */}
      <div className="premium-gate-overlay">
        <div className="premium-gate-card glass">
          <div className="premium-gate-icon-wrapper">
            <Lock className="premium-gate-icon" />
          </div>
          
          <h2 className="premium-gate-title">
            {featureName}
          </h2>
          <p className="premium-gate-pro-badge">ANTIFY PRO FEATURE</p>
          
          <p className="premium-gate-description">
            {description}
          </p>
          
          {freeLimit && (
            <div className="premium-gate-limit-box">
              <span className="limit-label">Current Free Limit:</span>
              <span className="limit-value">{freeLimit}</span>
            </div>
          )}
          
          {(benefits || []).length > 0 && (
            <div className="premium-gate-benefits">
              <p className="benefits-title">What you unlock with ANTIFY PRO:</p>
              <ul className="benefits-list">
                {(benefits || []).map((benefit, i) => (
                  <li key={i} className="benefit-item">
                    <CheckCircle2 className="benefit-icon" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <button 
            className="premium-gate-button"
            onClick={() => navigate('/premium')}
          >
            Upgrade to ANTIFY PRO
            <ArrowRight className="button-icon" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PremiumGate;
