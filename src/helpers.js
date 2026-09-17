function sanitizeTracking(trackingNumber) {
  if (!trackingNumber) return '';
  return String(trackingNumber).trim();
}

const COURIER_MAP = {
  'bluedart'        : 'BlueDart',
  'blue dart'       : 'BlueDart',
  'dtdc'            : 'DTDC',
  'delhivery'       : 'Delhivery',
  'amazon'          : 'Amazon Logistics',
  'amazon shipping' : 'Amazon Logistics',
};

function normalizeCourier(courier) {
  if (!courier) return '';
  const key = courier.toLowerCase().trim();
  return COURIER_MAP[key] || courier;
}

module.exports = { sanitizeTracking, normalizeCourier };