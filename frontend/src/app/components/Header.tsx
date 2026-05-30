import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, Menu, User, Heart, MessageSquare, Home as HomeIcon, Settings, LogOut, UserCircle, Bell, LayoutDashboard, Info, HelpCircle, Mail } from 'lucide-react';
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
import { authAPI, usersAPI } from '../../services/api.service';
import { toast } from 'sonner';

export function Header() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, setUser } = useApp();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isBecomingHost, setIsBecomingHost] = useState(false);

  const handleAuthClick = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setShowAuthDialog(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleBecomeHost = async () => {
    if (!isAuthenticated) {
      // Match the "List Your Property" CTA: first-time clickers most likely
      // don't have an account, so default to signup. The dialog has a built-in
      // "Already have an account? Log in" link for returning users.
      handleAuthClick('register');
      return;
    }

    if (user?.isHost) {
      navigate('/host');
      return;
    }

    setIsBecomingHost(true);
    try {
      await usersAPI.updateMyProfile({ role: 'agent' });
      const refreshedUser = await authAPI.getCurrentUser();
      setUser(refreshedUser);
      toast.success('You are now a host. Welcome to hosting!');
      navigate('/host');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to switch to host right now. Please try again.');
    } finally {
      setIsBecomingHost(false);
    }
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
                  onClick={user?.isHost ? () => navigate('/host') : handleBecomeHost}
                  disabled={isBecomingHost}
                >
                  {user?.isHost ? 'Switch to hosting' : isBecomingHost ? 'Setting up host...' : 'Become a host'}
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
        onClose={() => setShowAuthDialog(false)}
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
