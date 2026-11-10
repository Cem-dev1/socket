import './globals.css';

export const metadata = {
  title: 'Stuck Voice Hub',
  description: 'Discord-like Voice & Screen Share App',
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}