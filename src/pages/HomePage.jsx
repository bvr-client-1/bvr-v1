import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MobileMenu } from '../components/MobileMenu.jsx';

const reviewCards = [
  {
    author: 'Jeevan P.',
    time: 'Google - 3 weeks ago',
    text: 'Guests highlight the taste, clean cooking, polite staff, and a warm atmosphere that feels made for family dinners.',
  },
  {
    author: 'Kandukuri N.',
    time: 'Google - 2 weeks ago',
    text: 'The location, quick service, and biryani are getting special praise from first-time diners and regulars alike.',
  },
  {
    author: 'Poojitha',
    time: 'Public review - Jan 2026',
    text: 'Reviewers consistently call out flavorful biryani, fast service, and presentation that feels worth the visit.',
  },
  {
    author: 'Naveen Kumar',
    time: 'Public review - Sep 2025',
    text: 'Comfortable seating, friendly staff, and quick turnaround are common reasons people recommend the restaurant.',
  },
];

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
        <p className="fade-up fade-delay-1 hero-subtitle">Family Restaurant - Nalgonda</p>
        <p className="fade-up fade-delay-2 hero-copy">Authentic Telugu flavors, now at your fingertips.</p>
        <Link className="btn-gold fade-up fade-delay-3" to="/menu">
          Start Ordering
        </Link>
        <p className="fade-up fade-delay-4 hero-note">Scan QR at your table to order.</p>
      </section>

      <section className="section" id="about">
        <h2 className="section-title">Our Services</h2>
        <div className="services-scroll">
          <div className="service-card">
            <div className="service-icon">D</div>
            <h3>Dine In</h3>
            <p>Scan table QR and order instantly from your seat.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">H</div>
            <h3>Home Delivery</h3>
            <p>Order from anywhere, and we deliver to your door.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">C</div>
            <h3>Outdoor Catering</h3>
            <p>Events, functions, and party catering service.</p>
          </div>
        </div>

        <div className="about-showcase">
          <div className="about-copy-card">
            <span className="about-kicker">About Us</span>
            <h3 className="about-title">Loved in Nalgonda for biryani, hospitality, and family dining.</h3>
            <p className="about-description">
              Bangaru Vakili Family Restaurant brings together Telugu favorites, rich biryani plates,
              warm service, and a comfortable dine-in space right near Shivaji Nagar Circle.
            </p>
            <div className="about-highlights">
              <div>
                <strong>4.9/5</strong>
                <span>Public Google review rating snapshot</span>
              </div>
              <div>
                <strong>69+</strong>
                <span>Customer reviews surfaced publicly</span>
              </div>
              <div>
                <strong>11:45 AM - 11 PM</strong>
                <span>Daily service window</span>
              </div>
            </div>
          </div>

          <div className="about-map-card">
            <div className="map-card-header">
              <div>
                <span className="about-kicker">Visit Us</span>
                <h3 className="map-card-title">Near Shivaji Nagar Circle, Nalgonda</h3>
              </div>
              <a
                className="review-link"
                href="https://maps.app.goo.gl/n9FMSQ9tQxgsFgCC8"
                rel="noreferrer"
                target="_blank"
              >
                Review Us
              </a>
            </div>
            <div className="map-frame-wrap">
              <iframe
                className="map-frame"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps?q=Bangaru%20Vakili%20Family%20Restaurant%20Nalgonda&output=embed"
                title="Bangaru Vakili Family Restaurant Map"
              />
            </div>
          </div>
        </div>

        <div className="reviews-showcase">
          <div className="reviews-header">
            <div>
              <span className="about-kicker">Guest Reviews</span>
              <h3 className="reviews-title">What diners keep saying about BVR</h3>
            </div>
            <a
              className="review-link secondary"
              href="https://maps.app.goo.gl/n9FMSQ9tQxgsFgCC8"
              rel="noreferrer"
              target="_blank"
            >
              Open Maps
            </a>
          </div>

          <div className="review-summary-bar">
            <div className="review-brand">
              <div className="brand-badge">BVR</div>
              <div>
                <h4>Bangaru Vakili Family Restaurant</h4>
                <p>Shivaji Nagar Circle, Nalgonda</p>
              </div>
            </div>
            <div className="review-score">
              <strong>4.9</strong>
              <span>*****</span>
              <p>Based on public review listings</p>
            </div>
          </div>

          <div className="reviews-scroll">
            {reviewCards.map((review) => (
              <article className="review-card" key={review.author}>
                <div className="review-stars">*****</div>
                <p className="review-text">{review.text}</p>
                <div className="review-footer">
                  <div className="review-avatar">{review.author.charAt(0)}</div>
                  <div>
                    <strong>{review.author}</strong>
                    <span>{review.time}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="info-strip" id="contact">
        <div className="info-row">
          <div>Location: Shivaji Nagar Circle, Nalgonda - 508001</div>
          <div>
            Call: <a href="tel:7337334474">7337334474</a> / <a href="tel:9701054013">9701054013</a>
          </div>
          <div>Open: 11:45 AM - 11:00 PM</div>
        </div>
      </section>

      <footer className="footer">
        <p>Copyright 2026 BVR Bangaru Vakili Family Restaurant</p>
        <p>Powered by BVR Digital</p>
      </footer>
    </div>
  );
}
