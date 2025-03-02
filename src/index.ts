import express from 'express';
import config from './config/config';
import stripeRoutes from './routes/stripeRoutes';
import { corsMiddleware } from './middleware/cors';

// Initialize Express
const app = express();

// Apply custom CORS middleware before any other middleware
app.use(corsMiddleware);

// Special handling for Stripe webhooks - needs raw body
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// For all other routes, parse JSON
app.use(express.json());

// Routes
app.use('/api', stripeRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Fallback route for /cancel to handle old links
app.get('/cancel', (req, res) => {
  res.redirect('/?canceled=true');
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    message: err.message || 'Something went wrong!',
  });
});

// Start the server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`API available at http://localhost:${config.port}/api`);
}); 