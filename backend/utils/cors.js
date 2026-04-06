export const parseAllowedOrigins = (frontendUrls) =>
  [...new Set(frontendUrls.split(',').map((value) => value.trim()).filter(Boolean))];

export const isOriginAllowed = (origin, allowedOrigins) => !origin || allowedOrigins.includes(origin);
