import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MobileMenu } from '../components/MobileMenu.jsx';

export default function HomePage() {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="brand-link" to="/">
            <div className="brand-badge">BVR</div>
            <span className="brand-text">BVR</span>
          </Link>
          {desktop ? (
            <div className="desktop-nav">
              <Link className="nav-active" to="/">
                Home
              </Link>
              <Link to="/menu">Menu</Link>
              <a href="#about">About</a>
              <a href="#contact">Contact</a>
            </div>
          ) : (
            <button
              aria-label="Open menu"
              className="hamburger"
              onClick={() => setOpen(true)}
              type="button"
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </nav>

      <MobileMenu onClose={() => setOpen(false)} open={open} />

      <section className="hero-bg">
        <div className="hero-badge fade-up">BVR</div>
        <h1 className="fade-up fade-delay-1 hero-title">Bangaru Vakili</h1>
        <p className="fade-up fade-delay-1 hero-subtitle">Family Restaurant · Nalgonda</p>
        <p className="fade-up fade-delay-2 hero-copy">Authentic Telugu Flavors, Now at Your Fingertips</p>
        <Link className="btn-gold fade-up fade-delay-3" to="/menu">
          🍽️ Start Ordering
        </Link>
        <p className="fade-up fade-delay-4 hero-note">Scan QR at your table to order</p>
      </section>

      <section className="section" id="about">
        <h2 className="section-title">Our Services</h2>
        <div className="services-scroll">
          <div className="service-card">
            <div className="service-icon">🪑</div>
            <h3>Dine In</h3>
            <p>Scan table QR and order instantly from your seat</p>
          </div>
          <div className="service-card">
            <div className="service-icon">🛵</div>
            <h3>Home Delivery</h3>
            <p>Order from anywhere, we deliver to your door</p>
          </div>
          <div className="service-card">
            <div className="service-icon">🎪</div>
            <h3>Outdoor Catering</h3>
            <p>Events, functions and party catering service</p>
          </div>
        </div>
      </section>

      <section className="info-strip" id="contact">
        <div className="info-row">
          <div>📍 Shivaji Nagar Circle, Nalgonda - 508001</div>
          <div>
            📞 <a href="tel:7337334474">7337334474</a> / <a href="tel:9701054013">9701054013</a>
          </div>
          <div>⏰ Open: 11:45 AM - 11:00 PM</div>
        </div>
      </section>

      <footer className="footer">
        <p>© 2026 BVR Bangaru Vakili Family Restaurant</p>
        <p>Powered by BVR Digital</p>
      </footer>
    </div>
  );
}
