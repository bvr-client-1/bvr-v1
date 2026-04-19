export const notFoundHandler = (_req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;

  if (error.isJoi) {
    return res.status(statusCode).json({
      message: 'Validation failed',
      details: error.details.map((detail) => detail.message),
    });
  }

  console.error(error);
  return res.status(statusCode).json({
    message: statusCode >= 500 ? 'Internal server error' : error.message || 'Internal server error',
  });
};
