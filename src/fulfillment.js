const { shopifyGET, shopifyPOST } = require('./shopify');
const { sanitizeTracking, normalizeCourier } = require('./helpers');

/**
 * Helper to pause execution
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps Shopify API calls with automatic retry on HTTP 429 (Rate Limit)
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const is429 =
        (error.response && error.response.status === 429) ||
        (error.message && error.message.includes('429'));

      if (is429 && attempt <= maxRetries) {
        // Read Shopify's retry-after header (in seconds) or default to 2.5s
        const retryAfterSec = error.response?.headers?.['retry-after']
          ? parseFloat(error.response.headers['retry-after'])
          : 2.0;

        const waitMs = Math.ceil((retryAfterSec + 0.5) * 1000);
        console.warn(
          `⚠️ [Rate Limit 429] Cooldown for ${waitMs / 1000}s before retry (Attempt ${attempt}/${maxRetries})...`
        );

        await sleep(waitMs);
        continue;
      }

      // If it's not a 429 or max retries exceeded, throw error
      throw error;
    }
  }
}

/**
 * Finds an order by its exact name (handles '#' properly)
 */
async function findOrder(orderName) {
  const query = encodeURIComponent(orderName.trim());

  const data = await withRetry(() =>
    shopifyGET(`/orders.json?name=${query}&status=any`)
  );

  if (!data.orders || data.orders.length === 0) {
    throw new Error(`Order ${orderName} not found in Shopify`);
  }

  const exact = data.orders.find(
    (o) => o.name.toLowerCase() === orderName.trim().toLowerCase()
  );

  return exact || data.orders[0];
}

/**
 * Gets fulfillment orders for an order ID
 */
async function getFulfillmentOrders(orderId) {
  const data = await withRetry(() =>
    shopifyGET(`/orders/${orderId}/fulfillment_orders.json`)
  );
  return data.fulfillment_orders || [];
}

/**
 * Submits fulfillment request to warehouse/3PL if required
 */
async function sendFulfillmentRequest(fulfillmentOrderId) {
  try {
    await withRetry(() =>
      shopifyPOST(
        `/fulfillment_orders/${fulfillmentOrderId}/fulfillment_request.json`,
        { fulfillment_request: { message: 'Please fulfill this order' } }
      )
    );
  } catch (error) {
    console.log(`Note for FO ${fulfillmentOrderId}:`, error.message);
  }
}

/**
 * Creates fulfillment with tracking details
 */
async function createFulfillment({
  fulfillmentOrderId,
  trackingCompany,
  trackingNumber,
  trackingUrl,
}) {
  const data = await withRetry(() =>
    shopifyPOST('/fulfillments.json', {
      fulfillment: {
        line_items_by_fulfillment_order: [
          { fulfillment_order_id: fulfillmentOrderId },
        ],
        tracking_info: {
          company: normalizeCourier(trackingCompany),
          number: sanitizeTracking(trackingNumber),
          url: trackingUrl || '',
        },
        notify_customer: false,
      },
    })
  );
  return data.fulfillment;
}

/**
 * Updates tracking on an existing fulfillment
 */
async function updateTracking({
  fulfillmentId,
  trackingCompany,
  trackingNumber,
  trackingUrl,
}) {
  const data = await withRetry(() =>
    shopifyPOST(`/fulfillments/${fulfillmentId}/update_tracking.json`, {
      fulfillment: {
        tracking_info: {
          company: normalizeCourier(trackingCompany),
          number: sanitizeTracking(trackingNumber),
          url: trackingUrl || '',
        },
        notify_customer: false,
      },
    })
  );
  return data.fulfillment;
}

/**
 * Core function: Sync tracking for a single order
 */
async function syncOrderTracking({
  orderName,
  trackingCompany,
  trackingNumber,
  trackingUrl,
}) {
  // 1. Fetch Order from Shopify
  const order = await findOrder(orderName);
  await sleep(200); // Micro-pause to pace Shopify API

  // 2. Check if already has an active fulfillment
  if (order.fulfillments && order.fulfillments.length > 0) {
    const existing = order.fulfillments.find((f) => f.status !== 'cancelled');
    if (existing) {
      const updated = await updateTracking({
        fulfillmentId: existing.id,
        trackingCompany,
        trackingNumber,
        trackingUrl,
      });
      return {
        action: 'UPDATED',
        fulfillmentId: updated.id,
        orderName: order.name,
      };
    }
  }

  // 3. Fetch fulfillment orders
  const fulfillmentOrders = await getFulfillmentOrders(order.id);
  await sleep(200); // Micro-pause

  const openFO = fulfillmentOrders.find(
    (fo) => fo.status === 'open' || fo.status === 'in_progress'
  );

  if (!openFO) {
    throw new Error(
      `No open fulfillment order for ${orderName} (may already be fulfilled or cancelled)`
    );
  }

  // 4. Send request if status is 'unsubmitted'
  if (openFO.request_status === 'unsubmitted') {
    await sendFulfillmentRequest(openFO.id);
    await sleep(1200); // Allow Shopify to transition status
  }

  // 5. Create fulfillment
  const fulfillment = await createFulfillment({
    fulfillmentOrderId: openFO.id,
    trackingCompany,
    trackingNumber,
    trackingUrl,
  });

  return {
    action: 'CREATED',
    fulfillmentId: fulfillment.id,
    orderName: order.name,
  };
}

/**
 * Standalone batch runner (with error isolation and rate control)
 */
async function syncAllOrdersBatch(orders, concurrency = 2) {
  console.log(`\n🚀 Starting batch fulfillment for ${orders.length} orders...`);
  const results = [];
  const queue = [...orders];

  async function worker(workerId) {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || !item.orderName) continue;

      try {
        console.log(`[Worker ${workerId}] Processing: ${item.orderName}`);
        const res = await syncOrderTracking(item);
        console.log(`✅ [Worker ${workerId}] Success ${item.orderName}: ${res.action}`);
        results.push({ ...item, status: 'SUCCESS', result: res });
      } catch (err) {
        console.error(`❌ [Worker ${workerId}] Failed ${item.orderName}:`, err.message);
        results.push({ ...item, status: 'FAILED', error: err.message });
      }

      await sleep(600); // Safe delay between worker jobs
    }
  }

  const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const succeeded = results.filter((r) => r.status === 'SUCCESS').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  console.log(`\n🎉 Batch complete! Succeeded: ${succeeded} | Failed: ${failed}`);

  return results;
}

module.exports = { syncOrderTracking, syncAllOrdersBatch };