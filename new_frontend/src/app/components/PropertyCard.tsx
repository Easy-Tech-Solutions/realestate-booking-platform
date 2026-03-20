import React, { useState } from 'react';
import { Heart, Star } from 'lucide-react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Property } from '../../core/types';
import { formatCurrency } from '../../core/utils';
import { useApp } from '../../core/context';
import { cn } from '../../core/utils';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface PropertyCardProps {
  property: Property;
}

export function PropertyCard({ property }: PropertyCardProps) {
  const { wishlistIds, toggleWishlist } = useApp();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const isWishlisted = wishlistIds.includes(property.id);

  const handlePrevImage = (e: React.MouseEvent) => {
    e.preventDefault();
    setCurrentImageIndex((prev) => 
      prev === 0 ? property.images.length - 1 : prev - 1
    );
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.preventDefault();
    setCurrentImageIndex((prev) => 
      prev === property.images.length - 1 ? 0 : prev + 1
    );
  };

  const handleWishlistToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleWishlist(property.id);
  };

  return (
    <Link to={`/rooms/${property.id}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="group cursor-pointer"
      >
        {/* Image Carousel */}
        <div className="relative aspect-square rounded-xl overflow-hidden mb-3">
          <ImageWithFallback
            src={property.images[currentImageIndex]}
            alt={property.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          
          {/* Wishlist Button */}
          <button
            onClick={handleWishlistToggle}
            className="absolute top-3 right-3 p-2 rounded-full bg-white/90 hover:bg-white hover:scale-110 transition-all z-10"
          >
            <Heart
              className={cn(
                "w-5 h-5 transition-colors",
                isWishlisted ? "fill-destructive text-destructive" : "text-foreground"
              )}
            />
          </button>

          {/* Image Navigation */}
          {property.images.length > 1 && (
            <>
              <button
                onClick={handlePrevImage}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <span className="text-lg">‹</span>
              </button>
              <button
                onClick={handleNextImage}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <span className="text-lg">›</span>
              </button>

              {/* Image Indicators */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                {property.images.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full transition-all",
                      index === currentImageIndex
                        ? "bg-white w-2 h-2"
                        : "bg-white/60"
                    )}
                  />
                ))}
              </div>
            </>
          )}

          {/* Badges */}
          <div className="absolute top-3 left-3 flex gap-2">
            {property.isSuperhost && (
              <div className="px-2 py-1 bg-white rounded-md text-xs font-semibold">
                Superhost
              </div>
            )}
            {property.instantBook && (
              <div className="px-2 py-1 bg-white rounded-md text-xs font-semibold">
                Instant Book
              </div>
            )}
          </div>
        </div>

        {/* Property Info */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">
                {property.location.city}, {property.location.state}
              </h3>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Star className="w-4 h-4 fill-current" />
              <span className="font-semibold">{property.rating.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-muted-foreground text-sm truncate">
            {property.title}
          </p>

          <p className="text-muted-foreground text-sm">
            {property.guests} guests · {property.bedrooms} bedroom{property.bedrooms > 1 ? 's' : ''} · {property.beds} bed{property.beds > 1 ? 's' : ''} · {property.bathrooms} bath{property.bathrooms > 1 ? 's' : ''}
          </p>

          <div className="pt-1">
            <span className="font-semibold">{formatCurrency(property.price)}</span>
            <span className="text-muted-foreground"> night</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
