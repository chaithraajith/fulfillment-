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
app.use(express.json());

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

// Batch sync multiple orders
app.post('/batch-sync', async (req, res) => {
  const { orders } = req.body;

  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({
      success: false,
      error: 'orders array is required'
    });
  }

  const results = [];

  for (const order of orders) {
    try {
      const result = await syncOrderTracking({
        orderName        : order.orderName,
        trackingCompany  : order.trackingCompany,
        trackingNumber   : String(order.trackingNumber).trim(),
        trackingUrl      : order.trackingUrl
      });

      results.push({
        orderName : order.orderName,
        success   : true,
        data      : result
      });

    } catch (error) {
      results.push({
        orderName : order.orderName,
        success   : false,
        error     : error.message
      });
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  res.json({
    total      : results.length,
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