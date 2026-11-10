// Expo reads this file on top of app.json. Its one job: let a build choose the
// API address without editing app.json, by setting EXPO_PUBLIC_API_BASE_URL
// (for example the hosted web export in vercel.json, pointed at staging).
// Without that variable, app.json's extra.apiBaseUrl is used unchanged.
module.exports = ({ config }) => {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (apiBaseUrl === undefined) return config;
  return { ...config, extra: { ...config.extra, apiBaseUrl: apiBaseUrl.replace(/\/+$/, '') } };
};
