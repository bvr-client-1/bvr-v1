export const validate = (schema, property = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    error.statusCode = 400;
    return next(error);
  }

  if (property === 'query' || property === 'params') {
    for (const key of Object.keys(req[property])) {
      if (!(key in value)) {
        delete req[property][key];
      }
    }
    Object.assign(req[property], value);
  } else {
    req[property] = value;
  }
  return next();
};
