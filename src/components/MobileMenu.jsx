import { Link } from 'react-router-dom';

export function MobileMenu({ open, onClose }) {
  return (
    <>
      <div className={`mobile-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`mobile-menu ${open ? 'open' : ''}`}>
        <button className="close-button" onClick={onClose} type="button">
          ×
        </button>
        <div className="mobile-menu-links">
          <Link onClick={onClose} to="/">
            🏠 Home
          </Link>
          <Link onClick={onClose} to="/menu">
            🍽️ Menu
          </Link>
          <a href="#about" onClick={onClose}>
            ℹ️ About
          </a>
          <a href="#contact" onClick={onClose}>
            📞 Contact
          </a>
        </div>
      </div>
    </>
  );
}
