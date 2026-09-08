import { useState } from 'react';
import { Check, Star, Zap, ShieldCheck, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import Card from '../components/Card';
import Button from '../components/Button';
import './Premium.css';

const PricingCard = ({ tier, price, icon: Icon, features, isActivePlan, isPopular, onSubscribe, loading, _hasCheckoutOptions }) => {
  const [selectedProvider, setSelectedProvider] = useState('Stripe');

  return (
    <Card hoverEffect className={`pricing-card ${isPopular ? 'popular' : ''} ${isActivePlan ? 'active-border' : ''}`} glow={isPopular}>
      {isPopular && <div className="popular-badge">Most Popular</div>}
      
      <div className="pricing-header">
        <div className={`tier-icon ${tier.toLowerCase()}`}>
          <Icon size={24} />
        </div>
        <h2 className="tier-name">{tier}</h2>
        <div className="tier-price">
          <span className="amount">{tier === 'Basic' ? 'FREE' : `$${price}`}</span>
          {tier !== 'Basic' && <span className="period">/mo</span>}
        </div>
      </div>

      <div className="pricing-features">
        {(features || []).map((feature, i) => (
          <div key={i} className="feature-item">
            <Check size={18} className="check-icon" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      {tier !== 'Basic' && !isActivePlan && (
        <div className="provider-selector" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>SELECT CHECKOUT MOCK:</label>
          <select 
            value={selectedProvider} 
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-hover)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              outline: 'none'
            }}
          >
            <option value="Stripe">Stripe Checkout</option>
            <option value="PayPal">PayPal Checkout</option>
            <option value="DiscordStore">Discord Store</option>
          </select>
        </div>
      )}

      <Button 
        className="pricing-btn" 
        variant={isActivePlan ? 'secondary' : (isPopular ? 'primary' : 'outline')}
        onClick={() => !isActivePlan && onSubscribe(tier, selectedProvider)}
        disabled={loading || isActivePlan}
      >
        {isActivePlan ? 'Active Plan' : (loading ? 'Loading...' : `Buy with ${selectedProvider}`)}
      </Button>
    </Card>
  );
};

const Premium = () => {
  const { activeGuild, premium, premiumLoading, subscribeToPlan, user } = useStore();

  const handleSubscribe = async (tier, provider) => {
    const checkoutUrl = await subscribeToPlan(tier, provider);
    if (checkoutUrl) {
      window.open(checkoutUrl, '_blank');
    }
  };

  if (!activeGuild) {
    return (
      <div className="empty-dashboard-state">
        <h2>No Guild Selected</h2>
        <p>Please select a Discord server to review its subscription status.</p>
      </div>
    );
  }

  const isOwner = user && user.id === '1060801714187415552';
  const currentPlan = premium?.plan || 'Basic';

  return (
    <div className="premium-page">
      <div className="premium-header text-center">
        <h1 className="premium-title">
          {isOwner ? (
            <>Global Owner <span className="text-gradient-primary">Access Mode</span></>
          ) : (
            <>Upgrade to <span className="text-gradient-primary">ANTIFY Pro</span></>
          )}
        </h1>
        <p className="premium-subtitle">
          {isOwner 
            ? "Permanent premium licensing has been auto-authorized on all servers for the bot creator."
            : `Unlock advanced AI heuristics, VirusTotal threat database lookups, and OCR investigations for ${activeGuild.name}.`
          }
        </p>
      </div>

      {isOwner ? (
        <div className="owner-license-card glass" style={{
          maxWidth: '600px',
          margin: '40px auto 0',
          padding: '40px',
          borderRadius: '20px',
          textAlign: 'center',
          border: '1px solid var(--border-highlight)',
          boxShadow: 'var(--glow-purple)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid var(--accent-purple)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--glow-purple)',
            color: 'var(--accent-purple)'
          }}>
            <ShieldCheck size={32} />
          </div>
          
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>ANTIFY PRO+ Activated</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
            You are logged in as the Global Platform Owner. All feature gates, analytics charts, OCR scanner settings, moderation commands, and notifications tables are permanently unlocked.
          </p>
          <div style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.05)',
            padding: '8px 16px',
            borderRadius: '20px',
            border: '1px solid rgba(245, 158, 11, 0.15)',
            marginTop: '12px'
          }}>
            <Sparkles size={16} />
            <span>Developer Mode Bypass Enabled</span>
          </div>
        </div>
      ) : (
        <div className="pricing-grid">
          <PricingCard 
            tier="Basic"
            price="0"
            icon={Star}
            isActivePlan={currentPlan === 'Basic'}
            features={[
              '10 Image scans / day / server',
              '25 VirusTotal link queries / day',
              '5 Exportable threat reports / day',
              'Basic message spam scanner',
              'Auto-warn & timeout features',
              'Community support channel'
            ]}
            onSubscribe={handleSubscribe}
            loading={premiumLoading}
          />
          
          <PricingCard 
            tier="Pro"
            price="9.99"
            icon={Zap}
            isPopular
            isActivePlan={currentPlan === 'Pro'}
            features={[
              'Unlimited Image scans / day',
              'Unlimited VirusTotal requests',
              'Unlimited Threat reports & exports',
              'Unlock Threat Analytics charts',
              'Unlock Evidence Locker archives',
              'Unlock Moderation Center dashboard',
              'Unlock Advanced Notifications dropdown',
              'Access Real-Time threat activities feed',
              '24/7 Premium Discord support'
            ]}
            onSubscribe={handleSubscribe}
            loading={premiumLoading}
          />
        </div>
      )}
    </div>
  );
};

export default Premium;
