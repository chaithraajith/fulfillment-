const axios = require('axios');
require('dotenv').config();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2025-10';
const BASE_URL = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}`;

async function shopifyGET(endpoint) {
  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

async function shopifyPOST(endpoint, data) {
  const response = await axios.post(`${BASE_URL}${endpoint}`, data, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

module.exports = { shopifyGET, shopifyPOST };