import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, Menu, User, Heart, MessageSquare, Home as HomeIcon, Settings, LogOut, UserCircle, Bell, LayoutDashboard, Info, HelpCircle, Mail, CalendarCheck } from 'lucide-react';
import logo from '../../assets/logo2.jpg';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useApp } from '../../hooks/useApp';
import { AuthDialog } from './AuthDialog';
import { SearchDialog } from './SearchDialog';
import { getInitials } from '../../core/utils';

export function Header() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useApp();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  // Remember a "become a host" intent so we can route the user after they
  // finish logging in / signing up via the dialog.
  const [pendingHostRedirect, setPendingHostRedirect] = useState(false);

  useEffect(() => {
    if (pendingHostRedirect && isAuthenticated && user) {
      setPendingHostRedirect(false);
      navigate(user.isHost ? '/host' : '/become-a-host');
    }
  }, [pendingHostRedirect, isAuthenticated, user, navigate]);

  const handleAuthClick = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setShowAuthDialog(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleBecomeHost = () => {
    if (!isAuthenticated) {
      // Open the signup dialog; the effect above routes them once authed.
      // First-time clickers most likely don't have an account, so default to
      // signup — the dialog has an "Already have an account? Log in" link.
      setAuthMode('register');
      setPendingHostRedirect(true);
      setShowAuthDialog(true);
      return;
    }
    // Hosts go to their dashboard; regular users start the host application.
    // Becoming a host now goes through the review flow, not instant promotion.
    navigate(user?.isHost ? '/host' : '/become-a-host');
  };

  return (
    <>
      <header className="sticky top-0 z-50 bg-white border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="HomeKonet" className="h-10 w-auto" />
            </Link>

            {/* Search Button - Desktop */}
            <button
              onClick={() => setShowSearchDialog(true)}
              className="hidden md:flex items-center gap-3 px-5 py-2.5 bg-primary text-white rounded-full shadow-md hover:bg-primary/90 hover:shadow-lg transition-all cursor-pointer group"
            >
              <Search className="w-4 h-4" />
              <span className="text-sm font-semibold">Find Your Stay</span>
            </button>

            {/* Search Icon - Mobile */}
            <button
              type="button"
              title="Search"
              onClick={() => setShowSearchDialog(true)}
              className="md:hidden w-9 h-9 bg-primary text-white rounded-full flex items-center justify-center hover:bg-primary/90 transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Nav links - Desktop */}
            <nav className="hidden lg:flex items-center gap-1">
              <Link to="/about" className="px-3 py-2 text-sm font-medium text-foreground/70 hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                About
              </Link>
              <Link to="/faq" className="px-3 py-2 text-sm font-medium text-foreground/70 hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                FAQ
              </Link>
              <Link to="/contact" className="px-3 py-2 text-sm font-medium text-foreground/70 hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                Contact Us
              </Link>
            </nav>

            {/* Right Menu */}
            <div className="flex items-center gap-2">
              {isAuthenticated && (
                <Button
                  variant="ghost"
                  className="hidden sm:inline-flex"
                  onClick={handleBecomeHost}
                >
                  {user?.isHost ? 'Switch to hosting' : 'Become a host'}
                </Button>
              )}

              {isAuthenticated && (
                  <button
                    type="button"
                    title="View notifications"
                    onClick={() => navigate('/notifications')}
                    className="hidden sm:flex p-2 rounded-full hover:bg-muted relative"
                  >
                    <Bell className="w-5 h-5" />
                  </button>
                )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 px-3 py-2 border border-border rounded-full hover:shadow-md transition-shadow">
                    <Menu className="w-4 h-4" />
                    {isAuthenticated && user ? (
                      user.avatar ? (
                        <img
                          src={user.avatar}
                          alt={user.firstName}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold">
                          {getInitials(user.firstName, user.lastName)}
                        </div>
                      )
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {isAuthenticated ? (
                    <>
                      <DropdownMenuItem onClick={() => navigate('/trips')}>
                        <HomeIcon className="w-4 h-4 mr-2" />
                        My Bookings
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/viewings')}>
                        <CalendarCheck className="w-4 h-4 mr-2" />
                        My Viewings
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/wishlists')}>
                        <Heart className="w-4 h-4 mr-2" />
                        Wishlists
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/messages')}>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Messages
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/notifications')}>
                        <Bell className="w-4 h-4 mr-2" />
                        Notifications
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Dashboard
                      </DropdownMenuItem>
                      {!user?.isHost && (
                        <DropdownMenuItem onClick={handleBecomeHost}>
                          <Settings className="w-4 h-4 mr-2" />
                          Become a host
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {user?.isHost && (
                        <>
                          <DropdownMenuItem onClick={() => navigate('/host')}>
                            <Settings className="w-4 h-4 mr-2" />
                            Host Dashboard
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem onClick={() => navigate('/account')}>
                        <UserCircle className="w-4 h-4 mr-2" />
                        Account
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleLogout}>
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleAuthClick('login')}>
                        <strong>Log in</strong>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAuthClick('register')}>
                        Sign up
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {/* Always visible on mobile (lg hides nav links) */}
                  <div className="lg:hidden">
                    <DropdownMenuItem onClick={() => navigate('/about')}>
                      <Info className="w-4 h-4 mr-2" />
                      About
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/faq')}>
                      <HelpCircle className="w-4 h-4 mr-2" />
                      FAQ
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/contact')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Contact Us
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <AuthDialog
        open={showAuthDialog}
        onClose={() => {
          setShowAuthDialog(false);
          // Abandoned the dialog without logging in → drop the host intent.
          if (!isAuthenticated) setPendingHostRedirect(false);
        }}
        mode={authMode}
        onModeChange={setAuthMode}
      />

      <SearchDialog
        open={showSearchDialog}
        onClose={() => setShowSearchDialog(false)}
      />
    </>
  );
}
