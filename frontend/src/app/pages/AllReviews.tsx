import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Star, ChevronDown, BadgeCheck, MessageSquare, Loader2 } from 'lucide-react';
import { reviewsAPI } from '../../services/api/reviews';
import type { Review } from '../../core/types';
import { cn } from '../../core/utils';

type Ordering = '-created_at' | 'created_at' | '-rating' | 'rating';

const SORT_OPTIONS: { label: string; value: Ordering }[] = [
  { label: 'Newest first', value: '-created_at' },
  { label: 'Oldest first', value: 'created_at' },
  { label: 'Highest rated', value: '-rating' },
  { label: 'Lowest rated', value: 'rating' },
];

const PAGE_SIZE = 12;

function StarRow({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn('w-4 h-4', i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30')}
        />
      ))}
    </div>
  );
}

function SubRatingBar({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="w-4 text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(false);
  const initials = (review.user.firstName.charAt(0) || '?').toUpperCase();
  const commentLong = review.comment && review.comment.length > 220;
  const displayComment = commentLong && !expanded ? review.comment.slice(0, 220) + '…' : review.comment;

  const hasSubRatings = review.cleanliness || review.accuracy || review.checkIn ||
    review.communication || review.location || review.value;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {review.user.avatar ? (
            <img src={review.user.avatar} alt={review.user.firstName} className="w-10 h-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
              {initials}
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm">{review.user.firstName}</p>
              {review.isVerified && (
                <BadgeCheck className="w-3.5 h-3.5 text-primary" title="Verified stay" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(review.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        <StarRow rating={review.rating} />
      </div>

      {/* Property link */}
      {review.listingTitle && (
        <Link
          to={`/rooms/${review.propertyId}`}
          className="text-xs font-medium text-primary hover:underline truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {review.listingTitle}
        </Link>
      )}

      {/* Review title */}
      {review.title && <p className="font-semibold text-sm">{review.title}</p>}

      {/* Comment */}
      {review.comment && (
        <div>
          <p className="text-sm text-foreground leading-relaxed">{displayComment}</p>
          {commentLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-primary font-medium mt-1 hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Sub-ratings */}
      {hasSubRatings && (
        <div className="space-y-1.5 pt-1 border-t border-border">
          <SubRatingBar label="Cleanliness" value={review.cleanliness} />
          <SubRatingBar label="Accuracy" value={review.accuracy} />
          <SubRatingBar label="Check-in" value={review.checkIn} />
          <SubRatingBar label="Communication" value={review.communication} />
          <SubRatingBar label="Location" value={review.location} />
          <SubRatingBar label="Value" value={review.value} />
        </div>
      )}

      {/* Host response */}
      {review.response && (
        <div className="bg-muted/50 rounded-xl p-3 text-sm">
          <p className="font-semibold text-xs mb-1 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Host response
          </p>
          <p className="text-muted-foreground leading-relaxed">{review.response}</p>
        </div>
      )}
    </div>
  );
}

export function AllReviews() {
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [ordering, setOrdering] = useState<Ordering>('-created_at');
  const [page, setPage] = useState(1);
  const [allReviews, setAllReviews] = useState<Review[]>([]);

  const query = useQuery({
    queryKey: ['all-reviews', minRating, ordering, page],
    queryFn: () => reviewsAPI.getAll({ page, minRating, ordering }),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (query.data) {
      if (page === 1) {
        setAllReviews(query.data.results);
      } else {
        setAllReviews((prev) => [...prev, ...query.data!.results]);
      }
    }
  }, [query.data, page]);

  const totalCount = query.data?.count ?? 0;
  const hasMore = allReviews.length < totalCount;

  const avgRating = allReviews.length
    ? (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1)
    : null;

  function applyFilter(newRating: number | undefined, newOrdering: Ordering) {
    setMinRating(newRating);
    setOrdering(newOrdering);
    setPage(1);
    setAllReviews([]);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-background to-background border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-14">
          <h1 className="text-4xl font-semibold mb-3">Guest Reviews</h1>
          <p className="text-muted-foreground text-lg max-w-xl">
            Real experiences shared by guests across all HomeKonet properties.
          </p>
          {totalCount > 0 && (
            <div className="flex items-center gap-4 mt-6">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                <span className="text-2xl font-bold">{avgRating}</span>
                <span className="text-muted-foreground text-sm">average</span>
              </div>
              <div className="w-px h-6 bg-border" />
              <span className="text-muted-foreground text-sm">
                <span className="text-foreground font-semibold">{totalCount.toLocaleString()}</span> reviews
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-3 flex flex-wrap items-center gap-3">
          {/* Star filter chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground mr-1">Filter:</span>
            {[undefined, 5, 4, 3, 2, 1].map((r) => (
              <button
                key={r ?? 'all'}
                onClick={() => applyFilter(r, ordering)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                  minRating === r
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                )}
              >
                {r ? `${r}★+` : 'All'}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="ml-auto relative">
            <select
              value={ordering}
              onChange={(e) => applyFilter(minRating, e.target.value as Ordering)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-10">
        {query.isLoading && page === 1 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 bg-muted rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : allReviews.length === 0 ? (
          <div className="text-center py-24">
            <Star className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg font-semibold mb-1">No reviews yet</p>
            <p className="text-muted-foreground text-sm">
              {minRating ? `No reviews with ${minRating}★ or above.` : 'Be the first to leave a review!'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {allReviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>

            {hasMore && (
              <div className="text-center mt-10">
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={query.isFetching}
                  className="px-8 py-3 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto"
                >
                  {query.isFetching ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  ) : (
                    `Load more (${totalCount - allReviews.length} remaining)`
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
