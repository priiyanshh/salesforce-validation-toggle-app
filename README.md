# Salesforce Validation Toggle App

Full-stack application built for the Associate Software Engineer assignment.

- `client/`: React + Vite + Tailwind frontend
- `server/`: Node.js + Express backend with JSForce

## Features

- OAuth 2.0 login with Salesforce Connected App
- Account validation rule list from Salesforce Tooling API
- Rule details shown in UI: name, error message, active state
- Per-rule toggle controls in the UI
- Deploy flow that commits pending rule status changes to Salesforce
- Connection status badge and deploy error toasts

## 1) Clone repository

```bash
git clone <your-repository-url>
cd salesforce-validation-toggle-app
```

## 2) Install dependencies

```bash
cd server
npm install
cd ../client
npm install
```

## 3) Configure Salesforce Connected App

In Salesforce Setup:

1. Go to **App Manager** -> **New Connected App**
2. Fill app details (name, email, API name auto-generated)
3. Enable **OAuth Settings**
4. Set callback URL:
   - `http://localhost:4000/auth/callback`
5. Add OAuth scopes:
   - `Access and manage your data (api)`
   - `Perform requests at any time (refresh_token, offline_access)`
6. Save and wait for app propagation
7. Open app details and copy:
   - Consumer Key -> `SF_CLIENT_ID`
   - Consumer Secret -> `SF_CLIENT_SECRET`

## 4) Configure environment variables

Create/edit root `.env`:

```env
SF_CLIENT_ID=your_connected_app_client_id
SF_CLIENT_SECRET=your_connected_app_client_secret
SF_REDIRECT_URI=http://localhost:4000/auth/callback
SF_LOGIN_URL=https://login.salesforce.com

PORT=4000
CLIENT_URL=http://localhost:5173
SESSION_SECRET=replace_with_a_long_random_secret
```

For sandbox orgs:

```env
SF_LOGIN_URL=https://test.salesforce.com
```

## 5) Run locally

Open two terminals.

### Terminal 1 (backend)

```bash
cd server
npm run dev
```

Backend runs at `http://localhost:4000`.

### Terminal 2 (frontend)

```bash
cd client
npm run dev
```

Frontend runs at `http://localhost:5173`.

## 6) Verify functionality

1. Open `http://localhost:5173`
2. Click **Login to Salesforce**
3. Authorize the connected app
4. Confirm status shows **Connected to Salesforce**
5. Click **Refresh Rules** and confirm Account rules are listed
6. Toggle one or more rules (these become pending)
7. Click **Deploy** to save those changes to Salesforce
8. Confirm success/failure message and updated status

## API routes

- `GET /auth/login-url` - returns Salesforce authorization URL
- `GET /auth/login` - redirects to Salesforce authorization URL
- `GET /auth/callback` - OAuth callback and token exchange
- `GET /auth/status` - current session auth status
- `POST /auth/logout` - clear session

- `GET /api/validation-rules` - fetch Account validation rules
- `POST /api/validation-rules/toggle` - stage a single rule state in UI flow
- `POST /api/deploy` - commit pending rule status changes to Salesforce

## Notes

- Session storage is in-memory for local use.
- For production, use secure cookies and a persistent session store.
