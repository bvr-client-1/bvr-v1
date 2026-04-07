import Link from 'next/link';
import { termsMeta, termsSections } from '../../src/content/terms.js';

export const metadata = {
  title: 'Terms & Conditions | BVR Bangaru Vakili Family Restaurant',
  description: 'Read the official terms and conditions for ordering from BVR Bangaru Vakili Family Restaurant, Nalgonda.',
};

export default function TermsPage() {
  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="back-link" href="/">
            <span>{'\u2190'}</span>
            <span>Home</span>
          </Link>
          <h1 className="page-title">Terms & Conditions</h1>
          <a className="logout-link" href="/BVR_Terms_and_Conditions.pdf" target="_blank" rel="noreferrer">
            PDF
          </a>
        </div>
      </nav>

      <main className="terms-main">
        <section className="terms-hero-card">
          <div className="status-control-label">Legal Documentation</div>
          <h2>{termsMeta.restaurant}</h2>
          <p>{termsMeta.address}</p>
          <p>{termsMeta.phones.join(' / ')}</p>
          <div className="terms-meta-row">
            <span>Effective Date: {termsMeta.effectiveDate}</span>
            <span>Document Version: {termsMeta.version}</span>
            <span>Last Updated: {termsMeta.lastUpdated}</span>
          </div>
          <div className="terms-action-row">
            <a className="btn-gold inline-button" href="/BVR_Terms_and_Conditions.pdf" target="_blank" rel="noreferrer">
              Open PDF
            </a>
            <a className="review-link secondary" download href="/BVR_Terms_and_Conditions.pdf">
              Download PDF
            </a>
          </div>
        </section>

        <section className="terms-shell">
          {termsSections.map((section) => (
            <article className="terms-card" key={section.title}>
              <h3>{section.title}</h3>

              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}

              {section.bullets?.length ? (
                <ul className="terms-list">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}

              {section.subsections?.map((subsection) => (
                <div className="terms-subsection" key={subsection.title}>
                  <h4>{subsection.title}</h4>
                  {subsection.paragraphs?.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {subsection.bullets?.length ? (
                    <ul className="terms-list">
                      {subsection.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
