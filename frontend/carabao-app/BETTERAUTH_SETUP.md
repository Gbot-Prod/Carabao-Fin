# BetterAuth Implementation Guide

## Overview

BetterAuth is a modern, lightweight authentication framework that provides:

- ✅ Session management (secure cookies)
- ✅ Email/password authentication
- ✅ OAuth support (Google, GitHub, etc.)
- ✅ Multi-factor authentication (optional)
- ✅ User management & profiles
- ✅ Database integration
- ✅ Type-safe API

## Architecture

```
User (Frontend) 
    ↓
Next.js App
    ├─ AuthProvider (wraps all routes)
    ├─ Middleware (protects routes)
    └─ API Route: /api/auth/[betterauth]/* (BetterAuth handler)
        ↓
    BetterAuth Server (in-process, SQLite)
        └─ Database (auth.db)
```

## What Gets Installed

Added to `package.json`:

- `better-auth` - Core framework
- `@better-auth/core` - Core functionality
- `@better-auth/next-js` - Next.js integration
- `zod` - Type validation

## File Structure

```
frontend/carabao-app/
├── lib/
│   ├── auth.ts              # Server-side BetterAuth config
│   └── auth-client.ts       # Client-side auth API
├── hooks/
│   └── useAuth.ts           # React hook for auth state
├── components/
│   ├── AuthProvider.tsx     # Auth context provider (wraps app)
│   ├── LogoutButton.tsx     # Logout component
│   └── UserMenu.tsx         # User info & menu
├── app/
│   ├── layout.tsx           # Updated to use AuthProvider
│   ├── middleware.ts        # Route protection
│   ├── (standalone)/
│   │   ├── login/page.tsx   # Login page
│   │   └── signup/page.tsx  # Signup page
│   └── api/auth/
│       ├── [betterauth]/route.ts  # BetterAuth handler
│       └── route.ts         # Optional: Custom auth verification
├── util/
│   └── api.ts               # Updated with token injection
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd frontend/carabao-app
npm install
```

### 2. Environment Variables

Update `.env.local`:

```env
NEXT_PUBLIC_MAPBOX_API_KEY=your-key
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_SECRET=your-random-secret-key-here
```

Generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Database Setup

BetterAuth uses SQLite by default (`auth.db`). The database is auto-created on first run.

**Optional: Use PostgreSQL instead**

Edit `lib/auth.ts`:

```typescript
database: {
  type: "postgres",
  url: process.env.DATABASE_URL,
}
```

## Usage Examples

### Check if User is Logged In

```typescript
"use client";

import { useAuth } from "@/hooks/useAuth";

export function MyComponent() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <div>Loading...</div>;

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return <div>Hello {user?.name}!</div>;
}
```

### Make API Calls with Auth

Already configured in `util/api.ts`. Just use it normally:

```typescript
import apiClient from "@/util/api";

// Automatically includes Bearer token
const response = await apiClient.get("/api/users/profile");
```

### Programmatic Login/Logout

```typescript
import { signIn, signOut } from "@/lib/auth-client";

// Sign in
await signIn.email({
  email: "user@example.com",
  password: "password123"
});

// Sign out
await signOut();
```

### Protected Routes

Routes in middleware.ts are automatically protected:

- `/app/*` - Requires auth
- `/profile/*` - Requires auth
- `/merchant/*` - Requires auth

Unauthenticated users are redirected to `/landing`.

### Get Session on Server (API Routes)

```typescript
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ user: session.user });
}
```

## Backend Integration

### Option A: Keep BetterAuth Standalone (Recommended for MVP)

- BetterAuth manages all authentication
- Your FastAPI backend is protected by checking the token
- Simpler but less control

**In your FastAPI:**

```python
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthCredentials

security = HTTPBearer()

def verify_token(credentials: HTTPAuthCredentials = Depends(security)):
    # Verify the token with BetterAuth or check JWT signature
    # For MVP, just check if token exists
    if not credentials.credentials:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return credentials.credentials
```

### Option B: Custom Backend Integration

If you want to sync user data between BetterAuth and your FastAPI backend:

**Endpoint in `app/api/auth/route.ts`:**

```typescript
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  // Sync with FastAPI backend
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/link-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: session.user }),
  });

  return NextResponse.json({ success: true });
}
```

## Customization

### Add Google OAuth

In `lib/auth.ts`:

```typescript
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  },
}
```

Then use in signup:

```typescript
await signIn.social({
  provider: "google",
});
```

### Add Email Verification

```typescript
emailVerification: {
  sendVerificationEmail: async (email, token) => {
    // Send verification email via your email service
  },
}
```

### Extend User Data

Add custom fields:

```typescript
const auth = betterAuth({
  user: {
    fields: {
      role: {
        type: "string",
        defaultValue: "user",
      },
      avatar: {
        type: "string",
      },
    },
  },
});
```

## Security Notes

🔒 **Important:**

1. Store `BETTER_AUTH_SECRET` securely (use a strong random value)
2. Set `httpOnly: true` for session cookies (default)
3. Verify CSRF tokens on state-changing requests
4. Rate limit auth endpoints in production
5. Update `NEXT_PUBLIC_APP_URL` for each environment
6. Keep `Better-Auth` and dependencies updated

## Removing Clerk

Since you're moving to BetterAuth:

1. ✅ Frontend: No Clerk packages installed
2. ⚠️ Backend: Still has Clerk webhooks in `backend/app/api/webhooks/clerk/`
   - **Option A:** Remove the Clerk webhook folder when fully migrated
   - **Option B:** Keep it if you still need Clerk functionality during transition

To remove Clerk:

```bash
# Frontend - not needed, already removed
# Backend
rm -r backend/app/api/webhooks/clerk
# Remove svix dependency from pyproject.toml
```

## Database (Production)

For production, consider PostgreSQL:

```bash
# Install postgres driver
pip install asyncpg
```

Update `lib/auth.ts`:

```typescript
database: {
  type: "postgres",
  url: process.env.DATABASE_URL,
}
```

Set `DATABASE_URL` in `.env.local`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/carabao_auth
```

## Testing

### Test Login Flow

1. Start frontend: `npm run dev`
2. Go to `http://localhost:3000/signup`
3. Create account
4. Should be redirected to `/app`
5. Check auth state with `useAuth()` hook

### Test Protected Routes

```typescript
// In any component
import { useAuth } from "@/hooks/useAuth";

export function ProtectedComponent() {
  const { isAuthenticated } = useAuth();
  
  return isAuthenticated ? <Dashboard /> : <Redirect />;
}
```

## Troubleshooting

### Session not persisting?

- Check browser cookies (should have `better-auth.session_token`)
- Verify `BETTER_AUTH_SECRET` is set
- Try clearing cookies and logging in again

### Token not sent to backend?

- Check `apiClient` interceptor in `util/api.ts`
- Verify backend CORS allows `Authorization` header

### 401 errors from backend?

- Ensure backend validates token format (Bearer token)
- Check token expiration in BetterAuth config

## Next Steps

1. ✅ Test login/signup at `/signup` and `/login`
2. Configure database (SQLite is fine for MVP)
3. Add OAuth providers if needed (Google, GitHub)
4. Set up email verification
5. Integrate with FastAPI backend auth
6. Remove Clerk migration code when fully transitioned
