# Hyperramp Backend

A backend server for a cryptocurrency onramp service using Stripe for payment processing.

## Features

- Accepts payments via Stripe Checkout
- Calculates service fees (0.5%) and Stripe fees
- Provides API endpoints for creating checkout sessions and verifying payments
- Maximum onramp amount of $2,500

## API Endpoints

- `POST /api/create-checkout` - Create a Stripe checkout session
- `GET /api/verify-session` - Verify a Stripe session after payment completes

## Prerequisites

- Node.js (v14 or later)
- npm
- Stripe account and API key

## Environment Variables

Create a `.env` file in the root directory with the following:

```
VITE_STRIPE_SECRET_KEY=your_stripe_secret_key
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/hyperramp-backend.git
cd hyperramp-backend
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Development

Run the development server with hot reloading:

```bash
npm run dev
```

The server will run on port 3000 by default.

## Production

Build and start the production server:

```bash
npm run build
npm start
```

## API Usage

### Create Checkout Session

```javascript
// Example frontend code
const response = await fetch('http://localhost:3000/api/create-checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amount: 100 }), // Amount in USD
});

const { url } = await response.json();
window.location.href = url; // Redirect to Stripe Checkout
```

### Verify Session

```javascript
// Example frontend code
const response = await fetch(`http://localhost:3000/api/verify-session?id=${sessionId}`);
const session = await response.json();
```

## License

ISC 