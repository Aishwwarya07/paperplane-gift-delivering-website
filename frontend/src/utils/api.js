const API_BASE = ''; // In dev, Vite proxies /api/* → localhost:5000; in prod, Vercel routes /api/* to backend

export const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  
  // Clone or initialize headers
  const headers = options.headers ? { ...options.headers } : {};

  // Inject JWT authorization if present
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Inject content-type unless body is FormData (which requires letting the browser set it automatically)
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers
  });

  return response;
};

// Expose the raw API_BASE url if components need it (e.g. for image sources)
export const getAssetUrl = (path) => {
  if (!path) return '';
  return `${API_BASE}${path}`;
};
