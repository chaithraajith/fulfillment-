const { shopifyGET, shopifyPOST } = require('./shopify');
const { sanitizeTracking, normalizeCourier } = require('./helpers');

/**
 * Finds an order by its exact name
 */
async function findOrder(orderName) {
  const query = encodeURIComponent(orderName.trim());
  const data = await shopifyGET(`/orders.json?name=${query}&status=any`);

  if (!data.orders || data.orders.length === 0) {
    throw new Error(`Order ${orderName} not found`);
  }

  const exact = data.orders.find(
    o => o.name.toLowerCase() === orderName.trim().toLowerCase()
  );
  return exact || data.orders[0];
}

async function getFulfillmentOrders(orderId) {
  const data = await shopifyGET(`/orders/${orderId}/fulfillment_orders.json`);
  return data.fulfillment_orders || [];
}

async function sendFulfillmentRequest(fulfillmentOrderId) {
  try {
    await shopifyPOST(
      `/fulfillment_orders/${fulfillmentOrderId}/fulfillment_request.json`,
      { fulfillment_request: { message: 'Please fulfill this order' } }
    );
  } catch (error) {
    console.log(`Note for FO ${fulfillmentOrderId}:`, error.message);
  }
}

async function createFulfillment({ fulfillmentOrderId, trackingCompany, trackingNumber, trackingUrl }) {
  const data = await shopifyPOST('/fulfillments.json', {
    fulfillment: {
      line_items_by_fulfillment_order: [{ fulfillment_order_id: fulfillmentOrderId }],
      tracking_info: {
        company: normalizeCourier(trackingCompany),
        number: sanitizeTracking(trackingNumber),
        url: trackingUrl || ''
      },
      notify_customer: false
    }
  });
  return data.fulfillment;
}

async function updateTracking({ fulfillmentId, trackingCompany, trackingNumber, trackingUrl }) {
  const data = await shopifyPOST(`/fulfillments/${fulfillmentId}/update_tracking.json`, {
    fulfillment: {
      tracking_info: {
        company: normalizeCourier(trackingCompany),
        number: sanitizeTracking(trackingNumber),
        url: trackingUrl || ''
      },
      notify_customer: false
    }
  });
  return data.fulfillment;
}

/**
 * Syncs a single order with retry capability
 */
async function syncOrderTracking({ orderName, trackingCompany, trackingNumber, trackingUrl }) {
  const order = await findOrder(orderName);

  // If already fulfilled, update tracking
  if (order.fulfillments && order.fulfillments.length > 0) {
    const existing = order.fulfillments.find(f => f.status !== 'cancelled');
    if (existing) {
      const updated = await updateTracking({
        fulfillmentId: existing.id,
        trackingCompany,
        trackingNumber,
        trackingUrl
      });
      return { action: 'UPDATED', fulfillmentId: updated.id, orderName };
    }
  }

  const fulfillmentOrders = await getFulfillmentOrders(order.id);
  const openFO = fulfillmentOrders.find(fo => fo.status === 'open' || fo.status === 'in_progress');

  if (!openFO) {
    throw new Error(`No open fulfillment order for ${orderName}`);
  }

  if (openFO.request_status === 'unsubmitted') {
    await sendFulfillmentRequest(openFO.id);
    await new Promise(res => setTimeout(res, 1000)); // reduced wait to 1s
  }

  const fulfillment = await createFulfillment({
    fulfillmentOrderId: openFO.id,
    trackingCompany,
    trackingNumber,
    trackingUrl
  });

  return { action: 'CREATED', fulfillmentId: fulfillment.id, orderName };
}

/**
 * BATCH RUNNER:
 * Runs multiple orders concurrently with rate limiting & error isolation
 *
 * @param {Array} orders - Array of { orderName, trackingCompany, trackingNumber, trackingUrl }
 * @param {number} concurrency - Max simultaneous orders (Default: 2 to keep Shopify safe)
 */
async function syncAllOrdersBatch(orders, concurrency = 2) {
  console.log(`\n🚀 Starting batch fulfillment for ${orders.length} orders...`);
  const results = [];
  const queue = [...orders];

  async function worker(workerId) {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        console.log(`[Worker ${workerId}] Processing: ${item.orderName}`);
        const res = await syncOrderTracking(item);
        console.log(`✅ [Worker ${workerId}] Success ${item.orderName}: ${res.action}`);
        results.push({ ...item, status: 'SUCCESS', result: res });
      } catch (err) {
        console.error(`❌ [Worker ${workerId}] Failed ${item.orderName}:`, err.message);
        // Does NOT crash the batch! Moves to the next order.
        results.push({ ...item, status: 'FAILED', error: err.message });
      }

      // Small pause between worker requests to prevent 429 rate limit
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Run workers in parallel
  const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const succeeded = results.filter(r => r.status === 'SUCCESS').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  console.log(`\n🎉 Batch complete! Succeeded: ${succeeded} | Failed: ${failed}`);

  return results;
}

module.exports = { syncOrderTracking, syncAllOrdersBatch };