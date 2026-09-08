import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { MobileNavDrawer } from './components/MobileNavDrawer';
import { Home } from './pages/Home';
import { PricingPage } from './pages/PricingPage';
import { DocsPage } from './pages/DocsPage';

/**
 * Three pages, no router library. `navigate` pushes history and scrolls to a
 * hash when one is given, so `/docs#install` and `/#how-it-works` work from
 * the nav and from external links alike.
 */
function App() {
  const [location, setLocation] = useState(window.location.pathname + window.location.hash);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onPop = () => setLocation(window.location.pathname + window.location.hash);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    // The target renders on the next frame after a route change.
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }));
  }, [location]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setLocation(path);
  };

  const pathname = location.split('#')[0];
  const page = pathname === '/pricing' ? <PricingPage navigate={navigate} /> : pathname === '/docs' ? <DocsPage /> : <Home navigate={navigate} />;

  return (
    <>
      <Navbar currentPath={pathname} navigate={navigate} onOpenMobileDrawer={() => setDrawerOpen(true)} />
      <MobileNavDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={navigate} />
      {page}
      <Footer navigate={navigate} />
    </>
  );
}

export default App;
