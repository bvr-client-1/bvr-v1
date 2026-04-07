import '../src/styles.css';
import { AppProviders } from '../src/components/AppProviders.jsx';

export const metadata = {
  title: 'BVR Bangaru Vakili Family Restaurant - Nalgonda',
  description:
    'Authentic Telugu flavors at BVR Bangaru Vakili Family Restaurant, Nalgonda. Dine-in, delivery and catering. Order now!',
  openGraph: {
    title: 'BVR Bangaru Vakili Family Restaurant',
    description: 'Order fresh Telugu food online from Bangaru Vakili Family Restaurant in Nalgonda.',
    url: 'https://www.bangaruvakili.com',
    type: 'website',
    images: ['https://www.bangaruvakili.com/bvr-logo.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BVR Bangaru Vakili Family Restaurant',
    description: 'Order fresh Telugu food online from Bangaru Vakili Family Restaurant in Nalgonda.',
    images: ['https://www.bangaruvakili.com/bvr-logo.png'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
