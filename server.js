const express = require('express');
const cors = require('cors');

// Load dotenv only in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { syncOrderTracking } = require('./src/fulfillment');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support larger payloads

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'Shopify Fulfillment Sync API',
    store: process.env.SHOPIFY_STORE_URL || 'NOT SET'
  });
});

// Sync single order
app.post('/sync', async (req, res) => {
  const { orderName, trackingCompany, trackingNumber, trackingUrl } = req.body;

  if (!orderName || !trackingNumber) {
    return res.status(400).json({
      success: false,
      error: 'orderName and trackingNumber are required'
    });
  }

  try {
    const result = await syncOrderTracking({
      orderName,
      trackingCompany,
      trackingNumber: String(trackingNumber).trim(),
      trackingUrl
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(`Error syncing ${orderName}:`, error.message);
    res.status(500).json({
      success: false,
      orderName,
      error: error.message
    });
  }
});

// Optimized Batch sync (Parallel Processing)
app.post('/batch-sync', async (req, res) => {
  const { orders } = req.body;

  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'orders array is required and cannot be empty'
    });
  }

  console.log(`\n📦 Received batch of ${orders.length} orders to fulfill...`);

  const results = [];
  const queue = [...orders];
  const CONCURRENCY = 3; // Process 3 orders simultaneously (Safe for Shopify)

  async function worker(workerId) {
    while (queue.length > 0) {
      const order = queue.shift();
      if (!order || !order.orderName) continue;

      try {
        console.log(`[Worker ${workerId}] Processing: ${order.orderName}`);
        
        const result = await syncOrderTracking({
          orderName: order.orderName,
          trackingCompany: order.trackingCompany,
          trackingNumber: String(order.trackingNumber || '').trim(),
          trackingUrl: order.trackingUrl
        });

        results.push({
          orderName: order.orderName,
          success: true,
          data: result
        });
        console.log(`✅ [Worker ${workerId}] Completed: ${order.orderName}`);
      } catch (error) {
        console.error(`❌ [Worker ${workerId}] Failed ${order.orderName}:`, error.message);
        results.push({
          orderName: order.orderName,
          success: false,
          error: error.message
        });
      }

      // Small pause to prevent Shopify 429 rate limit
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  // Run 3 workers in parallel
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`🎉 Batch finished! Success: ${successful}, Failed: ${failed}\n`);

  res.json({
    total: results.length,
    successful,
    failed,
    results
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`   Store  : ${process.env.SHOPIFY_STORE_URL}`);
  console.log(`   Health : GET  http://localhost:${PORT}/`);
  console.log(`   Sync   : POST http://localhost:${PORT}/sync`);
  console.log(`   Batch  : POST http://localhost:${PORT}/batch-sync\n`);
});