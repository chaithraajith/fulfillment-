const { shopifyGET, shopifyPOST } = require('./shopify');
const { sanitizeTracking, normalizeCourier } = require('./helpers');

async function findOrder(orderName) {
  const data = await shopifyGET(
    `/orders.json?name=${orderName}&status=any`
  );
  if (!data.orders || data.orders.length === 0) {
    throw new Error(`Order ${orderName} not found`);
  }
  return data.orders[0];
}

async function getFulfillmentOrders(orderId) {
  const data = await shopifyGET(
    `/orders/${orderId}/fulfillment_orders.json`
  );
  return data.fulfillment_orders;
}

async function sendFulfillmentRequest(fulfillmentOrderId) {
  try {
    await shopifyPOST(
      `/fulfillment_orders/${fulfillmentOrderId}/fulfillment_request.json`,
      { fulfillment_request: { message: 'Please fulfill this order' } }
    );
  } catch (error) {
    console.log('Request note:', error.message);
  }
}

async function createFulfillment({
  fulfillmentOrderId,
  trackingCompany,
  trackingNumber,
  trackingUrl
}) {
  const data = await shopifyPOST('/fulfillments.json', {
    fulfillment: {
      line_items_by_fulfillment_order: [
        { fulfillment_order_id: fulfillmentOrderId }
      ],
      tracking_info: {
        company: normalizeCourier(trackingCompany),
        number: sanitizeTracking(trackingNumber),
        url: trackingUrl
      },
      notify_customer: false
    }
  });
  return data.fulfillment;
}

async function updateTracking({
  fulfillmentId,
  trackingCompany,
  trackingNumber,
  trackingUrl
}) {
  const data = await shopifyPOST(
    `/fulfillments/${fulfillmentId}/update_tracking.json`,
    {
      fulfillment: {
        tracking_info: {
          company: normalizeCourier(trackingCompany),
          number: sanitizeTracking(trackingNumber),
          url: trackingUrl
        },
        notify_customer: false
      }
    }
  );
  return data.fulfillment;
}

async function syncOrderTracking({
  orderName,
  trackingCompany,
  trackingNumber,
  trackingUrl
}) {
  console.log(`\nSyncing ${orderName}...`);

  const order = await findOrder(orderName);
  console.log(`Found: ${order.id}`);

  // Check existing active fulfillment
  if (order.fulfillments && order.fulfillments.length > 0) {
    const existing = order.fulfillments.find(
      f => f.status !== 'cancelled'
    );
    if (existing) {
      console.log(`Updating existing fulfillment: ${existing.id}`);
      const updated = await updateTracking({
        fulfillmentId: existing.id,
        trackingCompany,
        trackingNumber,
        trackingUrl
      });
      return {
        action: 'UPDATED',
        fulfillmentId: updated.id,
        orderName
      };
    }
  }

  // Get fulfillment orders
  const fulfillmentOrders = await getFulfillmentOrders(order.id);

  // Find open or in_progress fulfillment order
  const openFO = fulfillmentOrders.find(
    fo => fo.status === 'open' || fo.status === 'in_progress'
  );

  if (!openFO) {
    throw new Error(`No open fulfillment order for ${orderName}`);
  }

  console.log(`FO ID: ${openFO.id} | Status: ${openFO.status} | Request: ${openFO.request_status}`);

  // Send request if unsubmitted
  if (openFO.request_status === 'unsubmitted') {
    console.log(`Sending request to Wukusy...`);
    await sendFulfillmentRequest(openFO.id);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Create fulfillment
  const fulfillment = await createFulfillment({
    fulfillmentOrderId: openFO.id,
    trackingCompany,
    trackingNumber,
    trackingUrl
  });

  console.log(`✅ Done: ${fulfillment.id}`);

  return {
    action: 'CREATED',
    fulfillmentId: fulfillment.id,
    orderName
  };
}

module.exports = { syncOrderTracking };