import React from 'react';
import { Heart, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { PropertyCard } from '../components/PropertyCard';
import { mockProperties } from '../../services/mock-data';
import { useApp } from '../../core/context';
import { useNavigate } from 'react-router';

export function Wishlists() {
  const { wishlistIds } = useApp();
  const navigate = useNavigate();
  const wishlistedProperties = mockProperties.filter(p => wishlistIds.includes(p.id));

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

        {wishlistedProperties.length > 0 ? (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-2">Favorites</h2>
              <p className="text-muted-foreground">{wishlistedProperties.length} saved places</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 gap-y-8">
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
