import React, { useEffect } from 'react';
import { Heart, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { PropertyCard } from '../components/PropertyCard';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../../services/api/shared/errors';
import { useFavoriteProperties } from '../../hooks/queries/useWishlists';

export function Wishlists() {
  const { isAuthenticated } = useApp();
  const navigate = useNavigate();
  const favoritesQuery = useFavoriteProperties(isAuthenticated);
  const wishlistedProperties = favoritesQuery.data || [];

  useEffect(() => {
    if (favoritesQuery.error) {
      toast.error(getErrorMessage(favoritesQuery.error, 'Failed to load favorites'));
    }
  }, [favoritesQuery.error]);

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-semibold">Wishlists</h1>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create wishlist
          </Button>
        </div>

        {favoritesQuery.isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading favorites...</div>
        ) : wishlistedProperties.length > 0 ? (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-2">Favorites</h2>
              <p className="text-muted-foreground">{wishlistedProperties.length} saved places</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 gap-y-6">
              {wishlistedProperties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-secondary flex items-center justify-center">
              <Heart className="w-16 h-16 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Create your first wishlist</h2>
            <p className="text-muted-foreground mb-6">
              As you search, click the heart icon to save your favorite places to stay
            </p>
            <Button onClick={() => navigate('/')}>Start exploring</Button>
          </div>
        )}
      </div>
    </div>
  );
}
