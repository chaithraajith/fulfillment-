const axios = require('axios');
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2025-10';
const BASE_URL = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}`;

async function shopifyGET(endpoint) {
  console.log(`GET ${BASE_URL}${endpoint}`);
  console.log(`Store: ${SHOPIFY_STORE}`);
  
  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

async function shopifyPOST(endpoint, data) {
  console.log(`POST ${BASE_URL}${endpoint}`);
  
  const response = await axios.post(`${BASE_URL}${endpoint}`, data, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

module.exports = { shopifyGET, shopifyPOST };