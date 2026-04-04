# StayBnB - Advanced Airbnb Clone

A production-ready, feature-rich vacation rental booking platform built with React, TypeScript, and modern web technologies.

## 🎨 Design & Theme
- **Primary Color**: Green (#00845B)
- **Secondary Color**: White
- **Design System**: Material 3 inspired with custom green theme
- **Responsive**: Fully responsive across all devices

## 🏗️ Architecture

### Clean Architecture Pattern
```
/src
├── /app                    # Application layer
│   ├── /components        # Reusable UI components
│   ├── /pages            # Page components
│   ├── /layouts          # Layout components
│   └── routes.tsx        # Route configuration
├── /core                  # Core business logic
│   ├── types.ts          # TypeScript interfaces
│   ├── constants.ts      # App constants
│   ├── utils.ts          # Utility functions
│   └── context.tsx       # Global state management
├── /services             # Service layer
│   ├── api.service.ts    # API integrations
│   └── mock-data.ts      # Mock data for development
└── /styles              # Global styles
```

## ✨ Features

### 1. Authentication System
- JWT-based login/register
- Google OAuth integration (UI ready)
- Persistent sessions
- Protected routes

### 2. Home Screen
- Dynamic search bar with location, dates, and guest selection
- Horizontal scrolling category filters
- Featured property listings
- Grid-based property cards with image carousels

### 3. Property Browsing
- **Search/Listing Page**
  - Advanced filters (price, type, amenities, rooms)
  - Map view toggle
  - Real-time search results
- **Property Details Page**
  - Full-screen image gallery
  - Host information with Superhost badges
  - Detailed amenities list
  - Interactive calendar for date selection
  - Review system with ratings breakdown
  - Location map placeholder
  - House rules and cancellation policies
  - Live pricing calculator

### 4. Booking System
- Date range picker with blocked dates
- Guest counter (adults, children, infants, pets)
- Real-time price calculation
  - Base price × nights
  - Cleaning fee
  - Service fee (14%)
  - Taxes (12%)
- Booking confirmation flow

### 5. Payment Integration (UI Ready)
- **Stripe** - Credit/Debit cards
- **PayPal** - Digital wallet
- **MTN Mobile Money** - Mobile payments
- Secure payment form with card details
- Payment method selection
- Price breakdown display

### 6. Messaging System
- Real-time chat interface (WebSocket ready)
- Conversation list with unread indicators
- Message history
- File attachment support (UI)
- Active status indicators

### 7. User Dashboard
- Upcoming trips
- Past trips
- Booking management
- Trip details and receipts

### 8. Host Dashboard
- Earnings overview with charts
- Active listings management
- Booking calendar
- Review management
- Performance metrics:
  - Total earnings
  - Monthly earnings
  - Total bookings
  - Average rating
  - Response rate

### 9. Additional Features
- **Wishlists**: Save favorite properties
- **Account Settings**: 
  - Profile management
  - Password & security
  - Payment methods
  - Notification preferences
- **Reviews & Ratings**: 6-category rating system
- **Property Categories**: 14+ categories (Beachfront, Cabins, Luxe, etc.)
- **Amenities**: 20+ filterable amenities
- **Cancellation Policies**: Flexible, Moderate, Strict, Super Strict

## 🛠️ Technology Stack

### Frontend
- **React 18.3** - UI library
- **TypeScript** - Type safety
- **React Router 7** - Navigation (Data Router pattern)
- **Tailwind CSS 4** - Styling
- **Motion (Framer Motion)** - Animations
- **Radix UI** - Accessible components
- **Lucide React** - Icons
- **Recharts** - Analytics charts
- **date-fns** - Date manipulation
- **React Day Picker** - Date selection
- **Leaflet** - Maps (ready for integration)

### State Management
- React Context API for global state
- Local storage for persistence
- Custom hooks for data fetching

### API Integration (Ready)
- RESTful API service layer
- JWT authentication
- WebSocket support for real-time features
- Mock data for development

## 📱 Advanced Airbnb Features Implemented

1. **Smart Search**
   - Location autocomplete ready
   - Flexible date selection
   - Guest type breakdown
   - Instant search results

2. **Property Discovery**
   - Category-based browsing
   - Infinite scroll ready
   - Image carousels with indicators
   - Wishlist integration

3. **Trust & Safety**
   - Superhost badges
   - Verified user indicators
   - Review system with detailed ratings
   - Instant Book option

4. **Booking Experience**
   - Calendar blocking for booked dates
   - Clear price breakdown
   - Special requests
   - Ground rules agreement

5. **Host Tools**
   - Performance analytics
   - Earnings tracking
   - Booking management
   - Guest communication

6. **User Experience**
   - Smooth animations
   - Loading states
   - Toast notifications
   - Responsive design
   - Accessible components

## 🎯 Production-Ready Features

- ✅ TypeScript for type safety
- ✅ Clean architecture with separation of concerns
- ✅ Reusable component library
- ✅ Error handling
- ✅ Loading states
- ✅ Form validation
- ✅ Responsive design
- ✅ SEO-friendly structure
- ✅ Accessibility (ARIA labels, keyboard navigation)
- ✅ Performance optimized
- ✅ Code organization and modularity

## 🚀 Backend Integration Points

The frontend is ready to connect to a Django backend with these endpoints:

- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/google` - Google OAuth
- `GET /api/properties` - List properties
- `GET /api/properties/:id` - Property details
- `POST /api/bookings` - Create booking
- `POST /api/payments/intent` - Payment processing
- `GET /api/messages` - Chat messages
- `POST /api/reviews` - Submit reviews

## 📦 Component Library

### Shared Components
- Header with navigation
- Footer with links
- PropertyCard with image carousel
- AuthDialog for login/register
- SearchDialog for search filters
- FiltersDialog for advanced filtering
- LoadingSpinner for loading states

### UI Components (Radix-based)
- Button, Input, Label
- Dialog, Sheet, Popover
- Calendar, Slider, Switch
- Tabs, Separator, Badge
- Card, Avatar, Checkbox
- and 30+ more...

## 🎨 Design Highlights

- **Green Theme**: Professional green (#00845B) as primary color
- **Modern UI**: Clean, minimalist design
- **Smooth Animations**: Motion-powered transitions
- **Image Galleries**: Full-screen galleries with navigation
- **Cards**: Elevation and hover effects
- **Typography**: Clear hierarchy and readability

## 📊 Mock Data

Includes comprehensive mock data:
- 6 detailed property listings
- User profiles with avatars
- Reviews and ratings
- Booking records
- Host statistics

## 🔐 Security Considerations

- JWT token management
- Protected routes
- Input validation
- Secure payment forms
- HTTPS ready
- Environment variables for API keys

## 🌐 Deployment Ready

- Vite build configuration
- Environment variable support
- Static asset optimization
- Code splitting
- Tree shaking
- Production build optimization

---

Built with ❤️ using modern web technologies
