export const isDev = import.meta.env.MODE === 'development';
export const API_URL = isDev ? 'http://localhost:5000' : '';
export const SOCKET_URL = isDev ? 'http://localhost:5000' : undefined;
