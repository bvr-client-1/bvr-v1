export const validate = (schema, property = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    error.statusCode = 400;
    return next(error);
  }

  req[property] = value;
  return next();
};
