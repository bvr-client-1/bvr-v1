'use client';

import Link from 'next/link';

export function MobileMenu({ open, onClose }) {
  return (
    <>
      <div className={`mobile-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`mobile-menu ${open ? 'open' : ''}`}>
        <button className="close-button" onClick={onClose} type="button">
          ×
        </button>
        <div className="mobile-menu-links">
          <Link onClick={onClose} href="/">
            Home
          </Link>
          <Link onClick={onClose} href="/menu">
            Menu
          </Link>
          <a href="#about" onClick={onClose}>
            About
          </a>
          <a href="#faq" onClick={onClose}>
            FAQ
          </a>
          <a href="#feedback" onClick={onClose}>
            Feedback
          </a>
          <a href="#contact" onClick={onClose}>
            Contact
          </a>
          <Link onClick={onClose} href="/status">
            Track Order
          </Link>
          <Link onClick={onClose} href="/terms">
            Terms
          </Link>
        </div>
      </div>
    </>
  );
}
