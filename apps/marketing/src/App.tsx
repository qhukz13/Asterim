import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { MobileNavDrawer } from './components/MobileNavDrawer';
import { HeroSection } from './components/home/HeroSection';
import { InteractiveProductDemo } from './components/home/InteractiveProductDemo';
import { WhyAsterimSection } from './components/home/WhyAsterimSection';
import { ProblemSolutionSection } from './components/home/ProblemSolutionSection';
import { CapabilitiesGrid } from './components/home/CapabilitiesGrid';
import { PlatformMatrixSection } from './components/home/PlatformMatrixSection';
import { OpenSourceSection } from './components/home/OpenSourceSection';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { AccountLayout } from './components/AccountLayout';
import { PricingPage } from './pages/PricingPage';
import { DownloadPage } from './pages/DownloadPage';
import { DocsPage } from './pages/DocsPage';

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname + window.location.search);
  const [user, setUser] = useState<any | null>(null);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname + window.location.search);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    // Check current session
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    navigate('/');
  };

  const pathname = currentPath.split('?')[0];

  // Route: Sign In
  if (pathname === '/account/login') {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <Login navigate={navigate} onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // Route: Register
  if (pathname === '/account/register') {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <Register navigate={navigate} onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // Route: Account Portal Subpages
  if (pathname.startsWith('/account')) {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <AccountLayout
          user={user}
          currentSubPath={pathname}
          navigate={navigate}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  // Dedicated Public Pages
  if (pathname === '/pricing') {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <PricingPage navigate={navigate} />
        <Footer navigate={navigate} />
      </div>
    );
  }

  if (pathname === '/docs') {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <DocsPage navigate={navigate} />
        <Footer navigate={navigate} />
      </div>
    );
  }

  if (pathname === '/download') {
    return (
      <div className="marketing-container">
        <Navbar
          currentPath={pathname}
          navigate={navigate}
          user={user}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />
        <MobileNavDrawer
          isOpen={isMobileDrawerOpen}
          onClose={() => setIsMobileDrawerOpen(false)}
          currentPath={pathname}
          navigate={navigate}
          user={user}
        />
        <DownloadPage />
        <Footer navigate={navigate} />
      </div>
    );
  }

  // Route: Default Landing Page (Home)
  return (
    <div className="marketing-container">
      <Navbar
        currentPath={pathname}
        navigate={navigate}
        user={user}
        onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
      />
      <MobileNavDrawer
        isOpen={isMobileDrawerOpen}
        onClose={() => setIsMobileDrawerOpen(false)}
        currentPath={pathname}
        navigate={navigate}
        user={user}
      />

      <HeroSection navigate={navigate} />
      <InteractiveProductDemo />
      <WhyAsterimSection />
      <ProblemSolutionSection />
      <CapabilitiesGrid />
      <PlatformMatrixSection />
      <OpenSourceSection />

      <Footer navigate={navigate} />
    </div>
  );
}

export default App;
