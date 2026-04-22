# Carabao Mobile 📱

React Native (Expo) mobile companion for the Carabao farm-to-buyer marketplace.

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | React Native + Expo SDK 52 |
| Navigation | React Navigation v6 (native stack + bottom tabs) |
| Auth State | React Context + AsyncStorage |
| Cart State | React Context |
| HTTP | Axios |
| Backend | FastAPI (shared with web) |

---

## Project Structure

```
carabao-mobile/
├── App.tsx                        # Root component with providers
├── app.json                       # Expo config
├── src/
│   ├── types/index.ts             # Shared TypeScript types
│   ├── lib/
│   │   ├── theme.ts               # Design tokens (colors, spacing, etc.)
│   │   ├── api.ts                 # Axios client + API helpers
│   │   ├── AuthContext.tsx        # Auth state & sign-in/sign-up/sign-out
│   │   ├── CartContext.tsx        # Cart state
│   │   └── mockData.ts            # Mock farms, products, orders
│   ├── components/
│   │   ├── UI.tsx                 # Button, Badge, Card, EmptyState, etc.
│   │   ├── FarmCard.tsx           # Farm listing card
│   │   └── Header.tsx             # Shared navigation header
│   ├── screens/
│   │   ├── AuthScreen.tsx         # Sign-in / sign-up
│   │   ├── OrderScreen.tsx        # Farm browsing with search + filter
│   │   ├── MerchantScreen.tsx     # Farm detail + product listing
│   │   ├── CartScreen.tsx         # Cart management
│   │   ├── CheckoutScreen.tsx     # Checkout form
│   │   ├── ConfirmationScreen.tsx # Order confirmed
│   │   ├── TrackScreen.tsx        # Order tracking with status timeline
│   │   ├── HistoryScreen.tsx      # Past orders
│   │   ├── ProfileScreen.tsx      # User profile + settings
│   │   └── OnboardingScreen.tsx   # Buyer setup / merchant apply
│   └── navigation/
│       └── AppNavigator.tsx       # Stack + tab navigators
└── backend_additions.py           # New FastAPI routes to add
```

---

## Quick Start

### 1. Install dependencies

```bash
cd carabao-mobile
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local and set EXPO_PUBLIC_API_URL to your FastAPI URL
```

### 3. Add mobile auth routes to the backend

Copy the contents of `backend_additions.py` into `backend/app/api/routes/router.py`.

Install the extra Python dependency:

```bash
cd ../backend
uv add "passlib[bcrypt]"
```

**Note**: In production, add a dedicated `password_hash` column to the `User` model instead of reusing `external_auth_id`.

### 4. Start the app

```bash
# Development (Expo Go)
npx expo start

# iOS simulator
npx expo start --ios

# Android emulator
npx expo start --android
```

---

## Screen Overview

| Screen | Route | Description |
|---|---|---|
| Auth | `/auth` | Email/password sign-in and sign-up |
| Order | Tab 1 | Farm browsing with search and category filter |
| Merchant | Stack | Farm detail page with product grid and add-to-cart |
| Cart | Tab 2 | Cart with quantity controls, summary, checkout CTA |
| Checkout | Stack | Address, time window, payment method, notes |
| Confirmation | Stack | Animated order confirmation with progress steps |
| Track | Tab 3 | Order list with status timeline and map placeholder |
| History | Tab 4 | Past orders with expandable details and reorder |
| Profile | Tab 5 | User info, settings, notifications, merchant apply |
| Onboarding | Stack | Buyer delivery profile + merchant application form |

---

## Backend API Mapping

| Mobile action | FastAPI endpoint |
|---|---|
| Sign up | `POST /auth/mobile/sign-up` |
| Sign in | `POST /auth/mobile/sign-in` |
| Get current user | `GET /auth/me` |
| Apply as merchant | `POST /merchant/` |
| List merchants | `GET /merchants/` |
| Get merchant | `GET /merchants/:id` |

The mobile app sends `Authorization: Bearer <token>` on every authenticated request (handled automatically by the Axios interceptor in `src/lib/api.ts`).

---

## Development Tips

- **Mock data**: All farms, products, and orders are mocked in `src/lib/mockData.ts`. Replace with real API calls as backend endpoints become available.
- **Auth flow**: Auth state is persisted in `AsyncStorage` — the app rehydrates on launch and skips the auth screen if a valid token exists.
- **Cart**: Cart state lives in memory (React Context). For persistence across app restarts, serialize to `AsyncStorage` in `CartContext.tsx`.
- **Map**: The Track screen shows a placeholder. Integrate `react-native-maps` and the Mapbox SDK to add live tracking.
