"""Rule-based listing-moderation signals. No ML model is wired in yet — see
ListingFlag.ai_score. Each detector is idempotent: it skips creating a flag
when an open flag already exists for the exact same signal."""
import statistics
from collections import defaultdict

from listings.models import Listing
from .models import ListingFlag

# ~1.1km per 0.01 degree of latitude — coarse enough to catch the same
# property re-listed a few metres off, not a general geo-fencing tool.
DUPLICATE_GRID_PRECISION = 3


def _open_flag_exists(flag_type, signal):
    return ListingFlag.objects.filter(
        flag_type=flag_type, status=ListingFlag.Status.OPEN, details__contains=signal,
    ).exists()


def _enqueue_scoring(flag):
    from aiscoring.tasks import score_listing_flag_task
    score_listing_flag_task.delay(flag.id)


def detect_duplicate_listings(min_group_size=2):
    """Groups live/pending listings by (rounded coordinates, property_type).
    Multiple distinct listings claiming the same spot is either the same host
    re-listing or two hosts claiming the same property — either way it needs
    a human look."""
    candidates = Listing.objects.filter(
        deleted_at__isnull=True,
        status__in=['pending_review', 'published'],
        latitude__isnull=False, longitude__isnull=False,
    ).select_related('owner')

    groups = defaultdict(list)
    for listing in candidates:
        key = (round(float(listing.latitude), DUPLICATE_GRID_PRECISION), round(float(listing.longitude), DUPLICATE_GRID_PRECISION), listing.property_type)
        groups[key].append(listing)

    created = []
    for (lat, lng, ptype), listings in groups.items():
        if len(listings) < min_group_size:
            continue
        ids = sorted(l.id for l in listings)
        if _open_flag_exists(ListingFlag.FlagType.DUPLICATE, str(ids)):
            continue
        titles = ', '.join(f'#{l.id} "{l.title}" (owner: {l.owner.username})' for l in listings)
        flag = ListingFlag.objects.create(
            listing=listings[0],
            flag_type=ListingFlag.FlagType.DUPLICATE,
            severity=ListingFlag.Severity.MEDIUM,
            details=f'{len(listings)} listings at nearly the same location ({ptype}) — listing IDs {ids}: {titles}',
        )
        created.append(flag)
        _enqueue_scoring(flag)
    return created


def detect_price_anomalies(min_samples=5, z_threshold=3.5):
    """Flags listings priced far outside the norm for their city + property
    type — either a pricing-abuse attempt or a data-entry mistake, both worth
    a human look before the listing goes live to guests.

    Uses a median/MAD-based robust z-score rather than mean/stdev: a single
    extreme outlier inflates its own population stdev enough to mask itself
    (e.g. one listing at 500x the going rate can still score under a z=3
    mean/stdev threshold in a small sample), whereas the median and MAD barely
    move when only one point in the group is extreme."""
    candidates = Listing.objects.filter(
        deleted_at__isnull=True,
        status__in=['pending_review', 'published'],
        price__gt=0,
    ).exclude(city='')

    groups = defaultdict(list)
    for listing in candidates:
        groups[(listing.city, listing.property_type)].append(listing)

    created = []
    for (city, ptype), listings in groups.items():
        if len(listings) < min_samples:
            continue
        prices = [float(l.price) for l in listings]
        median = statistics.median(prices)
        mad = statistics.median([abs(p - median) for p in prices])
        for listing, price in zip(listings, prices):
            if mad == 0:
                # More than half the group shares one price (common with
                # round-number pricing) — MAD collapses to zero and a z-score
                # is undefined. Fall back to a plain ratio check instead of
                # skipping the group entirely.
                if median == 0 or not (price >= median * 5 or price <= median / 5):
                    continue
                explanation = f'{price} vs city/type median {median:.2f} (ratio {price / median:.1f}x)'
            else:
                # 0.6745 makes MAD a consistent estimator of stdev for normal data.
                z = 0.6745 * (price - median) / mad
                if abs(z) < z_threshold:
                    continue
                explanation = f'{price} vs city/type median {median:.2f} (MAD {mad:.2f}) — robust z-score {z:.2f}'
            signal = f'listing #{listing.id}'
            if _open_flag_exists(ListingFlag.FlagType.PRICE_ANOMALY, signal):
                continue
            flag = ListingFlag.objects.create(
                listing=listing,
                flag_type=ListingFlag.FlagType.PRICE_ANOMALY,
                severity=ListingFlag.Severity.HIGH if (price >= median * 8 or (median and price <= median / 8)) else ListingFlag.Severity.MEDIUM,
                details=(
                    f'listing #{listing.id} "{listing.title}" priced {explanation} '
                    f'across {len(listings)} comparable listings in {city}'
                ),
            )
            created.append(flag)
            _enqueue_scoring(flag)
    return created


def run_all_detectors():
    return {
        'duplicate_listings': detect_duplicate_listings(),
        'price_anomalies': detect_price_anomalies(),
    }
