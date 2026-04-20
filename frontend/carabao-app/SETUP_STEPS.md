# BetterAuth Setup - Next Steps

## 1. Delete node_modules and reinstall

```powershell
rm -r node_modules package-lock.json
npm install
```

## 2. Create .env.local file

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_SECRET=your-random-secret-here
MOCK_AUTH_SESSION=false
AUTH_SYNC_SHARED_SECRET=your-shared-secret-between-next-and-fastapi
FASTAPI_JWT_SECRET=your-fastapi-jwt-signing-secret
```

### Optional: Enable mock auth session for UI testing

Set this in `.env.local` when you want to bypass real login locally:

```env
MOCK_AUTH_SESSION=true
```

When enabled:

- `/api/auth/get-session` returns a fixed mock user session.
- Protected routes in proxy auth checks are accessible without a real cookie.

Set `MOCK_AUTH_SESSION=false` to return to normal Better Auth behavior.

### FastAPI as auth source of truth

For Better Auth -> FastAPI sync and FastAPI-issued API token flow:

- `AUTH_SYNC_SHARED_SECRET` must be the same value in Next.js and FastAPI env.
- `FASTAPI_JWT_SECRET` must be set in FastAPI env to issue/verify backend access tokens.

Generate a random secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Run the dev server

```powershell
npm run dev
```

## 4. Test it

- Go to `http://localhost:3000/signup`
- Create an account
- You should be redirected to `/app`
- Check that you're logged in with the useAuth() hook

## Common Errors Fixed

- ✅ Removed invalid PostgreSQL imports
- ✅ Fixed BetterAuth configuration to use SQLite
- ✅ Corrected API route handler
- ✅ Fixed AuthProvider component
- ✅ Updated middleware to use cookies instead of auth API
- ✅ Removed unused imports
- ✅ Downgraded to BetterAuth v0.15.0 (stable version)

## If you still get errors

- Check that .env.local has all three variables
- Make sure port 3000 is not in use
- Clear browser cache/cookies
- Try `npm run build` to check for TypeScript errors
