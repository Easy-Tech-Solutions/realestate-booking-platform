import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, Menu, User, Heart, MessageSquare, Home as HomeIcon, Settings, LogOut, UserCircle, Bell, LayoutDashboard } from 'lucide-react';
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
      handleAuthClick('login');
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
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <HomeIcon className="w-5 h-5 text-white" />
              </div>
              <span className="hidden sm:block text-xl font-semibold text-primary">HomeKonnet</span>
            </Link>

            {/* Search Bar - Desktop */}
            <button
              onClick={() => setShowSearchDialog(true)}
              className="hidden md:flex items-center gap-4 px-6 py-3 border border-border rounded-full shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            >
              <span className="text-sm font-medium">Anywhere</span>
              <div className="w-px h-6 bg-border" />
              <span className="text-sm font-medium">Any week</span>
              <div className="w-px h-6 bg-border" />
              <span className="text-sm text-muted-foreground">Add guests</span>
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                <Search className="w-4 h-4 text-white" />
              </div>
            </button>

            {/* Search Icon - Mobile */}
            <button
              type="button"
              title="Search"
              onClick={() => setShowSearchDialog(true)}
              className="md:hidden p-2 rounded-full hover:bg-muted"
            >
              <Search className="w-5 h-5" />
            </button>

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
                        My Trips
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
                    </>
                  )}
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
