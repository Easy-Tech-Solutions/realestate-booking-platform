// inventory — the pieces other apps import (listing-moderation detectors).

export { runAllDetectors as runListingDetectors, detectDuplicateListings, detectPriceAnomalies, createListingFlag } from '../apps/inventory/detection.js';
